package gov.bee.api.registration;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import gov.bee.api.administration.AdminDemonstrationAccess;
import gov.bee.api.application.DraftRequestSupport;
import gov.bee.api.application.IdempotencyRepository;
import gov.bee.api.application.ModelDraftPolicy;
import gov.bee.api.identity.Caller;
import gov.bee.api.settings.BusinessSettingService;
import gov.bee.api.web.ApiErrors;
import java.math.BigDecimal;
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
 * WP04.2b-1: Finance confirms, by hand, that the registration fee on the snapshot was received (fee_due to programme_review). The same
 * provisional rules as a model fee: the amount is within the payment tolerance in force of the whole fee due, a receipt reference and a
 * received date are recorded, the payer's own organisation and the person who submitted cannot confirm. The answer is a receipt, so a
 * replay never returns a record the caller can no longer read.
 */
@Service
public class RegistrationFeeService {

    static final String ROUTE = "/api/registrations/{id}/fee-confirmation";
    private static final Pattern RECEIPT = Pattern.compile("^[A-Za-z0-9][A-Za-z0-9 ./_-]{0,63}$");
    private static final Pattern ISO_DATE = Pattern.compile("^\\d{4}-\\d{2}-\\d{2}$");
    private static final Pattern MONEY = Pattern.compile("^\\d{1,12}(\\.\\d{1,2})?$");

    private final RegistrationRepository registrations;
    private final IdempotencyRepository idempotency;
    private final BusinessSettingService settings;
    private final ObjectMapper json;

    public RegistrationFeeService(RegistrationRepository registrations, IdempotencyRepository idempotency, BusinessSettingService settings,
                                  ObjectMapper json) {
        this.registrations = registrations;
        this.idempotency = idempotency;
        this.settings = settings;
        this.json = json;
    }

    @Transactional
    public ResponseEntity<Map<String, Object>> confirm(Caller caller, UUID id, String key, JsonNode body) {
        if (AdminDemonstrationAccess.deniesOperationalMutation(caller)) {
            return error(HttpStatus.FORBIDDEN, "role_not_permitted");
        }
        Optional<ResponseEntity<Map<String, Object>>> replay = replayOrRequireKey(caller, id, key, body);
        if (replay.isPresent()) {
            return replay.get();
        }
        if (!caller.holdsOwn("finance", "all")) {
            return error(HttpStatus.FORBIDDEN, "role_not_permitted");
        }
        Optional<RegistrationRepository.Row> found = registrations.find(id).filter(r -> "fee_due".equals(r.state()));
        if (found.isEmpty()) {
            return error(HttpStatus.NOT_FOUND, "not_found");
        }
        var row = found.get();
        if (caller.organisationIds().contains(row.organisationId()) || caller.accountId().equals(registrations.submitter(id).orElse(null))) {
            return error(HttpStatus.FORBIDDEN, "segregation_refused");
        }
        LocalDate today = LocalDate.now(ModelDraftPolicy.IST);
        Optional<Input> input = parse(body, today);
        if (input.isEmpty()) {
            return error(HttpStatus.UNPROCESSABLE_ENTITY, "validation_failed");
        }
        var fee = registrations.feeSnapshot(id);
        Optional<UUID> snapshot = registrations.feeSnapshotId(id);
        if (fee.isEmpty() || snapshot.isEmpty()) {
            return error(HttpStatus.INTERNAL_SERVER_ERROR, "internal_error");
        }
        BigDecimal tolerance = settings.valueOn(BusinessSettingService.PAYMENT_TOLERANCE_AMOUNT, today);
        if (input.get().amount().subtract(fee.get().totalInr()).abs().compareTo(tolerance) > 0) {
            return error(HttpStatus.UNPROCESSABLE_ENTITY, "amount_mismatch");
        }
        if (row.version() != input.get().version()) {
            return error(HttpStatus.CONFLICT, "version_conflict");
        }
        if (!idempotency.begin(caller.accountId(), "POST", ROUTE, id, key, DraftRequestSupport.bodyHash(body))) {
            return error(HttpStatus.CONFLICT, "idempotency_in_progress");
        }
        var done = registrations.confirmFee(id, row.version(), caller.accountId(), snapshot.get(), input.get().amount(), input.get().receipt(),
            input.get().receivedOn());
        if (done.isEmpty()) {
            idempotency.abandon(caller.accountId(), "POST", ROUTE, id, key);
            return error(HttpStatus.CONFLICT, "version_conflict");
        }
        Map<String, Object> receipt = new LinkedHashMap<>();
        receipt.put("registrationId", id.toString());
        receipt.put("reference", row.reference());
        receipt.put("fromState", "fee_due");
        receipt.put("toState", "programme_review");
        receipt.put("version", done.get().versionAfter());
        receipt.put("receiptReference", input.get().receipt());
        receipt.put("amountInr", input.get().amount().setScale(2).toPlainString());
        receipt.put("receivedOn", input.get().receivedOn().toString());
        receipt.put("confirmedAt", done.get().confirmedAt().toString());
        idempotency.complete(caller.accountId(), "POST", ROUTE, id, key, 200, write(receipt), done.get().versionAfter());
        return ResponseEntity.ok(receipt);
    }

    private record Input(int version, String receipt, LocalDate receivedOn, BigDecimal amount) {
    }

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
    private Optional<ResponseEntity<Map<String, Object>>> replayOrRequireKey(Caller caller, UUID id, String key, JsonNode body) {
        if (key == null || !DraftRequestSupport.IDEMPOTENCY_KEY.matcher(key).matches()) {
            return Optional.of(error(HttpStatus.UNPROCESSABLE_ENTITY, "idempotency_key_required"));
        }
        var stored = idempotency.find(caller.accountId(), "POST", ROUTE, id, key);
        if (stored.isEmpty()) {
            return Optional.empty();
        }
        if (stored.get().inProgress()) {
            return Optional.of(error(HttpStatus.CONFLICT, "idempotency_in_progress"));
        }
        Optional<byte[]> prior = idempotency.bodyHash(caller.accountId(), "POST", ROUTE, id, key);
        if (prior.isEmpty() || !MessageDigest.isEqual(prior.get(), DraftRequestSupport.bodyHash(body))) {
            return Optional.of(error(HttpStatus.CONFLICT, "idempotency_key_conflict"));
        }
        if (!caller.holdsOwn("finance", "all")) {
            return Optional.of(error(HttpStatus.FORBIDDEN, "role_not_permitted"));
        }
        try {
            @SuppressWarnings("unchecked")
            Map<String, Object> replayBody = json.readValue(stored.get().responseBody(), Map.class);
            return Optional.of(ResponseEntity.status(stored.get().responseStatus()).header("Idempotency-Replayed", "true").body(replayBody));
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
