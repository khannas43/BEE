package gov.bee.api.rating;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import gov.bee.api.application.DraftRequestSupport;
import gov.bee.api.application.IdempotencyRepository;
import gov.bee.api.application.ModelApplicationRepository;
import gov.bee.api.identity.Caller;
import gov.bee.api.policy.ApplicationFacts;
import gov.bee.api.policy.SliceAction;
import gov.bee.api.policy.SlicePolicy;
import gov.bee.api.web.ApiErrors;
import java.math.BigDecimal;
import java.security.MessageDigest;
import java.time.LocalDate;
import java.util.List;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Programme computes and records the star rating (first slice step 5, capacity X). PROVISIONAL LOCAL DEMONSTRATION: the
 * stars come from the local demonstration bands (rating_demo_band), not from a BEE-approved formula, because decision A2
 * is unanswered and the master formula guard still refuses any computation from an unverified version. The officer enters
 * the efficiency figure they verified from the test report; the applicant's declared figure is kept beside it and never
 * replaced. A figure below the lowest band is refused and nothing is written. Directors read the next stage by role, so
 * no officer is assigned. The answer is a receipt, not an application view, because Programme reads only the rating stage.
 */
@Service
public class RatingService {

    static final String ROUTE = "/api/model-applications/{id}/rating";
    /** Up to two digits and two decimals, like the declared figure. */
    private static final Pattern ISEER = Pattern.compile("^\\d{1,2}(\\.\\d{1,2})?$");

    private final ModelApplicationRepository applications;
    private final RatingRepository repository;
    private final IdempotencyRepository idempotency;
    private final ObjectMapper json;

    public RatingService(ModelApplicationRepository applications, RatingRepository repository,
                                     IdempotencyRepository idempotency, ObjectMapper json) {
        this.applications = applications;
        this.repository = repository;
        this.idempotency = idempotency;
        this.json = json;
    }

    @Transactional
    public ResponseEntity<Map<String, Object>> run(Caller caller, UUID appId, String idempotencyKey, JsonNode body) {
        Optional<ResponseEntity<Map<String, Object>>> replay = replayOrRequireKey(caller, appId, idempotencyKey, body);
        if (replay.isPresent()) {
            return replay.get();
        }
        var scope = SlicePolicy.readScope(caller);
        if (scope.isEmpty()) {
            return error(HttpStatus.FORBIDDEN, "role_not_permitted");
        }
        Optional<ModelApplicationRepository.Row> found = applications.find(appId, scope, caller.accountId())
            .filter(r -> SlicePolicy.canRead(scope, facts(r, Set.of())));
        if (found.isEmpty()) {
            return error(HttpStatus.NOT_FOUND, "not_found");
        }
        ModelApplicationRepository.Row row = found.get();

        // The reviewed slice rule: role and scope, the source state, and no one who acted at another stage (Programme reads the stage by role, so no assignment is needed).
        var decision = SlicePolicy.check(SliceAction.COMPUTE_RATING, caller, facts(row, repository.actorsAtOtherStages(appId)));
        if (!decision.allowed()) {
            return switch (decision.reason()) {
                case "wrong_stage", "not_assigned" -> error(HttpStatus.NOT_FOUND, "not_found");
                case "same_user_other_stage" -> error(HttpStatus.FORBIDDEN, "segregation_refused");
                default -> error(HttpStatus.FORBIDDEN, "role_not_permitted");
            };
        }
        // A person from the applicant's own organisation cannot rate its application.
        if (caller.organisationIds().contains(row.organisationId())) {
            return error(HttpStatus.FORBIDDEN, "segregation_refused");
        }

        Optional<Input> input = parse(body);
        if (input.isEmpty()) {
            return error(HttpStatus.UNPROCESSABLE_ENTITY, "validation_failed");
        }
        if (row.version() != input.get().version()) {
            return error(HttpStatus.CONFLICT, "version_conflict");
        }
        if (row.declaredIseer() == null) {
            return error(HttpStatus.INTERNAL_SERVER_ERROR, "internal_error");
        }
        // The local demonstration scheme in force today (India date). No scheme means no rating, and nothing is written.
        List<RatingRepository.Band> bands = repository.bandsInForce(row.category(), LocalDate.now(gov.bee.api.application.ModelDraftPolicy.IST));
        if (bands.isEmpty()) {
            return error(HttpStatus.UNPROCESSABLE_ENTITY, "rule_not_available");
        }
        int stars = 0;
        for (RatingRepository.Band band : bands) {
            if (input.get().verifiedIseer().compareTo(band.minIseer()) >= 0) {
                stars = Math.max(stars, band.stars());
            }
        }
        if (stars == 0) {
            return error(HttpStatus.UNPROCESSABLE_ENTITY, "rating_below_threshold");
        }
        if (!idempotency.begin(caller.accountId(), "POST", ROUTE, appId, idempotencyKey, DraftRequestSupport.bodyHash(body))) {
            return error(HttpStatus.CONFLICT, "idempotency_in_progress");
        }
        var done = repository.compute(appId, row.version(), caller.accountId(), "programme", bands.get(0).schemeKey(), row.declaredIseer(),
            input.get().verifiedIseer(), stars);
        if (done.outcome() != RatingRepository.Outcome.COMPUTED) {
            idempotency.abandon(caller.accountId(), "POST", ROUTE, appId, idempotencyKey);
            return error(HttpStatus.CONFLICT, "version_conflict");
        }
        Map<String, Object> receipt = new LinkedHashMap<>();
        receipt.put("applicationId", appId.toString());
        receipt.put("reference", row.reference());
        receipt.put("fromState", RatingRepository.FROM_STATE);
        receipt.put("toState", RatingRepository.TO_STATE);
        receipt.put("version", done.versionAfter());
        receipt.put("ratingVersion", done.ratingVersion());
        receipt.put("schemeKey", bands.get(0).schemeKey());
        receipt.put("declaredIseer", row.declaredIseer().toPlainString());
        receipt.put("verifiedIseer", input.get().verifiedIseer().toPlainString());
        receipt.put("stars", stars);
        receipt.put("localDemoRating", true);
        receipt.put("computedAt", done.computedAt().toString());
        idempotency.complete(caller.accountId(), "POST", ROUTE, appId, idempotencyKey, 200, writeJson(receipt), done.versionAfter());
        return ResponseEntity.ok(receipt);
    }

    private record Input(int version, BigDecimal verifiedIseer) {
    }

    /** version (int), verifiedIseer (decimal text, up to two digits and two decimals, above zero). */
    private static Optional<Input> parse(JsonNode body) {
        if (body == null || !body.isObject() || !body.hasNonNull("version") || !body.get("version").isInt()
            || !body.hasNonNull("verifiedIseer") || !body.get("verifiedIseer").isTextual()) {
            return Optional.empty();
        }
        String figure = body.get("verifiedIseer").asText();
        if (!ISEER.matcher(figure).matches()) {
            return Optional.empty();
        }
        BigDecimal value = new BigDecimal(figure);
        return value.signum() > 0 ? Optional.of(new Input(body.get("version").asInt(), value)) : Optional.empty();
    }

    /** The replay rules every command shares, plus: only a caller who still holds the Programme role may replay. */
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
        if (!caller.holds("programme", SlicePolicy.ALL)) {
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

    private static ApplicationFacts facts(ModelApplicationRepository.Row r, Set<UUID> actorsAtOtherStages) {
        return new ApplicationFacts(r.id(), r.organisationId(), r.state(), r.assignedStagesForCaller(), actorsAtOtherStages, false);
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
