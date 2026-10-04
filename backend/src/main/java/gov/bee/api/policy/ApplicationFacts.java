package gov.bee.api.policy;

import java.util.Set;
import java.util.UUID;

/**
 * What the policy needs to know about one application, as seen by one caller.
 *
 * @param assignedStagesForCaller stages at which the caller holds an active assignment record
 * @param actorsAtOtherStages     accounts that acted at another stage; supplied from the transition
 *                                history once WP05.2 adds it
 * @param brandPermitted          the caller's organisation owns the brand, or an active agency
 *                                authorisation covers it; false until WP04 adds those records
 */
public record ApplicationFacts(UUID id, UUID organisationId, String state, Set<String> assignedStagesForCaller,
                               Set<UUID> actorsAtOtherStages, boolean brandPermitted) {

    public ApplicationFacts {
        assignedStagesForCaller = Set.copyOf(assignedStagesForCaller);
        actorsAtOtherStages = Set.copyOf(actorsAtOtherStages);
    }
}
