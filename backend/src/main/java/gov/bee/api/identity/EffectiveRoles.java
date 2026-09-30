package gov.bee.api.identity;

import java.util.Collection;
import java.util.List;
import java.util.Set;

/**
 * A role is effective only when the Spring database holds an active assignment for it
 * and the Keycloak token also carries it. The token role is necessary, never sufficient.
 */
public final class EffectiveRoles {
    private EffectiveRoles() {
    }

    public static List<IdentityRepository.RoleGrant> compute(Collection<IdentityRepository.RoleGrant> activeInDatabase,
                                                             Set<String> tokenRoles) {
        return activeInDatabase.stream().filter(g -> tokenRoles.contains(g.role())).toList();
    }
}
