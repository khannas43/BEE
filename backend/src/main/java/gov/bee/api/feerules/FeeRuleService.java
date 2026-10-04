package gov.bee.api.feerules;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import gov.bee.api.application.DraftRequestSupport;
import gov.bee.api.application.IdempotencyRepository;
import gov.bee.api.feerules.FeeRuleRepository.Decided;
import gov.bee.api.feerules.FeeRuleRepository.NewProposal;
import gov.bee.api.feerules.FeeRuleRepository.Proposal;
import gov.bee.api.feerules.FeeRuleRepository.Version;
import gov.bee.api.identity.Caller;
import gov.bee.api.web.ApiErrors;
import java.math.BigDecimal;
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
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Fee-rule administration (owner's assumptions A1 and C1, not BEE's decisions). A person who holds the fee_rule_manage
 * capability (the Administrator today; the capability can be given to another role by a database row) proposes a fee rule from
 * a date that is not in the past, and a DIFFERENT person who holds it approves or rejects. The proposer may withdraw their own
 * pending proposal. Approval closes the rule in force and starts the new one in one step, and nothing that already has a fee
 * changes: an application keeps the fee captured when it was submitted.
 */
@Service
public class FeeRuleService {

    static final String PROPOSE_ROUTE = "/api/fee-rules/proposals";
    static final String DECIDE_ROUTE = "/api/fee-rules/proposals/{id}/decision";
    static final ZoneId INDIA = ZoneId.of("Asia/Kolkata");
    private static final Pattern CATEGORY = Pattern.compile("^[A-Z]{2,10}$");
    private static final Pattern TYPE = Pattern.compile("^[a-z_]{2,40}$");
    private static final Pattern MONEY = Pattern.compile("^\\d{1,10}(\\.\\d{1,2})?$");
    private static final Pattern PERCENT = Pattern.compile("^\\d{1,3}(\\.\\d{1,2})?$");
    private static final Pattern DATE = Pattern.compile("^\\d{4}-\\d{2}-\\d{2}$");
    private static final Pattern TEXT_300 = Pattern.compile("^[^\\p{Cntrl}]{1,300}$");
    private static final Pattern TEXT_500 = Pattern.compile("^[^\\p{Cntrl}]{1,500}$");

    private final FeeRuleRepository repository;
    private final IdempotencyRepository idempotency;
    private final ObjectMapper json;

    public FeeRuleService(FeeRuleRepository repository, IdempotencyRepository idempotency, ObjectMapper json) {
        this.repository = repository;
        this.idempotency = idempotency;
        this.json = json;
    }

    private boolean mayManage(Caller caller) {
        var roles = repository.rolesHolding(FeeRuleRepository.CAPABILITY);
        return caller.roles().stream().anyMatch(g -> roles.contains(g.role()));
    }

    public ResponseEntity<Map<String, Object>> read(Caller caller) {
        if (!mayManage(caller)) {
            return error(HttpStatus.FORBIDDEN, "role_not_permitted");
        }
        LocalDate today = LocalDate.now(INDIA);
        Map<String, List<Map<String, Object>>> byKey = new LinkedHashMap<>();
        Map<String, Version> sample = new LinkedHashMap<>();
        for (Version v : repository.versions()) {
            sample.putIfAbsent(v.ruleKey(), v);
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("version", v.version());
            m.put("effectiveFrom", v.effectiveFrom().toString());
            m.put("effectiveTo", v.effectiveTo() == null ? null : v.effectiveTo().toString());
            m.put("amountInr", v.amountInr().toPlainString());
            m.put("taxRatePercent", v.taxRatePercent().toPlainString());
            m.put("verification", v.verification());
            m.put("source", v.source());
            boolean inForce = !v.effectiveFrom().isAfter(today) && (v.effectiveTo() == null || v.effectiveTo().isAfter(today));
            m.put("inForce", inForce);
            byKey.computeIfAbsent(v.ruleKey(), k -> new ArrayList<>()).add(m);
        }
        List<Map<String, Object>> rules = new ArrayList<>();
        byKey.forEach((key, versions) -> {
            Version s = sample.get(key);
            Map<String, Object> r = new LinkedHashMap<>();
            r.put("ruleKey", key);
            r.put("categoryCode", s.categoryCode());
            r.put("applicationType", s.applicationType());
            r.put("versions", versions);
            rules.add(r);
        });
        List<Map<String, Object>> pending = new ArrayList<>();
        repository.pending().forEach(p -> pending.add(proposalView(p, caller)));
        List<Map<String, Object>> decided = new ArrayList<>();
        repository.recentDecided(20).forEach(p -> decided.add(proposalView(p, caller)));
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("today", today.toString());
        out.put("applicationTypes", repository.applicationTypes().stream().map(t -> Map.of("code", t.code(), "label", t.label())).toList());
        out.put("categories", repository.categoriesOn(today).stream().map(c -> Map.of("code", c.code(), "name", c.name())).toList());
        out.put("rules", rules);
        out.put("pending", pending);
        out.put("decided", decided);
        return ResponseEntity.ok(out);
    }

