package gov.bee.api.application;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import gov.bee.api.identity.CallerResolver;
import gov.bee.api.web.ApiErrors;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;

/** WP05.1c: submit draft model application → fee_due. */
@RestController
public class ModelApplicationSubmitController {

    private final CallerResolver callers;
    private final ModelApplicationSubmitService submit;
    private final ObjectMapper json;

    public ModelApplicationSubmitController(CallerResolver callers, ModelApplicationSubmitService submit, ObjectMapper json) {
        this.callers = callers;
        this.submit = submit;
        this.json = json;
    }

    @GetMapping("/api/model-applications/{id}/submit")
    public ResponseEntity<Map<String, Object>> preview(@AuthenticationPrincipal Jwt jwt, @PathVariable("id") String id) {
        var resolved = callers.resolve(jwt);
        if (resolved.caller() == null) {
            return ApiErrors.response(HttpStatus.FORBIDDEN, resolved.denial());
        }
        return submit.preview(resolved.caller(), parseId(id));
    }

    @PostMapping("/api/model-applications/{id}/submit")
    public ResponseEntity<Map<String, Object>> submit(@AuthenticationPrincipal Jwt jwt, @PathVariable("id") String id,
                                                      @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey,
                                                      @RequestBody(required = false) String rawBody) {
        var resolved = callers.resolve(jwt);
        if (resolved.caller() == null) {
            return ApiErrors.response(HttpStatus.FORBIDDEN, resolved.denial());
        }
        JsonNode body = parseBody(rawBody);
        if (body == null) {
            return ApiErrors.response(HttpStatus.UNPROCESSABLE_ENTITY, "validation_failed");
        }
        return submit.submit(resolved.caller(), parseId(id), idempotencyKey, body);
    }

    private static UUID parseId(String id) {
        try {
            return UUID.fromString(id);
        } catch (IllegalArgumentException e) {
            return UUID.fromString("00000000-0000-4000-c000-000000000000");
        }
    }

    private JsonNode parseBody(String raw) {
        try {
            return json.readTree(raw == null ? "{}" : raw);
        } catch (Exception e) {
            return null;
        }
    }
}
