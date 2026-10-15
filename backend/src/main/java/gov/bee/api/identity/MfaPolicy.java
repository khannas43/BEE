package gov.bee.api.identity;

import java.util.Collection;
import java.util.List;
import org.springframework.security.oauth2.jwt.Jwt;

/**
 * WP02.3 local MFA policy at the API: the access token's {@code amr} claim (Keycloak AMR
 * mapper) must show both a password and a TOTP code, whichever client obtained it.
 */
public final class MfaPolicy {
    private MfaPolicy() {
    }

    public static final List<String> REQUIRED = List.of("pwd", "otp");

    /**
     * Off only when the environment says {@code BEE_MFA_REQUIRED=false}, which the demonstration deployment sets together with the portal's
     * BEE_DEMO_LOGIN (docs/demo/DEMO_WORK_PLAN.md). Anything else, including no setting, keeps the policy on.
     */
    private static final boolean ENFORCED = !"false".equalsIgnoreCase(System.getenv("BEE_MFA_REQUIRED"));

    public static boolean satisfied(Jwt jwt) {
        if (!ENFORCED) {
            return true;
        }
        Object amr = jwt.getClaims().get("amr");
        return amr instanceof Collection<?> methods && REQUIRED.stream().allMatch(methods::contains);
    }
}
