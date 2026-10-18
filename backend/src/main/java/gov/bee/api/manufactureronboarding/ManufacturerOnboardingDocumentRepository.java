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

    public int recordVersion(UUID organisationId, UUID applicationId, String documentKind, String sha256, long sizeBytes, String filename, String label,
                             LocalDate issueOn, LocalDate expiresOn, UUID uploader) {
        if (!DOCUMENT_KINDS.contains(documentKind)) {
            throw new IllegalArgumentException("document_kind_invalid");
        }
        Integer version = jdbc.queryForObject("""
            SELECT manufacturer_onboarding_trusted_append_document(?, ?, ?, ?, ?::char(64), ?, ?, ?, ?, ?)
            """, Integer.class, uploader, applicationId, organisationId, documentKind, sha256, sizeBytes, filename, label, issueOn, expiresOn);
        return version == null ? 0 : version;
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
