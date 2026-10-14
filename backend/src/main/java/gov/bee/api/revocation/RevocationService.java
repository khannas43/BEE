package gov.bee.api.revocation;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import gov.bee.api.application.DraftRequestSupport;
import gov.bee.api.application.IdempotencyRepository;
import gov.bee.api.identity.Caller;
import gov.bee.api.revocation.RevocationRepository.Decided;
import gov.bee.api.revocation.RevocationRepository.NewProposal;
import gov.bee.api.revocation.RevocationRepository.Proposal;
import gov.bee.api.web.ApiErrors;
import java.security.MessageDigest;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.regex.Pattern;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.interceptor.TransactionAspectSupport;

/**
 * WP04.2b-2b: closing or revoking a registered brand or an agency authorisation takes two people. Provisional local rules, not BEE rules
 * (docs/wp04/WP04.2b_PLAN.md). A person who holds register_revoke_propose (Programme) proposes; a DIFFERENT person who holds
 * register_revoke_decide (the Director) approves or rejects; the proposer may withdraw. Approval changes the register in the same step.
 */
@Service
public class RevocationService {

    static final String PROPOSE_ROUTE = "/api/register-revocations";
    static final String DECIDE_ROUTE = "/api/register-revocations/{id}/decision";
    static final ZoneId INDIA = ZoneId.of("Asia/Kolkata");
    private static final Pattern DATE = Pattern.compile("^\\d{4}-\\d{2}-\\d{2}$");
    private static final Pattern TEXT_500 = Pattern.compile("^[^\\p{Cntrl}]{1,500}$");

    private final RevocationRepository repository;
    private final IdempotencyRepository idempotency;
    private final ObjectMapper json;

    public RevocationService(RevocationRepository repository, IdempotencyRepository idempotency, ObjectMapper json) {
        this.repository = repository;
        this.idempotency = idempotency;
        this.json = json;
    }

    private boolean holds(Caller caller, String capability) {
        var roles = repository.rolesHolding(capability);
        return caller.roles().stream().anyMatch(g -> roles.contains(g.role()) && "all".equals(g.scope()));
    }

    private boolean mayPropose(Caller caller) {
        return holds(caller, RevocationRepository.PROPOSE);
    }

    private boolean mayDecide(Caller caller) {
        return holds(caller, RevocationRepository.DECIDE);
    }

    private boolean mayRead(Caller caller) {
        return mayPropose(caller) || mayDecide(caller);
    }

