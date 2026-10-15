package gov.bee.api.demo.qr;

import java.security.SecureRandom;
import java.sql.Timestamp;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/** QR batches and serials (demo slice S2; local demonstration, not BEE rules). Authorisation is the module's job; this class is plain data access. */
@Repository
public class QrRepository {

    static final String ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
    static final SecureRandom RANDOM = new SecureRandom();

    public record Application(UUID id, UUID organisationId, String state, String reference, String brand, String model) {
    }

    public record Batch(UUID id, UUID applicationId, UUID certificateId, UUID organisationId, int quantity, String status, String registrationId,
                        String reference, String brand, String model, String organisation, Timestamp createdAt, int allocated, int bound, int voided) {
    }

    private final org.springframework.beans.factory.ObjectProvider<JdbcTemplate> jdbcProvider;
    private JdbcTemplate fixed;

    /** Lazy, so a web slice test that scans the demo modules without a database still starts. */
    @org.springframework.beans.factory.annotation.Autowired
    public QrRepository(org.springframework.beans.factory.ObjectProvider<JdbcTemplate> jdbc) {
        this.jdbcProvider = jdbc;
    }

    public QrRepository(JdbcTemplate jdbc) {
        this.jdbcProvider = null;
        this.fixed = jdbc;
    }

    private JdbcTemplate jdbc() {
        return fixed != null ? fixed : jdbcProvider.getObject();
    }

    /** A serial: BEEQ- and ten Crockford base32 characters from a secure random. */
    static String newSerial() {
        StringBuilder b = new StringBuilder("BEEQ-");
        for (int i = 0; i < 10; i++) {
            b.append(ALPHABET.charAt(RANDOM.nextInt(32)));
        }
        return b.toString();
    }

    public Optional<Application> application(UUID id) {
        return jdbc().query("SELECT id, organisation_id, state, reference, brand_name, model_number FROM model_application WHERE id = ?",
            (rs, i) -> new Application(rs.getObject("id", UUID.class), rs.getObject("organisation_id", UUID.class), rs.getString("state"),
                rs.getString("reference"), rs.getString("brand_name"), rs.getString("model_number")), id).stream().findFirst();
    }

    public Optional<UUID> certificateOf(UUID applicationId) {
        return jdbc().query("SELECT id FROM certificate WHERE application_id = ?", (rs, i) -> rs.getObject(1, UUID.class), applicationId).stream().findFirst();
    }

    public UUID createBatch(UUID applicationId, UUID certificateId, UUID organisationId, int quantity, UUID actor) {
        UUID id = jdbc().queryForObject("INSERT INTO qr_batch (model_application_id, certificate_id, organisation_id, quantity, created_by) "
            + "VALUES (?, ?, ?, ?, ?) RETURNING id", UUID.class, applicationId, certificateId, organisationId, quantity, actor);
        event(id, "created", actor, "quantity " + quantity);
        return id;
    }

    private static final String BATCH_SELECT =
        "SELECT b.id, b.model_application_id, b.certificate_id, b.organisation_id, b.quantity, b.status, c.registration_id, a.reference, a.brand_name, "
            + "a.model_number, o.legal_name, b.created_at, "
            + "(SELECT count(*) FROM qr_serial s WHERE s.batch_id = b.id) AS n_all, "
            + "(SELECT count(*) FROM qr_serial s WHERE s.batch_id = b.id AND s.state = 'bound') AS n_bound, "
            + "(SELECT count(*) FROM qr_serial s WHERE s.batch_id = b.id AND s.state = 'void') AS n_void "
            + "FROM qr_batch b JOIN certificate c ON c.id = b.certificate_id JOIN model_application a ON a.id = b.model_application_id "
            + "JOIN organisation o ON o.id = b.organisation_id ";

    private static Batch batch(java.sql.ResultSet rs, int i) throws java.sql.SQLException {
        int all = rs.getInt("n_all");
        int bound = rs.getInt("n_bound");
        int voided = rs.getInt("n_void");
        return new Batch(rs.getObject("id", UUID.class), rs.getObject("model_application_id", UUID.class), rs.getObject("certificate_id", UUID.class),
            rs.getObject("organisation_id", UUID.class), rs.getInt("quantity"), rs.getString("status"), rs.getString("registration_id"),
            rs.getString("reference"), rs.getString("brand_name"), rs.getString("model_number"), rs.getString("legal_name"), rs.getTimestamp("created_at"),
            all - bound - voided, bound, voided);
    }

    /** @param organisations null for every organisation, otherwise the ones to list */
    public List<Batch> batches(List<UUID> organisations) {
        if (organisations == null) {
            return jdbc().query(BATCH_SELECT + "ORDER BY b.created_at DESC, b.id LIMIT 200", QrRepository::batch);
        }
        if (organisations.isEmpty()) {
            return List.of();
        }
        String marks = String.join(",", organisations.stream().map(o -> "?").toList());
        return jdbc().query(BATCH_SELECT + "WHERE b.organisation_id IN (" + marks + ") ORDER BY b.created_at DESC, b.id LIMIT 200", QrRepository::batch,
            organisations.toArray());
    }

    public Optional<Batch> batch(UUID id) {
        return jdbc().query(BATCH_SELECT + "WHERE b.id = ?", QrRepository::batch, id).stream().findFirst();
    }

