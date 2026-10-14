package gov.bee.api.web;

import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;

/**
 * The one error body of the API contract (docs/wp03/bee-local-api.openapi.json):
 * {"error": stable code, "message": fixed safe text}. The correlation ID travels in the
 * X-Correlation-Id header only. Messages never name a record, token, query or exception.
 */
public final class ApiErrors {

    private static final Map<String, String> MESSAGES = Map.ofEntries(
        Map.entry("unauthenticated", "A valid access token is required."),
        Map.entry("denied_by_default", "This operation is not available."),
        Map.entry("mfa_required", "Sign-in must include a verified one-time code."),
        Map.entry("no_active_account", "There is no active BEE account for this identity."),
        Map.entry("no_effective_role", "There is no active BEE role for this identity."),
        Map.entry("no_read_scope", "This role has no read access to model applications."),
        Map.entry("not_found", "No such record is available to you."),
        Map.entry("no_write_scope", "This role cannot create or edit model application drafts."),
        Map.entry("brand_not_permitted", "This brand is not available to your organisation."),
        Map.entry("not_editable", "Only draft applications can be edited."),
        Map.entry("not_submittable", "Only draft applications can be submitted."),
        Map.entry("rule_not_available", "Required category, standard or fee rules are not available."),
        Map.entry("validation_failed", "The request could not be accepted."),
        Map.entry("role_not_permitted", "This role cannot perform this action."),
        Map.entry("segregation_refused", "A person who acted at another stage of this application, or its own organisation, cannot take this step."),
        Map.entry("amount_mismatch", "The amount received does not match the fee due."),
        Map.entry("assignee_unavailable", "No officer is available to take the next stage."),
        Map.entry("not_returned", "Only a returned application can be resubmitted."),
        Map.entry("iseer_outside_tolerance", "The verified efficiency differs from the declared efficiency by more than the allowed difference."),
        Map.entry("rating_below_threshold", "The verified efficiency is below the lowest star band, so no rating can be assigned."),
        Map.entry("test_report_required", "A test report must be uploaded before the application can be submitted."),
        Map.entry("declared_efficiency_required", "A declared efficiency figure within the allowed range is required before the application can be submitted."),
        Map.entry("test_date_invalid", "A test date that is not in the future and not older than the allowed age is required before the application can be submitted."),
        Map.entry("laboratory_not_accredited", "The laboratory must hold an active accreditation for this category on the test date."),
        Map.entry("standard_not_available", "No applicable standard is in force on the test date."),
        Map.entry("brand_name_taken", "A brand with this name is already registered."),
        Map.entry("delegate_not_eligible", "The person you named cannot take this role: they need an active account, a role of their own, and an organisation in common with you."),
        Map.entry("delegation_exists", "You already have a delegation of this role to this person that is waiting or in force."),
        Map.entry("delegation_not_active", "This delegation is not in force, so it cannot be revoked."),
        Map.entry("revocation_pending", "A closure or revocation is already proposed for this record."),
        Map.entry("target_not_active", "This record is no longer active, or the closing date does not fit its period."),
        Map.entry("closing_date_passed", "The closing date has passed; propose the closure again with a later date."),
        Map.entry("authorisation_overlap", "This agency already holds an authorisation for the brand that overlaps the requested period."),
        Map.entry("duplicate_registration", "A registration request for this brand has already been filed by your organisation."),
        Map.entry("document_required", "A trade licence must be uploaded before the registration request can be submitted."),
        Map.entry("duplicate_model", "Another application already holds this brand and model number."),
        Map.entry("correction_already_pending", "A correction for this receipt is already waiting for a decision."),
        Map.entry("proposal_not_pending", "This proposal has already been decided or withdrawn."),
        Map.entry("effective_date_passed", "The date this rule was to start has passed; propose it again with a later date."),
        Map.entry("rule_conflict", "This rule cannot start on that date because of the rules already in place."),
        Map.entry("version_conflict", "The record has changed since it was loaded."),
        Map.entry("fee_preview_conflict", "The provisional fee changed since it was reviewed."),
        Map.entry("idempotency_key_required", "An Idempotency-Key header is required for this request."),
        Map.entry("idempotency_key_conflict", "This Idempotency-Key was already used with a different request body."),
        Map.entry("idempotency_in_progress", "A request with this Idempotency-Key is still in progress."),
        Map.entry("reversal_already_pending", "A reversal of this fee confirmation is already waiting for a decision."),
        Map.entry("reversal_not_possible", "Work has already started on this application, so the fee confirmation cannot be reversed here."),
        Map.entry("rate_limited", "Too many requests. Wait a moment and try again."),
        Map.entry("service_unavailable", "The service is temporarily unavailable. Try again later."),
        Map.entry("internal_error", "The request could not be completed."));

    /** The code of the error body built on this request thread, for the request log's outcome. */
    private static final ThreadLocal<String> LAST_CODE = new ThreadLocal<>();

    private ApiErrors() {}

    static String lastCode() {
        return LAST_CODE.get();
    }

    static void clearLastCode() {
        LAST_CODE.remove();
    }

    public static Map<String, Object> body(String code) {
        LAST_CODE.set(MESSAGES.containsKey(code) ? code : "internal_error");
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("error", code);
        body.put("message", MESSAGES.getOrDefault(code, MESSAGES.get("internal_error")));
        return body;
    }

    public static ResponseEntity<Map<String, Object>> response(HttpStatus status, String code) {
        return ResponseEntity.status(status).contentType(MediaType.APPLICATION_JSON).body(body(code));
    }

    /** For filters and security handlers that run outside Spring MVC. */
    public static void write(HttpServletResponse response, int status, String code) throws IOException {
        response.setStatus(status);
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.setCharacterEncoding("UTF-8");
        response.getWriter().write("{\"error\":\"" + code + "\",\"message\":\"" + body(code).get("message") + "\"}");
    }
}
