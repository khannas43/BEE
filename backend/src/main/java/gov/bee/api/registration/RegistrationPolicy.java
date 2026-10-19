package gov.bee.api.registration;

import gov.bee.api.administration.AdminDemonstrationAccess;
import gov.bee.api.application.ModelDraftPolicy;
import gov.bee.api.identity.Caller;
import gov.bee.api.identity.IdentityRepository.RoleGrant;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

/** WP04.2b-1: who may file a registration and who may read one. Provisional local rules, not BEE rules. */
public final class RegistrationPolicy {

    public static final String BRAND = "brand";
    public static final String AGENCY = "agency";

    private RegistrationPolicy() {
    }

    /** A request can be edited by its applicant while it is a draft, or after Programme or the Director returned it. */
    public static boolean editable(String state) {
        return "draft".equals(state) || "returned".equals(state);
    }

    /** The kind of request the caller may file: a manufacturer registers a brand, an agency asks to act for one. */
    public static Optional<String> kindFor(Caller caller) {
        if (ModelDraftPolicy.filingOrganisation(caller).isEmpty()) {
            return Optional.empty();
        }
        if (caller.holdsOwn("manufacturer", "own-org")) {
            return Optional.of(BRAND);
        }
        if (caller.holdsOwn("agency", "own-org")) {
            return Optional.of(AGENCY);
        }
        return Optional.empty();
    }

    public static Optional<UUID> filingOrganisation(Caller caller) {
        return kindFor(caller).isPresent() ? ModelDraftPolicy.filingOrganisation(caller) : Optional.empty();
    }

    /** What a caller reads: their own organisation's requests, and for each reviewing role the stages it works at and the decisions that followed. */
    public record ReadScope(Set<UUID> organisations, Set<String> stages, boolean allRecords) {
        public ReadScope(Set<UUID> organisations, Set<String> stages) {
            this(organisations, stages, false);
        }

        public boolean isEmpty() {
            return !allRecords && organisations.isEmpty() && stages.isEmpty();
        }

        public boolean canRead(RegistrationRepository.Row r) {
            if (allRecords) {
                return true;
            }
            return organisations.contains(r.organisationId()) || stages.contains(r.state());
        }
    }

    public static ReadScope readScope(Caller caller) {
        if (AdminDemonstrationAccess.mayReadAllOperationalRecords(caller)) {
            return new ReadScope(Set.of(), Set.of(), true);
        }
        Set<UUID> orgs = new LinkedHashSet<>();
        Set<String> stages = new LinkedHashSet<>();
        for (RoleGrant g : caller.ownRoles()) {
            if (("manufacturer".equals(g.role()) || "agency".equals(g.role())) && "own-org".equals(g.scope())) {
                orgs.addAll(caller.organisationIds());
            } else if ("finance".equals(g.role()) && "all".equals(g.scope())) {
                stages.add("fee_due");
            } else if ("programme".equals(g.role()) && "all".equals(g.scope())) {
                stages.addAll(List.of("programme_review", "director_approval", "approved", "returned", "rejected"));
            } else if ("director".equals(g.role()) && "all".equals(g.scope())) {
                stages.addAll(List.of("director_approval", "approved", "returned", "rejected"));
            }
        }
        return new ReadScope(orgs, stages);
    }
}
