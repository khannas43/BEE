package gov.bee.api.revocation;

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
 * WP04.2b-2b: the register as the people who close it see it (brands and agency authorisations), and the proposals that close or revoke
 * one. The decision runs in one database function that holds the two-person rule, the capability check and the change to the register (V46).
 */
@Repository
public class RevocationRepository {

    public static final String PROPOSE = "register_revoke_propose";
    public static final String DECIDE = "register_revoke_decide";

    public record BrandEntry(UUID id, String name, String owner, String status, String source) {
    }

    public record AuthorisationEntry(UUID id, UUID brandId, String brandName, String agency, String principal, LocalDate validFrom, LocalDate validTo,
                                     String status, String source) {
    }

    public record Proposal(UUID id, String targetKind, UUID targetId, String targetLabel, String action, LocalDate closeOn, String reason, UUID proposedById,
                           String proposedBy, Instant proposedAt, String state, String decidedBy, Instant decidedAt, String decisionNote) {
    }

    public record Event(UUID id, String kind, String targetKind, UUID targetId, String targetLabel, String fromStatus, String toStatus, LocalDate validToBefore,
                        LocalDate validToAfter, String source, boolean cascaded, String by, String reason, Instant at) {
    }

    public record NewProposal(UUID brandId, UUID authorisationId, String action, LocalDate closeOn, String reason) {
    }

    public enum Outcome { DONE, NOT_FOUND, NOT_PENDING, NOT_PERMITTED, SAME_PERSON, ONLY_PROPOSER, DATE_PASSED, RULE_CONFLICT }

    public record Decided(Outcome outcome, String state) {
    }

    private static final String PROPOSAL = "SELECT p.id, p.target_brand_id, p.target_authorisation_id, "
        + "coalesce(tb.name, ab.name || ' for ' || ag.code || ' (' || pr.code || ')') AS label, p.action, p.close_on, p.reason, p.proposed_by, "
        + "u.display_name AS proposed_by_name, p.proposed_at, p.state, d.display_name AS decided_by_name, p.decided_at, p.decision_note "
        + "FROM register_revocation_proposal p JOIN user_account u ON u.id = p.proposed_by LEFT JOIN user_account d ON d.id = p.decided_by "
        + "LEFT JOIN brand tb ON tb.id = p.target_brand_id LEFT JOIN agency_authorisation aa ON aa.id = p.target_authorisation_id "
        + "LEFT JOIN brand ab ON ab.id = aa.brand_id LEFT JOIN organisation ag ON ag.id = aa.agency_organisation_id "
        + "LEFT JOIN organisation pr ON pr.id = aa.principal_organisation_id";

    private final JdbcTemplate jdbc;

    public RevocationRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public Set<String> rolesHolding(String capability) {
        return Set.copyOf(jdbc.queryForList("SELECT role FROM capability_grant WHERE capability = ?", String.class, capability));
    }

    public List<BrandEntry> brands() {
        return jdbc.query("SELECT b.id, b.name, o.code, b.status, b.source_reference FROM brand b JOIN organisation o ON o.id = b.owner_organisation_id "
            + "ORDER BY b.name, b.id", (rs, i) -> new BrandEntry(rs.getObject("id", UUID.class), rs.getString("name"), rs.getString("code"),
                rs.getString("status"), rs.getString("source_reference")));
    }

    public List<AuthorisationEntry> authorisations() {
        return jdbc.query("SELECT a.id, a.brand_id, b.name AS brand_name, ag.code AS agency, pr.code AS principal, a.valid_from, a.valid_to, a.status, "
            + "a.source_reference FROM agency_authorisation a JOIN brand b ON b.id = a.brand_id JOIN organisation ag ON ag.id = a.agency_organisation_id "
            + "JOIN organisation pr ON pr.id = a.principal_organisation_id ORDER BY b.name, ag.code, a.valid_from, a.id",
            (rs, i) -> new AuthorisationEntry(rs.getObject("id", UUID.class), rs.getObject("brand_id", UUID.class), rs.getString("brand_name"),
                rs.getString("agency"), rs.getString("principal"), rs.getDate("valid_from").toLocalDate(),
                rs.getDate("valid_to") == null ? null : rs.getDate("valid_to").toLocalDate(), rs.getString("status"), rs.getString("source_reference")));
    }

