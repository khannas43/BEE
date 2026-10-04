package gov.bee.api.finance;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import gov.bee.api.application.DraftRequestSupport;
import gov.bee.api.application.IdempotencyRepository;
import gov.bee.api.application.ModelApplicationRepository;
import gov.bee.api.application.ModelApplicationSubmitRepository;
import gov.bee.api.identity.Caller;
import gov.bee.api.policy.ApplicationFacts;
import gov.bee.api.policy.SliceAction;
import gov.bee.api.policy.SlicePolicy;
import gov.bee.api.web.ApiErrors;
import java.math.BigDecimal;
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
 * Finance confirms, manually, that the fee on the application's snapshot was received (first slice step 2, capacity X).
 * Provisional local rules, not BEE rules: the amount must equal the snapshot, a receipt reference and a received date are
 * recorded, the payer's own organisation and anyone who acted at another stage are refused, and the next IAME officer is
 * assigned by the D2 default. The answer is a receipt, not an application view, so a replay never returns a record the
 * caller can no longer read (Finance reads only the fee_due stage).
 */
@Service
public class FeeConfirmationService {

    static final String ROUTE = "/api/model-applications/{id}/fee-confirmation";
    private static final Pattern RECEIPT = Pattern.compile("^[A-Za-z0-9][A-Za-z0-9 ./_-]{0,63}$");
    private static final Pattern ISO_DATE = Pattern.compile("^\\d{4}-\\d{2}-\\d{2}$");
    private static final Pattern MONEY = Pattern.compile("^\\d{1,12}(\\.\\d{1,2})?$");

    private final ModelApplicationRepository applications;
    private final ModelApplicationSubmitRepository submissions;
    private final FeeConfirmationRepository repository;
    private final IdempotencyRepository idempotency;
    private final ObjectMapper json;

    public FeeConfirmationService(ModelApplicationRepository applications, ModelApplicationSubmitRepository submissions,
                                  FeeConfirmationRepository repository, IdempotencyRepository idempotency, ObjectMapper json) {
        this.applications = applications;
        this.submissions = submissions;
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

        // The reviewed slice rule: role and scope, the source state, and no one who acted at another stage.
        var decision = SlicePolicy.check(SliceAction.CONFIRM_FEE, caller, facts(row, repository.actorsAtOtherStages(appId)));
        if (!decision.allowed()) {
            return switch (decision.reason()) {
                case "wrong_stage" -> error(HttpStatus.NOT_FOUND, "not_found");
                case "same_user_other_stage" -> error(HttpStatus.FORBIDDEN, "segregation_refused");
                default -> error(HttpStatus.FORBIDDEN, "role_not_permitted");
            };
        }
        // The payer cannot confirm its own fee.
        if (caller.organisationIds().contains(row.organisationId())) {
            return error(HttpStatus.FORBIDDEN, "segregation_refused");
        }

        LocalDate today = LocalDate.now(gov.bee.api.application.ModelDraftPolicy.IST);
        Optional<Input> input = parse(body, today);
        if (input.isEmpty()) {
            return error(HttpStatus.UNPROCESSABLE_ENTITY, "validation_failed");
        }
        Optional<ModelApplicationSubmitRepository.FeeSnapshotRow> fee = submissions.findFeeSnapshot(appId);
        if (fee.isEmpty()) {
            return error(HttpStatus.INTERNAL_SERVER_ERROR, "internal_error");
        }
        if (input.get().amount().compareTo(fee.get().amountInr()) != 0) {
            return error(HttpStatus.UNPROCESSABLE_ENTITY, "amount_mismatch");
        }
        if (row.version() != input.get().version()) {
            return error(HttpStatus.CONFLICT, "version_conflict");
        }
        if (!idempotency.begin(caller.accountId(), "POST", ROUTE, appId, idempotencyKey, DraftRequestSupport.bodyHash(body))) {
            return error(HttpStatus.CONFLICT, "idempotency_in_progress");
        }
        var done = repository.confirm(appId, row.version(), caller.accountId(), "finance", fee.get().id(), fee.get().amountInr(),
            input.get().receipt(), input.get().receivedOn());
        if (done.outcome() != FeeConfirmationRepository.Outcome.CONFIRMED) {
            idempotency.abandon(caller.accountId(), "POST", ROUTE, appId, idempotencyKey);
            return done.outcome() == FeeConfirmationRepository.Outcome.NO_ASSIGNEE
                ? error(HttpStatus.CONFLICT, "assignee_unavailable")
                : error(HttpStatus.CONFLICT, "version_conflict");
        }
        Map<String, Object> receipt = new LinkedHashMap<>();
        receipt.put("applicationId", appId.toString());
        receipt.put("reference", row.reference());
        receipt.put("fromState", FeeConfirmationRepository.FROM_STATE);
        receipt.put("toState", FeeConfirmationRepository.TO_STATE);
        receipt.put("version", done.versionAfter());
        receipt.put("receiptReference", input.get().receipt());
        receipt.put("amountInr", fee.get().amountInr().setScale(2).toPlainString());
        receipt.put("receivedOn", input.get().receivedOn().toString());
        receipt.put("confirmedAt", done.confirmedAt().toString());
        idempotency.complete(caller.accountId(), "POST", ROUTE, appId, idempotencyKey, 200, writeJson(receipt), done.versionAfter());
        return ResponseEntity.ok(receipt);
    }

    private record Input(int version, String receipt, LocalDate receivedOn, BigDecimal amount) {
    }

    /** version (int), receiptReference (1 to 64 safe characters), receivedOn (ISO date, not after today), amountInr (decimal text). */
    private static Optional<Input> parse(JsonNode body, LocalDate today) {
        if (body == null || !body.isObject() || !body.hasNonNull("version") || !body.get("version").isInt()
            || !body.hasNonNull("receiptReference") || !body.get("receiptReference").isTextual()
            || !body.hasNonNull("receivedOn") || !body.get("receivedOn").isTextual()
            || !body.hasNonNull("amountInr") || !body.get("amountInr").isTextual()) {
            return Optional.empty();
        }
        String receipt = body.get("receiptReference").asText().trim();
        String date = body.get("receivedOn").asText();
        String amount = body.get("amountInr").asText();
        if (!RECEIPT.matcher(receipt).matches() || !ISO_DATE.matcher(date).matches() || !MONEY.matcher(amount).matches()) {
            return Optional.empty();
        }
        try {
            LocalDate receivedOn = LocalDate.parse(date);
            if (receivedOn.isAfter(today)) {
                return Optional.empty();
            }
            return Optional.of(new Input(body.get("version").asInt(), receipt, receivedOn, new BigDecimal(amount)));
        } catch (java.time.DateTimeException | NumberFormatException e) {
            return Optional.empty();
        }
    }

    /** The replay rules every command shares, plus: only a caller who still holds the Finance role may replay. */
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
        if (!caller.holds("finance", SlicePolicy.ALL)) {
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
