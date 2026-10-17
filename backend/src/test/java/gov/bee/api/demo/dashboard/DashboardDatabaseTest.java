package gov.bee.api.demo.dashboard;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
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
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.transaction.support.TransactionTemplate;

/** The simulated email and SMS outbox (V66) against throwaway PostgreSQL with the real migrations: triggers, seeding switch, own-only reads. */
@Tag("db")
class DashboardDatabaseTest {

    static final String MAIN = "demo_dash_test_" + HexFormat.of().toHexDigits(ThreadLocalRandom.current().nextInt());
    static final UUID NOVA_ORG = UUID.fromString("00000000-0000-4000-b000-000000000001");
    static final UUID PIXEL_ORG = UUID.fromString("00000000-0000-4000-b000-000000000002");
    static final UUID BEE_ORG = UUID.fromString("00000000-0000-4000-b000-000000000003");
    static final String APP_A = "00000000-0000-4000-c000-000000000a01";
    static final Caller NOVA = new Caller(UUID.fromString("00000000-0000-4000-a000-000000000001"), "nova.applicant", List.of(new RoleGrant("manufacturer", "own-org")), Set.of(NOVA_ORG));
    static final Caller PIXEL = new Caller(UUID.fromString("00000000-0000-4000-a000-000000000002"), "pixel.applicant", List.of(new RoleGrant("agency", "own-org")), Set.of(PIXEL_ORG));
    static final Caller FINANCE = new Caller(UUID.fromString("00000000-0000-4000-a000-000000000003"), "bee.finance", List.of(new RoleGrant("finance", "all")), Set.of(BEE_ORG));

    static final Caller DIRECTOR = new Caller(UUID.fromString("00000000-0000-4000-a000-000000000007"), "bee.director", List.of(new RoleGrant("director", "all")), Set.of(BEE_ORG));
    static final Caller AUDITOR = new Caller(UUID.fromString("00000000-0000-4000-a000-000000000011"), "bee.auditor", List.of(new RoleGrant("auditor", "all")), Set.of(BEE_ORG));
    static final Caller ADMIN = new Caller(UUID.fromString("00000000-0000-4000-a000-000000000009"), "bee.admin", List.of(new RoleGrant("admin", "all")), Set.of(BEE_ORG));
    static final Caller REVIEWER = new Caller(UUID.fromString("00000000-0000-4000-a000-000000000005"), "bee.reviewer", List.of(new RoleGrant("reviewer", "assigned")), Set.of(BEE_ORG));
    static final Caller NARROW_DIRECTOR = new Caller(UUID.fromString("00000000-0000-4000-a000-000000000007"), "narrow.director", List.of(new RoleGrant("director", "assigned")), Set.of(BEE_ORG));

    static JdbcTemplate admin;
    static JdbcTemplate owner;
    static JdbcTemplate db;
    static TransactionTemplate tx;
    static DashboardModule module;
    static int appModelCountBefore;

    static String env(String k, String d) {
        String v = System.getenv(k);
        return v == null || v.isBlank() ? d : v;
    }

    static DriverManagerDataSource sourceAs(String schema, String user, String password) {
        String url = "jdbc:postgresql://127.0.0.1:" + env("BEE_PG_PORT", "5434") + "/" + env("BEE_APP_DB", "bee_app") + (schema == null ? "" : "?currentSchema=" + schema);
        return new DriverManagerDataSource(url, user, password);
    }

    static DriverManagerDataSource migrateSource(String schema) {
        return sourceAs(schema, env("BEE_FLYWAY_DB_USER", "bee_app"), env("BEE_FLYWAY_DB_PASSWORD", env("BEE_APP_DB_PASSWORD", "bee-local-app")));
    }

