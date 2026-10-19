package gov.bee.api.demo.ledger;

import gov.bee.api.demo.DemoModule;
import gov.bee.api.demo.DemoResult;
import gov.bee.api.identity.Caller;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

/**
 * The SIMULATED certificate ledger (demo slice S3): a local test network, not Hyperledger Fabric and not a BEE system. Programme, Secretary and
 * Admin submit, commit (the "peer" step), fail, retry, amend and revoke; Auditor reads everything; a manufacturer reads its own organisation's
 * certificates. The person who submitted a transaction cannot commit or fail it (segregation_refused). Every change writes a ledger_event in
 * the same transaction (inside the ledger_* functions).
 */
@Component
public class LedgerModule implements DemoModule {

    /** An amended valid-to date may not run further than this from today (a certificate lasts three years; the demonstration allows some slack). */
    static final int MAX_YEARS_AHEAD = 10;
    private static final Set<String> WRITERS = Set.of("programme", "director", "admin");
    private static final Set<String> ALL_READERS = Set.of("programme", "director", "admin", "auditor", "officer");

    private final java.util.function.Supplier<LedgerRepository> repository;

    /** Resolved lazily so that tests that scan every module without a database (the contract tests) still start. */
    @org.springframework.beans.factory.annotation.Autowired
    public LedgerModule(org.springframework.beans.factory.ObjectProvider<org.springframework.jdbc.core.JdbcTemplate> jdbc) {
        this.repository = new java.util.function.Supplier<>() {
            private LedgerRepository made;

            @Override
            public synchronized LedgerRepository get() {
                if (made == null) {
                    made = new LedgerRepository(jdbc.getObject());
                }
                return made;
            }
        };
    }

    LedgerModule(LedgerRepository repo) {
        this.repository = () -> repo;
    }

    @Override
    public String name() {
        return "ledger";
    }

    /** The oversight roles count only when held for all records (BL-231). */
    private static boolean has(Caller c, Set<String> roles) {
        return gov.bee.api.demo.DemoAccess.holdsAll(c, roles);
    }

    /** null means all certificates; otherwise the caller's organisations; the caller must be allowed to read at all (checked before). */
    private static Collection<UUID> scope(Caller c) {
        return has(c, ALL_READERS) ? null : c.organisationIds();
    }

    private static boolean mayRead(Caller c) {
        return has(c, ALL_READERS) || gov.bee.api.demo.DemoAccess.holdsRole(c, Set.of("manufacturer"));
    }

    @Override
    public DemoResult handle(Caller caller, String method, String id, String action, Map<String, String> query, Map<String, Object> body) {
        if (!mayRead(caller)) {
            return DemoResult.denied();
        }
        if (id == null) {
            return method.equals("GET") ? list(caller) : DemoResult.notFound();
        }
        if (id.equals("transactions")) {
            return method.equals("GET") && action == null ? explorer(caller) : DemoResult.notFound();
        }
        UUID cert;
        try {
            cert = UUID.fromString(id);
        } catch (IllegalArgumentException e) {
            return DemoResult.notFound();
        }
        var found = repository.get().certificate(cert, scope(caller));
        if (found.isEmpty()) {
            return DemoResult.notFound();
        }
        if (method.equals("GET")) {
            if (action == null) {
                return DemoResult.ok(detail(caller, found.get()));
            }
            return action.equals("verify") ? DemoResult.ok(verification(cert)) : DemoResult.notFound();
        }
        if (action == null) {
            return DemoResult.notFound();
        }
        if (!has(caller, WRITERS)) {
            return DemoResult.denied();
        }
        UUID actor = caller.accountId();
        LedgerRepository.Result r;
        switch (action) {
            case "submit" -> r = repository.get().submit(cert, actor);
            case "commit" -> r = repository.get().decide(cert, actor, caller.actingIdentities(), "commit", null);
            case "fail" -> {
                String reason = text(body, "reason", 500);
                if (reason == null) {
                    return DemoResult.invalid("A reason for the simulated failure is required (up to 500 characters).");
                }
                r = repository.get().decide(cert, actor, caller.actingIdentities(), "fail", reason);
            }
            case "retry" -> r = repository.get().retry(cert, actor);
            case "amend" -> {
                String reason = text(body, "reason", 500);
                if (reason == null) {
                    return DemoResult.invalid("A reason for the amendment is required (up to 500 characters).");
                }
                if (body.keySet().stream().anyMatch(k -> !k.equals("reason") && !k.equals("validTo"))) {
                    return DemoResult.invalid("Only the valid-to date can be amended.");
                }
                LocalDate validTo;
                try {
                    validTo = LocalDate.parse(String.valueOf(body.get("validTo")));
                } catch (DateTimeParseException e) {
                    return DemoResult.invalid("The new valid-to date must be a date like 2029-06-30.");
                }
                if (validTo.isAfter(LocalDate.now().plusYears(MAX_YEARS_AHEAD))) {
                    return DemoResult.invalid("The new valid-to date can be at most " + MAX_YEARS_AHEAD + " years from today.");
                }
                r = repository.get().change(cert, actor, "amend", validTo, reason);
            }
            case "revoke" -> {
                String reason = text(body, "reason", 500);
                if (reason == null) {
                    return DemoResult.invalid("A reason for the revocation is required (up to 500 characters).");
                }
                r = repository.get().change(cert, actor, "revoke", null, reason);
            }
            default -> {
                return DemoResult.notFound();
            }
        }
        DemoResult refusal = refusal(r.result());
        if (refusal != null) {
            return refusal;
        }
        return DemoResult.ok(detail(caller, found.get()));
    }

