package gov.bee.api.identity;

import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * The caller as the Spring database sees it: an active account, the roles that are
 * both actively assigned and present in the token, and active organisation memberships.
 *
 * <p>A delegation (WP02.4c) adds the delegator's role for a short period. {@link #roles()} and {@link #holds} include delegated roles, so the stage
 * steps on model applications work for a delegate; {@link #ownRoles()} and {@link #holdsOwn} do not, and are what administrative capabilities and
 * registration review use. When a role check is passed only because of a delegation, the delegation is noted in {@link #usedDelegations()} so
 * that the write it enabled can be logged. Segregation of duties counts the delegator too ({@link #actingIdentities()}).</p>
 */
public record Caller(UUID accountId, String username, List<IdentityRepository.RoleGrant> ownRoles, Set<UUID> organisationIds,
                     List<Delegated> delegated, Set<Delegated> usedDelegations) {

    /** A role held through a delegation: which one, whose, and which role. */
    public record Delegated(UUID delegationId, UUID delegatorId, String role) {
    }

    public Caller {
        ownRoles = List.copyOf(ownRoles);
        organisationIds = Set.copyOf(organisationIds);
        delegated = List.copyOf(delegated);
        usedDelegations = usedDelegations == null ? ConcurrentHashMap.newKeySet() : usedDelegations;
    }

    /** A caller with no delegations. */
    public Caller(UUID accountId, String username, List<IdentityRepository.RoleGrant> roles, Set<UUID> organisationIds) {
        this(accountId, username, roles, organisationIds, List.of(), null);
    }

    /** The roles the caller holds, delegated ones included (all delegated roles are held for all records). */
    public List<IdentityRepository.RoleGrant> roles() {
        if (delegated.isEmpty()) {
            return ownRoles;
        }
        Set<IdentityRepository.RoleGrant> all = new LinkedHashSet<>(ownRoles);
        delegated.forEach(d -> all.add(new IdentityRepository.RoleGrant(d.role(), "all")));
        return List.copyOf(all);
    }

    /**
     * The held roles that satisfy a rule. When none of the caller's own roles does and a delegated role does, the delegation was needed to pass the
     * rule, and it is noted as used. A rule that an own role satisfies never notes a delegation.
     */
    public List<IdentityRepository.RoleGrant> usable(java.util.function.Predicate<IdentityRepository.RoleGrant> rule) {
        List<IdentityRepository.RoleGrant> own = ownRoles.stream().filter(rule).toList();
        if (!own.isEmpty() || delegated.isEmpty()) {
            return own;
        }
        List<IdentityRepository.RoleGrant> viaDelegation = new java.util.ArrayList<>();
        for (Delegated d : delegated) {
            var grant = new IdentityRepository.RoleGrant(d.role(), "all");
            if (rule.test(grant)) {
                usedDelegations.add(d);
                viaDelegation.add(grant);
            }
        }
        return List.copyOf(viaDelegation);
    }

    public boolean holdsOwn(String role, String scope) {
        return ownRoles.stream().anyMatch(g -> g.role().equals(role) && g.scope().equals(scope));
    }

    /** True when the caller holds the role, through an assignment or a delegation; a delegation that was needed is noted as used. */
    public boolean holds(String role, String scope) {
        if (holdsOwn(role, scope)) {
            return true;
        }
        boolean any = false;
        for (Delegated d : delegated) {
            if (d.role().equals(role) && "all".equals(scope)) {
                usedDelegations.add(d);
                any = true;
            }
        }
        return any;
    }

    /** The accounts that count as the actor for segregation of duties: the caller and the people whose roles the caller holds by delegation. */
    public Set<UUID> actingIdentities() {
        Set<UUID> ids = new HashSet<>();
        ids.add(accountId);
        delegated.forEach(d -> ids.add(d.delegatorId()));
        return ids;
    }

    public boolean usesDelegation() {
        return !usedDelegations.isEmpty();
    }
}
