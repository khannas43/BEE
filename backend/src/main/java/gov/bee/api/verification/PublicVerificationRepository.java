package gov.bee.api.verification;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/** Reads the one view that holds what anyone may see about a certificate (decision D8). Nothing else is reachable from the public route. */
@Repository
public class PublicVerificationRepository {

    public record PublicCertificate(String registrationId, String manufacturer, String brandName, String modelNumber, String category, int stars,
                                    BigDecimal verifiedIseer, LocalDate validFrom, LocalDate validTo) {
    }

    private final JdbcTemplate jdbc;

    public PublicVerificationRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public Optional<PublicCertificate> find(String registrationId) {
        return jdbc.query(
            "SELECT registration_id, manufacturer, brand_name, model_number, category_code, stars, verified_iseer, valid_from, valid_to "
                + "FROM public_certificate WHERE registration_id = ?",
            (rs, i) -> new PublicCertificate(rs.getString("registration_id"), rs.getString("manufacturer"), rs.getString("brand_name"), rs.getString("model_number"),
                rs.getString("category_code"), rs.getInt("stars"), rs.getBigDecimal("verified_iseer"), rs.getDate("valid_from").toLocalDate(), rs.getDate("valid_to").toLocalDate()),
            registrationId).stream().findFirst();
    }

    /** The certificate of a bound QR serial (view public_qr_serial: bound serials only). Same shape as {@link #find}. */
    public Optional<PublicCertificate> findBySerial(String serial) {
        return jdbc.query(
            "SELECT p.registration_id, p.manufacturer, p.brand_name, p.model_number, p.category_code, p.stars, p.verified_iseer, p.valid_from, p.valid_to "
                + "FROM public_qr_serial q JOIN public_certificate p ON p.registration_id = q.registration_id WHERE q.serial = ?",
            (rs, i) -> new PublicCertificate(rs.getString("registration_id"), rs.getString("manufacturer"), rs.getString("brand_name"), rs.getString("model_number"),
                rs.getString("category_code"), rs.getInt("stars"), rs.getBigDecimal("verified_iseer"), rs.getDate("valid_from").toLocalDate(), rs.getDate("valid_to").toLocalDate()),
            serial).stream().findFirst();
    }

    /**
     * The simulated demonstration ledger's word on a certificate (docs/demo/S3.md): "revoked" when a revoke is committed, "pending" when it was
     * submitted but its issue is not committed yet (or failed), otherwise null (not on the ledger, or active). A missing table or grant is null,
     * so the public answer never fails because of the ledger.
     */
    public String ledgerOverride(String registrationId) {
        try {
            return jdbc.query(
                "SELECT CASE WHEN bool_or(l.kind = 'revoke' AND l.state = 'committed') THEN 'revoked' "
                    + "WHEN bool_or(l.kind = 'issue' AND l.state = 'committed') THEN NULL ELSE 'pending' END "
                    + "FROM ledger_tx l JOIN certificate c ON c.id = l.certificate_id WHERE c.registration_id = ? HAVING count(*) > 0",
                (rs, i) -> rs.getString(1), registrationId).stream().findFirst().orElse(null);
        } catch (org.springframework.dao.DataAccessException e) {
            return null;
        }
    }
}