    @Transactional
    public ResponseEntity<Map<String, Object>> propose(Caller caller, String idempotencyKey, JsonNode body) {
        Optional<ResponseEntity<Map<String, Object>>> replay = replayOrRequireKey(caller, PROPOSE_ROUTE, IdempotencyRepository.CREATE_TARGET, idempotencyKey, body);
        if (replay.isPresent()) {
            return replay.get();
        }
        if (!mayManage(caller)) {
            return error(HttpStatus.FORBIDDEN, "role_not_permitted");
        }
        LocalDate today = LocalDate.now(INDIA);
        Optional<NewProposal> input = parsePropose(body, today);
        if (input.isEmpty() || !repository.applicationTypeExists(input.get().applicationType())
            || !repository.categoryAppliesOn(input.get().categoryCode(), input.get().effectiveFrom())) {
            return error(HttpStatus.UNPROCESSABLE_ENTITY, "validation_failed");
        }
        if (!idempotency.begin(caller.accountId(), "POST", PROPOSE_ROUTE, IdempotencyRepository.CREATE_TARGET, idempotencyKey, DraftRequestSupport.bodyHash(body))) {
            return error(HttpStatus.CONFLICT, "idempotency_in_progress");
        }
        Proposal saved = repository.insert(caller.accountId(), input.get());
        Map<String, Object> view = proposalView(saved, caller);
        idempotency.complete(caller.accountId(), "POST", PROPOSE_ROUTE, IdempotencyRepository.CREATE_TARGET, idempotencyKey, 201, writeJson(view), 0);
        return ResponseEntity.status(HttpStatus.CREATED).body(view);
    }

    @Transactional
    public ResponseEntity<Map<String, Object>> decide(Caller caller, UUID proposalId, String idempotencyKey, JsonNode body) {
        Optional<ResponseEntity<Map<String, Object>>> replay = replayOrRequireKey(caller, DECIDE_ROUTE, proposalId, idempotencyKey, body);
        if (replay.isPresent()) {
            return replay.get();
        }
        if (!mayManage(caller)) {
            return error(HttpStatus.FORBIDDEN, "role_not_permitted");
        }
        if (repository.proposal(proposalId).isEmpty()) {
            return error(HttpStatus.NOT_FOUND, "not_found");
        }
        if (body == null || !body.isObject() || !body.hasNonNull("decision") || !body.get("decision").isTextual()
            || !List.of("approve", "reject", "withdraw").contains(body.get("decision").asText())) {
            return error(HttpStatus.UNPROCESSABLE_ENTITY, "validation_failed");
        }
        String note = null;
        if (body.hasNonNull("note")) {
            if (!body.get("note").isTextual() || !TEXT_500.matcher(body.get("note").asText().trim()).matches()) {
                return error(HttpStatus.UNPROCESSABLE_ENTITY, "validation_failed");
            }
            note = body.get("note").asText().trim();
        }
        if (!idempotency.begin(caller.accountId(), "POST", DECIDE_ROUTE, proposalId, idempotencyKey, DraftRequestSupport.bodyHash(body))) {
            return error(HttpStatus.CONFLICT, "idempotency_in_progress");
        }
        Decided done = repository.decide(proposalId, caller.accountId(), body.get("decision").asText(), note);
        if (done.outcome() != FeeRuleRepository.Outcome.DONE) {
            idempotency.abandon(caller.accountId(), "POST", DECIDE_ROUTE, proposalId, idempotencyKey);
            return switch (done.outcome()) {
                case NOT_FOUND -> error(HttpStatus.NOT_FOUND, "not_found");
                case NOT_PENDING -> error(HttpStatus.CONFLICT, "proposal_not_pending");
                case SAME_PERSON -> error(HttpStatus.FORBIDDEN, "segregation_refused");
                case DATE_PASSED -> error(HttpStatus.CONFLICT, "effective_date_passed");
                case RULE_CONFLICT -> error(HttpStatus.CONFLICT, "rule_conflict");
                default -> error(HttpStatus.FORBIDDEN, "role_not_permitted");
            };
        }
        Map<String, Object> view = proposalView(repository.proposal(proposalId).orElseThrow(), caller);
        idempotency.complete(caller.accountId(), "POST", DECIDE_ROUTE, proposalId, idempotencyKey, 200, writeJson(view), 0);
        return ResponseEntity.ok(view);
    }

