package gov.bee.api.document;

import gov.bee.api.identity.CallerResolver;
import gov.bee.api.web.ApiErrors;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

/** WP06.1a: local test-report document intake for model application drafts. */
@RestController
public class DocumentController {

    private final CallerResolver callers;
    private final DocumentService documents;

    public DocumentController(CallerResolver callers, DocumentService documents) {
        this.callers = callers;
        this.documents = documents;
    }

    @GetMapping("/api/model-applications/{id}/documents")
    public ResponseEntity<Map<String, Object>> list(@AuthenticationPrincipal Jwt jwt, @PathVariable("id") String id) {
        var resolved = callers.resolve(jwt);
        if (resolved.caller() == null) {
            return ApiErrors.response(HttpStatus.FORBIDDEN, resolved.denial());
        }
        return documents.list(resolved.caller(), parseId(id));
    }

    /** Parts are optional here so the caller is authorised first; the service answers 422 for a missing one. */
    @PostMapping(path = "/api/model-applications/{id}/documents", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<Map<String, Object>> upload(@AuthenticationPrincipal Jwt jwt,
                                                      @PathVariable("id") String id,
                                                      @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey,
                                                      @RequestParam(value = "file", required = false) MultipartFile file,
                                                      @RequestParam(value = "documentKind", required = false) String documentKind,
                                                      @RequestParam(value = "reportLabel", required = false) String reportLabel,
                                                      @RequestParam(value = "testedOn", required = false) String testedOn,
                                                      @RequestParam(value = "laboratoryName", required = false) String laboratoryName) {
        var resolved = callers.resolve(jwt);
        if (resolved.caller() == null) {
            return ApiErrors.response(HttpStatus.FORBIDDEN, resolved.denial());
        }
        return documents.upload(resolved.caller(), parseId(id), idempotencyKey, file, documentKind, reportLabel, testedOn,
            laboratoryName);
    }

    @GetMapping("/api/model-applications/{id}/documents/{documentId}/versions/{versionId}/content")
    public ResponseEntity<?> content(@AuthenticationPrincipal Jwt jwt,
                                     @PathVariable("id") String id,
                                     @PathVariable("documentId") String documentId,
                                     @PathVariable("versionId") String versionId) {
        var resolved = callers.resolve(jwt);
        if (resolved.caller() == null) {
            return ApiErrors.response(HttpStatus.FORBIDDEN, resolved.denial());
        }
        return documents.content(resolved.caller(), parseId(id), parseId(documentId), parseId(versionId));
    }

    private static UUID parseId(String id) {
        try {
            return UUID.fromString(id);
        } catch (IllegalArgumentException e) {
            return UUID.fromString("00000000-0000-4000-c000-000000000000");
        }
    }
}
