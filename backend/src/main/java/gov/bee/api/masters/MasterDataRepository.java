package gov.bee.api.masters;

import gov.bee.api.masters.Masters.Category;
import gov.bee.api.masters.Masters.FeeRule;
import gov.bee.api.masters.Masters.LabAccreditation;
import gov.bee.api.masters.Masters.RatingFormula;
import gov.bee.api.masters.Masters.Standard;
import java.sql.Date;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

/**
 * Access to the effective-dated masters. A rule key resolves at a date to the one version
 * whose half-open period [effective_from, effective end) contains it, or to nothing in a gap;
 * the effective end is the closure date if the version was closed, else its effective_to.
 * The database rejects overlapping periods and any update or delete, so at most one version
 * can match; two would mean the guard was bypassed, and resolution fails. The only write is
 * {@link #supersede}, which no route or permission calls yet.
 */
@Repository
public class MasterDataRepository {

    /** The master tables; names come only from here, never from callers. */
    public enum Table {
        CATEGORY("master_category"), STANDARD("master_standard"), LAB_ACCREDITATION("master_lab_accreditation"),
        FEE_RULE("master_fee_rule"), RATING_FORMULA("master_rating_formula");

        final String sql;

        Table(String sql) {
            this.sql = sql;
        }
    }

    private static final String SHARED = "t.id, t.rule_key, t.version, t.effective_from, t.effective_to, t.source_reference, t.verification_status, t.note, t.legacy_id, "
        + "c.effective_to AS closed_on, c.successor_version, c.closed_by, c.source_reference AS closure_source, c.reason AS closure_reason, c.recorded_at AS closed_at";
    private static final String AT = " WHERE t.rule_key = ? AND t.effective_from <= ? AND (coalesce(c.effective_to, t.effective_to) IS NULL OR ? < coalesce(c.effective_to, t.effective_to))";

    private final JdbcTemplate jdbc;

    public MasterDataRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public Optional<Category> category(String code, LocalDate at) {
        return one(Table.CATEGORY, "name", code, at, (rs, i) -> new Category(shared(rs), rs.getString("rule_key"), rs.getString("name")));
    }

    public Optional<Standard> standard(String category, String purpose, LocalDate at) {
        return one(Table.STANDARD, "category_code, purpose, standard_code, title, edition", category + ":" + purpose, at,
            (rs, i) -> new Standard(shared(rs), rs.getString("category_code"), rs.getString("purpose"), rs.getString("standard_code"),
                rs.getString("title"), rs.getString("edition")));
    }

    public Optional<LabAccreditation> labAccreditation(String laboratoryCode, String category, LocalDate at) {
        return one(Table.LAB_ACCREDITATION, "laboratory_code, category_code, accreditation_body, certificate_ref, accreditation_status",
            laboratoryCode + ":" + category, at, this::accreditation);
    }

    public Optional<FeeRule> feeRule(String category, String applicationType, LocalDate at) {
        return one(Table.FEE_RULE, "category_code, application_type, amount_inr, tax_rate_percent", category + ":" + applicationType, at, this::fee);
    }

    public Optional<RatingFormula> ratingFormula(String category, LocalDate at) {
        return one(Table.RATING_FORMULA, "category_code, formula_label, inputs::text AS inputs, definition::text AS definition, computation_allowed",
            category + ":star_rating", at, this::formula);
    }

    /** Every version of one rule key, oldest first (shared columns only). */
    public List<MasterVersion> history(Table table, String ruleKey) {
        return jdbc.query("SELECT " + SHARED + from(table) + " WHERE t.rule_key = ? ORDER BY t.version", (rs, i) -> shared(rs), ruleKey);
    }

    /**
     * Closes open-ended {@code version} of {@code ruleKey} on {@code closeOn} and inserts its
     * successor from that date, in one database statement: both happen or neither does.
     * {@code successorJson} holds the successor's payload and provenance keyed by column name
     * (not its key, version, start, id, legacy id or recorded time). Returns the new version.
     * The database refuses a second closure, a bounded or unknown version, a closure date on
     * or before the version's start, a blank actor, source or reason, and any overlap.
     */
    public int supersede(Table table, String ruleKey, int version, LocalDate closeOn, String closedBy, String sourceReference, String reason,
                         String successorJson) {
        return jdbc.queryForObject("SELECT master_supersede(?::text, ?::text, ?::integer, ?::date, ?::text, ?::text, ?::text, ?::jsonb)", Integer.class,
            table.sql, ruleKey, version, closeOn == null ? null : Date.valueOf(closeOn), closedBy, sourceReference, reason, successorJson);
    }

    private static String from(Table table) {
        return " FROM " + table.sql + " t LEFT JOIN master_closure c ON c.master_table = '" + table.sql + "' AND c.rule_key = t.rule_key AND c.version = t.version";
    }

    private <T> Optional<T> one(Table table, String payload, String ruleKey, LocalDate at, RowMapper<T> mapper) {
        Date d = Date.valueOf(at);
        List<T> rows = jdbc.query("SELECT " + SHARED + ", " + payload + from(table) + AT + " ORDER BY t.version LIMIT 2",
            mapper, ruleKey, d, d);
        if (rows.size() > 1) {
            throw new IllegalStateException(table.sql + " has overlapping versions for one rule key");
        }
        return rows.stream().findFirst();
    }

    private static MasterVersion shared(ResultSet rs) throws SQLException {
        Date to = rs.getDate("effective_to");
        Date closedOn = rs.getDate("closed_on");
        MasterVersion.Closure closure = closedOn == null ? null : new MasterVersion.Closure(closedOn.toLocalDate(), rs.getInt("successor_version"),
            rs.getString("closed_by"), rs.getString("closure_source"), rs.getString("closure_reason"), rs.getTimestamp("closed_at").toInstant());
        return new MasterVersion(rs.getObject("id", UUID.class), rs.getString("rule_key"), rs.getInt("version"),
            rs.getDate("effective_from").toLocalDate(), to == null ? null : to.toLocalDate(), rs.getString("source_reference"),
            MasterVersion.Verification.of(rs.getString("verification_status")), rs.getString("note"), rs.getString("legacy_id"), closure);
    }

    private LabAccreditation accreditation(ResultSet rs, int i) throws SQLException {
        return new LabAccreditation(shared(rs), rs.getString("laboratory_code"), rs.getString("category_code"), rs.getString("accreditation_body"),
            rs.getString("certificate_ref"), rs.getString("accreditation_status"));
    }

    private FeeRule fee(ResultSet rs, int i) throws SQLException {
        return new FeeRule(shared(rs), rs.getString("category_code"), rs.getString("application_type"), rs.getBigDecimal("amount_inr"), rs.getBigDecimal("tax_rate_percent"));
    }

    private RatingFormula formula(ResultSet rs, int i) throws SQLException {
        return new RatingFormula(shared(rs), rs.getString("category_code"), rs.getString("formula_label"), rs.getString("inputs"),
            rs.getString("definition"), rs.getBoolean("computation_allowed"));
    }
}
