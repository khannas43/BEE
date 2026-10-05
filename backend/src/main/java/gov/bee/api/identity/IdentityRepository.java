package gov.bee.api.identity;

import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/** Reads the authoritative account, role, membership and assignment rows. */
@Repository
public class IdentityRepository {

    public record Account(UUID id, String username, String displayName) {
    }

    public record RoleGrant(String role, String scope) {
    }

    public record Membership(String code, String kind, String legalName) {
    }

    private final JdbcTemplate jdbc;

    public IdentityRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public Optional<Account> activeAccount(UUID keycloakSubject) {
        return jdbc.query(
            "SELECT id, username, display_name FROM user_account WHERE keycloak_subject = ? AND status = 'active'",
            (rs, i) -> new Account(rs.getObject("id", UUID.class), rs.getString("username"), rs.getString("display_name")),
            keycloakSubject).stream().findFirst();
    }

    public List<RoleGrant> activeRoles(UUID userId) {
        return jdbc.query(
            "SELECT role, scope FROM role_assignment WHERE user_id = ? AND active AND now() >= valid_from AND now() < valid_to ORDER BY role",
            (rs, i) -> new RoleGrant(rs.getString("role"), rs.getString("scope")), userId);
    }

    /** The permissions the given roles hold (capability_grant), sorted: what a screen may offer, never what an action is allowed. */
    public List<String> capabilities(java.util.Collection<String> roles) {
        if (roles.isEmpty()) {
            return List.of();
        }
        String marks = String.join(", ", java.util.Collections.nCopies(roles.size(), "?"));
        return jdbc.queryForList("SELECT DISTINCT capability FROM capability_grant WHERE role IN (" + marks + ") ORDER BY capability", String.class, roles.toArray());
    }

    public List<Membership> activeMemberships(UUID userId) {
        return jdbc.query(
            "SELECT o.code, o.kind, o.legal_name FROM organisation_membership m JOIN organisation o ON o.id = m.organisation_id "
                + "WHERE m.user_id = ? AND m.active AND o.status = 'active' AND now() >= m.valid_from AND now() < m.valid_to ORDER BY o.code",
            (rs, i) -> new Membership(rs.getString("code"), rs.getString("kind"), rs.getString("legal_name")), userId);
    }

    public Set<UUID> activeMembershipOrganisationIds(UUID userId) {
        return Set.copyOf(jdbc.query(
            "SELECT m.organisation_id FROM organisation_membership m JOIN organisation o ON o.id = m.organisation_id "
                + "WHERE m.user_id = ? AND m.active AND o.status = 'active' AND now() >= m.valid_from AND now() < m.valid_to",
            (rs, i) -> rs.getObject(1, UUID.class), userId));
    }

    public int activeAssignments(UUID userId) {
        Integer n = jdbc.queryForObject("SELECT count(*) FROM assignment WHERE user_id = ? AND active", Integer.class, userId);
        return n == null ? 0 : n;
    }
}
