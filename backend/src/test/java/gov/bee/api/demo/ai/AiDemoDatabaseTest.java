package gov.bee.api.demo.ai;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import gov.bee.api.demo.DemoResult;
import gov.bee.api.document.DocumentProperties;
import gov.bee.api.document.LocalSha256FileStore;
import gov.bee.api.identity.Caller;
import gov.bee.api.identity.IdentityRepository.RoleGrant;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ThreadLocalRandom;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

/**
 * The AI demonstration against throwaway PostgreSQL (demo S6): dispositions persist, override and reject need a reason, nothing writes to
 * the application tables, other roles are denied, and a run is deterministic for fixed data.
 */
@Tag("db")
class AiDemoDatabaseTest {

    static final String TAG = HexFormat.of().toHexDigits(ThreadLocalRandom.current().nextInt());
    static final String MAIN = "demo_s6_test_" + TAG;
    static final Path SEED = Path.of("..", "local", "seed", "seed.sql");
    static final Path S6_SEED = Path.of("..", "local", "seed", "demo", "s6_ai.sql");

    static UUID account(int n) {
        return UUID.fromString(String.format("00000000-0000-4000-a000-%012d", n));
    }

    static final UUID NOVA = account(1);
    static final UUID REVIEWER = account(5);
    static final UUID PROGRAMME = account(6);
    static final UUID DIRECTOR = account(7);
    static final UUID HELPDESK = account(10);
    static final UUID AUDITOR = account(11);

    static JdbcTemplate admin;
    static JdbcTemplate owner;
    static JdbcTemplate db;
    static AiDemoModule module;
    static int appCountBefore;

    static String env(String k, String d) {
        String v = System.getenv(k);
        return v == null || v.isBlank() ? d : v;
    }

    static DriverManagerDataSource sourceAs(String schema, String user, String password) {
        String url = "jdbc:postgresql://127.0.0.1:" + env("BEE_PG_PORT", "5434") + "/" + env("BEE_APP_DB", "bee_app")
            + (schema == null ? "" : "?currentSchema=" + schema);
        return new DriverManagerDataSource(url, user, password);
    }

    static DriverManagerDataSource migrateSource(String schema) {
        return sourceAs(schema, env("BEE_FLYWAY_DB_USER", "bee_app"), env("BEE_FLYWAY_DB_PASSWORD", env("BEE_APP_DB_PASSWORD", "bee-local-app")));
    }

    @BeforeAll
    static void migrateAndSeed() throws Exception {
        admin = new JdbcTemplate(migrateSource(null));
        appCountBefore = admin.queryForObject("SELECT count(*) FROM app.model_application", Integer.class);
        admin.execute("DROP SCHEMA IF EXISTS " + MAIN + " CASCADE");
        admin.execute("CREATE SCHEMA " + MAIN);
        Flyway.configure().dataSource(migrateSource(MAIN)).schemas(MAIN).defaultSchema(MAIN).createSchemas(false)
            .locations("classpath:db/migration").load().migrate();
        owner = new JdbcTemplate(migrateSource(MAIN));
        owner.execute(Files.readString(SEED));
        owner.execute(Files.readString(S6_SEED));
        owner.execute(Files.readString(S6_SEED)); // idempotent
        db = new JdbcTemplate(sourceAs(MAIN, env("BEE_RUNTIME_DB_USER", "bee_runtime"), env("BEE_RUNTIME_DB_PASSWORD", "bee-local-runtime")));
        DocumentProperties props = new DocumentProperties();
        props.setStorePath(Files.createTempDirectory("s6-docs").toString());
        AiStore store = new AiStore(db);
        module = new AiDemoModule(store, new AiEngines(db, new LocalSha256FileStore(props)));
    }

    @AfterAll
    static void drop() {
        if (admin != null) {
            admin.execute("DROP SCHEMA IF EXISTS " + MAIN + " CASCADE");
            assertEquals(appCountBefore, admin.queryForObject("SELECT count(*) FROM app.model_application", Integer.class));
        }
    }

    static Caller as(UUID id, String role) {
        return new Caller(id, role, List.of(new RoleGrant(role, "all")), Set.of());
    }

    static final Caller PROG = as(PROGRAMME, "programme");

    static DemoResult post(Caller c, String id, String action, Map<String, Object> body) {
        return module.handle(c, "POST", id, action, Map.of(), body);
    }

    static DemoResult get(Caller c, String id, String action) {
        return module.handle(c, "GET", id, action, Map.of(), Map.of());
    }

    @SuppressWarnings("unchecked")
    static Map<String, Object> ok(DemoResult r) {
        assertEquals(null, r.code(), () -> "unexpected error " + r.code() + " " + r.detail());
        return r.body();
    }

    static String runId(DemoResult r) {
        return (String) ok(r).get("id");
    }

