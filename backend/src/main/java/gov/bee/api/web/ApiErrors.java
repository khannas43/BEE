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
