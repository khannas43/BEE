package gov.bee.api.delegation;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import gov.bee.api.application.DraftRequestSupport;
import gov.bee.api.application.IdempotencyRepository;
import gov.bee.api.delegation.DelegationRepository.Colleague;
import gov.bee.api.delegation.DelegationRepository.Decided;
import gov.bee.api.delegation.DelegationRepository.Delegation;
import gov.bee.api.delegation.DelegationRepository.NewDelegation;
import gov.bee.api.identity.Caller;
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
 * WP02.4c: delegation of a stage role. Provisional local rules, not BEE rules (docs/wp02/WP02.4_DELEGATION.md). A person who holds programme,
 * director or finance for all records asks to delegate it to a colleague for at most 30 days; a DIFFERENT person who holds delegation_approve
 * (the Administrator) approves, and is neither the delegator nor the delegate; the delegator may withdraw a request and revoke an approved
 * delegation, and an approver may revoke one. The Secretary's final approval, administrative roles and registration review cannot be delegated.
 */
@Service
public class DelegationService {

    static final String PROPOSE_ROUTE = "/api/delegations";
    static final String DECIDE_ROUTE = "/api/delegations/{id}/decision";
    static final ZoneId INDIA = ZoneId.of("Asia/Kolkata");
    private static final Pattern DATE = Pattern.compile("^\\d{4}-\\d{2}-\\d{2}$");
    private static final Pattern TEXT_500 = Pattern.compile("^[^\\p{Cntrl}]{1,500}$");

    private final DelegationRepository repository;
    private final IdempotencyRepository idempotency;
    private final ObjectMapper json;

    public DelegationService(DelegationRepository repository, IdempotencyRepository idempotency, ObjectMapper json) {
        this.repository = repository;
        this.idempotency = idempotency;
        this.json = json;
    }

    private boolean mayApprove(Caller caller) {
        var roles = repository.rolesHolding(DelegationRepository.APPROVE);
        return caller.ownRoles().stream().anyMatch(g -> roles.contains(g.role()) && "all".equals(g.scope()));
    }

    /** The roles this caller can delegate: delegable and held through their own assignment. */
    private List<String> delegableRoles(Caller caller) {
        // A person who holds a second stage role would act at one stage while the delegate acts for them at the other: they cannot delegate.
        long stageRoles = caller.ownRoles().stream().map(g -> g.role()).filter(DelegationRepository.STAGE_ROLES::contains).distinct().count();
        if (stageRoles != 1) {
            return List.of();
        }
        return DelegationRepository.DELEGABLE.stream().sorted().filter(r -> caller.holdsOwn(r, "all")).toList();
    }

