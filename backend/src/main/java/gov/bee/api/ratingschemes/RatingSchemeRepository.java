package gov.bee.api.ratingschemes;

import java.math.BigDecimal;
import java.sql.Date;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/**
 * Star-rating schemes for administration: the schemes (the five bands under one scheme key) and the proposals that add one. A
 * scheme is immutable once approved; a change is a proposal that a second person decides, and the decision runs in one database
 * function that holds the two-person rule, the permission check and the not-in-the-past rule (V35). Provisional local rules.
 */
@Repository
public class RatingSchemeRepository {

    public static final String CAPABILITY = "rating_scheme_manage";

    public record Band(int stars, BigDecimal minIseer) {
    }

    public record Scheme(String schemeKey, String categoryCode, LocalDate effectiveFrom, List<Band> bands, String source, String note) {
    }

    public record Proposal(UUID id, String categoryCode, LocalDate effectiveFrom, List<BigDecimal> minIseer, String sourceReference, String reason,
                           UUID proposedById, String proposedBy, Instant proposedAt, String state, String decidedBy, Instant decidedAt,
                           String decisionNote, String appliedScheme) {
    }

    public record Category(String code, String name) {
    }

    public record NewProposal(String categoryCode, LocalDate effectiveFrom, List<BigDecimal> minIseer, String sourceReference, String reason) {
    }

    public enum Outcome { DONE, NOT_FOUND, NOT_PENDING, NOT_PERMITTED, SAME_PERSON, ONLY_PROPOSER, DATE_PASSED, RULE_CONFLICT }

    public record Decided(Outcome outcome, String state, String appliedScheme) {
        static Decided of(Outcome o) {
            return new Decided(o, null, null);
        }
    }

    private static final String PROPOSAL = "SELECT p.id, p.category_code, p.effective_from, p.min_iseer_1, p.min_iseer_2, p.min_iseer_3, p.min_iseer_4, p.min_iseer_5, "
        + "p.source_reference, p.reason, p.proposed_by, u.display_name AS proposed_by_name, p.proposed_at, p.state, d.display_name AS decided_by_name, "
        + "p.decided_at, p.decision_note, p.applied_scheme FROM rating_scheme_proposal p JOIN user_account u ON u.id = p.proposed_by "
        + "LEFT JOIN user_account d ON d.id = p.decided_by";

    private final JdbcTemplate jdbc;

    public RatingSchemeRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public Set<String> rolesHolding(String capability) {
        return Set.copyOf(jdbc.queryForList("SELECT role FROM capability_grant WHERE capability = ?", String.class, capability));
    }

    public List<Category> categoriesOn(LocalDate at) {
        return jdbc.query("SELECT rule_key, name FROM master_category WHERE effective_from <= ? AND (effective_to IS NULL OR effective_to > ?) ORDER BY rule_key",
            (rs, i) -> new Category(rs.getString("rule_key"), rs.getString("name")), Date.valueOf(at), Date.valueOf(at));
    }

    public boolean categoryAppliesOn(String code, LocalDate at) {
        return categoriesOn(at).stream().anyMatch(c -> c.code().equals(code));
    }

    /** Every scheme, oldest first within each category, with its five bands. */
    public List<Scheme> schemes() {
        Map<String, Scheme> byKey = new LinkedHashMap<>();
        jdbc.query("SELECT scheme_key, category_code, effective_from, stars, min_iseer, source_reference, note FROM rating_demo_band "
            + "ORDER BY category_code, effective_from, scheme_key, stars", (org.springframework.jdbc.core.RowCallbackHandler) rs -> {
                String key = rs.getString("scheme_key");
                Scheme existing = byKey.get(key);
                if (existing == null) {
                    existing = new Scheme(key, rs.getString("category_code"), rs.getDate("effective_from").toLocalDate(), new ArrayList<>(),
                        rs.getString("source_reference"), rs.getString("note"));
                    byKey.put(key, existing);
                }
                existing.bands().add(new Band(rs.getInt("stars"), rs.getBigDecimal("min_iseer")));
            });
        return new ArrayList<>(byKey.values());
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
        List<BigDecimal> m = p.minIseer();
        UUID id = jdbc.queryForObject(
            "INSERT INTO rating_scheme_proposal (category_code, effective_from, min_iseer_1, min_iseer_2, min_iseer_3, min_iseer_4, min_iseer_5, source_reference, reason, proposed_by) "
                + "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id", UUID.class,
            p.categoryCode(), Date.valueOf(p.effectiveFrom()), m.get(0), m.get(1), m.get(2), m.get(3), m.get(4), p.sourceReference(), p.reason(), proposerAccountId);
        return proposal(id).orElseThrow();
    }

    /** Approve, reject or withdraw. A refusal comes back as a result (not an error), so the surrounding transaction stays usable. */
    public Decided decide(UUID proposalId, UUID deciderAccountId, String decision, String note) {
        return jdbc.query("SELECT out_state, out_scheme FROM rating_scheme_decide(?, ?, ?, ?)", rs -> {
            rs.next();
            String state = rs.getString("out_state");
            if (state.equals("approved") || state.equals("rejected") || state.equals("withdrawn")) {
                return new Decided(Outcome.DONE, state, rs.getString("out_scheme"));
            }
            return Decided.of(Outcome.valueOf(state.toUpperCase()));
        }, proposalId, deciderAccountId, decision, note);
    }

    private Proposal mapProposal(ResultSet rs, int i) throws SQLException {
        java.sql.Timestamp d = rs.getTimestamp("decided_at");
        return new Proposal(rs.getObject("id", UUID.class), rs.getString("category_code"), rs.getDate("effective_from").toLocalDate(),
            List.of(rs.getBigDecimal("min_iseer_1"), rs.getBigDecimal("min_iseer_2"), rs.getBigDecimal("min_iseer_3"), rs.getBigDecimal("min_iseer_4"), rs.getBigDecimal("min_iseer_5")),
            rs.getString("source_reference"), rs.getString("reason"), rs.getObject("proposed_by", UUID.class), rs.getString("proposed_by_name"),
            rs.getTimestamp("proposed_at").toInstant(), rs.getString("state"), rs.getString("decided_by_name"), d == null ? null : d.toInstant(),
            rs.getString("decision_note"), rs.getString("applied_scheme"));
    }
}
