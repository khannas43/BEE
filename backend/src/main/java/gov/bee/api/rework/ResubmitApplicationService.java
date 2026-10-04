package gov.bee.api.rework;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import gov.bee.api.application.DraftRequestSupport;
import gov.bee.api.application.IdempotencyRepository;
import gov.bee.api.application.ModelApplicationEvidence;
import gov.bee.api.application.ModelApplicationRepository;
import gov.bee.api.application.ModelDraftPolicy;
import gov.bee.api.brand.BrandAuthRepository;
import gov.bee.api.brand.BrandAuthService;
import gov.bee.api.identity.Caller;
import gov.bee.api.identity.IdentityRepository;
import gov.bee.api.web.ApiErrors;
import java.security.MessageDigest;
import java.time.LocalDate;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.regex.Pattern;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The applicant resubmits a returned application after editing it (FIRST_SLICE.md section 4, decision B7). Provisional
 * local rules, not BEE rules. The same evidence gates as the first submit are checked again, the fee is not recomputed,
 * and the application goes back to the stage that returned it. If it was returned from the Director or the Secretary and
 * a rating input changed since the return, the earlier rating is superseded and the application passes through rating
 * again, so an approver never decides on a rating that no longer matches the evidence. The answer is a receipt.
 */
@Service
public class ResubmitApplicationService {

    static final String ROUTE = "/api/model-applications/{id}/resubmit";
    /** Optional note about what changed: 1 to 500 characters with no control characters, after trimming. */
    private static final Pattern NOTE = Pattern.compile("^[^\\p{Cntrl}]{1,500}$");

    private final IdentityRepository identity;
    private final ModelApplicationRepository applications;
    private final BrandAuthRepository brands;
    private final BrandAuthService brandService;
    private final ModelApplicationEvidence evidence;
    private final ResubmitApplicationRepository repository;
    private final IdempotencyRepository idempotency;
    private final ObjectMapper json;

    public ResubmitApplicationService(IdentityRepository identity, ModelApplicationRepository applications, BrandAuthRepository brands,
                                      BrandAuthService brandService, ModelApplicationEvidence evidence, ResubmitApplicationRepository repository,
                                      IdempotencyRepository idempotency, ObjectMapper json) {
        this.identity = identity;
        this.applications = applications;
        this.brands = brands;
        this.brandService = brandService;
        this.evidence = evidence;
        this.repository = repository;
        this.idempotency = idempotency;
        this.json = json;
    }

    @Transactional
    public ResponseEntity<Map<String, Object>> run(Caller caller, UUID appId, String idempotencyKey, JsonNode body) {
        LocalDate today = LocalDate.now(ModelDraftPolicy.IST);
        Optional<ResponseEntity<Map<String, Object>>> replay = replayOrRequireKey(caller, appId, idempotencyKey, body);
        if (replay.isPresent()) {
            return replay.get();
        }
        if (!ModelDraftPolicy.canWrite(caller)) {
            return error(HttpStatus.FORBIDDEN, "no_write_scope");
        }
        Optional<Input> input = parse(body);
        if (input.isEmpty()) {
            return error(HttpStatus.UNPROCESSABLE_ENTITY, "validation_failed");
        }
        UUID filing = ModelDraftPolicy.filingOrganisation(caller).orElseThrow();
        Optional<ModelApplicationRepository.Row> found = applications.findOwned(appId, filing);
        if (found.isEmpty()) {
            return error(HttpStatus.NOT_FOUND, "not_found");
        }
        ModelApplicationRepository.Row row = found.get();
        if (!ResubmitApplicationRepository.FROM_STATE.equals(row.state())) {
            return error(HttpStatus.FORBIDDEN, "not_returned");
        }
        if (row.version() != input.get().version()) {
            return error(HttpStatus.CONFLICT, "version_conflict");
        }
        Optional<String> brandDeny = brandDenial(caller, row, today);
        if (brandDeny.isPresent()) {
            String reason = brandDeny.get();
            return error("validation_failed".equals(reason) ? HttpStatus.UNPROCESSABLE_ENTITY : HttpStatus.FORBIDDEN, reason);
        }
        // The same evidence gates as the first submit, on the edited application. The model key is locked so a same-model
        // submit queued behind this one sees the committed winner.
        if (row.brandId() != null) {
            applications.lockModelKey(row.brandId(), row.modelNumber());
        }
        Optional<ModelApplicationEvidence.Gate> unmet = evidence.evaluate(row, today).firstUnmet();
        if (unmet.isPresent()) {
            return error(unmet.get().status(), unmet.get().code());
        }
        Optional<ResubmitApplicationRepository.OpenReturn> open = repository.openReturn(appId);
        if (open.isEmpty()) {
            return error(HttpStatus.INTERNAL_SERVER_ERROR, "internal_error");
        }
        String from = open.get().returnedFromState();
        boolean superseded = (from.equals("director_review") || from.equals("secretary_approval")) && repository.ratingInputsChanged(appId, open.get());
        String resumedState = superseded ? "rating" : from;
        if (!idempotency.begin(caller.accountId(), "POST", ROUTE, appId, idempotencyKey, DraftRequestSupport.bodyHash(body))) {
            return error(HttpStatus.CONFLICT, "idempotency_in_progress");
        }
        var done = repository.resubmit(appId, row.version(), caller.accountId(), actorRole(caller), open.get().id(), resumedState, superseded,
            input.get().note().orElse(null));
        if (done.outcome() != ResubmitApplicationRepository.Outcome.RESUBMITTED) {
            idempotency.abandon(caller.accountId(), "POST", ROUTE, appId, idempotencyKey);
            return error(HttpStatus.CONFLICT, "version_conflict");
        }
        Map<String, Object> receipt = new LinkedHashMap<>();
        receipt.put("applicationId", appId.toString());
        receipt.put("reference", row.reference());
        receipt.put("fromState", ResubmitApplicationRepository.FROM_STATE);
        receipt.put("toState", resumedState);
        receipt.put("version", done.versionAfter());
        receipt.put("ratingSuperseded", superseded);
        receipt.put("resubmittedAt", done.resubmittedAt().toString());
        idempotency.complete(caller.accountId(), "POST", ROUTE, appId, idempotencyKey, 200, writeJson(receipt), done.versionAfter());
        return ResponseEntity.ok(receipt);
    }

