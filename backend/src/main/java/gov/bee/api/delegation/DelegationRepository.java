package gov.bee.api.delegation;

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
 * WP02.4c: delegations of a role for a short period (V49). A request is inserted by the runtime login; every decision runs in one database
 * function that holds the capability check, the three-person rule and the eligibility rules. Provisional local rules, not BEE rules.
 */
@Repository
public class DelegationRepository {

    public static final String APPROVE = "delegation_approve";
    /** The roles that can be delegated: stage roles held for all records. Never the Secretary, an administrative role, or an assigned-scope role. */
    public static final Set<String> DELEGABLE = Set.of("programme", "director", "finance");

    public record Delegation(UUID id, UUID delegatorId, String delegator, UUID delegateId, String delegate, String role, String reason, LocalDate validFrom,
                             LocalDate validTo, String state, Instant requestedAt, String decidedBy, Instant decidedAt, String decisionNote,
                             String revokedBy, Instant revokedAt, String revokeNote, int uses, boolean holdsNow) {
    }

    public record Colleague(UUID id, String displayName, List<String> roles) {
    }

    public record NewDelegation(UUID delegateId, String role, LocalDate validFrom, LocalDate validTo, String reason) {
    }

    public enum Outcome { DONE, NOT_FOUND, NOT_PENDING, NOT_ACTIVE, NOT_PERMITTED, SAME_PERSON, ONLY_DELEGATOR, DATE_PASSED, NOT_ELIGIBLE }

    public record Decided(Outcome outcome, String state) {
    }

    private static final String SELECT = "SELECT d.id, d.delegator_id, du.display_name AS delegator, d.delegate_id, eu.display_name AS delegate, d.role, d.reason, "
        + "d.valid_from, d.valid_to, d.state, d.requested_at, dec.display_name AS decided_by, d.decided_at, d.decision_note, rev.display_name AS revoked_by, "
        + "d.revoked_at, d.revoke_note, (SELECT count(*) FROM delegation_use u WHERE u.delegation_id = d.id) AS uses, "
        + "(d.state = 'approved' AND d.valid_from <= ?::date AND ?::date < d.valid_to AND EXISTS (SELECT 1 FROM role_assignment ra WHERE ra.user_id = d.delegator_id "
        + "AND ra.role = d.role AND ra.scope = 'all' AND ra.active AND now() >= ra.valid_from AND now() < ra.valid_to)) AS holds_now "
        + "FROM delegation d JOIN user_account du ON du.id = d.delegator_id JOIN user_account eu ON eu.id = d.delegate_id "
        + "LEFT JOIN user_account dec ON dec.id = d.decided_by LEFT JOIN user_account rev ON rev.id = d.revoked_by ";

    private final JdbcTemplate jdbc;

    public DelegationRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public Set<String> rolesHolding(String capability) {
        return Set.copyOf(jdbc.queryForList("SELECT role FROM capability_grant WHERE capability = ?", String.class, capability));
    }

    private List<Delegation> query(String where, LocalDate today, Object... args) {
        Object[] all = new Object[args.length + 2];
        all[0] = Date.valueOf(today);
        all[1] = Date.valueOf(today);
        System.arraycopy(args, 0, all, 2, args.length);
        return jdbc.query(SELECT + where, (rs, i) -> map(rs), all);
    }

    public List<Delegation> forPerson(UUID account, LocalDate today) {
        return query("WHERE d.delegator_id = ? OR d.delegate_id = ? ORDER BY d.requested_at DESC, d.id LIMIT 100", today, account, account);
    }

    public List<Delegation> pending(LocalDate today) {
        return query("WHERE d.state = 'pending' ORDER BY d.requested_at, d.id", today);
    }

    public List<Delegation> recent(LocalDate today, int limit) {
        return query("WHERE d.state <> 'pending' ORDER BY coalesce(d.revoked_at, d.decided_at) DESC LIMIT " + Math.max(1, Math.min(limit, 100)), today);
    }

    public Optional<Delegation> find(UUID id, LocalDate today) {
        return query("WHERE d.id = ?", today, id).stream().findFirst();
    }