    /** The register's audit trail, newest first: every registration, revocation and closure that changed an entry. */
    public List<Event> events(int limit) {
        return jdbc.query("SELECT e.id, e.brand_id, e.authorisation_id, e.from_status, e.to_status, e.valid_to_before, e.valid_to_after, e.source, e.cascaded, "
            + "u.display_name, e.reason, e.occurred_at, coalesce(b.name, ab.name || ' for ' || ag.code || ' (' || pr.code || ')') AS label "
            + "FROM register_status_event e JOIN user_account u ON u.id = e.actor_account_id LEFT JOIN brand b ON b.id = e.brand_id "
            + "LEFT JOIN agency_authorisation a ON a.id = e.authorisation_id LEFT JOIN brand ab ON ab.id = a.brand_id "
            + "LEFT JOIN organisation ag ON ag.id = a.agency_organisation_id LEFT JOIN organisation pr ON pr.id = a.principal_organisation_id "
            + "ORDER BY e.occurred_at DESC, e.id LIMIT " + Math.max(1, Math.min(limit, 200)), (rs, i) -> {
                UUID brand = rs.getObject("brand_id", UUID.class);
                UUID auth = rs.getObject("authorisation_id", UUID.class);
                String from = rs.getString("from_status");
                String to = rs.getString("to_status");
                Date before = rs.getDate("valid_to_before");
                Date after = rs.getDate("valid_to_after");
                String kind = from == null ? "registered" : "revoked".equals(to) ? "revoked" : "closed";
                return new Event(rs.getObject("id", UUID.class), kind, brand != null ? "brand" : "authorisation", brand != null ? brand : auth, rs.getString("label"),
                    from, to, before == null ? null : before.toLocalDate(), after == null ? null : after.toLocalDate(), rs.getString("source"),
                    rs.getBoolean("cascaded"), rs.getString("display_name"), rs.getString("reason"), rs.getTimestamp("occurred_at").toInstant());
            });
    }

    public Optional<BrandEntry> brand(UUID id) {
        return brands().stream().filter(b -> b.id().equals(id)).findFirst();
    }

    public Optional<AuthorisationEntry> authorisation(UUID id) {
        return authorisations().stream().filter(a -> a.id().equals(id)).findFirst();
    }

    public List<Proposal> pending() {
        return jdbc.query(PROPOSAL + " WHERE p.state = 'pending' ORDER BY p.proposed_at", this::map);
    }

    public List<Proposal> recentDecided(int limit) {
        return jdbc.query(PROPOSAL + " WHERE p.state <> 'pending' ORDER BY p.decided_at DESC LIMIT " + Math.max(1, Math.min(limit, 100)), this::map);
    }

    public Optional<Proposal> proposal(UUID id) {
        return jdbc.query(PROPOSAL + " WHERE p.id = ?", this::map, id).stream().findFirst();
    }

    public Proposal insert(UUID proposerAccountId, NewProposal p) {
        UUID id = jdbc.queryForObject("INSERT INTO register_revocation_proposal (target_brand_id, target_authorisation_id, action, close_on, reason, proposed_by) "
            + "VALUES (?, ?, ?, ?, ?, ?) RETURNING id", UUID.class, p.brandId(), p.authorisationId(), p.action(),
            p.closeOn() == null ? null : Date.valueOf(p.closeOn()), p.reason(), proposerAccountId);
        return proposal(id).orElseThrow();
    }

    /** A transaction-scoped lock on a record, so two proposals for it queue instead of racing the unique index. */
    public void lockTarget(UUID target) {
        jdbc.query("SELECT pg_advisory_xact_lock(hashtextextended(?, 0))", rs -> {
        }, "register-revocation:" + target);
    }

    public boolean hasPending(UUID brandId, UUID authorisationId) {
        Boolean b = jdbc.queryForObject("SELECT EXISTS (SELECT 1 FROM register_revocation_proposal WHERE state = 'pending' "
            + "AND (target_brand_id = ?::uuid OR target_authorisation_id = ?::uuid))", Boolean.class, brandId, authorisationId);
        return Boolean.TRUE.equals(b);
    }

    /** Approve, reject or withdraw. A refusal comes back as a result (not an error), so the surrounding transaction stays usable. */
    public Decided decide(UUID proposalId, UUID deciderAccountId, String decision, String note) {
        return jdbc.query("SELECT out_state FROM register_revocation_decide(?, ?, ?, ?)", rs -> {
            rs.next();
            String state = rs.getString("out_state");
            if (state.equals("approved") || state.equals("rejected") || state.equals("withdrawn")) {
                return new Decided(Outcome.DONE, state);
            }
            return new Decided(Outcome.valueOf(state.toUpperCase()), null);
        }, proposalId, deciderAccountId, decision, note);
    }

    private Proposal map(ResultSet rs, int i) throws SQLException {
        java.sql.Timestamp d = rs.getTimestamp("decided_at");
        UUID brand = rs.getObject("target_brand_id", UUID.class);
        UUID auth = rs.getObject("target_authorisation_id", UUID.class);
        Date close = rs.getDate("close_on");
        return new Proposal(rs.getObject("id", UUID.class), brand != null ? "brand" : "authorisation", brand != null ? brand : auth, rs.getString("label"),
            rs.getString("action"), close == null ? null : close.toLocalDate(), rs.getString("reason"), rs.getObject("proposed_by", UUID.class),
            rs.getString("proposed_by_name"), rs.getTimestamp("proposed_at").toInstant(), rs.getString("state"), rs.getString("decided_by_name"),
            d == null ? null : d.toInstant(), rs.getString("decision_note"));
    }
}