    public ResponseEntity<Map<String, Object>> read(Caller caller) {
        LocalDate today = LocalDate.now(INDIA);
        boolean approver = mayApprove(caller);
        List<String> mine = delegableRoles(caller);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("today", today.toString());
        out.put("canApprove", approver);
        out.put("delegableRoles", mine);
        List<Map<String, Object>> colleagues = new ArrayList<>();
        if (!mine.isEmpty()) {
            for (Colleague c : repository.colleagues(caller.accountId())) {
                Map<String, Object> m = new LinkedHashMap<>();
                m.put("id", c.id().toString());
                m.put("displayName", c.displayName());
                m.put("roles", c.roles());
                colleagues.add(m);
            }
        }
        out.put("colleagues", colleagues);
        List<Map<String, Object>> own = new ArrayList<>();
        repository.forPerson(caller.accountId(), today).forEach(d -> own.add(view(d, caller)));
        out.put("mine", own);
        List<Map<String, Object>> pending = new ArrayList<>();
        List<Map<String, Object>> decided = new ArrayList<>();
        if (approver) {
            repository.pending(today).forEach(d -> pending.add(view(d, caller)));
            repository.recent(today, 20).forEach(d -> decided.add(view(d, caller)));
        }
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
        if (delegableRoles(caller).isEmpty()) {
            return error(HttpStatus.FORBIDDEN, "role_not_permitted");
        }
        LocalDate today = LocalDate.now(INDIA);
        Optional<NewDelegation> parsed = parse(body, today);
        if (parsed.isEmpty() || parsed.get().delegateId().equals(caller.accountId())) {
            return error(HttpStatus.UNPROCESSABLE_ENTITY, "validation_failed");
        }
        NewDelegation in = parsed.get();
        if (!delegableRoles(caller).contains(in.role())) {
            return error(HttpStatus.FORBIDDEN, "role_not_permitted");
        }
        if (!repository.accountExists(in.delegateId())) {
            return error(HttpStatus.NOT_FOUND, "not_found");
        }
        if (repository.colleagues(caller.accountId()).stream().noneMatch(c -> c.id().equals(in.delegateId()))) {
            return error(HttpStatus.CONFLICT, "delegate_not_eligible");
        }
        if (!idempotency.begin(caller.accountId(), "POST", PROPOSE_ROUTE, IdempotencyRepository.CREATE_TARGET, key, DraftRequestSupport.bodyHash(body))) {
            return error(HttpStatus.CONFLICT, "idempotency_in_progress");
        }
        Delegation saved;
        try {
            saved = repository.insert(caller.accountId(), in, today);
        } catch (DataIntegrityViolationException e) {
            String why = String.valueOf(e.getMostSpecificCause().getMessage());
            if (!why.contains("delegation_open")) {
                throw e;
            }
            try {
                TransactionAspectSupport.currentTransactionStatus().setRollbackOnly();
            } catch (org.springframework.transaction.NoTransactionException none) {
                // not inside a transaction (a test double); nothing to roll back
            }
            return error(HttpStatus.CONFLICT, "delegation_exists");
        }
        Map<String, Object> view = view(saved, caller);
        idempotency.complete(caller.accountId(), "POST", PROPOSE_ROUTE, IdempotencyRepository.CREATE_TARGET, key, 201, write(view), 0);
        return ResponseEntity.status(HttpStatus.CREATED).body(view);
    }

    @Transactional
    public ResponseEntity<Map<String, Object>> decide(Caller caller, UUID id, String key, JsonNode body) {
        Optional<ResponseEntity<Map<String, Object>>> replay = replayOrRequireKey(caller, DECIDE_ROUTE, id, key, body);
        if (replay.isPresent()) {
            return replay.get();
        }
        LocalDate today = LocalDate.now(INDIA);
        Optional<Delegation> found = repository.find(id, today);
        if (found.isEmpty()) {
            return error(HttpStatus.NOT_FOUND, "not_found");
        }
        boolean delegator = found.get().delegatorId().equals(caller.accountId());
        boolean approver = mayApprove(caller);
        if (!delegator && !approver) {
            return error(HttpStatus.FORBIDDEN, "role_not_permitted");
        }
        if (body == null || !body.isObject() || !body.hasNonNull("decision") || !body.get("decision").isTextual()
            || !List.of("approve", "reject", "withdraw", "revoke").contains(body.get("decision").asText())) {
            return error(HttpStatus.UNPROCESSABLE_ENTITY, "validation_failed");
        }
        String decision = body.get("decision").asText();
        String note = null;
        if (body.hasNonNull("note")) {
            if (!body.get("note").isTextual() || !TEXT_500.matcher(body.get("note").asText().trim()).matches()) {
                return error(HttpStatus.UNPROCESSABLE_ENTITY, "validation_failed");
            }
            note = body.get("note").asText().trim();
        }
        if ("reject".equals(decision) && note == null) {
            return error(HttpStatus.UNPROCESSABLE_ENTITY, "validation_failed");
        }
        boolean allowed = switch (decision) {
            case "withdraw" -> delegator;
            case "revoke" -> delegator || approver;
            default -> approver;
        };
        if (!allowed) {
            return error(HttpStatus.FORBIDDEN, "role_not_permitted");
        }
        if (!idempotency.begin(caller.accountId(), "POST", DECIDE_ROUTE, id, key, DraftRequestSupport.bodyHash(body))) {
            return error(HttpStatus.CONFLICT, "idempotency_in_progress");
        }
        Decided done = repository.decide(id, caller.accountId(), decision, note);
        if (done.outcome() != DelegationRepository.Outcome.DONE) {
            idempotency.abandon(caller.accountId(), "POST", DECIDE_ROUTE, id, key);
            return switch (done.outcome()) {
                case NOT_FOUND -> error(HttpStatus.NOT_FOUND, "not_found");
                case NOT_PENDING -> error(HttpStatus.CONFLICT, "proposal_not_pending");
                case NOT_ACTIVE -> error(HttpStatus.CONFLICT, "delegation_not_active");
                case SAME_PERSON -> error(HttpStatus.FORBIDDEN, "segregation_refused");
                case DATE_PASSED -> error(HttpStatus.CONFLICT, "effective_date_passed");
                case NOT_ELIGIBLE -> error(HttpStatus.CONFLICT, "delegate_not_eligible");
                default -> error(HttpStatus.FORBIDDEN, "role_not_permitted");
            };
        }
        Map<String, Object> view = view(repository.find(id, today).orElseThrow(), caller);
        idempotency.complete(caller.accountId(), "POST", DECIDE_ROUTE, id, key, 200, write(view), 0);
        return ResponseEntity.ok(view);
    }

