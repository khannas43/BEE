package gov.bee.api.document;

import gov.bee.api.application.IdempotencyRepository;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Function;
import java.util.function.Supplier;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The upload's database step as one transaction: lock the application row, re-check that it is still a
 * draft, write the document header/version, and complete the idempotency record. A failure anywhere rolls
 * all of it back, so a retry with the same key can never see a committed version without a completed key.
 */
@Service
public class DocumentRecorder {

    public record NewVersion(String sha256, long sizeBytes, String filename, String reportLabel, LocalDate testedOn,
                             String laboratoryName) {
    }

    public record Recorded(DocumentRepository.DocumentRow document, List<DocumentRepository.VersionRow> versions) {
    }

    /** The application is gone or no longer a draft when the upload reaches the database. */
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

    private final DocumentRepository documents;
    private final IdempotencyRepository idempotency;

    public DocumentRecorder(DocumentRepository documents, IdempotencyRepository idempotency) {
        this.documents = documents;
        this.idempotency = idempotency;
    }

    /**
     * @param stillAllowed evaluated after the lock and the draft re-check, inside the transaction: a denial code
     *                     (for example a brand authorisation that lapsed during a slow upload) refuses the write
     */
    @Transactional
    public Recorded record(UUID accountId, UUID applicationId, String idempotencyKey, NewVersion version,
                           Supplier<Optional<String>> stillAllowed, Function<Recorded, String> responseBody) {
        String state = documents.lockApplicationState(applicationId)
            .orElseThrow(() -> new Denied(HttpStatus.NOT_FOUND, "not_found"));
        if (!"draft".equals(state) && !"returned".equals(state)) {
            throw new Denied(HttpStatus.FORBIDDEN, "not_editable");
        }
        Optional<String> denial = stillAllowed.get();
        if (denial.isPresent()) {
            throw new Denied(HttpStatus.FORBIDDEN, denial.get());
        }
        DocumentRepository.DocumentRow doc = documents.recordVersion(applicationId, DocumentService.KIND_TEST_REPORT,
            UUID.randomUUID(), version.sha256(), version.sizeBytes(), "application/pdf", version.filename(),
            version.reportLabel(), version.testedOn(), version.laboratoryName(), accountId);
        List<DocumentRepository.VersionRow> versions = documents.listVersions(doc.id());
        if (versions.isEmpty()) {
            throw new IllegalStateException("version not visible after insert");
        }
        Recorded recorded = new Recorded(doc, versions);
        idempotency.complete(accountId, "POST", DocumentService.ROUTE_UPLOAD, applicationId, idempotencyKey, 201,
            responseBody.apply(recorded), versions.get(versions.size() - 1).versionNumber());
        return recorded;
    }
}
