package gov.bee.api.manufactureronboarding;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import gov.bee.api.identity.CallerResolver;
import gov.bee.api.web.ApiErrors;
import java.util.HexFormat;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

@RestController
public class ManufacturerOnboardingController {

    private final CallerResolver callers;
    private final ManufacturerOnboardingService service;
    private final ManufacturerOnboardingDocumentRepository documents;
    private final ObjectMapper json;

    public ManufacturerOnboardingController(CallerResolver callers, ManufacturerOnboardingService service,
                                            ManufacturerOnboardingDocumentRepository documents, ObjectMapper json) {
        this.callers = callers;
        this.service = service;
        this.documents = documents;
        this.json = json;
    }

    @GetMapping("/api/manufacturer-onboarding")
    public ResponseEntity<Map<String, Object>> list(@AuthenticationPrincipal Jwt jwt) {
        var resolved = callers.resolve(jwt);
        return resolved.caller() == null ? denied(resolved.denial()) : service.list(resolved.caller());
    }

    @PostMapping("/api/manufacturer-onboarding")
    public ResponseEntity<Map<String, Object>> create(@AuthenticationPrincipal Jwt jwt,
                                                        @RequestHeader(value = "Idempotency-Key", required = false) String key,
                                                        @RequestBody(required = false) String raw) {
        var resolved = callers.resolve(jwt);
        if (resolved.caller() == null) {
            return denied(resolved.denial());
        }
        JsonNode body = parse(raw);
        return body == null ? ApiErrors.response(HttpStatus.UNPROCESSABLE_ENTITY, "validation_failed")
            : service.create(resolved.caller(), key, body);
    }

    @GetMapping("/api/manufacturer-onboarding/{id}")
    public ResponseEntity<Map<String, Object>> get(@AuthenticationPrincipal Jwt jwt, @PathVariable("id") String id) {
        var resolved = callers.resolve(jwt);
        return resolved.caller() == null ? denied(resolved.denial()) : service.get(resolved.caller(), uuid(id));
    }

    @PatchMapping("/api/manufacturer-onboarding/{id}")
    public ResponseEntity<Map<String, Object>> patch(@AuthenticationPrincipal Jwt jwt, @PathVariable("id") String id,
                                                       @RequestBody(required = false) String raw) {
        var resolved = callers.resolve(jwt);
        if (resolved.caller() == null) {
            return denied(resolved.denial());
        }
        JsonNode body = parse(raw);
        return body == null ? ApiErrors.response(HttpStatus.UNPROCESSABLE_ENTITY, "validation_failed")
            : service.patch(resolved.caller(), uuid(id), body);
    }

    @GetMapping("/api/manufacturer-onboarding/{id}/submit")
    public ResponseEntity<Map<String, Object>> submitPreview(@AuthenticationPrincipal Jwt jwt, @PathVariable("id") String id) {
        var resolved = callers.resolve(jwt);
        return resolved.caller() == null ? denied(resolved.denial()) : service.submitPreview(resolved.caller(), uuid(id));
    }

    @PostMapping("/api/manufacturer-onboarding/{id}/submit")
    public ResponseEntity<Map<String, Object>> submit(@AuthenticationPrincipal Jwt jwt, @PathVariable("id") String id,
                                                       @RequestHeader(value = "Idempotency-Key", required = false) String key,
                                                       @RequestBody(required = false) String raw) {
        var resolved = callers.resolve(jwt);
        if (resolved.caller() == null) {
            return denied(resolved.denial());
        }
        JsonNode body = parse(raw);
        return body == null ? ApiErrors.response(HttpStatus.UNPROCESSABLE_ENTITY, "validation_failed")
            : service.submit(resolved.caller(), uuid(id), key, body);
    }

    @PostMapping("/api/manufacturer-onboarding/{id}/director-decision")
    public ResponseEntity<Map<String, Object>> directorDecision(@AuthenticationPrincipal Jwt jwt, @PathVariable("id") String id,
                                                                  @RequestHeader(value = "Idempotency-Key", required = false) String key,
                                                                  @RequestBody(required = false) String raw) {
        var resolved = callers.resolve(jwt);
        if (resolved.caller() == null) {
            return denied(resolved.denial());
        }
        JsonNode body = parse(raw);
        return body == null ? ApiErrors.response(HttpStatus.UNPROCESSABLE_ENTITY, "validation_failed")
            : service.directorDecision(resolved.caller(), uuid(id), key, body);
    }

    @PostMapping("/api/manufacturer-onboarding/{id}/anomalies")
    public ResponseEntity<Map<String, Object>> raiseAnomaly(@AuthenticationPrincipal Jwt jwt, @PathVariable("id") String id,
                                                              @RequestHeader(value = "Idempotency-Key", required = false) String key,
                                                              @RequestBody(required = false) String raw) {
        var resolved = callers.resolve(jwt);
        if (resolved.caller() == null) {
            return denied(resolved.denial());
        }
        JsonNode body = parse(raw);
        return body == null ? ApiErrors.response(HttpStatus.UNPROCESSABLE_ENTITY, "validation_failed")
            : service.raiseAnomaly(resolved.caller(), uuid(id), key, body);
    }