    @BeforeAll
    static void migrateAndSeed() throws Exception {
        admin = new JdbcTemplate(migrateSource(null));
        appModelCountBefore = admin.queryForObject("SELECT count(*) FROM app.model_application", Integer.class);
        admin.execute("DROP SCHEMA IF EXISTS " + MAIN + " CASCADE");
        admin.execute("CREATE SCHEMA " + MAIN);
        Flyway.configure().dataSource(migrateSource(MAIN)).schemas(MAIN).defaultSchema(MAIN).createSchemas(false).locations("classpath:db/migration").load().migrate();
        owner = new JdbcTemplate(migrateSource(MAIN));
        owner.execute(Files.readString(Path.of("..", "local", "seed", "seed.sql")));
        // A seed runs with the switch on: its payment events must not fill anyone's outbox.
        for (String f : List.of("s4_production", "s2_qr", "s5_mis", "s3_ledger", "s1_payments", "s6_ai")) {
            owner.execute("SET bee.demo_seeding = 'on';\n" + Files.readString(Path.of("..", "local", "seed", "demo", f + ".sql")));
        }
        var runtime = sourceAs(MAIN, env("BEE_RUNTIME_DB_USER", "bee_runtime"), env("BEE_RUNTIME_DB_PASSWORD", "bee-local-runtime"));
        db = new JdbcTemplate(runtime);
        tx = new TransactionTemplate(new DataSourceTransactionManager(runtime));
        var props = new gov.bee.api.document.DocumentProperties();
        props.setStorePath(Files.createTempDirectory("dash-docs").toString());
        module = new DashboardModule(db, new gov.bee.api.demo.ai.AiEngines(db, new gov.bee.api.document.LocalSha256FileStore(props)));
    }

    @AfterAll
    static void dropAndAssertAppUntouched() {
        if (admin != null) {
            admin.execute("DROP SCHEMA IF EXISTS " + MAIN + " CASCADE");
            assertEquals(appModelCountBefore, admin.queryForObject("SELECT count(*) FROM app.model_application", Integer.class));
        }
    }

    static DemoResult get(Caller c, String id, String action) {
        return module.handle(c, "GET", id, action, Map.of(), Map.of());
    }

    @SuppressWarnings("unchecked")
    static List<Map<String, Object>> tiles(DemoResult r) {
        return (List<Map<String, Object>>) r.body().get("tiles");
    }

    static Map<String, Object> tile(DemoResult r, String key) {
        return tiles(r).stream().filter(t -> key.equals(t.get("key"))).findFirst().orElseThrow();
    }

    @Test
    void whoMayOpenWhichDashboard() {
        assertEquals(List.of("executive", "director"), get(DIRECTOR, null, null).body().get("views"));
        assertEquals(List.of("auditor"), get(AUDITOR, null, null).body().get("views"));
        assertEquals(List.of("executive", "director", "auditor"), get(ADMIN, null, null).body().get("views"));
        assertEquals("role_not_permitted", get(AUDITOR, "director", null).code());
        assertEquals("role_not_permitted", get(DIRECTOR, "auditor", null).code());
        assertEquals("role_not_permitted", get(REVIEWER, null, null).code());
        assertEquals("role_not_permitted", get(NARROW_DIRECTOR, "director", null).code(), "a director role held for a narrower scope is not oversight");
        assertEquals("not_found", get(DIRECTOR, "nobody", null).code());
        assertEquals("not_found", get(DIRECTOR, "director", "nothing").code());
        assertEquals("validation_failed", module.handle(DIRECTOR, "POST", "director", null, Map.of(), Map.of()).code());
    }

