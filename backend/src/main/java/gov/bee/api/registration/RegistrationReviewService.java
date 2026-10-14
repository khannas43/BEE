package gov.bee.api.registration;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import gov.bee.api.application.DraftRequestSupport;
import gov.bee.api.application.IdempotencyRepository;
import gov.bee.api.application.ModelDraftPolicy;
import gov.bee.api.identity.Caller;
import gov.bee.api.web.ApiErrors;
import java.security.MessageDigest;
import java.time.LocalDate;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.interceptor.TransactionAspectSupport;

/**
 * WP04.2b-2: review and decide a registration request. Provisional local rules, not BEE rules (docs/wp04/WP04.2b_PLAN.md).
 * One command, five actions: Programme recommends or returns (programme_review), the Director approves, returns or rejects
 * (director_approval), the applicant resubmits a returned request. The approver is never the person who filed or recommended it
 * (checked here and again in the database); approval writes the brand or the agency authorisation in the same step.
 */
@Service
public class RegistrationReviewService {

    static final String ROUTE = "/api/registrations/{id}/transition";
    private static final Set<String> ACTIONS = Set.of("recommend", "return", "reject", "approve", "resubmit");

    private final RegistrationRepository registrations;
    private final RegistrationService registrationService;
    private final IdempotencyRepository idempotency;
    private final ObjectMapper json;

    public RegistrationReviewService(RegistrationRepository registrations, RegistrationService registrationService, IdempotencyRepository idempotency,
                                     ObjectMapper json) {
        this.registrations = registrations;
        this.registrationService = registrationService;
        this.idempotency = idempotency;
        this.json = json;
    }

    private record Input(String action, int version, String note) {
    }

    private static Optional<Input> parse(JsonNode body) {
        if (body == null || !body.isObject() || !body.hasNonNull("action") || !body.get("action").isTextual() || !body.has("version")
            || !body.get("version").isInt() || body.get("version").asInt() < 0) {
            return Optional.empty();
        }
        String action = body.get("action").asText();
        if (!ACTIONS.contains(action)) {
            return Optional.empty();
        }
        String note = null;
        if (body.hasNonNull("note")) {
            if (!body.get("note").isTextual()) {
                return Optional.empty();
            }
            note = DraftRequestSupport.trim(body.get("note").asText());
            if (note.isEmpty() || note.length() > 500 || "resubmit".equals(action)) {
                return Optional.empty();
            }
        }
        if (("return".equals(action) || "reject".equals(action)) && note == null) {
            return Optional.empty();
        }
        return Optional.of(new Input(action, body.get("version").asInt(), note));
    }

    /** The role the action needs at the state the request is in; empty when the action does not apply at that state. */
    private static Optional<String> roleFor(String action, String state) {
        return switch (action) {
            case "recommend" -> "programme_review".equals(state) ? Optional.of("programme") : Optional.empty();
            case "return" -> "programme_review".equals(state) ? Optional.of("programme") : "director_approval".equals(state) ? Optional.of("director") : Optional.empty();
            case "approve", "reject" -> "director_approval".equals(state) ? Optional.of("director") : Optional.empty();
            default -> "returned".equals(state) ? Optional.of("applicant") : Optional.empty();
        };
    }

    private static String target(String action, String from) {
        return switch (action) {
            case "recommend" -> "director_approval";
            case "return" -> "returned";
            case "reject" -> "rejected";
            case "approve" -> "approved";
            default -> "programme_review";
        };
    }

    private static boolean holdsRole(Caller caller, String role) {
        return "applicant".equals(role) ? RegistrationPolicy.filingOrganisation(caller).isPresent() : caller.holds(role, "all");
    }