    /** categoryCode, applicationType, amountInr and taxRatePercent as plain decimal strings, effectiveFrom as a date not before today. */
    private static Optional<NewProposal> parsePropose(JsonNode b, LocalDate today) {
        if (b == null || !b.isObject() || !text(b, "categoryCode") || !text(b, "applicationType") || !text(b, "amountInr")
            || !text(b, "effectiveFrom") || !text(b, "sourceReference") || !text(b, "reason")) {
            return Optional.empty();
        }
        String tax = "0";
        if (b.hasNonNull("taxRatePercent")) {
            if (!b.get("taxRatePercent").isTextual()) {
                return Optional.empty();
            }
            tax = b.get("taxRatePercent").asText().trim();
        }
        String category = b.get("categoryCode").asText().trim();
        String type = b.get("applicationType").asText().trim();
        String amount = b.get("amountInr").asText().trim();
        String date = b.get("effectiveFrom").asText().trim();
        String source = b.get("sourceReference").asText().trim();
        String reason = b.get("reason").asText().trim();
        if (!CATEGORY.matcher(category).matches() || !TYPE.matcher(type).matches() || !MONEY.matcher(amount).matches()
            || !PERCENT.matcher(tax).matches() || !DATE.matcher(date).matches() || !TEXT_300.matcher(source).matches() || !TEXT_500.matcher(reason).matches()) {
            return Optional.empty();
        }
        LocalDate from;
        try {
            from = LocalDate.parse(date);
        } catch (Exception e) {
            return Optional.empty();
        }
        BigDecimal rate = new BigDecimal(tax);
        if (from.isBefore(today) || rate.compareTo(BigDecimal.valueOf(100)) > 0) {
            return Optional.empty();
        }
        return Optional.of(new NewProposal(category, type, new BigDecimal(amount), rate, from, source, reason));
    }

    private static boolean text(JsonNode b, String field) {
        return b.hasNonNull(field) && b.get(field).isTextual();
    }

    private static Map<String, Object> proposalView(Proposal p, Caller caller) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", p.id().toString());
        m.put("ruleKey", p.categoryCode() + ":" + p.applicationType());
        m.put("categoryCode", p.categoryCode());
        m.put("applicationType", p.applicationType());
        m.put("amountInr", p.amountInr().toPlainString());
        m.put("taxRatePercent", p.taxRatePercent().toPlainString());
        m.put("effectiveFrom", p.effectiveFrom().toString());
        m.put("sourceReference", p.sourceReference());
        m.put("reason", p.reason());
        m.put("state", p.state());
        m.put("proposedBy", p.proposedBy());
        m.put("proposedByYou", p.proposedById().equals(caller.accountId()));
        m.put("proposedAt", p.proposedAt().toString());
        m.put("decidedBy", p.decidedBy());
        m.put("decidedAt", p.decidedAt() == null ? null : p.decidedAt().toString());
        m.put("decisionNote", p.decisionNote());
        m.put("appliedVersion", p.appliedVersion());
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
        Optional<byte[]> priorHash = idempotency.bodyHash(caller.accountId(), "POST", route, target, key);
        if (priorHash.isEmpty() || !MessageDigest.isEqual(priorHash.get(), DraftRequestSupport.bodyHash(body))) {
            return Optional.of(error(HttpStatus.CONFLICT, "idempotency_key_conflict"));
        }
        if (!mayManage(caller)) {
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

    private String writeJson(Map<String, Object> view) {
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