    @Test
    void theDirectorsTilesCountWhatIsInTheTablesAndDrillDownToTheFullList() {
        var r = get(DIRECTOR, "director", null);
        assertEquals(6, tiles(r).size());
        for (var t : tiles(r)) {
            var d = get(DIRECTOR, "director", (String) t.get("key")).body();
            assertEquals(t.get("columns"), d.get("columns"));
            int total = ((Number) d.get("total")).intValue();
            int shown = ((Number) d.get("shown")).intValue();
            assertTrue(shown <= Math.min(total, 200), t.get("key") + " shows " + shown + " of " + total);
            assertEquals(total, ((Number) t.get("value")).intValue(), "the figure is the true total for " + t.get("key"));
            for (var row : (List<?>) d.get("rows")) {
                assertEquals(((List<?>) d.get("columns")).size(), ((List<?>) row).size());
            }
        }
        int approvals = owner.queryForObject("SELECT count(*) FROM model_application WHERE state IN ('director_review', 'secretary_approval')", Integer.class);
        assertEquals(approvals, ((Number) tile(r, "awaiting_approval").get("value")).intValue());
        int certs = owner.queryForObject("SELECT count(*) FROM certificate", Integer.class);
        assertEquals(certs, ((Number) tile(r, "certificates").get("value")).intValue());
        assertTrue(((List<?>) tile(r, "certificates").get("rows")).size() <= 5, "the tile previews five rows");
        // the compliance tile is computed live, with no stored run needed, and counts the high band
        assertTrue(((Number) tile(r, "ai_risk").get("value")).intValue() >= 1, "at least one organisation in the high band");
        assertEquals(0, owner.queryForObject("SELECT count(*) FROM ai_run WHERE created_at > now() - interval '1 minute'", Integer.class), "reading the dashboard stores no run");
        // the seeded 2025 certificates: one pending, one failed; the figure for the ledger tile counts them
        assertTrue(((Number) tile(r, "ledger_attention").get("value")).intValue() >= 2);
    }

    @Test
    void theAuditorSeesTheBrokenChainFirstAndTheTwoPersonProof() {
        var r = get(AUDITOR, "auditor", null);
        assertEquals(6, tiles(r).size());
        var chains = get(AUDITOR, "auditor", "ledger_integrity").body();
        @SuppressWarnings("unchecked")
        List<List<Object>> rows = (List<List<Object>>) chains.get("rows");
        assertEquals("MISMATCH", rows.get(0).get(1), "the broken chain is listed first");
        assertEquals("BEE/RAC/2025/90037", rows.get(0).get(0));
        assertEquals(1, ((Number) tile(r, "ledger_integrity").get("value")).intValue());
        var proof = get(AUDITOR, "auditor", "two_person_proof").body();
        assertTrue(String.valueOf(proof.get("note")).endsWith(": 0"), String.valueOf(proof.get("note")));
        var activity = get(AUDITOR, "auditor", "activity").body();
        assertTrue(((Number) activity.get("total")).intValue() > 0);
        @SuppressWarnings("unchecked")
        List<List<Object>> feed = (List<List<Object>>) activity.get("rows");
        for (int i = 1; i < feed.size(); i++) {
            assertTrue(String.valueOf(feed.get(i - 1).get(0)).compareTo(String.valueOf(feed.get(i).get(0))) >= 0, "newest first");
        }
        // reading never changes anything
        int before = owner.queryForObject("SELECT (SELECT count(*) FROM ledger_tx) + (SELECT count(*) FROM payment_event) + (SELECT count(*) FROM ai_run)", Integer.class);
        get(AUDITOR, "auditor", "overrides");
        get(DIRECTOR, "director", "ai_risk");
        assertEquals(before, owner.queryForObject("SELECT (SELECT count(*) FROM ledger_tx) + (SELECT count(*) FROM payment_event) + (SELECT count(*) FROM ai_run)", Integer.class));
    }

