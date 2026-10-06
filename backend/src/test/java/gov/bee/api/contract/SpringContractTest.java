package gov.bee.api.contract;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.nullable;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.reset;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import gov.bee.api.document.DocumentRepository;
import gov.bee.api.document.LocalSha256FileStore;
import gov.bee.api.document.LocalSha256FileStore.StagedBlob;
import java.nio.file.Path;
import java.time.Instant;
import org.springframework.mock.web.MockMultipartFile;

import com.fasterxml.jackson.databind.JsonNode;
import gov.bee.api.application.IdempotencyRepository;
import gov.bee.api.application.ModelApplicationRepository;
import gov.bee.api.application.ModelApplicationSubmitRepository;
import gov.bee.api.brand.BrandAuth;
import gov.bee.api.brand.BrandAuthRepository;
import gov.bee.api.identity.IdentityRepository;
import gov.bee.api.masters.MasterDataRepository;
import gov.bee.api.masters.MasterVersion;
import gov.bee.api.masters.Masters;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.TreeSet;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.actuate.health.Health;
import org.springframework.boot.actuate.health.HealthIndicator;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.request.RequestPostProcessor;

/**
 * WP03.3: every internal (Spring) operation in docs/wp03/bee-local-api.openapi.json, at
 * every documented status and error code, through the real filter chain, security,
 * controllers, exception handler and actuator. Each response must match its documented
 * schema, error code list, fixed message, X-Correlation-Id and no-store headers; the
 * suite fails if a documented pair is never exercised. Repositories are mocked (no
 * database), so 500 and 503 can be induced here and not in the shared runtime.
 */
@SpringBootTest(properties = {"spring.autoconfigure.exclude="
    + "org.springframework.boot.autoconfigure.jdbc.DataSourceAutoConfiguration,"
    + "org.springframework.boot.autoconfigure.flyway.FlywayAutoConfiguration",
    "bee.log.dir=target/logs", "bee.documents.store-path=target/contract-documents"})
@AutoConfigureMockMvc
class SpringContractTest {

    static final UUID USER = UUID.fromString("00000000-0000-4000-a000-000000000001");
    static final UUID NOVA = UUID.fromString("00000000-0000-4000-b000-000000000001");
    static final UUID NOVA_APP = UUID.fromString("00000000-0000-4000-c000-000000000002");
    static final UUID NOVA_COOL = UUID.fromString("00000000-0000-4000-d000-000000000001");
    static final String IDEM = "0123456789abcdef0123456";
    static final String PLANTED = "planted-secret-9b1e";
    static final AtomicBoolean HEALTH_DOWN = new AtomicBoolean(false);
    static final AtomicInteger SEQ = new AtomicInteger();
    static final String RUN = UUID.randomUUID().toString().substring(0, 8);
    static final Set<String> COVERED = new TreeSet<>();
    static JsonNode doc;

    @TestConfiguration
    static class HealthProbe {
        @Bean
        HealthIndicator contractProbe() {
            return () -> HEALTH_DOWN.get() ? Health.down().build() : Health.up().build();
        }
    }

    @Autowired
    MockMvc mvc;

    @MockitoBean
    IdentityRepository identity;

    @MockitoBean
    ModelApplicationRepository applications;

    @MockitoBean
    IdempotencyRepository idempotency;

    /** WP04.1 masters are internal and unused by any route; mocked so the context needs no database. */
    @MockitoBean
    MasterDataRepository masters;

    /** WP04.2a brand/agency authorisation is internal and unused by any route; mocked likewise. */
    @MockitoBean
    BrandAuthRepository brandAuth;

    @MockitoBean
    ModelApplicationSubmitRepository submissions;

    @MockitoBean
    DocumentRepository documentRepo;

    @MockitoBean
    gov.bee.api.finance.FeeConfirmationRepository feeRepo;

    @MockitoBean
    gov.bee.api.iame.IameRecommendationRepository iameRepo;

    @MockitoBean
    gov.bee.api.reviewer.ReviewerForwardRepository reviewerRepo;

    @MockitoBean
    gov.bee.api.rating.RatingRepository ratingRepo;

    @MockitoBean
    gov.bee.api.director.DirectorRecommendationRepository directorRepo;

    @MockitoBean
    gov.bee.api.secretary.SecretaryApprovalRepository secretaryRepo;

    @MockitoBean
    gov.bee.api.rework.StageReturnRepository returnRepo;

    @MockitoBean
    gov.bee.api.rework.ResubmitApplicationRepository resubmitRepo;

    @MockitoBean
    gov.bee.api.rework.StageRejectRepository rejectRepo;

    @MockitoBean
    gov.bee.api.history.HistoryRepository historyRepo;

    @MockitoBean
    gov.bee.api.feerules.FeeRuleRepository feeRulesRepo;

    @MockitoBean
    gov.bee.api.verification.PublicVerificationRepository publicVerificationRepo;

    @MockitoBean
    gov.bee.api.notifications.NotificationRepository notificationRepo;

    @org.springframework.beans.factory.annotation.Autowired
    gov.bee.api.verification.PublicRateLimiter publicRateLimiter;

    @MockitoBean
    gov.bee.api.ratingschemes.RatingSchemeRepository schemesRepo;

    @MockitoBean
    gov.bee.api.feecorrections.FeeCorrectionRepository correctionRepo;

    @MockitoBean
    LocalSha256FileStore documentStore;

    static final UUID DOC_ID = UUID.fromString("00000000-0000-4000-e000-000000000001");
    static final UUID VER_ID = UUID.fromString("00000000-0000-4000-e000-000000000002");
    static final String DOC_PATH = "/api/model-applications/{id}/documents";
    static final String CONTENT_PATH = "/api/model-applications/{id}/documents/{documentId}/versions/{versionId}/content";
    static final byte[] MIN_PDF = "%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n".getBytes(StandardCharsets.US_ASCII);

    @BeforeAll
    static void load() throws Exception {
        doc = ContractSchema.read(ContractSchema.ARTIFACT);
    }

    /** Every documented internal pair, from the artifact itself. */
    static Set<String> documentedPairs() {
        Set<String> pairs = new TreeSet<>();
        for (Iterator<Map.Entry<String, JsonNode>> it = doc.path("paths").fields(); it.hasNext(); ) {
            var p = it.next();
            if (!"internal".equals(p.getValue().path("x-bee-audience").asText())) continue;
            for (String method : List.of("get", "post", "patch")) {
                JsonNode op = p.getValue().path(method);
                if (op.isMissingNode()) continue;
                String m = method.toUpperCase();
                for (Iterator<Map.Entry<String, JsonNode>> st = op.path("responses").fields(); st.hasNext(); ) {
                    var s = st.next();
                    JsonNode codes = s.getValue().path("x-error-codes");
                    if (codes.isMissingNode()) pairs.add(m + " " + p.getKey() + " " + s.getKey() + " -");
                    else codes.forEach(c -> pairs.add(m + " " + p.getKey() + " " + s.getKey() + " " + c.asText()));
                }
            }
        }
        pairs.add("default-deny 401 unauthenticated");
        pairs.add("default-deny 403 denied_by_default");
        return pairs;
    }

    @AfterAll
    static void everyDocumentedPairWasExercised() {
        Set<String> missing = new TreeSet<>(documentedPairs());
        missing.removeAll(COVERED);
        assertEquals(Set.of(), missing, "documented Spring status/code pairs never exercised");
        assertEquals(Set.of(), difference(COVERED, documentedPairs()), "exercised pairs the artifact does not document");
    }

    static Set<String> difference(Set<String> a, Set<String> b) {
        Set<String> d = new TreeSet<>(a);
        d.removeAll(b);
        return d;
    }

    RequestPostProcessor token(String... roles) {
        return jwt().jwt(j -> j.subject(USER.toString()).claim("amr", List.of("pwd", "otp")).claim("organisation", "PixelCert Agency (synthetic)")
            .claim("realm_access", Map.of("roles", List.of(roles))));
    }

    void account(String role, String scope) {
        when(identity.activeAccount(USER)).thenReturn(Optional.of(new IdentityRepository.Account(USER, "nova.applicant", "Nova Applicant")));
        when(identity.activeRoles(USER)).thenReturn(List.of(new IdentityRepository.RoleGrant(role, scope)));
        when(identity.activeMembershipOrganisationIds(USER)).thenReturn(Set.of(NOVA));
        when(identity.activeMemberships(USER)).thenReturn(List.of(new IdentityRepository.Membership("NOVA", "manufacturer", "Nova Appliances (synthetic)")));
        when(identity.activeAssignments(USER)).thenReturn(0);
        var row = new ModelApplicationRepository.Row(NOVA_APP, "LOCAL-MA-0002", NOVA, "NOVA", "Nova Cool", "RAC", "NC-RAC-18F", "fee_due", 3, Set.of(), null, null, null);
        when(applications.list(any(), any())).thenReturn(List.of(row));
        when(applications.find(any(), any(), any())).thenReturn(Optional.empty());
        when(applications.find(org.mockito.ArgumentMatchers.eq(NOVA_APP), any(), any())).thenReturn(Optional.of(row));
    }

    /** A Finance caller whose own organisation is not the payer's (BEE staff), so only the rule under test can deny. */
    void financeAccount(UUID staffOrg) {
        account("finance", "all");
        when(identity.activeMembershipOrganisationIds(USER)).thenReturn(Set.of(staffOrg));
        when(identity.activeMemberships(USER)).thenReturn(List.of(new IdentityRepository.Membership("BEE", "bee", "BEE staff (synthetic)")));
    }

    /** An IAME officer outside the applicant's organisation who holds the assignment on an iame_scrutiny record. */
    void iameAccount(UUID staffOrg) {
        account("iame", "assigned");
        when(identity.activeMembershipOrganisationIds(USER)).thenReturn(Set.of(staffOrg));
        when(identity.activeMemberships(USER)).thenReturn(List.of(new IdentityRepository.Membership("BEE", "bee", "BEE staff (synthetic)")));
        var row = new ModelApplicationRepository.Row(NOVA_APP, "LOCAL-MA-0002", NOVA, "NOVA", "Nova Cool", "RAC", "NC-RAC-18F", "iame_scrutiny", 3,
            Set.of("iame_scrutiny"), null, null, null);
        when(applications.find(org.mockito.ArgumentMatchers.eq(NOVA_APP), any(), any())).thenReturn(Optional.of(row));
    }

    /** A Reviewer outside the applicant's organisation who holds the assignment on a bee_scrutiny record. */
    void reviewerAccount(UUID staffOrg) {
        account("reviewer", "assigned");
        when(identity.activeMembershipOrganisationIds(USER)).thenReturn(Set.of(staffOrg));
        when(identity.activeMemberships(USER)).thenReturn(List.of(new IdentityRepository.Membership("BEE", "bee", "BEE staff (synthetic)")));
        var row = new ModelApplicationRepository.Row(NOVA_APP, "LOCAL-MA-0002", NOVA, "NOVA", "Nova Cool", "RAC", "NC-RAC-18F", "bee_scrutiny", 3,
            Set.of("bee_scrutiny"), null, null, null);
        when(applications.find(org.mockito.ArgumentMatchers.eq(NOVA_APP), any(), any())).thenReturn(Optional.of(row));
    }

    /** A Programme officer outside the applicant's organisation, with a record in the rating stage that declared 4.50. */
    void programmeAccount(UUID staffOrg) {
        account("programme", "all");
        when(identity.activeMembershipOrganisationIds(USER)).thenReturn(Set.of(staffOrg));
        when(identity.activeMemberships(USER)).thenReturn(List.of(new IdentityRepository.Membership("BEE", "bee", "BEE staff (synthetic)")));
        var row = new ModelApplicationRepository.Row(NOVA_APP, "LOCAL-MA-0002", NOVA, "NOVA", "Nova Cool", "RAC", "NC-RAC-18F", "rating", 4,
            Set.of(), null, null, null, "LAB", java.time.LocalDate.of(2026, 9, 1), new BigDecimal("4.50"));
        when(applications.find(org.mockito.ArgumentMatchers.eq(NOVA_APP), any(), any())).thenReturn(Optional.of(row));
    }

    /** A Director outside the applicant's organisation, with a record in the director_review stage. */
    void directorAccount(UUID staffOrg) {
        account("director", "all");
        when(identity.activeMembershipOrganisationIds(USER)).thenReturn(Set.of(staffOrg));
        when(identity.activeMemberships(USER)).thenReturn(List.of(new IdentityRepository.Membership("BEE", "bee", "BEE staff (synthetic)")));
        var row = new ModelApplicationRepository.Row(NOVA_APP, "LOCAL-MA-0002", NOVA, "NOVA", "Nova Cool", "RAC", "NC-RAC-18F", "director_review", 5,
            Set.of(), null, null, null, "LAB", java.time.LocalDate.of(2026, 9, 1), new BigDecimal("4.50"));
        when(applications.find(org.mockito.ArgumentMatchers.eq(NOVA_APP), any(), any())).thenReturn(Optional.of(row));
    }

    /** A Secretary outside the applicant's organisation, with a record in the secretary_approval stage. */
    void secretaryAccount(UUID staffOrg) {
        account("secretary", "all");
        when(identity.activeMembershipOrganisationIds(USER)).thenReturn(Set.of(staffOrg));
        when(identity.activeMemberships(USER)).thenReturn(List.of(new IdentityRepository.Membership("BEE", "bee", "BEE staff (synthetic)")));
        var row = new ModelApplicationRepository.Row(NOVA_APP, "LOCAL-MA-0002", NOVA, "NOVA", "Nova Cool", "RAC", "NC-RAC-18F", "secretary_approval", 6,
            Set.of(), null, null, null, "LAB", java.time.LocalDate.of(2026, 9, 1), new BigDecimal("4.50"));
        when(applications.find(org.mockito.ArgumentMatchers.eq(NOVA_APP), any(), any())).thenReturn(Optional.of(row));
    }

    /** An application in the returned state with complete evidence, as the applicant sees it. */
    static ModelApplicationRepository.Row returnedRow(int version) {
        var d = draftRow(NOVA_APP, "NC-RAC-18F", version);
        return new ModelApplicationRepository.Row(d.id(), d.reference(), d.organisationId(), d.organisationCode(), d.brandName(), d.category(), d.modelNumber(),
            "returned", version, Set.of(), NOVA, NOVA_COOL, "NOVA", d.laboratoryCode(), d.testedOn(), d.declaredIseer());
    }

    /** An officer outside the applicant's organisation who can read the application in the given state. */
    void officerAccount(String role, String scope, String state, Set<String> assigned) {
        account(role, scope);
        when(identity.activeMembershipOrganisationIds(USER)).thenReturn(Set.of(UUID.fromString("00000000-0000-4000-b000-0000000000aa")));
        when(identity.activeMemberships(USER)).thenReturn(List.of(new IdentityRepository.Membership("BEE", "bee", "BEE staff (synthetic)")));
        var row = new ModelApplicationRepository.Row(NOVA_APP, "LOCAL-MA-0002", NOVA, "NOVA", "Nova Cool", "RAC", "NC-RAC-18F", state, 3,
            assigned, null, null, null, "LAB", TESTED_ON, new BigDecimal("4.50"));
        when(applications.find(org.mockito.ArgumentMatchers.eq(NOVA_APP), any(), any())).thenReturn(Optional.of(row));
    }

    /** A history row with only what the step needs; the repository would fill the rest from the step's own record. */
    static gov.bee.api.history.HistoryRepository.Row hist(String action, String from, String to, String role, String name, String org, java.util.function.UnaryOperator<Object[]> more) {
        Object[] x = new Object[17];
        if (more != null) {
            x = more.apply(x);
        }
        return new gov.bee.api.history.HistoryRepository.Row(Instant.parse("2026-10-04T10:00:00Z"), action, from, to, role, name, org,
            (String) x[0], (BigDecimal) x[1], (java.sql.Date) x[2], (String) x[3], (String) x[4], (String) x[5],
            (Integer) x[6], (Integer) x[7], (BigDecimal) x[8], (BigDecimal) x[9], (String) x[10], (String) x[11], (Boolean) x[12], (String) x[13],
            (String) x[14], (String) x[15], (Boolean) x[16], null);
    }

    /** Performs the request and checks the response against the artifact; returns it for further checks. */
    MockHttpServletResponse conforms(String route, MockHttpServletRequestBuilder request, int status, String code) throws Exception {
        String cid = "spring-contract-" + RUN + "-" + SEQ.incrementAndGet();
        MockHttpServletResponse res = mvc.perform(request.header("X-Correlation-Id", cid)).andReturn().getResponse();
        String where = route + " " + status + " " + code;
        assertEquals(status, res.getStatus(), where);
        String httpMethod = route.equals("default-deny") ? "get" : request.buildRequest(null).getMethod().toLowerCase();
        JsonNode spec = route.equals("default-deny") ? null : doc.path("paths").path(route).path(httpMethod).path("responses").path(String.valueOf(status));
        if (spec != null) {
            assertFalse(spec.isMissingNode(), "HTTP " + status + " is not documented for " + route);
            for (Iterator<Map.Entry<String, JsonNode>> it = spec.path("headers").fields(); it.hasNext(); ) {
                var h = it.next();
                JsonNode hs = h.getValue().has("$ref") ? ContractSchema.resolve(doc, h.getValue().get("$ref").asText()) : h.getValue();
                String v = res.getHeader(h.getKey());
                if (hs.path("required").asBoolean()) assertNotNull(v, where + ": missing header " + h.getKey());
                if (v != null && hs.path("schema").has("pattern")) assertTrue(java.util.regex.Pattern.compile(hs.path("schema").path("pattern").asText()).matcher(v).find(), where + ": header " + h.getKey() + "=" + v);
            }
        }
        assertEquals(cid, res.getHeader("X-Correlation-Id"), where + ": correlation ID echoed");
        assertTrue(String.valueOf(res.getHeader("Cache-Control")).contains("no-store"), where + ": no-store");
        boolean pdfOk = code == null && status == 200 && String.valueOf(res.getContentType()).startsWith("application/pdf")
            && spec != null && spec.path("content").has("application/pdf");
        if (pdfOk) {
            assertTrue(res.getContentAsByteArray().length > 0, where + ": empty PDF");
            String coveredMethod = request.buildRequest(null).getMethod();
            COVERED.add(coveredMethod + " " + route + " " + status + " -");
            return res;
        }
        assertTrue(String.valueOf(res.getContentType()).startsWith("application/json") || String.valueOf(res.getContentType()).startsWith("application/vnd.spring-boot.actuator"), where + ": content type " + res.getContentType());
        JsonNode body = ContractSchema.parse(res.getContentAsString(StandardCharsets.UTF_8));
        JsonNode schema = spec == null ? doc.path("components").path("schemas").path("Error") : spec.path("content").path("application/json").path("schema");
        assertFalse(schema.isMissingNode(), where + ": no documented JSON schema");
        assertEquals(List.of(), ContractSchema.validate(schema, body, doc), where);
        if (code != null) {
            assertEquals(code, body.path("error").asText(), where);
            if (spec != null) {
                boolean listed = false;
                for (JsonNode c : spec.path("x-error-codes")) listed |= c.asText().equals(code);
                assertTrue(listed, where + ": code not listed for this status");
            }
            assertEquals(doc.path("x-bee-error-codes").path(code).path("message").asText(), body.path("message").asText(), where + ": fixed message");
            assertEquals(Set.of("error", "message"), fieldNames(body), where + ": error body is exactly error and message");
        }
        String coveredMethod = route.equals("default-deny") ? "*" : request.buildRequest(null).getMethod();
        COVERED.add((route.equals("default-deny") ? "default-deny" : coveredMethod + " " + route) + " " + status + " " + (code == null ? "-" : code));
        return res;
    }

    static Set<String> fieldNames(JsonNode n) {
        Set<String> s = new TreeSet<>();
        n.fieldNames().forEachRemaining(s::add);
        return s;
    }

    static final String ME = "/api/me", LIST = "/api/model-applications", DETAIL = "/api/model-applications/{id}";
    static final String[] READS = {ME, LIST, DETAIL};

    static String path(String route) {
        return route.replace("{id}", NOVA_APP.toString());
    }

    @Test
    void successBodiesMatchTheirSchemas() throws Exception {
        account("manufacturer", "own-org");
        for (String r : READS) conforms(r, get(path(r)).with(token("manufacturer")), 200, null);
    }

    @Test
    void anApprovedApplicationCarriesItsCertificateOnTheDetailRead() throws Exception {
        account("manufacturer", "own-org");
        var approved = new ModelApplicationRepository.Row(NOVA_APP, "LOCAL-MA-0002", NOVA, "NOVA", "Nova Cool", "RAC", "NC-RAC-18F", "approved", 8, Set.of(), NOVA, NOVA_COOL, "NOVA");
        when(applications.find(org.mockito.ArgumentMatchers.eq(NOVA_APP), any(), any())).thenReturn(Optional.of(approved));
        when(submissions.findCertificate(NOVA_APP)).thenReturn(Optional.of(new ModelApplicationSubmitRepository.CertificateRow("BEE/RAC/2026/10001",
            java.time.LocalDate.of(2026, 10, 6), java.time.LocalDate.of(2029, 10, 5), 4, new BigDecimal("4.50"), new BigDecimal("4.62"), "RAC-ISEER-DEMO-1", Instant.parse("2026-10-06T10:00:00Z"))));
        var res = conforms(DETAIL, get(path(DETAIL)).with(token("manufacturer")), 200, null);
        assertTrue(res.getContentAsString().contains("\"certificate\":{\"registrationId\":\"BEE/RAC/2026/10001\""), res.getContentAsString());
        assertTrue(res.getContentAsString().contains("\"localDemoCertificate\":true"), res.getContentAsString());
        // Any other state carries no certificate.
        account("manufacturer", "own-org");
        var plain = conforms(DETAIL, get(path(DETAIL)).with(token("manufacturer")), 200, null);
        assertFalse(plain.getContentAsString().contains("\"certificate\""), plain.getContentAsString());
    }

    @Test
    void meListsThePermissionsTheRolesHoldAndNothingElse() throws Exception {
        account("admin", "all");
        when(identity.capabilities(List.of("admin"))).thenReturn(List.of("fee_rule_manage", "rating_scheme_manage"));
        var res = conforms(ME, get(ME).with(token("admin")), 200, null);
        assertTrue(res.getContentAsString().contains("\"capabilities\":[\"fee_rule_manage\",\"rating_scheme_manage\"]"), res.getContentAsString());
        account("manufacturer", "own-org");
        var plain = conforms(ME, get(ME).with(token("manufacturer")), 200, null);
        assertTrue(plain.getContentAsString().contains("\"capabilities\":[]"), plain.getContentAsString());
    }

    @Test
    void healthUpAndDownMatchSpringHealth() throws Exception {
        conforms("/actuator/health", get("/actuator/health"), 200, null);
        HEALTH_DOWN.set(true);
        try {
            conforms("/actuator/health", get("/actuator/health"), 503, null);
        } finally {
            HEALTH_DOWN.set(false);
        }
    }

    @Test
    void missingOrInvalidTokenIsUnauthenticated() throws Exception {
        for (String r : READS) {
            conforms(r, get(path(r)), 401, "unauthenticated");
            conforms(r, get(path(r)).header("Authorization", "Bearer " + PLANTED), 401, "unauthenticated");
        }
    }

    @Test
    void identityDenialsAreDocumentedCodes() throws Exception {
        var pwdOnly = jwt().jwt(j -> j.subject(USER.toString()).claim("amr", List.of("pwd")).claim("realm_access", Map.of("roles", List.of("manufacturer"))));
        for (String r : READS) conforms(r, get(path(r)).with(pwdOnly), 403, "mfa_required");
        when(identity.activeAccount(any())).thenReturn(Optional.empty());
        for (String r : READS) conforms(r, get(path(r)).with(token("manufacturer")), 403, "no_active_account");
        account("auditor", "all");
        for (String r : READS) conforms(r, get(path(r)).with(token("finance")), 403, "no_effective_role");
        for (String r : new String[] {LIST, DETAIL}) conforms(r, get(path(r)).with(token("auditor")), 403, "no_read_scope");
    }

    @Test
    void unknownMalformedAndOutOfScopeIdsAreOneNotFound() throws Exception {
        account("manufacturer", "own-org");
        Set<String> bodies = new TreeSet<>();
        for (String id : new String[] {UUID.randomUUID().toString(), "LOCAL-MA-0003", "1", "-"}) {
            bodies.add(conforms(DETAIL, get("/api/model-applications/" + id).with(token("manufacturer")), 404, "not_found").getContentAsString());
        }
        assertEquals(1, bodies.size(), "one 404 body");
    }

    @Test
    void databaseFailureIs503AndUnexpectedFailureIs500WithoutDetail() throws Exception {
        for (String r : READS) {
            doThrow(new DataAccessResourceFailureException("connection to 127.0.0.1:5434 refused " + PLANTED)).when(identity).activeAccount(any());
            String body = conforms(r, get(path(r)).with(token("manufacturer")), 503, "service_unavailable").getContentAsString();
            assertFalse(body.contains(PLANTED) || body.contains("5434"), body);
            doThrow(new IllegalStateException("SELECT password_hash FROM app.user_account " + PLANTED)).when(identity).activeAccount(any());
            body = conforms(r, get(path(r)).with(token("manufacturer")), 500, "internal_error").getContentAsString();
            assertFalse(body.contains(PLANTED) || body.contains("SELECT"), body);
        }
    }

