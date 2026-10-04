package gov.bee.api.feerules;

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

/** Fee-rule administration: read the rules and proposals, propose a rule, decide a proposal. Who may do each is the service's call. */
@RestController
public class FeeRuleController {

    private final CallerResolver callers;
    private final FeeRuleService service;
    private final ObjectMapper json;

    public FeeRuleController(CallerResolver callers, FeeRuleService service, ObjectMapper json) {
        this.callers = callers;
        this.service = service;
        this.json = json;
    }

    @GetMapping("/api/fee-rules")
    public ResponseEntity<Map<String, Object>> read(@AuthenticationPrincipal Jwt jwt) {
        var resolved = callers.resolve(jwt);
        if (resolved.caller() == null) {
            return ApiErrors.response(HttpStatus.FORBIDDEN, resolved.denial());
        }
        return service.read(resolved.caller());
    }

    @PostMapping("/api/fee-rules/proposals")
    public ResponseEntity<Map<String, Object>> propose(@AuthenticationPrincipal Jwt jwt,
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
        return service.propose(resolved.caller(), idempotencyKey, body);
    }

    @PostMapping("/api/fee-rules/proposals/{id}/decision")
    public ResponseEntity<Map<String, Object>> decide(@AuthenticationPrincipal Jwt jwt, @PathVariable("id") String id,
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
        return service.decide(resolved.caller(), parseId(id), idempotencyKey, body);
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