    @PostMapping("/api/manufacturer-onboarding/{id}/anomaly-resolution")
    public ResponseEntity<Map<String, Object>> resolveAnomaly(@AuthenticationPrincipal Jwt jwt, @PathVariable("id") String id,
                                                                @RequestHeader(value = "Idempotency-Key", required = false) String key,
                                                                @RequestBody(required = false) String raw) {
        var resolved = callers.resolve(jwt);
        if (resolved.caller() == null) {
            return denied(resolved.denial());
        }
        JsonNode body = parse(raw);
        return body == null ? ApiErrors.response(HttpStatus.UNPROCESSABLE_ENTITY, "validation_failed")
            : service.resolveAnomaly(resolved.caller(), uuid(id), key, body);
    }

    @GetMapping("/api/manufacturer-onboarding/{id}/documents")
    public ResponseEntity<Map<String, Object>> listDocuments(@AuthenticationPrincipal Jwt jwt, @PathVariable("id") String id) {
        var resolved = callers.resolve(jwt);
        return resolved.caller() == null ? denied(resolved.denial()) : service.listDocuments(resolved.caller(), uuid(id));
    }

    @PostMapping(path = "/api/manufacturer-onboarding/{id}/documents", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<Map<String, Object>> upload(@AuthenticationPrincipal Jwt jwt, @PathVariable("id") String id,
                                                      @RequestParam(value = "file", required = false) MultipartFile file,
                                                      @RequestParam(value = "documentKind", required = false) String documentKind,
                                                      @RequestParam(value = "label", required = false) String label,
                                                      @RequestParam(value = "issueOn", required = false) String issueOn,
                                                      @RequestParam(value = "expiresOn", required = false) String expiresOn) {
        var resolved = callers.resolve(jwt);
        if (resolved.caller() == null) {
            return denied(resolved.denial());
        }
        var org = ManufacturerOnboardingPolicy.filingOrganisation(resolved.caller());
        if (org.isEmpty()) {
            return ApiErrors.response(HttpStatus.FORBIDDEN, "no_write_scope");
        }
        UUID appId = uuid(id);
        if (service.get(resolved.caller(), appId).getStatusCode() == HttpStatus.NOT_FOUND) {
            return ApiErrors.response(HttpStatus.NOT_FOUND, "not_found");
        }
        if (file == null || file.isEmpty()) {
            return ApiErrors.response(HttpStatus.UNPROCESSABLE_ENTITY, "validation_failed");
        }
        Optional<String> state = documents.readStateForUpload(appId);
        if (state.isEmpty() || !ManufacturerOnboardingPolicy.editable(state.get())) {
            return ApiErrors.response(HttpStatus.FORBIDDEN, "not_editable");
        }
        String kind = documentKind == null || documentKind.isBlank() ? "trade_licence" : documentKind.trim();
        if (!ManufacturerOnboardingDocumentRepository.DOCUMENT_KINDS.contains(kind)) {
            return ApiErrors.response(HttpStatus.UNPROCESSABLE_ENTITY, "validation_failed");
        }
        try {
            byte[] bytes = file.getBytes();
            byte[] digest = java.security.MessageDigest.getInstance("SHA-256").digest(bytes);
            java.time.LocalDate issue = issueOn == null || issueOn.isBlank() ? null : java.time.LocalDate.parse(issueOn);
            java.time.LocalDate expiry = expiresOn == null || expiresOn.isBlank() ? null : java.time.LocalDate.parse(expiresOn);
            documents.recordVersion(org.get(), appId, kind, HexFormat.of().formatHex(digest), bytes.length,
                file.getOriginalFilename() == null ? "document.pdf" : file.getOriginalFilename(),
                label == null || label.isBlank() ? kind : label, issue, expiry, resolved.caller().accountId());
            return service.get(resolved.caller(), appId);
        } catch (IllegalArgumentException e) {
            return ApiErrors.response(HttpStatus.UNPROCESSABLE_ENTITY, "validation_failed");
        } catch (Exception e) {
            return ApiErrors.response(HttpStatus.UNPROCESSABLE_ENTITY, "validation_failed");
        }
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

    private static UUID uuid(String id) {
        try {
            return UUID.fromString(id);
        } catch (Exception e) {
            return UUID.fromString("00000000-0000-0000-0000-000000000000");
        }
    }

    private static ResponseEntity<Map<String, Object>> denied(String code) {
        return ApiErrors.response(HttpStatus.FORBIDDEN, code);
    }
}
