package gov.bee.api.application;

import gov.bee.api.identity.Caller;
import gov.bee.api.identity.CallerResolver;
import gov.bee.api.policy.ApplicationFacts;
import gov.bee.api.policy.SlicePolicy;
import gov.bee.api.policy.SlicePolicy.ReadScope;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;

/**
 * List and read only (FIRST_SLICE.md §7). A record outside the caller's scope and a
 * record that does not exist get the same 404 body, so a read cannot confirm another
 * organisation's IDs. Writes and history are not mapped and stay denied by default.
 */
@RestController
public class ModelApplicationController {

    private final CallerResolver callers;
    private final ModelApplicationRepository applications;

    public ModelApplicationController(CallerResolver callers, ModelApplicationRepository applications) {
        this.callers = callers;
        this.applications = applications;
    }

    @GetMapping("/api/model-applications")
    public ResponseEntity<Map<String, Object>> list(@AuthenticationPrincipal Jwt jwt) {
        var resolved = callers.resolve(jwt);
        if (resolved.caller() == null) {
            return error(HttpStatus.FORBIDDEN, resolved.denial());
        }
        Caller caller = resolved.caller();
        ReadScope scope = SlicePolicy.readScope(caller);
        if (scope.isEmpty()) {
            return error(HttpStatus.FORBIDDEN, "no_read_scope");
        }
        List<Map<String, Object>> items = applications.list(scope, caller.accountId()).stream()
            .filter(r -> SlicePolicy.canRead(scope, facts(r)))
            .map(r -> view(r, scope))
            .toList();
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("items", items);
        body.put("count", items.size());
        body.put("authority", "spring-database");
        return ResponseEntity.ok(body);
    }

    @GetMapping("/api/model-applications/{id}")
    public ResponseEntity<Map<String, Object>> read(@AuthenticationPrincipal Jwt jwt, @PathVariable("id") String id) {
        var resolved = callers.resolve(jwt);
        if (resolved.caller() == null) {
            return error(HttpStatus.FORBIDDEN, resolved.denial());
        }
        Caller caller = resolved.caller();
        ReadScope scope = SlicePolicy.readScope(caller);
        if (scope.isEmpty()) {
            return error(HttpStatus.FORBIDDEN, "no_read_scope");
        }
        UUID appId;
        try {
            appId = UUID.fromString(id);
        } catch (IllegalArgumentException e) {
            return error(HttpStatus.NOT_FOUND, "not_found");
        }
        return applications.find(appId, scope, caller.accountId())
            .filter(r -> SlicePolicy.canRead(scope, facts(r)))
            .map(r -> ResponseEntity.ok(view(r, scope)))
            .orElseGet(() -> error(HttpStatus.NOT_FOUND, "not_found"));
    }

    private static ApplicationFacts facts(ModelApplicationRepository.Row r) {
        return new ApplicationFacts(r.id(), r.organisationId(), r.state(), r.assignedStagesForCaller(), Set.of(), false);
    }

    private static Map<String, Object> view(ModelApplicationRepository.Row r, ReadScope scope) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", r.id().toString());
        m.put("reference", r.reference());
        m.put("organisation", r.organisationCode());
        m.put("brandName", r.brandName());
        m.put("category", r.category());
        m.put("modelNumber", r.modelNumber());
        m.put("state", r.state());
        m.put("version", r.version());
        m.put("readBasis", SlicePolicy.readBasis(scope, facts(r)));
        return m;
    }

    private static ResponseEntity<Map<String, Object>> error(HttpStatus status, String code) {
        return ResponseEntity.status(status).body(Map.of("error", code));
    }
}
