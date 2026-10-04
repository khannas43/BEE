package gov.bee.api.director;

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
import java.security.MessageDigest;
import java.time.LocalDate;
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
 * The Program Director reviews the rating and recommends approval (first slice step 6, capacity A). PROVISIONAL LOCAL
 * ASSUMPTION (decision D1, chosen by the owner, not by BEE): for a category whose latest director_final_rule row says
 * so, the recommendation is final and the application goes straight to approved; otherwise it goes to the Secretary. The
 * Director must hold the Director role, took no other part in the application and does not belong to the applicant's
 * organisation. The next stage is read by role, so no officer is assigned. The answer is a receipt, not an application
 * view, because the Director reads only the director_review stage.
 */
@Service
public class DirectorRecommendationService {

    static final String ROUTE = "/api/model-applications/{id}/director-recommendation";
    /** 1 to 500 characters with no control characters (including line breaks), after trimming. */
    private static final Pattern NOTE = Pattern.compile("^[^\\p{Cntrl}]{1,500}$");

    private final ModelApplicationRepository applications;
    private final DirectorRecommendationRepository repository;
    private final IdempotencyRepository idempotency;
    private final ObjectMapper json;

    public DirectorRecommendationService(ModelApplicationRepository applications, DirectorRecommendationRepository repository,
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

        // The reviewed slice rule: role and scope, the source state, and no one who acted at another stage (the Director reads the stage by role, so no assignment is needed).
        var decision = SlicePolicy.check(SliceAction.DIRECTOR_RECOMMEND, caller, facts(row, repository.actorsAtOtherStages(appId)));
        if (!decision.allowed()) {
            return switch (decision.reason()) {
                case "wrong_stage", "not_assigned" -> error(HttpStatus.NOT_FOUND, "not_found");
                case "same_user_other_stage" -> error(HttpStatus.FORBIDDEN, "segregation_refused");
                default -> error(HttpStatus.FORBIDDEN, "role_not_permitted");
            };
        }
        // A person from the applicant's own organisation cannot recommend its approval.
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
        if (!idempotency.begin(caller.accountId(), "POST", ROUTE, appId, idempotencyKey, DraftRequestSupport.bodyHash(body))) {
            return error(HttpStatus.CONFLICT, "idempotency_in_progress");
        }
        // The owner's D1 assumption: is the Director's recommendation final for this category today (India date)?
        boolean directorFinal = repository.directorFinal(row.category(), LocalDate.now(gov.bee.api.application.ModelDraftPolicy.IST));
        var done = repository.recommend(appId, row.version(), caller.accountId(), "director", input.get().note(), directorFinal);
        if (done.outcome() != DirectorRecommendationRepository.Outcome.RECOMMENDED) {
            idempotency.abandon(caller.accountId(), "POST", ROUTE, appId, idempotencyKey);
            return error(HttpStatus.CONFLICT, "version_conflict");
        }
        Map<String, Object> receipt = new LinkedHashMap<>();
        receipt.put("applicationId", appId.toString());
        receipt.put("reference", row.reference());
        receipt.put("fromState", DirectorRecommendationRepository.FROM_STATE);
        receipt.put("toState", done.toState());
        receipt.put("version", done.versionAfter());
        receipt.put("note", input.get().note());
        receipt.put("directorFinal", directorFinal);
        receipt.put("recommendedAt", done.recommendedAt().toString());
        idempotency.complete(caller.accountId(), "POST", ROUTE, appId, idempotencyKey, 200, writeJson(receipt), done.versionAfter());
        return ResponseEntity.ok(receipt);
    }

    private record Input(int version, String note) {
    }

    /** version (int), note (1 to 500 characters after trimming, no control characters). */
    private static Optional<Input> parse(JsonNode body) {
        if (body == null || !body.isObject() || !body.hasNonNull("version") || !body.get("version").isInt()
            || !body.hasNonNull("note") || !body.get("note").isTextual()) {
            return Optional.empty();
        }
        String note = body.get("note").asText().trim();
        if (!NOTE.matcher(note).matches()) {
            return Optional.empty();
        }
        return Optional.of(new Input(body.get("version").asInt(), note));
    }

    /** The replay rules every command shares, plus: only a caller who still holds the Director role may replay. */
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
        if (!caller.holds("director", SlicePolicy.ALL)) {
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
