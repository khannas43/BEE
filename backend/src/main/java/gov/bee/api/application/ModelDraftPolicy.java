package gov.bee.api.application;

import gov.bee.api.brand.BrandAuthRepository;
import gov.bee.api.brand.BrandAuthService;
import gov.bee.api.identity.Caller;
import gov.bee.api.identity.IdentityRepository.Membership;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/** WP05.1b: who may create or edit draft model applications and which brand they may file on. */
public final class ModelDraftPolicy {

    public static final ZoneId IST = ZoneId.of("Asia/Kolkata");

    private ModelDraftPolicy() {
    }

    public record BrandChoice(UUID brandId, String brandName, UUID principalOrganisationId, String principalOrganisationCode) {
    }

    public record Decision(boolean allowed, String denial, Optional<BrandChoice> brand) {
        static Decision allow(BrandChoice brand) {
            return new Decision(true, null, Optional.of(brand));
        }

        static Decision deny(String code) {
            return new Decision(false, code, Optional.empty());
        }
    }

    public static Optional<UUID> filingOrganisation(Caller caller) {
        if (!caller.holds("manufacturer", "own-org") && !caller.holds("agency", "own-org")) {
            return Optional.empty();
        }
        if (caller.organisationIds().size() != 1) {
            return Optional.empty();
        }
        return caller.organisationIds().stream().findFirst();
    }

    public static boolean canWrite(Caller caller) {
        return filingOrganisation(caller).isPresent();
    }

    public static Decision brandForFiling(Caller caller, List<Membership> memberships, UUID brandId, BrandAuthRepository brands,
                                          BrandAuthService brandService, LocalDate at) {
        Optional<UUID> filing = filingOrganisation(caller);
        if (filing.isEmpty()) {
            return Decision.deny("no_write_scope");
        }
        UUID filingOrg = filing.get();
        if (memberships.size() != 1) {
            return Decision.deny("no_write_scope");
        }
        Membership filingMembership = memberships.get(0);
        String kind = filingMembership.kind();
        if ("manufacturer".equals(kind) && caller.holds("manufacturer", "own-org")) {
            return brands.brandOwnedBy(brandId, filingOrg)
                .map(b -> Decision.allow(new BrandChoice(b.id(), b.name(), filingOrg, filingMembership.code())))
                .orElse(Decision.deny("brand_not_permitted"));
        }
        if ("agency".equals(kind) && caller.holds("agency", "own-org")) {
            var brand = brands.brand(brandId);
            if (brand.isEmpty() || !brand.get().active()) {
                return Decision.deny("brand_not_permitted");
            }
            UUID principal = brand.get().ownerOrganisationId();
            if (!brandService.agencyAuthorisation(filingOrg, brandId, principal, at).authorised()) {
                return Decision.deny("brand_not_permitted");
            }
            return Decision.allow(new BrandChoice(brandId, brand.get().name(), principal, null));
        }
        return Decision.deny("no_write_scope");
    }
}
