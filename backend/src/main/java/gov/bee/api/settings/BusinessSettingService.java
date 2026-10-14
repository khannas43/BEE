package gov.bee.api.settings;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import gov.bee.api.application.DraftRequestSupport;
import gov.bee.api.application.IdempotencyRepository;
import gov.bee.api.identity.Caller;
import gov.bee.api.settings.BusinessSettingRepository.Decided;
import gov.bee.api.settings.BusinessSettingRepository.Definition;
import gov.bee.api.settings.BusinessSettingRepository.NewProposal;
import gov.bee.api.settings.BusinessSettingRepository.Proposal;
import gov.bee.api.settings.BusinessSettingRepository.Version;
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
 * Business settings (the owner's direction of 13 October 2026, not a BEE decision): the numbers BEE has not decided are data. A person
 * who holds the business_setting_manage permission (the Administrator today) proposes a value from a date that is not in the past; a
 * DIFFERENT holder approves or rejects; the proposer may withdraw. Approval adds an immutable version. The value in force on a day is
 * the version with the latest start on or before it, else the catalogue default, which is the owner's assumption. Other services read
 * a value with {@link #valueOn}; the value they used is stored on or derivable from the record it affected.
 */
@Service
public class BusinessSettingService {

    public static final String DECLARED_ISEER_MAX = "declared_iseer_max";
    public static final String TEST_REPORT_MAX_AGE_DAYS = "test_report_max_age_days";
    public static final String PAYMENT_TOLERANCE_AMOUNT = "payment_tolerance_amount";
    public static final String ISEER_VERIFY_TOLERANCE = "iseer_verify_tolerance";
    public static final String CERTIFICATE_VALIDITY_YEARS = "certificate_validity_years";

    static final String PROPOSE_ROUTE = "/api/business-settings/proposals";
    static final String DECIDE_ROUTE = "/api/business-settings/proposals/{id}/decision";
    static final ZoneId INDIA = ZoneId.of("Asia/Kolkata");
    private static final Pattern KEY = Pattern.compile("^[a-z][a-z0-9_]{2,63}$");
    private static final Pattern NUMBER = Pattern.compile("^\\d{1,10}(\\.\\d{1,2})?$");
    private static final Pattern DATE = Pattern.compile("^\\d{4}-\\d{2}-\\d{2}$");
    private static final Pattern TEXT_300 = Pattern.compile("^[^\\p{Cntrl}]{1,300}$");
    private static final Pattern TEXT_500 = Pattern.compile("^[^\\p{Cntrl}]{1,500}$");

    private final BusinessSettingRepository repository;
    private final IdempotencyRepository idempotency;
    private final ObjectMapper json;

    public BusinessSettingService(BusinessSettingRepository repository, IdempotencyRepository idempotency, ObjectMapper json) {
        this.repository = repository;
        this.idempotency = idempotency;
        this.json = json;
    }

    /** The value in force for a setting on a day (the version with the latest start on or before it, else the default). */
    public BigDecimal valueOn(String key, LocalDate on) {
        return repository.valueOn(key, on);
    }

    private boolean mayManage(Caller caller) {
        var roles = repository.rolesHolding(BusinessSettingRepository.CAPABILITY);
        return caller.roles().stream().anyMatch(g -> roles.contains(g.role()));
    }

    public ResponseEntity<Map<String, Object>> read(Caller caller) {
        if (!mayManage(caller)) {
            return error(HttpStatus.FORBIDDEN, "role_not_permitted");
        }
        LocalDate today = LocalDate.now(INDIA);
        List<Version> versions = repository.versions();
        List<Map<String, Object>> settings = new ArrayList<>();
        for (Definition d : repository.definitions()) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("key", d.key());
            m.put("label", d.label());
            m.put("unit", d.unit());
            m.put("description", d.description());
            m.put("warning", d.warning());
            m.put("decimals", d.decimals());
            m.put("min", figure(d, d.min()));
            m.put("max", figure(d, d.max()));
            m.put("defaultValue", figure(d, d.defaultValue()));
            m.put("valueInForce", figure(d, repository.valueOn(d.key(), today)));
            Version inForce = null;
            List<Map<String, Object>> scheduled = new ArrayList<>();
            List<Map<String, Object>> history = new ArrayList<>();
            for (Version v : versions) {
                if (!v.key().equals(d.key())) {
                    continue;
                }
                if (!v.effectiveFrom().isAfter(today)) {
                    inForce = v;
                } else {
                    scheduled.add(versionView(d, v));
                }
                history.add(versionView(d, v));
            }
            m.put("inForceFrom", inForce == null ? null : inForce.effectiveFrom().toString());
            m.put("scheduled", scheduled);
            m.put("versions", history);
            settings.add(m);
        }
        List<Map<String, Object>> pending = new ArrayList<>();
        repository.pending().forEach(p -> pending.add(proposalView(p, caller)));
        List<Map<String, Object>> decided = new ArrayList<>();
        repository.recentDecided(20).forEach(p -> decided.add(proposalView(p, caller)));
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("today", today.toString());
        out.put("settings", settings);
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
        Optional<NewProposal> input = parsePropose(body, LocalDate.now(INDIA));
        if (input.isEmpty()) {
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
        if (done.outcome() != BusinessSettingRepository.Outcome.DONE) {
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

    /** settingKey, value (decimal text inside the setting's range and precision), effectiveFrom (not before today), sourceReference, reason. */
    private Optional<NewProposal> parsePropose(JsonNode b, LocalDate today) {
        if (b == null || !b.isObject() || !text(b, "settingKey") || !text(b, "value") || !text(b, "effectiveFrom") || !text(b, "sourceReference") || !text(b, "reason")) {
            return Optional.empty();
        }
        String key = b.get("settingKey").asText().trim();
        String number = b.get("value").asText().trim();
        String date = b.get("effectiveFrom").asText().trim();
        String source = b.get("sourceReference").asText().trim();
        String reason = b.get("reason").asText().trim();
        if (!KEY.matcher(key).matches() || !NUMBER.matcher(number).matches() || !DATE.matcher(date).matches()
            || !TEXT_300.matcher(source).matches() || !TEXT_500.matcher(reason).matches()) {
            return Optional.empty();
        }
        Optional<Definition> def = repository.definition(key);
        if (def.isEmpty()) {
            return Optional.empty();
        }
        BigDecimal value = new BigDecimal(number);
        Definition d = def.get();
        if (value.compareTo(d.min()) < 0 || value.compareTo(d.max()) > 0 || (d.decimals() == 0 && value.stripTrailingZeros().scale() > 0)) {
            return Optional.empty();
        }
        LocalDate from;
        try {
            from = LocalDate.parse(date);
        } catch (Exception e) {
            return Optional.empty();
        }
        if (from.isBefore(today)) {
            return Optional.empty();
        }
        return Optional.of(new NewProposal(key, from, value, source, reason));
    }

    private static boolean text(JsonNode b, String field) {
        return b.hasNonNull(field) && b.get(field).isTextual();
    }

    private static String figure(Definition d, BigDecimal v) {
        return v.setScale(d.decimals(), java.math.RoundingMode.UNNECESSARY).toPlainString();
    }

    private static Map<String, Object> versionView(Definition d, Version v) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("effectiveFrom", v.effectiveFrom().toString());
        m.put("value", figure(d, v.value()));
        m.put("source", v.source());
        return m;
    }

    private Map<String, Object> proposalView(Proposal p, Caller caller) {
        Definition d = repository.definition(p.key()).orElseThrow();
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", p.id().toString());
        m.put("settingKey", p.key());
        m.put("label", d.label());
        m.put("unit", d.unit());
        m.put("effectiveFrom", p.effectiveFrom().toString());
        m.put("value", figure(d, p.value()));
        m.put("valueBefore", figure(d, repository.valueOn(p.key(), p.effectiveFrom().minusDays(1))));
        m.put("sourceReference", p.sourceReference());
        m.put("reason", p.reason());
        m.put("state", p.state());
        m.put("proposedBy", p.proposedBy());
        m.put("proposedByYou", p.proposedById().equals(caller.accountId()));
        m.put("proposedAt", p.proposedAt().toString());
        m.put("decidedBy", p.decidedBy());
        m.put("decidedAt", p.decidedAt() == null ? null : p.decidedAt().toString());
        m.put("decisionNote", p.decisionNote());
        m.put("applied", p.applied());
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
