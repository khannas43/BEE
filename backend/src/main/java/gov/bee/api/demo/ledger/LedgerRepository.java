package gov.bee.api.demo.ledger;

import java.time.Instant;
import java.time.LocalDate;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;

/** Not a Spring bean on purpose: LedgerModule builds it lazily from the JdbcTemplate (see there). Reads the simulated ledger and writes it only through the ledger_* functions (V57). Local demonstration, not Hyperledger Fabric. */
public class LedgerRepository {

    public record Cert(UUID id, String registrationId, String manufacturer, String brandName, String modelNumber, String category, int stars,
                       LocalDate validFrom, LocalDate validTo, LocalDate effectiveValidTo) {
    }

    public record Tx(UUID id, UUID certificateId, String registrationId, int seq, int attempt, String kind, String state, String prevHash, String hash,
                     LocalDate validTo, String reason, String failureReason, long blockNo, String submittedBy, UUID submittedById, String decidedBy,
                     String seededNote, Instant createdAt, Instant committedAt) {
        LedgerStatus.Tx rule() {
            return new LedgerStatus.Tx(seq, kind, state);
        }
    }

    public record Event(String action, String actor, String reason, Instant at, int seq, String kind) {
    }

    public record Result(String result, UUID tx) {
    }

    private static final String CERT = "SELECT c.id, c.registration_id, c.organisation_name, c.brand_name, c.model_number, c.category_code, c.stars, c.valid_from, "
        + "c.valid_to, ledger_effective_valid_to(c.id) AS eff FROM certificate c JOIN model_application a ON a.id = c.application_id";

    private static final String TX = "SELECT t.id, t.certificate_id, c.registration_id, t.seq, t.attempt, t.kind, t.state, t.prev_hash, t.hash, t.valid_to, t.reason, "
        + "t.failure_reason, t.block_no, s.display_name AS submitted_by, t.submitted_by AS submitted_by_id, d.display_name AS decided_by, t.seeded_note, "
        + "t.created_at, t.committed_at FROM ledger_tx t JOIN certificate c ON c.id = t.certificate_id JOIN user_account s ON s.id = t.submitted_by "
        + "LEFT JOIN user_account d ON d.id = t.decided_by";

    private final JdbcTemplate jdbc;

    public LedgerRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    private static Cert cert(java.sql.ResultSet rs, int i) throws java.sql.SQLException {
        return new Cert(rs.getObject("id", UUID.class), rs.getString("registration_id"), rs.getString("organisation_name"), rs.getString("brand_name"),
            rs.getString("model_number"), rs.getString("category_code"), rs.getInt("stars"), rs.getDate("valid_from").toLocalDate(),
            rs.getDate("valid_to").toLocalDate(), rs.getDate("eff").toLocalDate());
    }

    private static Tx tx(java.sql.ResultSet rs, int i) throws java.sql.SQLException {
        return new Tx(rs.getObject("id", UUID.class), rs.getObject("certificate_id", UUID.class), rs.getString("registration_id"), rs.getInt("seq"),
            rs.getInt("attempt"), rs.getString("kind"), rs.getString("state"), rs.getString("prev_hash"), rs.getString("hash"),
            rs.getDate("valid_to").toLocalDate(), rs.getString("reason"), rs.getString("failure_reason"), rs.getLong("block_no"),
            rs.getString("submitted_by"), rs.getObject("submitted_by_id", UUID.class), rs.getString("decided_by"), rs.getString("seeded_note"),
            rs.getTimestamp("created_at").toInstant(), rs.getTimestamp("committed_at") == null ? null : rs.getTimestamp("committed_at").toInstant());
    }

    /** The certificates visible to the caller; orgs null means all. At most 200, newest first. */
    public List<Cert> certificates(Collection<UUID> orgs) {
        if (orgs == null) {
            return jdbc.query(CERT + " ORDER BY c.issued_at DESC, c.id LIMIT 200", LedgerRepository::cert);
        }
        if (orgs.isEmpty()) {
            return List.of();
        }
        String in = String.join(",", orgs.stream().map(o -> "?").toList());
        return jdbc.query(CERT + " WHERE a.organisation_id IN (" + in + ") ORDER BY c.issued_at DESC, c.id LIMIT 200", LedgerRepository::cert, orgs.toArray());
    }

