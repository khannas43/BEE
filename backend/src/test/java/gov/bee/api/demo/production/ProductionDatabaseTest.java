package gov.bee.api.demo.production;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import gov.bee.api.demo.DemoResult;
import gov.bee.api.identity.Caller;
import gov.bee.api.identity.IdentityRepository.RoleGrant;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Base64;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ThreadLocalRandom;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestMethodOrder;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

/** The production demo module against throwaway PostgreSQL as the restricted runtime login, with the real migrations and the demo seed. */
@Tag("db")
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class ProductionDatabaseTest {

    static final String MAIN = "demo_s4_test_" + HexFormat.of().toHexDigits(ThreadLocalRandom.current().nextInt());
    static final UUID NOVA_ORG = UUID.fromString("00000000-0000-4000-b000-000000000001");
    static final UUID PIXEL_ORG = UUID.fromString("00000000-0000-4000-b000-000000000002");
    static final UUID BEE_ORG = UUID.fromString("00000000-0000-4000-b000-000000000003");
    static final Caller NOVA = new Caller(UUID.fromString("00000000-0000-4000-a000-000000000001"), "nova.applicant", List.of(new RoleGrant("manufacturer", "own-org")), Set.of(NOVA_ORG));
    static final Caller PIXEL = new Caller(UUID.fromString("00000000-0000-4000-a000-000000000002"), "pixel.applicant", List.of(new RoleGrant("agency", "own-org")), Set.of(PIXEL_ORG));
    static final Caller PROGRAMME = new Caller(UUID.fromString("00000000-0000-4000-a000-000000000006"), "bee.programme", List.of(new RoleGrant("programme", "all")), Set.of(BEE_ORG));
    static final Caller FINANCE = new Caller(UUID.fromString("00000000-0000-4000-a000-000000000003"), "bee.finance", List.of(new RoleGrant("finance", "all")), Set.of(BEE_ORG));
    static final Caller AUDITOR = new Caller(UUID.fromString("00000000-0000-4000-a000-000000000011"), "bee.auditor", List.of(new RoleGrant("auditor", "all")), Set.of(BEE_ORG));
    static final String HEAD = "registration_id,units,period_start,period_end\n";

    static JdbcTemplate admin;
    static JdbcTemplate owner;
    static JdbcTemplate db;
    static ProductionModule module;
    static String submissionId;

    static String env(String k, String d) {
        String v = System.getenv(k);
        return v == null || v.isBlank() ? d : v;
    }

    static DriverManagerDataSource sourceAs(String schema, String user, String password) {
        return new DriverManagerDataSource("jdbc:postgresql://127.0.0.1:" + env("BEE_PG_PORT", "5434") + "/" + env("BEE_APP_DB", "bee_app")
            + (schema == null ? "" : "?currentSchema=" + schema), user, password);
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
        owner.execute(Files.readString(Path.of("..", "local", "seed", "demo", "s4_production.sql")));
        owner.execute(Files.readString(Path.of("..", "local", "seed", "demo", "s4_production.sql"))); // idempotent
        db = new JdbcTemplate(sourceAs(MAIN, env("BEE_RUNTIME_DB_USER", "bee_runtime"), env("BEE_RUNTIME_DB_PASSWORD", "bee-local-runtime")));
        module = new ProductionModule(db);
    }

    @AfterAll
    static void drop() {
        if (admin != null) {
            admin.execute("DROP SCHEMA IF EXISTS " + MAIN + " CASCADE");
        }
    }

    static DemoResult post(Caller c, String id, String action, Map<String, Object> body) {
        return module.handle(c, "POST", id, action, Map.of(), body);
    }

    static DemoResult get(Caller c, String id, String action) {
        return module.handle(c, "GET", id, action, Map.of(), Map.of());
    }

    static void refused(DemoResult r, int status, String code) {
        assertEquals(code, r.code(), String.valueOf(r.detail()));
        assertEquals(status, r.status().value());
    }

    @SuppressWarnings("unchecked")
    static List<Map<String, Object>> list(Object o) {
        return (List<Map<String, Object>>) o;
    }

    @Test
    @Order(1)
    void seedHasFourQuartersAndScopeFollowsTheOrganisation() {
        assertEquals(4, owner.queryForObject("SELECT count(*) FROM production_submission WHERE organisation_id = ?", Integer.class, NOVA_ORG));
        assertEquals(4, list(get(NOVA, null, null).body().get("submissions")).size());
        assertEquals(0, list(get(PIXEL, null, null).body().get("submissions")).size());
        assertEquals(4, list(get(PROGRAMME, null, null).body().get("submissions")).size());
        assertEquals(4, list(get(AUDITOR, null, null).body().get("submissions")).size());
        refused(get(FINANCE, null, null), 403, "role_not_permitted");
        String seeded = owner.queryForObject("SELECT id::text FROM production_submission WHERE quarter = '2026-Q3'", String.class);
        assertNotNull(get(NOVA, seeded, null).body());
        refused(get(PIXEL, seeded, null), 404, "not_found");
        refused(get(FINANCE, seeded, "reconciliation"), 404, "not_found");
        refused(get(NOVA, "not-a-uuid", null), 404, "not_found");
        assertEquals("submitted", get(NOVA, seeded, null).body().get("state"));
        assertEquals(false, get(NOVA, seeded, "reconciliation").body().get("qrAvailable"));
        assertEquals("QR data not available", get(NOVA, seeded, "reconciliation").body().get("message"));
    }

    @Test
    @Order(2)
    void createOncePerQuarterAndOnlyForOwnOrganisation() {
        refused(post(PROGRAMME, null, null, Map.of("quarter", "2026-Q4")), 403, "role_not_permitted");
        refused(post(NOVA, null, null, Map.of("quarter", "2026Q4")), 400, "validation_failed");
        refused(post(NOVA, null, null, Map.of("quarter", "2026-Q4", "organisationId", PIXEL_ORG.toString())), 403, "role_not_permitted");
        var made = post(NOVA, null, null, Map.of("quarter", "2026-Q4"));
        assertEquals(201, made.status().value());
        submissionId = (String) made.body().get("id");
        assertEquals("draft", made.body().get("state"));
        refused(post(NOVA, null, null, Map.of("quarter", "2026-Q4")), 409, "version_conflict");
        assertEquals(1, owner.queryForObject("SELECT count(*) FROM production_event WHERE submission_id = ?::uuid AND action = 'created'", Integer.class, submissionId));
    }

    @Test
    @Order(3)
    void bulkValidationDryRunThenAllOrNothingCommit() {
        String bad = HEAD + "BEE/RAC/2026/10101,100,2026-10-01,2026-10-31\nBEE/RAC/2026/10104,50,2026-10-01,2026-10-31\nBEE/RAC/2026/10102,0,2026-10-01,2026-10-31\n";
        var dry = post(NOVA, submissionId, "rows", Map.of("csv", bad, "commit", false));
        assertEquals(3, list(dry.body().get("results")).size());
        assertEquals(2L, ((Number) dry.body().get("errorCount")).longValue());
        assertEquals(0, owner.queryForObject("SELECT count(*) FROM production_row WHERE submission_id = ?::uuid", Integer.class, submissionId));
        var all = post(NOVA, submissionId, "rows", Map.of("csv", bad, "commit", true));
        assertEquals(false, all.body().get("committed"));
        assertEquals(0, owner.queryForObject("SELECT count(*) FROM production_row WHERE submission_id = ?::uuid", Integer.class, submissionId));
        // another organisation cannot validate into this submission
        refused(post(PIXEL, submissionId, "rows", Map.of("csv", bad)), 404, "not_found");
        refused(post(PROGRAMME, submissionId, "rows", Map.of("csv", bad)), 403, "role_not_permitted");

        String good = HEAD + "BEE/RAC/2026/10101,100,2026-10-01,2026-10-31\nBEE/RAC/2026/10102,200,2026-10-01,2026-10-31\n";
        var ok = post(NOVA, submissionId, "rows", Map.of("csv", good, "commit", true));
        assertEquals(true, ok.body().get("committed"));
        assertEquals(2, owner.queryForObject("SELECT count(*) FROM production_row WHERE submission_id = ?::uuid", Integer.class, submissionId));
        // the same rows again are duplicates; a single new row is stored by default
        assertEquals(2L, ((Number) post(NOVA, submissionId, "rows", Map.of("csv", good, "commit", true)).body().get("errorCount")).longValue());
        var one = post(NOVA, submissionId, "rows", Map.of("registration_id", "BEE/RAC/2026/10103", "units", 75, "period_start", "2026-10-01", "period_end", "2026-10-31"));
        assertEquals(true, one.body().get("committed"));
        var arr = post(NOVA, submissionId, "rows", Map.of("rows", List.of(Map.of("registration_id", "BEE/RAC/2026/10103", "units", "75", "period_start", "2026-11-01", "period_end", "2026-11-30"))));
        assertEquals(0L, ((Number) arr.body().get("errorCount")).longValue());
        assertEquals(3, owner.queryForObject("SELECT count(*) FROM production_row WHERE submission_id = ?::uuid", Integer.class, submissionId));
    }

    @Test
    @Order(4)
    void evidenceIsHashedAndSubmitNeedsRowsAndEvidence() {
        refused(post(NOVA, submissionId, "submit", Map.of()), 400, "validation_failed");
        byte[] bytes = "synthetic CA letter".getBytes(StandardCharsets.UTF_8);
        Map<String, Object> ev = new java.util.HashMap<>(Map.of("fileName", "ca.txt", "mediaType", "text/plain", "contentBase64", Base64.getEncoder().encodeToString(bytes),
            "caName", "Synthetic CA", "caMembershipNo", "SYN-1", "statement", "Agrees with the books."));
        var bigEv = new java.util.HashMap<>(ev);
        bigEv.put("contentBase64", Base64.getEncoder().encodeToString(new byte[1024 * 1024 + 1]));
        refused(post(NOVA, submissionId, "evidence", bigEv), 400, "validation_failed");
        refused(post(PROGRAMME, submissionId, "evidence", ev), 403, "role_not_permitted");
        var done = post(NOVA, submissionId, "evidence", ev);
        assertEquals(201, done.status().value());
        assertEquals(ProductionModule.sha256(bytes), done.body().get("sha256"));
        var listed = list(get(PROGRAMME, submissionId, "evidence").body().get("evidence"));
        assertEquals(1, listed.size());
        assertEquals("SYN-1", listed.get(0).get("caMembershipNo"));
        assertFalse(listed.get(0).containsKey("contentBase64"));
        assertThrows(DataAccessException.class, () -> db.update("UPDATE production_evidence SET sha256 = repeat('a', 64)"));

        refused(post(PROGRAMME, submissionId, "review", Map.of("decision", "accepted")), 409, "version_conflict");
        assertEquals("submitted", post(NOVA, submissionId, "submit", Map.of()).body().get("state"));
        // no editing after submission, by service or by database
        refused(post(NOVA, submissionId, "rows", Map.of("csv", HEAD + "BEE/RAC/2026/10101,1,2026-12-01,2026-12-31", "commit", true)), 409, "version_conflict");
        refused(post(NOVA, submissionId, "evidence", ev), 409, "version_conflict");
        refused(post(NOVA, submissionId, "submit", Map.of()), 409, "version_conflict");
        assertThrows(DataAccessException.class, () -> db.update(
            "INSERT INTO production_row (submission_id, model_application_id, units) VALUES (?::uuid, '00000000-0000-4000-c000-000000000101', 5)", submissionId));
    }

    @Test
    @Order(5)
    void reviewSegregationQueryNoteAndTrail() {
        refused(post(NOVA, submissionId, "review", Map.of("decision", "accepted")), 403, "role_not_permitted");
        refused(post(PROGRAMME, submissionId, "review", Map.of("decision", "query")), 400, "validation_failed");
        refused(post(PROGRAMME, submissionId, "review", Map.of("decision", "maybe")), 400, "validation_failed");
        // a reviewer who also belongs to the submitting organisation is refused (segregation)
        UUID both = UUID.randomUUID();
        Caller dual = new Caller(both, "dual", List.of(new RoleGrant("programme", "all")), Set.of(NOVA_ORG));
        refused(post(dual, submissionId, "review", Map.of("decision", "accepted")), 403, "segregation_refused");
        // the submitter holding a review role is refused too
        Caller self = new Caller(NOVA.accountId(), "nova.applicant", List.of(new RoleGrant("programme", "all")), Set.of(BEE_ORG));
        refused(post(self, submissionId, "review", Map.of("decision", "accepted")), 403, "segregation_refused");
        var q = post(PROGRAMME, submissionId, "review", Map.of("decision", "query", "note", "Please explain November."));
        assertEquals("query", q.body().get("state"));
        refused(post(PROGRAMME, submissionId, "review", Map.of("decision", "accepted")), 409, "version_conflict");
        // after a query the manufacturer may edit and resubmit
        assertEquals(true, post(NOVA, submissionId, "rows", Map.of("registration_id", "BEE/RAC/2026/10101", "units", 10, "period_start", "2026-12-01", "period_end", "2026-12-31")).body().get("committed"));
        assertEquals("submitted", post(NOVA, submissionId, "submit", Map.of()).body().get("state"));
        assertEquals("accepted", post(PROGRAMME, submissionId, "review", Map.of("decision", "accepted")).body().get("state"));
        var detail = get(NOVA, submissionId, null).body();
        assertEquals(4, list(detail.get("rows")).size());
        List<String> actions = list(detail.get("events")).stream().map(e -> (String) e.get("action")).toList();
        assertEquals(List.of("created", "rows_added", "rows_added", "evidence_added", "submitted", "review_query", "rows_added", "submitted", "review_accepted"), actions);
    }

    @Test
    @Order(6)
    void reconciliationUsesBoundSerialsWhenTheTablesExist() {
        String seeded = owner.queryForObject("SELECT id::text FROM production_submission WHERE quarter = '2026-Q3'", String.class);
        owner.execute("CREATE TABLE qr_batch (id uuid PRIMARY KEY, model_application_id uuid, certificate_id uuid, quantity int, status text)");
        owner.execute("CREATE TABLE qr_serial (serial text UNIQUE, batch_id uuid, certificate_id uuid, state text)");
        owner.execute("GRANT SELECT ON qr_batch, qr_serial TO bee_runtime");
        owner.update("INSERT INTO qr_batch VALUES ('00000000-0000-4000-e100-000000000001', '00000000-0000-4000-c000-000000000101', NULL, 40000, 'open')");
        owner.execute("INSERT INTO qr_serial SELECT 'S' || g, '00000000-0000-4000-e100-000000000001', NULL, 'bound' FROM generate_series(1, 14000) g");
        var rec = get(NOVA, seeded, "reconciliation").body();
        assertEquals(true, rec.get("qrAvailable"));
        var models = list(rec.get("models"));
        var flags = new java.util.HashMap<String, Object>();
        models.forEach(m -> flags.put((String) m.get("modelNumber"), m.get("flag")));
        assertEquals("review", flags.get("NC-RAC-12D"));
        assertEquals("review", flags.get("NC-RAC-18F"));
        assertTrue(((Number) rec.get("declaredTotal")).longValue() > 0);
        assertEquals(14000L, ((Number) models.stream().filter(m -> m.get("modelNumber").equals("NC-RAC-12D")).findFirst().get().get("boundSerials")).longValue());
        // a generous margin clears the flag for the model with serials
        var wide = module.handle(NOVA, "GET", seeded, "reconciliation", Map.of("margin", "500"), Map.of()).body();
        assertEquals("ok", list(wide.get("models")).stream().filter(m -> m.get("modelNumber").equals("NC-RAC-12D")).findFirst().get().get("flag"));
        refused(module.handle(NOVA, "GET", seeded, "reconciliation", Map.of("margin", "x"), Map.of()), 400, "validation_failed");
    }
}
