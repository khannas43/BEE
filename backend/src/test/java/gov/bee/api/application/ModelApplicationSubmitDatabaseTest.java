package gov.bee.api.application;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.math.BigDecimal;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HexFormat;
import java.util.UUID;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.ThreadLocalRandom;
import java.util.concurrent.atomic.AtomicInteger;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

/** WP05.1c submit persistence against throwaway PostgreSQL; shared app schema untouched. */
@Tag("db")
class ModelApplicationSubmitDatabaseTest {

    static final String TAG = HexFormat.of().toHexDigits(ThreadLocalRandom.current().nextInt());
    static final String MAIN = "wp051c_test_" + TAG;
    static final Path SEED = Path.of("..", "local", "seed", "seed.sql");
    static final UUID NOVA = UUID.fromString("00000000-0000-4000-b000-000000000001");
    static final UUID NOVA_USER = UUID.fromString("00000000-0000-4000-a000-000000000001");
    static final UUID NOVA_COOL = UUID.fromString("00000000-0000-4000-d000-000000000001");

    static JdbcTemplate admin;
    static JdbcTemplate db;
    static ModelApplicationRepository applications;
    static ModelApplicationSubmitRepository submissions;
    static String seed;
    static int appModelCountBefore;
    static int appVersionBefore;

    static String env(String k, String d) {
        String v = System.getenv(k);
        return v == null || v.isBlank() ? d : v;
    }

    static DriverManagerDataSource source(String schema) {
        String url = "jdbc:postgresql://127.0.0.1:" + env("BEE_PG_PORT", "5434") + "/" + env("BEE_APP_DB", "bee_app")
            + (schema == null ? "" : "?currentSchema=" + schema);
        return new DriverManagerDataSource(url, env("BEE_APP_DB_USER", "bee_app"), env("BEE_APP_DB_PASSWORD", "bee-local-app"));
    }

    static Flyway flyway(String schema) {
        return Flyway.configure().dataSource(source(schema)).schemas(schema).defaultSchema(schema).createSchemas(false)
            .locations("classpath:db/migration").load();
    }

    static void createSchema(String schema) {
        if (!schema.startsWith("wp051c_test_")) {
            throw new IllegalArgumentException(schema);
        }
        admin.execute("DROP SCHEMA IF EXISTS " + schema + " CASCADE");
        admin.execute("CREATE SCHEMA " + schema);
    }

    static UUID insertDraft(String model) {
        UUID id = UUID.randomUUID();
        db.update(
            "INSERT INTO model_application (id, reference, organisation_id, brand_name, category, model_number, state, version, brand_id, principal_organisation_id) "
                + "VALUES (?, ?, ?, 'Nova Cool', 'RAC', ?, 'draft', 0, ?, ?)",
            id, "LOCAL-MA-T" + model.hashCode(), NOVA, model, NOVA_COOL, NOVA);
        return id;
    }

    @BeforeAll
    static void migrateAndSeed() throws Exception {
        admin = new JdbcTemplate(source(null));
        appModelCountBefore = admin.queryForObject("SELECT count(*) FROM app.model_application", Integer.class);
        appVersionBefore = admin.queryForObject("SELECT max(version::int) FROM app.flyway_schema_history WHERE success", Integer.class);
        seed = Files.readString(SEED);
        createSchema(MAIN);
        flyway(MAIN).migrate();
        db = new JdbcTemplate(source(MAIN));
        db.execute(seed);
        applications = new ModelApplicationRepository(db);
        submissions = new ModelApplicationSubmitRepository(db, applications);
    }

    @AfterAll
    static void dropAndAssertAppUntouched() {
        if (admin != null) {
            admin.execute("DROP SCHEMA IF EXISTS " + MAIN + " CASCADE");
            assertEquals(appModelCountBefore, admin.queryForObject("SELECT count(*) FROM app.model_application", Integer.class));
            assertEquals(appVersionBefore, admin.queryForObject("SELECT max(version::int) FROM app.flyway_schema_history WHERE success", Integer.class));
        }
    }

