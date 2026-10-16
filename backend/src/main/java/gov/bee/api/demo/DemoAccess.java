package gov.bee.api.demo;

import gov.bee.api.identity.Caller;
import java.util.Set;

/**
 * Role checks for the demonstration modules (BL-231). A role name alone is not enough: the oversight roles (programme, director, secretary,
 * admin, auditor, finance, helpdesk) count only when held for all records, so a person who holds the same role with a narrower scope (the
 * Reviewer is "assigned") does not get all-organisation access by name. Delegated roles are always held for all records (Caller.roles()).
 */
public final class DemoAccess {

    private DemoAccess() {
    }

    /** One of the roles, held for all records. */
    public static boolean holdsAll(Caller c, Set<String> roles) {
        return c.roles().stream().anyMatch(g -> roles.contains(g.role()) && "all".equals(g.scope()));
    }

    /** One of the roles, with any scope. Only for roles that are own-organisation by nature (manufacturer, agency) or whose data needs no scope. */
    public static boolean holdsRole(Caller c, Set<String> roles) {
        return c.roles().stream().anyMatch(g -> roles.contains(g.role()));
    }
}
