package gov.bee.api.demo.qr;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import gov.bee.api.demo.DemoResult;
import gov.bee.api.identity.Caller;
import gov.bee.api.identity.IdentityRepository.RoleGrant;
import gov.bee.api.verification.PublicVerificationRepository;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashSet;
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

/** QR batches and serials against throwaway PostgreSQL with the real migrations, as the restricted runtime login (demo slice S2). */
@Tag("db")
class QrDatabaseTest {

    static final String MAIN = "s2qr_test_" + HexFormat.of().toHexDigits(ThreadLocalRandom.current().nextInt());
    static final UUID NOVA_ORG = UUID.fromString("00000000-0000-4000-b000-000000000001");
    static final UUID PIXEL_ORG = UUID.fromString("00000000-0000-4000-b000-000000000002");
    static final UUID BEE_ORG = UUID.fromString("00000000-0000-4000-b000-000000000003");
    static final UUID NOVA_USER = UUID.fromString("00000000-0000-4000-a000-000000000001");
    static final UUID PIXEL_USER = UUID.fromString("00000000-0000-4000-a000-000000000002");
    static final UUID FINANCE_USER = UUID.fromString("00000000-0000-4000-a000-000000000003");
    static final UUID PROGRAMME_USER = UUID.fromString("00000000-0000-4000-a000-000000000006");
    static final UUID APPROVED_A = UUID.fromString("00000000-0000-4000-c000-0000000009a1");
    static final UUID APPROVED_B = UUID.fromString("00000000-0000-4000-c000-0000000009a2");
    static final UUID FEE_DUE_APP = UUID.fromString("00000000-0000-4000-c000-000000000002");
    static final UUID SEED_BATCH_1 = UUID.fromString("00000000-0000-4000-c000-0000000009e1");

    static JdbcTemplate admin;
    static JdbcTemplate owner;
    static JdbcTemplate db;
    static QrModule module;
    static int appModelCountBefore;