    @Test
    void fiveModelsAreRegisteredWithHonestCards() {
        var models = (List<Map<String, Object>>) ok(get(PROG, "models", null)).get("models");
        assertEquals(5, models.size());
        assertTrue(models.stream().anyMatch(m -> ((String) m.get("description")).contains("not machine learning")));
        assertEquals(20, owner.queryForObject("SELECT count(*) FROM ai_kb", Integer.class));
    }

    @Test
    void dispositionsPersistReasonRulesAndTheModelOutputNeverChanges() {
        var created = ok(post(PROG, "helpdesk-assist", "runs", Map.of("question", "How do I pay the application fee?")));
        String id = (String) created.get("id");
        Object output = created.get("output");
        assertEquals("fees", ((Map<?, ?>) output).get("suggestedCategory"));

        assertEquals("validation_failed", post(as(HELPDESK, "helpdesk"), id, "disposition", Map.of("decision", "override", "overrideValue", "my reply")).code());
        assertEquals("validation_failed", post(as(HELPDESK, "helpdesk"), id, "disposition", Map.of("decision", "reject", "reason", "  ")).code());
        assertEquals("validation_failed", post(as(HELPDESK, "helpdesk"), id, "disposition", Map.of("decision", "override", "reason", "wrong tone")).code());
        assertEquals("validation_failed", post(as(HELPDESK, "helpdesk"), id, "disposition", Map.of("decision", "maybe")).code());
        assertEquals(0, owner.queryForObject("SELECT count(*) FROM ai_disposition WHERE run_id = ?::uuid", Integer.class, id));

        ok(post(as(HELPDESK, "helpdesk"), id, "disposition", Map.of("decision", "override", "reason", "wrong tone", "overrideValue", "Please pay at the gateway.")));
        ok(post(as(REVIEWER, "reviewer"), id, "disposition", Map.of("decision", "accept")));
        var detail = ok(get(as(AUDITOR, "auditor"), id, null));
        var dispositions = (List<Map<String, Object>>) detail.get("dispositions");
        assertEquals(2, dispositions.size());
        assertEquals("Please pay at the gateway.", dispositions.get(0).get("overrideValue"));
        assertEquals(output, detail.get("output"), "the model's output is unchanged beside the human's value");
        assertEquals(3, ((List<?>) detail.get("audit")).size(), "one run row and two dispositions");
        var listed = (List<Map<String, Object>>) ok(get(PROG, "helpdesk-assist", "runs")).get("runs");
        assertEquals(2, listed.stream().filter(r -> r.get("id").equals(id)).findFirst().orElseThrow().get("dispositionCount"));
    }

    @Test
    void theRuntimeLoginCannotChangeARunOrADisposition() {
        String id = runId(post(PROG, "production-anomaly", "runs", Map.of()));
        assertThrows(Exception.class, () -> db.update("UPDATE ai_run SET confidence = 0 WHERE id = ?::uuid", id));
        assertThrows(Exception.class, () -> db.update("DELETE FROM ai_run WHERE id = ?::uuid", id));
        ok(post(PROG, id, "disposition", Map.of("decision", "accept")));
        assertThrows(Exception.class, () -> db.update("UPDATE ai_disposition SET decision = 'reject' WHERE run_id = ?::uuid", id));
    }

    private static String snapshot() {
        return owner.queryForList("SELECT id, version, state FROM model_application ORDER BY id").toString()
            + owner.queryForObject("SELECT count(*) FROM certificate", Integer.class)
            + owner.queryForObject("SELECT count(*) FROM model_application_fee_snapshot", Integer.class)
            + owner.queryForObject("SELECT count(*) FROM model_application_fee_confirmation", Integer.class)
            + owner.queryForObject("SELECT count(*) FROM model_application_transition_event", Integer.class)
            + owner.queryForObject("SELECT count(*) FROM model_application_document_version", Integer.class);
    }

    @Test
    void noRunOrDispositionWritesToApplicationCertificateOrFeeRecords() {
        String before = snapshot();
        for (String[] c : new String[][] {{"compliance-risk", null}, {"production-anomaly", null}, {"rating-trends", null}}) {
            String id = runId(post(PROG, c[0], "runs", Map.of()));
            ok(post(PROG, id, "disposition", Map.of("decision", "reject", "reason", "not needed")));
        }
        String id = runId(post(PROG, "document-extraction", "runs", Map.of("applicationRef", "LOCAL-MA-0004")));
        ok(post(as(REVIEWER, "reviewer"), id, "disposition", Map.of("decision", "override", "reason", "checked by hand",
            "fieldDecisions", Map.of("efficiency", "confirmed", "laboratory", "confirmed"))));
        assertEquals(before, snapshot());
    }

