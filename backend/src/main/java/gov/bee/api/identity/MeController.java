package gov.bee.api.identity;

import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Who the caller is and what the Spring database lets them do. Keycloak supplies
 * only the subject and the token roles; organisation, active roles, assignments
 * and scope come from the database. Token attributes are echoed as ignored.
 */
@RestController
public class MeController {

    private final IdentityRepository identity;

    public MeController(IdentityRepository identity) {
        this.identity = identity;
    }

    @GetMapping("/api/me")
    public ResponseEntity<Map<String, Object>> me(@AuthenticationPrincipal Jwt jwt) {
        UUID subject;
        try {
            subject = UUID.fromString(jwt.getSubject());
        } catch (IllegalArgumentException | NullPointerException e) {
            return deny("no_active_account");
        }
        var account = identity.activeAccount(subject);
        if (account.isEmpty()) {
            return deny("no_active_account");
        }
        Set<String> tokenRoles = realmRoles(jwt);
        var effective = EffectiveRoles.compute(identity.activeRoles(account.get().id()), tokenRoles);
        if (effective.isEmpty()) {
            return deny("no_effective_role");
        }

        Map<String, Object> body = new LinkedHashMap<>();
        body.put("subject", subject.toString());
        body.put("username", account.get().username());
        body.put("displayName", account.get().displayName());
        body.put("authority", "spring-database");
        body.put("effectiveRoles", effective.stream().map(g -> Map.of("role", g.role(), "scope", g.scope())).toList());
        body.put("organisations", identity.activeMemberships(account.get().id()).stream()
            .map(m -> Map.of("code", m.code(), "kind", m.kind(), "name", m.legalName())).toList());
        body.put("activeAssignments", identity.activeAssignments(account.get().id()));
        body.put("tokenRoles", tokenRoles.stream().sorted().toList());
        Object orgClaim = jwt.getClaims().get("organisation");
        if (orgClaim != null) {
            body.put("ignoredTokenClaims", Map.of("organisation", orgClaim));
        }
        return ResponseEntity.ok(body);
    }

    static Set<String> realmRoles(Jwt jwt) {
        Object realmAccess = jwt.getClaims().get("realm_access");
        if (realmAccess instanceof Map<?, ?> map && map.get("roles") instanceof Collection<?> roles) {
            return roles.stream().map(String::valueOf).collect(Collectors.toSet());
        }
        return Set.of();
    }

    private static ResponseEntity<Map<String, Object>> deny(String reason) {
        return ResponseEntity.status(HttpStatus.FORBIDDEN).body(Map.of("error", reason));
    }
}