    /** One certificate if it is visible; the same empty answer for unknown and out-of-scope. */
    public Optional<Cert> certificate(UUID id, Collection<UUID> orgs) {
        if (orgs == null) {
            return jdbc.query(CERT + " WHERE c.id = ?", LedgerRepository::cert, id).stream().findFirst();
        }
        if (orgs.isEmpty()) {
            return Optional.empty();
        }
        String in = String.join(",", orgs.stream().map(o -> "?").toList());
        Object[] args = new Object[orgs.size() + 1];
        args[0] = id;
        int k = 1;
        for (UUID o : orgs) {
            args[k++] = o;
        }
        return jdbc.query(CERT + " WHERE c.id = ? AND a.organisation_id IN (" + in + ")", LedgerRepository::cert, args).stream().findFirst();
    }

    public List<Tx> transactionsOf(UUID certificate) {
        return jdbc.query(TX + " WHERE t.certificate_id = ? ORDER BY t.seq", LedgerRepository::tx, certificate);
    }

    public List<Tx> transactionsOf(Collection<UUID> certificates) {
        if (certificates.isEmpty()) {
            return List.of();
        }
        String in = String.join(",", certificates.stream().map(o -> "?").toList());
        return jdbc.query(TX + " WHERE t.certificate_id IN (" + in + ") ORDER BY t.certificate_id, t.seq", LedgerRepository::tx, certificates.toArray());
    }

    /** The block explorer: newest block first. orgs null means all. */
    public List<Tx> explorer(Collection<UUID> orgs) {
        if (orgs == null) {
            return jdbc.query(TX + " ORDER BY t.block_no DESC LIMIT 200", LedgerRepository::tx);
        }
        if (orgs.isEmpty()) {
            return List.of();
        }
        String in = String.join(",", orgs.stream().map(o -> "?").toList());
        return jdbc.query(TX + " JOIN model_application a ON a.id = c.application_id WHERE a.organisation_id IN (" + in + ") ORDER BY t.block_no DESC LIMIT 200",
            LedgerRepository::tx, orgs.toArray());
    }

    public List<Event> events(UUID certificate) {
        return jdbc.query("SELECT e.action, u.display_name, e.reason, e.occurred_at, t.seq, t.kind FROM ledger_event e JOIN user_account u ON u.id = e.actor_account_id "
            + "JOIN ledger_tx t ON t.id = e.tx_id WHERE e.certificate_id = ? ORDER BY e.occurred_at, t.seq",
            (rs, i) -> new Event(rs.getString(1), rs.getString(2), rs.getString(3), rs.getTimestamp(4).toInstant(), rs.getInt(5), rs.getString(6)), certificate);
    }

    /** The stored chain with the hash recomputed from the certificate's own fields. */
    public List<LedgerStatus.Link> chain(UUID certificate) {
        return jdbc.query("SELECT t.seq, t.prev_hash, t.hash, ledger_compute_hash(t.prev_hash, c.registration_id, c.organisation_name, c.brand_name, c.model_number, "
            + "c.category_code, c.stars::integer, c.verified_iseer, c.valid_from, t.valid_to, t.kind, t.seq) AS expected FROM ledger_tx t JOIN certificate c "
            + "ON c.id = t.certificate_id WHERE t.certificate_id = ? ORDER BY t.seq",
            (rs, i) -> new LedgerStatus.Link(rs.getInt("seq"), rs.getString("prev_hash"), rs.getString("hash"), rs.getString("expected")), certificate);
    }

    private Result result(List<Result> rows) {
        return rows.get(0);
    }

    private static final org.springframework.jdbc.core.RowMapper<Result> RESULT = (rs, i) -> new Result(rs.getString(1), rs.getObject(2, UUID.class));

    public Result submit(UUID certificate, UUID actor) {
        return result(jdbc.query("SELECT * FROM ledger_submit(?, ?)", RESULT, certificate, actor));
    }

    public Result decide(UUID certificate, UUID actor, Collection<UUID> acting, String outcome, String reason) {
        UUID[] ids = acting.toArray(new UUID[0]);
        return result(jdbc.query(con -> {
            var ps = con.prepareStatement("SELECT * FROM ledger_decide(?, ?, ?, ?, ?)");
            ps.setObject(1, certificate);
            ps.setObject(2, actor);
            ps.setArray(3, con.createArrayOf("uuid", ids));
            ps.setString(4, outcome);
            ps.setString(5, reason);
            return ps;
        }, RESULT));
    }

    public Result retry(UUID certificate, UUID actor) {
        return result(jdbc.query("SELECT * FROM ledger_retry(?, ?)", RESULT, certificate, actor));
    }

    public Result change(UUID certificate, UUID actor, String kind, LocalDate validTo, String reason) {
        return result(jdbc.query("SELECT * FROM ledger_change(?, ?, ?, ?, ?)", RESULT, certificate, actor, kind,
            validTo == null ? null : java.sql.Date.valueOf(validTo), reason));
    }
}
