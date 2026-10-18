package gov.bee.api.manufactureronboarding;

import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class ManufacturerOnboardingDocumentRepository {

    public static final Set<String> DOCUMENT_KINDS = Set.of(
        "trade_licence", "certificate_of_incorporation", "gst_certificate", "pan_card", "signatory_photo_id",
        "facility_address_proof", "signed_declaration", "signed_agreement", "annexure_supporting");

    private final JdbcTemplate jdbc;

    public ManufacturerOnboardingDocumentRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public Optional<String> lockState(UUID applicationId) {
        return jdbc.query("SELECT state FROM manufacturer_onboarding_application WHERE id = ? FOR NO KEY UPDATE", (rs, i) -> rs.getString(1), applicationId)
            .stream().findFirst();
    }

    public void recordVersion(UUID applicationId, String documentKind, String sha256, long sizeBytes, String filename, String label,
                              LocalDate issueOn, LocalDate expiresOn, UUID uploader) {
        if (!DOCUMENT_KINDS.contains(documentKind)) {
            throw new IllegalArgumentException("document_kind_invalid");
        }
        UUID docId = jdbc.query("SELECT id FROM manufacturer_onboarding_document WHERE application_id = ? AND document_kind = ?",
            (rs, i) -> rs.getObject("id", UUID.class), applicationId, documentKind).stream().findFirst().orElseGet(() -> {
                UUID id = UUID.randomUUID();
                jdbc.update("INSERT INTO manufacturer_onboarding_document (id, application_id, document_kind) VALUES (?, ?, ?)", id, applicationId,
                    documentKind);
                return id;
            });
        Integer next = jdbc.queryForObject("SELECT coalesce(max(version_number), 0) + 1 FROM manufacturer_onboarding_document_version WHERE document_id = ?",
            Integer.class, docId);
        jdbc.update("INSERT INTO manufacturer_onboarding_document_version (id, document_id, version_number, content_sha256, size_bytes, media_type, "
            + "original_filename, label, uploaded_by_account_id, issue_on, expires_on) VALUES (?, ?, ?, ?, ?, 'application/pdf', ?, ?, ?, ?, ?)",
            UUID.randomUUID(), docId, next, sha256, sizeBytes, filename, label, uploader, issueOn, expiresOn);
    }

    public List<ManufacturerOnboardingRepository.DocumentHead> list(UUID applicationId) {
        return jdbc.query("""
            SELECT d.document_kind,
                   coalesce(max(v.version_number), 0) AS latest_version,
                   CASE WHEN count(v.id) = 0 THEN 'missing'
                        WHEN max(v.expires_on) IS NOT NULL AND max(v.expires_on) < (now() AT TIME ZONE 'Asia/Kolkata')::date THEN 'expired'
                        ELSE 'uploaded' END AS status,
                   max(v.expires_on) AS expires_on
              FROM manufacturer_onboarding_document d
              LEFT JOIN manufacturer_onboarding_document_version v ON v.document_id = d.id
             WHERE d.application_id = ?
             GROUP BY d.document_kind
            """, (rs, i) -> {
            var exp = rs.getDate(4);
            return new ManufacturerOnboardingRepository.DocumentHead(rs.getString(1), rs.getInt(2), rs.getString(3),
                exp == null ? null : exp.toLocalDate());
        }, applicationId);
    }
}