    private record Input(int version, Optional<String> note) {
    }

    /** version (int) and an optional note (1 to 500 characters after trimming, no control characters). */
    private static Optional<Input> parse(JsonNode body) {
        if (body == null || !body.isObject() || !body.hasNonNull("version") || !body.get("version").isInt()) {
            return Optional.empty();
        }
        Optional<String> note = Optional.empty();
        if (body.has("note")) {
            if (!body.get("note").isTextual()) {
                return Optional.empty();
            }
            String text = body.get("note").asText().trim();
            if (!NOTE.matcher(text).matches()) {
                return Optional.empty();
            }
            note = Optional.of(text);
        }
        return Optional.of(new Input(body.get("version").asInt(), note));
    }

    /** The brand the application is filed under must still be the filer's to use (it could have lapsed since the first submit). */
    private Optional<String> brandDenial(Caller caller, ModelApplicationRepository.Row row, LocalDate today) {
        if (row.brandId() == null) {
            return Optional.of("brand_not_permitted");
        }
        if (!DraftRequestSupport.validCategory(row.category()) || !DraftRequestSupport.validModelNumber(row.modelNumber())) {
            return Optional.of("validation_failed");
        }
        var decision = ModelDraftPolicy.brandForFiling(caller, identity.activeMemberships(caller.accountId()), row.brandId(), brands, brandService, today);
        return decision.allowed() ? Optional.empty() : Optional.of(decision.denial());
    }

    private static String actorRole(Caller caller) {
        if (caller.holds("manufacturer", "own-org")) {
            return "manufacturer";
        }
        return caller.holds("agency", "own-org") ? "agency" : "unknown";
    }

    /** The replay rules every command shares, plus: only a caller who can still file may replay. */
    private Optional<ResponseEntity<Map<String, Object>>> replayOrRequireKey(Caller caller, UUID appId, String key, JsonNode body) {
        if (key == null || !DraftRequestSupport.IDEMPOTENCY_KEY.matcher(key).matches()) {
            return Optional.of(error(HttpStatus.UNPROCESSABLE_ENTITY, "idempotency_key_required"));
        }
        var stored = idempotency.find(caller.accountId(), "POST", ROUTE, appId, key);
        if (stored.isEmpty()) {
            return Optional.empty();
        }
        var s = stored.get();
        if (s.inProgress()) {
            return Optional.of(error(HttpStatus.CONFLICT, "idempotency_in_progress"));
        }
        Optional<byte[]> priorHash = idempotency.bodyHash(caller.accountId(), "POST", ROUTE, appId, key);
        if (priorHash.isEmpty() || !MessageDigest.isEqual(priorHash.get(), DraftRequestSupport.bodyHash(body))) {
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