    @SuppressWarnings("unchecked")
    @Test
    void everyTileFollowsTheDateRangeAndChartsAddUp() {
        for (String view : List.of("director", "auditor")) {
            Caller who = "director".equals(view) ? DIRECTOR : AUDITOR;
            var all = get(who, view, null);
            assertEquals(null, ((Map<String, Object>) all.body().get("range")).get("from"));
            // a range far in the past leaves nothing; a range around now keeps today's records
            var none = module.handle(who, "GET", view, null, Map.of("from", "2001-01-01", "to", "2001-12-31"), Map.of());
            for (var t : tiles(none)) {
                if (!"ai_risk".equals(t.get("key")) && !"ledger_integrity".equals(t.get("key"))) {
                    assertEquals(0, ((Number) t.get("value")).intValue(), view + "/" + t.get("key") + " in 2001");
                }
                assertTrue(((List<?>) t.get("rows")).isEmpty() || "ai_risk".equals(t.get("key")) || "ledger_integrity".equals(t.get("key")));
            }
            for (var t : tiles(all)) {
                var charts = (List<Map<String, Object>>) t.get("charts");
                assertTrue(charts.size() >= 2, view + "/" + t.get("key") + " has charts");
                for (var c : charts) {
                    assertTrue(List.of("donut", "bars", "trend").contains(c.get("kind")));
                    assertTrue(!((List<?>) c.get("data")).isEmpty() || "bars".equals(c.get("kind")), t.get("key") + " chart " + c.get("title") + " has data");
                }
                var trend = charts.stream().filter(c -> "trend".equals(c.get("kind"))).findFirst();
                trend.ifPresent(c -> assertEquals(12, ((List<?>) c.get("data")).size(), "twelve months by default"));
                // the figure never exceeds the true total of the unfiltered list
                var drill = get(who, view, (String) t.get("key")).body();
                assertEquals(((Number) drill.get("total")).intValue(), ((Number) t.get("value")).intValue());
            }
            var wide = module.handle(who, "GET", view, null, Map.of("from", "2000-01-01", "to", "2100-01-01"), Map.of());
            for (var t : tiles(wide)) {
                var base = tile(all, (String) t.get("key"));
                assertEquals(((Number) base.get("value")).intValue(), ((Number) t.get("value")).intValue(), "a wide range keeps everything: " + t.get("key"));
            }
        }
        assertEquals("validation_failed", module.handle(DIRECTOR, "GET", "director", null, Map.of("from", "yesterday"), Map.of()).code());
        assertEquals("validation_failed", module.handle(DIRECTOR, "GET", "director", null, Map.of("from", "2026-02-01", "to", "2026-01-01"), Map.of()).code());
        // a range drives the drill-down and its charts too
        var drillNone = module.handle(DIRECTOR, "GET", "director", "certificates", Map.of("from", "2001-01-01", "to", "2001-01-31"), Map.of()).body();
        assertEquals(0, ((Number) drillNone.get("total")).intValue());
        var trend = ((List<Map<String, Object>>) drillNone.get("charts")).stream().filter(c -> "trend".equals(c.get("kind"))).findFirst().orElseThrow();
        assertEquals(1, ((List<?>) trend.get("data")).size(), "a one-month range is a one-month trend");
    }

    @SuppressWarnings("unchecked")
    static Number kpi(Map<String, Object> body, String key) {
        return (Number) ((List<Map<String, Object>>) body.get("kpis")).stream().filter(k -> key.equals(k.get("key"))).findFirst().orElseThrow().get("value");
    }

    @SuppressWarnings("unchecked")
    static List<Map<String, Object>> chartData(Map<String, Object> body, String key) {
        return (List<Map<String, Object>>) ((List<Map<String, Object>>) body.get("charts")).stream().filter(c -> key.equals(c.get("key"))).findFirst().orElseThrow().get("data");
    }