    /** Approved applications of the organisations that have an issued certificate: what a batch can be made for. */
    public List<Map<String, Object>> eligible(List<UUID> organisations) {
        if (organisations.isEmpty()) {
            return List.of();
        }
        String marks = String.join(",", organisations.stream().map(o -> "?").toList());
        return jdbc().query("SELECT a.id, a.reference, a.brand_name, a.model_number, c.registration_id FROM model_application a "
            + "JOIN certificate c ON c.application_id = a.id WHERE a.state = 'approved' AND a.organisation_id IN (" + marks + ") ORDER BY a.reference LIMIT 100",
            (rs, i) -> {
                Map<String, Object> m = new LinkedHashMap<>();
                m.put("applicationId", rs.getObject("id", UUID.class).toString());
                m.put("reference", rs.getString("reference"));
                m.put("brandName", rs.getString("brand_name"));
                m.put("modelNumber", rs.getString("model_number"));
                m.put("registrationId", rs.getString("registration_id"));
                return m;
            }, organisations.toArray());
    }

    /** Locks the batch row so concurrent allocations of one batch queue up. */
    public void lock(UUID batchId) {
        jdbc().queryForList("SELECT id FROM qr_batch WHERE id = ? FOR UPDATE", batchId);
    }

    public int serialCount(UUID batchId) {
        Integer n = jdbc().queryForObject("SELECT count(*) FROM qr_serial WHERE batch_id = ?", Integer.class, batchId);
        return n == null ? 0 : n;
    }

    /** Allocates {@code count} new serials, retrying on the (very unlikely) collision; the unique key is the guarantee. */
    public List<String> allocate(UUID batchId, UUID certificateId, int count, UUID actor) {
        List<String> made = new ArrayList<>();
        int guard = 0;
        while (made.size() < count && guard++ < count * 20 + 20) {
            String serial = newSerial();
            int n = jdbc().update("INSERT INTO qr_serial (serial, batch_id, certificate_id) VALUES (?, ?, ?) ON CONFLICT (serial) DO NOTHING",
                serial, batchId, certificateId);
            if (n == 1) {
                made.add(serial);
            }
        }
        event(batchId, "allocated", actor, made.size() + " serials");
        return made;
    }

    public void close(UUID batchId) {
        jdbc().update("UPDATE qr_batch SET status = 'closed' WHERE id = ?", batchId);
    }

    /** serial to state, for the serials of one batch among those asked about (others are absent). */
    public Map<String, String> statesIn(UUID batchId, List<String> serials) {
        Map<String, String> out = new LinkedHashMap<>();
        for (int from = 0; from < serials.size(); from += 500) {
            List<String> part = serials.subList(from, Math.min(serials.size(), from + 500));
            String marks = String.join(",", part.stream().map(s -> "?").toList());
            List<Object> args = new ArrayList<>();
            args.add(batchId);
            args.addAll(part);
            jdbc().query("SELECT serial, state FROM qr_serial WHERE batch_id = ? AND serial IN (" + marks + ")",
                rs -> {
                    out.put(rs.getString(1), rs.getString(2));
                }, args.toArray());
        }
        return out;
    }

    /** Moves allocated serials to bound; already-bound ones are left alone. Returns how many changed. */
    public int bind(UUID batchId, List<String> serials, UUID actor) {
        int changed = 0;
        for (String s : serials) {
            changed += jdbc().update("UPDATE qr_serial SET state = 'bound', bound_at = now() WHERE batch_id = ? AND serial = ? AND state = 'allocated'", batchId, s);
        }
        event(batchId, "bound", actor, changed + " of " + serials.size() + " newly bound");
        return changed;
    }

    public int voidSerial(UUID batchId, String serial, String reason, UUID actor) {
        int n = jdbc().update("UPDATE qr_serial SET state = 'void', voided_at = now(), void_reason = ? WHERE batch_id = ? AND serial = ? AND state <> 'void'",
            reason, batchId, serial);
        if (n > 0) {
            event(batchId, "voided", actor, serial + ": " + reason);
        }
        return n;
    }

    public List<Map<String, Object>> serials(UUID batchId, int offset, int limit) {
        return jdbc().query("SELECT serial, state, allocated_at, bound_at, voided_at, void_reason FROM qr_serial WHERE batch_id = ? "
            + "ORDER BY allocated_at, serial OFFSET ? LIMIT ?", (rs, i) -> {
                Map<String, Object> m = new LinkedHashMap<>();
                m.put("serial", rs.getString("serial"));
                m.put("state", rs.getString("state"));
                m.put("allocatedAt", rs.getTimestamp("allocated_at").toInstant().toString());
                m.put("boundAt", rs.getTimestamp("bound_at") == null ? null : rs.getTimestamp("bound_at").toInstant().toString());
                m.put("voidedAt", rs.getTimestamp("voided_at") == null ? null : rs.getTimestamp("voided_at").toInstant().toString());
                m.put("voidReason", rs.getString("void_reason"));
                return m;
            }, batchId, offset, limit);
    }

    private void event(UUID batchId, String action, UUID actor, String detail) {
        jdbc().update("INSERT INTO qr_event (batch_id, action, actor_account_id, detail) VALUES (?, ?, ?, ?)", batchId, action, actor, detail);
    }
}