    public Delegation insert(UUID delegatorId, NewDelegation n, LocalDate today) {
        UUID id = jdbc.queryForObject("INSERT INTO delegation (delegator_id, delegate_id, role, reason, valid_from, valid_to) VALUES (?, ?, ?, ?, ?, ?) RETURNING id",
            UUID.class, delegatorId, n.delegateId(), n.role(), n.reason(), Date.valueOf(n.validFrom()), Date.valueOf(n.validTo()));
        return find(id, today).orElseThrow();
    }

    /** People who share an organisation with the delegator and hold an active role of their own: who the delegator may name. */
    public List<Colleague> colleagues(UUID delegator) {
        var rows = jdbc.query("SELECT DISTINCT u.id, u.display_name FROM user_account u JOIN organisation_membership b ON b.user_id = u.id AND b.active "
            + "AND b.valid_from <= now() AND now() < b.valid_to JOIN organisation_membership a ON a.organisation_id = b.organisation_id AND a.user_id = ? AND a.active "
            + "AND a.valid_from <= now() AND now() < a.valid_to WHERE u.status = 'active' AND u.id <> ? AND EXISTS (SELECT 1 FROM role_assignment ra "
            + "WHERE ra.user_id = u.id AND ra.active AND ra.valid_from <= now() AND now() < ra.valid_to) ORDER BY u.display_name",
            (rs, i) -> new Colleague(rs.getObject("id", UUID.class), rs.getString("display_name"), List.of()), delegator, delegator);
        return rows.stream().map(c -> new Colleague(c.id(), c.displayName(), jdbc.queryForList("SELECT role FROM role_assignment WHERE user_id = ? AND active "
            + "AND valid_from <= now() AND now() < valid_to ORDER BY role", String.class, c.id()))).toList();
    }

    public boolean accountExists(UUID id) {
        Boolean b = jdbc.queryForObject("SELECT EXISTS (SELECT 1 FROM user_account WHERE id = ?)", Boolean.class, id);
        return Boolean.TRUE.equals(b);
    }

    /** The delegator holds the role now, as an active account, for all records. */
    public boolean holdsRole(UUID account, String role) {
        Boolean b = jdbc.queryForObject("SELECT EXISTS (SELECT 1 FROM role_assignment ra JOIN user_account u ON u.id = ra.user_id AND u.status = 'active' "
            + "WHERE ra.user_id = ? AND ra.role = ? AND ra.scope = 'all' AND ra.active AND now() >= ra.valid_from AND now() < ra.valid_to)", Boolean.class, account, role);
        return Boolean.TRUE.equals(b);
    }

    public Decided decide(UUID id, UUID actor, String decision, String note) {
        return jdbc.query("SELECT out_state FROM delegation_decide(?, ?, ?, ?)", rs -> {
            rs.next();
            String state = rs.getString("out_state");
            if (state.equals("approved") || state.equals("rejected") || state.equals("withdrawn") || state.equals("revoked")) {
                return new Decided(Outcome.DONE, state);
            }
            return new Decided(Outcome.valueOf(state.toUpperCase()), null);
        }, id, actor, decision, note);
    }

    public void recordUse(UUID delegationId, UUID actingAccount, UUID delegatorId, String role, String method, String route, int status, String correlationId) {
        jdbc.update("INSERT INTO delegation_use (delegation_id, acting_account_id, delegator_id, role, method, route, status, correlation_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            delegationId, actingAccount, delegatorId, role, method, route, status, correlationId);
    }

    private static Delegation map(ResultSet rs) throws SQLException {
        java.sql.Timestamp decided = rs.getTimestamp("decided_at");
        java.sql.Timestamp revoked = rs.getTimestamp("revoked_at");
        return new Delegation(rs.getObject("id", UUID.class), rs.getObject("delegator_id", UUID.class), rs.getString("delegator"), rs.getObject("delegate_id", UUID.class),
            rs.getString("delegate"), rs.getString("role"), rs.getString("reason"), rs.getDate("valid_from").toLocalDate(), rs.getDate("valid_to").toLocalDate(),
            rs.getString("state"), rs.getTimestamp("requested_at").toInstant(), rs.getString("decided_by"), decided == null ? null : decided.toInstant(),
            rs.getString("decision_note"), rs.getString("revoked_by"), revoked == null ? null : revoked.toInstant(), rs.getString("revoke_note"), rs.getInt("uses"),
            rs.getBoolean("holds_now"));
    }
}
