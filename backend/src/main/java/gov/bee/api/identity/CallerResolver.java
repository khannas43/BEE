package gov.bee.api.identity;

import java.util.UUID;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Component;

/** Maps a validated token to a {@link Caller}, or to the reason Spring refuses it. */
@Component
public class CallerResolver {

    public record Resolution(Caller caller, String denial) {
        static Resolution denied(String reason) {
            return new Resolution(null, reason);
        }
    }

    public static final String CALLER_ATTRIBUTE = "bee.caller";

    private final IdentityRepository identity;

    public CallerResolver(IdentityRepository identity) {
        this.identity = identity;
    }

    public Resolution resolve(Jwt jwt) {
        UUID subject;
        try {
            subject = UUID.fromString(jwt.getSubject());
        } catch (IllegalArgumentException | NullPointerException e) {
            return Resolution.denied("no_active_account");
        }
        if (!MfaPolicy.satisfied(jwt)) {
            return Resolution.denied("mfa_required");
        }
        var account = identity.activeAccount(subject);
        if (account.isEmpty()) {
            return Resolution.denied("no_active_account");
        }
        var effective = EffectiveRoles.compute(identity.activeRoles(account.get().id()), MeController.realmRoles(jwt));
        if (effective.isEmpty()) {
            return Resolution.denied("no_effective_role");
        }
        var orgs = identity.activeMembershipOrganisationIds(account.get().id());
        var delegated = identity.activeDelegations(account.get().id(), java.time.LocalDate.now(java.time.ZoneId.of("Asia/Kolkata")));
        var caller = new Caller(account.get().id(), account.get().username(), effective, orgs, delegated, null);
        // The request carries its caller, so the delegation log can see which delegations a successful write depended on.
        var attributes = org.springframework.web.context.request.RequestContextHolder.getRequestAttributes();
        if (attributes != null) {
            attributes.setAttribute(CALLER_ATTRIBUTE, caller, org.springframework.web.context.request.RequestAttributes.SCOPE_REQUEST);
        }
        return new Resolution(caller, null);
    }
}
