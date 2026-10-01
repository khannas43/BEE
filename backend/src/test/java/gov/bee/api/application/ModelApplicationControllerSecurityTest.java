package gov.bee.api.application;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import gov.bee.api.identity.CallerResolver;
import gov.bee.api.identity.IdentityRepository;
import gov.bee.api.security.SecurityConfig;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.request.RequestPostProcessor;

@WebMvcTest(controllers = ModelApplicationController.class)
@Import({SecurityConfig.class, CallerResolver.class})
class ModelApplicationControllerSecurityTest {

    static final UUID USER = UUID.fromString("00000000-0000-4000-a000-000000000001");
    static final UUID NOVA = UUID.fromString("00000000-0000-4000-b000-000000000001");
    static final UUID PIXEL = UUID.fromString("00000000-0000-4000-b000-000000000002");
    static final UUID NOVA_APP = UUID.fromString("00000000-0000-4000-c000-000000000002");
    static final UUID PIXEL_APP = UUID.fromString("00000000-0000-4000-c000-000000000003");
    static final String NOT_FOUND = "{\"error\":\"not_found\"}";

    @Autowired
    MockMvc mvc;

    @MockitoBean
    IdentityRepository identity;

    @MockitoBean
    ModelApplicationRepository applications;

    RequestPostProcessor token(String... roles) {
        return jwt().jwt(j -> j.subject(USER.toString()).claim("organisation", "PixelCert Agency (synthetic)").claim("amr", List.of("pwd", "otp"))
            .claim("realm_access", Map.of("roles", List.of(roles))));
    }

    void account(String role, String scope, UUID... orgs) {
        when(identity.activeAccount(USER)).thenReturn(Optional.of(new IdentityRepository.Account(USER, "u", "U")));
        when(identity.activeRoles(USER)).thenReturn(List.of(new IdentityRepository.RoleGrant(role, scope)));
        when(identity.activeMembershipOrganisationIds(USER)).thenReturn(Set.of(orgs));
    }

    static ModelApplicationRepository.Row row(UUID id, UUID org, String code, String state, String... stages) {
        return new ModelApplicationRepository.Row(id, "LOCAL-MA", org, code, "Brand", "RAC", "M-1", state, 0, Set.of(stages));
    }

