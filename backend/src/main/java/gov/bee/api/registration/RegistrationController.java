package gov.bee.api.registration;

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

/** WP04.2b-1: brand and agency registration requests, draft to fee due. */
@RestController
public class RegistrationController {

    private final CallerResolver callers;
    private final RegistrationService registrations;
    private final ObjectMapper json;

    public RegistrationController(CallerResolver callers, RegistrationService registrations, ObjectMapper json) {
        this.callers = callers;
        this.registrations = registrations;
        this.json = json;
    }

    @GetMapping("/api/registrations")
    public ResponseEntity<Map<String, Object>> list(@AuthenticationPrincipal Jwt jwt) {
        var resolved = callers.resolve(jwt);
        return resolved.caller() == null ? denied(resolved.denial()) : registrations.list(resolved.caller());
    }

    @GetMapping("/api/registrations/eligible-brands")
    public ResponseEntity<Map<String, Object>> eligibleBrands(@AuthenticationPrincipal Jwt jwt) {
        var resolved = callers.resolve(jwt);
        return resolved.caller() == null ? denied(resolved.denial()) : registrations.eligibleBrands(resolved.caller());
    }

    @GetMapping("/api/registrations/{id}")
    public ResponseEntity<Map<String, Object>> get(@AuthenticationPrincipal Jwt jwt, @PathVariable("id") String id) {
        var resolved = callers.resolve(jwt);
        if (resolved.caller() == null) {
            return denied(resolved.denial());
        }
        UUID uuid = parse(id);
        return uuid == null ? ApiErrors.response(HttpStatus.NOT_FOUND, "not_found") : registrations.get(resolved.caller(), uuid);
    }

    @GetMapping("/api/registrations/{id}/submission-preview")
    public ResponseEntity<Map<String, Object>> preview(@AuthenticationPrincipal Jwt jwt, @PathVariable("id") String id) {
        var resolved = callers.resolve(jwt);
        if (resolved.caller() == null) {
            return denied(resolved.denial());
        }
        UUID uuid = parse(id);
        return uuid == null ? ApiErrors.response(HttpStatus.NOT_FOUND, "not_found") : registrations.preview(resolved.caller(), uuid);
    }

    @PostMapping("/api/registrations")
    public ResponseEntity<Map<String, Object>> create(@AuthenticationPrincipal Jwt jwt,
                                                      @RequestHeader(value = "Idempotency-Key", required = false) String key,
                                                      @RequestBody String raw) {
        var resolved = callers.resolve(jwt);
        if (resolved.caller() == null) {
            return denied(resolved.denial());
        }
        JsonNode body = body(raw);
        return body == null ? ApiErrors.response(HttpStatus.UNPROCESSABLE_ENTITY, "validation_failed") : registrations.create(resolved.caller(), key, body);
    }

    @PatchMapping("/api/registrations/{id}")
    public ResponseEntity<Map<String, Object>> patch(@AuthenticationPrincipal Jwt jwt, @PathVariable("id") String id,
                                                     @RequestHeader(value = "Idempotency-Key", required = false) String key,
                                                     @RequestBody String raw) {
        var resolved = callers.resolve(jwt);
        if (resolved.caller() == null) {
            return denied(resolved.denial());
        }
        UUID uuid = parse(id);
        if (uuid == null) {
            return ApiErrors.response(HttpStatus.NOT_FOUND, "not_found");
        }
        JsonNode body = body(raw);
        return body == null ? ApiErrors.response(HttpStatus.UNPROCESSABLE_ENTITY, "validation_failed") : registrations.patch(resolved.caller(), uuid, key, body);
    }

    @PostMapping("/api/registrations/{id}/submit")
    public ResponseEntity<Map<String, Object>> submit(@AuthenticationPrincipal Jwt jwt, @PathVariable("id") String id,
                                                      @RequestHeader(value = "Idempotency-Key", required = false) String key,
                                                      @RequestBody String raw) {
        var resolved = callers.resolve(jwt);
        if (resolved.caller() == null) {
            return denied(resolved.denial());
        }
        UUID uuid = parse(id);
        if (uuid == null) {
            return ApiErrors.response(HttpStatus.NOT_FOUND, "not_found");
        }
        JsonNode body = body(raw);
        return body == null ? ApiErrors.response(HttpStatus.UNPROCESSABLE_ENTITY, "validation_failed") : registrations.submit(resolved.caller(), uuid, key, body);
    }

    private JsonNode body(String raw) {
        try {
            return json.readTree(raw == null ? "{}" : raw);
        } catch (Exception e) {
            return null;
        }
    }

    private static UUID parse(String id) {
        try {
            return UUID.fromString(id);
        } catch (IllegalArgumentException e) {
            return null;
        }
    }

    private static ResponseEntity<Map<String, Object>> denied(String code) {
        return ApiErrors.response(HttpStatus.FORBIDDEN, code);
    }
}
