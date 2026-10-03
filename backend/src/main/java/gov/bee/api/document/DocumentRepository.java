package gov.bee.api.document;

import java.sql.Date;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

@Repository
public class DocumentRepository {

    public record DocumentRow(UUID id, UUID applicationId, String documentKind, Instant createdAt) {
    }

    public record VersionRow(UUID id, UUID documentId, int versionNumber, String contentSha256, long sizeBytes,
                             String mediaType, String originalFilename, String reportLabel, LocalDate testedOn,
                             String laboratoryName, UUID uploadedByAccountId, Instant uploadedAt) {
    }

    private final JdbcTemplate jdbc;

    public DocumentRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public Optional<DocumentRow> findByApplicationAndKind(UUID applicationId, String kind) {
        return jdbc.query(
            "SELECT id, application_id, document_kind, created_at FROM model_application_document "
                + "WHERE application_id = ? AND document_kind = ?",
            this::mapDocument, applicationId, kind).stream().findFirst();
    }

    public Optional<DocumentRow> findDocument(UUID documentId, UUID applicationId) {
        return jdbc.query(
            "SELECT id, application_id, document_kind, created_at FROM model_application_document "
                + "WHERE id = ? AND application_id = ?",
            this::mapDocument, documentId, applicationId).stream().findFirst();
    }

    public DocumentRow insertDocument(UUID id, UUID applicationId, String kind) {
        jdbc.update(
            "INSERT INTO model_application_document (id, application_id, document_kind) VALUES (?, ?, ?)",
            id, applicationId, kind);
        return findDocument(id, applicationId).orElseThrow();
    }

    /**
     * Takes the application row's NO KEY UPDATE lock and returns its current state. Concurrent uploads for
     * one application queue behind each other, and a submit (which updates the row) cannot interleave with
     * an upload that has already seen state 'draft'. Must run inside the caller's transaction.
     */
    public Optional<String> lockApplicationState(UUID applicationId) {
        return jdbc.query("SELECT state FROM model_application WHERE id = ? FOR NO KEY UPDATE",
            (rs, i) -> rs.getString(1), applicationId).stream().findFirst();
    }

    /** Header find-or-create, version numbering and version insert commit together or not at all. */
    @Transactional
    public DocumentRow recordVersion(UUID applicationId, String kind, UUID versionId, String sha256, long sizeBytes,
                                     String mediaType, String filename, String reportLabel, LocalDate testedOn,
                                     String laboratoryName, UUID uploader) {
        DocumentRow doc = findByApplicationAndKind(applicationId, kind)
            .orElseGet(() -> insertDocument(UUID.randomUUID(), applicationId, kind));
        insertVersion(versionId, doc.id(), nextVersionNumber(doc.id()), sha256, sizeBytes, mediaType, filename,
            reportLabel, testedOn, laboratoryName, uploader);
        return doc;
    }

    public int nextVersionNumber(UUID documentId) {
        Integer n = jdbc.queryForObject(
            "SELECT coalesce(max(version_number), 0) + 1 FROM model_application_document_version WHERE document_id = ?",
            Integer.class, documentId);
        return n == null ? 1 : n;
    }

    public VersionRow insertVersion(UUID id, UUID documentId, int versionNumber, String sha256, long sizeBytes,
                                    String mediaType, String filename, String reportLabel, LocalDate testedOn,
                                    String laboratoryName, UUID uploader) {
        jdbc.update(
            "INSERT INTO model_application_document_version "
                + "(id, document_id, version_number, content_sha256, size_bytes, media_type, original_filename, "
                + "report_label, tested_on, laboratory_name, uploaded_by_account_id) "
                + "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            id, documentId, versionNumber, sha256, sizeBytes, mediaType, filename, reportLabel,
            testedOn == null ? null : Date.valueOf(testedOn), laboratoryName, uploader);
        return findVersion(id, documentId).orElseThrow();
    }

    public List<DocumentRow> listDocuments(UUID applicationId) {
        return jdbc.query(
            "SELECT id, application_id, document_kind, created_at FROM model_application_document "
                + "WHERE application_id = ? ORDER BY document_kind",
            this::mapDocument, applicationId);
    }

    public List<VersionRow> listVersions(UUID documentId) {
        return jdbc.query(
            "SELECT id, document_id, version_number, content_sha256, size_bytes, media_type, original_filename, "
                + "report_label, tested_on, laboratory_name, uploaded_by_account_id, uploaded_at "
                + "FROM model_application_document_version WHERE document_id = ? ORDER BY version_number",
            this::mapVersion, documentId);
    }

    public Optional<VersionRow> findVersion(UUID versionId, UUID documentId) {
        return jdbc.query(
            "SELECT id, document_id, version_number, content_sha256, size_bytes, media_type, original_filename, "
                + "report_label, tested_on, laboratory_name, uploaded_by_account_id, uploaded_at "
                + "FROM model_application_document_version WHERE id = ? AND document_id = ?",
            this::mapVersion, versionId, documentId).stream().findFirst();
    }

    private DocumentRow mapDocument(ResultSet rs, int i) throws SQLException {
        return new DocumentRow(rs.getObject(1, UUID.class), rs.getObject(2, UUID.class), rs.getString(3),
            rs.getTimestamp(4).toInstant());
    }

    private VersionRow mapVersion(ResultSet rs, int i) throws SQLException {
        Date tested = rs.getDate(9);
        return new VersionRow(
            rs.getObject(1, UUID.class),
            rs.getObject(2, UUID.class),
            rs.getInt(3),
            rs.getString(4),
            rs.getLong(5),
            rs.getString(6),
            rs.getString(7),
            rs.getString(8),
            tested == null ? null : tested.toLocalDate(),
            rs.getString(10),
            rs.getObject(11, UUID.class),
            rs.getTimestamp(12).toInstant());
    }
}
