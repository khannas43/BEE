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
 * Read-only access to the effective-dated masters. A rule key resolves at a date to the one
 * version whose half-open period [effective_from, effective_to) contains it, or to nothing
 * in a gap. The database rejects overlapping periods and any update or delete, so at most
 * one version can match; two would mean the guard was bypassed, and resolution fails.
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

    private static final String SHARED = "id, rule_key, version, effective_from, effective_to, source_reference, verification_status, note, legacy_id";
    private static final String AT = " WHERE rule_key = ? AND effective_from <= ? AND (effective_to IS NULL OR ? < effective_to)";

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
        return one(Table.FEE_RULE, "category_code, application_type, amount_inr", category + ":" + applicationType, at, this::fee);
    }

    public Optional<RatingFormula> ratingFormula(String category, LocalDate at) {
        return one(Table.RATING_FORMULA, "category_code, formula_label, inputs::text AS inputs, definition::text AS definition, computation_allowed",
            category + ":star_rating", at, this::formula);
    }

    /** Every version of one rule key, oldest first (shared columns only). */
    public List<MasterVersion> history(Table table, String ruleKey) {
        return jdbc.query("SELECT " + SHARED + " FROM " + table.sql + " WHERE rule_key = ? ORDER BY version", (rs, i) -> shared(rs), ruleKey);
    }

    private <T> Optional<T> one(Table table, String payload, String ruleKey, LocalDate at, RowMapper<T> mapper) {
        Date d = Date.valueOf(at);
        List<T> rows = jdbc.query("SELECT " + SHARED + ", " + payload + " FROM " + table.sql + AT + " ORDER BY version LIMIT 2",
            mapper, ruleKey, d, d);
        if (rows.size() > 1) {
            throw new IllegalStateException(table.sql + " has overlapping versions for one rule key");
        }
        return rows.stream().findFirst();
    }

    private static MasterVersion shared(ResultSet rs) throws SQLException {
        Date to = rs.getDate("effective_to");
        return new MasterVersion(rs.getObject("id", UUID.class), rs.getString("rule_key"), rs.getInt("version"),
            rs.getDate("effective_from").toLocalDate(), to == null ? null : to.toLocalDate(), rs.getString("source_reference"),
            MasterVersion.Verification.of(rs.getString("verification_status")), rs.getString("note"), rs.getString("legacy_id"));
    }

    private LabAccreditation accreditation(ResultSet rs, int i) throws SQLException {
        return new LabAccreditation(shared(rs), rs.getString("laboratory_code"), rs.getString("category_code"), rs.getString("accreditation_body"),
            rs.getString("certificate_ref"), rs.getString("accreditation_status"));
    }

    private FeeRule fee(ResultSet rs, int i) throws SQLException {
        return new FeeRule(shared(rs), rs.getString("category_code"), rs.getString("application_type"), rs.getBigDecimal("amount_inr"));
    }

    private RatingFormula formula(ResultSet rs, int i) throws SQLException {
        return new RatingFormula(shared(rs), rs.getString("category_code"), rs.getString("formula_label"), rs.getString("inputs"),
            rs.getString("definition"), rs.getBoolean("computation_allowed"));
    }
}
