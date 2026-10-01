package gov.bee.api.application;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import gov.bee.api.brand.BrandAuthRepository;
import gov.bee.api.brand.BrandAuthService;
import gov.bee.api.identity.Caller;
import gov.bee.api.identity.IdentityRepository;
import gov.bee.api.masters.MasterDataRepository;
import gov.bee.api.masters.Masters.FeeRule;
import gov.bee.api.masters.Masters.Standard;
import gov.bee.api.masters.MasterVersion;
import gov.bee.api.policy.SlicePolicy;
import gov.bee.api.policy.SlicePolicy.ReadScope;
import gov.bee.api.web.ApiErrors;
import java.time.LocalDate;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ModelApplicationSubmitService {

    static final String ROUTE_SUBMIT = "/api/model-applications/{id}/submit";
    private static final String INTAKE_NOTE =
        "WP05.1c validates category, performance-test standard and fee rule only. Test evidence, accreditation and full RFP intake remain deferred (WP05.1 / WP06.1).";

    private final IdentityRepository identity;
    private final ModelApplicationRepository applications;
    private final ModelApplicationSubmitRepository submissions;
    private final BrandAuthRepository brands;
    private final BrandAuthService brandService;
    private final MasterDataRepository masters;
    private final IdempotencyRepository idempotency;
    private final ObjectMapper json;

    public ModelApplicationSubmitService(IdentityRepository identity, ModelApplicationRepository applications,
                                         ModelApplicationSubmitRepository submissions, BrandAuthRepository brands,
                                         BrandAuthService brandService, MasterDataRepository masters,
                                         IdempotencyRepository idempotency, ObjectMapper json) {
        this.identity = identity;
        this.applications = applications;
        this.submissions = submissions;
        this.brands = brands;
        this.brandService = brandService;
        this.masters = masters;
        this.idempotency = idempotency;
        this.json = json;
    }

    public ResponseEntity<Map<String, Object>> preview(Caller caller, UUID appId) {
        if (!ModelDraftPolicy.canWrite(caller)) {
            return error(HttpStatus.FORBIDDEN, "no_write_scope");
        }
        UUID filing = ModelDraftPolicy.filingOrganisation(caller).orElseThrow();
        Optional<ModelApplicationRepository.Row> row = applications.findOwned(appId, filing);
        if (row.isEmpty()) {
            return error(HttpStatus.NOT_FOUND, "not_found");
        }
        return buildPreview(caller, row.get());
    }

    @Transactional
    public ResponseEntity<Map<String, Object>> submit(Caller caller, UUID appId, String idempotencyKey, JsonNode body) {
        Optional<ResponseEntity<Map<String, Object>>> replay = replayOrRequireKey(caller, appId, idempotencyKey, body);
        if (replay.isPresent()) {
            return replay.get();
        }
        if (!ModelDraftPolicy.canWrite(caller)) {
            return error(HttpStatus.FORBIDDEN, "no_write_scope");
        }
        Optional<Integer> version = parseVersion(body);
        if (version.isEmpty()) {
            idempotency.abandon(caller.accountId(), "POST", ROUTE_SUBMIT, appId, idempotencyKey);
            return error(HttpStatus.UNPROCESSABLE_ENTITY, "validation_failed");
        }
        UUID filing = ModelDraftPolicy.filingOrganisation(caller).orElseThrow();
        Optional<ModelApplicationRepository.Row> existing = applications.findOwned(appId, filing);
        if (existing.isEmpty()) {
            idempotency.abandon(caller.accountId(), "POST", ROUTE_SUBMIT, appId, idempotencyKey);
            return error(HttpStatus.NOT_FOUND, "not_found");
        }
        ModelApplicationRepository.Row row = existing.get();
        if (!"draft".equals(row.state())) {
            idempotency.abandon(caller.accountId(), "POST", ROUTE_SUBMIT, appId, idempotencyKey);
            return error(HttpStatus.FORBIDDEN, "not_submittable");
        }
        if (row.version() != version.get()) {
            idempotency.abandon(caller.accountId(), "POST", ROUTE_SUBMIT, appId, idempotencyKey);
            return error(HttpStatus.CONFLICT, "version_conflict");
        }
        Optional<String> brandDeny = brandDenial(caller, row);
        if (brandDeny.isPresent()) {
            idempotency.abandon(caller.accountId(), "POST", ROUTE_SUBMIT, appId, idempotencyKey);
            String reason = brandDeny.get();
            HttpStatus status = "validation_failed".equals(reason) ? HttpStatus.UNPROCESSABLE_ENTITY : HttpStatus.FORBIDDEN;
            return error(status, reason);
        }
        Optional<IntakeResolution> intake = resolveFeeRules(row);
        if (intake.isEmpty()) {
            idempotency.abandon(caller.accountId(), "POST", ROUTE_SUBMIT, appId, idempotencyKey);
            return error(HttpStatus.UNPROCESSABLE_ENTITY, "rule_not_available");
        }
        byte[] hash = DraftRequestSupport.bodyHash(body);
        if (!idempotency.begin(caller.accountId(), "POST", ROUTE_SUBMIT, appId, idempotencyKey, hash)) {
            return error(HttpStatus.CONFLICT, "idempotency_in_progress");
        }
        FeeRule fee = intake.get().fee();
        MasterVersion fv = fee.version();
        String actorRole = actorRole(caller);
        Optional<ModelApplicationSubmitRepository.SubmissionResult> done = submissions.submit(appId, filing, version.get(),
            caller.accountId(), actorRole, fee.amountInr(), fv.ruleKey(), fv.version(), fv.verification().name().toLowerCase(),
            fv.sourceReference(), fv.note());
        if (done.isEmpty()) {
            idempotency.abandon(caller.accountId(), "POST", ROUTE_SUBMIT, appId, idempotencyKey);
            Optional<ModelApplicationRepository.Row> again = applications.findOwned(appId, filing);
            if (again.isPresent() && !"draft".equals(again.get().state())) {
                return error(HttpStatus.FORBIDDEN, "not_submittable");
            }
            return error(HttpStatus.CONFLICT, "version_conflict");
        }
        Map<String, Object> view = submitView(done.get(), readScope(caller));
        idempotency.complete(caller.accountId(), "POST", ROUTE_SUBMIT, appId, idempotencyKey, 200, writeJson(view), done.get().application().version());
        return ResponseEntity.ok(view);
    }

    private ResponseEntity<Map<String, Object>> buildPreview(Caller caller, ModelApplicationRepository.Row row) {
        if (!"draft".equals(row.state())) {
            return error(HttpStatus.FORBIDDEN, "not_submittable");
        }
        Optional<String> brandDeny = brandDenial(caller, row);
        Optional<IntakeResolution> intake = brandDeny.isEmpty() ? resolveFeeRules(row) : Optional.empty();
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("ready", brandDeny.isEmpty() && intake.isPresent());
        m.put("version", row.version());
        m.put("intakeNote", INTAKE_NOTE);
        intake.ifPresent(i -> m.put("submissionFee", feeView(i.fee())));
        return ResponseEntity.ok(m);
    }

    private Optional<String> brandDenial(Caller caller, ModelApplicationRepository.Row row) {
        if (row.brandId() == null) {
            return Optional.of("brand_not_permitted");
        }
        if (!DraftRequestSupport.validCategory(row.category()) || !DraftRequestSupport.validModelNumber(row.modelNumber())) {
            return Optional.of("validation_failed");
        }
        var memberships = identity.activeMemberships(caller.accountId());
        LocalDate today = LocalDate.now(ModelDraftPolicy.IST);
        var brandDecision = ModelDraftPolicy.brandForFiling(caller, memberships, row.brandId(), brands, brandService, today);
        if (!brandDecision.allowed()) {
            return Optional.of(brandDecision.denial());
        }
        return Optional.empty();
    }

    private Optional<IntakeResolution> resolveFeeRules(ModelApplicationRepository.Row row) {
        if (row.brandId() == null || !DraftRequestSupport.validCategory(row.category()) || !DraftRequestSupport.validModelNumber(row.modelNumber())) {
            return Optional.empty();
        }
        LocalDate today = LocalDate.now(ModelDraftPolicy.IST);
        Optional<gov.bee.api.masters.Masters.Category> cat = masters.category(row.category(), today);
        Optional<Standard> std = masters.standard(row.category(), "performance_test", today);
        Optional<FeeRule> fee = masters.feeRule(row.category(), "new_model", today);
        if (cat.isEmpty() || std.isEmpty() || fee.isEmpty()) {
            return Optional.empty();
        }
        return Optional.of(new IntakeResolution(cat.get(), std.get(), fee.get()));
    }

    private record IntakeResolution(gov.bee.api.masters.Masters.Category category, Standard standard, FeeRule fee) {
    }

    private Optional<ResponseEntity<Map<String, Object>>> replayOrRequireKey(Caller caller, UUID appId, String key, JsonNode body) {
        if (key == null || !DraftRequestSupport.IDEMPOTENCY_KEY.matcher(key).matches()) {
            return Optional.of(error(HttpStatus.UNPROCESSABLE_ENTITY, "idempotency_key_required"));
        }
        byte[] hash = DraftRequestSupport.bodyHash(body);
        var stored = idempotency.find(caller.accountId(), "POST", ROUTE_SUBMIT, appId, key);
        if (stored.isEmpty()) {
            return Optional.empty();
        }
        var s = stored.get();
        if (s.inProgress()) {
            return Optional.of(error(HttpStatus.CONFLICT, "idempotency_in_progress"));
        }
        Optional<byte[]> priorHash = idempotency.bodyHash(caller.accountId(), "POST", ROUTE_SUBMIT, appId, key);
        if (priorHash.isEmpty() || !ModelApplicationDraftService.MessageDigestEquals.equals(priorHash.get(), hash)) {
            return Optional.of(error(HttpStatus.CONFLICT, "idempotency_key_conflict"));
        }
        if (!ModelDraftPolicy.canWrite(caller)) {
            return Optional.of(error(HttpStatus.FORBIDDEN, "no_write_scope"));
        }
        try {
            @SuppressWarnings("unchecked")
            Map<String, Object> replayBody = json.readValue(s.responseBody(), Map.class);
            return Optional.of(ResponseEntity.status(s.responseStatus()).header("Idempotency-Replayed", "true").body(replayBody));
        } catch (Exception e) {
            return Optional.of(error(HttpStatus.INTERNAL_SERVER_ERROR, "internal_error"));
        }
    }

    private static Optional<Integer> parseVersion(JsonNode body) {
        if (body == null || !body.isObject() || !body.has("version") || !body.get("version").isInt()) {
            return Optional.empty();
        }
        return Optional.of(body.get("version").asInt());
    }

    private static String actorRole(Caller caller) {
        if (caller.holds("manufacturer", "own-org")) {
            return "manufacturer";
        }
        if (caller.holds("agency", "own-org")) {
            return "agency";
        }
        return "unknown";
    }

    static Map<String, Object> feeView(FeeRule fee) {
        MasterVersion v = fee.version();
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("amountInr", fee.amountInr().toPlainString());
        m.put("currency", "INR");
        m.put("feeRuleKey", v.ruleKey());
        m.put("feeRuleVersion", v.version());
        m.put("verificationStatus", v.verification().name().toLowerCase());
        m.put("localDemoFee", !v.beeVerified());
        m.put("label", v.beeVerified() ? "Fee from BEE-approved rule" : "Local demo fee (not BEE-approved)");
        if (v.sourceReference() != null) {
            m.put("sourceReference", v.sourceReference());
        }
        return m;
    }

    static Map<String, Object> submitView(ModelApplicationSubmitRepository.SubmissionResult result, ReadScope scope) {
        Map<String, Object> m = ModelApplicationDraftService.view(result.application(), scope);
        m.put("submissionFee", feeViewFromSnapshot(result.fee()));
        return m;
    }

    static Map<String, Object> feeViewFromSnapshot(ModelApplicationSubmitRepository.FeeSnapshotRow snap) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("amountInr", snap.amountInr().toPlainString());
        m.put("currency", snap.currency());
        m.put("feeRuleKey", snap.feeRuleKey());
        m.put("feeRuleVersion", snap.feeRuleVersion());
        m.put("verificationStatus", snap.verificationStatus());
        m.put("localDemoFee", !"verified".equals(snap.verificationStatus()));
        m.put("label", "verified".equals(snap.verificationStatus()) ? "Fee from BEE-approved rule" : "Local demo fee (not BEE-approved)");
        if (snap.sourceReference() != null && !snap.sourceReference().isBlank()) {
            m.put("sourceReference", snap.sourceReference());
        }
        return m;
    }

    private ReadScope readScope(Caller caller) {
        return SlicePolicy.readScope(caller);
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