    /** delegateId, role, validFrom (not before today), validTo (after the start, at most 30 days later), reason. */
    private Optional<NewDelegation> parse(JsonNode b, LocalDate today) {
        if (b == null || !b.isObject() || !text(b, "delegateId") || !text(b, "role") || !text(b, "validFrom") || !text(b, "validTo") || !text(b, "reason")) {
            return Optional.empty();
        }
        String role = b.get("role").asText();
        String reason = b.get("reason").asText().trim();
        if (!DelegationRepository.DELEGABLE.contains(role) || !TEXT_500.matcher(reason).matches() || !DATE.matcher(b.get("validFrom").asText()).matches()
            || !DATE.matcher(b.get("validTo").asText()).matches()) {
            return Optional.empty();
        }
        try {
            UUID delegate = UUID.fromString(b.get("delegateId").asText());
            LocalDate from = LocalDate.parse(b.get("validFrom").asText());
            LocalDate to = LocalDate.parse(b.get("validTo").asText());
            if (from.isBefore(today) || !to.isAfter(from) || from.plusDays(30).isBefore(to)) {
                return Optional.empty();
            }
            return Optional.of(new NewDelegation(delegate, role, from, to, reason));
        } catch (RuntimeException e) {
            return Optional.empty();
        }
    }

    private static boolean text(JsonNode b, String field) {
        return b.hasNonNull(field) && b.get(field).isTextual();
    }

    private Map<String, Object> view(Delegation d, Caller caller) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", d.id().toString());
        m.put("delegator", d.delegator());
        m.put("delegate", d.delegate());
        m.put("role", d.role());
        m.put("reason", d.reason());
        m.put("validFrom", d.validFrom().toString());
        m.put("validTo", d.validTo().toString());
        m.put("state", d.state());
        m.put("inForce", d.holdsNow());
        m.put("asDelegator", d.delegatorId().equals(caller.accountId()));
        m.put("asDelegate", d.delegateId().equals(caller.accountId()));
        m.put("requestedAt", d.requestedAt().toString());
        m.put("decidedBy", d.decidedBy());
        m.put("decidedAt", d.decidedAt() == null ? null : d.decidedAt().toString());
        m.put("decisionNote", d.decisionNote());
        m.put("revokedBy", d.revokedBy());
        m.put("revokedAt", d.revokedAt() == null ? null : d.revokedAt().toString());
        m.put("revokeNote", d.revokeNote());
        m.put("uses", d.uses());
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