    private static String text(Map<String, Object> body, String key, int max) {
        Object v = body.get(key);
        if (!(v instanceof String s) || s.isBlank() || s.strip().length() > max) {
            return null;
        }
        return s.strip();
    }

    private static DemoResult refusal(String code) {
        return switch (code) {
            case "ok" -> null;
            case "not_found" -> DemoResult.notFound();
            case "segregation_refused" -> DemoResult.error(HttpStatus.FORBIDDEN, "segregation_refused",
                "The person who submitted this transaction cannot commit or fail it; a second person must.");
            case "already_submitted" -> conflict("This certificate is already on the simulated ledger.");
            case "nothing_pending" -> conflict("No transaction is waiting for a peer.");
            case "not_failed" -> conflict("Only a failed transaction can be retried.");
            case "not_active" -> conflict("Only a certificate whose issue is committed and that is not revoked can be amended or revoked.");
            case "busy" -> conflict("A transaction is pending or failed; commit it or retry it first.");
            case "no_change" -> DemoResult.invalid("The new valid-to date is the same as the current one.");
            case "date_invalid" -> DemoResult.invalid("The new valid-to date must be after the valid-from date.");
            default -> DemoResult.invalid("The ledger refused this action.");
        };
    }

    private static DemoResult conflict(String detail) {
        return DemoResult.error(HttpStatus.CONFLICT, "version_conflict", detail);
    }

    private DemoResult list(Caller caller) {
        var certs = repository.get().certificates(scope(caller));
        var txs = repository.get().transactionsOf(certs.stream().map(LedgerRepository.Cert::id).toList()).stream()
            .collect(Collectors.groupingBy(LedgerRepository.Tx::certificateId));
        List<Map<String, Object>> rows = new ArrayList<>();
        for (var c : certs) {
            var list = txs.getOrDefault(c.id(), List.of());
            Map<String, Object> m = certificateMap(c, list);
            var last = list.isEmpty() ? null : list.get(list.size() - 1);
            m.put("lastTx", last == null ? null : txMap(last));
            rows.add(m);
        }
        return DemoResult.ok(Map.of("certificates", rows, "readOnly", !has(caller, WRITERS), "notice", LedgerNotice.TEXT));
    }

    private DemoResult explorer(Caller caller) {
        var txs = repository.get().explorer(scope(caller));
        return DemoResult.ok(Map.of("transactions", txs.stream().map(LedgerModule::txMap).toList(), "notice", LedgerNotice.TEXT));
    }

    private Map<String, Object> verification(UUID cert) {
        var check = LedgerStatus.verify(repository.get().chain(cert));
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("result", check.match() ? "MATCH" : "MISMATCH");
        m.put("firstBadSeq", check.firstBadSeq());
        m.put("detail", check.match() ? "Every hash was recomputed from the certificate fields and links to the one before it." : check.reason());
        m.put("transactions", repository.get().chain(cert).size());
        return m;
    }

