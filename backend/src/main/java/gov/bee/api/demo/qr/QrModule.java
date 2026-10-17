package gov.bee.api.demo.qr;

import gov.bee.api.demo.DemoModule;
import gov.bee.api.demo.DemoResult;
import gov.bee.api.identity.Caller;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

/**
 * QR batches and serials for an approved model with a certificate (demo slice S2; a local demonstration on provisional rules, not BEE rules).
 * The manufacturer or agency of the application's organisation creates a batch, allocates serials, binds them to the certificate and voids them.
 * Programme, admin and auditor read every batch. Another organisation's batch is "not found", the same as an unknown id.
 */
@Component
public class QrModule implements DemoModule {

    static final long MAX_PER_CERTIFICATE = 100_000L;
    static final String REVOKED_MESSAGE = "This certificate is revoked on the simulated ledger: no new batches, serials or bindings.";
    static final Set<String> WRITERS = Set.of("manufacturer", "agency");
    static final Set<String> ALL_READERS = Set.of("programme", "admin", "auditor");
    static final int MAX_QUANTITY = 5000;
    static final int PAGE_DEFAULT = 50;
    static final int PAGE_MAX = 200;

    private final QrRepository repo;

    public QrModule(QrRepository repo) {
        this.repo = repo;
    }

    @Override
    public String name() {
        return "qr";
    }

    /** Writers are own-organisation roles (any scope is fine, the organisation is checked); the all-batch readers must hold their role for all records (BL-231). */
    private static boolean has(Caller c, Set<String> roles) {
        return roles == WRITERS ? gov.bee.api.demo.DemoAccess.holdsRole(c, roles) : gov.bee.api.demo.DemoAccess.holdsAll(c, roles);
    }

    private static UUID uuid(Object o) {
        try {
            return o == null ? null : UUID.fromString(o.toString());
        } catch (IllegalArgumentException e) {
            return null;
        }
    }

    @Override
    public DemoResult handle(Caller caller, String method, String id, String action, Map<String, String> query, Map<String, Object> body) {
        boolean writer = has(caller, WRITERS);
        boolean reader = writer || has(caller, ALL_READERS);
        if (!reader) {
            return DemoResult.denied();
        }
        if (id == null) {
            if ("GET".equals(method)) {
                return list(caller, writer);
            }
            return "POST".equals(method) ? create(caller, writer, body) : DemoResult.notFound();
        }
        UUID batchId = uuid(id);
        if (batchId == null) {
            return DemoResult.notFound();
        }
        var found = repo.batch(batchId);
        // Out of scope and unknown are the same answer.
        if (found.isEmpty() || !inScope(caller, writer, found.get())) {
            return DemoResult.notFound();
        }
        var batch = found.get();
        if ("GET".equals(method)) {
            return action == null ? detail(batch, query) : DemoResult.notFound();
        }
        if (!"POST".equals(method) || action == null) {
            return DemoResult.notFound();
        }
        if (!writer || !caller.organisationIds().contains(batch.organisationId())) {
            return DemoResult.denied();
        }
        return switch (action) {
            case "serials" -> allocate(caller, batch, body);
            case "bind" -> bind(caller, batch, body);
            case "void" -> voidOne(caller, batch, body);
            default -> DemoResult.notFound();
        };
    }

    private static boolean inScope(Caller c, boolean writer, QrRepository.Batch b) {
        if (has(c, ALL_READERS)) {
            return true;
        }
        return writer && c.organisationIds().contains(b.organisationId());
    }

    private DemoResult list(Caller caller, boolean writer) {
        List<QrRepository.Batch> rows = has(caller, ALL_READERS) ? repo.batches(null) : repo.batches(new ArrayList<>(caller.organisationIds()));
        List<Map<String, Object>> items = rows.stream().map(QrModule::summary).toList();
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("canWrite", writer);
        out.put("items", items);
        out.put("eligible", writer ? repo.eligible(new ArrayList<>(caller.organisationIds())) : List.of());
        return DemoResult.ok(out);
    }