    @Test
    void everythingElseIsDeniedByDefault() throws Exception {
        account("manufacturer", "own-org");
        conforms("default-deny", post(LIST).contentType("application/json").content("{\"secret\":\"" + PLANTED + "\"}"), 401, "unauthenticated");
        for (MockHttpServletRequestBuilder b : List.of(delete(path(DETAIL)), get(path(DETAIL) + "/history/export"), post(ME), get("/actuator/env"))) {
            conforms("default-deny", b.with(token("manufacturer")), 403, "denied_by_default");
        }
    }

    @Test
    void requestLogLinesMatchTheDocumentedFormatAndCarryNoRequestData() throws Exception {
        account("manufacturer", "own-org");
        JsonNode lineSchema = ContractSchema.read(ContractSchema.REQUEST_LOG).path("line");
        Path file = Path.of("target/logs/api-requests.jsonl");
        String[] ids = new String[4];
        ids[0] = conforms(DETAIL, get("/api/model-applications/" + PLANTED + "?code=" + PLANTED + "&state=" + PLANTED)
            .with(token("manufacturer")).header("Cookie", "bee_session=" + PLANTED), 404, "not_found").getHeader("X-Correlation-Id");
        ids[1] = conforms(LIST, get(LIST).header("Authorization", "Bearer " + PLANTED), 401, "unauthenticated").getHeader("X-Correlation-Id");
        when(applications.findOwned(NOVA_APP, NOVA)).thenReturn(Optional.of(draftRow(NOVA_APP, "NC-RAC-18F", 0)));
        when(brandAuth.brandOwnedBy(NOVA_COOL, NOVA)).thenReturn(Optional.of(novaCoolBrand()));
        when(masters.category(any(), any())).thenReturn(Optional.of(new Masters.Category(feeVersion(), "RAC", "Room AC")));
        when(masters.standard(any(), any(), any())).thenReturn(Optional.of(new Masters.Standard(feeVersion(), "RAC", "performance_test", "IS 1391", "t", "1")));
        when(masters.feeRule(any(), any(), any())).thenReturn(Optional.of(racFee()));
        when(masters.labAccreditation(any(), any(), any())).thenReturn(Optional.of(activeLab()));
        when(applications.laboratoryExists("LAB")).thenReturn(true);
        when(documentRepo.findByApplicationAndKind(NOVA_APP, "test_report")).thenReturn(Optional.of(reportDoc()));
        when(documentRepo.listVersions(DOC_ID)).thenReturn(List.of(reportVersion()));
        ids[2] = conforms("/api/model-applications/{id}/submit", get(path(DETAIL) + "/submit").with(token("manufacturer")), 200, null).getHeader("X-Correlation-Id");
        ids[3] = conforms(ME, get(ME).with(token("manufacturer")), 200, null).getHeader("X-Correlation-Id");
        String log = Files.readString(file);
        assertFalse(log.contains(PLANTED), "planted value in api-requests.jsonl");
        assertFalse(log.contains("nova.applicant") || log.contains("Nova Applicant"), "personal data in api-requests.jsonl");
        String[][] want = {{"/api/model-applications/{id}", "404", "not_found"}, {"/api/model-applications", "401", "unauthenticated"}, {"/api/model-applications/{id}/submit", "200", "ok"}, {"/api/me", "200", "ok"}};
        for (int i = 0; i < ids.length; i++) {
            String id = ids[i];
            List<String> lines = log.lines().filter(l -> l.contains("\"correlationId\":\"" + id + "\"")).toList();
            assertEquals(1, lines.size(), "one request line for " + id);
            JsonNode line = ContractSchema.parse(lines.get(0));
            assertEquals(List.of(), ContractSchema.validate(lineSchema, line, lineSchema), lines.get(0));
            assertEquals(want[i][0], line.path("route").asText());
            assertEquals(Integer.parseInt(want[i][1]), line.path("status").asInt());
            assertEquals(want[i][2], line.path("outcome").asText());
        }
        for (String l : log.lines().toList()) assertEquals(List.of(), ContractSchema.validate(lineSchema, ContractSchema.parse(l), lineSchema), l);
    }

    static BrandAuth.Brand novaCoolBrand() {
        return new BrandAuth.Brand(NOVA_COOL, "Nova Cool", NOVA, "active",
            new BrandAuth.Provenance("seed", BrandAuth.Verification.SYNTHETIC, "seed"));
    }

    static final LocalDate TESTED_ON = LocalDate.of(2026, 9, 1);

    /** A draft with every WP05.1d evidence field set (a laboratory, a test date and the declared efficiency). */
    static ModelApplicationRepository.Row draftRow(UUID id, String model, int version) {
        return evidenceRow(id, model, version, "LAB", TESTED_ON, new BigDecimal("4.50"));
    }

    static ModelApplicationRepository.Row evidenceRow(UUID id, String model, int version, String lab, LocalDate testedOn, BigDecimal iseer) {
        return new ModelApplicationRepository.Row(id, "LOCAL-MA-9999", NOVA, "NOVA", "Nova Cool", "RAC", model, "draft", version,
            Set.of(), NOVA, NOVA_COOL, "NOVA", lab, testedOn, iseer);
    }

    static Masters.LabAccreditation activeLab() {
        return new Masters.LabAccreditation(
            new MasterVersion(UUID.randomUUID(), "LAB:RAC", 3, LocalDate.of(2026, 8, 1), null, "ref", MasterVersion.Verification.SYNTHETIC, "note", null, null),
            "LAB", "RAC", "SYN-ACCREDITATION-BODY", "SYN-LAB-RAC-0003", "active");
    }

    static Masters.Standard standardV2() {
        return new Masters.Standard(feeVersion(), "RAC", "performance_test", "IS 1391", "t", "1");
    }

    static DocumentRepository.DocumentRow reportDoc() {
        return new DocumentRepository.DocumentRow(DOC_ID, NOVA_APP, "test_report", Instant.parse("2026-10-03T00:00:00Z"));
    }

    static DocumentRepository.VersionRow reportVersion() {
        return new DocumentRepository.VersionRow(VER_ID, DOC_ID, 1, "a".repeat(64), MIN_PDF.length, "application/pdf",
            "report.pdf", "Lab A", null, null, USER, Instant.parse("2026-10-03T00:00:00Z"));
    }

    static MasterVersion feeVersion() {
        return new MasterVersion(UUID.randomUUID(), "RAC:new_model", 2, LocalDate.of(2026, 10, 1), null, "ref",
            MasterVersion.Verification.PROVISIONAL, "note", null, null);
    }

    static Masters.FeeRule racFee() {
        return new Masters.FeeRule(feeVersion(), "RAC", "new_model", new BigDecimal("24000.00"));
    }

    @Test
    void draftOperationsDocumentedPairs() throws Exception {
        String createBody = "{\"brandId\":\"" + NOVA_COOL + "\",\"category\":\"RAC\",\"modelNumber\":\"NC-NEW\"}";
        String patchBody = "{\"version\":0,\"category\":\"RAC\",\"modelNumber\":\"NC-EDIT\"}";
        conforms("/api/model-applications/eligible-brands", get("/api/model-applications/eligible-brands"), 401, "unauthenticated");
        var pwdOnly = jwt().jwt(j -> j.subject(USER.toString()).claim("amr", List.of("pwd")).claim("realm_access", Map.of("roles", List.of("manufacturer"))));
        conforms("/api/model-applications/eligible-brands", get("/api/model-applications/eligible-brands").with(pwdOnly), 403, "mfa_required");
        when(identity.activeAccount(any())).thenReturn(Optional.empty());
        conforms("/api/model-applications/eligible-brands", get("/api/model-applications/eligible-brands").with(token("manufacturer")), 403, "no_active_account");
        account("auditor", "all");
        conforms("/api/model-applications/eligible-brands", get("/api/model-applications/eligible-brands").with(token("auditor")), 403, "no_write_scope");
        account("manufacturer", "own-org");
        when(brandAuth.listOwnedActiveBrands(NOVA)).thenReturn(List.of(novaCoolBrand()));
        conforms("/api/model-applications/eligible-brands", get("/api/model-applications/eligible-brands").with(token("manufacturer")), 200, null);
        doThrow(new DataAccessResourceFailureException("down")).when(identity).activeMemberships(any());
        conforms("/api/model-applications/eligible-brands", get("/api/model-applications/eligible-brands").with(token("manufacturer")), 503, "service_unavailable");
        reset(identity, applications, brandAuth, idempotency);
        account("manufacturer", "own-org");
        account("auditor", "all");
        conforms("/api/model-applications/eligible-brands", get("/api/model-applications/eligible-brands").with(token("finance")), 403, "no_effective_role");
        account("manufacturer", "own-org");
        when(brandAuth.listOwnedActiveBrands(NOVA)).thenReturn(List.of(novaCoolBrand()));
        conforms("/api/model-applications", post("/api/model-applications").with(token("manufacturer")).contentType("application/json").content(createBody), 422, "idempotency_key_required");
        conforms("/api/model-applications", post("/api/model-applications"), 401, "unauthenticated");
        conforms("/api/model-applications", post("/api/model-applications").with(pwdOnly).header("Idempotency-Key", IDEM).contentType("application/json").content(createBody), 403, "mfa_required");
        when(identity.activeAccount(any())).thenReturn(Optional.empty());
        conforms("/api/model-applications", post("/api/model-applications").with(token("manufacturer")).header("Idempotency-Key", IDEM).contentType("application/json").content(createBody), 403, "no_active_account");
        account("auditor", "all");
        conforms("/api/model-applications", post("/api/model-applications").with(token("auditor")).header("Idempotency-Key", IDEM).contentType("application/json").content(createBody), 403, "no_write_scope");
        account("manufacturer", "own-org");
        when(idempotency.find(any(), any(), any(), any(), any())).thenReturn(Optional.empty());
        when(idempotency.begin(any(), any(), any(), any(), any(), any())).thenReturn(true);
        when(brandAuth.brandOwnedBy(NOVA_COOL, NOVA)).thenReturn(Optional.empty());
        conforms("/api/model-applications", post("/api/model-applications").with(token("manufacturer")).header("Idempotency-Key", IDEM).contentType("application/json").content(createBody), 403, "brand_not_permitted");
        when(brandAuth.brandOwnedBy(NOVA_COOL, NOVA)).thenReturn(Optional.of(novaCoolBrand()));
        when(applications.nextReference()).thenReturn("LOCAL-MA-9999");
        UUID created = UUID.fromString("00000000-0000-4000-c000-000000009999");
        when(applications.insertDraft(any(), any(), any(), any(), any(), any(), any(), any())).thenReturn(draftRow(created, "NC-NEW", 0));
        conforms("/api/model-applications", post("/api/model-applications").with(token("manufacturer")).header("Idempotency-Key", IDEM).contentType("application/json").content(createBody), 201, null);
        // WP05.1d evidence fields on create: accepted when well formed, refused (not rounded) when over-precise.
        when(applications.laboratoryExists("LAB")).thenReturn(true);
        when(applications.findOwned(any(), eq(NOVA))).thenReturn(Optional.of(draftRow(created, "NC-NEW", 0)));
        String withEvidence = "{\"brandId\":\"" + NOVA_COOL + "\",\"category\":\"RAC\",\"modelNumber\":\"NC-NEW\",\"laboratoryCode\":\"LAB\",\"testedOn\":\"2026-09-01\",\"declaredIseer\":4.5}";
        conforms("/api/model-applications", post("/api/model-applications").with(token("manufacturer")).header("Idempotency-Key", IDEM).contentType("application/json").content(withEvidence), 201, null);
        String overPrecise = "{\"brandId\":\"" + NOVA_COOL + "\",\"category\":\"RAC\",\"modelNumber\":\"NC-NEW\",\"declaredIseer\":9.9999999999999999}";
        conforms("/api/model-applications", post("/api/model-applications").with(token("manufacturer")).header("Idempotency-Key", IDEM).contentType("application/json").content(overPrecise), 422, "validation_failed");
        String unknownLab = "{\"brandId\":\"" + NOVA_COOL + "\",\"category\":\"RAC\",\"modelNumber\":\"NC-NEW\",\"laboratoryCode\":\"NOPE\"}";
        conforms("/api/model-applications", post("/api/model-applications").with(token("manufacturer")).header("Idempotency-Key", IDEM).contentType("application/json").content(unknownLab), 422, "validation_failed");
        account("manufacturer", "own-org");
        when(idempotency.find(any(), any(), any(), any(), any())).thenReturn(Optional.empty());
        when(idempotency.begin(any(), any(), any(), any(), any(), any())).thenReturn(true);
        when(brandAuth.brandOwnedBy(NOVA_COOL, NOVA)).thenReturn(Optional.of(novaCoolBrand()));
        when(applications.nextReference()).thenReturn("LOCAL-MA-9998");
        doThrow(new DataAccessResourceFailureException("down")).when(applications).insertDraft(any(), any(), any(), any(), any(), any(), any(), any());
        conforms("/api/model-applications", post("/api/model-applications").with(token("manufacturer")).header("Idempotency-Key", "0123456789abcdef0123457").contentType("application/json").content(createBody), 503, "service_unavailable");
        when(idempotency.find(any(), any(), any(), any(), any())).thenReturn(Optional.of(new IdempotencyRepository.Stored(true, 0, "{}", 0)));
        when(idempotency.bodyHash(any(), any(), any(), any(), any())).thenReturn(Optional.of(new byte[32]));
        conforms("/api/model-applications", post("/api/model-applications").with(token("manufacturer")).header("Idempotency-Key", IDEM).contentType("application/json").content(createBody), 409, "idempotency_in_progress");
        conforms("/api/model-applications/{id}", patch("/api/model-applications/" + NOVA_APP).with(token("manufacturer")).contentType("application/json").content(patchBody), 422, "idempotency_key_required");
        when(applications.findOwned(NOVA_APP, NOVA)).thenReturn(Optional.empty());
        when(idempotency.find(any(), any(), any(), any(), any())).thenReturn(Optional.empty());
        when(idempotency.begin(any(), any(), any(), any(), any(), any())).thenReturn(true);
        conforms("/api/model-applications/{id}", patch("/api/model-applications/" + NOVA_APP).with(token("manufacturer")).header("Idempotency-Key", IDEM).contentType("application/json").content(patchBody), 404, "not_found");
        when(applications.findOwned(NOVA_APP, NOVA)).thenReturn(Optional.of(
            new ModelApplicationRepository.Row(NOVA_APP, "LOCAL-MA-0002", NOVA, "NOVA", "Nova Cool", "RAC", "NC-RAC-18F", "fee_due", 0, Set.of(), null, null, null)));
        conforms("/api/model-applications/{id}", patch("/api/model-applications/" + NOVA_APP).with(token("manufacturer")).header("Idempotency-Key", IDEM).contentType("application/json").content(patchBody), 403, "not_editable");
        when(applications.findOwned(NOVA_APP, NOVA)).thenReturn(Optional.of(draftRow(NOVA_APP, "NC-RAC-18F", 2)));
        conforms("/api/model-applications/{id}", patch("/api/model-applications/" + NOVA_APP).with(token("manufacturer")).header("Idempotency-Key", IDEM).contentType("application/json").content(patchBody), 409, "version_conflict");
        when(applications.findOwned(NOVA_APP, NOVA)).thenReturn(Optional.of(draftRow(NOVA_APP, "NC-RAC-18F", 0)));
        when(brandAuth.brandOwnedBy(NOVA_COOL, NOVA)).thenReturn(Optional.of(novaCoolBrand()));
        when(applications.updateDraft(any(), any(), anyInt(), any(), any(), any(), any(), any())).thenReturn(Optional.of(draftRow(NOVA_APP, "NC-EDIT", 1)));
        when(idempotency.find(any(), any(), any(), any(), any())).thenReturn(Optional.empty());
        when(idempotency.begin(any(), any(), any(), any(), any(), any())).thenReturn(true);
        conforms("/api/model-applications/{id}", patch("/api/model-applications/" + NOVA_APP).with(token("manufacturer")).header("Idempotency-Key", IDEM).contentType("application/json").content(patchBody), 200, null);
        doThrow(new DataAccessResourceFailureException("down")).when(applications).findOwned(any(), any());
        conforms("/api/model-applications/{id}", patch("/api/model-applications/" + NOVA_APP).with(token("manufacturer")).header("Idempotency-Key", IDEM).contentType("application/json").content(patchBody), 503, "service_unavailable");
        reset(applications, idempotency);
        account("auditor", "all");
        conforms("/api/model-applications", post("/api/model-applications").with(token("finance")).header("Idempotency-Key", IDEM).contentType("application/json").content(createBody), 403, "no_effective_role");
        account("manufacturer", "own-org");
        when(idempotency.find(any(), any(), any(), any(), any())).thenReturn(Optional.empty());
        when(idempotency.begin(any(), any(), any(), any(), any(), any())).thenReturn(true);
        conforms("/api/model-applications", post("/api/model-applications").with(token("manufacturer")).header("Idempotency-Key", IDEM).contentType("application/json").content("{}"), 422, "validation_failed");
        when(idempotency.find(any(), any(), any(), any(), any())).thenReturn(Optional.of(new IdempotencyRepository.Stored(false, 201, "{}", 0)));
        when(idempotency.bodyHash(any(), any(), any(), any(), any())).thenReturn(Optional.of(new byte[] {1}));
        conforms("/api/model-applications", post("/api/model-applications").with(token("manufacturer")).header("Idempotency-Key", IDEM).contentType("application/json").content(createBody), 409, "idempotency_key_conflict");
        conforms("/api/model-applications/{id}", patch("/api/model-applications/" + NOVA_APP), 401, "unauthenticated");
        conforms("/api/model-applications/{id}", patch("/api/model-applications/" + NOVA_APP).with(pwdOnly).header("Idempotency-Key", IDEM).contentType("application/json").content(patchBody), 403, "mfa_required");
        when(identity.activeAccount(any())).thenReturn(Optional.empty());
        conforms("/api/model-applications/{id}", patch("/api/model-applications/" + NOVA_APP).with(token("manufacturer")).header("Idempotency-Key", IDEM).contentType("application/json").content(patchBody), 403, "no_active_account");
        account("auditor", "all");
        conforms("/api/model-applications/{id}", patch("/api/model-applications/" + NOVA_APP).with(token("finance")).header("Idempotency-Key", IDEM).contentType("application/json").content(patchBody), 403, "no_effective_role");
        when(idempotency.find(any(), any(), any(), any(), any())).thenReturn(Optional.empty());
        conforms("/api/model-applications/{id}", patch("/api/model-applications/" + NOVA_APP).with(token("auditor")).header("Idempotency-Key", IDEM).contentType("application/json").content(patchBody), 403, "no_write_scope");
        account("manufacturer", "own-org");
        when(applications.findOwned(NOVA_APP, NOVA)).thenReturn(Optional.of(draftRow(NOVA_APP, "NC-RAC-18F", 0)));
        when(idempotency.find(any(), any(), any(), any(), any())).thenReturn(Optional.empty());
        when(idempotency.begin(any(), any(), any(), any(), any(), any())).thenReturn(true);
        when(idempotency.find(any(), any(), any(), any(), any())).thenReturn(Optional.empty());
        when(idempotency.begin(any(), any(), any(), any(), any(), any())).thenReturn(true);
        when(brandAuth.brandOwnedBy(NOVA_COOL, NOVA)).thenReturn(Optional.empty());
        conforms("/api/model-applications/{id}", patch("/api/model-applications/" + NOVA_APP).with(token("manufacturer")).header("Idempotency-Key", IDEM).contentType("application/json").content(patchBody), 403, "brand_not_permitted");
        when(idempotency.find(any(), any(), any(), any(), any())).thenReturn(Optional.of(new IdempotencyRepository.Stored(false, 200, "{}", 1)));
        when(idempotency.bodyHash(any(), any(), any(), any(), any())).thenReturn(Optional.of(new byte[] {2}));
        conforms("/api/model-applications/{id}", patch("/api/model-applications/" + NOVA_APP).with(token("manufacturer")).header("Idempotency-Key", IDEM).contentType("application/json").content(patchBody), 409, "idempotency_key_conflict");
        when(idempotency.find(any(), any(), any(), any(), any())).thenReturn(Optional.empty());
        when(idempotency.begin(any(), any(), any(), any(), any(), any())).thenReturn(true);
        conforms("/api/model-applications/{id}", patch("/api/model-applications/" + NOVA_APP).with(token("manufacturer")).header("Idempotency-Key", IDEM).contentType("application/json").content("{}"), 422, "validation_failed");
        when(applications.findOwned(NOVA_APP, NOVA)).thenReturn(Optional.of(draftRow(NOVA_APP, "NC-RAC-18F", 0)));
        when(idempotency.find(any(), any(), any(), any(), any())).thenReturn(Optional.of(new IdempotencyRepository.Stored(true, 200, "{}", 0)));
        conforms("/api/model-applications/{id}", patch("/api/model-applications/" + NOVA_APP).with(token("manufacturer")).header("Idempotency-Key", IDEM).contentType("application/json").content(patchBody), 409, "idempotency_in_progress");
    }

