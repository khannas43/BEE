package gov.bee.api.manufactureronboarding;

import gov.bee.api.application.ModelDraftPolicy;
import gov.bee.api.identity.Caller;
import gov.bee.api.identity.IdentityRepository.RoleGrant;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

/** WP3 optimized manufacturer onboarding — provisional local rules, not BEE rules. */
public final class ManufacturerOnboardingPolicy {

    private ManufacturerOnboardingPolicy() {
    }

    public static boolean editable(String state) {
        return "draft".equals(state) || "automatic_checks_failed".equals(state);
    }

    public static Optional<UUID> filingOrganisation(Caller caller) {
        if (!caller.holdsOwn("manufacturer", "own-org")) {
            return Optional.empty();
        }
        return ModelDraftPolicy.filingOrganisation(caller);
    }

    public record ReadScope(Set<UUID> organisations, Set<String> stages) {
        public boolean isEmpty() {
            return organisations.isEmpty() && stages.isEmpty();
        }

        public boolean canRead(ManufacturerOnboardingRepository.Row row) {
            return organisations.contains(row.organisationId()) || stages.contains(row.state());
        }
    }

    public static ReadScope readScope(Caller caller) {
        Set<UUID> orgs = new LinkedHashSet<>();
        Set<String> stages = new LinkedHashSet<>();
        for (RoleGrant g : caller.ownRoles()) {
            if ("manufacturer".equals(g.role()) && "own-org".equals(g.scope())) {
                orgs.addAll(caller.organisationIds());
            } else if ("director".equals(g.role()) && "all".equals(g.scope())) {
                stages.addAll(List.of("director_review", "active_observation", "active", "on_hold", "rejected", "revoked", "automatic_checks_failed", "submitted"));
            } else if (("finance".equals(g.role()) || "programme".equals(g.role())) && "all".equals(g.scope())) {
                stages.addAll(List.of("director_review", "submitted", "automatic_checks_failed", "active_observation", "active", "on_hold"));
            }
        }
        return new ReadScope(orgs, stages);
    }

    /** Finance or Programme only; derived from Spring role grants, never from the request body. */
    public static String anomalyActorRole(Caller caller) {
        if (caller.holds("finance", "all")) {
            return "finance";
        }
        if (caller.holds("programme", "all")) {
            return "programme";
        }
        if (caller.holds("director", "all")) {
            return "director";
        }
        return null;
    }

    public static boolean canDirectorAct(Caller caller) {
        return caller.holds("director", "all");
    }
}
