package gov.bee.api.demo.payments;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
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

/** Payment simulation (demo slice S1) against throwaway PostgreSQL with the real migrations and the demo seed. */
@Tag("db")
class PaymentsDatabaseTest {

    static final String MAIN = "demo_s1_test_" + HexFormat.of().toHexDigits(ThreadLocalRandom.current().nextInt());
    static final UUID NOVA_ORG = UUID.fromString("00000000-0000-4000-b000-000000000001");
    static final UUID PIXEL_ORG = UUID.fromString("00000000-0000-4000-b000-000000000002");
    static final UUID BEE_ORG = UUID.fromString("00000000-0000-4000-b000-000000000003");
    static final String APP_A = "00000000-0000-4000-c000-000000000a01";
    static final String APP_E = "00000000-0000-4000-c000-000000000a05";
    static final Caller NOVA = new Caller(UUID.fromString("00000000-0000-4000-a000-000000000001"), "nova.applicant", List.of(new RoleGrant("manufacturer", "own-org")), Set.of(NOVA_ORG));
    static final Caller PIXEL = new Caller(UUID.fromString("00000000-0000-4000-a000-000000000002"), "pixel.applicant", List.of(new RoleGrant("agency", "own-org")), Set.of(PIXEL_ORG));
    static final Caller FINANCE = new Caller(UUID.fromString("00000000-0000-4000-a000-000000000003"), "bee.finance", List.of(new RoleGrant("finance", "all")), Set.of(BEE_ORG));
    static final Caller ADMIN = new Caller(UUID.fromString("00000000-0000-4000-a000-000000000009"), "bee.admin", List.of(new RoleGrant("admin", "all")), Set.of(BEE_ORG));
    static final Caller AUDITOR = new Caller(UUID.fromString("00000000-0000-4000-a000-000000000011"), "bee.auditor", List.of(new RoleGrant("auditor", "all")), Set.of(BEE_ORG));
    static final Caller HELPDESK = new Caller(UUID.fromString("00000000-0000-4000-a000-000000000010"), "bee.helpdesk", List.of(new RoleGrant("helpdesk", "all")), Set.of(BEE_ORG));

