package gov.bee.api.identity;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import gov.bee.api.security.SecurityConfig;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(controllers = MeController.class)
@Import(SecurityConfig.class)
class MeControllerSecurityTest {

    private static final UUID SUBJECT = UUID.fromString("00000000-0000-4000-a000-000000000001");

    @Autowired
    MockMvc mvc;

    @MockitoBean
    IdentityRepository identity;

    @Test
    void anonymousCallerIsUnauthenticated() throws Exception {
        mvc.perform(get("/api/me"))
            .andExpect(status().isUnauthorized())
            .andExpect(jsonPath("$.error").value("unauthenticated"))
            .andExpect(header().exists("X-Correlation-Id"));
    }

    @Test
    void unknownRouteIsDeniedEvenWithAValidToken() throws Exception {
        mvc.perform(get("/api/model-applications").with(jwt().jwt(j -> j.subject(SUBJECT.toString()))))
            .andExpect(status().isForbidden())
            .andExpect(jsonPath("$.error").value("denied_by_default"));
    }

    @Test
    void writeToMeIsDenied() throws Exception {
        mvc.perform(post("/api/me").with(jwt().jwt(j -> j.subject(SUBJECT.toString()))))
            .andExpect(status().isForbidden());
    }

    @Test
    void tokenWithoutDatabaseAccountIsForbidden() throws Exception {
        when(identity.activeAccount(any())).thenReturn(Optional.empty());
        mvc.perform(get("/api/me").with(jwt().jwt(j -> j.subject(SUBJECT.toString())
                .claim("realm_access", Map.of("roles", List.of("manufacturer"))))))
            .andExpect(status().isForbidden())
            .andExpect(jsonPath("$.error").value("no_active_account"));
    }

    @Test
    void tokenRoleWithoutActiveDatabaseRoleIsForbidden() throws Exception {
        when(identity.activeAccount(SUBJECT)).thenReturn(Optional.of(new IdentityRepository.Account(SUBJECT, "role.mismatch", "Role Mismatch")));
        when(identity.activeRoles(SUBJECT)).thenReturn(List.of(new IdentityRepository.RoleGrant("auditor", "all")));
        mvc.perform(get("/api/me").with(jwt().jwt(j -> j.subject(SUBJECT.toString())
                .claim("realm_access", Map.of("roles", List.of("finance"))))))
            .andExpect(status().isForbidden())
            .andExpect(jsonPath("$.error").value("no_effective_role"));
    }

    @Test
    void organisationComesFromDatabaseNotFromTokenClaim() throws Exception {
        when(identity.activeAccount(SUBJECT)).thenReturn(Optional.of(new IdentityRepository.Account(SUBJECT, "nova.applicant", "Nova Applicant")));
        when(identity.activeRoles(SUBJECT)).thenReturn(List.of(new IdentityRepository.RoleGrant("manufacturer", "own-org")));
        when(identity.activeMemberships(SUBJECT)).thenReturn(List.of(new IdentityRepository.Membership("NOVA", "manufacturer", "Nova Cool")));
        mvc.perform(get("/api/me").with(jwt().jwt(j -> j.subject(SUBJECT.toString())
                .claim("organisation", "PixelCert Agency (synthetic)")
                .claim("realm_access", Map.of("roles", List.of("manufacturer"))))))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.authority").value("spring-database"))
            .andExpect(jsonPath("$.organisations[0].code").value("NOVA"))
            .andExpect(jsonPath("$.organisations.length()").value(1))
            .andExpect(jsonPath("$.effectiveRoles[0].scope").value("own-org"))
            .andExpect(jsonPath("$.ignoredTokenClaims.organisation").value("PixelCert Agency (synthetic)"));
    }
}
