package gov.bee.api.demo.mis;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import gov.bee.api.demo.DemoResult;
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
 * The MIS demonstration module against throwaway PostgreSQL with the real migrations, the shared seed and the S5 synthetic history, read as
 * the restricted runtime login: figures equal direct SQL, a second call on unchanged data gives the same data version, other demo areas'
 * tables are reported as not available yet, and roles are enforced. The shared app schema is untouched.
 */
@Tag("db")
class MisModuleDatabaseTest {

    static final String TAG = HexFormat.of().toHexDigits(ThreadLocalRandom.current().nextInt());
    static final String MAIN = "s5mis_test_" + TAG;
    static JdbcTemplate admin;
    static JdbcTemplate owner;
    static MisModule module;

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
        admin.execute("DROP SCHEMA IF EXISTS " + MAIN + " CASCADE");
        admin.execute("CREATE SCHEMA " + MAIN);
        Flyway.configure().dataSource(migrateSource(MAIN)).schemas(MAIN).defaultSchema(MAIN).createSchemas(false)
            .locations("classpath:db/migration").load().migrate();
        owner = new JdbcTemplate(migrateSource(MAIN));
        owner.execute(Files.readString(Path.of("..", "local", "seed", "seed.sql")));
        String synthetic = Files.readString(Path.of("..", "local", "seed", "demo", "s5_mis.sql"));
        owner.execute(synthetic);
        owner.execute(synthetic); // idempotent: the second run changes nothing
        var runtime = new JdbcTemplate(sourceAs(MAIN, env("BEE_RUNTIME_DB_USER", "bee_runtime"), env("BEE_RUNTIME_DB_PASSWORD", "bee-local-runtime")));
        module = new MisModule(new MisRepository(runtime));
    }

    @AfterAll
    static void drop() {
        if (admin != null) {
            admin.execute("DROP SCHEMA IF EXISTS " + MAIN + " CASCADE");
        }
    }

    static Caller as(String... roles) {
        return new Caller(UUID.randomUUID(), "t", java.util.Arrays.stream(roles).map(r -> new RoleGrant(r, "all")).toList(), Set.of());
    }

    static DemoResult get(Caller c, String id, Map<String, String> q) {
        return module.handle(c, "GET", id, null, q, Map.of());
    }

    @SuppressWarnings("unchecked")
    static Object card(Map<String, Object> body, String key) {
        return ((List<Map<String, Object>>) body.get("cards")).stream().filter(c -> key.equals(c.get("key"))).findFirst().orElseThrow().get("value");
    }

    @Test
    void summaryFiguresEqualDirectSql() {
        DemoResult r = get(as("officer"), "summary", Map.of());
        assertNull(r.code());
        long submitted = owner.queryForObject("SELECT count(*) FROM model_application_submission_event", Long.class);
        long approved = owner.queryForObject("SELECT count(*) FROM model_application WHERE state = 'approved'", Long.class);
        long certs = owner.queryForObject("SELECT count(*) FROM certificate", Long.class);
        assertTrue(submitted >= 40L, "the synthetic history has at least the original 40 applications");
        assertEquals(submitted, ((Number) card(r.body(), "submitted")).longValue());
        assertEquals(approved, ((Number) card(r.body(), "approved")).longValue());
        assertEquals(certs, ((Number) card(r.body(), "certificates")).longValue());
        assertTrue(approved > 10, "the synthetic history approves most older applications");
        assertNotNull(card(r.body(), "avgDays"));
        assertNotNull(r.body().get("asOf"));
        assertTrue(((List<?>) r.body().get("sources")).contains("model_application"));
        long fees = owner.queryForObject("SELECT (SELECT coalesce(sum(amount_inr),0) FROM model_application_fee_confirmation) "
            + "+ (SELECT coalesce(sum(amount_inr),0) FROM registration_fee_confirmation)", Long.class);
        assertEquals(fees, ((Number) card(r.body(), "fees")).longValue());
    }

    @Test
    void sameDataGivesSameDataVersion() {
        String a = (String) get(as("auditor"), "applications", Map.of()).body().get("dataVersion");
        String b = (String) get(as("auditor"), "applications", Map.of()).body().get("dataVersion");
        assertEquals(a, b);
        assertEquals(12, a.length());
    }

    @Test
    @SuppressWarnings("unchecked")
    void applicationsPanelHasMonthlyShapeAndAgeing() {
        Map<String, Object> body = get(as("programme"), "applications", Map.of()).body();
        List<Map<String, Object>> tables = (List<Map<String, Object>>) body.get("tables");
        Map<String, Object> monthly = tables.stream().filter(t -> "monthly".equals(t.get("key"))).findFirst().orElseThrow();
        assertEquals(12, ((List<?>) monthly.get("rows")).size());
        long total = ((List<List<Object>>) monthly.get("rows")).stream().mapToLong(row -> ((Number) row.get(1)).longValue()).sum();
        assertTrue(total >= 36, "most synthetic submissions fall inside the default twelve months");
        assertTrue(tables.stream().anyMatch(t -> "ageing".equals(t.get("key")) && !((List<?>) t.get("rows")).isEmpty()));
    }

    @Test
    @SuppressWarnings("unchecked")
    void tablesOfOtherDemoAreasDegradeToNotAvailable() {
        Map<String, Object> prod = get(as("director"), "production", Map.of()).body();
        boolean landed = owner.queryForObject("SELECT to_regclass('production_submission') IS NOT NULL", Boolean.class);
        if (!landed) {
            assertEquals(1, ((List<?>) prod.get("unavailable")).size());
        }
        Map<String, Object> cert = get(as("director"), "certificates", Map.of()).body();
        assertNotNull(cert.get("tables"));
    }

    @Test
    void rolesAndMethodsAreEnforced() {
        assertEquals("role_not_permitted", get(as("manufacturer"), "summary", Map.of()).code());
        assertEquals("role_not_permitted", get(as("finance"), "summary", Map.of()).code());
        assertEquals("role_not_permitted", get(as("finance"), "export", Map.of("panel", "applications")).code());
        assertNull(get(as("finance"), "finance", Map.of()).code());
        assertNull(get(as("finance"), "export", Map.of("panel", "finance")).code());
        assertEquals("validation_failed", module.handle(as("admin"), "POST", "summary", null, Map.of(), Map.of()).code());
        assertEquals("not_found", get(as("admin"), "nothing", Map.of()).code());
        assertEquals("validation_failed", get(as("admin"), "summary", Map.of("from", "2026-13-40")).code());
        assertEquals("validation_failed", get(as("admin"), "summary", Map.of("from", "2026-05-01", "to", "2026-01-01")).code());
    }

    @Test
    void exportReturnsCsvText() {
        DemoResult r = get(as("admin"), "export", Map.of("panel", "finance"));
        String csv = (String) r.body().get("csv");
        assertTrue(csv.startsWith("# Local demonstration MIS panel: finance"));
        assertTrue(csv.contains("Fees confirmed per month"));
        assertEquals("validation_failed", get(as("admin"), "export", Map.of("panel", "nope")).code());
    }
}
