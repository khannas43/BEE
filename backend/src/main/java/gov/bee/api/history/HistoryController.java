package gov.bee.api.history;

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
import org.springframework.web.bind.annotation.RestController;

/** The history read of one application. Read-only; the same scope as reading the application itself. */
@RestController
public class HistoryController {

    private final CallerResolver callers;
    private final HistoryService service;

    public HistoryController(CallerResolver callers, HistoryService service) {
        this.callers = callers;
        this.service = service;
    }

    @GetMapping("/api/model-applications/{id}/history")
    public ResponseEntity<Map<String, Object>> read(@AuthenticationPrincipal Jwt jwt, @PathVariable("id") String id) {
        var resolved = callers.resolve(jwt);
        if (resolved.caller() == null) {
            return ApiErrors.response(HttpStatus.FORBIDDEN, resolved.denial());
        }
        UUID appId;
        try {
            appId = UUID.fromString(id);
        } catch (IllegalArgumentException e) {
            return ApiErrors.response(HttpStatus.NOT_FOUND, "not_found");
        }
        return service.read(resolved.caller(), appId);
    }
}