    static final Caller NOVA = new Caller(NOVA_USER, "nova.applicant", List.of(new RoleGrant("manufacturer", "own-org")), Set.of(NOVA_ORG));
    static final Caller PIXEL = new Caller(PIXEL_USER, "pixel.applicant", List.of(new RoleGrant("agency", "own-org")), Set.of(PIXEL_ORG));
    static final Caller FINANCE = new Caller(FINANCE_USER, "bee.finance", List.of(new RoleGrant("finance", "all")), Set.of(BEE_ORG));
    static final Caller PROGRAMME = new Caller(PROGRAMME_USER, "bee.programme", List.of(new RoleGrant("programme", "all")), Set.of(BEE_ORG));

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
        owner.execute(Files.readString(Path.of("..", "local", "seed", "demo", "s4_production.sql"))); // the QR seed batches the production models
        owner.execute(Files.readString(Path.of("..", "local", "seed", "demo", "s2_qr.sql")));
        owner.execute(Files.readString(Path.of("..", "local", "seed", "demo", "s2_qr.sql"))); // idempotent
        db = new JdbcTemplate(sourceAs(MAIN, env("BEE_RUNTIME_DB_USER", "bee_runtime"), env("BEE_RUNTIME_DB_PASSWORD", "bee-local-runtime")));
        module = new QrModule(new QrRepository(db));
        assertTrue(owner.queryForObject("SELECT max(version::int) FROM flyway_schema_history", Integer.class) >= 55);
    }

    @AfterAll
    static void dropAndAssertAppUntouched() {
        if (admin != null) {
            admin.execute("DROP SCHEMA IF EXISTS " + MAIN + " CASCADE");
            assertEquals(appModelCountBefore, admin.queryForObject("SELECT count(*) FROM app.model_application", Integer.class));
        }
    }

    static DemoResult post(Caller c, String id, String action, Map<String, Object> body) {
        return module.handle(c, "POST", id, action, Map.of(), body);
    }

    static DemoResult get(Caller c, String id, Map<String, String> q) {
        return module.handle(c, "GET", id, null, q, Map.of());
    }

    @SuppressWarnings("unchecked")
    static List<String> strings(Object o) {
        return (List<String>) o;
    }

    static String newBatch(int quantity) {
        DemoResult r = post(NOVA, null, null, Map.of("applicationId", APPROVED_B.toString(), "quantity", quantity));
        assertEquals(201, r.status().value(), r.detail());
        return (String) r.body().get("id");
    }

    @Test
    void seedHasTwoBatchesWithBoundSerialsAndIsRepeatable() {
        assertEquals(2, owner.queryForObject("SELECT count(*) FROM qr_batch WHERE id::text LIKE '00000000-0000-4000-c000-0000000009e%'", Integer.class));
        assertEquals(25, owner.queryForObject("SELECT count(*) FROM qr_serial WHERE batch_id = ? AND state = 'bound'", Integer.class, SEED_BATCH_1));
        assertEquals(1, owner.queryForObject("SELECT count(*) FROM qr_serial WHERE batch_id = ? AND state = 'void'", Integer.class, SEED_BATCH_1));
    }

    @Test
    void serialsHaveTheRightShapeAndAreUnique() {
        Set<String> seen = new HashSet<>();
        for (int i = 0; i < 5000; i++) {
            String s = QrRepository.newSerial();
            assertTrue(s.matches("^BEEQ-[0-9A-HJKMNP-TV-Z]{10}$"), s);
            seen.add(s);
        }
        assertEquals(5000, seen.size());
    }

    @Test
    void whoMayCreateABatch() {
        Map<String, Object> ok = Map.of("applicationId", APPROVED_A.toString(), "quantity", 10);
        assertEquals(403, post(FINANCE, null, null, ok).status().value(), "wrong role");
        assertEquals(403, post(PROGRAMME, null, null, ok).status().value(), "read-only role");
        assertEquals(404, post(PIXEL, null, null, ok).status().value(), "another organisation's application is not found");
        assertEquals(404, post(NOVA, null, null, Map.of("applicationId", UUID.randomUUID().toString(), "quantity", 10)).status().value());
        assertEquals(400, post(NOVA, null, null, Map.of("applicationId", APPROVED_A.toString(), "quantity", 0)).status().value());
        assertEquals(400, post(NOVA, null, null, Map.of("applicationId", APPROVED_A.toString(), "quantity", 5001)).status().value());
        assertEquals(400, post(NOVA, null, null, Map.of("applicationId", APPROVED_A.toString(), "quantity", "ten")).status().value());
        DemoResult notApproved = post(NOVA, null, null, Map.of("applicationId", FEE_DUE_APP.toString(), "quantity", 10));
        assertEquals(400, notApproved.status().value(), "wrong state");
        assertTrue(notApproved.detail().contains("approved"));
        assertEquals(201, post(NOVA, null, null, Map.of("applicationId", APPROVED_A.toString(), "quantity", 5000)).status().value());
    }

    @Test
    void allocateBindVoidFlow() {
        String id = newBatch(6);
        assertEquals(201, post(NOVA, id, "serials", Map.of("count", 4)).status().value());
        DemoResult tooMany = post(NOVA, id, "serials", Map.of("count", 3));
        assertEquals(400, tooMany.status().value());
        assertTrue(tooMany.detail().contains("2"));
        DemoResult rest = post(NOVA, id, "serials", Map.of());
        assertEquals(2, rest.body().get("newSerialCount"));
        assertEquals("closed", rest.body().get("status"));
        assertEquals(400, post(NOVA, id, "serials", Map.of()).status().value(), "full");
        assertEquals(6, owner.queryForObject("SELECT count(DISTINCT serial) FROM qr_serial WHERE batch_id = ?::uuid", Integer.class, id));

        List<String> serials = owner.queryForList("SELECT serial FROM qr_serial WHERE batch_id = ?::uuid ORDER BY serial", String.class, id);
        DemoResult bound = post(NOVA, id, "bind", Map.of("serials", serials.subList(0, 3)));
        assertEquals(200, bound.status().value());
        assertEquals(3, bound.body().get("newlyBound"));
        DemoResult again = post(NOVA, id, "bind", Map.of("serials", serials.subList(0, 3)));
        assertEquals(0, again.body().get("newlyBound"), "binding twice is idempotent");
        assertEquals(3, again.body().get("alreadyBound"));

        DemoResult dup = post(NOVA, id, "bind", Map.of("serials", List.of(serials.get(4), serials.get(4))));
        assertEquals(400, dup.status().value());
        assertTrue(dup.detail().startsWith("Duplicate code blocked"));
        assertEquals("allocated", owner.queryForObject("SELECT state FROM qr_serial WHERE serial = ?", String.class, serials.get(4)), "nothing was bound by a refused request");

        assertTrue(post(NOVA, id, "bind", Map.of("serials", List.of("BEEQ-0000000000"))).detail().contains("not a serial of this batch"));
        String otherBatchSerial = owner.queryForObject("SELECT serial FROM qr_serial WHERE batch_id = ? LIMIT 1", String.class, SEED_BATCH_1);
        assertTrue(post(NOVA, id, "bind", Map.of("serials", List.of(otherBatchSerial))).detail().contains("not a serial of this batch"));
        assertEquals(400, post(NOVA, id, "bind", Map.of("serials", List.of("nonsense"))).status().value());

        assertEquals(400, post(NOVA, id, "void", Map.of("serial", serials.get(5), "reason", " ")).status().value());
        assertEquals(200, post(NOVA, id, "void", Map.of("serial", serials.get(5), "reason", "Misprint")).status().value());
        assertTrue(post(NOVA, id, "bind", Map.of("serials", List.of(serials.get(5)))).detail().contains("void"));
        assertEquals(200, post(NOVA, id, "void", Map.of("serial", serials.get(0), "reason", "Recalled label")).status().value(), "a bound serial can be voided");

        var summary = get(NOVA, id, Map.of()).body();
        assertEquals(2, summary.get("bound"));
        assertEquals(2, summary.get("void"));
        assertEquals(2, summary.get("allocated"));
        assertTrue(owner.queryForObject("SELECT count(*) FROM qr_event WHERE batch_id = ?::uuid", Integer.class, id) >= 6, "every change is audited");
        assertThrows(Exception.class, () -> db.update("UPDATE qr_serial SET state = 'allocated' WHERE serial = ?", serials.get(5)), "void is final");
        assertThrows(Exception.class, () -> db.update("DELETE FROM qr_serial WHERE serial = ?", serials.get(1)));
    }

    @Test
    void readScopeAndPaging() {
        var own = get(NOVA, null, Map.of());
        assertTrue(((List<?>) own.body().get("items")).size() >= 2);
        assertTrue(((List<?>) own.body().get("eligible")).size() >= 2, "Nova's approved models with a certificate");
        // The richer seed gives Pixel models and batches of its own; what must hold is that none of Nova's show for Pixel.
        List<String> novaRegs = owner.queryForList("SELECT registration_id FROM certificate c JOIN model_application a ON a.id = c.application_id WHERE a.organisation_id = '00000000-0000-4000-b000-000000000001'", String.class);
        var pixel = get(PIXEL, null, Map.of()).body();
        assertTrue(((List<?>) pixel.get("eligible")).stream().noneMatch(e -> novaRegs.contains(((Map<?, ?>) e).get("registrationId"))), "Pixel is offered none of Nova's models");
        assertTrue(((List<?>) pixel.get("items")).stream().noneMatch(b -> novaRegs.contains(((Map<?, ?>) b).get("registrationId"))), "another organisation sees none of Nova's batches");
        assertTrue(((List<?>) get(PROGRAMME, null, Map.of()).body().get("items")).size() >= 2, "programme sees all");
        assertEquals(403, get(FINANCE, null, Map.of()).status().value());
        assertEquals(404, get(PIXEL, SEED_BATCH_1.toString(), Map.of()).status().value(), "cross-organisation is not found");
        assertEquals(404, get(NOVA, UUID.randomUUID().toString(), Map.of()).status().value());
        assertEquals(404, get(NOVA, "not-a-uuid", Map.of()).status().value());
        assertEquals(403, post(PROGRAMME, SEED_BATCH_1.toString(), "serials", Map.of()).status().value(), "programme reads but does not write");
        assertEquals(404, post(PIXEL, SEED_BATCH_1.toString(), "bind", Map.of("serials", List.of("BEEQ-S2D0000001"))).status().value());

        var page = get(NOVA, SEED_BATCH_1.toString(), Map.of("offset", "10", "limit", "5")).body();
        assertEquals(5, ((List<?>) page.get("serials")).size());
        assertEquals(40, page.get("total"));
        assertEquals(25, page.get("bound"));
        assertEquals(15, ((List<?>) get(NOVA, SEED_BATCH_1.toString(), Map.of("offset", "30", "limit", "100")).body().get("serials")).size() + 5);
    }

    @Test
    void publicViewResolvesOnlyBoundSerials() {
        var pub = new PublicVerificationRepository(db);
        var cert = pub.findBySerial("BEEQ-S2D0000001");
        assertTrue(cert.isPresent());
        assertEquals("BEE/RAC/2026/10901", cert.get().registrationId());
        assertFalse(pub.findBySerial("BEEQ-S2D0000030").isPresent(), "allocated but not bound");
        assertFalse(pub.findBySerial("BEEQ-S2D0000040").isPresent(), "void");
        assertFalse(pub.findBySerial("BEEQ-ZZZZZZZZZZ").isPresent(), "unknown");
        assertNotNull(pub.find("BEE/RAC/2026/10901"));
    }

    @Test
    void aCertificateHasACapAndARevokedOneGetsNoNewBatchesSerialsOrBindings() {
        UUID approvedB = UUID.fromString("00000000-0000-4000-c000-0000000009a2");
        // the cap: all batches of one certificate together hold at most 100,000 serials
        int made = 0;
        DemoResult r;
        do {
            r = post(NOVA, null, null, Map.of("applicationId", approvedB.toString(), "quantity", 5000));
            if (r.status().value() == 201) {
                made++;
            }
        } while (r.status().value() == 201 && made < 40);
        assertTrue(made >= 15 && made <= 20, "made " + made);
        assertEquals(400, r.status().value());
        assertTrue(r.detail().contains("at most"), r.detail());

        // revoke 9a1 on the simulated ledger (submit, a second person commits, revoke, a second person commits)
        UUID cert = owner.queryForObject("SELECT id FROM certificate WHERE application_id = ?", UUID.class, APPROVED_A);
        UUID other = FINANCE_USER;
        owner.queryForList("SELECT * FROM ledger_submit(?, ?)", cert, PROGRAMME_USER);
        owner.queryForList("SELECT * FROM ledger_decide(?, ?, ARRAY[?]::uuid[], 'commit', NULL)", cert, other, other);
        owner.queryForList("SELECT * FROM ledger_change(?, ?, 'revoke', NULL, 'test')", cert, PROGRAMME_USER);
        owner.queryForList("SELECT * FROM ledger_decide(?, ?, ARRAY[?]::uuid[], 'commit', NULL)", cert, other, other);
        DemoResult create = post(NOVA, null, null, Map.of("applicationId", APPROVED_A.toString(), "quantity", 10));
        assertEquals(409, create.status().value());
        assertTrue(create.detail().contains("revoked"), create.detail());
        String batch = owner.queryForObject("SELECT id::text FROM qr_batch WHERE certificate_id = ? ORDER BY created_at LIMIT 1", String.class, cert);
        assertEquals(409, post(NOVA, batch, "serials", Map.of("count", 1)).status().value());
        assertEquals(409, post(NOVA, batch, "bind", Map.of("serials", List.of("BEEQ-0000000000"))).status().value());
        // reading is still fine
        assertEquals(200, module.handle(NOVA, "GET", batch, null, Map.of(), Map.of()).status().value());
    }
}
