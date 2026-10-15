package gov.bee.api.demo;

import gov.bee.api.identity.CallerResolver;
import gov.bee.api.web.ApiErrors;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * The one entry for the demonstration areas (payment simulation, QR batches, simulated ledger, production, MIS, AI). Only a signed-in person
 * with an effective role gets through; the module then decides what that person may see or do. An unknown module is a 404. Every response
 * carries {@code "demonstration": true}. This family is outside the documented API contract on purpose (BL-220).
 */
@RestController
public class DemoController {

    private final CallerResolver callers;
    private final Map<String, DemoModule> modules = new LinkedHashMap<>();

    public DemoController(CallerResolver callers, List<DemoModule> found) {
        this.callers = callers;
        found.forEach(m -> modules.put(m.name(), m));
    }

    @GetMapping({"/api/demo/{module}", "/api/demo/{module}/{id}", "/api/demo/{module}/{id}/{action}"})
    @Transactional
    public ResponseEntity<Map<String, Object>> get(@AuthenticationPrincipal Jwt jwt, @PathVariable("module") String module,
                                                   @PathVariable(value = "id", required = false) String id,
                                                   @PathVariable(value = "action", required = false) String action,
                                                   @RequestParam Map<String, String> query) {
        return run(jwt, "GET", module, id, action, query, Map.of());
    }

    @PostMapping({"/api/demo/{module}", "/api/demo/{module}/{id}", "/api/demo/{module}/{id}/{action}"})
    @Transactional
    public ResponseEntity<Map<String, Object>> post(@AuthenticationPrincipal Jwt jwt, @PathVariable("module") String module,
                                                    @PathVariable(value = "id", required = false) String id,
                                                    @PathVariable(value = "action", required = false) String action,
                                                    @RequestParam Map<String, String> query,
                                                    @RequestBody(required = false) Map<String, Object> body) {
        return run(jwt, "POST", module, id, action, query, body == null ? Map.of() : body);
    }

    private ResponseEntity<Map<String, Object>> run(Jwt jwt, String method, String module, String id, String action,
                                                    Map<String, String> query, Map<String, Object> body) {
        var resolved = callers.resolve(jwt);
        if (resolved.caller() == null) {
            return ApiErrors.response(HttpStatus.FORBIDDEN, resolved.denial());
        }
        DemoModule target = modules.get(module);
        if (target == null) {
            return ApiErrors.response(HttpStatus.NOT_FOUND, "not_found");
        }
        DemoResult result = target.handle(resolved.caller(), method, id, action, query, body);
        if (result.code() != null) {
            ResponseEntity<Map<String, Object>> error = ApiErrors.response(result.status(), result.code());
            if (result.detail() == null) {
                return error;
            }
            Map<String, Object> withDetail = new LinkedHashMap<>(error.getBody());
            withDetail.put("detail", result.detail());
            return ResponseEntity.status(result.status()).headers(error.getHeaders()).body(withDetail);
        }
        Map<String, Object> out = new LinkedHashMap<>(result.body());
        out.put("demonstration", true);
        return ResponseEntity.status(result.status()).body(out);
    }
}