    @Test
    void theExecutiveDashboardCountsWhatIsInTheTablesAndFollowsTheFilters() {
        assertEquals("role_not_permitted", get(AUDITOR, "executive", null).code());
        assertEquals("role_not_permitted", get(REVIEWER, "executive", null).code());
        assertEquals("not_found", get(DIRECTOR, "executive", "x").code());
        var all = get(DIRECTOR, "executive", null).body();
        assertEquals(8, ((List<?>) all.get("kpis")).size());
        assertEquals(10, ((List<?>) all.get("charts")).size());
        int certificates = owner.queryForObject("SELECT count(*) FROM certificate", Integer.class);
        assertEquals(certificates, kpi(all, "issued").intValue());
        assertEquals(certificates, chartData(all, "stars").stream().mapToInt(p -> ((Number) p.get("value")).intValue()).sum(), "the star chart adds up to the certificates");
        assertEquals(certificates, chartData(all, "ledger").stream().mapToInt(p -> ((Number) p.get("value")).intValue()).sum(), "the ledger chart adds up to the certificates");
        int received = owner.queryForObject("SELECT count(*) FROM model_application WHERE state <> 'draft'", Integer.class);
        assertEquals(received, kpi(all, "received").intValue());
        assertEquals(received, chartData(all, "pipeline").stream().mapToInt(p -> ((Number) p.get("value")).intValue()).sum());
        // one manufacturer: fewer or equal everywhere, and exactly its own certificates
        var org = module.handle(DIRECTOR, "GET", "executive", null, Map.of("organisation", NOVA_ORG.toString()), Map.of());
        assertEquals("ok", org.code() == null ? "ok" : org.code());
        int novaCerts = owner.queryForObject("SELECT count(*) FROM certificate c JOIN model_application a ON a.id = c.application_id WHERE a.organisation_id = ?::uuid", Integer.class, NOVA_ORG.toString());
        assertEquals(novaCerts, kpi(org.body(), "issued").intValue());
        // a range that holds nothing: zero everywhere, no failure
        var none = module.handle(DIRECTOR, "GET", "executive", null, Map.of("from", "2001-01-01", "to", "2001-01-31"), Map.of());
        assertEquals(0, kpi(none.body(), "issued").intValue());
        assertEquals(0, kpi(none.body(), "received").intValue());
        assertEquals("validation_failed", module.handle(DIRECTOR, "GET", "executive", null, Map.of("from", "2026-02-01", "to", "2026-01-01"), Map.of()).code());
        assertEquals("validation_failed", module.handle(DIRECTOR, "GET", "executive", null, Map.of("organisation", "nope"), Map.of()).code());
    }

    @SuppressWarnings("unchecked")
    @Test
    void theRiskTileSaysWhyEachRiskIsHigh() {
        var drill = get(DIRECTOR, "director", "ai_risk").body();
        assertEquals(List.of("Manufacturer", "Score", "Risk band", "Why it is high", "Applications"), drill.get("columns"));
        var rows = (List<List<Object>>) drill.get("rows");
        var details = (List<List<Map<String, Object>>>) drill.get("details");
        assertTrue(rows.size() >= 1);
        assertEquals(rows.size(), details.size(), "one explanation per row");
        for (int i = 0; i < rows.size(); i++) {
            assertEquals("High", rows.get(i).get(2));
            String why = String.valueOf(rows.get(i).get(3));
            assertTrue(why.length() > 10 && !why.equals("null"), why);
            var d = details.get(i);
            assertTrue(!d.isEmpty());
            double sum = 0;
            for (var f : d) {
                assertTrue(String.valueOf(f.get("reason")).contains("full weight"), String.valueOf(f.get("reason")));
                sum += ((Number) f.get("points")).doubleValue();
            }
            assertEquals(((Number) rows.get(i).get(1)).doubleValue(), sum, 0.6, "the points add up to the score");
            for (int k = 1; k < d.size(); k++) {
                assertTrue(((Number) d.get(k - 1).get("points")).doubleValue() >= ((Number) d.get(k).get("points")).doubleValue(), "biggest reason first");
            }
        }
        // a date range lists the organisations active then; none in 2001
        var none = module.handle(DIRECTOR, "GET", "director", "ai_risk", Map.of("from", "2001-01-01", "to", "2001-12-31"), Map.of()).body();
        assertEquals(0, ((Number) none.get("total")).intValue());
    }
}
