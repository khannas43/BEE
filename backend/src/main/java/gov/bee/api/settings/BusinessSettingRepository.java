package gov.bee.api.settings;

import java.math.BigDecimal;
import java.sql.Date;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/**
 * Business settings: the catalogue (one row per setting with its range and default), the versions (immutable, effective-dated) and the
 * proposals that add one. The decision runs in one database function that holds the two-person rule, the permission check and the
 * not-in-the-past rule (V42). Provisional local rules: every default is the owner's assumption, not a BEE rule.
 */
@Repository
public class BusinessSettingRepository {

    public static final String CAPABILITY = "business_setting_manage";

    public record Definition(String key, String label, String unit, String description, String warning, int decimals,
                             BigDecimal min, BigDecimal max, BigDecimal defaultValue) {
    }

    public record Version(String key, LocalDate effectiveFrom, BigDecimal value, String source, String reason) {
    }

    public record Proposal(UUID id, String key, LocalDate effectiveFrom, BigDecimal value, String sourceReference, String reason,
                           UUID proposedById, String proposedBy, Instant proposedAt, String state, String decidedBy, Instant decidedAt,
                           String decisionNote, boolean applied) {
    }

    public record NewProposal(String key, LocalDate effectiveFrom, BigDecimal value, String sourceReference, String reason) {
    }

    public enum Outcome { DONE, NOT_FOUND, NOT_PENDING, NOT_PERMITTED, SAME_PERSON, ONLY_PROPOSER, DATE_PASSED, RULE_CONFLICT }

    public record Decided(Outcome outcome, String state) {
    }

    private static final String PROPOSAL = "SELECT p.id, p.setting_key, p.effective_from, p.value, p.source_reference, p.reason, p.proposed_by, "
        + "u.display_name AS proposed_by_name, p.proposed_at, p.state, d.display_name AS decided_by_name, p.decided_at, p.decision_note, "
        + "p.applied_version FROM business_setting_proposal p JOIN user_account u ON u.id = p.proposed_by LEFT JOIN user_account d ON d.id = p.decided_by";

    private final JdbcTemplate jdbc;

    public BusinessSettingRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public Set<String> rolesHolding(String capability) {
        return Set.copyOf(jdbc.queryForList("SELECT role FROM capability_grant WHERE capability = ?", String.class, capability));
    }

    public List<Definition> definitions() {
        return jdbc.query("SELECT setting_key, label, unit, description, warning, decimals, min_value, max_value, default_value "
            + "FROM business_setting_def ORDER BY sort_order", (rs, i) -> new Definition(rs.getString("setting_key"), rs.getString("label"),
                rs.getString("unit"), rs.getString("description"), rs.getString("warning"), rs.getInt("decimals"), rs.getBigDecimal("min_value"),
                rs.getBigDecimal("max_value"), rs.getBigDecimal("default_value")));
    }

    public Optional<Definition> definition(String key) {
        return definitions().stream().filter(d -> d.key().equals(key)).findFirst();
    }

    /** Every version, oldest first within each setting. */
    public List<Version> versions() {
        return jdbc.query("SELECT setting_key, effective_from, value, source_reference, reason FROM business_setting_version ORDER BY setting_key, effective_from",
            (rs, i) -> new Version(rs.getString("setting_key"), rs.getDate("effective_from").toLocalDate(), rs.getBigDecimal("value"),
                rs.getString("source_reference"), rs.getString("reason")));
    }

    /** The value in force for a setting on a day: the version with the latest start on or before it, else the catalogue default. */
    public BigDecimal valueOn(String key, LocalDate on) {
        BigDecimal v = jdbc.queryForObject("SELECT business_setting_value(?, ?)", BigDecimal.class, key, Date.valueOf(on));
        if (v == null) {
            throw new IllegalStateException("unknown business setting " + key);
        }
        return v;
    }

    public List<Proposal> pending() {
        return jdbc.query(PROPOSAL + " WHERE p.state = 'pending' ORDER BY p.proposed_at", this::mapProposal);
    }

    public List<Proposal> recentDecided(int limit) {
        return jdbc.query(PROPOSAL + " WHERE p.state <> 'pending' ORDER BY p.decided_at DESC LIMIT " + Math.max(1, Math.min(limit, 100)), this::mapProposal);
    }

    public Optional<Proposal> proposal(UUID id) {
        return jdbc.query(PROPOSAL + " WHERE p.id = ?", this::mapProposal, id).stream().findFirst();
    }

    public Proposal insert(UUID proposerAccountId, NewProposal p) {
        UUID id = jdbc.queryForObject(
            "INSERT INTO business_setting_proposal (setting_key, effective_from, value, source_reference, reason, proposed_by) VALUES (?, ?, ?, ?, ?, ?) RETURNING id",
            UUID.class, p.key(), Date.valueOf(p.effectiveFrom()), p.value(), p.sourceReference(), p.reason(), proposerAccountId);
        return proposal(id).orElseThrow();
    }

    /** Approve, reject or withdraw. A refusal comes back as a result (not an error), so the surrounding transaction stays usable. */
    public Decided decide(UUID proposalId, UUID deciderAccountId, String decision, String note) {
        return jdbc.query("SELECT out_state FROM business_setting_decide(?, ?, ?, ?)", rs -> {
            rs.next();
            String state = rs.getString("out_state");
            if (state.equals("approved") || state.equals("rejected") || state.equals("withdrawn")) {
                return new Decided(Outcome.DONE, state);
            }
            return new Decided(Outcome.valueOf(state.toUpperCase()), null);
        }, proposalId, deciderAccountId, decision, note);
    }

    private Proposal mapProposal(ResultSet rs, int i) throws SQLException {
        java.sql.Timestamp d = rs.getTimestamp("decided_at");
        return new Proposal(rs.getObject("id", UUID.class), rs.getString("setting_key"), rs.getDate("effective_from").toLocalDate(),
            rs.getBigDecimal("value"), rs.getString("source_reference"), rs.getString("reason"), rs.getObject("proposed_by", UUID.class),
            rs.getString("proposed_by_name"), rs.getTimestamp("proposed_at").toInstant(), rs.getString("state"), rs.getString("decided_by_name"),
            d == null ? null : d.toInstant(), rs.getString("decision_note"), rs.getObject("applied_version") != null);
    }
}