    public ResponseEntity<Map<String, Object>> read(Caller caller) {
        if (!mayRead(caller)) {
            return error(HttpStatus.FORBIDDEN, "role_not_permitted");
        }
        List<Map<String, Object>> brands = new ArrayList<>();
        for (var b : repository.brands()) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", b.id().toString());
            m.put("name", b.name());
            m.put("owner", b.owner());
            m.put("status", b.status());
            m.put("source", b.source());
            brands.add(m);
        }
        List<Map<String, Object>> authorisations = new ArrayList<>();
        for (var a : repository.authorisations()) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", a.id().toString());
            m.put("brandId", a.brandId().toString());
            m.put("brandName", a.brandName());
            m.put("agency", a.agency());
            m.put("principal", a.principal());
            m.put("validFrom", a.validFrom().toString());
            m.put("validTo", a.validTo() == null ? null : a.validTo().toString());
            m.put("status", a.status());
            m.put("source", a.source());
            authorisations.add(m);
        }
        List<Map<String, Object>> pending = new ArrayList<>();
        repository.pending().forEach(p -> pending.add(view(p, caller)));
        List<Map<String, Object>> decided = new ArrayList<>();
        repository.recentDecided(20).forEach(p -> decided.add(view(p, caller)));
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("today", LocalDate.now(INDIA).toString());
        out.put("canPropose", mayPropose(caller));
        out.put("canDecide", mayDecide(caller));
        out.put("brands", brands);
        out.put("authorisations", authorisations);
        out.put("pending", pending);
        out.put("decided", decided);
        return ResponseEntity.ok(out);
    }

    @Transactional
    public ResponseEntity<Map<String, Object>> propose(Caller caller, String key, JsonNode body) {
        Optional<ResponseEntity<Map<String, Object>>> replay = replayOrRequireKey(caller, PROPOSE_ROUTE, IdempotencyRepository.CREATE_TARGET, key, body);
        if (replay.isPresent()) {
            return replay.get();
        }
        if (!mayPropose(caller)) {
            return error(HttpStatus.FORBIDDEN, "role_not_permitted");
        }
        Optional<Parsed> parsed = parsePropose(body, LocalDate.now(INDIA));
        if (parsed.isEmpty()) {
            return error(HttpStatus.UNPROCESSABLE_ENTITY, "validation_failed");
        }
        Parsed in = parsed.get();
        UUID target = in.targetId();
        repository.lockTarget(target);
        boolean brand = "brand".equals(in.kind());
        if (brand ? repository.brand(target).isEmpty() : repository.authorisation(target).isEmpty()) {
            return error(HttpStatus.NOT_FOUND, "not_found");
        }
        if (brand ? !"active".equals(repository.brand(target).get().status()) : !activeAuthorisationFits(repository.authorisation(target).get(), in)) {
            return error(HttpStatus.CONFLICT, "target_not_active");
        }
        if (repository.hasPending(brand ? target : null, brand ? null : target)) {
            return error(HttpStatus.CONFLICT, "revocation_pending");
        }
        if (!idempotency.begin(caller.accountId(), "POST", PROPOSE_ROUTE, IdempotencyRepository.CREATE_TARGET, key, DraftRequestSupport.bodyHash(body))) {
            return error(HttpStatus.CONFLICT, "idempotency_in_progress");
        }
        Proposal saved;
        try {
            saved = repository.insert(caller.accountId(), new NewProposal(brand ? target : null, brand ? null : target, in.action(), in.closeOn(), in.reason()));
        } catch (DataIntegrityViolationException e) {
            TransactionAspectSupport.currentTransactionStatus().setRollbackOnly();
            return error(HttpStatus.CONFLICT, "revocation_pending");
        }
        Map<String, Object> view = view(saved, caller);
        idempotency.complete(caller.accountId(), "POST", PROPOSE_ROUTE, IdempotencyRepository.CREATE_TARGET, key, 201, write(view), 0);
        return ResponseEntity.status(HttpStatus.CREATED).body(view);
    }

    @Transactional
    public ResponseEntity<Map<String, Object>> decide(Caller caller, UUID proposalId, String key, JsonNode body) {
        Optional<ResponseEntity<Map<String, Object>>> replay = replayOrRequireKey(caller, DECIDE_ROUTE, proposalId, key, body);
        if (replay.isPresent()) {
            return replay.get();
        }
        if (!mayRead(caller)) {
            return error(HttpStatus.FORBIDDEN, "role_not_permitted");
        }
        if (repository.proposal(proposalId).isEmpty()) {
            return error(HttpStatus.NOT_FOUND, "not_found");
        }
        if (body == null || !body.isObject() || !body.hasNonNull("decision") || !body.get("decision").isTextual()
            || !List.of("approve", "reject", "withdraw").contains(body.get("decision").asText())) {
            return error(HttpStatus.UNPROCESSABLE_ENTITY, "validation_failed");
        }
        String decision = body.get("decision").asText();
        if ("withdraw".equals(decision) ? !mayPropose(caller) : !mayDecide(caller)) {
            return error(HttpStatus.FORBIDDEN, "role_not_permitted");
        }
        String note = null;
        if (body.hasNonNull("note")) {
            if (!body.get("note").isTextual() || !TEXT_500.matcher(body.get("note").asText().trim()).matches()) {
                return error(HttpStatus.UNPROCESSABLE_ENTITY, "validation_failed");
            }
            note = body.get("note").asText().trim();
        }
        if (("reject".equals(decision)) && note == null) {
            return error(HttpStatus.UNPROCESSABLE_ENTITY, "validation_failed");
        }
        if (!idempotency.begin(caller.accountId(), "POST", DECIDE_ROUTE, proposalId, key, DraftRequestSupport.bodyHash(body))) {
            return error(HttpStatus.CONFLICT, "idempotency_in_progress");
        }
        Decided done = repository.decide(proposalId, caller.accountId(), decision, note);
        if (done.outcome() != RevocationRepository.Outcome.DONE) {
            idempotency.abandon(caller.accountId(), "POST", DECIDE_ROUTE, proposalId, key);
            return switch (done.outcome()) {
                case NOT_FOUND -> error(HttpStatus.NOT_FOUND, "not_found");
                case NOT_PENDING -> error(HttpStatus.CONFLICT, "proposal_not_pending");
                case SAME_PERSON -> error(HttpStatus.FORBIDDEN, "segregation_refused");
                case DATE_PASSED -> error(HttpStatus.CONFLICT, "closing_date_passed");
                case RULE_CONFLICT -> error(HttpStatus.CONFLICT, "target_not_active");
                default -> error(HttpStatus.FORBIDDEN, "role_not_permitted");
            };
        }
        Map<String, Object> view = view(repository.proposal(proposalId).orElseThrow(), caller);
        idempotency.complete(caller.accountId(), "POST", DECIDE_ROUTE, proposalId, key, 200, write(view), 0);
        return ResponseEntity.ok(view);
    }

    private record Parsed(String kind, UUID targetId, String action, LocalDate closeOn, String reason) {
    }

    /** targetKind (brand | authorisation), targetId, action (revoke | close), closeOn (close only), reason. */
    private Optional<Parsed> parsePropose(JsonNode b, LocalDate today) {
        if (b == null || !b.isObject() || !text(b, "targetKind") || !text(b, "targetId") || !text(b, "action") || !text(b, "reason")) {
            return Optional.empty();
        }
        String kind = b.get("targetKind").asText();
        String action = b.get("action").asText();
        String reason = b.get("reason").asText().trim();
        if (!List.of("brand", "authorisation").contains(kind) || !List.of("revoke", "close").contains(action) || !TEXT_500.matcher(reason).matches()
            || ("brand".equals(kind) && !"revoke".equals(action))) {
            return Optional.empty();
        }
        UUID target;
        try {
            target = UUID.fromString(b.get("targetId").asText());
        } catch (IllegalArgumentException e) {
            return Optional.empty();
        }
        LocalDate closeOn = null;
        if ("close".equals(action)) {
            if (!text(b, "closeOn") || !DATE.matcher(b.get("closeOn").asText()).matches()) {
                return Optional.empty();
            }
            try {
                closeOn = LocalDate.parse(b.get("closeOn").asText());
            } catch (Exception e) {
                return Optional.empty();
            }
            if (closeOn.isBefore(today)) {
                return Optional.empty();
            }
        } else if (b.hasNonNull("closeOn")) {
            return Optional.empty();
        }
        return Optional.of(new Parsed(kind, target, action, closeOn, reason));
    }

    private static boolean activeAuthorisationFits(RevocationRepository.AuthorisationEntry a, Parsed in) {
        if (!"active".equals(a.status())) {
            return false;
        }
        return !"close".equals(in.action()) || (in.closeOn().isAfter(a.validFrom()) && (a.validTo() == null || in.closeOn().isBefore(a.validTo())));
    }

    private static boolean text(JsonNode b, String field) {
        return b.hasNonNull(field) && b.get(field).isTextual();
    }

    private Map<String, Object> view(Proposal p, Caller caller) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", p.id().toString());
        m.put("targetKind", p.targetKind());
        m.put("targetId", p.targetId().toString());
        m.put("targetLabel", p.targetLabel());
        m.put("action", p.action());
        m.put("closeOn", p.closeOn() == null ? null : p.closeOn().toString());
        m.put("reason", p.reason());
        m.put("state", p.state());
        m.put("proposedBy", p.proposedBy());
        m.put("proposedByYou", p.proposedById().equals(caller.accountId()));
        m.put("proposedAt", p.proposedAt().toString());
        m.put("decidedBy", p.decidedBy());
        m.put("decidedAt", p.decidedAt() == null ? null : p.decidedAt().toString());
        m.put("decisionNote", p.decisionNote());
        return m;
    }

    private Optional<ResponseEntity<Map<String, Object>>> replayOrRequireKey(Caller caller, String route, UUID target, String key, JsonNode body) {
        if (key == null || !DraftRequestSupport.IDEMPOTENCY_KEY.matcher(key).matches()) {
            return Optional.of(error(HttpStatus.UNPROCESSABLE_ENTITY, "idempotency_key_required"));
        }
        var stored = idempotency.find(caller.accountId(), "POST", route, target, key);
        if (stored.isEmpty()) {
            return Optional.empty();
        }
        var s = stored.get();
        if (s.inProgress()) {
            return Optional.of(error(HttpStatus.CONFLICT, "idempotency_in_progress"));
        }
        Optional<byte[]> prior = idempotency.bodyHash(caller.accountId(), "POST", route, target, key);
        if (prior.isEmpty() || !MessageDigest.isEqual(prior.get(), DraftRequestSupport.bodyHash(body))) {
            return Optional.of(error(HttpStatus.CONFLICT, "idempotency_key_conflict"));
        }
        if (!mayRead(caller)) {
            return Optional.of(error(HttpStatus.FORBIDDEN, "role_not_permitted"));
        }
        try {
            @SuppressWarnings("unchecked")
            Map<String, Object> replayBody = json.readValue(s.responseBody(), Map.class);
            return Optional.of(ResponseEntity.status(s.responseStatus()).header("Idempotency-Replayed", "true").body(replayBody));
        } catch (Exception e) {
            return Optional.of(error(HttpStatus.INTERNAL_SERVER_ERROR, "internal_error"));
        }
    }

    private String write(Map<String, Object> view) {
        try {
            return json.writeValueAsString(view);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private static ResponseEntity<Map<String, Object>> error(HttpStatus status, String code) {
        return ApiErrors.response(status, code);
    }
}
