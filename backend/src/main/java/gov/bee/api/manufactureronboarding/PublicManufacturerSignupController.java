package gov.bee.api.manufactureronboarding;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import gov.bee.api.web.ApiErrors;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class PublicManufacturerSignupController {

    private final ManufacturerOnboardingService service;
    private final ManufacturerSignupRateLimiter limiter;
    private final ObjectMapper json;

    public PublicManufacturerSignupController(ManufacturerOnboardingService service, ManufacturerSignupRateLimiter limiter, ObjectMapper json) {
        this.service = service;
        this.limiter = limiter;
        this.json = json;
    }

    @PostMapping("/api/public/manufacturer-signup")
    public ResponseEntity<Map<String, Object>> signup(@RequestHeader(value = "Idempotency-Key", required = false) String key,
                                                       @RequestBody(required = false) String raw) {
        var wait = limiter.tryAcquire();
        if (wait.isPresent()) {
            return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS).header("Retry-After", String.valueOf(wait.getAsInt()))
                .contentType(MediaType.APPLICATION_JSON).body(ApiErrors.body("rate_limited"));
        }
        JsonNode body = parse(raw);
        return body == null ? ApiErrors.response(HttpStatus.UNPROCESSABLE_ENTITY, "validation_failed")
            : service.publicSignup(key, body);
    }

    private JsonNode parse(String raw) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        try {
            return json.readTree(raw);
        } catch (Exception e) {
            return null;
        }
    }
}
