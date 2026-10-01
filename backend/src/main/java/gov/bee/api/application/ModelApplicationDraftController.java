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
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;

/** WP05.1b: create and edit draft model applications; eligible-brand read for the form. Submit and other transitions stay denied. */
@RestController
public class ModelApplicationDraftController {

    private final CallerResolver callers;
    private final ModelApplicationDraftService drafts;
    private final ObjectMapper json;

    public ModelApplicationDraftController(CallerResolver callers, ModelApplicationDraftService drafts, ObjectMapper json) {
        this.callers = callers;
        this.drafts = drafts;
        this.json = json;
    }

    @GetMapping("/api/model-applications/eligible-brands")
    public ResponseEntity<Map<String, Object>> eligibleBrands(@AuthenticationPrincipal Jwt jwt) {
        var resolved = callers.resolve(jwt);
        if (resolved.caller() == null) {
            return error(resolved.denial());
        }
        return drafts.eligibleBrands(resolved.caller());
    }

    @PostMapping("/api/model-applications")
    public ResponseEntity<Map<String, Object>> create(@AuthenticationPrincipal Jwt jwt,
                                                      @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey,
                                                      @RequestBody String rawBody) {
        var resolved = callers.resolve(jwt);
        if (resolved.caller() == null) {
            return error(resolved.denial());
        }
        JsonNode body = parseBody(rawBody);
        if (body == null) {
            return error("validation_failed", HttpStatus.UNPROCESSABLE_ENTITY);
        }
        return drafts.create(resolved.caller(), idempotencyKey, body);
    }

    @PatchMapping("/api/model-applications/{id}")
    public ResponseEntity<Map<String, Object>> patch(@AuthenticationPrincipal Jwt jwt, @PathVariable("id") String id,
                                                     @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey,
                                                     @RequestBody String rawBody) {
        var resolved = callers.resolve(jwt);
        if (resolved.caller() == null) {
            return error(resolved.denial());
        }
        UUID appId;
        try {
            appId = UUID.fromString(id);
        } catch (IllegalArgumentException e) {
            return ApiErrors.response(HttpStatus.NOT_FOUND, "not_found");
        }
        JsonNode body = parseBody(rawBody);
        if (body == null) {
            return error("validation_failed", HttpStatus.UNPROCESSABLE_ENTITY);
        }
        return drafts.patch(resolved.caller(), appId, idempotencyKey, body);
    }

    private JsonNode parseBody(String raw) {
        try {
            return json.readTree(raw == null ? "{}" : raw);
        } catch (Exception e) {
            return null;
        }
    }

    private static ResponseEntity<Map<String, Object>> error(String code) {
        return ApiErrors.response(HttpStatus.FORBIDDEN, code);
    }

    private static ResponseEntity<Map<String, Object>> error(String code, HttpStatus status) {
        return ApiErrors.response(status, code);
    }
}