    @Test
    void anonymousCallerIsUnauthenticated() throws Exception {
        mvc.perform(get("/api/model-applications")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/model-applications/" + NOVA_APP)).andExpect(status().isUnauthorized());
        verifyNoInteractions(applications);
    }

    @Test
    void passwordOnlyTokenIsRefusedBeforeAnyDatabaseLookup() throws Exception {
        var pwdOnly = jwt().jwt(j -> j.subject(USER.toString()).claim("amr", List.of("pwd")).claim("realm_access", Map.of("roles", List.of("manufacturer"))));
        mvc.perform(get("/api/model-applications").with(pwdOnly))
            .andExpect(status().isForbidden()).andExpect(jsonPath("$.error").value("mfa_required"));
        mvc.perform(get("/api/model-applications/" + NOVA_APP).with(pwdOnly))
            .andExpect(status().isForbidden()).andExpect(jsonPath("$.error").value("mfa_required"));
        verifyNoInteractions(applications, identity);
    }

    @Test
    void tokenWithoutDatabaseAccountIsForbidden() throws Exception {
        when(identity.activeAccount(any())).thenReturn(Optional.empty());
        mvc.perform(get("/api/model-applications").with(token("manufacturer")))
            .andExpect(status().isForbidden()).andExpect(jsonPath("$.error").value("no_active_account"));
        verifyNoInteractions(applications);
    }

    @Test
    void tokenRoleWithoutMatchingDatabaseRoleIsForbidden() throws Exception {
        account("auditor", "all");
        mvc.perform(get("/api/model-applications").with(token("finance")))
            .andExpect(status().isForbidden()).andExpect(jsonPath("$.error").value("no_effective_role"));
        verifyNoInteractions(applications);
    }

    @ParameterizedTest
    @ValueSource(strings = {"admin", "helpdesk", "auditor"})
    void nonSliceRolesHaveNoReadScope(String role) throws Exception {
        account(role, "all");
        mvc.perform(get("/api/model-applications").with(token(role)))
            .andExpect(status().isForbidden()).andExpect(content().json("{\"error\":\"no_read_scope\"}", true));
        mvc.perform(get("/api/model-applications/" + NOVA_APP).with(token(role)))
            .andExpect(status().isForbidden()).andExpect(content().json("{\"error\":\"no_read_scope\"}", true));
        verifyNoInteractions(applications);
    }

    @Test
    void partnerWithoutActiveMembershipHasNoReadScope() throws Exception {
        account("manufacturer", "own-org");
        mvc.perform(get("/api/model-applications").with(token("manufacturer")))
            .andExpect(status().isForbidden()).andExpect(jsonPath("$.error").value("no_read_scope"));
        verifyNoInteractions(applications);
    }

    @Test
    void listIsFilteredByDatabaseMembershipNotTokenClaim() throws Exception {
        account("manufacturer", "own-org", NOVA);
        when(applications.list(any(), eq(USER))).thenReturn(List.of(row(NOVA_APP, NOVA, "NOVA", "fee_due")));
        mvc.perform(get("/api/model-applications").with(token("manufacturer")))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.count").value(1))
            .andExpect(jsonPath("$.items[0].organisation").value("NOVA"))
            .andExpect(jsonPath("$.items[0].readBasis[0]").value("own-org"));
        verify(applications).list(argThat(s -> s.organisations().equals(Set.of(NOVA)) && !s.assigned() && s.stages().isEmpty()), eq(USER));
    }

    @Test
    void rowOutsideScopeIsDroppedEvenIfTheRepositoryReturnsIt() throws Exception {
        account("manufacturer", "own-org", NOVA);
        when(applications.list(any(), eq(USER))).thenReturn(List.of(row(NOVA_APP, NOVA, "NOVA", "fee_due"), row(PIXEL_APP, PIXEL, "PIXEL", "iame_scrutiny")));
        when(applications.find(eq(PIXEL_APP), any(), eq(USER))).thenReturn(Optional.of(row(PIXEL_APP, PIXEL, "PIXEL", "iame_scrutiny")));
        mvc.perform(get("/api/model-applications").with(token("manufacturer")))
            .andExpect(status().isOk()).andExpect(jsonPath("$.count").value(1))
            .andExpect(content().string(org.hamcrest.Matchers.not(org.hamcrest.Matchers.containsString(PIXEL_APP.toString()))));
        mvc.perform(get("/api/model-applications/" + PIXEL_APP).with(token("manufacturer")))
            .andExpect(status().isNotFound()).andExpect(content().json(NOT_FOUND, true));
    }

    @Test
    void deniedAndUnknownAndMalformedReadsLookTheSame() throws Exception {
        account("agency", "own-org", PIXEL);
        when(applications.find(any(), any(), eq(USER))).thenReturn(Optional.empty());
        for (String id : List.of(NOVA_APP.toString(), UUID.randomUUID().toString(), "LOCAL-MA-0002", "1")) {
            mvc.perform(get("/api/model-applications/" + id).with(token("agency")))
                .andExpect(status().isNotFound()).andExpect(content().json(NOT_FOUND, true));
        }
    }

    @Test
    void assignedOfficerIsScopedToAssignments() throws Exception {
        account("iame", "assigned", UUID.randomUUID());
        when(applications.list(any(), eq(USER))).thenReturn(List.of(row(PIXEL_APP, PIXEL, "PIXEL", "iame_scrutiny", "iame_scrutiny")));
        mvc.perform(get("/api/model-applications").with(token("iame")))
            .andExpect(status().isOk()).andExpect(jsonPath("$.items[0].readBasis[0]").value("assigned"));
        verify(applications).list(argThat(s -> s.assigned() && s.organisations().isEmpty() && s.stages().isEmpty()), eq(USER));
    }

    @Test
    void oldStageAssignmentCannotReadAfterHandoffEvenIfRepositoryReturnsTheRow() throws Exception {
        account("iame", "assigned");
        var oldAssignment = row(PIXEL_APP, PIXEL, "PIXEL", "bee_scrutiny", "iame_scrutiny");
        when(applications.list(any(), eq(USER))).thenReturn(List.of(oldAssignment));
        when(applications.find(eq(PIXEL_APP), any(), eq(USER))).thenReturn(Optional.of(oldAssignment));
        mvc.perform(get("/api/model-applications").with(token("iame")))
            .andExpect(status().isOk()).andExpect(jsonPath("$.count").value(0));
        mvc.perform(get("/api/model-applications/" + PIXEL_APP).with(token("iame")))
            .andExpect(status().isNotFound()).andExpect(content().json(NOT_FOUND, true));
    }

    /** Every FIRST_SLICE.md §7 write and the history read stay denied, even for the step's own actor. */
    @ParameterizedTest
    @CsvSource({
        "POST,/api/model-applications,manufacturer",
        "PATCH,/api/model-applications/{id},manufacturer",
        "POST,/api/model-applications/{id}/submit,manufacturer",
        "POST,/api/model-applications/{id}/fee/confirm,finance",
        "POST,/api/model-applications/{id}/recommend,iame",
        "POST,/api/model-applications/{id}/recommend,reviewer",
        "POST,/api/model-applications/{id}/rating,programme",
        "POST,/api/model-applications/{id}/decision,director",
        "POST,/api/model-applications/{id}/decision,secretary",
        "POST,/api/model-applications/{id}/return,iame",
        "POST,/api/model-applications/{id}/reject,reviewer",
        "GET,/api/model-applications/{id}/history,manufacturer",
    })
    void transitionsAndHistoryAreDeniedByDefault(String method, String path, String role) throws Exception {
        String url = path.replace("{id}", NOVA_APP.toString());
        MockHttpServletRequestBuilder req = switch (method) {
            case "POST" -> post(url);
            case "PATCH" -> patch(url);
            default -> get(url);
        };
        mvc.perform(req.with(token(role))).andExpect(status().isForbidden()).andExpect(jsonPath("$.error").value("denied_by_default"));
        verifyNoInteractions(applications, identity);
    }
}