    private Map<String, Object> detail(Caller caller, LedgerRepository.Cert c) {
        var txs = repository.get().transactionsOf(c.id());
        Map<String, Object> m = certificateMap(c, txs);
        m.put("transactions", txs.stream().map(LedgerModule::txMap).toList());
        m.put("events", repository.get().events(c.id()).stream().map(e -> {
            Map<String, Object> x = new LinkedHashMap<>();
            x.put("action", e.action());
            x.put("actor", e.actor());
            x.put("reason", e.reason());
            x.put("at", e.at().toString());
            x.put("seq", e.seq());
            x.put("kind", e.kind());
            return x;
        }).toList());
        m.put("verification", verification(c.id()));
        m.put("actions", actions(caller, txs));
        m.put("notice", LedgerNotice.TEXT);
        return m;
    }

    /** What this caller can do now. commit and fail are offered but flagged when the caller is the submitter (the screen explains). */
    private static List<Map<String, Object>> actions(Caller caller, List<LedgerRepository.Tx> txs) {
        List<Map<String, Object>> out = new ArrayList<>();
        if (!has(caller, WRITERS)) {
            return out;
        }
        var rules = txs.stream().map(LedgerRepository.Tx::rule).toList();
        String status = LedgerStatus.of(rules);
        var last = txs.isEmpty() ? null : txs.get(txs.size() - 1);
        if (status.equals("not_submitted")) {
            out.add(action("submit", true, null));
        }
        if (last != null && last.state().equals("pending")) {
            boolean same = caller.actingIdentities().contains(last.submittedById());
            String why = same ? "You submitted this transaction; a second person must commit or fail it." : null;
            out.add(action("commit", !same, why));
            out.add(action("fail", !same, why));
        }
        if (last != null && last.state().equals("failed")) {
            out.add(action("retry", true, null));
        }
        if ((status.equals("active") || status.equals("amended")) && last != null && last.state().equals("committed")) {
            out.add(action("amend", true, null));
            out.add(action("revoke", true, null));
        }
        return out;
    }

    private static Map<String, Object> action(String name, boolean allowed, String why) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("action", name);
        m.put("allowed", allowed);
        m.put("why", why);
        return m;
    }

    private static Map<String, Object> certificateMap(LedgerRepository.Cert c, List<LedgerRepository.Tx> txs) {
        var rules = txs.stream().map(LedgerRepository.Tx::rule).toList();
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("certificateId", c.id().toString());
        m.put("registrationId", c.registrationId());
        m.put("manufacturer", c.manufacturer());
        m.put("brandName", c.brandName());
        m.put("modelNumber", c.modelNumber());
        m.put("category", c.category());
        m.put("stars", c.stars());
        m.put("validFrom", c.validFrom().toString());
        m.put("validTo", c.validTo().toString());
        m.put("ledgerValidTo", c.effectiveValidTo().toString());
        m.put("ledgerStatus", LedgerStatus.of(rules));
        m.put("pendingKind", LedgerStatus.pendingKind(rules));
        return m;
    }

    private static Map<String, Object> txMap(LedgerRepository.Tx t) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", t.id().toString());
        m.put("certificateId", t.certificateId().toString());
        m.put("registrationId", t.registrationId());
        m.put("blockNo", t.blockNo());
        m.put("seq", t.seq());
        m.put("attempt", t.attempt());
        m.put("kind", t.kind());
        m.put("state", t.state());
        m.put("prevHash", t.prevHash());
        m.put("hash", t.hash());
        m.put("validTo", t.validTo().toString());
        m.put("reason", t.reason());
        m.put("failureReason", t.failureReason());
        m.put("submittedBy", t.submittedBy());
        m.put("decidedBy", t.decidedBy());
        m.put("seededNote", t.seededNote());
        m.put("createdAt", t.createdAt().toString());
        m.put("committedAt", t.committedAt() == null ? null : t.committedAt().toString());
        return m;
    }

    /** The text every ledger answer carries. */
    static final class LedgerNotice {
        static final String TEXT = "Simulated test network, not Hyperledger Fabric. A local demonstration on the owner's assumptions, not a BEE system.";

        private LedgerNotice() {
        }
    }
}
