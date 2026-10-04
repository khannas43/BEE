package gov.bee.api.director;

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
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;

/** Scaffolded by scripts/local/new-feature.cjs. TODO(director-recommendation): describe the command. */
@RestController
public class DirectorRecommendationController {

    private final CallerResolver callers;
    private final DirectorRecommendationService service;
    private final ObjectMapper json;

    public DirectorRecommendationController(CallerResolver callers, DirectorRecommendationService service, ObjectMapper json) {
        this.callers = callers;
        this.service = service;
        this.json = json;
    }

    @PostMapping("/api/model-applications/{id}/director-recommendation")
    public ResponseEntity<Map<String, Object>> run(@AuthenticationPrincipal Jwt jwt, @PathVariable("id") String id,
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
        return service.run(resolved.caller(), parseId(id), idempotencyKey, body);
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
