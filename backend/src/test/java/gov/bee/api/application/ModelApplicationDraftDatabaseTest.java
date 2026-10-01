package gov.bee.api.application;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HexFormat;
import java.util.UUID;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.ThreadLocalRandom;
import java.util.concurrent.atomic.AtomicReference;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

/** WP05.1b reference allocator (V8) against throwaway PostgreSQL schemas; shared app schema untouched. */
@Tag("db")
class ModelApplicationDraftDatabaseTest {

    static final String TAG = HexFormat.of().toHexDigits(ThreadLocalRandom.current().nextInt());
    static final String MAIN = "wp051b_test_" + TAG;
    static final Path SEED = Path.of("..", "local", "seed", "seed.sql");

    static JdbcTemplate admin;
    static JdbcTemplate db;
    static ModelApplicationRepository applications;
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
        if (!schema.startsWith("wp051b_test_")) {
            throw new IllegalArgumentException(schema);
        }
        admin.execute("DROP SCHEMA IF EXISTS " + schema + " CASCADE");
        admin.execute("CREATE SCHEMA " + schema);
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
    }

    @AfterAll
    static void dropAndAssertAppUntouched() {
        if (admin != null) {
            admin.execute("DROP SCHEMA IF EXISTS " + MAIN + " CASCADE");
            assertEquals(appModelCountBefore, admin.queryForObject("SELECT count(*) FROM app.model_application", Integer.class),
                "shared app model_application count unchanged");
            assertEquals(appVersionBefore, admin.queryForObject("SELECT max(version::int) FROM app.flyway_schema_history WHERE success", Integer.class),
                "shared app migration version unchanged");
        }
    }

    @Test
    void allocatorStartsAfterSeededReferences() {
        Integer next = db.queryForObject("SELECT next_value FROM model_application_reference_allocator WHERE scope = 'LOCAL-MA'", Integer.class);
        assertEquals(4, next, "seed has LOCAL-MA-0001..0004");
        assertEquals("LOCAL-MA-0005", applications.nextReference());
        assertEquals("LOCAL-MA-0006", applications.nextReference());
    }

    @Test
    void concurrentAllocationsReceiveDistinctReferences() throws Exception {
        CyclicBarrier gate = new CyclicBarrier(2);
        AtomicReference<String> left = new AtomicReference<>();
        AtomicReference<String> right = new AtomicReference<>();
        var pool = Executors.newFixedThreadPool(2);
        try {
            Future<?> f1 = pool.submit(() -> {
                gate.await();
                left.set(applications.nextReference());
                return null;
            });
            Future<?> f2 = pool.submit(() -> {
                gate.await();
                right.set(applications.nextReference());
                return null;
            });
            f1.get();
            f2.get();
        } finally {
            pool.shutdownNow();
        }
        assertNotEquals(left.get(), right.get(), "two concurrent allocations must not collide");
        assertTrue(left.get().startsWith("LOCAL-MA-"));
        assertTrue(right.get().startsWith("LOCAL-MA-"));
    }

    @Test
    void seedReplayDoesNotRewindAllocatorAfterDraftRemoved() {
        UUID filing = UUID.fromString("00000000-0000-4000-b000-000000000001");
        UUID principal = filing;
        UUID brand = UUID.fromString("00000000-0000-4000-d000-000000000001");
        String ref1 = applications.nextReference();
        UUID draftId = UUID.fromString("00000000-0000-4000-c000-00000000f001");
        applications.insertDraft(draftId, ref1, filing, principal, brand, "Nova Cool", "RAC", "SEED-TEST-1");
        db.update("DELETE FROM model_application WHERE id = ?", draftId);
        int beforeReseed = db.queryForObject("SELECT next_value FROM model_application_reference_allocator WHERE scope = 'LOCAL-MA'", Integer.class);
        db.execute(seed);
        int afterReseed = db.queryForObject("SELECT next_value FROM model_application_reference_allocator WHERE scope = 'LOCAL-MA'", Integer.class);
        assertTrue(afterReseed >= beforeReseed, "seed must not lower next_value after a higher reference was issued");
        String ref2 = applications.nextReference();
        assertNotEquals(ref1, ref2, "re-seed must not reuse a reference that was already allocated");
    }
}
