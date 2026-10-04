package gov.bee.api.feerules;

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
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/**
 * Fee rules for administration: the rule versions and the proposals that change them. A rule version is an immutable master
 * row; a change is a proposal that a second person decides, and the decision runs in one database function that holds the
 * two-person rule, the capability check, the not-in-the-past rule and the close-and-start of the rule (V33).
 */
@Repository
public class FeeRuleRepository {

    public static final String CAPABILITY = "fee_rule_manage";

    public record Version(String ruleKey, String categoryCode, String applicationType, int version, LocalDate effectiveFrom, LocalDate effectiveTo,
                          BigDecimal amountInr, BigDecimal taxRatePercent, String verification, String source) {
    }

    public record Proposal(UUID id, String categoryCode, String applicationType, BigDecimal amountInr, BigDecimal taxRatePercent, LocalDate effectiveFrom,
                           String sourceReference, String reason, UUID proposedById, String proposedBy, Instant proposedAt, String state,
                           String decidedBy, Instant decidedAt, String decisionNote, Integer appliedVersion) {
    }

    public record AppType(String code, String label) {
    }

    public record Category(String code, String name) {
    }

    public record NewProposal(String categoryCode, String applicationType, BigDecimal amountInr, BigDecimal taxRatePercent, LocalDate effectiveFrom,
                              String sourceReference, String reason) {
    }

    public enum Outcome { DONE, NOT_FOUND, NOT_PENDING, NOT_PERMITTED, SAME_PERSON, ONLY_PROPOSER, DATE_PASSED, RULE_CONFLICT }

    public record Decided(Outcome outcome, String state, Integer appliedVersion) {
        static Decided of(Outcome o) {
            return new Decided(o, null, null);
        }
    }

    private static final String PROPOSAL = "SELECT p.id, p.category_code, p.application_type, p.amount_inr, p.tax_rate_percent, p.effective_from, "
        + "p.source_reference, p.reason, p.proposed_by, u.display_name AS proposed_by_name, p.proposed_at, p.state, d.display_name AS decided_by_name, "
        + "p.decided_at, p.decision_note, p.applied_version FROM fee_rule_proposal p JOIN user_account u ON u.id = p.proposed_by "
        + "LEFT JOIN user_account d ON d.id = p.decided_by";

    private final JdbcTemplate jdbc;

    public FeeRuleRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** Roles that hold the capability. A role in the database and the token that is in this set may act. */
    public Set<String> rolesHolding(String capability) {
        return Set.copyOf(jdbc.queryForList("SELECT role FROM capability_grant WHERE capability = ?", String.class, capability));
    }

    public List<AppType> applicationTypes() {
        return jdbc.query("SELECT code, label FROM fee_application_type ORDER BY code", (rs, i) -> new AppType(rs.getString("code"), rs.getString("label")));
    }

    public boolean applicationTypeExists(String code) {
        Integer n = jdbc.queryForObject("SELECT count(*)::int FROM fee_application_type WHERE code = ?", Integer.class, code);
        return n != null && n > 0;
    }

    /** Categories with a version in force on the date. */
    public List<Category> categoriesOn(LocalDate at) {
        return jdbc.query("SELECT rule_key, name FROM master_category WHERE effective_from <= ? AND (effective_to IS NULL OR effective_to > ?) ORDER BY rule_key",
            (rs, i) -> new Category(rs.getString("rule_key"), rs.getString("name")), Date.valueOf(at), Date.valueOf(at));
    }

    public boolean categoryAppliesOn(String code, LocalDate at) {
        return categoriesOn(at).stream().anyMatch(c -> c.code().equals(code));
    }

    /** Every fee-rule version, with the end date a closure gives it, oldest first within each rule key. */
    public List<Version> versions() {
        return jdbc.query("SELECT t.rule_key, t.category_code, t.application_type, t.version, t.effective_from, coalesce(c.effective_to, t.effective_to) AS ends, "
            + "t.amount_inr, t.tax_rate_percent, t.verification_status, t.source_reference "
            + "FROM master_fee_rule t LEFT JOIN master_closure c ON c.master_table = 'master_fee_rule' AND c.rule_key = t.rule_key AND c.version = t.version "
            + "ORDER BY t.rule_key, t.version", (rs, i) -> {
                Date to = rs.getDate("ends");
                return new Version(rs.getString("rule_key"), rs.getString("category_code"), rs.getString("application_type"), rs.getInt("version"),
                    rs.getDate("effective_from").toLocalDate(), to == null ? null : to.toLocalDate(), rs.getBigDecimal("amount_inr"),
                    rs.getBigDecimal("tax_rate_percent"), rs.getString("verification_status"), rs.getString("source_reference"));
            });
    }

    /** Pending proposals first, then the most recent decided ones. */
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
            "INSERT INTO fee_rule_proposal (category_code, application_type, amount_inr, tax_rate_percent, effective_from, source_reference, reason, proposed_by) "
                + "VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id", UUID.class,
            p.categoryCode(), p.applicationType(), p.amountInr(), p.taxRatePercent(), Date.valueOf(p.effectiveFrom()), p.sourceReference(), p.reason(), proposerAccountId);
        return proposal(id).orElseThrow();
    }

    /** Approve, reject or withdraw. The database function enforces who may do it and when; its stable codes become outcomes. */
    public Decided decide(UUID proposalId, UUID deciderAccountId, String decision, String note) {
        try {
            return jdbc.query("SELECT out_state, out_version FROM fee_rule_decide(?, ?, ?, ?)", rs -> {
                rs.next();
                int v = rs.getInt("out_version");
                Integer version = rs.wasNull() ? null : v;
                return new Decided(Outcome.DONE, rs.getString("out_state"), version);
            }, proposalId, deciderAccountId, decision, note);
        } catch (DataAccessException e) {
            String message = String.valueOf(rootMessage(e));
            for (Outcome o : Outcome.values()) {
                if (o != Outcome.DONE && message.contains(o.name().toLowerCase())) {
                    return Decided.of(o);
                }
            }
            throw e;
        }
    }

    private static String rootMessage(Throwable e) {
        Throwable t = e;
        while (t.getCause() != null) {
            t = t.getCause();
        }
        return t.getMessage();
    }

    private Proposal mapProposal(ResultSet rs, int i) throws SQLException {
        java.sql.Timestamp d = rs.getTimestamp("decided_at");
        int applied = rs.getInt("applied_version");
        boolean noApplied = rs.wasNull();
        return new Proposal(rs.getObject("id", UUID.class), rs.getString("category_code"), rs.getString("application_type"), rs.getBigDecimal("amount_inr"),
            rs.getBigDecimal("tax_rate_percent"), rs.getDate("effective_from").toLocalDate(), rs.getString("source_reference"), rs.getString("reason"),
            rs.getObject("proposed_by", UUID.class), rs.getString("proposed_by_name"), rs.getTimestamp("proposed_at").toInstant(), rs.getString("state"),
            rs.getString("decided_by_name"), d == null ? null : d.toInstant(), rs.getString("decision_note"), noApplied ? null : applied);
    }
}
