package gov.bee.api.identity;

import java.util.List;
import java.util.Set;
import java.util.UUID;

/**
 * The caller as the Spring database sees it: an active account, the roles that are
 * both actively assigned and present in the token, and active organisation memberships.
 */
public record Caller(UUID accountId, String username, List<IdentityRepository.RoleGrant> roles, Set<UUID> organisationIds) {

    public Caller {
        roles = List.copyOf(roles);
        organisationIds = Set.copyOf(organisationIds);
    }

    public boolean holds(String role, String scope) {
        return roles.stream().anyMatch(g -> g.role().equals(role) && g.scope().equals(scope));
    }
}