    @Test
    void submitOperationsDocumentedPairs() throws Exception {
        var pwdOnly = jwt().jwt(j -> j.subject(USER.toString()).claim("amr", List.of("pwd")).claim("realm_access", Map.of("roles", List.of("manufacturer"))));
        String submitBody = "{\"version\":0,\"expectedFee\":{\"amountInr\":\"24000.00\",\"feeRuleKey\":\"RAC:new_model\",\"feeRuleVersion\":2}}";
        String submitBodyWrongFee = "{\"version\":0,\"expectedFee\":{\"amountInr\":\"99999.00\",\"feeRuleKey\":\"RAC:new_model\",\"feeRuleVersion\":2}}";
        String submitPath = "/api/model-applications/" + NOVA_APP + "/submit";
        conforms("/api/model-applications/{id}/submit", get(submitPath), 401, "unauthenticated");
        conforms("/api/model-applications/{id}/submit", post(submitPath).contentType("application/json").content(submitBody), 401, "unauthenticated");
        conforms("/api/model-applications/{id}/submit", get(submitPath).with(pwdOnly), 403, "mfa_required");
        when(identity.activeAccount(any())).thenReturn(Optional.empty());
        conforms("/api/model-applications/{id}/submit", get(submitPath).with(token("manufacturer")), 403, "no_active_account");
        account("auditor", "all");
        conforms("/api/model-applications/{id}/submit", get(submitPath).with(token("auditor")), 403, "no_write_scope");
        account("manufacturer", "own-org");
        when(applications.findOwned(NOVA_APP, NOVA)).thenReturn(Optional.empty());
        conforms("/api/model-applications/{id}/submit", get(submitPath).with(token("manufacturer")), 404, "not_found");
        when(idempotency.find(any(), any(), any(), any(), any())).thenReturn(Optional.empty());
        conforms("/api/model-applications/{id}/submit", post(submitPath).with(token("manufacturer")).header("Idempotency-Key", IDEM).contentType("application/json").content(submitBody), 404, "not_found");
        when(applications.findOwned(NOVA_APP, NOVA)).thenReturn(Optional.of(
            new ModelApplicationRepository.Row(NOVA_APP, "LOCAL-MA-0002", NOVA, "NOVA", "Nova Cool", "RAC", "NC-RAC-18F", "fee_due", 1, Set.of(), NOVA, NOVA_COOL, "NOVA")));
        conforms("/api/model-applications/{id}/submit", get(submitPath).with(token("manufacturer")), 403, "not_submittable");
        when(applications.findOwned(NOVA_APP, NOVA)).thenReturn(Optional.of(draftRow(NOVA_APP, "NC-RAC-18F", 0)));
        when(brandAuth.brandOwnedBy(NOVA_COOL, NOVA)).thenReturn(Optional.of(novaCoolBrand()));
        when(masters.category(any(), any())).thenReturn(Optional.empty());
        when(idempotency.find(any(), any(), any(), any(), any())).thenReturn(Optional.empty());
        conforms("/api/model-applications/{id}/submit", post(submitPath).with(token("manufacturer")).header("Idempotency-Key", "0123456789abcdef0123459").contentType("application/json").content(submitBody), 422, "rule_not_available");
        when(masters.category(any(), any())).thenReturn(Optional.of(new Masters.Category(feeVersion(), "RAC", "Room AC")));
        when(masters.standard(any(), any(), any())).thenReturn(Optional.of(new Masters.Standard(feeVersion(), "RAC", "performance_test", "IS 1391", "t", "1")));
        when(masters.feeRule(any(), any(), any())).thenReturn(Optional.of(racFee()));
        when(masters.labAccreditation(any(), any(), any())).thenReturn(Optional.of(activeLab()));
        when(applications.laboratoryExists("LAB")).thenReturn(true);
        when(documentRepo.findByApplicationAndKind(NOVA_APP, "test_report")).thenReturn(Optional.of(reportDoc()));
        when(documentRepo.listVersions(DOC_ID)).thenReturn(List.of(reportVersion()));
        conforms("/api/model-applications/{id}/submit", post(submitPath).with(token("manufacturer")).contentType("application/json").content(submitBody), 422, "idempotency_key_required");
        when(idempotency.find(any(), any(), any(), any(), any())).thenReturn(Optional.empty());
        when(idempotency.begin(any(), any(), any(), any(), any(), any())).thenReturn(true);
        conforms("/api/model-applications/{id}/submit", post(submitPath).with(token("manufacturer")).header("Idempotency-Key", IDEM).contentType("application/json").content(submitBodyWrongFee), 409, "fee_preview_conflict");
        when(idempotency.find(any(), any(), any(), any(), any())).thenReturn(Optional.empty());
        when(idempotency.begin(any(), any(), any(), any(), any(), any())).thenReturn(true);
        var feeSnap = new ModelApplicationSubmitRepository.FeeSnapshotRow(UUID.randomUUID(), new BigDecimal("24000.00"), "INR", "RAC:new_model", 2,
            "provisional", "ref", "note", java.time.Instant.now());
        when(submissions.submit(any(), any(), anyInt(), any(), any(), any(), any(), any(), anyInt(), any(), any(), any()))
            .thenReturn(Optional.of(new ModelApplicationSubmitRepository.SubmissionResult(
                new ModelApplicationRepository.Row(NOVA_APP, "LOCAL-MA-9999", NOVA, "NOVA", "Nova Cool", "RAC", "NC-RAC-18F", "fee_due", 1,
                    Set.of(), NOVA, NOVA_COOL, "NOVA"),
                UUID.randomUUID(), feeSnap)));
        conforms("/api/model-applications/{id}/submit", post(submitPath).with(token("manufacturer")).header("Idempotency-Key", IDEM).contentType("application/json").content(submitBody), 200, null);
        when(applications.findOwned(NOVA_APP, NOVA)).thenReturn(Optional.of(draftRow(NOVA_APP, "NC-RAC-18F", 0)));
        when(brandAuth.brandOwnedBy(NOVA_COOL, NOVA)).thenReturn(Optional.of(novaCoolBrand()));
        conforms("/api/model-applications/{id}/submit", get(submitPath).with(token("manufacturer")), 200, null);
        conforms("/api/model-applications/{id}/submit", get(submitPath).with(token("finance")), 403, "no_effective_role");
        account("manufacturer", "own-org");
        doThrow(new DataAccessResourceFailureException("down")).when(identity).activeMemberships(any());
        conforms("/api/model-applications/{id}/submit", get(submitPath).with(token("manufacturer")), 503, "service_unavailable");
        reset(identity, applications, brandAuth, idempotency, masters, submissions);
        account("manufacturer", "own-org");
        when(applications.findOwned(NOVA_APP, NOVA)).thenReturn(Optional.of(draftRow(NOVA_APP, "NC-RAC-18F", 0)));
        when(idempotency.find(any(), any(), any(), any(), any())).thenReturn(Optional.empty());
        when(idempotency.begin(any(), any(), any(), any(), any(), any())).thenReturn(true);
        when(brandAuth.brandOwnedBy(NOVA_COOL, NOVA)).thenReturn(Optional.empty());
        when(masters.category(any(), any())).thenReturn(Optional.of(new Masters.Category(feeVersion(), "RAC", "Room AC")));
        when(masters.standard(any(), any(), any())).thenReturn(Optional.of(new Masters.Standard(feeVersion(), "RAC", "performance_test", "IS 1391", "t", "1")));
        when(masters.feeRule(any(), any(), any())).thenReturn(Optional.of(racFee()));
        when(masters.labAccreditation(any(), any(), any())).thenReturn(Optional.of(activeLab()));
        when(applications.laboratoryExists("LAB")).thenReturn(true);
        when(documentRepo.findByApplicationAndKind(NOVA_APP, "test_report")).thenReturn(Optional.of(reportDoc()));
        when(documentRepo.listVersions(DOC_ID)).thenReturn(List.of(reportVersion()));
        conforms("/api/model-applications/{id}/submit", post(submitPath).with(token("manufacturer")).header("Idempotency-Key", IDEM).contentType("application/json").content(submitBody), 403, "brand_not_permitted");
        when(applications.findOwned(NOVA_APP, NOVA)).thenReturn(Optional.of(
            new ModelApplicationRepository.Row(NOVA_APP, "LOCAL-MA-0002", NOVA, "NOVA", "Nova Cool", "RAC", "NC-RAC-18F", "fee_due", 1, Set.of(), NOVA, NOVA_COOL, "NOVA")));
        conforms("/api/model-applications/{id}/submit", post(submitPath).with(token("manufacturer")).header("Idempotency-Key", IDEM).contentType("application/json").content(submitBody), 403, "not_submittable");
        when(applications.findOwned(NOVA_APP, NOVA)).thenReturn(Optional.of(draftRow(NOVA_APP, "NC-RAC-18F", 2)));
        when(brandAuth.brandOwnedBy(NOVA_COOL, NOVA)).thenReturn(Optional.of(novaCoolBrand()));
        conforms("/api/model-applications/{id}/submit", post(submitPath).with(token("manufacturer")).header("Idempotency-Key", IDEM).contentType("application/json").content(submitBody), 409, "version_conflict");
        when(applications.findOwned(NOVA_APP, NOVA)).thenReturn(Optional.of(draftRow(NOVA_APP, "NC-RAC-18F", 0)));
        when(idempotency.find(any(), any(), any(), any(), any())).thenReturn(Optional.of(new IdempotencyRepository.Stored(true, 200, "{}", 0)));
        conforms("/api/model-applications/{id}/submit", post(submitPath).with(token("manufacturer")).header("Idempotency-Key", IDEM).contentType("application/json").content(submitBody), 409, "idempotency_in_progress");
        when(idempotency.find(any(), any(), any(), any(), any())).thenReturn(Optional.of(new IdempotencyRepository.Stored(false, 200, "{}", 1)));
        when(idempotency.bodyHash(any(), any(), any(), any(), any())).thenReturn(Optional.of(new byte[] {9}));
        conforms("/api/model-applications/{id}/submit", post(submitPath).with(token("manufacturer")).header("Idempotency-Key", IDEM).contentType("application/json").content(submitBody), 409, "idempotency_key_conflict");
        when(idempotency.find(any(), any(), any(), any(), any())).thenReturn(Optional.empty());
        when(idempotency.begin(any(), any(), any(), any(), any(), any())).thenReturn(true);
        conforms("/api/model-applications/{id}/submit", post(submitPath).with(token("manufacturer")).header("Idempotency-Key", IDEM).contentType("application/json").content("{}"), 422, "validation_failed");
        // WP05.1d evidence gates, each unmet in turn against an otherwise complete application.
        var ok = draftRow(NOVA_APP, "NC-RAC-18F", 0);
        when(applications.findOwned(NOVA_APP, NOVA)).thenReturn(Optional.of(ok));
        when(brandAuth.brandOwnedBy(NOVA_COOL, NOVA)).thenReturn(Optional.of(novaCoolBrand()));
        when(idempotency.find(any(), any(), any(), any(), any())).thenReturn(Optional.empty());
        when(idempotency.begin(any(), any(), any(), any(), any(), any())).thenReturn(true);
        String gatePost = "/api/model-applications/{id}/submit";
        when(documentRepo.findByApplicationAndKind(NOVA_APP, "test_report")).thenReturn(Optional.empty());
        conforms(gatePost, post(submitPath).with(token("manufacturer")).header("Idempotency-Key", IDEM).contentType("application/json").content(submitBody), 422, "test_report_required");
        // The preview lists every gate, and with one unmet the application is not ready.
        conforms(gatePost, get(submitPath).with(token("manufacturer")), 200, null);
        when(documentRepo.findByApplicationAndKind(NOVA_APP, "test_report")).thenReturn(Optional.of(reportDoc()));
        when(applications.findOwned(NOVA_APP, NOVA)).thenReturn(Optional.of(evidenceRow(NOVA_APP, "NC-RAC-18F", 0, "LAB", TESTED_ON, null)));
        conforms(gatePost, post(submitPath).with(token("manufacturer")).header("Idempotency-Key", IDEM).contentType("application/json").content(submitBody), 422, "declared_efficiency_required");
        when(applications.findOwned(NOVA_APP, NOVA)).thenReturn(Optional.of(evidenceRow(NOVA_APP, "NC-RAC-18F", 0, "LAB", null, new BigDecimal("4.50"))));
        conforms(gatePost, post(submitPath).with(token("manufacturer")).header("Idempotency-Key", IDEM).contentType("application/json").content(submitBody), 422, "test_date_invalid");
        when(applications.findOwned(NOVA_APP, NOVA)).thenReturn(Optional.of(evidenceRow(NOVA_APP, "NC-RAC-18F", 0, "LAB", LocalDate.now().plusDays(1), new BigDecimal("4.50"))));
        conforms(gatePost, post(submitPath).with(token("manufacturer")).header("Idempotency-Key", IDEM).contentType("application/json").content(submitBody), 422, "test_date_invalid");
        when(applications.findOwned(NOVA_APP, NOVA)).thenReturn(Optional.of(ok));
        when(masters.labAccreditation(any(), any(), any())).thenReturn(Optional.empty());
        conforms(gatePost, post(submitPath).with(token("manufacturer")).header("Idempotency-Key", IDEM).contentType("application/json").content(submitBody), 422, "laboratory_not_accredited");
        when(applications.laboratoryExists("LAB")).thenReturn(false);
        when(applications.findOwned(NOVA_APP, NOVA)).thenReturn(Optional.of(ok));
        conforms(gatePost, post(submitPath).with(token("manufacturer")).header("Idempotency-Key", IDEM).contentType("application/json").content(submitBody), 422, "laboratory_not_accredited");
        when(applications.laboratoryExists("LAB")).thenReturn(true);
        when(applications.findOwned(NOVA_APP, NOVA)).thenReturn(Optional.of(evidenceRow(NOVA_APP, "NC-RAC-18F", 0, null, TESTED_ON, new BigDecimal("4.50"))));
        when(masters.labAccreditation(any(), any(), any())).thenReturn(Optional.of(activeLab()));
        conforms(gatePost, post(submitPath).with(token("manufacturer")).header("Idempotency-Key", IDEM).contentType("application/json").content(submitBody), 422, "laboratory_not_accredited");
        when(applications.findOwned(NOVA_APP, NOVA)).thenReturn(Optional.of(ok));
        // In force today (so the fee rules resolve) but not on the test date.
        when(masters.standard(any(), any(), eq(TESTED_ON))).thenReturn(Optional.empty());
        conforms(gatePost, post(submitPath).with(token("manufacturer")).header("Idempotency-Key", IDEM).contentType("application/json").content(submitBody), 422, "standard_not_available");
        when(masters.standard(any(), any(), any())).thenReturn(Optional.of(standardV2()));
        when(applications.modelNumberTaken(any(), any(), any())).thenReturn(true);
        conforms(gatePost, post(submitPath).with(token("manufacturer")).header("Idempotency-Key", IDEM).contentType("application/json").content(submitBody), 409, "duplicate_model");
        when(applications.modelNumberTaken(any(), any(), any())).thenReturn(false);
        doThrow(new DataAccessResourceFailureException("down")).when(submissions).submit(any(), any(), anyInt(), any(), any(), any(), any(), any(), anyInt(), any(), any(), any());
        when(applications.findOwned(NOVA_APP, NOVA)).thenReturn(Optional.of(draftRow(NOVA_APP, "NC-RAC-18F", 0)));
        when(brandAuth.brandOwnedBy(NOVA_COOL, NOVA)).thenReturn(Optional.of(novaCoolBrand()));
        when(idempotency.find(any(), any(), any(), any(), any())).thenReturn(Optional.empty());
        when(idempotency.begin(any(), any(), any(), any(), any(), any())).thenReturn(true);
        conforms("/api/model-applications/{id}/submit", post(submitPath).with(token("manufacturer")).header("Idempotency-Key", "0123456789abcdef0123458").contentType("application/json").content(submitBody), 503, "service_unavailable");
        reset(submissions);
        account("auditor", "all");
        conforms("/api/model-applications/{id}/submit", post(submitPath).with(token("auditor")).header("Idempotency-Key", IDEM).contentType("application/json").content(submitBody), 403, "no_write_scope");
        conforms("/api/model-applications/{id}/submit", post(submitPath).with(pwdOnly).header("Idempotency-Key", IDEM).contentType("application/json").content(submitBody), 403, "mfa_required");
        when(identity.activeAccount(any())).thenReturn(Optional.empty());
        conforms("/api/model-applications/{id}/submit", post(submitPath).with(token("manufacturer")).header("Idempotency-Key", IDEM).contentType("application/json").content(submitBody), 403, "no_active_account");
        account("manufacturer", "own-org");
        conforms("/api/model-applications/{id}/submit", post(submitPath).with(token("finance")).header("Idempotency-Key", IDEM).contentType("application/json").content(submitBody), 403, "no_effective_role");
    }

    @Test
    void documentOperationsDocumentedPairs() throws Exception {
        var pwdOnly = jwt().jwt(j -> j.subject(USER.toString()).claim("amr", List.of("pwd")).claim("realm_access", Map.of("roles", List.of("manufacturer"))));
        String listPath = "/api/model-applications/" + NOVA_APP + "/documents";
        String contentPath = "/api/model-applications/" + NOVA_APP + "/documents/" + DOC_ID + "/versions/" + VER_ID + "/content";
        MockMultipartFile pdf = new MockMultipartFile("file", "report.pdf", "application/pdf", MIN_PDF);
        when(documentStore.maxUploadBytes()).thenReturn(5_242_880L);

        conforms(DOC_PATH, get(listPath), 401, "unauthenticated");
        conforms(DOC_PATH, multipart(listPath).file(pdf).param("documentKind", "test_report").param("reportLabel", "Lab A"), 401, "unauthenticated");
        conforms(CONTENT_PATH, get(contentPath), 401, "unauthenticated");
        conforms(DOC_PATH, get(listPath).with(pwdOnly), 403, "mfa_required");
        conforms(CONTENT_PATH, get(contentPath).with(pwdOnly), 403, "mfa_required");
        conforms(DOC_PATH, multipart(listPath).file(pdf).param("documentKind", "test_report").param("reportLabel", "Lab A").with(pwdOnly).header("Idempotency-Key", IDEM), 403, "mfa_required");

        when(identity.activeAccount(any())).thenReturn(Optional.empty());
        conforms(DOC_PATH, get(listPath).with(token("manufacturer")), 403, "no_active_account");
        conforms(CONTENT_PATH, get(contentPath).with(token("manufacturer")), 403, "no_active_account");
        conforms(DOC_PATH, multipart(listPath).file(pdf).param("documentKind", "test_report").param("reportLabel", "Lab A").with(token("manufacturer")).header("Idempotency-Key", IDEM), 403, "no_active_account");

        account("manufacturer", "own-org");
        when(applications.find(org.mockito.ArgumentMatchers.eq(NOVA_APP), any(), any())).thenReturn(Optional.empty());
        conforms(DOC_PATH, get(listPath).with(token("manufacturer")), 404, "not_found");
        conforms(CONTENT_PATH, get(contentPath).with(token("manufacturer")), 404, "not_found");
        when(applications.findOwned(NOVA_APP, NOVA)).thenReturn(Optional.empty());
        when(idempotency.find(any(), any(), any(), any(), any())).thenReturn(Optional.empty());
        conforms(DOC_PATH, multipart(listPath).file(pdf).param("documentKind", "test_report").param("reportLabel", "Lab A").with(token("manufacturer")).header("Idempotency-Key", IDEM), 404, "not_found");
        // Authorisation precedes payload validation: an unowned application is 404 even with no file part.
        conforms(DOC_PATH, multipart(listPath).param("documentKind", "nope").with(token("manufacturer")), 404, "not_found");

        account("auditor", "all");
        conforms(DOC_PATH, get(listPath).with(token("auditor")), 403, "no_read_scope");
        conforms(CONTENT_PATH, get(contentPath).with(token("auditor")), 403, "no_read_scope");
        conforms(DOC_PATH, multipart(listPath).file(pdf).param("documentKind", "test_report").param("reportLabel", "Lab A").with(token("auditor")).header("Idempotency-Key", IDEM), 403, "no_write_scope");
        // A caller without write scope gets 403, not 422, however bad the payload is.
        conforms(DOC_PATH, multipart(listPath).param("documentKind", "nope").with(token("auditor")), 403, "no_write_scope");

        account("manufacturer", "own-org");
        conforms(DOC_PATH, get(listPath).with(token("finance")), 403, "no_effective_role");
        conforms(CONTENT_PATH, get(contentPath).with(token("finance")), 403, "no_effective_role");
        conforms(DOC_PATH, multipart(listPath).file(pdf).param("documentKind", "test_report").param("reportLabel", "Lab A").with(token("finance")).header("Idempotency-Key", IDEM), 403, "no_effective_role");

        account("manufacturer", "own-org");
        when(applications.find(org.mockito.ArgumentMatchers.eq(NOVA_APP), any(), any())).thenReturn(Optional.of(draftRow(NOVA_APP, "NC-RAC-18F", 0)));
        when(documentRepo.listDocuments(NOVA_APP)).thenReturn(List.of());
        conforms(DOC_PATH, get(listPath).with(token("manufacturer")), 200, null);

        when(documentRepo.findDocument(DOC_ID, NOVA_APP)).thenReturn(Optional.of(
            new DocumentRepository.DocumentRow(DOC_ID, NOVA_APP, "test_report", Instant.parse("2026-10-03T00:00:00Z"))));
        when(documentRepo.findVersion(VER_ID, DOC_ID)).thenReturn(Optional.of(
            new DocumentRepository.VersionRow(VER_ID, DOC_ID, 1, "a".repeat(64), MIN_PDF.length, "application/pdf",
                "report.pdf", "Lab A", null, null, USER, Instant.parse("2026-10-03T00:00:00Z"))));
        when(documentStore.read("a".repeat(64))).thenReturn(Optional.of(MIN_PDF));
        conforms(CONTENT_PATH, get(contentPath).with(token("manufacturer")), 200, null);

        when(documentStore.read("a".repeat(64))).thenReturn(Optional.empty());
        conforms(CONTENT_PATH, get(contentPath).with(token("manufacturer")), 503, "service_unavailable");

        doThrow(new DataAccessResourceFailureException("down")).when(documentRepo).listDocuments(any());
        conforms(DOC_PATH, get(listPath).with(token("manufacturer")), 503, "service_unavailable");
        reset(documentRepo);

        when(applications.findOwned(NOVA_APP, NOVA)).thenReturn(Optional.of(
            new ModelApplicationRepository.Row(NOVA_APP, "LOCAL-MA-0002", NOVA, "NOVA", "Nova Cool", "RAC", "NC-RAC-18F", "fee_due", 1, Set.of(), NOVA, NOVA_COOL, "NOVA")));
        when(idempotency.find(any(), any(), any(), any(), any())).thenReturn(Optional.empty());
        conforms(DOC_PATH, multipart(listPath).file(pdf).param("documentKind", "test_report").param("reportLabel", "Lab A").with(token("manufacturer")).header("Idempotency-Key", IDEM), 403, "not_editable");

        when(applications.findOwned(NOVA_APP, NOVA)).thenReturn(Optional.of(draftRow(NOVA_APP, "NC-RAC-18F", 0)));
        when(brandAuth.brandOwnedBy(NOVA_COOL, NOVA)).thenReturn(Optional.empty());
        conforms(DOC_PATH, multipart(listPath).file(pdf).param("documentKind", "test_report").param("reportLabel", "Lab A").with(token("manufacturer")).header("Idempotency-Key", IDEM), 403, "brand_not_permitted");

        when(brandAuth.brandOwnedBy(NOVA_COOL, NOVA)).thenReturn(Optional.of(novaCoolBrand()));
        conforms(DOC_PATH, multipart(listPath).file(pdf).param("documentKind", "test_report").param("reportLabel", "Lab A").with(token("manufacturer")), 422, "idempotency_key_required");
        conforms(DOC_PATH, multipart(listPath).file(pdf).param("documentKind", "test_report").param("reportLabel", "").with(token("manufacturer")).header("Idempotency-Key", IDEM), 422, "validation_failed");

        when(idempotency.find(any(), any(), any(), any(), any())).thenReturn(Optional.of(new IdempotencyRepository.Stored(true, 201, "{}", 0)));
        conforms(DOC_PATH, multipart(listPath).file(pdf).param("documentKind", "test_report").param("reportLabel", "Lab A").with(token("manufacturer")).header("Idempotency-Key", IDEM), 409, "idempotency_in_progress");
        when(idempotency.find(any(), any(), any(), any(), any())).thenReturn(Optional.of(new IdempotencyRepository.Stored(false, 201, "{}", 1)));
        when(idempotency.bodyHash(any(), any(), any(), any(), any())).thenReturn(Optional.of(new byte[] {9}));
        conforms(DOC_PATH, multipart(listPath).file(pdf).param("documentKind", "test_report").param("reportLabel", "Lab A").with(token("manufacturer")).header("Idempotency-Key", IDEM), 409, "idempotency_key_conflict");

        when(idempotency.find(any(), any(), any(), any(), any())).thenReturn(Optional.empty());
        when(idempotency.begin(any(), any(), any(), any(), any(), any())).thenReturn(true);
        Path staged = Path.of("target/contract-documents/.tmp/staged-pdf");
        Files.createDirectories(staged.getParent());
        Files.write(staged, MIN_PDF);
        when(documentStore.stage(any())).thenReturn(new StagedBlob(staged, "b".repeat(64), MIN_PDF.length));
        when(documentRepo.lockApplicationState(NOVA_APP)).thenReturn(Optional.of("draft"));
        when(documentRepo.recordVersion(any(), any(), any(), any(), anyLong(), any(), any(), any(), nullable(LocalDate.class), nullable(String.class), any()))
            .thenReturn(new DocumentRepository.DocumentRow(DOC_ID, NOVA_APP, "test_report", Instant.parse("2026-10-03T00:00:00Z")));
        when(documentRepo.listVersions(DOC_ID)).thenReturn(List.of(
            new DocumentRepository.VersionRow(VER_ID, DOC_ID, 1, "b".repeat(64), MIN_PDF.length, "application/pdf",
                "report.pdf", "Lab A", null, null, USER, Instant.parse("2026-10-03T00:00:00Z"))));
        conforms(DOC_PATH, multipart(listPath).file(pdf).param("documentKind", "test_report").param("reportLabel", "Lab A").with(token("manufacturer")).header("Idempotency-Key", "0123456789abcdef012345d"), 201, null);

        reset(documentRepo, documentStore, idempotency);
        when(applications.findOwned(NOVA_APP, NOVA)).thenReturn(Optional.of(draftRow(NOVA_APP, "NC-RAC-18F", 0)));
        when(brandAuth.brandOwnedBy(NOVA_COOL, NOVA)).thenReturn(Optional.of(novaCoolBrand()));
        when(documentStore.maxUploadBytes()).thenReturn(5_242_880L);
        when(idempotency.find(any(), any(), any(), any(), any())).thenReturn(Optional.empty());
        when(idempotency.begin(any(), any(), any(), any(), any(), any())).thenReturn(true);
        when(documentStore.stage(any())).thenReturn(new StagedBlob(staged, "c".repeat(64), MIN_PDF.length));
        when(documentRepo.lockApplicationState(NOVA_APP)).thenReturn(Optional.of("draft"));
        doThrow(new DataAccessResourceFailureException("down")).when(documentRepo).recordVersion(any(), any(), any(), any(), anyLong(), any(), any(), any(), nullable(LocalDate.class), nullable(String.class), any());
        conforms(DOC_PATH, multipart(listPath).file(pdf).param("documentKind", "test_report").param("reportLabel", "Lab A").with(token("manufacturer")).header("Idempotency-Key", "0123456789abcdef012345e"), 503, "service_unavailable");

        // A required part missing is the contract's 422, not a 500, and the caller is authorised first.
        conforms(DOC_PATH, multipart(listPath).param("documentKind", "test_report").param("reportLabel", "Lab A").with(token("manufacturer")).header("Idempotency-Key", "0123456789abcdef012345f"), 422, "validation_failed");

        // The brand is valid at the early check and lapses before the recheck under the application lock:
        // the upload is refused and nothing is recorded (the service wires recheckUnderLock, not a stub).
        reset(documentRepo, documentStore, idempotency);
        when(applications.findOwned(NOVA_APP, NOVA)).thenReturn(Optional.of(draftRow(NOVA_APP, "NC-RAC-18F", 0)));
        when(brandAuth.brandOwnedBy(NOVA_COOL, NOVA)).thenReturn(Optional.of(novaCoolBrand()), Optional.empty());
        when(documentStore.maxUploadBytes()).thenReturn(5_242_880L);
        when(idempotency.find(any(), any(), any(), any(), any())).thenReturn(Optional.empty());
        when(idempotency.begin(any(), any(), any(), any(), any(), any())).thenReturn(true);
        when(documentStore.stage(any())).thenReturn(new StagedBlob(staged, "d".repeat(64), MIN_PDF.length));
        when(documentRepo.lockApplicationState(NOVA_APP)).thenReturn(Optional.of("draft"));
        conforms(DOC_PATH, multipart(listPath).file(pdf).param("documentKind", "test_report").param("reportLabel", "Lab A").with(token("manufacturer")).header("Idempotency-Key", "0123456789abcdef012345g"), 403, "brand_not_permitted");
        verify(documentRepo, never()).recordVersion(any(), any(), any(), any(), anyLong(), any(), any(), any(), nullable(LocalDate.class), nullable(String.class), any());
    }