    static JdbcTemplate admin;
    static JdbcTemplate owner;
    static JdbcTemplate db;
    static TransactionTemplate tx;
    static PaymentsModule module;
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
        owner.execute(Files.readString(Path.of("..", "local", "seed", "demo", "s1_payments.sql")));
        owner.execute(Files.readString(Path.of("..", "local", "seed", "demo", "s1_payments.sql")));
        var runtime = sourceAs(MAIN, env("BEE_RUNTIME_DB_USER", "bee_runtime"), env("BEE_RUNTIME_DB_PASSWORD", "bee-local-runtime"));
        db = new JdbcTemplate(runtime);
        tx = new TransactionTemplate(new DataSourceTransactionManager(runtime));
        module = new PaymentsModule(new PaymentRepository(db));
    }

    @AfterAll
    static void dropAndAssertAppUntouched() {
        if (admin != null) {
            admin.execute("DROP SCHEMA IF EXISTS " + MAIN + " CASCADE");
            assertEquals(appModelCountBefore, admin.queryForObject("SELECT count(*) FROM app.model_application", Integer.class));
        }
    }

    static DemoResult call(Caller c, String method, String id, String action, Map<String, Object> body) {
        return tx.execute(s -> module.handle(c, method, id, action, Map.of(), body));
    }

    @Test
    void aPersonWhoLeftThePayingOrganisationCannotSettleItsPayment() {
        // the seeded open payment of DEMO-PAY-0003, started by Nova's applicant
        String id = "00000000-0000-4000-f000-000000000a03";
        String ref = "SIMGW-5EED0003";
        // the same account, now a member of another organisation only
        Caller moved = new Caller(NOVA.accountId(), "nova.applicant", List.of(new RoleGrant("manufacturer", "own-org")), Set.of(PIXEL_ORG));
        assertEquals("not_found", call(moved, "POST", id, "callback", Map.of("gatewayRef", ref, "outcome", "paid", "nonce", "nonce-moved-001")).code());
        assertEquals("initiated", db.queryForObject("SELECT status FROM payment WHERE id = ?::uuid", String.class, id));
    }

    @Test
    void paymentLifecycleIdempotencyAndDenials() {
        // Start: applicant only, own organisation only, exactly the fee total from the snapshot.
        assertEquals("role_not_permitted", call(FINANCE, "POST", null, null, Map.of("applicationId", APP_A)).code());
        assertEquals("role_not_permitted", call(HELPDESK, "POST", null, null, Map.of("applicationId", APP_A)).code());
        assertEquals("not_found", call(PIXEL, "POST", null, null, Map.of("applicationId", APP_A)).code(), "another organisation's application is the same as unknown");
        assertEquals("validation_failed", call(NOVA, "POST", null, null, Map.of()).code());
        var started = call(NOVA, "POST", null, null, Map.of("applicationId", APP_A, "amountInr", "1.00"));
        assertEquals(201, started.status().value());
        assertEquals("11800.00", started.body().get("amountInr"), "amount comes from the fee snapshot, never the request");
        String ref = (String) started.body().get("gatewayRef");
        String id = (String) started.body().get("id");
        assertTrue(ref.matches("SIMGW-[0-9A-F]{8}"));
        assertEquals("version_conflict", call(NOVA, "POST", null, null, Map.of("applicationId", APP_A)).code(), "one open payment per application");

        // Callback: only the person who started it; anyone else gets the unknown answer.
        Map<String, Object> cb = Map.of("gatewayRef", ref, "outcome", "paid", "nonce", "nonce-0001-abc", "amountInr", "1.00");
        assertEquals("not_found", call(PIXEL, "POST", id, "callback", cb).code(), "cross-organisation callback denied");
        assertEquals("role_not_permitted", call(FINANCE, "POST", id, "callback", cb).code());
        assertEquals("validation_failed", call(NOVA, "POST", id, "callback", Map.of("gatewayRef", ref, "outcome", "maybe", "nonce", "nonce-0001-abc")).code());
        assertEquals("validation_failed", call(NOVA, "POST", id, "callback", Map.of("gatewayRef", "SIMGW-00000000", "outcome", "paid", "nonce", "nonce-0001-abc")).code());

        var first = call(NOVA, "POST", id, "callback", cb);
        assertEquals(200, first.status().value());
        assertEquals("paid", first.body().get("status"));
        assertEquals(false, first.body().get("replayed"));
        assertTrue(((String) first.body().get("receiptNumber")).matches("SIMRCPT-\\d{8}-\\d{4}"));
        assertEquals("11800.00", first.body().get("amountInr"));

        int events = db.queryForObject("SELECT count(*) FROM payment_event WHERE payment_id = ?::uuid", Integer.class, id);
        var second = call(NOVA, "POST", id, "callback", cb);
        assertEquals(true, second.body().get("replayed"));
        assertEquals(first.body().get("receiptNumber"), second.body().get("receiptNumber"));
        assertEquals(first.body().get("payloadSha256"), second.body().get("payloadSha256"));
        assertEquals(1, db.queryForObject("SELECT count(*) FROM payment_callback WHERE payment_id = ?::uuid", Integer.class, id), "no duplicate row");
        assertEquals(events, db.queryForObject("SELECT count(*) FROM payment_event WHERE payment_id = ?::uuid", Integer.class, id), "no second effect");

        var different = call(NOVA, "POST", id, "callback", Map.of("gatewayRef", ref, "outcome", "failed", "nonce", "nonce-0002-xyz"));
        assertEquals("version_conflict", different.code());
        assertEquals("paid", db.queryForObject("SELECT status FROM payment WHERE id = ?::uuid", String.class, id));

        // Payer cannot confirm own fee: this slice leaves the application where it was.
        assertEquals("fee_due", owner.queryForObject("SELECT state FROM model_application WHERE id = ?::uuid", String.class, APP_A));
        assertEquals(0, owner.queryForObject("SELECT count(*) FROM model_application_fee_confirmation WHERE application_id = ?::uuid", Integer.class, APP_A));
        assertEquals("version_conflict", call(NOVA, "POST", null, null, Map.of("applicationId", APP_A)).code(), "a paid application cannot be paid again");
    }

    @Test
    void failedPaymentCanBeRetried() {
        var started = call(PIXEL, "POST", null, null, Map.of("applicationId", APP_E));
        assertEquals(201, started.status().value());
        String id = (String) started.body().get("id");
        var failed = call(PIXEL, "POST", id, "callback", Map.of("gatewayRef", started.body().get("gatewayRef"), "outcome", "failed", "nonce", "nonce-fail-001"));
        assertEquals("failed", failed.body().get("status"));
        assertNull(failed.body().get("receiptNumber"));
        assertEquals(201, call(PIXEL, "POST", null, null, Map.of("applicationId", APP_E)).status().value(), "a new attempt after a failure");
    }

    @Test
    void listsAreScopedAndReconciliationIsForFinanceAdminAuditor() {
        var nova = call(NOVA, "GET", null, null, Map.of());
        assertEquals("applicant", nova.body().get("view"));
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> novaRows = (List<Map<String, Object>>) nova.body().get("payments");
        assertFalse(novaRows.isEmpty());
        List<String> pixelRefs = owner.queryForList("SELECT a.reference FROM payment p JOIN model_application a ON a.id = p.application_id JOIN organisation o ON o.id = a.organisation_id WHERE o.code = 'PIXEL'", String.class);
        assertFalse(pixelRefs.isEmpty());
        assertTrue(novaRows.stream().noneMatch(r -> pixelRefs.contains((String) r.get("applicationReference"))), "NOVA never sees PIXEL's payments");
        assertNotNull(nova.body().get("feeDue"));

        var fin = call(FINANCE, "GET", null, null, Map.of());
        assertEquals("finance", fin.body().get("view"));
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> all = (List<Map<String, Object>>) fin.body().get("payments");
        assertTrue(all.stream().anyMatch(r -> "DEMO-PAY-0004".equals(r.get("applicationReference")) && ((String) r.get("gatewayRef")).startsWith("SIMGW-")));
        assertEquals("finance", call(ADMIN, "GET", null, null, Map.of()).body().get("view"));
        assertEquals("role_not_permitted", call(HELPDESK, "GET", null, null, Map.of()).code());
        assertEquals("finance", call(AUDITOR, "GET", null, null, Map.of()).body().get("view"), "the auditor reads the payment table (read only), as the dashboards link to it");

        assertEquals("role_not_permitted", call(NOVA, "GET", "reconciliation", null, Map.of()).code());
        assertEquals("role_not_permitted", call(HELPDESK, "GET", "reconciliation", null, Map.of()).code());
        for (Caller c : List.of(FINANCE, ADMIN, AUDITOR)) {
            var rec = call(c, "GET", "reconciliation", null, Map.of());
            assertEquals(200, rec.status().value());
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> diffs = (List<Map<String, Object>>) rec.body().get("differences");
            assertTrue(diffs.stream().anyMatch(d -> "paid_not_yet_confirmed".equals(d.get("kind"))), "paid but not yet confirmed by Finance");
            assertTrue(new java.math.BigDecimal((String) rec.body().get("paidTotalInr")).signum() > 0);
            assertTrue(new java.math.BigDecimal((String) rec.body().get("confirmedReceiptsTotalInr")).signum() >= 0);
        }
    }

    @Test
    void runtimeLoginCannotDeleteOrRewriteHistory() {
        assertThrows(DataAccessException.class, () -> db.update("DELETE FROM payment"));
        assertThrows(DataAccessException.class, () -> db.update("UPDATE payment SET amount_inr = 1"));
        assertThrows(DataAccessException.class, () -> db.update("UPDATE payment_callback SET outcome = 'failed'"));
        assertThrows(DataAccessException.class, () -> db.update("DELETE FROM payment_event"));
    }
}
