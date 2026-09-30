package gov.bee.api.policy;

import gov.bee.api.identity.Caller;
import gov.bee.api.identity.IdentityRepository.RoleGrant;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * The reviewed first-slice rules (FIRST_SLICE.md §3, §7, §8; ADR-001 D-RT3/D-RT4), and
 * nothing else. Callers are {@link Caller}s resolved from the Spring database; a role
 * counts only with the exact scope listed here. Rules are documented in
 * docs/wp02/WP02.2_POLICY.md. No screen-matrix capacity is imported.
 */
public final class SlicePolicy {
    private SlicePolicy() {
    }

    public static final String OWN_ORG = "own-org";
    public static final String ASSIGNED = "assigned";
    public static final String ALL = "all";

    /** P2–P4: the read rule for each slice role. Roles absent here (admin, helpdesk, auditor, sda, laboratory) read nothing. */
    private static final Map<String, ReadRule> READ_RULES = Map.of(
        "manufacturer", new ReadRule(OWN_ORG, null),
        "agency", new ReadRule(OWN_ORG, null),
        "iame", new ReadRule(ASSIGNED, null),
        "reviewer", new ReadRule(ASSIGNED, null),
        "finance", new ReadRule(ALL, "fee_due"),
        "programme", new ReadRule(ALL, "rating"),
        "director", new ReadRule(ALL, "director_review"),
        "secretary", new ReadRule(ALL, "secretary_approval"));

    private record ReadRule(String scope, String stage) {
    }

    /** What a caller may list and read. Empty means the caller has no model-application read at all. */
    public record ReadScope(Set<UUID> organisations, boolean assigned, Set<String> stages) {
        public ReadScope {
            organisations = Set.copyOf(organisations);
            stages = Set.copyOf(stages);
        }

        public boolean isEmpty() {
            return organisations.isEmpty() && !assigned && stages.isEmpty();
        }
    }

    public static ReadScope readScope(Caller caller) {
        Set<UUID> orgs = new LinkedHashSet<>();
        Set<String> stages = new LinkedHashSet<>();
        boolean assigned = false;
        for (RoleGrant g : caller.roles()) {
            ReadRule rule = READ_RULES.get(g.role());
            if (rule == null || !rule.scope().equals(g.scope())) {
                continue;
            }
            switch (rule.scope()) {
                case OWN_ORG -> orgs.addAll(caller.organisationIds());
                case ASSIGNED -> assigned = true;
                default -> stages.add(rule.stage());
            }
        }
        return new ReadScope(orgs, assigned, stages);
    }

    /** The server's own recheck of a row the repository returned; must agree with the SQL filter. */
    public static boolean canRead(ReadScope scope, ApplicationFacts app) {
        return scope.organisations().contains(app.organisationId())
            || (scope.assigned() && app.assignedStagesForCaller().contains(app.state()))
            || scope.stages().contains(app.state());
    }

    /** Which read rule let the caller see the row, for the response. */
    public static List<String> readBasis(ReadScope scope, ApplicationFacts app) {
        List<String> basis = new ArrayList<>();
        if (scope.organisations().contains(app.organisationId())) {
            basis.add(OWN_ORG);
        }
        if (scope.assigned() && app.assignedStagesForCaller().contains(app.state())) {
            basis.add(ASSIGNED);
        }
        if (scope.stages().contains(app.state())) {
            basis.add("stage:" + app.state());
        }
        return basis;
    }

    public record Decision(boolean allowed, String reason) {
        static Decision allow() {
            return new Decision(true, "allowed_by_slice_rule");
        }

        static Decision deny(String reason) {
            return new Decision(false, reason);
        }
    }

    /**
     * P6: the reusable check for one of the seven slice steps. It answers whether the rule
     * would allow the action; no endpoint performs a transition yet (P7), so an allowed
     * decision changes nothing until the owning work package wires the transition.
     */
    public static Decision check(SliceAction action, Caller caller, ApplicationFacts app) {
        if (caller.roles().stream().noneMatch(g -> READ_RULES.containsKey(g.role()))) {
            return Decision.deny("not_a_slice_role");
        }
        List<RoleGrant> usable = caller.roles().stream().filter(action.actors()::contains).toList();
        if (usable.isEmpty()) {
            return Decision.deny("role_not_permitted");
        }
        if (!action.fromStates().contains(app.state())) {
            return Decision.deny("wrong_stage");
        }
        String scope = usable.get(0).scope();
        if (scope.equals(OWN_ORG) && !caller.organisationIds().contains(app.organisationId())) {
            return Decision.deny("outside_scope");
        }
        if (scope.equals(ASSIGNED) && !app.assignedStagesForCaller().contains(action.stage())) {
            return Decision.deny("not_assigned");
        }
        if (action == SliceAction.SUBMIT && !app.brandPermitted()) {
            return Decision.deny("brand_not_permitted");
        }
        if (action != SliceAction.SUBMIT && app.actorsAtOtherStages().contains(caller.accountId())) {
            return Decision.deny("same_user_other_stage");
        }
        return Decision.allow();
    }
}