    @Test
    void feeConfirmationOperationsDocumentedPairs() throws Exception {
        String r = "/api/model-applications/{id}/fee-confirmation";
        String path = "/api/model-applications/" + NOVA_APP + "/fee-confirmation";
        UUID staff = UUID.fromString("00000000-0000-4000-b000-0000000000aa");
        String ok = "{\"version\":3,\"receiptReference\":\"UTR-1234\",\"receivedOn\":\"2026-10-02\",\"amountInr\":\"24000.00\"}";
        var feeSnap = new ModelApplicationSubmitRepository.FeeSnapshotRow(UUID.randomUUID(), new BigDecimal("24000.00"), "INR", "RAC:new_model", 2,
            "provisional", "ref", "note", java.time.Instant.now());
        var confirmed = new gov.bee.api.finance.FeeConfirmationRepository.Result(gov.bee.api.finance.FeeConfirmationRepository.Outcome.CONFIRMED, 4,
            Instant.parse("2026-10-03T10:00:00Z"));

        financeAccount(staff);
        when(idempotency.find(any(), any(), any(), any(), any())).thenReturn(Optional.empty());
        when(idempotency.begin(any(), any(), any(), any(), any(), any())).thenReturn(true);
        when(submissions.findFeeSnapshot(NOVA_APP)).thenReturn(Optional.of(feeSnap));
        when(feeRepo.actorsAtOtherStages(NOVA_APP)).thenReturn(Set.of());
        when(feeRepo.confirm(any(), anyInt(), any(), any(), any(), any(), any(), any())).thenReturn(confirmed);
        var pwdOnly = jwt().jwt(j -> j.subject(USER.toString()).claim("amr", List.of("pwd")).claim("realm_access", Map.of("roles", List.of("finance"))));
        conforms(r, post(path).with(token("finance")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 200, null);

        // Request shape and amount.
        conforms(r, post(path).with(token("finance")).contentType("application/json").content(ok), 422, "idempotency_key_required");
        conforms(r, post(path).with(token("finance")).header("Idempotency-Key", IDEM).contentType("application/json").content("{}"), 422, "validation_failed");
        conforms(r, post(path).with(token("finance")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok.replace("2026-10-02", "2999-01-01")), 422, "validation_failed");
        conforms(r, post(path).with(token("finance")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok.replace("UTR-1234", "bad;ref")), 422, "validation_failed");
        conforms(r, post(path).with(token("finance")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok.replace("24000.00", "23999.00")), 422, "amount_mismatch");

        // A fee with a separate tax line is received in full: the fee alone is not enough, the fee plus its tax is exact.
        var taxed = new ModelApplicationSubmitRepository.FeeSnapshotRow(UUID.randomUUID(), new BigDecimal("24000.00"), "INR", "RAC:new_model", 3,
            "provisional", "ref", "note", java.time.Instant.now(), new BigDecimal("18.00"), new BigDecimal("4320.00"), new BigDecimal("28320.00"));
        when(submissions.findFeeSnapshot(NOVA_APP)).thenReturn(Optional.of(taxed));
        conforms(r, post(path).with(token("finance")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 422, "amount_mismatch");
        var paid = conforms(r, post(path).with(token("finance")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok.replace("24000.00", "28320.00")), 200, null);
        assertTrue(paid.getContentAsString().contains("\"amountInr\":\"28320.00\""), paid.getContentAsString());
        when(submissions.findFeeSnapshot(NOVA_APP)).thenReturn(Optional.of(feeSnap));

        // Version, idempotency and assignment conflicts.
        conforms(r, post(path).with(token("finance")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok.replace("\"version\":3", "\"version\":2")), 409, "version_conflict");
        when(feeRepo.confirm(any(), anyInt(), any(), any(), any(), any(), any(), any())).thenReturn(
            new gov.bee.api.finance.FeeConfirmationRepository.Result(gov.bee.api.finance.FeeConfirmationRepository.Outcome.STALE, 0, null));
        conforms(r, post(path).with(token("finance")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 409, "version_conflict");
        when(feeRepo.confirm(any(), anyInt(), any(), any(), any(), any(), any(), any())).thenReturn(
            new gov.bee.api.finance.FeeConfirmationRepository.Result(gov.bee.api.finance.FeeConfirmationRepository.Outcome.NO_ASSIGNEE, 0, null));
        conforms(r, post(path).with(token("finance")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 409, "assignee_unavailable");
        when(feeRepo.confirm(any(), anyInt(), any(), any(), any(), any(), any(), any())).thenReturn(confirmed);
        when(idempotency.find(any(), any(), any(), any(), any())).thenReturn(Optional.of(new IdempotencyRepository.Stored(true, 200, "{}", 0)));
        conforms(r, post(path).with(token("finance")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 409, "idempotency_in_progress");
        when(idempotency.find(any(), any(), any(), any(), any())).thenReturn(Optional.of(new IdempotencyRepository.Stored(false, 200, "{}", 1)));
        when(idempotency.bodyHash(any(), any(), any(), any(), any())).thenReturn(Optional.of(new byte[] {9}));
        conforms(r, post(path).with(token("finance")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 409, "idempotency_key_conflict");
        // A replay returns the stored receipt, not a record the caller may no longer read.
        String stored = "{\"applicationId\":\"" + NOVA_APP + "\",\"reference\":\"LOCAL-MA-0002\",\"fromState\":\"fee_due\",\"toState\":\"iame_scrutiny\",\"version\":4,"
            + "\"receiptReference\":\"UTR-1234\",\"amountInr\":\"24000.00\",\"receivedOn\":\"2026-10-02\",\"confirmedAt\":\"2026-10-03T10:00:00Z\"}";
        when(idempotency.find(any(), any(), any(), any(), any())).thenReturn(Optional.of(new IdempotencyRepository.Stored(false, 200, stored, 4)));
        when(idempotency.bodyHash(any(), any(), any(), any(), any())).thenReturn(Optional.of(gov.bee.api.application.DraftRequestSupport.bodyHash(new com.fasterxml.jackson.databind.ObjectMapper().readTree(ok))));
        var replay = conforms(r, post(path).with(token("finance")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 200, null);
        assertEquals("true", replay.getHeader("Idempotency-Replayed"));
        when(idempotency.find(any(), any(), any(), any(), any())).thenReturn(Optional.empty());

        // Who may confirm: only Finance, never the payer, never someone who acted at another stage, and only a fee_due record Finance can read.
        account("manufacturer", "own-org");
        conforms(r, post(path).with(token("manufacturer")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 403, "role_not_permitted");
        account("auditor", "all");
        conforms(r, post(path).with(token("auditor")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 403, "role_not_permitted");
        account("finance", "all");   // this caller belongs to the paying organisation (NOVA)
        conforms(r, post(path).with(token("finance")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 403, "segregation_refused");
        financeAccount(staff);
        when(feeRepo.actorsAtOtherStages(NOVA_APP)).thenReturn(Set.of(USER));
        conforms(r, post(path).with(token("finance")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 403, "segregation_refused");
        when(feeRepo.actorsAtOtherStages(NOVA_APP)).thenReturn(Set.of());
        when(applications.find(org.mockito.ArgumentMatchers.eq(NOVA_APP), any(), any())).thenReturn(Optional.empty());
        conforms(r, post(path).with(token("finance")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 404, "not_found");

        // Identity denials and outage.
        financeAccount(staff);
        conforms(r, post(path).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 401, "unauthenticated");
        conforms(r, post(path).with(pwdOnly).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 403, "mfa_required");
        account("manufacturer", "own-org");
        conforms(r, post(path).with(token("finance")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 403, "no_effective_role");
        when(identity.activeAccount(any())).thenReturn(Optional.empty());
        conforms(r, post(path).with(token("finance")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 403, "no_active_account");
        financeAccount(staff);
        doThrow(new DataAccessResourceFailureException("down")).when(feeRepo).confirm(any(), anyInt(), any(), any(), any(), any(), any(), any());
        conforms(r, post(path).with(token("finance")).header("Idempotency-Key", "0123456789abcdef0123457").contentType("application/json").content(ok), 503, "service_unavailable");
    }

    @Test
    void iameRecommendationOperationsDocumentedPairs() throws Exception {
        String r = "/api/model-applications/{id}/iame-recommendation";
        String path = "/api/model-applications/" + NOVA_APP + "/iame-recommendation";
        UUID staff = UUID.fromString("00000000-0000-4000-b000-0000000000aa");
        String ok = "{\"version\":3,\"verification\":\"verified\",\"note\":\"Report matches the declared laboratory and date.\"}";
        var done = new gov.bee.api.iame.IameRecommendationRepository.Result(gov.bee.api.iame.IameRecommendationRepository.Outcome.RECOMMENDED, 4,
            Instant.parse("2026-10-04T10:00:00Z"));

        iameAccount(staff);
        when(idempotency.find(any(), any(), any(), any(), any())).thenReturn(Optional.empty());
        when(idempotency.begin(any(), any(), any(), any(), any(), any())).thenReturn(true);
        when(iameRepo.actorsAtOtherStages(NOVA_APP)).thenReturn(Set.of());
        when(iameRepo.recommend(any(), anyInt(), any(), any(), any(), any())).thenReturn(done);
        var pwdOnly = jwt().jwt(j -> j.subject(USER.toString()).claim("amr", List.of("pwd")).claim("realm_access", Map.of("roles", List.of("iame"))));
        conforms(r, post(path).with(token("iame")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 200, null);
        conforms(r, post(path).with(token("iame")).header("Idempotency-Key", IDEM).contentType("application/json")
            .content(ok.replace("verified", "not_verified")), 200, null);

        // Request shape.
        conforms(r, post(path).with(token("iame")).contentType("application/json").content(ok), 422, "idempotency_key_required");
        conforms(r, post(path).with(token("iame")).header("Idempotency-Key", IDEM).contentType("application/json").content("{}"), 422, "validation_failed");
        conforms(r, post(path).with(token("iame")).header("Idempotency-Key", IDEM).contentType("application/json")
            .content(ok.replace("Report matches the declared laboratory and date.", "   ")), 422, "validation_failed");
        conforms(r, post(path).with(token("iame")).header("Idempotency-Key", IDEM).contentType("application/json")
            .content(ok.replace("Report matches", "Report\\nmatches")), 422, "validation_failed");
        conforms(r, post(path).with(token("iame")).header("Idempotency-Key", IDEM).contentType("application/json")
            .content(ok.replace("Report matches the declared laboratory and date.", "x".repeat(501))), 422, "validation_failed");

        // Version, idempotency and assignment conflicts.
        conforms(r, post(path).with(token("iame")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok.replace("\"version\":3", "\"version\":2")), 409, "version_conflict");
        when(iameRepo.recommend(any(), anyInt(), any(), any(), any(), any())).thenReturn(
            new gov.bee.api.iame.IameRecommendationRepository.Result(gov.bee.api.iame.IameRecommendationRepository.Outcome.STALE, 0, null));
        conforms(r, post(path).with(token("iame")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 409, "version_conflict");
        when(iameRepo.recommend(any(), anyInt(), any(), any(), any(), any())).thenReturn(
            new gov.bee.api.iame.IameRecommendationRepository.Result(gov.bee.api.iame.IameRecommendationRepository.Outcome.NO_ASSIGNEE, 0, null));
        conforms(r, post(path).with(token("iame")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 409, "assignee_unavailable");
        when(iameRepo.recommend(any(), anyInt(), any(), any(), any(), any())).thenReturn(done);
        when(idempotency.find(any(), any(), any(), any(), any())).thenReturn(Optional.of(new IdempotencyRepository.Stored(true, 200, "{}", 0)));
        conforms(r, post(path).with(token("iame")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 409, "idempotency_in_progress");
        when(idempotency.find(any(), any(), any(), any(), any())).thenReturn(Optional.of(new IdempotencyRepository.Stored(false, 200, "{}", 1)));
        when(idempotency.bodyHash(any(), any(), any(), any(), any())).thenReturn(Optional.of(new byte[] {9}));
        conforms(r, post(path).with(token("iame")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 409, "idempotency_key_conflict");
        // A replay returns the stored receipt, not a record the officer may no longer read.
        String stored = "{\"applicationId\":\"" + NOVA_APP + "\",\"reference\":\"LOCAL-MA-0002\",\"fromState\":\"iame_scrutiny\",\"toState\":\"bee_scrutiny\",\"version\":4,"
            + "\"verification\":\"verified\",\"note\":\"Report matches the declared laboratory and date.\",\"recommendedAt\":\"2026-10-04T10:00:00Z\"}";
        when(idempotency.find(any(), any(), any(), any(), any())).thenReturn(Optional.of(new IdempotencyRepository.Stored(false, 200, stored, 4)));
        when(idempotency.bodyHash(any(), any(), any(), any(), any())).thenReturn(Optional.of(gov.bee.api.application.DraftRequestSupport.bodyHash(new com.fasterxml.jackson.databind.ObjectMapper().readTree(ok))));
        var replay = conforms(r, post(path).with(token("iame")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 200, null);
        assertEquals("true", replay.getHeader("Idempotency-Replayed"));
        when(idempotency.find(any(), any(), any(), any(), any())).thenReturn(Optional.empty());

        // Who may recommend: only the assigned IAME officer, never the applicant's own organisation, never someone who acted at another stage.
        account("manufacturer", "own-org");
        conforms(r, post(path).with(token("manufacturer")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 403, "role_not_permitted");
        account("auditor", "all");
        conforms(r, post(path).with(token("auditor")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 403, "role_not_permitted");
        iameAccount(staff);
        when(identity.activeMembershipOrganisationIds(USER)).thenReturn(Set.of(NOVA));   // the officer belongs to the applicant's organisation
        conforms(r, post(path).with(token("iame")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 403, "segregation_refused");
        iameAccount(staff);
        when(iameRepo.actorsAtOtherStages(NOVA_APP)).thenReturn(Set.of(USER));
        conforms(r, post(path).with(token("iame")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 403, "segregation_refused");
        when(iameRepo.actorsAtOtherStages(NOVA_APP)).thenReturn(Set.of());
        when(applications.find(org.mockito.ArgumentMatchers.eq(NOVA_APP), any(), any())).thenReturn(Optional.empty());
        conforms(r, post(path).with(token("iame")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 404, "not_found");

        // Identity denials and outage.
        iameAccount(staff);
        conforms(r, post(path).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 401, "unauthenticated");
        conforms(r, post(path).with(pwdOnly).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 403, "mfa_required");
        account("manufacturer", "own-org");
        conforms(r, post(path).with(token("iame")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 403, "no_effective_role");
        when(identity.activeAccount(any())).thenReturn(Optional.empty());
        conforms(r, post(path).with(token("iame")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 403, "no_active_account");
        iameAccount(staff);
        doThrow(new DataAccessResourceFailureException("down")).when(iameRepo).recommend(any(), anyInt(), any(), any(), any(), any());
        conforms(r, post(path).with(token("iame")).header("Idempotency-Key", "0123456789abcdef0123457").contentType("application/json").content(ok), 503, "service_unavailable");
    }

    @Test
    void reviewerForwardOperationsDocumentedPairs() throws Exception {
        String r = "/api/model-applications/{id}/reviewer-forward";
        String path = "/api/model-applications/" + NOVA_APP + "/reviewer-forward";
        UUID staff = UUID.fromString("00000000-0000-4000-b000-0000000000aa");
        String ok = "{\"version\":3,\"note\":\"Checked against the application and the IAME note.\"}";
        var done = new gov.bee.api.reviewer.ReviewerForwardRepository.Result(gov.bee.api.reviewer.ReviewerForwardRepository.Outcome.FORWARDED, 4,
            Instant.parse("2026-10-04T10:00:00Z"));

        reviewerAccount(staff);
        when(idempotency.find(any(), any(), any(), any(), any())).thenReturn(Optional.empty());
        when(idempotency.begin(any(), any(), any(), any(), any(), any())).thenReturn(true);
        when(reviewerRepo.actorsAtOtherStages(NOVA_APP)).thenReturn(Set.of());
        when(reviewerRepo.forward(any(), anyInt(), any(), any(), any())).thenReturn(done);
        var pwdOnly = jwt().jwt(j -> j.subject(USER.toString()).claim("amr", List.of("pwd")).claim("realm_access", Map.of("roles", List.of("reviewer"))));
        conforms(r, post(path).with(token("reviewer")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 200, null);

        // Request shape.
        conforms(r, post(path).with(token("reviewer")).contentType("application/json").content(ok), 422, "idempotency_key_required");
        conforms(r, post(path).with(token("reviewer")).header("Idempotency-Key", IDEM).contentType("application/json").content("{}"), 422, "validation_failed");
        conforms(r, post(path).with(token("reviewer")).header("Idempotency-Key", IDEM).contentType("application/json")
            .content(ok.replace("Checked against the application and the IAME note.", "   ")), 422, "validation_failed");
        conforms(r, post(path).with(token("reviewer")).header("Idempotency-Key", IDEM).contentType("application/json")
            .content(ok.replace("Checked against", "Checked\\nagainst")), 422, "validation_failed");
        conforms(r, post(path).with(token("reviewer")).header("Idempotency-Key", IDEM).contentType("application/json")
            .content(ok.replace("Checked against the application and the IAME note.", "x".repeat(501))), 422, "validation_failed");

        // Version, idempotency and assignment conflicts.
        conforms(r, post(path).with(token("reviewer")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok.replace("\"version\":3", "\"version\":2")), 409, "version_conflict");
        when(reviewerRepo.forward(any(), anyInt(), any(), any(), any())).thenReturn(
            new gov.bee.api.reviewer.ReviewerForwardRepository.Result(gov.bee.api.reviewer.ReviewerForwardRepository.Outcome.STALE, 0, null));
        conforms(r, post(path).with(token("reviewer")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 409, "version_conflict");
        when(reviewerRepo.forward(any(), anyInt(), any(), any(), any())).thenReturn(done);
        when(idempotency.find(any(), any(), any(), any(), any())).thenReturn(Optional.of(new IdempotencyRepository.Stored(true, 200, "{}", 0)));
        conforms(r, post(path).with(token("reviewer")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 409, "idempotency_in_progress");
        when(idempotency.find(any(), any(), any(), any(), any())).thenReturn(Optional.of(new IdempotencyRepository.Stored(false, 200, "{}", 1)));
        when(idempotency.bodyHash(any(), any(), any(), any(), any())).thenReturn(Optional.of(new byte[] {9}));
        conforms(r, post(path).with(token("reviewer")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 409, "idempotency_key_conflict");
        // A replay returns the stored receipt, not a record the reviewer may no longer read.
        String stored = "{\"applicationId\":\"" + NOVA_APP + "\",\"reference\":\"LOCAL-MA-0002\",\"fromState\":\"bee_scrutiny\",\"toState\":\"rating\",\"version\":4,"
            + "\"note\":\"Checked against the application and the IAME note.\",\"forwardedAt\":\"2026-10-04T10:00:00Z\"}";
        when(idempotency.find(any(), any(), any(), any(), any())).thenReturn(Optional.of(new IdempotencyRepository.Stored(false, 200, stored, 4)));
        when(idempotency.bodyHash(any(), any(), any(), any(), any())).thenReturn(Optional.of(gov.bee.api.application.DraftRequestSupport.bodyHash(new com.fasterxml.jackson.databind.ObjectMapper().readTree(ok))));
        var replay = conforms(r, post(path).with(token("reviewer")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 200, null);
        assertEquals("true", replay.getHeader("Idempotency-Replayed"));
        when(idempotency.find(any(), any(), any(), any(), any())).thenReturn(Optional.empty());

        // Who may forward: only the assigned Reviewer, never the applicant's own organisation, never someone who acted at another stage.
        account("manufacturer", "own-org");
        conforms(r, post(path).with(token("manufacturer")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 403, "role_not_permitted");
        account("auditor", "all");
        conforms(r, post(path).with(token("auditor")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 403, "role_not_permitted");
        reviewerAccount(staff);
        when(identity.activeMembershipOrganisationIds(USER)).thenReturn(Set.of(NOVA));   // the reviewer belongs to the applicant's organisation
        conforms(r, post(path).with(token("reviewer")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 403, "segregation_refused");
        reviewerAccount(staff);
        when(reviewerRepo.actorsAtOtherStages(NOVA_APP)).thenReturn(Set.of(USER));
        conforms(r, post(path).with(token("reviewer")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 403, "segregation_refused");
        when(reviewerRepo.actorsAtOtherStages(NOVA_APP)).thenReturn(Set.of());
        when(applications.find(org.mockito.ArgumentMatchers.eq(NOVA_APP), any(), any())).thenReturn(Optional.empty());
        conforms(r, post(path).with(token("reviewer")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 404, "not_found");

        // Identity denials and outage.
        reviewerAccount(staff);
        conforms(r, post(path).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 401, "unauthenticated");
        conforms(r, post(path).with(pwdOnly).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 403, "mfa_required");
        account("manufacturer", "own-org");
        conforms(r, post(path).with(token("reviewer")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 403, "no_effective_role");
        when(identity.activeAccount(any())).thenReturn(Optional.empty());
        conforms(r, post(path).with(token("reviewer")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 403, "no_active_account");
        reviewerAccount(staff);
        doThrow(new DataAccessResourceFailureException("down")).when(reviewerRepo).forward(any(), anyInt(), any(), any(), any());
        conforms(r, post(path).with(token("reviewer")).header("Idempotency-Key", "0123456789abcdef0123457").contentType("application/json").content(ok), 503, "service_unavailable");
    }

    @Test
    void secretaryApprovalOperationsDocumentedPairs() throws Exception {
        String r = "/api/model-applications/{id}/secretary-approval";
        String path = "/api/model-applications/" + NOVA_APP + "/secretary-approval";
        UUID staff = UUID.fromString("00000000-0000-4000-b000-0000000000aa");
        String ok = "{\"version\":6,\"note\":\"Rating reviewed; approved.\"}";
        var done = new gov.bee.api.secretary.SecretaryApprovalRepository.Result(gov.bee.api.secretary.SecretaryApprovalRepository.Outcome.APPROVED, 7,
            Instant.parse("2026-10-04T10:00:00Z"));

        secretaryAccount(staff);
        when(idempotency.find(any(), any(), any(), any(), any())).thenReturn(Optional.empty());
        when(idempotency.begin(any(), any(), any(), any(), any(), any())).thenReturn(true);
        when(secretaryRepo.actorsAtOtherStages(NOVA_APP)).thenReturn(Set.of());
        when(secretaryRepo.approve(any(), anyInt(), any(), any(), any())).thenReturn(done);
        var pwdOnly = jwt().jwt(j -> j.subject(USER.toString()).claim("amr", List.of("pwd")).claim("realm_access", Map.of("roles", List.of("secretary"))));
        conforms(r, post(path).with(token("secretary")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 200, null);

        // Request shape.
        conforms(r, post(path).with(token("secretary")).contentType("application/json").content(ok), 422, "idempotency_key_required");
        conforms(r, post(path).with(token("secretary")).header("Idempotency-Key", IDEM).contentType("application/json").content("{}"), 422, "validation_failed");
        conforms(r, post(path).with(token("secretary")).header("Idempotency-Key", IDEM).contentType("application/json")
            .content(ok.replace("Rating reviewed; approved.", "   ")), 422, "validation_failed");
        conforms(r, post(path).with(token("secretary")).header("Idempotency-Key", IDEM).contentType("application/json")
            .content(ok.replace("Rating reviewed", "Rating\\nreviewed")), 422, "validation_failed");
        conforms(r, post(path).with(token("secretary")).header("Idempotency-Key", IDEM).contentType("application/json")
            .content(ok.replace("Rating reviewed; approved.", "x".repeat(501))), 422, "validation_failed");

        // Version, idempotency and assignment conflicts.
        conforms(r, post(path).with(token("secretary")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok.replace("\"version\":6", "\"version\":5")), 409, "version_conflict");
        when(secretaryRepo.approve(any(), anyInt(), any(), any(), any())).thenReturn(
            new gov.bee.api.secretary.SecretaryApprovalRepository.Result(gov.bee.api.secretary.SecretaryApprovalRepository.Outcome.STALE, 0, null));
        conforms(r, post(path).with(token("secretary")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 409, "version_conflict");
        when(secretaryRepo.approve(any(), anyInt(), any(), any(), any())).thenReturn(done);
        when(idempotency.find(any(), any(), any(), any(), any())).thenReturn(Optional.of(new IdempotencyRepository.Stored(true, 200, "{}", 0)));
        conforms(r, post(path).with(token("secretary")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 409, "idempotency_in_progress");
        when(idempotency.find(any(), any(), any(), any(), any())).thenReturn(Optional.of(new IdempotencyRepository.Stored(false, 200, "{}", 1)));
        when(idempotency.bodyHash(any(), any(), any(), any(), any())).thenReturn(Optional.of(new byte[] {9}));
        conforms(r, post(path).with(token("secretary")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 409, "idempotency_key_conflict");
        // A replay returns the stored receipt, not a record the Secretary may no longer read.
        String stored = "{\"applicationId\":\"" + NOVA_APP + "\",\"reference\":\"LOCAL-MA-0002\",\"fromState\":\"secretary_approval\",\"toState\":\"approved\",\"version\":7,"
            + "\"note\":\"Rating reviewed; approved.\",\"approvedAt\":\"2026-10-04T10:00:00Z\"}";
        when(idempotency.find(any(), any(), any(), any(), any())).thenReturn(Optional.of(new IdempotencyRepository.Stored(false, 200, stored, 4)));
        when(idempotency.bodyHash(any(), any(), any(), any(), any())).thenReturn(Optional.of(gov.bee.api.application.DraftRequestSupport.bodyHash(new com.fasterxml.jackson.databind.ObjectMapper().readTree(ok))));
        var replay = conforms(r, post(path).with(token("secretary")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 200, null);
        assertEquals("true", replay.getHeader("Idempotency-Replayed"));
        when(idempotency.find(any(), any(), any(), any(), any())).thenReturn(Optional.empty());

        // Who may approve: only the Secretary, never the applicant's own organisation, never someone who acted at another stage.
        account("manufacturer", "own-org");
        conforms(r, post(path).with(token("manufacturer")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 403, "role_not_permitted");
        account("auditor", "all");
        conforms(r, post(path).with(token("auditor")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 403, "role_not_permitted");
        secretaryAccount(staff);
        when(identity.activeMembershipOrganisationIds(USER)).thenReturn(Set.of(NOVA));   // the Secretary belongs to the applicant's organisation
        conforms(r, post(path).with(token("secretary")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 403, "segregation_refused");
        secretaryAccount(staff);
        when(secretaryRepo.actorsAtOtherStages(NOVA_APP)).thenReturn(Set.of(USER));
        conforms(r, post(path).with(token("secretary")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 403, "segregation_refused");
        when(secretaryRepo.actorsAtOtherStages(NOVA_APP)).thenReturn(Set.of());
        when(applications.find(org.mockito.ArgumentMatchers.eq(NOVA_APP), any(), any())).thenReturn(Optional.empty());
        conforms(r, post(path).with(token("secretary")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 404, "not_found");

        // Identity denials and outage.
        secretaryAccount(staff);
        conforms(r, post(path).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 401, "unauthenticated");
        conforms(r, post(path).with(pwdOnly).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 403, "mfa_required");
        account("manufacturer", "own-org");
        conforms(r, post(path).with(token("secretary")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 403, "no_effective_role");
        when(identity.activeAccount(any())).thenReturn(Optional.empty());
        conforms(r, post(path).with(token("secretary")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 403, "no_active_account");
        secretaryAccount(staff);
        doThrow(new DataAccessResourceFailureException("down")).when(secretaryRepo).approve(any(), anyInt(), any(), any(), any());
        conforms(r, post(path).with(token("secretary")).header("Idempotency-Key", "0123456789abcdef0123457").contentType("application/json").content(ok), 503, "service_unavailable");
    }

    @Test
    void directorRecommendationOperationsDocumentedPairs() throws Exception {
        String r = "/api/model-applications/{id}/director-recommendation";
        String path = "/api/model-applications/" + NOVA_APP + "/director-recommendation";
        UUID staff = UUID.fromString("00000000-0000-4000-b000-0000000000aa");
        String ok = "{\"version\":5,\"note\":\"Rating reviewed; recommend approval.\"}";
        var done = new gov.bee.api.director.DirectorRecommendationRepository.Result(gov.bee.api.director.DirectorRecommendationRepository.Outcome.RECOMMENDED, 6,
            "secretary_approval", Instant.parse("2026-10-04T10:00:00Z"));

        directorAccount(staff);
        when(idempotency.find(any(), any(), any(), any(), any())).thenReturn(Optional.empty());
        when(idempotency.begin(any(), any(), any(), any(), any(), any())).thenReturn(true);
        when(directorRepo.actorsAtOtherStages(NOVA_APP)).thenReturn(Set.of());
        when(directorRepo.recommend(any(), anyInt(), any(), any(), any(), anyBoolean())).thenReturn(done);
        var pwdOnly = jwt().jwt(j -> j.subject(USER.toString()).claim("amr", List.of("pwd")).claim("realm_access", Map.of("roles", List.of("director"))));
        conforms(r, post(path).with(token("director")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 200, null);

        // The owner's D1 assumption: where the recommendation is final for the category, the answer says so and the state is approved.
        when(directorRepo.directorFinal(any(), any())).thenReturn(true);
        when(directorRepo.recommend(any(), anyInt(), any(), any(), any(), anyBoolean())).thenReturn(
            new gov.bee.api.director.DirectorRecommendationRepository.Result(gov.bee.api.director.DirectorRecommendationRepository.Outcome.RECOMMENDED, 6,
                "approved", Instant.parse("2026-10-04T10:00:00Z")));
        var finalRes = conforms(r, post(path).with(token("director")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 200, null);
        assertTrue(finalRes.getContentAsString().contains("\"toState\":\"approved\"") && finalRes.getContentAsString().contains("\"directorFinal\":true"), finalRes.getContentAsString());
        when(directorRepo.directorFinal(any(), any())).thenReturn(false);
        when(directorRepo.recommend(any(), anyInt(), any(), any(), any(), anyBoolean())).thenReturn(done);

        // Request shape.
        conforms(r, post(path).with(token("director")).contentType("application/json").content(ok), 422, "idempotency_key_required");
        conforms(r, post(path).with(token("director")).header("Idempotency-Key", IDEM).contentType("application/json").content("{}"), 422, "validation_failed");
        conforms(r, post(path).with(token("director")).header("Idempotency-Key", IDEM).contentType("application/json")
            .content(ok.replace("Rating reviewed; recommend approval.", "   ")), 422, "validation_failed");
        conforms(r, post(path).with(token("director")).header("Idempotency-Key", IDEM).contentType("application/json")
            .content(ok.replace("Rating reviewed", "Rating\\nreviewed")), 422, "validation_failed");
        conforms(r, post(path).with(token("director")).header("Idempotency-Key", IDEM).contentType("application/json")
            .content(ok.replace("Rating reviewed; recommend approval.", "x".repeat(501))), 422, "validation_failed");

        // Version, idempotency and assignment conflicts.
        conforms(r, post(path).with(token("director")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok.replace("\"version\":5", "\"version\":4")), 409, "version_conflict");
        when(directorRepo.recommend(any(), anyInt(), any(), any(), any(), anyBoolean())).thenReturn(
            new gov.bee.api.director.DirectorRecommendationRepository.Result(gov.bee.api.director.DirectorRecommendationRepository.Outcome.STALE, 0, null, null));
        conforms(r, post(path).with(token("director")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 409, "version_conflict");
        when(directorRepo.recommend(any(), anyInt(), any(), any(), any(), anyBoolean())).thenReturn(done);
        when(idempotency.find(any(), any(), any(), any(), any())).thenReturn(Optional.of(new IdempotencyRepository.Stored(true, 200, "{}", 0)));
        conforms(r, post(path).with(token("director")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 409, "idempotency_in_progress");
        when(idempotency.find(any(), any(), any(), any(), any())).thenReturn(Optional.of(new IdempotencyRepository.Stored(false, 200, "{}", 1)));
        when(idempotency.bodyHash(any(), any(), any(), any(), any())).thenReturn(Optional.of(new byte[] {9}));
        conforms(r, post(path).with(token("director")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 409, "idempotency_key_conflict");
        // A replay returns the stored receipt, not a record the Director may no longer read.
        String stored = "{\"applicationId\":\"" + NOVA_APP + "\",\"reference\":\"LOCAL-MA-0002\",\"fromState\":\"director_review\",\"toState\":\"secretary_approval\",\"version\":6,"
            + "\"note\":\"Rating reviewed; recommend approval.\",\"directorFinal\":false,\"recommendedAt\":\"2026-10-04T10:00:00Z\"}";
        when(idempotency.find(any(), any(), any(), any(), any())).thenReturn(Optional.of(new IdempotencyRepository.Stored(false, 200, stored, 4)));
        when(idempotency.bodyHash(any(), any(), any(), any(), any())).thenReturn(Optional.of(gov.bee.api.application.DraftRequestSupport.bodyHash(new com.fasterxml.jackson.databind.ObjectMapper().readTree(ok))));
        var replay = conforms(r, post(path).with(token("director")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 200, null);
        assertEquals("true", replay.getHeader("Idempotency-Replayed"));
        when(idempotency.find(any(), any(), any(), any(), any())).thenReturn(Optional.empty());

        // Who may recommend: only the Director, never the applicant's own organisation, never someone who acted at another stage.
        account("manufacturer", "own-org");
        conforms(r, post(path).with(token("manufacturer")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 403, "role_not_permitted");
        account("auditor", "all");
        conforms(r, post(path).with(token("auditor")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 403, "role_not_permitted");
        directorAccount(staff);
        when(identity.activeMembershipOrganisationIds(USER)).thenReturn(Set.of(NOVA));   // the Director belongs to the applicant's organisation
        conforms(r, post(path).with(token("director")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 403, "segregation_refused");
        directorAccount(staff);
        when(directorRepo.actorsAtOtherStages(NOVA_APP)).thenReturn(Set.of(USER));
        conforms(r, post(path).with(token("director")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 403, "segregation_refused");
        when(directorRepo.actorsAtOtherStages(NOVA_APP)).thenReturn(Set.of());
        when(applications.find(org.mockito.ArgumentMatchers.eq(NOVA_APP), any(), any())).thenReturn(Optional.empty());
        conforms(r, post(path).with(token("director")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 404, "not_found");

        // Identity denials and outage.
        directorAccount(staff);
        conforms(r, post(path).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 401, "unauthenticated");
        conforms(r, post(path).with(pwdOnly).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 403, "mfa_required");
        account("manufacturer", "own-org");
        conforms(r, post(path).with(token("director")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 403, "no_effective_role");
        when(identity.activeAccount(any())).thenReturn(Optional.empty());
        conforms(r, post(path).with(token("director")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 403, "no_active_account");
        directorAccount(staff);
        doThrow(new DataAccessResourceFailureException("down")).when(directorRepo).recommend(any(), anyInt(), any(), any(), any(), anyBoolean());
        conforms(r, post(path).with(token("director")).header("Idempotency-Key", "0123456789abcdef0123457").contentType("application/json").content(ok), 503, "service_unavailable");
    }

    @Test
    void ratingOperationsDocumentedPairs() throws Exception {
        String r = "/api/model-applications/{id}/rating";
        String path = "/api/model-applications/" + NOVA_APP + "/rating";
        UUID staff = UUID.fromString("00000000-0000-4000-b000-0000000000aa");
        String ok = "{\"version\":4,\"verifiedIseer\":\"4.62\"}";
        var done = new gov.bee.api.rating.RatingRepository.Result(gov.bee.api.rating.RatingRepository.Outcome.COMPUTED, 5, 1,
            Instant.parse("2026-10-04T10:00:00Z"));
        var bands = List.of(
            new gov.bee.api.rating.RatingRepository.Band("RAC-ISEER-DEMO-1", 1, new BigDecimal("3.30")),
            new gov.bee.api.rating.RatingRepository.Band("RAC-ISEER-DEMO-1", 2, new BigDecimal("3.50")),
            new gov.bee.api.rating.RatingRepository.Band("RAC-ISEER-DEMO-1", 3, new BigDecimal("4.00")),
            new gov.bee.api.rating.RatingRepository.Band("RAC-ISEER-DEMO-1", 4, new BigDecimal("4.50")),
            new gov.bee.api.rating.RatingRepository.Band("RAC-ISEER-DEMO-1", 5, new BigDecimal("5.00")));

        programmeAccount(staff);
        when(ratingRepo.bandsInForce(any(), any())).thenReturn(bands);
        when(idempotency.find(any(), any(), any(), any(), any())).thenReturn(Optional.empty());
        when(idempotency.begin(any(), any(), any(), any(), any(), any())).thenReturn(true);
        when(ratingRepo.actorsAtOtherStages(NOVA_APP)).thenReturn(Set.of());
        when(ratingRepo.compute(any(), anyInt(), any(), any(), any(), any(), any(), anyInt())).thenReturn(done);
        var pwdOnly = jwt().jwt(j -> j.subject(USER.toString()).claim("amr", List.of("pwd")).claim("realm_access", Map.of("roles", List.of("programme"))));
        conforms(r, post(path).with(token("programme")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 200, null);

        // Request shape.
        conforms(r, post(path).with(token("programme")).contentType("application/json").content(ok), 422, "idempotency_key_required");
        conforms(r, post(path).with(token("programme")).header("Idempotency-Key", IDEM).contentType("application/json").content("{}"), 422, "validation_failed");
        for (String bad : List.of("abc", "0", "0.00", "100.5", "4.555", "-4.5", "")) {
            conforms(r, post(path).with(token("programme")).header("Idempotency-Key", IDEM).contentType("application/json")
                .content(ok.replace("4.62", bad)), 422, "validation_failed");
        }
        conforms(r, post(path).with(token("programme")).header("Idempotency-Key", IDEM).contentType("application/json")
            .content("{\"version\":4,\"verifiedIseer\":4.62}"), 422, "validation_failed");
        // Below the lowest band, and no scheme in force: nothing is written.
        conforms(r, post(path).with(token("programme")).header("Idempotency-Key", IDEM).contentType("application/json")
            .content(ok.replace("4.62", "3.29")), 422, "rating_below_threshold");
        when(ratingRepo.bandsInForce(any(), any())).thenReturn(List.of());
        conforms(r, post(path).with(token("programme")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 422, "rule_not_available");
        when(ratingRepo.bandsInForce(any(), any())).thenReturn(bands);

        // Version, idempotency and assignment conflicts.
        conforms(r, post(path).with(token("programme")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok.replace("\"version\":4", "\"version\":3")), 409, "version_conflict");
        when(ratingRepo.compute(any(), anyInt(), any(), any(), any(), any(), any(), anyInt())).thenReturn(
            new gov.bee.api.rating.RatingRepository.Result(gov.bee.api.rating.RatingRepository.Outcome.STALE, 0, 0, null));
        conforms(r, post(path).with(token("programme")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 409, "version_conflict");
        when(ratingRepo.compute(any(), anyInt(), any(), any(), any(), any(), any(), anyInt())).thenReturn(done);
        when(idempotency.find(any(), any(), any(), any(), any())).thenReturn(Optional.of(new IdempotencyRepository.Stored(true, 200, "{}", 0)));
        conforms(r, post(path).with(token("programme")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 409, "idempotency_in_progress");
        when(idempotency.find(any(), any(), any(), any(), any())).thenReturn(Optional.of(new IdempotencyRepository.Stored(false, 200, "{}", 1)));
        when(idempotency.bodyHash(any(), any(), any(), any(), any())).thenReturn(Optional.of(new byte[] {9}));
        conforms(r, post(path).with(token("programme")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 409, "idempotency_key_conflict");
        // A replay returns the stored receipt, not a record Programme may no longer read.
        String stored = "{\"applicationId\":\"" + NOVA_APP + "\",\"reference\":\"LOCAL-MA-0002\",\"fromState\":\"rating\",\"toState\":\"director_review\",\"version\":5,"
            + "\"ratingVersion\":1,\"schemeKey\":\"RAC-ISEER-DEMO-1\",\"declaredIseer\":\"4.50\",\"verifiedIseer\":\"4.62\",\"stars\":4,"
            + "\"localDemoRating\":true,\"computedAt\":\"2026-10-04T10:00:00Z\"}";
        when(idempotency.find(any(), any(), any(), any(), any())).thenReturn(Optional.of(new IdempotencyRepository.Stored(false, 200, stored, 4)));
        when(idempotency.bodyHash(any(), any(), any(), any(), any())).thenReturn(Optional.of(gov.bee.api.application.DraftRequestSupport.bodyHash(new com.fasterxml.jackson.databind.ObjectMapper().readTree(ok))));
        var replay = conforms(r, post(path).with(token("programme")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 200, null);
        assertEquals("true", replay.getHeader("Idempotency-Replayed"));
        when(idempotency.find(any(), any(), any(), any(), any())).thenReturn(Optional.empty());

        // Who may rate: only Programme, never the applicant's own organisation, never someone who acted at another stage.
        account("manufacturer", "own-org");
        conforms(r, post(path).with(token("manufacturer")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 403, "role_not_permitted");
        account("auditor", "all");
        conforms(r, post(path).with(token("auditor")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 403, "role_not_permitted");
        programmeAccount(staff);
        when(identity.activeMembershipOrganisationIds(USER)).thenReturn(Set.of(NOVA));   // the officer belongs to the applicant's organisation
        conforms(r, post(path).with(token("programme")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 403, "segregation_refused");
        programmeAccount(staff);
        when(ratingRepo.actorsAtOtherStages(NOVA_APP)).thenReturn(Set.of(USER));
        conforms(r, post(path).with(token("programme")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 403, "segregation_refused");
        when(ratingRepo.actorsAtOtherStages(NOVA_APP)).thenReturn(Set.of());
        when(applications.find(org.mockito.ArgumentMatchers.eq(NOVA_APP), any(), any())).thenReturn(Optional.empty());
        conforms(r, post(path).with(token("programme")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 404, "not_found");

        // Identity denials and outage.
        programmeAccount(staff);
        conforms(r, post(path).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 401, "unauthenticated");
        conforms(r, post(path).with(pwdOnly).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 403, "mfa_required");
        account("manufacturer", "own-org");
        conforms(r, post(path).with(token("programme")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 403, "no_effective_role");
        when(identity.activeAccount(any())).thenReturn(Optional.empty());
        conforms(r, post(path).with(token("programme")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 403, "no_active_account");
        programmeAccount(staff);
        doThrow(new DataAccessResourceFailureException("down")).when(ratingRepo).compute(any(), anyInt(), any(), any(), any(), any(), any(), anyInt());
        conforms(r, post(path).with(token("programme")).header("Idempotency-Key", "0123456789abcdef0123457").contentType("application/json").content(ok), 503, "service_unavailable");
    }

    @Test
    void stageReturnOperationsDocumentedPairs() throws Exception {
        String r = "/api/model-applications/{id}/return";
        String path = "/api/model-applications/" + NOVA_APP + "/return";
        String ok = "{\"version\":3,\"reason\":\"The laboratory name on the report does not match.\"}";
        var pwdOnly = jwt().jwt(j -> j.subject(USER.toString()).claim("amr", List.of("pwd")).claim("realm_access", Map.of("roles", List.of("iame"))));
        var done = new gov.bee.api.rework.StageReturnRepository.Result(gov.bee.api.rework.StageReturnRepository.Outcome.RETURNED, 4, Instant.parse("2026-10-04T10:00:00Z"));
        when(idempotency.find(any(), any(), any(), any(), any())).thenReturn(Optional.empty());
        when(idempotency.begin(any(), any(), any(), any(), any(), any())).thenReturn(true);
        when(returnRepo.actorsAtOtherStages(org.mockito.ArgumentMatchers.eq(NOVA_APP), any())).thenReturn(Set.of());
        when(returnRepo.doReturn(any(), anyInt(), any(), any(), any(), any())).thenReturn(done);

        // Each stage owner returns from its own stage, and the receipt names the stage it came from.
        record Owner(String role, String scope, String state, Set<String> assigned) {
        }
        for (var o : List.of(new Owner("iame", "assigned", "iame_scrutiny", Set.of("iame_scrutiny")), new Owner("reviewer", "assigned", "bee_scrutiny", Set.of("bee_scrutiny")),
            new Owner("director", "all", "director_review", Set.<String>of()), new Owner("secretary", "all", "secretary_approval", Set.<String>of()))) {
            officerAccount(o.role(), o.scope(), o.state(), o.assigned());
            var res = conforms(r, post(path).with(token(o.role())).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 200, null);
            assertTrue(res.getContentAsString().contains("\"fromState\":\"" + o.state() + "\"") && res.getContentAsString().contains("\"toState\":\"returned\""), res.getContentAsString());
        }
        officerAccount("iame", "assigned", "iame_scrutiny", Set.of("iame_scrutiny"));

        // Request shape.
        conforms(r, post(path).with(token("iame")).contentType("application/json").content(ok), 422, "idempotency_key_required");
        conforms(r, post(path).with(token("iame")).header("Idempotency-Key", IDEM).contentType("application/json").content("{}"), 422, "validation_failed");
        conforms(r, post(path).with(token("iame")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok.replace("The laboratory name on the report does not match.", "   ")), 422, "validation_failed");
        conforms(r, post(path).with(token("iame")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok.replace("The laboratory", "The\\nlaboratory")), 422, "validation_failed");
        conforms(r, post(path).with(token("iame")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok.replace("The laboratory name on the report does not match.", "x".repeat(501))), 422, "validation_failed");

        // Version, idempotency and replay.
        conforms(r, post(path).with(token("iame")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok.replace("\"version\":3", "\"version\":2")), 409, "version_conflict");
        when(returnRepo.doReturn(any(), anyInt(), any(), any(), any(), any())).thenReturn(
            new gov.bee.api.rework.StageReturnRepository.Result(gov.bee.api.rework.StageReturnRepository.Outcome.STALE, 0, null));
        conforms(r, post(path).with(token("iame")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 409, "version_conflict");
        when(returnRepo.doReturn(any(), anyInt(), any(), any(), any(), any())).thenReturn(done);
        when(idempotency.find(any(), any(), any(), any(), any())).thenReturn(Optional.of(new IdempotencyRepository.Stored(true, 200, "{}", 0)));
        conforms(r, post(path).with(token("iame")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 409, "idempotency_in_progress");
        when(idempotency.find(any(), any(), any(), any(), any())).thenReturn(Optional.of(new IdempotencyRepository.Stored(false, 200, "{}", 1)));
        when(idempotency.bodyHash(any(), any(), any(), any(), any())).thenReturn(Optional.of(new byte[] {9}));
        conforms(r, post(path).with(token("iame")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 409, "idempotency_key_conflict");
        String stored = "{\"applicationId\":\"" + NOVA_APP + "\",\"reference\":\"LOCAL-MA-0002\",\"fromState\":\"iame_scrutiny\",\"toState\":\"returned\",\"version\":4,"
            + "\"reason\":\"The laboratory name on the report does not match.\",\"returnedAt\":\"2026-10-04T10:00:00Z\"}";
        when(idempotency.find(any(), any(), any(), any(), any())).thenReturn(Optional.of(new IdempotencyRepository.Stored(false, 200, stored, 4)));
        when(idempotency.bodyHash(any(), any(), any(), any(), any())).thenReturn(Optional.of(gov.bee.api.application.DraftRequestSupport.bodyHash(new com.fasterxml.jackson.databind.ObjectMapper().readTree(ok))));
        var replay = conforms(r, post(path).with(token("iame")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 200, null);
        assertEquals("true", replay.getHeader("Idempotency-Replayed"));
        when(idempotency.find(any(), any(), any(), any(), any())).thenReturn(Optional.empty());

        // Who may return: only the owner of the stage the application is in; never the applicant, Programme, Finance or someone without a read scope.
        account("manufacturer", "own-org");
        conforms(r, post(path).with(token("manufacturer")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 403, "role_not_permitted");
        account("auditor", "all");
        conforms(r, post(path).with(token("auditor")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 403, "role_not_permitted");
        officerAccount("programme", "all", "rating", Set.of());
        conforms(r, post(path).with(token("programme")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 403, "role_not_permitted");
        officerAccount("finance", "all", "fee_due", Set.of());
        conforms(r, post(path).with(token("finance")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 403, "role_not_permitted");
        officerAccount("director", "all", "secretary_approval", Set.of());
        conforms(r, post(path).with(token("director")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 404, "not_found");
        officerAccount("iame", "assigned", "iame_scrutiny", Set.of("iame_scrutiny"));
        when(identity.activeMembershipOrganisationIds(USER)).thenReturn(Set.of(NOVA));   // the officer belongs to the applicant's organisation
        conforms(r, post(path).with(token("iame")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 403, "segregation_refused");
        officerAccount("iame", "assigned", "iame_scrutiny", Set.of("iame_scrutiny"));
        when(returnRepo.actorsAtOtherStages(org.mockito.ArgumentMatchers.eq(NOVA_APP), any())).thenReturn(Set.of(USER));
        conforms(r, post(path).with(token("iame")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 403, "segregation_refused");
        when(returnRepo.actorsAtOtherStages(org.mockito.ArgumentMatchers.eq(NOVA_APP), any())).thenReturn(Set.of());
        officerAccount("iame", "assigned", "iame_scrutiny", Set.<String>of());   // not assigned: indistinguishable from an unknown application
        conforms(r, post(path).with(token("iame")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 404, "not_found");

        // Identity denials and outage.
        officerAccount("iame", "assigned", "iame_scrutiny", Set.of("iame_scrutiny"));
        conforms(r, post(path).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 401, "unauthenticated");
        conforms(r, post(path).with(pwdOnly).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 403, "mfa_required");
        account("manufacturer", "own-org");
        conforms(r, post(path).with(token("iame")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 403, "no_effective_role");
        when(identity.activeAccount(any())).thenReturn(Optional.empty());
        conforms(r, post(path).with(token("iame")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 403, "no_active_account");
        officerAccount("iame", "assigned", "iame_scrutiny", Set.of("iame_scrutiny"));
        doThrow(new DataAccessResourceFailureException("down")).when(returnRepo).doReturn(any(), anyInt(), any(), any(), any(), any());
        conforms(r, post(path).with(token("iame")).header("Idempotency-Key", "0123456789abcdef0123457").contentType("application/json").content(ok), 503, "service_unavailable");
    }

    @Test
    void stageRejectOperationsDocumentedPairs() throws Exception {
        String r = "/api/model-applications/{id}/reject";
        String path = "/api/model-applications/" + NOVA_APP + "/reject";
        String ok = "{\"version\":3,\"reason\":\"The report is for a different model.\"}";
        var pwdOnly = jwt().jwt(j -> j.subject(USER.toString()).claim("amr", List.of("pwd")).claim("realm_access", Map.of("roles", List.of("iame"))));
        var done = new gov.bee.api.rework.StageRejectRepository.Result(gov.bee.api.rework.StageRejectRepository.Outcome.REJECTED, 4, Instant.parse("2026-10-04T10:00:00Z"));
        when(idempotency.find(any(), any(), any(), any(), any())).thenReturn(Optional.empty());
        when(idempotency.begin(any(), any(), any(), any(), any(), any())).thenReturn(true);
        when(rejectRepo.actorsAtOtherStages(org.mockito.ArgumentMatchers.eq(NOVA_APP), any())).thenReturn(Set.of());
        when(rejectRepo.doReject(any(), anyInt(), any(), any(), any(), any())).thenReturn(done);

        // Each stage owner, Programme included, rejects from its own stage, and the receipt names the stage it came from.
        record Owner(String role, String scope, String state, Set<String> assigned) {
        }
        for (var o : List.of(new Owner("iame", "assigned", "iame_scrutiny", Set.of("iame_scrutiny")), new Owner("reviewer", "assigned", "bee_scrutiny", Set.of("bee_scrutiny")),
            new Owner("programme", "all", "rating", Set.<String>of()), new Owner("director", "all", "director_review", Set.<String>of()), new Owner("secretary", "all", "secretary_approval", Set.<String>of()))) {
            officerAccount(o.role(), o.scope(), o.state(), o.assigned());
            var res = conforms(r, post(path).with(token(o.role())).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 200, null);
            assertTrue(res.getContentAsString().contains("\"fromState\":\"" + o.state() + "\"") && res.getContentAsString().contains("\"toState\":\"rejected\""), res.getContentAsString());
        }
        officerAccount("iame", "assigned", "iame_scrutiny", Set.of("iame_scrutiny"));

        // Request shape.
        conforms(r, post(path).with(token("iame")).contentType("application/json").content(ok), 422, "idempotency_key_required");
        conforms(r, post(path).with(token("iame")).header("Idempotency-Key", IDEM).contentType("application/json").content("{}"), 422, "validation_failed");
        conforms(r, post(path).with(token("iame")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok.replace("The report is for a different model.", "   ")), 422, "validation_failed");
        conforms(r, post(path).with(token("iame")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok.replace("The report", "The\\nreport")), 422, "validation_failed");
        conforms(r, post(path).with(token("iame")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok.replace("The report is for a different model.", "x".repeat(501))), 422, "validation_failed");

        // Version, idempotency and replay.
        conforms(r, post(path).with(token("iame")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok.replace("\"version\":3", "\"version\":2")), 409, "version_conflict");
        when(rejectRepo.doReject(any(), anyInt(), any(), any(), any(), any())).thenReturn(
            new gov.bee.api.rework.StageRejectRepository.Result(gov.bee.api.rework.StageRejectRepository.Outcome.STALE, 0, null));
        conforms(r, post(path).with(token("iame")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 409, "version_conflict");
        when(rejectRepo.doReject(any(), anyInt(), any(), any(), any(), any())).thenReturn(done);
        when(idempotency.find(any(), any(), any(), any(), any())).thenReturn(Optional.of(new IdempotencyRepository.Stored(true, 200, "{}", 0)));
        conforms(r, post(path).with(token("iame")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 409, "idempotency_in_progress");
        when(idempotency.find(any(), any(), any(), any(), any())).thenReturn(Optional.of(new IdempotencyRepository.Stored(false, 200, "{}", 1)));
        when(idempotency.bodyHash(any(), any(), any(), any(), any())).thenReturn(Optional.of(new byte[] {9}));
        conforms(r, post(path).with(token("iame")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 409, "idempotency_key_conflict");
        String stored = "{\"applicationId\":\"" + NOVA_APP + "\",\"reference\":\"LOCAL-MA-0002\",\"fromState\":\"iame_scrutiny\",\"toState\":\"rejected\",\"version\":4,"
            + "\"reason\":\"The report is for a different model.\",\"rejectedAt\":\"2026-10-04T10:00:00Z\"}";
        when(idempotency.find(any(), any(), any(), any(), any())).thenReturn(Optional.of(new IdempotencyRepository.Stored(false, 200, stored, 4)));
        when(idempotency.bodyHash(any(), any(), any(), any(), any())).thenReturn(Optional.of(gov.bee.api.application.DraftRequestSupport.bodyHash(new com.fasterxml.jackson.databind.ObjectMapper().readTree(ok))));
        var replay = conforms(r, post(path).with(token("iame")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 200, null);
        assertEquals("true", replay.getHeader("Idempotency-Replayed"));
        when(idempotency.find(any(), any(), any(), any(), any())).thenReturn(Optional.empty());

        // Who may reject: only the owner of the stage the application is in; never the applicant, Finance, another stage's owner or someone without a read scope.
        account("manufacturer", "own-org");
        conforms(r, post(path).with(token("manufacturer")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 403, "role_not_permitted");
        account("auditor", "all");
        conforms(r, post(path).with(token("auditor")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 403, "role_not_permitted");
        officerAccount("finance", "all", "fee_due", Set.of());
        conforms(r, post(path).with(token("finance")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 403, "role_not_permitted");
        officerAccount("director", "all", "secretary_approval", Set.of());
        conforms(r, post(path).with(token("director")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 404, "not_found");
        officerAccount("iame", "assigned", "iame_scrutiny", Set.of("iame_scrutiny"));
        when(identity.activeMembershipOrganisationIds(USER)).thenReturn(Set.of(NOVA));   // the officer belongs to the applicant's organisation
        conforms(r, post(path).with(token("iame")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 403, "segregation_refused");
        officerAccount("iame", "assigned", "iame_scrutiny", Set.of("iame_scrutiny"));
        when(rejectRepo.actorsAtOtherStages(org.mockito.ArgumentMatchers.eq(NOVA_APP), any())).thenReturn(Set.of(USER));
        conforms(r, post(path).with(token("iame")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 403, "segregation_refused");
        when(rejectRepo.actorsAtOtherStages(org.mockito.ArgumentMatchers.eq(NOVA_APP), any())).thenReturn(Set.of());
        officerAccount("iame", "assigned", "iame_scrutiny", Set.<String>of());   // not assigned: indistinguishable from an unknown application
        conforms(r, post(path).with(token("iame")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 404, "not_found");

        // Identity denials and outage.
        officerAccount("iame", "assigned", "iame_scrutiny", Set.of("iame_scrutiny"));
        conforms(r, post(path).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 401, "unauthenticated");
        conforms(r, post(path).with(pwdOnly).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 403, "mfa_required");
        account("manufacturer", "own-org");
        conforms(r, post(path).with(token("iame")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 403, "no_effective_role");
        when(identity.activeAccount(any())).thenReturn(Optional.empty());
        conforms(r, post(path).with(token("iame")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 403, "no_active_account");
        officerAccount("iame", "assigned", "iame_scrutiny", Set.of("iame_scrutiny"));
        doThrow(new DataAccessResourceFailureException("down")).when(rejectRepo).doReject(any(), anyInt(), any(), any(), any(), any());
        conforms(r, post(path).with(token("iame")).header("Idempotency-Key", "0123456789abcdef0123457").contentType("application/json").content(ok), 503, "service_unavailable");
    }


    static final UUID PROPOSAL_ID = UUID.fromString("00000000-0000-4000-f000-000000000001");

    static gov.bee.api.feerules.FeeRuleRepository.Proposal feeProposal(String state, UUID proposer) {
        boolean pending = state.equals("pending");
        return new gov.bee.api.feerules.FeeRuleRepository.Proposal(PROPOSAL_ID, "RAC", "new_model", new java.math.BigDecimal("26000.00"), new java.math.BigDecimal("18.00"),
            java.time.LocalDate.now(java.time.ZoneId.of("Asia/Kolkata")).plusDays(10), "Circular 2026/14", "Revised fee", proposer, "Proposer Name", Instant.parse("2026-10-04T10:00:00Z"), state,
            pending ? null : "Decider Name", pending ? null : Instant.parse("2026-10-04T11:00:00Z"), null, state.equals("approved") ? 3 : null);
    }

    static gov.bee.api.ratingschemes.RatingSchemeRepository.Proposal schemeProposal(String state, UUID proposer) {
        boolean pending = state.equals("pending");
        return new gov.bee.api.ratingschemes.RatingSchemeRepository.Proposal(PROPOSAL_ID, "RAC", java.time.LocalDate.now(java.time.ZoneId.of("Asia/Kolkata")).plusDays(10),
            List.of(new BigDecimal("3.00"), new BigDecimal("3.40"), new BigDecimal("3.90"), new BigDecimal("4.40"), new BigDecimal("4.90")), "Circular 2026/14", "Revised scheme",
            proposer, "Proposer Name", Instant.parse("2026-10-04T10:00:00Z"), state, pending ? null : "Decider Name", pending ? null : Instant.parse("2026-10-04T11:00:00Z"), null,
            state.equals("approved") ? "RAC-ISEER-2" : null);
    }

    static gov.bee.api.feecorrections.FeeCorrectionRepository.Confirmation corrConfirmation(boolean pending) {
        return new gov.bee.api.feecorrections.FeeCorrectionRepository.Confirmation(UUID.fromString("00000000-0000-4000-f000-0000000000c1"), NOVA_APP, "LOCAL-MA-0002", "Nova Cool",
            "NC-RAC-18F", "iame_scrutiny", "UTR-WRONG", java.time.LocalDate.of(2026, 10, 2), new BigDecimal("24000.00"), "BEE Finance", Instant.parse("2026-10-03T10:00:00Z"),
            null, null, null, null, pending ? PROPOSAL_ID : null);
    }

    static gov.bee.api.feecorrections.FeeCorrectionRepository.Proposal corrProposal(String state, UUID proposer) {
        boolean pending = state.equals("pending");
        return new gov.bee.api.feecorrections.FeeCorrectionRepository.Proposal(PROPOSAL_ID, NOVA_APP, "LOCAL-MA-0002", "UTR-WRONG", java.time.LocalDate.of(2026, 10, 2), "UTR-RIGHT",
            java.time.LocalDate.of(2026, 10, 1), "The reference was mistyped", proposer, "Proposer Name", Instant.parse("2026-10-04T10:00:00Z"), state,
            pending ? null : "Decider Name", pending ? null : Instant.parse("2026-10-04T11:00:00Z"), null);
    }

    @Test
    void feeCorrectionOperationsDocumentedPairs() throws Exception {
        String list = "/api/fee-corrections";
        String propose = "/api/fee-corrections/proposals";
        String decide = "/api/fee-corrections/proposals/{id}/decision";
        String decidePath = "/api/fee-corrections/proposals/" + PROPOSAL_ID + "/decision";
        String ok = "{\"applicationId\":\"" + NOVA_APP + "\",\"receiptReference\":\"UTR-RIGHT\",\"receivedOn\":\"2026-10-01\",\"reason\":\"The reference was mistyped\"}";
        String go = "{\"decision\":\"approve\"}";
        var pwdOnly = jwt().jwt(j -> j.subject(USER.toString()).claim("amr", List.of("pwd")).claim("realm_access", Map.of("roles", List.of("finance"))));
        UUID other = UUID.fromString("00000000-0000-4000-a000-0000000000aa");
        var Out = gov.bee.api.feecorrections.FeeCorrectionRepository.Outcome.class;
        account("finance", "all");
        when(idempotency.find(any(), any(), any(), any(), any())).thenReturn(Optional.empty());
        when(idempotency.begin(any(), any(), any(), any(), any(), any())).thenReturn(true);
        when(correctionRepo.rolesHolding("fee_confirmation_correct")).thenReturn(Set.of("finance"));
        when(correctionRepo.recentConfirmations(anyInt())).thenReturn(List.of(corrConfirmation(true)));
        when(correctionRepo.confirmationOf(NOVA_APP)).thenReturn(Optional.of(corrConfirmation(false)));
        when(correctionRepo.segregated(any(), any())).thenReturn(false);
        when(correctionRepo.pending()).thenReturn(List.of(corrProposal("pending", other)));
        when(correctionRepo.recentDecided(anyInt())).thenReturn(List.of(corrProposal("approved", other)));
        when(correctionRepo.insert(any(), any())).thenReturn(corrProposal("pending", USER));
        when(correctionRepo.proposal(PROPOSAL_ID)).thenReturn(Optional.of(corrProposal("pending", other)));
        when(correctionRepo.decide(any(), any(), any(), any())).thenReturn(new gov.bee.api.feecorrections.FeeCorrectionRepository.Decided(Out.getEnumConstants()[0], "approved"));

        var read = conforms(list, get(list).with(token("finance")), 200, null);
        assertTrue(read.getContentAsString().contains("\"receiptReference\":\"UTR-WRONG\"") && read.getContentAsString().contains("\"correction\":null"), read.getContentAsString());
        account("manufacturer", "own-org");
        conforms(list, get(list).with(token("manufacturer")), 403, "role_not_permitted");
        account("finance", "all");

        var created = conforms(propose, post(propose).with(token("finance")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 201, null);
        assertTrue(created.getContentAsString().contains("\"state\":\"pending\"") && created.getContentAsString().contains("\"proposedByYou\":true"), created.getContentAsString());
        conforms(propose, post(propose).with(token("finance")).contentType("application/json").content(ok), 422, "idempotency_key_required");
        conforms(propose, post(propose).with(token("finance")).header("Idempotency-Key", IDEM).contentType("application/json").content("{}"), 422, "validation_failed");
        conforms(propose, post(propose).with(token("finance")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok.replace("UTR-RIGHT", "bad;ref")), 422, "validation_failed");
        conforms(propose, post(propose).with(token("finance")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok.replace("2026-10-01", "2999-01-01")), 422, "validation_failed");
        conforms(propose, post(propose).with(token("finance")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok.replace("The reference was mistyped", "line\\nbreak")), 422, "validation_failed");
        conforms(propose, post(propose).with(token("finance")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok.replace(NOVA_APP.toString(), "not-a-uuid")), 422, "validation_failed");
        conforms(propose, post(propose).with(token("finance")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok.replace("UTR-RIGHT", "UTR-WRONG").replace("2026-10-01", "2026-10-02")), 422, "validation_failed");
        conforms(propose, post(propose).with(token("finance")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok.replace(NOVA_APP.toString(), UUID.randomUUID().toString())), 404, "not_found");
        when(correctionRepo.segregated(any(), any())).thenReturn(true);
        conforms(propose, post(propose).with(token("finance")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 403, "segregation_refused");
        when(correctionRepo.segregated(any(), any())).thenReturn(false);
        when(correctionRepo.confirmationOf(NOVA_APP)).thenReturn(Optional.of(corrConfirmation(true)));
        conforms(propose, post(propose).with(token("finance")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 409, "correction_already_pending");
        when(correctionRepo.confirmationOf(NOVA_APP)).thenReturn(Optional.of(corrConfirmation(false)));
        when(idempotency.find(any(), any(), any(), any(), any())).thenReturn(Optional.of(new IdempotencyRepository.Stored(true, 201, "{}", 0)));
        conforms(propose, post(propose).with(token("finance")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 409, "idempotency_in_progress");
        when(idempotency.find(any(), any(), any(), any(), any())).thenReturn(Optional.of(new IdempotencyRepository.Stored(false, 201, "{}", 0)));
        when(idempotency.bodyHash(any(), any(), any(), any(), any())).thenReturn(Optional.of(new byte[] {9}));
        conforms(propose, post(propose).with(token("finance")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 409, "idempotency_key_conflict");
        when(idempotency.find(any(), any(), any(), any(), any())).thenReturn(Optional.empty());
        account("manufacturer", "own-org");
        conforms(propose, post(propose).with(token("manufacturer")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 403, "role_not_permitted");
        account("finance", "all");

        when(correctionRepo.proposal(PROPOSAL_ID)).thenReturn(Optional.of(corrProposal("approved", other)));
        var approved = conforms(decide, post(decidePath).with(token("finance")).header("Idempotency-Key", IDEM).contentType("application/json").content(go), 200, null);
        assertTrue(approved.getContentAsString().contains("\"state\":\"approved\""), approved.getContentAsString());
        when(correctionRepo.proposal(PROPOSAL_ID)).thenReturn(Optional.of(corrProposal("pending", other)));
        record Refusal(gov.bee.api.feecorrections.FeeCorrectionRepository.Outcome outcome, int status, String code) {
        }
        for (var r : List.of(new Refusal(Out.getEnumConstants()[4], 403, "segregation_refused"), new Refusal(Out.getEnumConstants()[6], 403, "segregation_refused"),
            new Refusal(Out.getEnumConstants()[5], 403, "role_not_permitted"), new Refusal(Out.getEnumConstants()[3], 403, "role_not_permitted"),
            new Refusal(Out.getEnumConstants()[2], 409, "proposal_not_pending"), new Refusal(Out.getEnumConstants()[1], 404, "not_found"))) {
            when(correctionRepo.decide(any(), any(), any(), any())).thenReturn(new gov.bee.api.feecorrections.FeeCorrectionRepository.Decided(r.outcome(), null));
            conforms(decide, post(decidePath).with(token("finance")).header("Idempotency-Key", IDEM).contentType("application/json").content(go), r.status(), r.code());
        }
        when(correctionRepo.decide(any(), any(), any(), any())).thenReturn(new gov.bee.api.feecorrections.FeeCorrectionRepository.Decided(Out.getEnumConstants()[0], "approved"));
        conforms(decide, post("/api/fee-corrections/proposals/" + UUID.randomUUID() + "/decision").with(token("finance")).header("Idempotency-Key", IDEM).contentType("application/json").content(go), 404, "not_found");
        conforms(decide, post(decidePath).with(token("finance")).contentType("application/json").content(go), 422, "idempotency_key_required");
        conforms(decide, post(decidePath).with(token("finance")).header("Idempotency-Key", IDEM).contentType("application/json").content("{\"decision\":\"delete\"}"), 422, "validation_failed");
        conforms(decide, post(decidePath).with(token("finance")).header("Idempotency-Key", IDEM).contentType("application/json").content("{\"decision\":\"reject\",\"note\":\"" + "x".repeat(501) + "\"}"), 422, "validation_failed");
        when(idempotency.find(any(), any(), any(), any(), any())).thenReturn(Optional.of(new IdempotencyRepository.Stored(true, 200, "{}", 0)));
        conforms(decide, post(decidePath).with(token("finance")).header("Idempotency-Key", IDEM).contentType("application/json").content(go), 409, "idempotency_in_progress");
        when(idempotency.find(any(), any(), any(), any(), any())).thenReturn(Optional.of(new IdempotencyRepository.Stored(false, 200, "{}", 1)));
        conforms(decide, post(decidePath).with(token("finance")).header("Idempotency-Key", IDEM).contentType("application/json").content(go), 409, "idempotency_key_conflict");
        String stored = "{\"id\":\"" + PROPOSAL_ID + "\",\"applicationId\":\"" + NOVA_APP + "\",\"reference\":\"LOCAL-MA-0002\",\"previousReceiptReference\":\"UTR-WRONG\",\"previousReceivedOn\":\"2026-10-02\","
            + "\"receiptReference\":\"UTR-RIGHT\",\"receivedOn\":\"2026-10-01\",\"reason\":\"The reference was mistyped\",\"state\":\"pending\",\"proposedBy\":\"Proposer Name\",\"proposedByYou\":false,"
            + "\"proposedAt\":\"2026-10-04T10:00:00Z\",\"decidedBy\":null,\"decidedAt\":null,\"decisionNote\":null}";
        when(idempotency.find(any(), any(), any(), any(), any())).thenReturn(Optional.of(new IdempotencyRepository.Stored(false, 200, stored, 1)));
        when(idempotency.bodyHash(any(), any(), any(), any(), any())).thenReturn(Optional.of(gov.bee.api.application.DraftRequestSupport.bodyHash(new com.fasterxml.jackson.databind.ObjectMapper().readTree(go))));
        var replay = conforms(decide, post(decidePath).with(token("finance")).header("Idempotency-Key", IDEM).contentType("application/json").content(go), 200, null);
        assertEquals("true", replay.getHeader("Idempotency-Replayed"));
        when(idempotency.find(any(), any(), any(), any(), any())).thenReturn(Optional.empty());

        for (String[] r : new String[][] {{list, "GET"}, {propose, "POST"}, {decide, "POST"}}) {
            String path = r[0].equals(decide) ? decidePath : r[0];
            var req = r[1].equals("GET") ? get(path) : post(path).header("Idempotency-Key", IDEM).contentType("application/json").content(r[0].equals(propose) ? ok : go);
            conforms(r[0], req, 401, "unauthenticated");
            var req2 = r[1].equals("GET") ? get(path) : post(path).header("Idempotency-Key", IDEM).contentType("application/json").content(r[0].equals(propose) ? ok : go);
            conforms(r[0], req2.with(pwdOnly), 403, "mfa_required");
        }
        account("manufacturer", "own-org");
        conforms(list, get(list).with(token("finance")), 403, "no_effective_role");
        conforms(propose, post(propose).with(token("finance")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 403, "no_effective_role");
        conforms(decide, post(decidePath).with(token("finance")).header("Idempotency-Key", IDEM).contentType("application/json").content(go), 403, "no_effective_role");
        when(identity.activeAccount(any())).thenReturn(Optional.empty());
        conforms(list, get(list).with(token("finance")), 403, "no_active_account");
        conforms(propose, post(propose).with(token("finance")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 403, "no_active_account");
        conforms(decide, post(decidePath).with(token("finance")).header("Idempotency-Key", IDEM).contentType("application/json").content(go), 403, "no_active_account");
        account("finance", "all");
        when(correctionRepo.rolesHolding("fee_confirmation_correct")).thenThrow(new DataAccessResourceFailureException("down"));
        conforms(list, get(list).with(token("finance")), 503, "service_unavailable");
        conforms(propose, post(propose).with(token("finance")).header("Idempotency-Key", "0123456789abcdef0123457").contentType("application/json").content(ok), 503, "service_unavailable");
        conforms(decide, post(decidePath).with(token("finance")).header("Idempotency-Key", "0123456789abcdef0123457").contentType("application/json").content(go), 503, "service_unavailable");
    }

    @Test
    void ratingSchemeOperationsDocumentedPairs() throws Exception {
        String list = "/api/rating-schemes";
        String propose = "/api/rating-schemes/proposals";
        String decide = "/api/rating-schemes/proposals/{id}/decision";
        String decidePath = "/api/rating-schemes/proposals/" + PROPOSAL_ID + "/decision";
        String when10 = java.time.LocalDate.now(java.time.ZoneId.of("Asia/Kolkata")).plusDays(10).toString();
        String ok = "{\"categoryCode\":\"RAC\",\"effectiveFrom\":\"" + when10 + "\",\"minIseer\":[\"3.00\",\"3.40\",\"3.90\",\"4.40\",\"4.90\"],"
            + "\"sourceReference\":\"Circular 2026/14\",\"reason\":\"Revised scheme\"}";
        var pwdOnly = jwt().jwt(j -> j.subject(USER.toString()).claim("amr", List.of("pwd")).claim("realm_access", Map.of("roles", List.of("admin"))));
        UUID other = UUID.fromString("00000000-0000-4000-a000-0000000000aa");
        account("admin", "all");
        when(idempotency.find(any(), any(), any(), any(), any())).thenReturn(Optional.empty());
        when(idempotency.begin(any(), any(), any(), any(), any(), any())).thenReturn(true);
        when(schemesRepo.rolesHolding("rating_scheme_manage")).thenReturn(Set.of("admin"));
        when(schemesRepo.categoriesOn(any())).thenReturn(List.of(new gov.bee.api.ratingschemes.RatingSchemeRepository.Category("RAC", "Room air conditioner")));
        when(schemesRepo.categoryAppliesOn(org.mockito.ArgumentMatchers.eq("RAC"), any())).thenReturn(true);
        when(schemesRepo.schemes()).thenReturn(List.of(new gov.bee.api.ratingschemes.RatingSchemeRepository.Scheme("RAC-ISEER-DEMO-1", "RAC", java.time.LocalDate.of(2026, 1, 1),
            List.of(new gov.bee.api.ratingschemes.RatingSchemeRepository.Band(1, new BigDecimal("3.30")), new gov.bee.api.ratingschemes.RatingSchemeRepository.Band(2, new BigDecimal("3.50")),
                new gov.bee.api.ratingschemes.RatingSchemeRepository.Band(3, new BigDecimal("4.00")), new gov.bee.api.ratingschemes.RatingSchemeRepository.Band(4, new BigDecimal("4.50")),
                new gov.bee.api.ratingschemes.RatingSchemeRepository.Band(5, new BigDecimal("5.00"))), "Local seed", "Placeholder band")));
        when(schemesRepo.pending()).thenReturn(List.of(schemeProposal("pending", other)));
        when(schemesRepo.recentDecided(anyInt())).thenReturn(List.of(schemeProposal("approved", other)));
        when(schemesRepo.insert(any(), any())).thenReturn(schemeProposal("pending", USER));
        when(schemesRepo.proposal(PROPOSAL_ID)).thenReturn(Optional.of(schemeProposal("pending", other)));
        when(schemesRepo.decide(any(), any(), any(), any())).thenReturn(new gov.bee.api.ratingschemes.RatingSchemeRepository.Decided(gov.bee.api.ratingschemes.RatingSchemeRepository.Outcome.DONE, "approved", "RAC-ISEER-2"));

        var read = conforms(list, get(list).with(token("admin")), 200, null);
        assertTrue(read.getContentAsString().contains("\"schemeKey\":\"RAC-ISEER-DEMO-1\"") && read.getContentAsString().contains("\"inForce\":true") && read.getContentAsString().contains("\"proposedByYou\":false"), read.getContentAsString());
        account("manufacturer", "own-org");
        conforms(list, get(list).with(token("manufacturer")), 403, "role_not_permitted");
        account("admin", "all");

        var created = conforms(propose, post(propose).with(token("admin")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 201, null);
        assertTrue(created.getContentAsString().contains("\"state\":\"pending\"") && created.getContentAsString().contains("\"proposedByYou\":true"), created.getContentAsString());
        conforms(propose, post(propose).with(token("admin")).contentType("application/json").content(ok), 422, "idempotency_key_required");
        conforms(propose, post(propose).with(token("admin")).header("Idempotency-Key", IDEM).contentType("application/json").content("{}"), 422, "validation_failed");
        conforms(propose, post(propose).with(token("admin")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok.replace("\"3.40\"", "\"3.00\"")), 422, "validation_failed");
        conforms(propose, post(propose).with(token("admin")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok.replace(",\"4.90\"", "")), 422, "validation_failed");
        conforms(propose, post(propose).with(token("admin")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok.replace("\"3.90\"", "\"3.905\"")), 422, "validation_failed");
        conforms(propose, post(propose).with(token("admin")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok.replace(when10, "2020-01-01")), 422, "validation_failed");
        conforms(propose, post(propose).with(token("admin")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok.replace("Revised scheme", "line\\nbreak")), 422, "validation_failed");
        when(idempotency.find(any(), any(), any(), any(), any())).thenReturn(Optional.of(new IdempotencyRepository.Stored(true, 201, "{}", 0)));
        conforms(propose, post(propose).with(token("admin")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 409, "idempotency_in_progress");
        when(idempotency.find(any(), any(), any(), any(), any())).thenReturn(Optional.of(new IdempotencyRepository.Stored(false, 201, "{}", 0)));
        when(idempotency.bodyHash(any(), any(), any(), any(), any())).thenReturn(Optional.of(new byte[] {9}));
        conforms(propose, post(propose).with(token("admin")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 409, "idempotency_key_conflict");
        when(idempotency.find(any(), any(), any(), any(), any())).thenReturn(Optional.empty());
        account("manufacturer", "own-org");
        conforms(propose, post(propose).with(token("manufacturer")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 403, "role_not_permitted");
        account("admin", "all");

        when(schemesRepo.proposal(PROPOSAL_ID)).thenReturn(Optional.of(schemeProposal("approved", other)));
        var approved = conforms(decide, post(decidePath).with(token("admin")).header("Idempotency-Key", IDEM).contentType("application/json").content("{\"decision\":\"approve\"}"), 200, null);
        assertTrue(approved.getContentAsString().contains("\"state\":\"approved\"") && approved.getContentAsString().contains("\"appliedScheme\":\"RAC-ISEER-2\""), approved.getContentAsString());
        String go = "{\"decision\":\"approve\"}";
        when(schemesRepo.proposal(PROPOSAL_ID)).thenReturn(Optional.of(schemeProposal("pending", other)));
        record Refusal(gov.bee.api.ratingschemes.RatingSchemeRepository.Outcome outcome, int status, String code) {
        }
        for (var r : List.of(new Refusal(gov.bee.api.ratingschemes.RatingSchemeRepository.Outcome.SAME_PERSON, 403, "segregation_refused"), new Refusal(gov.bee.api.ratingschemes.RatingSchemeRepository.Outcome.ONLY_PROPOSER, 403, "role_not_permitted"),
            new Refusal(gov.bee.api.ratingschemes.RatingSchemeRepository.Outcome.NOT_PERMITTED, 403, "role_not_permitted"), new Refusal(gov.bee.api.ratingschemes.RatingSchemeRepository.Outcome.NOT_PENDING, 409, "proposal_not_pending"),
            new Refusal(gov.bee.api.ratingschemes.RatingSchemeRepository.Outcome.DATE_PASSED, 409, "effective_date_passed"), new Refusal(gov.bee.api.ratingschemes.RatingSchemeRepository.Outcome.RULE_CONFLICT, 409, "rule_conflict"), new Refusal(gov.bee.api.ratingschemes.RatingSchemeRepository.Outcome.NOT_FOUND, 404, "not_found"))) {
            when(schemesRepo.decide(any(), any(), any(), any())).thenReturn(new gov.bee.api.ratingschemes.RatingSchemeRepository.Decided(r.outcome(), null, null));
            conforms(decide, post(decidePath).with(token("admin")).header("Idempotency-Key", IDEM).contentType("application/json").content(go), r.status(), r.code());
        }
        when(schemesRepo.decide(any(), any(), any(), any())).thenReturn(new gov.bee.api.ratingschemes.RatingSchemeRepository.Decided(gov.bee.api.ratingschemes.RatingSchemeRepository.Outcome.DONE, "approved", "RAC-ISEER-2"));
        conforms(decide, post("/api/rating-schemes/proposals/" + UUID.randomUUID() + "/decision").with(token("admin")).header("Idempotency-Key", IDEM).contentType("application/json").content(go), 404, "not_found");
        conforms(decide, post(decidePath).with(token("admin")).contentType("application/json").content(go), 422, "idempotency_key_required");
        conforms(decide, post(decidePath).with(token("admin")).header("Idempotency-Key", IDEM).contentType("application/json").content("{\"decision\":\"delete\"}"), 422, "validation_failed");
        conforms(decide, post(decidePath).with(token("admin")).header("Idempotency-Key", IDEM).contentType("application/json").content("{\"decision\":\"reject\",\"note\":\"" + "x".repeat(501) + "\"}"), 422, "validation_failed");
        when(idempotency.find(any(), any(), any(), any(), any())).thenReturn(Optional.of(new IdempotencyRepository.Stored(true, 200, "{}", 0)));
        conforms(decide, post(decidePath).with(token("admin")).header("Idempotency-Key", IDEM).contentType("application/json").content(go), 409, "idempotency_in_progress");
        when(idempotency.find(any(), any(), any(), any(), any())).thenReturn(Optional.of(new IdempotencyRepository.Stored(false, 200, "{}", 1)));
        conforms(decide, post(decidePath).with(token("admin")).header("Idempotency-Key", IDEM).contentType("application/json").content(go), 409, "idempotency_key_conflict");
        String stored = "{\"id\":\"" + PROPOSAL_ID + "\",\"categoryCode\":\"RAC\",\"effectiveFrom\":\"" + when10 + "\",\"minIseer\":[\"3.00\",\"3.40\",\"3.90\",\"4.40\",\"4.90\"],"
            + "\"sourceReference\":\"Circular 2026/14\",\"reason\":\"Revised scheme\",\"state\":\"pending\",\"proposedBy\":\"Proposer Name\",\"proposedByYou\":false,"
            + "\"proposedAt\":\"2026-10-04T10:00:00Z\",\"decidedBy\":null,\"decidedAt\":null,\"decisionNote\":null,\"appliedScheme\":null}";
        when(idempotency.find(any(), any(), any(), any(), any())).thenReturn(Optional.of(new IdempotencyRepository.Stored(false, 200, stored, 1)));
        when(idempotency.bodyHash(any(), any(), any(), any(), any())).thenReturn(Optional.of(gov.bee.api.application.DraftRequestSupport.bodyHash(new com.fasterxml.jackson.databind.ObjectMapper().readTree(go))));
        var replay = conforms(decide, post(decidePath).with(token("admin")).header("Idempotency-Key", IDEM).contentType("application/json").content(go), 200, null);
        assertEquals("true", replay.getHeader("Idempotency-Replayed"));
        when(idempotency.find(any(), any(), any(), any(), any())).thenReturn(Optional.empty());

        for (String[] r : new String[][] {{list, "GET"}, {propose, "POST"}, {decide, "POST"}}) {
            String path = r[0].equals(decide) ? decidePath : r[0];
            var req = r[1].equals("GET") ? get(path) : post(path).header("Idempotency-Key", IDEM).contentType("application/json").content(r[0].equals(propose) ? ok : go);
            conforms(r[0], req, 401, "unauthenticated");
            var req2 = r[1].equals("GET") ? get(path) : post(path).header("Idempotency-Key", IDEM).contentType("application/json").content(r[0].equals(propose) ? ok : go);
            conforms(r[0], req2.with(pwdOnly), 403, "mfa_required");
        }
        account("manufacturer", "own-org");
        conforms(list, get(list).with(token("admin")), 403, "no_effective_role");
        conforms(propose, post(propose).with(token("admin")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 403, "no_effective_role");
        conforms(decide, post(decidePath).with(token("admin")).header("Idempotency-Key", IDEM).contentType("application/json").content(go), 403, "no_effective_role");
        when(identity.activeAccount(any())).thenReturn(Optional.empty());
        conforms(list, get(list).with(token("admin")), 403, "no_active_account");
        conforms(propose, post(propose).with(token("admin")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 403, "no_active_account");
        conforms(decide, post(decidePath).with(token("admin")).header("Idempotency-Key", IDEM).contentType("application/json").content(go), 403, "no_active_account");
        account("admin", "all");
        when(schemesRepo.rolesHolding("rating_scheme_manage")).thenThrow(new DataAccessResourceFailureException("down"));
        conforms(list, get(list).with(token("admin")), 503, "service_unavailable");
        conforms(propose, post(propose).with(token("admin")).header("Idempotency-Key", "0123456789abcdef0123457").contentType("application/json").content(ok), 503, "service_unavailable");
        conforms(decide, post(decidePath).with(token("admin")).header("Idempotency-Key", "0123456789abcdef0123457").contentType("application/json").content(go), 503, "service_unavailable");
    }

    @Test
    void notificationOperationsDocumentedPairs() throws Exception {
        String list = "/api/notifications";
        String one = "/api/notifications/{id}/read";
        String all = "/api/notifications/read-all";
        UUID mine = UUID.fromString("00000000-0000-4000-a000-0000000000b1");
        var pwdOnly = jwt().jwt(j -> j.subject(USER.toString()).claim("amr", List.of("pwd")).claim("realm_access", Map.of("roles", List.of("manufacturer"))));
        // no token, a planted token, and the wrong method are all refused
        conforms(list, get(list), 401, "unauthenticated");
        conforms(one, post("/api/notifications/" + mine + "/read"), 401, "unauthenticated");
        conforms(all, post(all), 401, "unauthenticated");
        // identity denials
        conforms(list, get(list).with(pwdOnly), 403, "mfa_required");
        conforms(all, post(all).with(pwdOnly), 403, "mfa_required");
        conforms(one, post("/api/notifications/" + mine + "/read").with(pwdOnly), 403, "mfa_required");
        when(identity.activeAccount(any())).thenReturn(Optional.empty());
        conforms(list, get(list).with(token("manufacturer")), 403, "no_active_account");
        conforms(one, post("/api/notifications/" + mine + "/read").with(token("manufacturer")), 403, "no_active_account");
        conforms(all, post(all).with(token("manufacturer")), 403, "no_active_account");
        account("auditor", "all");
        conforms(list, get(list).with(token("finance")), 403, "no_effective_role");
        conforms(one, post("/api/notifications/" + mine + "/read").with(token("finance")), 403, "no_effective_role");
        conforms(all, post(all).with(token("finance")), 403, "no_effective_role");
        // the caller's own notifications
        account("manufacturer", "own");
        when(notificationRepo.newest(USER)).thenReturn(List.of(new gov.bee.api.notifications.NotificationRepository.Item(mine, "returned",
            "LOCAL-MA-0002 (Nova Cool NC-RAC-18F) was returned to you: The report does not match. Edit it and send it again.", NOVA_APP, "LOCAL-MA-0002",
            java.time.Instant.parse("2026-10-06T10:00:00Z"), false)));
        when(notificationRepo.unread(USER)).thenReturn(1);
        var body = conforms(list, get(list).with(token("manufacturer")), 200, null).getContentAsString();
        assertTrue(body.contains("\"unread\":1") && body.contains("\"kind\":\"returned\""), body);
        when(notificationRepo.newest(USER)).thenReturn(List.of());
        when(notificationRepo.unread(USER)).thenReturn(0);
        conforms(list, get(list).with(token("manufacturer")), 200, null);
        // marking one read: its own, someone else's or unknown (the same 404), and a malformed id
        when(notificationRepo.owns(USER, mine)).thenReturn(true);
        when(notificationRepo.markRead(USER, mine)).thenReturn(1);
        conforms(one, post("/api/notifications/" + mine + "/read").with(token("manufacturer")), 200, null);
        when(notificationRepo.markRead(USER, mine)).thenReturn(0);
        conforms(one, post("/api/notifications/" + mine + "/read").with(token("manufacturer")), 200, null);
        conforms(one, post("/api/notifications/" + UUID.randomUUID() + "/read").with(token("manufacturer")), 404, "not_found");
        conforms(one, post("/api/notifications/not-a-uuid/read").with(token("manufacturer")), 404, "not_found");
        when(notificationRepo.markAllRead(USER)).thenReturn(3);
        var bodyAll = conforms(all, post(all).with(token("manufacturer")), 200, null).getContentAsString();
        assertTrue(bodyAll.contains("\"marked\":3"), bodyAll);
        // the database is down
        when(notificationRepo.newest(USER)).thenThrow(new org.springframework.dao.DataAccessResourceFailureException("down"));
        conforms(list, get(list).with(token("manufacturer")), 503, "service_unavailable");
        when(notificationRepo.owns(USER, mine)).thenThrow(new org.springframework.dao.DataAccessResourceFailureException("down"));
        conforms(one, post("/api/notifications/" + mine + "/read").with(token("manufacturer")), 503, "service_unavailable");
        when(notificationRepo.markAllRead(USER)).thenThrow(new org.springframework.dao.DataAccessResourceFailureException("down"));
        conforms(all, post(all).with(token("manufacturer")), 503, "service_unavailable");
        // the other methods are not routes
        assertEquals(401, mvc.perform(delete(list)).andReturn().getResponse().getStatus());
    }

    @Test
    void publicVerificationRateLimitDocumentedPairs() throws Exception {
        String route = "/api/public/verification";
        java.util.concurrent.atomic.AtomicLong clock = new java.util.concurrent.atomic.AtomicLong(5_000_000);
        publicRateLimiter.resetForTest(2, clock::get);
        try {
            when(publicVerificationRepo.find("BEE/RAC/2026/99999")).thenReturn(Optional.empty());
            conforms(route, get(route).param("reg", "BEE/RAC/2026/99999"), 404, "not_found");
            conforms(route, get(route).param("reg", "BEE/RAC/2026/99999"), 404, "not_found");
            var limited = conforms(route, get(route).param("reg", "BEE/RAC/2026/99999"), 429, "rate_limited");
            assertEquals("60", limited.getHeader("Retry-After"));
            clock.addAndGet(25_000);
            assertEquals("35", conforms(route, get(route), 429, "rate_limited").getHeader("Retry-After"), "a blank request counts too, and the wait shrinks");
            clock.addAndGet(35_000);
            conforms(route, get(route).param("reg", "BEE/RAC/2026/99999"), 404, "not_found");
        } finally {
            publicRateLimiter.resetForTest(600, System::currentTimeMillis);
        }
    }

    @Test
    void publicVerificationDocumentedPairs() throws Exception {
        String route = "/api/public/verification";
        String reg = "BEE/RAC/2026/10001";
        java.time.LocalDate today = java.time.LocalDate.now(java.time.ZoneId.of("Asia/Kolkata"));
        when(publicVerificationRepo.find(reg)).thenReturn(Optional.of(new gov.bee.api.verification.PublicVerificationRepository.PublicCertificate(reg, "Nova Appliances Pvt Ltd",
            "Nova Cool", "NC-1", "RAC", 4, new java.math.BigDecimal("4.62"), today.minusDays(1), today.plusYears(3))));
        when(publicVerificationRepo.find("BEE/RAC/2020/10001")).thenReturn(Optional.of(new gov.bee.api.verification.PublicVerificationRepository.PublicCertificate("BEE/RAC/2020/10001",
            "Nova Appliances Pvt Ltd", "Nova Cool", "NC-1", "RAC", 3, new java.math.BigDecimal("4.10"), today.minusYears(5), today.minusYears(2))));
        when(publicVerificationRepo.find("BEE/RAC/2026/99999")).thenReturn(Optional.empty());
        // no token at all: the route is public
        var ok = conforms(route, get(route).param("reg", reg), 200, null);
        assertTrue(ok.getContentAsString().contains("\"status\":\"valid\""));
        assertTrue(conforms(route, get(route).param("reg", "BEE/RAC/2020/10001"), 200, null).getContentAsString().contains("\"status\":\"expired\""));
        conforms(route, get(route).param("reg", "BEE/RAC/2026/99999"), 404, "not_found");
        conforms(route, get(route).param("reg", "not a registration"), 404, "not_found");
        conforms(route, get(route).param("reg", "'; DROP TABLE certificate; --"), 404, "not_found");
        conforms(route, get(route).param("reg", " "), 422, "validation_failed");
        conforms(route, get(route), 422, "validation_failed");
        when(publicVerificationRepo.find(reg)).thenThrow(new org.springframework.dao.DataAccessResourceFailureException("down"));
        conforms(route, get(route).param("reg", reg), 503, "service_unavailable");
        // only reading is public
        assertEquals(401, mvc.perform(post(route).param("reg", reg)).andReturn().getResponse().getStatus());
    }

    @Test
    void feeRuleOperationsDocumentedPairs() throws Exception {
        String list = "/api/fee-rules";
        String propose = "/api/fee-rules/proposals";
        String decide = "/api/fee-rules/proposals/{id}/decision";
        String decidePath = "/api/fee-rules/proposals/" + PROPOSAL_ID + "/decision";
        String when10 = java.time.LocalDate.now(java.time.ZoneId.of("Asia/Kolkata")).plusDays(10).toString();
        String ok = "{\"categoryCode\":\"RAC\",\"applicationType\":\"new_model\",\"amountInr\":\"26000.00\",\"taxRatePercent\":\"18.00\",\"effectiveFrom\":\"" + when10
            + "\",\"sourceReference\":\"Circular 2026/14\",\"reason\":\"Revised fee\"}";
        var pwdOnly = jwt().jwt(j -> j.subject(USER.toString()).claim("amr", List.of("pwd")).claim("realm_access", Map.of("roles", List.of("admin"))));
        UUID other = UUID.fromString("00000000-0000-4000-a000-0000000000aa");
        account("admin", "all");
        when(idempotency.find(any(), any(), any(), any(), any())).thenReturn(Optional.empty());
        when(idempotency.begin(any(), any(), any(), any(), any(), any())).thenReturn(true);
        when(feeRulesRepo.rolesHolding("fee_rule_manage")).thenReturn(Set.of("admin"));
        when(feeRulesRepo.applicationTypes()).thenReturn(List.of(new gov.bee.api.feerules.FeeRuleRepository.AppType("new_model", "New model")));
        when(feeRulesRepo.categoriesOn(any())).thenReturn(List.of(new gov.bee.api.feerules.FeeRuleRepository.Category("RAC", "Room air conditioner")));
        when(feeRulesRepo.applicationTypeExists("new_model")).thenReturn(true);
        when(feeRulesRepo.categoryAppliesOn(org.mockito.ArgumentMatchers.eq("RAC"), any())).thenReturn(true);
        when(feeRulesRepo.versions()).thenReturn(List.of(new gov.bee.api.feerules.FeeRuleRepository.Version("RAC:new_model", "RAC", "new_model", 2, java.time.LocalDate.of(2026, 10, 1), null,
            new java.math.BigDecimal("24000.00"), new java.math.BigDecimal("0.00"), "provisional", "Local seed")));
        when(feeRulesRepo.pending()).thenReturn(List.of(feeProposal("pending", other)));
        when(feeRulesRepo.recentDecided(anyInt())).thenReturn(List.of(feeProposal("approved", other)));
        when(feeRulesRepo.insert(any(), any())).thenReturn(feeProposal("pending", USER));
        when(feeRulesRepo.proposal(PROPOSAL_ID)).thenReturn(Optional.of(feeProposal("pending", other)));
        when(feeRulesRepo.decide(any(), any(), any(), any())).thenReturn(new gov.bee.api.feerules.FeeRuleRepository.Decided(gov.bee.api.feerules.FeeRuleRepository.Outcome.DONE, "approved", 3));

        // Read: the permission, then the fee rules and the proposals.
        var read = conforms(list, get(list).with(token("admin")), 200, null);
        assertTrue(read.getContentAsString().contains("\"ruleKey\":\"RAC:new_model\"") && read.getContentAsString().contains("\"proposedByYou\":false"), read.getContentAsString());
        account("manufacturer", "own-org");
        conforms(list, get(list).with(token("manufacturer")), 403, "role_not_permitted");
        account("admin", "all");

        // Propose.
        var created = conforms(propose, post(propose).with(token("admin")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 201, null);
        assertTrue(created.getContentAsString().contains("\"state\":\"pending\"") && created.getContentAsString().contains("\"proposedByYou\":true"), created.getContentAsString());
        conforms(propose, post(propose).with(token("admin")).contentType("application/json").content(ok), 422, "idempotency_key_required");
        conforms(propose, post(propose).with(token("admin")).header("Idempotency-Key", IDEM).contentType("application/json").content("{}"), 422, "validation_failed");
        conforms(propose, post(propose).with(token("admin")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok.replace("26000.00", "26000.005")), 422, "validation_failed");
        conforms(propose, post(propose).with(token("admin")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok.replace(when10, "2020-01-01")), 422, "validation_failed");
        conforms(propose, post(propose).with(token("admin")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok.replace("\"18.00\"", "\"100.01\"")), 422, "validation_failed");
        conforms(propose, post(propose).with(token("admin")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok.replace("new_model", "renewal")), 422, "validation_failed");
        conforms(propose, post(propose).with(token("admin")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok.replace("Revised fee", "line\\nbreak")), 422, "validation_failed");
        when(idempotency.find(any(), any(), any(), any(), any())).thenReturn(Optional.of(new IdempotencyRepository.Stored(true, 201, "{}", 0)));
        conforms(propose, post(propose).with(token("admin")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 409, "idempotency_in_progress");
        when(idempotency.find(any(), any(), any(), any(), any())).thenReturn(Optional.of(new IdempotencyRepository.Stored(false, 201, "{}", 0)));
        when(idempotency.bodyHash(any(), any(), any(), any(), any())).thenReturn(Optional.of(new byte[] {9}));
        conforms(propose, post(propose).with(token("admin")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 409, "idempotency_key_conflict");
        when(idempotency.find(any(), any(), any(), any(), any())).thenReturn(Optional.empty());
        account("manufacturer", "own-org");
        conforms(propose, post(propose).with(token("manufacturer")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 403, "role_not_permitted");
        account("admin", "all");

        // Decide: approve by a second person, and every refusal the database function reports.
        when(feeRulesRepo.proposal(PROPOSAL_ID)).thenReturn(Optional.of(feeProposal("approved", other)));
        var approved = conforms(decide, post(decidePath).with(token("admin")).header("Idempotency-Key", IDEM).contentType("application/json").content("{\"decision\":\"approve\"}"), 200, null);
        assertTrue(approved.getContentAsString().contains("\"state\":\"approved\"") && approved.getContentAsString().contains("\"appliedVersion\":3"), approved.getContentAsString());
        String go = "{\"decision\":\"approve\"}";
        when(feeRulesRepo.proposal(PROPOSAL_ID)).thenReturn(Optional.of(feeProposal("pending", other)));
        record Refusal(gov.bee.api.feerules.FeeRuleRepository.Outcome outcome, int status, String code) {
        }
        for (var r : List.of(new Refusal(gov.bee.api.feerules.FeeRuleRepository.Outcome.SAME_PERSON, 403, "segregation_refused"),
            new Refusal(gov.bee.api.feerules.FeeRuleRepository.Outcome.ONLY_PROPOSER, 403, "role_not_permitted"),
            new Refusal(gov.bee.api.feerules.FeeRuleRepository.Outcome.NOT_PERMITTED, 403, "role_not_permitted"),
            new Refusal(gov.bee.api.feerules.FeeRuleRepository.Outcome.NOT_PENDING, 409, "proposal_not_pending"),
            new Refusal(gov.bee.api.feerules.FeeRuleRepository.Outcome.DATE_PASSED, 409, "effective_date_passed"),
            new Refusal(gov.bee.api.feerules.FeeRuleRepository.Outcome.RULE_CONFLICT, 409, "rule_conflict"),
            new Refusal(gov.bee.api.feerules.FeeRuleRepository.Outcome.NOT_FOUND, 404, "not_found"))) {
            when(feeRulesRepo.decide(any(), any(), any(), any())).thenReturn(new gov.bee.api.feerules.FeeRuleRepository.Decided(r.outcome(), null, null));
            conforms(decide, post(decidePath).with(token("admin")).header("Idempotency-Key", IDEM).contentType("application/json").content(go), r.status(), r.code());
        }
        when(feeRulesRepo.decide(any(), any(), any(), any())).thenReturn(new gov.bee.api.feerules.FeeRuleRepository.Decided(gov.bee.api.feerules.FeeRuleRepository.Outcome.DONE, "approved", 3));
        conforms(decide, post("/api/fee-rules/proposals/" + UUID.randomUUID() + "/decision").with(token("admin")).header("Idempotency-Key", IDEM).contentType("application/json").content(go), 404, "not_found");
        when(feeRulesRepo.proposal(PROPOSAL_ID)).thenReturn(Optional.of(feeProposal("pending", other)));
        conforms(decide, post(decidePath).with(token("admin")).contentType("application/json").content(go), 422, "idempotency_key_required");
        conforms(decide, post(decidePath).with(token("admin")).header("Idempotency-Key", IDEM).contentType("application/json").content("{\"decision\":\"delete\"}"), 422, "validation_failed");
        conforms(decide, post(decidePath).with(token("admin")).header("Idempotency-Key", IDEM).contentType("application/json").content("{\"decision\":\"reject\",\"note\":\"" + "x".repeat(501) + "\"}"), 422, "validation_failed");
        when(idempotency.find(any(), any(), any(), any(), any())).thenReturn(Optional.of(new IdempotencyRepository.Stored(true, 200, "{}", 0)));
        conforms(decide, post(decidePath).with(token("admin")).header("Idempotency-Key", IDEM).contentType("application/json").content(go), 409, "idempotency_in_progress");
        when(idempotency.find(any(), any(), any(), any(), any())).thenReturn(Optional.of(new IdempotencyRepository.Stored(false, 200, "{}", 1)));
        conforms(decide, post(decidePath).with(token("admin")).header("Idempotency-Key", IDEM).contentType("application/json").content(go), 409, "idempotency_key_conflict");
        String stored = new com.fasterxml.jackson.databind.ObjectMapper().writeValueAsString(Map.ofEntries(Map.entry("id", PROPOSAL_ID.toString()), Map.entry("ruleKey", "RAC:new_model"),
            Map.entry("categoryCode", "RAC"), Map.entry("applicationType", "new_model"), Map.entry("amountInr", "26000.00"), Map.entry("taxRatePercent", "18.00"), Map.entry("effectiveFrom", when10),
            Map.entry("sourceReference", "Circular 2026/14"), Map.entry("reason", "Revised fee"), Map.entry("state", "pending"), Map.entry("proposedBy", "Proposer Name"),
            Map.entry("proposedByYou", false), Map.entry("proposedAt", "2026-10-04T10:00:00Z")));
        String full = stored.substring(0, stored.length() - 1) + ",\"decidedBy\":null,\"decidedAt\":null,\"decisionNote\":null,\"appliedVersion\":null}";
        when(idempotency.find(any(), any(), any(), any(), any())).thenReturn(Optional.of(new IdempotencyRepository.Stored(false, 200, full, 1)));
        when(idempotency.bodyHash(any(), any(), any(), any(), any())).thenReturn(Optional.of(gov.bee.api.application.DraftRequestSupport.bodyHash(new com.fasterxml.jackson.databind.ObjectMapper().readTree(go))));
        var replay = conforms(decide, post(decidePath).with(token("admin")).header("Idempotency-Key", IDEM).contentType("application/json").content(go), 200, null);
        assertEquals("true", replay.getHeader("Idempotency-Replayed"));
        when(idempotency.find(any(), any(), any(), any(), any())).thenReturn(Optional.empty());

        // Identity denials and outage (each route).
        for (String[] r : new String[][] {{list, "GET"}, {propose, "POST"}, {decide, "POST"}}) {
            String path = r[0].equals(decide) ? decidePath : r[0];
            var req = r[1].equals("GET") ? get(path) : post(path).header("Idempotency-Key", IDEM).contentType("application/json").content(r[0].equals(propose) ? ok : go);
            conforms(r[0], req, 401, "unauthenticated");
            var req2 = r[1].equals("GET") ? get(path) : post(path).header("Idempotency-Key", IDEM).contentType("application/json").content(r[0].equals(propose) ? ok : go);
            conforms(r[0], req2.with(pwdOnly), 403, "mfa_required");
        }
        account("manufacturer", "own-org");
        conforms(list, get(list).with(token("admin")), 403, "no_effective_role");
        conforms(propose, post(propose).with(token("admin")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 403, "no_effective_role");
        conforms(decide, post(decidePath).with(token("admin")).header("Idempotency-Key", IDEM).contentType("application/json").content(go), 403, "no_effective_role");
        when(identity.activeAccount(any())).thenReturn(Optional.empty());
        conforms(list, get(list).with(token("admin")), 403, "no_active_account");
        conforms(propose, post(propose).with(token("admin")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 403, "no_active_account");
        conforms(decide, post(decidePath).with(token("admin")).header("Idempotency-Key", IDEM).contentType("application/json").content(go), 403, "no_active_account");
        account("admin", "all");
        when(feeRulesRepo.rolesHolding("fee_rule_manage")).thenThrow(new DataAccessResourceFailureException("down"));
        conforms(list, get(list).with(token("admin")), 503, "service_unavailable");
        conforms(propose, post(propose).with(token("admin")).header("Idempotency-Key", "0123456789abcdef0123457").contentType("application/json").content(ok), 503, "service_unavailable");
        conforms(decide, post(decidePath).with(token("admin")).header("Idempotency-Key", "0123456789abcdef0123457").contentType("application/json").content(go), 503, "service_unavailable");
    }

    @Test
    void resubmitApplicationOperationsDocumentedPairs() throws Exception {
        String r = "/api/model-applications/{id}/resubmit";
        String path = "/api/model-applications/" + NOVA_APP + "/resubmit";
        String ok = "{\"version\":5,\"note\":\"Corrected the laboratory name.\"}";
        var pwdOnly = jwt().jwt(j -> j.subject(USER.toString()).claim("amr", List.of("pwd")).claim("realm_access", Map.of("roles", List.of("manufacturer"))));
        var done = new gov.bee.api.rework.ResubmitApplicationRepository.Result(gov.bee.api.rework.ResubmitApplicationRepository.Outcome.RESUBMITTED, 6, Instant.parse("2026-10-04T10:00:00Z"));
        var openIame = new gov.bee.api.rework.ResubmitApplicationRepository.OpenReturn(UUID.randomUUID(), "iame_scrutiny", new BigDecimal("4.50"), "LAB", TESTED_ON, 1);

        account("manufacturer", "own-org");
        when(applications.findOwned(NOVA_APP, NOVA)).thenReturn(Optional.of(returnedRow(5)));
        when(brandAuth.brandOwnedBy(NOVA_COOL, NOVA)).thenReturn(Optional.of(novaCoolBrand()));
        when(masters.category(any(), any())).thenReturn(Optional.of(new Masters.Category(feeVersion(), "RAC", "Room AC")));
        when(masters.standard(any(), any(), any())).thenReturn(Optional.of(new Masters.Standard(feeVersion(), "RAC", "performance_test", "IS 1391", "t", "1")));
        when(masters.labAccreditation(any(), any(), any())).thenReturn(Optional.of(activeLab()));
        when(applications.laboratoryExists("LAB")).thenReturn(true);
        when(documentRepo.findByApplicationAndKind(NOVA_APP, "test_report")).thenReturn(Optional.of(reportDoc()));
        when(documentRepo.listVersions(DOC_ID)).thenReturn(List.of(reportVersion()));
        when(idempotency.find(any(), any(), any(), any(), any())).thenReturn(Optional.empty());
        when(idempotency.begin(any(), any(), any(), any(), any(), any())).thenReturn(true);
        when(resubmitRepo.openReturn(NOVA_APP)).thenReturn(Optional.of(openIame));
        when(resubmitRepo.ratingInputsChanged(any(), any())).thenReturn(false);
        when(resubmitRepo.resubmit(any(), anyInt(), any(), any(), any(), any(), anyBoolean(), any())).thenReturn(done);

        // Back to the stage that returned it; and through rating again when a rating input changed after the rating existed.
        var back = conforms(r, post(path).with(token("manufacturer")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 200, null);
        assertTrue(back.getContentAsString().contains("\"toState\":\"iame_scrutiny\"") && back.getContentAsString().contains("\"ratingSuperseded\":false"), back.getContentAsString());
        conforms(r, post(path).with(token("manufacturer")).header("Idempotency-Key", IDEM).contentType("application/json").content("{\"version\":5}"), 200, null);
        when(resubmitRepo.openReturn(NOVA_APP)).thenReturn(Optional.of(new gov.bee.api.rework.ResubmitApplicationRepository.OpenReturn(UUID.randomUUID(), "director_review", new BigDecimal("4.50"), "LAB", TESTED_ON, 1)));
        var unchanged = conforms(r, post(path).with(token("manufacturer")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 200, null);
        assertTrue(unchanged.getContentAsString().contains("\"toState\":\"director_review\"") && unchanged.getContentAsString().contains("\"ratingSuperseded\":false"), unchanged.getContentAsString());
        when(resubmitRepo.ratingInputsChanged(any(), any())).thenReturn(true);
        var superseded = conforms(r, post(path).with(token("manufacturer")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 200, null);
        assertTrue(superseded.getContentAsString().contains("\"toState\":\"rating\"") && superseded.getContentAsString().contains("\"ratingSuperseded\":true"), superseded.getContentAsString());
        when(resubmitRepo.openReturn(NOVA_APP)).thenReturn(Optional.of(new gov.bee.api.rework.ResubmitApplicationRepository.OpenReturn(UUID.randomUUID(), "bee_scrutiny", new BigDecimal("4.50"), "LAB", TESTED_ON, 1)));
        var early = conforms(r, post(path).with(token("manufacturer")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 200, null);
        assertTrue(early.getContentAsString().contains("\"toState\":\"bee_scrutiny\"") && early.getContentAsString().contains("\"ratingSuperseded\":false"), "before the rating exists nothing is superseded: " + early.getContentAsString());
        when(resubmitRepo.openReturn(NOVA_APP)).thenReturn(Optional.of(openIame));

        // Request shape.
        conforms(r, post(path).with(token("manufacturer")).contentType("application/json").content(ok), 422, "idempotency_key_required");
        conforms(r, post(path).with(token("manufacturer")).header("Idempotency-Key", IDEM).contentType("application/json").content("{}"), 422, "validation_failed");
        conforms(r, post(path).with(token("manufacturer")).header("Idempotency-Key", IDEM).contentType("application/json").content("{\"version\":5,\"note\":5}"), 422, "validation_failed");
        conforms(r, post(path).with(token("manufacturer")).header("Idempotency-Key", IDEM).contentType("application/json").content("{\"version\":5,\"note\":\"   \"}"), 422, "validation_failed");
        conforms(r, post(path).with(token("manufacturer")).header("Idempotency-Key", IDEM).contentType("application/json").content("{\"version\":5,\"note\":\"" + "x".repeat(501) + "\"}"), 422, "validation_failed");

        // Only a returned application, only by its filer, at the version they saw.
        when(applications.findOwned(NOVA_APP, NOVA)).thenReturn(Optional.of(draftRow(NOVA_APP, "NC-RAC-18F", 5)));
        conforms(r, post(path).with(token("manufacturer")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 403, "not_returned");
        when(applications.findOwned(NOVA_APP, NOVA)).thenReturn(Optional.empty());
        conforms(r, post(path).with(token("manufacturer")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 404, "not_found");
        when(applications.findOwned(NOVA_APP, NOVA)).thenReturn(Optional.of(returnedRow(5)));
        conforms(r, post(path).with(token("manufacturer")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok.replace("\"version\":5", "\"version\":4")), 409, "version_conflict");
        when(resubmitRepo.resubmit(any(), anyInt(), any(), any(), any(), any(), anyBoolean(), any())).thenReturn(
            new gov.bee.api.rework.ResubmitApplicationRepository.Result(gov.bee.api.rework.ResubmitApplicationRepository.Outcome.STALE, 0, null));
        conforms(r, post(path).with(token("manufacturer")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 409, "version_conflict");
        when(resubmitRepo.resubmit(any(), anyInt(), any(), any(), any(), any(), anyBoolean(), any())).thenReturn(done);
        when(idempotency.find(any(), any(), any(), any(), any())).thenReturn(Optional.of(new IdempotencyRepository.Stored(true, 200, "{}", 0)));
        conforms(r, post(path).with(token("manufacturer")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 409, "idempotency_in_progress");
        when(idempotency.find(any(), any(), any(), any(), any())).thenReturn(Optional.of(new IdempotencyRepository.Stored(false, 200, "{}", 1)));
        when(idempotency.bodyHash(any(), any(), any(), any(), any())).thenReturn(Optional.of(new byte[] {9}));
        conforms(r, post(path).with(token("manufacturer")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 409, "idempotency_key_conflict");
        String stored = "{\"applicationId\":\"" + NOVA_APP + "\",\"reference\":\"LOCAL-MA-0002\",\"fromState\":\"returned\",\"toState\":\"iame_scrutiny\",\"version\":6,"
            + "\"ratingSuperseded\":false,\"resubmittedAt\":\"2026-10-04T10:00:00Z\"}";
        when(idempotency.find(any(), any(), any(), any(), any())).thenReturn(Optional.of(new IdempotencyRepository.Stored(false, 200, stored, 6)));
        when(idempotency.bodyHash(any(), any(), any(), any(), any())).thenReturn(Optional.of(gov.bee.api.application.DraftRequestSupport.bodyHash(new com.fasterxml.jackson.databind.ObjectMapper().readTree(ok))));
        var replay = conforms(r, post(path).with(token("manufacturer")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 200, null);
        assertEquals("true", replay.getHeader("Idempotency-Replayed"));
        when(idempotency.find(any(), any(), any(), any(), any())).thenReturn(Optional.empty());

        // The brand must still be the filer's, and the same evidence gates as the first submit apply to the edited application.
        when(brandAuth.brandOwnedBy(NOVA_COOL, NOVA)).thenReturn(Optional.empty());
        conforms(r, post(path).with(token("manufacturer")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 403, "brand_not_permitted");
        when(brandAuth.brandOwnedBy(NOVA_COOL, NOVA)).thenReturn(Optional.of(novaCoolBrand()));
        when(documentRepo.findByApplicationAndKind(NOVA_APP, "test_report")).thenReturn(Optional.empty());
        conforms(r, post(path).with(token("manufacturer")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 422, "test_report_required");
        when(documentRepo.findByApplicationAndKind(NOVA_APP, "test_report")).thenReturn(Optional.of(reportDoc()));
        var incomplete = returnedRow(5);
        when(applications.findOwned(NOVA_APP, NOVA)).thenReturn(Optional.of(new ModelApplicationRepository.Row(incomplete.id(), incomplete.reference(), incomplete.organisationId(), incomplete.organisationCode(),
            incomplete.brandName(), incomplete.category(), incomplete.modelNumber(), "returned", 5, Set.of(), NOVA, NOVA_COOL, "NOVA", "LAB", TESTED_ON, null)));
        conforms(r, post(path).with(token("manufacturer")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 422, "declared_efficiency_required");
        when(applications.findOwned(NOVA_APP, NOVA)).thenReturn(Optional.of(new ModelApplicationRepository.Row(incomplete.id(), incomplete.reference(), incomplete.organisationId(), incomplete.organisationCode(),
            incomplete.brandName(), incomplete.category(), incomplete.modelNumber(), "returned", 5, Set.of(), NOVA, NOVA_COOL, "NOVA", "LAB", null, new BigDecimal("4.50"))));
        conforms(r, post(path).with(token("manufacturer")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 422, "test_date_invalid");
        when(applications.findOwned(NOVA_APP, NOVA)).thenReturn(Optional.of(returnedRow(5)));
        when(masters.labAccreditation(any(), any(), any())).thenReturn(Optional.empty());
        conforms(r, post(path).with(token("manufacturer")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 422, "laboratory_not_accredited");
        when(masters.labAccreditation(any(), any(), any())).thenReturn(Optional.of(activeLab()));
        when(masters.standard(any(), any(), eq(TESTED_ON))).thenReturn(Optional.empty());
        conforms(r, post(path).with(token("manufacturer")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 422, "standard_not_available");
        when(masters.standard(any(), any(), any())).thenReturn(Optional.of(standardV2()));
        when(applications.modelNumberTaken(any(), any(), any())).thenReturn(true);
        conforms(r, post(path).with(token("manufacturer")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 409, "duplicate_model");
        when(applications.modelNumberTaken(any(), any(), any())).thenReturn(false);

        // Who: only a filer.
        account("auditor", "all");
        conforms(r, post(path).with(token("auditor")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 403, "no_write_scope");
        account("manufacturer", "own-org");

        // Identity denials and outage.
        conforms(r, post(path).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 401, "unauthenticated");
        conforms(r, post(path).with(pwdOnly).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 403, "mfa_required");
        account("finance", "all");
        conforms(r, post(path).with(token("manufacturer")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 403, "no_effective_role");
        when(identity.activeAccount(any())).thenReturn(Optional.empty());
        conforms(r, post(path).with(token("manufacturer")).header("Idempotency-Key", IDEM).contentType("application/json").content(ok), 403, "no_active_account");
        account("manufacturer", "own-org");
        when(applications.findOwned(NOVA_APP, NOVA)).thenReturn(Optional.of(returnedRow(5)));
        doThrow(new DataAccessResourceFailureException("down")).when(resubmitRepo).openReturn(any());
        conforms(r, post(path).with(token("manufacturer")).header("Idempotency-Key", "0123456789abcdef0123457").contentType("application/json").content(ok), 503, "service_unavailable");
    }

    @Test
    void applicationHistoryOperationsDocumentedPairs() throws Exception {
        String r = "/api/model-applications/{id}/history";
        String path = "/api/model-applications/" + NOVA_APP + "/history";
        var pwdOnly = jwt().jwt(j -> j.subject(USER.toString()).claim("amr", List.of("pwd")).claim("realm_access", Map.of("roles", List.of("reviewer"))));
        String iameNote = "Report matches the declared laboratory and date.";
        String returnReason = "The laboratory name on the report does not match.";
        var rows = List.of(
            hist("submit", "draft", "fee_due", "manufacturer", "Nova Applicant", "NOVA", null),
            hist("confirm_fee", "fee_due", "iame_scrutiny", "finance", "BEE Finance", "BEE", x -> { x[0] = "UTR-1234"; x[1] = new BigDecimal("24000.00"); x[2] = java.sql.Date.valueOf("2026-10-02"); return x; }),
            hist("iame_recommend", "iame_scrutiny", "bee_scrutiny", "iame", "IAME Officer", "IAME", x -> { x[3] = "verified"; x[4] = iameNote; return x; }),
            hist("reviewer_forward", "bee_scrutiny", "rating", "reviewer", "BEE Reviewer", "BEE", x -> { x[5] = "Checked against the IAME note."; return x; }),
            hist("compute_rating", "rating", "director_review", "programme", "BEE Programme", "BEE", x -> { x[6] = 1; x[7] = 4; x[8] = new BigDecimal("4.50"); x[9] = new BigDecimal("4.62"); x[10] = "RAC-ISEER-DEMO-1"; return x; }),
            hist("director_recommend", "director_review", "secretary_approval", "director", "BEE Director", "BEE", x -> { x[11] = "Recommend approval."; x[12] = false; return x; }),
            hist("return", "secretary_approval", "returned", "secretary", "BEE Secretary", "BEE", x -> { x[14] = returnReason; return x; }),
            hist("resubmit", "returned", "secretary_approval", "manufacturer", "Nova Applicant", "NOVA", x -> { x[15] = "Corrected the laboratory."; x[16] = false; return x; }),
            hist("secretary_approve", "secretary_approval", "approved", "secretary", "BEE Secretary", "BEE", x -> { x[13] = "Approved."; return x; }));
        when(historyRepo.events(NOVA_APP)).thenReturn(rows);

        // An officer who can read the application sees every step, every note and finding, and who took it.
        account("iame", "assigned");
        when(applications.find(org.mockito.ArgumentMatchers.eq(NOVA_APP), any(), any())).thenReturn(Optional.of(
            new ModelApplicationRepository.Row(NOVA_APP, "LOCAL-MA-0002", NOVA, "NOVA", "Nova Cool", "RAC", "NC-RAC-18F", "iame_scrutiny", 3, Set.of("iame_scrutiny"), null, null, null)));
        when(identity.activeMembershipOrganisationIds(USER)).thenReturn(Set.of(UUID.fromString("00000000-0000-4000-b000-0000000000aa")));
        var officer = conforms(r, get(path).with(token("iame")), 200, null).getContentAsString();
        assertTrue(officer.contains("\"viewedAs\":\"officer\"") && officer.contains("\"count\":9") && officer.contains("\"actorName\":\"BEE Director\""), officer);
        assertTrue(officer.contains(iameNote) && officer.contains("Checked against the IAME note.") && officer.contains("Recommend approval.") && officer.contains(returnReason), "an officer sees the notes");
        assertTrue(officer.contains("\"Receipt reference\"") && officer.contains("UTR-1234") && officer.contains("local demonstration, not a BEE rating"), "and the facts, with the rating labelled");
        assertTrue(officer.indexOf("\"sequence\":1,") < officer.indexOf("\"sequence\":9,") && officer.contains("\"withheld\":false") && !officer.contains("\"withheld\":true"), "in order, nothing withheld");

        // The applicant sees the whole timeline but only the notes addressed to them, and no personal names.
        account("manufacturer", "own-org");
        when(applications.find(org.mockito.ArgumentMatchers.eq(NOVA_APP), any(), any())).thenReturn(Optional.of(
            new ModelApplicationRepository.Row(NOVA_APP, "LOCAL-MA-0002", NOVA, "NOVA", "Nova Cool", "RAC", "NC-RAC-18F", "approved", 8, Set.of(), null, null, null)));
        var applicant = conforms(r, get(path).with(token("manufacturer")), 200, null).getContentAsString();
        assertTrue(applicant.contains("\"viewedAs\":\"applicant\"") && applicant.contains("\"count\":9") && !applicant.contains("actorName"), "no personal names: " + applicant);
        assertTrue(!applicant.contains(iameNote) && !applicant.contains("Checked against the IAME note.") && !applicant.contains("Recommend approval.") && !applicant.contains("Approved.")
            && !applicant.contains("RAC-ISEER-DEMO-1") && !applicant.contains("Verified efficiency") && !applicant.contains("\"Finding on the test report\""), "the officers' internal notes, findings and rating figures are withheld");
        assertTrue(applicant.contains(returnReason) && applicant.contains("Corrected the laboratory.") && applicant.contains("UTR-1234"), "the reason they were given, their own resubmission note and their payment are shown");
        assertEquals(5, applicant.split("\"withheld\":true", -1).length - 1, "the five internal steps say they are withheld");

        // Who may read it is who may read the application, with the same refusals.
        account("auditor", "all");
        conforms(r, get(path).with(token("auditor")), 403, "no_read_scope");
        account("iame", "assigned");
        when(applications.find(org.mockito.ArgumentMatchers.eq(NOVA_APP), any(), any())).thenReturn(Optional.empty());
        conforms(r, get(path).with(token("iame")), 404, "not_found");
        conforms(r, get("/api/model-applications/not-a-uuid/history").with(token("iame")), 404, "not_found");
        account("iame", "assigned");
        when(applications.find(org.mockito.ArgumentMatchers.eq(NOVA_APP), any(), any())).thenReturn(Optional.of(
            new ModelApplicationRepository.Row(NOVA_APP, "LOCAL-MA-0002", NOVA, "NOVA", "Nova Cool", "RAC", "NC-RAC-18F", "iame_scrutiny", 3, Set.<String>of(), null, null, null)));
        conforms(r, get(path).with(token("iame")), 404, "not_found");   // not assigned: indistinguishable from an unknown application

        // Identity denials and outage.
        conforms(r, get(path), 401, "unauthenticated");
        conforms(r, get(path).with(pwdOnly), 403, "mfa_required");
        account("manufacturer", "own-org");
        conforms(r, get(path).with(token("reviewer")), 403, "no_effective_role");
        when(identity.activeAccount(any())).thenReturn(Optional.empty());
        conforms(r, get(path).with(token("manufacturer")), 403, "no_active_account");
        account("manufacturer", "own-org");
        doThrow(new DataAccessResourceFailureException("down")).when(historyRepo).events(any());
        conforms(r, get(path).with(token("manufacturer")), 503, "service_unavailable");
    }

    @Test
    void artifactIsPinned() throws Exception {
        JsonNode pin = ContractSchema.read(ContractSchema.PIN);
        assertEquals(pin.path("version").asText(), doc.path("info").path("version").asText(), "artifact version differs from the pin");
        String sha = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(Files.readAllBytes(ContractSchema.ARTIFACT)));
        assertEquals(pin.path("sha256").asText(), sha, "artifact content changed without a version bump and a new pin (scripts/local/contract-pin.json)");
    }
}