    @Transactional
    public ResponseEntity<Map<String, Object>> transition(Caller caller, UUID id, String key, JsonNode body) {
        Optional<ResponseEntity<Map<String, Object>>> replay = replayOrRequireKey(caller, id, key, body);
        if (replay.isPresent()) {
            return replay.get();
        }
        Optional<Input> parsed = parse(body);
        boolean anyRole = caller.holds("programme", "all") || caller.holds("director", "all") || RegistrationPolicy.filingOrganisation(caller).isPresent();
        if (!anyRole) {
            return error(HttpStatus.FORBIDDEN, "role_not_permitted");
        }
        if (parsed.isEmpty()) {
            return error(HttpStatus.UNPROCESSABLE_ENTITY, "validation_failed");
        }
        Input in = parsed.get();
        var found = registrations.find(id);
        if (found.isEmpty()) {
            return error(HttpStatus.NOT_FOUND, "not_found");
        }
        var row = found.get();
        Optional<String> role = roleFor(in.action(), row.state());
        if (role.isEmpty()) {
            boolean involved = holdsRole(caller, "programme") || holdsRole(caller, "director") || isApplicant(caller, row);
            return error(involved ? HttpStatus.NOT_FOUND : HttpStatus.FORBIDDEN, involved ? "not_found" : "role_not_permitted");
        }
        if (!holdsRole(caller, role.get())) {
            return error(HttpStatus.FORBIDDEN, "role_not_permitted");
        }
        boolean applicant = "applicant".equals(role.get());
        if (applicant && !isApplicant(caller, row)) {
            return error(HttpStatus.NOT_FOUND, "not_found");
        }
        if (!applicant && (caller.organisationIds().contains(row.organisationId()) || caller.accountId().equals(registrations.submitter(id).orElse(null)))) {
            return error(HttpStatus.FORBIDDEN, "segregation_refused");
        }
        if (row.version() != in.version()) {
            return error(HttpStatus.CONFLICT, "version_conflict");
        }
        if (!idempotency.begin(caller.accountId(), "POST", ROUTE, id, key, DraftRequestSupport.bodyHash(body))) {
            return error(HttpStatus.CONFLICT, "idempotency_in_progress");
        }
        if (applicant) {
            var refused = registrationService.refuseAtSubmit(row, LocalDate.now(ModelDraftPolicy.IST));
            if (refused.isPresent()) {
                return fail(caller, id, key, refused.get());
            }
        }

        int versionAfter;
        java.time.Instant at;
        UUID brandId = null;
        UUID authorisationId = null;
        if ("approve".equals(in.action())) {
            var done = registrations.approve(id, caller.accountId(), row.version(), in.note());
            if (!"approved".equals(done.outcome())) {
                return fail(caller, id, key, approveRefusal(done.outcome()));
            }
            versionAfter = done.versionAfter();
            brandId = done.brandId();
            authorisationId = done.authorisationId();
            at = registrations.lastEventAt(id);
        } else {
            try {
                var moved = registrations.transition(id, row.version(), row.state(), target(in.action(), row.state()), in.action(), caller.accountId(),
                    applicant ? (RegistrationPolicy.BRAND.equals(row.kind()) ? "manufacturer" : "agency") : role.get(), in.note());
                if (moved.isEmpty()) {
                    return fail(caller, id, key, error(HttpStatus.CONFLICT, "version_conflict"));
                }
                versionAfter = moved.get().versionAfter();
                at = moved.get().at();
            } catch (DataIntegrityViolationException e) {
                String why = String.valueOf(e.getMostSpecificCause().getMessage());
                if (!why.contains("cannot review") && !why.contains("cannot approve")) {
                    throw e;
                }
                // The database refused the second-person rule; the transaction is spent, so roll it back whole.
                try {
                    TransactionAspectSupport.currentTransactionStatus().setRollbackOnly();
                } catch (org.springframework.transaction.NoTransactionException none) {
                    // not inside a transaction (a test double); nothing to roll back
                }
                return error(HttpStatus.FORBIDDEN, "segregation_refused");
            }
        }
        Map<String, Object> receipt = new LinkedHashMap<>();
        receipt.put("registrationId", id.toString());
        receipt.put("reference", row.reference());
        receipt.put("action", in.action());
        receipt.put("fromState", row.state());
        receipt.put("toState", target(in.action(), row.state()));
        receipt.put("version", versionAfter);
        receipt.put("actedAt", at.toString());
        if (brandId != null) {
            receipt.put("registeredBrandId", brandId.toString());
        }
        if (authorisationId != null) {
            receipt.put("registeredAuthorisationId", authorisationId.toString());
        }
        idempotency.complete(caller.accountId(), "POST", ROUTE, id, key, 200, write(receipt), versionAfter);
        return ResponseEntity.ok(receipt);
    }

    private static boolean isApplicant(Caller caller, RegistrationRepository.Row row) {
        return RegistrationPolicy.filingOrganisation(caller).map(o -> o.equals(row.organisationId())).orElse(false);
    }

    private static ResponseEntity<Map<String, Object>> approveRefusal(String outcome) {
        return switch (outcome) {
            case "version_conflict", "brand_name_taken", "authorisation_overlap" -> error(HttpStatus.CONFLICT, outcome);
            case "period_passed" -> error(HttpStatus.UNPROCESSABLE_ENTITY, "validation_failed");
            case "segregation_refused", "not_permitted", "brand_not_permitted" ->
                error(HttpStatus.FORBIDDEN, "not_permitted".equals(outcome) ? "role_not_permitted" : outcome);
            default -> error(HttpStatus.NOT_FOUND, "not_found");
        };
    }

    /** A replay is shown only to a caller who still holds a role that could have made the request, and can still reach the record. */
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
        var row = registrations.find(id);
        boolean mayReplay = row.isPresent() && (caller.holds("programme", "all") || caller.holds("director", "all") || isApplicant(caller, row.get()));
        if (!mayReplay) {
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

    private ResponseEntity<Map<String, Object>> fail(Caller caller, UUID id, String key, ResponseEntity<Map<String, Object>> response) {
        idempotency.abandon(caller.accountId(), "POST", ROUTE, id, key);
        return response;
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
