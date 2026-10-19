package gov.bee.api.administration;

import gov.bee.api.identity.Caller;
import gov.bee.api.identity.IdentityRepository.RoleGrant;
import java.util.Set;

/**
 * The Admin demonstration umbrella (Brief C3A): read every operational record needed for the menu walkthrough,
 * without workflow or partner mutation authority. Enforcement lives here and in the policies that call it — not in
 * the browser preview role or a query flag.
 */
public final class AdminDemonstrationAccess {

    /** Roles that do operational work; an Admin who also holds one keeps that role's actions. */
    private static final Set<String> OPERATIONAL = Set.of(
        "manufacturer", "agency", "director", "secretary", "finance", "programme", "reviewer", "iame", "sda", "laboratory");

    private AdminDemonstrationAccess() {
    }

    /** Holds the Admin role for all records (assignment or delegation). */
    public static boolean holdsUmbrella(Caller caller) {
        return caller.holds("admin", "all");
    }

    /** True when the caller is the demonstration Admin profile: umbrella Admin without an operational own role. */
    public static boolean readOnlyUmbrella(Caller caller) {
        if (!caller.holdsOwn("admin", "all")) {
            return false;
        }
        return caller.ownRoles().stream().noneMatch(g -> OPERATIONAL.contains(g.role()));
    }

    /** Broad read for the demonstration traversal; does not imply any write. */
    public static boolean mayReadAllOperationalRecords(Caller caller) {
        return readOnlyUmbrella(caller);
    }

    /**
     * Blocks create, submit, approve, return, fee confirm, onboarding mutations and the other workflow writes when the
     * caller is the read-only Admin umbrella. Administrative capabilities (fee rules, delegations where already granted)
     * are unchanged.
     */
    public static boolean deniesOperationalMutation(Caller caller) {
        return readOnlyUmbrella(caller);
    }
}