    @Test
    void submitMovesDraftToFeeDueWithOneEventAndFee() {
        UUID id = insertDraft("NC-SUB-1");
        var done = submissions.submit(id, NOVA, 0, NOVA_USER, "manufacturer", new BigDecimal("24000.00"), "RAC:new_model", 2,
            "provisional", "FIRST_SLICE", "local demo");
        assertTrue(done.isPresent());
        assertEquals("fee_due", done.get().application().state());
        assertEquals(1, done.get().application().version());
        assertEquals(1, submissions.countSubmissionEvents(id));
        assertEquals(1, submissions.countFeeSnapshots(id));
    }

    @Test
    void staleVersionDoesNotPartiallyTransition() {
        UUID id = insertDraft("NC-SUB-STALE");
        assertTrue(submissions.submit(id, NOVA, 99, NOVA_USER, "manufacturer", new BigDecimal("24000"), "RAC:new_model", 2,
            "provisional", null, null).isEmpty());
        assertEquals("draft", applications.findOwned(id, NOVA).orElseThrow().state());
        assertEquals(0, submissions.countSubmissionEvents(id));
    }

    @Test
    void concurrentSubmitOnlyOneSucceeds() throws Exception {
        UUID id = insertDraft("NC-SUB-CONC");
        CyclicBarrier gate = new CyclicBarrier(2);
        AtomicInteger ok = new AtomicInteger();
        var pool = Executors.newFixedThreadPool(2);
        try {
            Future<?> a = pool.submit(() -> {
                try {
                    gate.await();
                } catch (InterruptedException | java.util.concurrent.BrokenBarrierException e) {
                    if (e instanceof InterruptedException) {
                        Thread.currentThread().interrupt();
                    }
                    return;
                }
                if (submissions.submit(id, NOVA, 0, NOVA_USER, "manufacturer", new BigDecimal("24000"), "RAC:new_model", 2,
                    "provisional", null, null).isPresent()) {
                    ok.incrementAndGet();
                }
            });
            Future<?> b = pool.submit(() -> {
                try {
                    gate.await();
                } catch (InterruptedException | java.util.concurrent.BrokenBarrierException e) {
                    if (e instanceof InterruptedException) {
                        Thread.currentThread().interrupt();
                    }
                    return;
                }
                if (submissions.submit(id, NOVA, 0, NOVA_USER, "manufacturer", new BigDecimal("24000"), "RAC:new_model", 2,
                    "provisional", null, null).isPresent()) {
                    ok.incrementAndGet();
                }
            });
            a.get();
            b.get();
        } finally {
            pool.shutdownNow();
        }
        assertEquals(1, ok.get());
        assertEquals(1, submissions.countSubmissionEvents(id));
        assertEquals(1, submissions.countFeeSnapshots(id));
    }

    @Test
    void submissionFeeAndEventRowsAreAppendOnly() {
        UUID id = insertDraft("NC-SUB-IMM");
        assertTrue(submissions.submit(id, NOVA, 0, NOVA_USER, "manufacturer", new BigDecimal("24000.00"), "RAC:new_model", 2,
            "provisional", "FIRST_SLICE", "local demo").isPresent());
        assertThrows(Exception.class, () -> db.update("UPDATE model_application_fee_snapshot SET amount_inr = 1 WHERE application_id = ?", id));
        assertThrows(Exception.class, () -> db.update("DELETE FROM model_application_submission_event WHERE application_id = ?", id));
    }

    @Test
    void disposableCleanupRemovesSubmissionRows() {
        UUID id = insertDraft("NC-SUB-CLEAN");
        assertTrue(submissions.submit(id, NOVA, 0, NOVA_USER, "manufacturer", new BigDecimal("24000.00"), "RAC:new_model", 2,
            "provisional", null, null).isPresent());
        db.execute("""
            DO $$
            BEGIN
              PERFORM set_config('bee.test_cleanup', 'allow', true);
              DELETE FROM model_application_fee_snapshot WHERE application_id = '%s';
              DELETE FROM model_application_submission_event WHERE application_id = '%s';
              DELETE FROM model_application WHERE id = '%s';
            END $$""".formatted(id, id, id));
        assertEquals(0, submissions.countSubmissionEvents(id));
        assertEquals(0, submissions.countFeeSnapshots(id));
        assertTrue(applications.findOwned(id, NOVA).isEmpty());
    }
}