    @Test
    void otherRolesAreDeniedAndTheAuditorOnlyReads() {
        for (String role : List.of("manufacturer", "agency", "finance", "iame")) {
            Caller c = as(NOVA, role);
            assertEquals("role_not_permitted", get(c, "models", null).code());
            assertEquals("role_not_permitted", get(c, "compliance-risk", "runs").code());
            assertEquals("role_not_permitted", post(c, "compliance-risk", "runs", Map.of()).code());
        }
        Caller helpdesk = as(HELPDESK, "helpdesk");
        assertEquals("role_not_permitted", post(helpdesk, "compliance-risk", "runs", Map.of()).code());
        assertEquals("role_not_permitted", get(helpdesk, "compliance-risk", "runs").code());
        Caller auditor = as(AUDITOR, "auditor");
        assertEquals("role_not_permitted", post(auditor, "rating-trends", "runs", Map.of()).code());
        String id = runId(post(PROG, "compliance-risk", "runs", Map.of()));
        ok(get(auditor, id, null));
        assertEquals("role_not_permitted", post(auditor, id, "disposition", Map.of("decision", "accept")).code());
        assertEquals("not_found", get(helpdesk, id, null).code(), "unreadable and unknown give the same answer");
        assertEquals("not_found", get(PROG, UUID.randomUUID().toString(), null).code());
        assertEquals("not_found", get(PROG, "no-such-case", "runs").code());
    }

    @Test
    void aRunIsDeterministicForFixedData() {
        for (String uc : List.of("compliance-risk", "production-anomaly", "rating-trends")) {
            var a = ok(post(PROG, uc, "runs", Map.of()));
            var b = ok(post(PROG, uc, "runs", Map.of()));
            assertNotEquals(a.get("id"), b.get("id"));
            assertEquals(a.get("output"), b.get("output"), uc);
            assertEquals(a.get("dataVersion"), b.get("dataVersion"), uc);
            assertEquals(a.get("confidence"), b.get("confidence"), uc);
            assertFalse(((List<?>) ((Map<?, ?>) a.get("output")).get("evidence")).isEmpty(), uc + " carries evidence");
        }
        var q = Map.<String, Object>of("question", "How do I get QR serials for my model?");
        assertEquals(ok(post(PROG, "helpdesk-assist", "runs", q)).get("output"), ok(post(PROG, "helpdesk-assist", "runs", q)).get("output"));
    }

    @Test
    void theAnomalyRunFlagsTheSyntheticSpikesAndSaysItIsSynthetic() {
        var out = (Map<String, Object>) ok(post(PROG, "production-anomaly", "runs", Map.of())).get("output");
        assertEquals(true, out.get("synthetic"));
        var series = (List<Map<String, Object>>) out.get("series");
        assertEquals("flagged", series.stream().filter(s -> ((String) s.get("series")).contains("NC-RAC-12D")).findFirst().orElseThrow().get("status"));
        assertEquals("flagged", series.stream().filter(s -> ((String) s.get("series")).contains("AU-RAC-15X")).findFirst().orElseThrow().get("status"));
        assertEquals("normal", series.stream().filter(s -> ((String) s.get("series")).contains("SE-RAC-20K")).findFirst().orElseThrow().get("status"));
    }

    @Test
    void complianceRiskRanksSyntheticEntitiesWithContributionsThatSumToTheScore() {
        var out = (Map<String, Object>) ok(post(PROG, "compliance-risk", "runs", Map.of())).get("output");
        var entities = (List<Map<String, Object>>) out.get("entities");
        assertTrue(((String) entities.get(0).get("key")).startsWith("SYN-"));
        assertTrue(((Number) entities.get(0).get("score")).doubleValue() >= ((Number) entities.get(1).get("score")).doubleValue());
        for (var e : entities) {
            double sum = ((List<Map<String, Object>>) e.get("features")).stream().mapToDouble(f -> ((Number) f.get("contribution")).doubleValue()).sum();
            assertEquals(((Number) e.get("score")).doubleValue(), sum, 0.11);
        }
    }

    @Test
    void helpdeskEscalatesWhenNotConfidentAndExtractionFlagsDifferences() {
        var vague = (Map<String, Object>) ok(post(PROG, "helpdesk-assist", "runs", Map.of("question", "banana purple elephant"))).get("output");
        assertEquals(true, vague.get("escalateToHuman"));
        var good = (Map<String, Object>) ok(post(PROG, "helpdesk-assist", "runs", Map.of("question", "How do I pay the application fee?"))).get("output");
        assertEquals(false, good.get("escalateToHuman"));
        assertEquals(3, ((List<?>) good.get("topAnswers")).size());
        assertEquals("validation_failed", post(PROG, "helpdesk-assist", "runs", Map.of("question", "x")).code());

        var ex = (Map<String, Object>) ok(post(PROG, "document-extraction", "runs", Map.of("applicationRef", "LOCAL-MA-0003"))).get("output");
        var fields = (List<Map<String, Object>>) ex.get("fields");
        assertEquals("3.95", fields.stream().filter(f -> f.get("field").equals("efficiency")).findFirst().orElseThrow().get("extracted"));
        assertTrue(((String) ex.get("textSource")).contains("seeded sample"));
        assertEquals("not_found", post(PROG, "document-extraction", "runs", Map.of("applicationRef", "NO-SUCH")).code());
    }
}