    static Map<String, Object> summary(QrRepository.Batch b) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", b.id().toString());
        m.put("applicationId", b.applicationId().toString());
        m.put("reference", b.reference());
        m.put("brandName", b.brand());
        m.put("modelNumber", b.model());
        m.put("organisation", b.organisation());
        m.put("registrationId", b.registrationId());
        m.put("quantity", b.quantity());
        m.put("status", b.status());
        m.put("createdAt", b.createdAt().toInstant().toString());
        m.put("allocated", b.allocated());
        m.put("bound", b.bound());
        m.put("void", b.voided());
        m.put("remaining", b.quantity() - b.allocated() - b.bound() - b.voided());
        return m;
    }

    private DemoResult detail(QrRepository.Batch batch, Map<String, String> query) {
        int offset = number(query.get("offset"), 0, 0, Integer.MAX_VALUE);
        int limit = number(query.get("limit"), PAGE_DEFAULT, 1, PAGE_MAX);
        Map<String, Object> out = new LinkedHashMap<>(summary(batch));
        out.put("offset", offset);
        out.put("limit", limit);
        out.put("total", batch.allocated() + batch.bound() + batch.voided());
        out.put("serials", repo.serials(batch.id(), offset, limit));
        return DemoResult.ok(out);
    }

    private static int number(String s, int fallback, int min, int max) {
        try {
            return s == null ? fallback : Math.max(min, Math.min(max, Integer.parseInt(s.trim())));
        } catch (NumberFormatException e) {
            return fallback;
        }
    }

    private DemoResult create(Caller caller, boolean writer, Map<String, Object> body) {
        if (!writer) {
            return DemoResult.denied();
        }
        UUID appId = uuid(body.get("applicationId"));
        if (appId == null) {
            return DemoResult.invalid("Choose an approved model application.");
        }
        var app = repo.application(appId);
        if (app.isEmpty() || !caller.organisationIds().contains(app.get().organisationId())) {
            return DemoResult.notFound();
        }
        int quantity;
        if (body.get("quantity") instanceof Number n && n.doubleValue() == Math.rint(n.doubleValue())) {
            quantity = n.intValue();
        } else {
            return DemoResult.invalid("Quantity must be a whole number from 1 to " + MAX_QUANTITY + ".");
        }
        if (quantity < 1 || quantity > MAX_QUANTITY) {
            return DemoResult.invalid("Quantity must be from 1 to " + MAX_QUANTITY + ".");
        }
        if (!"approved".equals(app.get().state())) {
            return DemoResult.invalid("A batch is made only for an approved model application.");
        }
        var cert = repo.certificateOf(appId);
        if (cert.isEmpty()) {
            return DemoResult.invalid("The application has no issued certificate yet.");
        }
        if (repo.ledgerRevoked(cert.get())) {
            return DemoResult.error(HttpStatus.CONFLICT, "version_conflict", REVOKED_MESSAGE);
        }
        if (repo.quantityOfCertificate(cert.get()) + quantity > MAX_PER_CERTIFICATE) {
            return DemoResult.invalid("A certificate can have at most " + MAX_PER_CERTIFICATE + " serials in all its batches (the demonstration cap).");
        }
        UUID id = repo.createBatch(appId, cert.get(), app.get().organisationId(), quantity, caller.accountId());
        return DemoResult.created(summary(repo.batch(id).orElseThrow()));
    }

    private DemoResult allocate(Caller caller, QrRepository.Batch batch, Map<String, Object> body) {
        if (repo.ledgerRevoked(batch.certificateId())) {
            return DemoResult.error(HttpStatus.CONFLICT, "version_conflict", REVOKED_MESSAGE);
        }
        repo.lock(batch.id());
        int existing = repo.serialCount(batch.id());
        int remaining = batch.quantity() - existing;
        if (remaining <= 0) {
            return DemoResult.invalid("The batch already has all " + batch.quantity() + " serials.");
        }
        int count = remaining;
        if (body.get("count") != null) {
            if (!(body.get("count") instanceof Number n) || n.doubleValue() != Math.rint(n.doubleValue()) || n.intValue() < 1) {
                return DemoResult.invalid("Count must be a whole number of at least 1.");
            }
            if (n.intValue() > remaining) {
                return DemoResult.invalid("Only " + remaining + " serials remain in this batch (quantity " + batch.quantity() + ").");
            }
            count = n.intValue();
        }
        List<String> made = repo.allocate(batch.id(), batch.certificateId(), count, caller.accountId());
        if (existing + made.size() >= batch.quantity()) {
            repo.close(batch.id());
        }
        Map<String, Object> out = new LinkedHashMap<>(summary(repo.batch(batch.id()).orElseThrow()));
        out.put("newSerials", made.size() > 200 ? made.subList(0, 200) : made);
        out.put("newSerialCount", made.size());
        return DemoResult.created(out);
    }

    private DemoResult bind(Caller caller, QrRepository.Batch batch, Map<String, Object> body) {
        if (repo.ledgerRevoked(batch.certificateId())) {
            return DemoResult.error(HttpStatus.CONFLICT, "version_conflict", REVOKED_MESSAGE);
        }
        if (!(body.get("serials") instanceof List<?> raw) || raw.isEmpty() || raw.size() > MAX_QUANTITY) {
            return DemoResult.invalid("Give the serials to bind (1 to " + MAX_QUANTITY + ").");
        }
        List<String> serials = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        for (Object o : raw) {
            String s = o == null ? "" : o.toString().trim().toUpperCase(java.util.Locale.ROOT);
            if (!s.matches("^BEEQ-[0-9A-HJKMNP-TV-Z]{10}$")) {
                return DemoResult.invalid("Not a serial: " + (s.length() > 20 ? s.substring(0, 20) + "..." : s));
            }
            if (!seen.add(s)) {
                return DemoResult.invalid("Duplicate code blocked: " + s + " appears more than once in the request.");
            }
            serials.add(s);
        }
        repo.lock(batch.id());
        Map<String, String> states = repo.statesIn(batch.id(), serials);
        for (String s : serials) {
            String state = states.get(s);
            if (state == null) {
                return DemoResult.invalid(s + " is not a serial of this batch.");
            }
            if ("void".equals(state)) {
                return DemoResult.invalid(s + " is void and cannot be bound.");
            }
        }
        List<String> already = serials.stream().filter(s -> "bound".equals(states.get(s))).limit(20).toList();
        int changed = repo.bind(batch.id(), serials, caller.accountId());
        Map<String, Object> out = new LinkedHashMap<>(summary(repo.batch(batch.id()).orElseThrow()));
        out.put("newlyBound", changed);
        out.put("alreadyBound", serials.size() - changed);
        out.put("alreadyBoundSerials", already);
        return DemoResult.ok(out);
    }

    private DemoResult voidOne(Caller caller, QrRepository.Batch batch, Map<String, Object> body) {
        String serial = body.get("serial") == null ? "" : body.get("serial").toString().trim().toUpperCase(java.util.Locale.ROOT);
        String reason = body.get("reason") == null ? "" : body.get("reason").toString().trim();
        if (reason.isEmpty() || reason.length() > 200) {
            return DemoResult.invalid("Give a reason of 1 to 200 characters.");
        }
        repo.lock(batch.id());
        String state = repo.statesIn(batch.id(), List.of(serial)).get(serial);
        if (state == null) {
            return DemoResult.invalid(serial + " is not a serial of this batch.");
        }
        int changed = repo.voidSerial(batch.id(), serial, reason, caller.accountId());
        Map<String, Object> out = new LinkedHashMap<>(summary(repo.batch(batch.id()).orElseThrow()));
        out.put("voided", changed > 0);
        return DemoResult.ok(out);
    }
}
