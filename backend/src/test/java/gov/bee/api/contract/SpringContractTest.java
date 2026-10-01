package gov.bee.api.contract;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import com.fasterxml.jackson.databind.JsonNode;
import gov.bee.api.application.ModelApplicationRepository;
import gov.bee.api.identity.IdentityRepository;
import java.nio.charset.StandardCharsets;
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
    + "org.springframework.boot.autoconfigure.flyway.FlywayAutoConfiguration", "bee.log.dir=target/logs"})
@AutoConfigureMockMvc
class SpringContractTest {

    static final UUID USER = UUID.fromString("00000000-0000-4000-a000-000000000001");
    static final UUID NOVA = UUID.fromString("00000000-0000-4000-b000-000000000001");
    static final UUID NOVA_APP = UUID.fromString("00000000-0000-4000-c000-000000000002");
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
            for (Iterator<Map.Entry<String, JsonNode>> st = p.getValue().path("get").path("responses").fields(); st.hasNext(); ) {
                var s = st.next();
                JsonNode codes = s.getValue().path("x-error-codes");
                if (codes.isMissingNode()) pairs.add("GET " + p.getKey() + " " + s.getKey() + " -");
                else codes.forEach(c -> pairs.add("GET " + p.getKey() + " " + s.getKey() + " " + c.asText()));
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
        var row = new ModelApplicationRepository.Row(NOVA_APP, "LOCAL-MA-0002", NOVA, "NOVA", "Nova Cool", "RAC", "NC-RAC-18F", "fee_due", 3, Set.of());
        when(applications.list(any(), any())).thenReturn(List.of(row));
        when(applications.find(any(), any(), any())).thenReturn(Optional.empty());
        when(applications.find(org.mockito.ArgumentMatchers.eq(NOVA_APP), any(), any())).thenReturn(Optional.of(row));
    }

    /** Performs the request and checks the response against the artifact; returns it for further checks. */
    MockHttpServletResponse conforms(String route, MockHttpServletRequestBuilder request, int status, String code) throws Exception {
        String cid = "spring-contract-" + RUN + "-" + SEQ.incrementAndGet();
        MockHttpServletResponse res = mvc.perform(request.header("X-Correlation-Id", cid)).andReturn().getResponse();
        String where = route + " " + status + " " + code;
        assertEquals(status, res.getStatus(), where);
        JsonNode spec = route.equals("default-deny") ? null : doc.path("paths").path(route).path("get").path("responses").path(String.valueOf(status));
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
        COVERED.add((route.equals("default-deny") ? "default-deny" : "GET " + route) + " " + status + " " + (code == null ? "-" : code));
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
        for (MockHttpServletRequestBuilder b : List.of(post(LIST), delete(path(DETAIL)), get(path(DETAIL) + "/history"), post(ME), get("/actuator/env"))) {
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
        ids[2] = conforms("default-deny", post(LIST).with(token("manufacturer")).contentType("application/json").content("{\"password\":\"" + PLANTED + "\"}"), 403, "denied_by_default").getHeader("X-Correlation-Id");
        ids[3] = conforms(ME, get(ME).with(token("manufacturer")), 200, null).getHeader("X-Correlation-Id");
        String log = Files.readString(file);
        assertFalse(log.contains(PLANTED), "planted value in api-requests.jsonl");
        assertFalse(log.contains("nova.applicant") || log.contains("Nova Applicant"), "personal data in api-requests.jsonl");
        String[][] want = {{"/api/model-applications/{id}", "404", "not_found"}, {"/api/model-applications", "401", "unauthenticated"}, {"/api/model-applications", "403", "denied_by_default"}, {"/api/me", "200", "ok"}};
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

    @Test
    void artifactIsPinned() throws Exception {
        JsonNode pin = ContractSchema.read(ContractSchema.PIN);
        assertEquals(pin.path("version").asText(), doc.path("info").path("version").asText(), "artifact version differs from the pin");
        String sha = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(Files.readAllBytes(ContractSchema.ARTIFACT)));
        assertEquals(pin.path("sha256").asText(), sha, "artifact content changed without a version bump and a new pin (scripts/local/contract-pin.json)");
    }
}
