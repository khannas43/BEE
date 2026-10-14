package gov.bee.api.registration;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/** WP04.2b-1: the trade-licence document of a registration request and its immutable PDF versions. */
@Repository
public class RegistrationDocumentRepository {

    public static final String KIND = "trade_licence";

    public record DocumentRow(UUID id, UUID applicationId, String documentKind) {
    }

    public record VersionRow(UUID id, UUID documentId, int versionNumber, String contentSha256, long sizeBytes, String mediaType,
                             String originalFilename, String label, UUID uploadedByAccountId, OffsetDateTime uploadedAt) {
    }

    private final JdbcTemplate jdbc;

    public RegistrationDocumentRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    private static DocumentRow doc(ResultSet rs, int i) throws SQLException {
        return new DocumentRow(rs.getObject("id", UUID.class), rs.getObject("application_id", UUID.class), rs.getString("document_kind"));
    }

    private static VersionRow version(ResultSet rs, int i) throws SQLException {
        return new VersionRow(rs.getObject("id", UUID.class), rs.getObject("document_id", UUID.class), rs.getInt("version_number"),
            rs.getString("content_sha256"), rs.getLong("size_bytes"), rs.getString("media_type"), rs.getString("original_filename"),
            rs.getString("label"), rs.getObject("uploaded_by_account_id", UUID.class), rs.getObject("uploaded_at", OffsetDateTime.class));
    }

    public List<DocumentRow> listDocuments(UUID applicationId) {
        return jdbc.query("SELECT id, application_id, document_kind FROM registration_document WHERE application_id = ? ORDER BY created_at",
            RegistrationDocumentRepository::doc, applicationId);
    }

    public Optional<DocumentRow> findDocument(UUID documentId, UUID applicationId) {
        return jdbc.query("SELECT id, application_id, document_kind FROM registration_document WHERE id = ? AND application_id = ?",
            RegistrationDocumentRepository::doc, documentId, applicationId).stream().findFirst();
    }

    public List<VersionRow> listVersions(UUID documentId) {
        return jdbc.query("SELECT id, document_id, version_number, content_sha256, size_bytes, media_type, original_filename, label, "
            + "uploaded_by_account_id, uploaded_at FROM registration_document_version WHERE document_id = ? ORDER BY version_number",
            RegistrationDocumentRepository::version, documentId);
    }

    public Optional<VersionRow> findVersion(UUID versionId, UUID documentId) {
        return jdbc.query("SELECT id, document_id, version_number, content_sha256, size_bytes, media_type, original_filename, label, "
            + "uploaded_by_account_id, uploaded_at FROM registration_document_version WHERE id = ? AND document_id = ?",
            RegistrationDocumentRepository::version, versionId, documentId).stream().findFirst();
    }

    /** Locks the request row for the upload's transaction and returns its state. */
    public Optional<String> lockState(UUID applicationId) {
        return jdbc.query("SELECT state FROM registration_application WHERE id = ? FOR NO KEY UPDATE", (rs, i) -> rs.getString(1), applicationId)
            .stream().findFirst();
    }

    /** Header find-or-create, then the next version. Call only inside the recorder's transaction, after lockState. */
    public DocumentRow recordVersion(UUID applicationId, String sha256, long sizeBytes, String filename, String label, UUID uploader) {
        DocumentRow doc = jdbc.query("SELECT id, application_id, document_kind FROM registration_document WHERE application_id = ? AND document_kind = ?",
            RegistrationDocumentRepository::doc, applicationId, KIND).stream().findFirst().orElseGet(() -> {
                UUID id = UUID.randomUUID();
                jdbc.update("INSERT INTO registration_document (id, application_id, document_kind) VALUES (?, ?, ?)", id, applicationId, KIND);
                return new DocumentRow(id, applicationId, KIND);
            });
        Integer next = jdbc.queryForObject("SELECT coalesce(max(version_number), 0) + 1 FROM registration_document_version WHERE document_id = ?",
            Integer.class, doc.id());
        jdbc.update("INSERT INTO registration_document_version (id, document_id, version_number, content_sha256, size_bytes, media_type, "
            + "original_filename, label, uploaded_by_account_id) VALUES (?, ?, ?, ?, ?, 'application/pdf', ?, ?, ?)",
            UUID.randomUUID(), doc.id(), next, sha256, sizeBytes, filename, label, uploader);
        return doc;
    }
}
