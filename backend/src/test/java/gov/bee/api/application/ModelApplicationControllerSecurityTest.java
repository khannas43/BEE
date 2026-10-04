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
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
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
@Import({SecurityConfig.class, CallerResolver.class, gov.bee.api.web.CorrelationIdFilter.class, gov.bee.api.web.ApiExceptionHandler.class})
class ModelApplicationControllerSecurityTest {

    static final UUID USER = UUID.fromString("00000000-0000-4000-a000-000000000001");
    static final UUID NOVA = UUID.fromString("00000000-0000-4000-b000-000000000001");
    static final UUID PIXEL = UUID.fromString("00000000-0000-4000-b000-000000000002");
    static final UUID NOVA_APP = UUID.fromString("00000000-0000-4000-c000-000000000002");
    static final UUID PIXEL_APP = UUID.fromString("00000000-0000-4000-c000-000000000003");
    static final String NOT_FOUND = "{\"error\":\"not_found\",\"message\":\"No such record is available to you.\"}";

    @Autowired
    MockMvc mvc;

    @MockitoBean
    IdentityRepository identity;

    @MockitoBean
    ModelApplicationRepository applications;

    @MockitoBean
    ModelApplicationSubmitRepository submissions;

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
        return new ModelApplicationRepository.Row(id, "LOCAL-MA", org, code, "Brand", "RAC", "M-1", state, 0, Set.of(stages), null, null, null);
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
            .andExpect(status().isForbidden()).andExpect(content().json("{\"error\":\"no_read_scope\",\"message\":\"This role has no read access to model applications.\"}", true));
        mvc.perform(get("/api/model-applications/" + NOVA_APP).with(token(role)))
            .andExpect(status().isForbidden()).andExpect(content().json("{\"error\":\"no_read_scope\",\"message\":\"This role has no read access to model applications.\"}", true));
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
        when(submissions.findFeeSnapshot(any())).thenReturn(Optional.empty());
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
        List<String> bodies = new java.util.ArrayList<>();
        for (String id : List.of(NOVA_APP.toString(), UUID.randomUUID().toString(), "LOCAL-MA-0002", "1", "")) {
            var r = mvc.perform(get("/api/model-applications/" + id).with(token("agency")))
                .andExpect(status().isNotFound()).andExpect(content().json(NOT_FOUND, true))
                .andExpect(header().string("Cache-Control", org.hamcrest.Matchers.containsString("no-store")))
                .andReturn().getResponse();
            bodies.add(r.getContentAsString() + "|" + r.getContentType());
        }
        org.junit.jupiter.api.Assertions.assertEquals(1, bodies.stream().distinct().count(), "404 bodies differ: " + bodies);
    }

    @Test
    void everyErrorUsesTheContractBodyAndCarriesTheCorrelationId() throws Exception {
        String body = "{\"error\":\"%s\",\"message\":\"%s\"}";
        mvc.perform(get("/api/model-applications").header("X-Correlation-Id", "contract-test-1"))
            .andExpect(status().isUnauthorized()).andExpect(header().string("X-Correlation-Id", "contract-test-1"))
            .andExpect(content().json(body.formatted("unauthenticated", "A valid access token is required."), true));
        mvc.perform(patch("/api/model-applications/{id}/submit", NOVA_APP).with(token("manufacturer")).header("X-Correlation-Id", "contract-test-2"))
            .andExpect(status().isForbidden()).andExpect(header().string("X-Correlation-Id", "contract-test-2"))
            .andExpect(content().json(body.formatted("denied_by_default", "This operation is not available."), true));
        mvc.perform(get("/api/model-applications").with(jwt().jwt(j -> j.subject(USER.toString()).claim("amr", List.of("pwd")))))
            .andExpect(status().isForbidden())
            .andExpect(content().json(body.formatted("mfa_required", "Sign-in must include a verified one-time code."), true));
        account("admin", "all", NOVA);
        mvc.perform(get("/api/model-applications").with(token("admin")))
            .andExpect(status().isForbidden())
            .andExpect(content().json(body.formatted("no_read_scope", "This role has no read access to model applications."), true));
    }

    @Test
    void unsafeCorrelationIdIsReplaced() throws Exception {
        for (String bad : List.of("has space", "x".repeat(65), "semi;colon", "\u00e9")) {
            var r = mvc.perform(get("/api/model-applications").header("X-Correlation-Id", bad)).andReturn().getResponse();
            String echoed = r.getHeader("X-Correlation-Id");
            org.junit.jupiter.api.Assertions.assertNotEquals(bad, echoed);
            UUID.fromString(echoed);
        }
    }

    @Test
    void databaseFailureIsServiceUnavailableWithoutDetail() throws Exception {
        account("manufacturer", "own-org", NOVA);
        when(applications.list(any(), eq(USER))).thenThrow(new org.springframework.dao.DataAccessResourceFailureException("connection to 127.0.0.1:5434 refused; SELECT * FROM app.model_application"));
        mvc.perform(get("/api/model-applications").with(token("manufacturer")))
            .andExpect(status().isServiceUnavailable())
            .andExpect(content().json("{\"error\":\"service_unavailable\",\"message\":\"The service is temporarily unavailable. Try again later.\"}", true));
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
        "PATCH,/api/model-applications/{id}/submit,manufacturer",
        "POST,/api/model-applications/{id}/fee/confirm,finance",
        "POST,/api/model-applications/{id}/recommend,iame",
        "POST,/api/model-applications/{id}/recommend,reviewer",
        "POST,/api/model-applications/{id}/rating/override,programme",
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
