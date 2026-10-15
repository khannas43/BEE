package gov.bee.api.demo;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import gov.bee.api.identity.CallerResolver;
import gov.bee.api.identity.IdentityRepository;
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

@WebMvcTest(controllers = DemoController.class)
@Import({SecurityConfig.class, CallerResolver.class, gov.bee.api.web.CorrelationIdFilter.class, gov.bee.api.web.ApiExceptionHandler.class})
class DemoControllerSecurityTest {

    private static final UUID SUBJECT = UUID.fromString("00000000-0000-4000-a000-000000000002");

    @Autowired
    MockMvc mvc;

    @MockitoBean
    gov.bee.api.delegation.DelegationRepository delegationRepository;

    @MockitoBean
    IdentityRepository identity;

    @Test
    void anonymousCallerIsUnauthenticated() throws Exception {
        mvc.perform(get("/api/demo/payments")).andExpect(status().isUnauthorized()).andExpect(jsonPath("$.error").value("unauthenticated"));
        mvc.perform(post("/api/demo/payments/x/pay")).andExpect(status().isUnauthorized());
    }

    @Test
    void personWithoutAnAccountIsForbidden() throws Exception {
        when(identity.activeAccount(any())).thenReturn(Optional.empty());
        mvc.perform(get("/api/demo/payments").with(jwt().jwt(j -> j.subject(SUBJECT.toString()).claim("amr", List.of("pwd", "otp"))
                .claim("realm_access", Map.of("roles", List.of("manufacturer"))))))
            .andExpect(status().isForbidden()).andExpect(jsonPath("$.error").value("no_active_account"));
    }

    @Test
    void signedInPersonGetsNotFoundForAnUnknownModule() throws Exception {
        when(identity.activeAccount(SUBJECT)).thenReturn(Optional.of(new IdentityRepository.Account(SUBJECT, "nova.applicant", "Nova Applicant")));
        when(identity.activeRoles(SUBJECT)).thenReturn(List.of(new IdentityRepository.RoleGrant("manufacturer", "own-org")));
        mvc.perform(get("/api/demo/nothing").with(jwt().jwt(j -> j.subject(SUBJECT.toString()).claim("amr", List.of("pwd", "otp"))
                .claim("realm_access", Map.of("roles", List.of("manufacturer"))))))
            .andExpect(status().isNotFound()).andExpect(jsonPath("$.error").value("not_found"));
    }

    @Test
    void otherMethodsAndDeeperPathsAreDeniedByDefault() throws Exception {
        mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete("/api/demo/payments")
                .with(jwt().jwt(j -> j.subject(SUBJECT.toString())))).andExpect(status().isForbidden());
        mvc.perform(get("/api/demo/a/b/c/d").with(jwt().jwt(j -> j.subject(SUBJECT.toString())))).andExpect(status().isForbidden());
    }
}
