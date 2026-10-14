package gov.bee.api.registration;

import gov.bee.api.application.IdempotencyRepository;
import java.util.List;
import java.util.UUID;
import java.util.function.Function;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** The upload's database step as one transaction: lock the request, re-check it is a draft, write the version and complete the idempotency key. */
@Service
public class RegistrationDocumentRecorder {

    public record Recorded(RegistrationDocumentRepository.DocumentRow document, List<RegistrationDocumentRepository.VersionRow> versions) {
    }

    public static final class Denied extends RuntimeException {
        private final HttpStatus status;
        private final String code;

        Denied(HttpStatus status, String code) {
            super(code);
            this.status = status;
            this.code = code;
        }

        public HttpStatus status() {
            return status;
        }

        public String code() {
            return code;
        }
    }

    private final RegistrationDocumentRepository documents;
    private final IdempotencyRepository idempotency;

    public RegistrationDocumentRecorder(RegistrationDocumentRepository documents, IdempotencyRepository idempotency) {
        this.documents = documents;
        this.idempotency = idempotency;
    }

    @Transactional
    public Recorded record(UUID accountId, UUID applicationId, String key, String sha256, long size, String filename, String label,
                           Function<Recorded, String> responseBody) {
        String state = documents.lockState(applicationId).orElseThrow(() -> new Denied(HttpStatus.NOT_FOUND, "not_found"));
        if (!RegistrationPolicy.editable(state)) {
            throw new Denied(HttpStatus.FORBIDDEN, "not_editable");
        }
        var doc = documents.recordVersion(applicationId, sha256, size, filename, label, accountId);
        var versions = documents.listVersions(doc.id());
        Recorded recorded = new Recorded(doc, versions);
        idempotency.complete(accountId, "POST", RegistrationDocumentService.ROUTE_UPLOAD, applicationId, key, 201, responseBody.apply(recorded),
            versions.get(versions.size() - 1).versionNumber());
        return recorded;
    }
}
