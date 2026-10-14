package gov.bee.api.delegation;

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

/** WP02.4c: read one's delegations, ask to delegate a role, decide a delegation. */
@RestController
public class DelegationController {

    private final CallerResolver callers;
    private final DelegationService service;
    private final ObjectMapper json;

    public DelegationController(CallerResolver callers, DelegationService service, ObjectMapper json) {
        this.callers = callers;
        this.service = service;
        this.json = json;
    }

    @GetMapping("/api/delegations")
    public ResponseEntity<Map<String, Object>> read(@AuthenticationPrincipal Jwt jwt) {
        var resolved = callers.resolve(jwt);
        return resolved.caller() == null ? ApiErrors.response(HttpStatus.FORBIDDEN, resolved.denial()) : service.read(resolved.caller());
    }

    @PostMapping("/api/delegations")
    public ResponseEntity<Map<String, Object>> propose(@AuthenticationPrincipal Jwt jwt, @RequestHeader(value = "Idempotency-Key", required = false) String key,
                                                       @RequestBody(required = false) String raw) {
        var resolved = callers.resolve(jwt);
        if (resolved.caller() == null) {
            return ApiErrors.response(HttpStatus.FORBIDDEN, resolved.denial());
        }
        JsonNode body = body(raw);
        return body == null ? ApiErrors.response(HttpStatus.UNPROCESSABLE_ENTITY, "validation_failed") : service.propose(resolved.caller(), key, body);
    }

    @PostMapping("/api/delegations/{id}/decision")
    public ResponseEntity<Map<String, Object>> decide(@AuthenticationPrincipal Jwt jwt, @PathVariable("id") String id,
                                                      @RequestHeader(value = "Idempotency-Key", required = false) String key,
                                                      @RequestBody(required = false) String raw) {
        var resolved = callers.resolve(jwt);
        if (resolved.caller() == null) {
            return ApiErrors.response(HttpStatus.FORBIDDEN, resolved.denial());
        }
        JsonNode body = body(raw);
        return body == null ? ApiErrors.response(HttpStatus.UNPROCESSABLE_ENTITY, "validation_failed") : service.decide(resolved.caller(), parseId(id), key, body);
    }

    private static UUID parseId(String id) {
        try {
            return UUID.fromString(id);
        } catch (IllegalArgumentException e) {
            return UUID.fromString("00000000-0000-4000-c000-000000000000");
        }
    }

    private JsonNode body(String raw) {
        try {
            return json.readTree(raw == null ? "{}" : raw);
        } catch (Exception e) {
            return null;
        }
    }
}
