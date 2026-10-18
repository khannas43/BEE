package gov.bee.api.manufactureronboarding;

import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class ManufacturerOnboardingDocumentRepository {

    public static final String KIND = "trade_licence";

    private final JdbcTemplate jdbc;

    public ManufacturerOnboardingDocumentRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public Optional<String> lockState(UUID applicationId) {
        return jdbc.query("SELECT state FROM manufacturer_onboarding_application WHERE id = ? FOR NO KEY UPDATE", (rs, i) -> rs.getString(1), applicationId)
            .stream().findFirst();
    }

    public void recordVersion(UUID applicationId, String sha256, long sizeBytes, String filename, String label, UUID uploader) {
        UUID docId = jdbc.query("SELECT id FROM manufacturer_onboarding_document WHERE application_id = ? AND document_kind = ?",
            (rs, i) -> rs.getObject("id", UUID.class), applicationId, KIND).stream().findFirst().orElseGet(() -> {
                UUID id = UUID.randomUUID();
                jdbc.update("INSERT INTO manufacturer_onboarding_document (id, application_id, document_kind) VALUES (?, ?, ?)", id, applicationId, KIND);
                return id;
            });
        Integer next = jdbc.queryForObject("SELECT coalesce(max(version_number), 0) + 1 FROM manufacturer_onboarding_document_version WHERE document_id = ?",
            Integer.class, docId);
        jdbc.update("INSERT INTO manufacturer_onboarding_document_version (id, document_id, version_number, content_sha256, size_bytes, media_type, "
            + "original_filename, label, uploaded_by_account_id) VALUES (?, ?, ?, ?, ?, 'application/pdf', ?, ?, ?)",
            UUID.randomUUID(), docId, next, sha256, sizeBytes, filename, label, uploader);
    }
}
