package gov.bee.api.document;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HexFormat;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.ThreadLocalRandom;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.transaction.support.TransactionTemplate;
import gov.bee.api.application.IdempotencyRepository;

/** WP06.1a document metadata against throwaway PostgreSQL; shared app schema untouched. */
@Tag("db")
class ModelApplicationDocumentDatabaseTest {

    static final String TAG = HexFormat.of().toHexDigits(ThreadLocalRandom.current().nextInt());
    static final String MAIN = "wp061a_test_" + TAG;
    static final Path SEED = Path.of("..", "local", "seed", "seed.sql");
    static final UUID NOVA = UUID.fromString("00000000-0000-4000-b000-000000000001");
    static final UUID NOVA_USER = UUID.fromString("00000000-0000-4000-a000-000000000001");
    static final UUID NOVA_COOL = UUID.fromString("00000000-0000-4000-d000-000000000001");

    static JdbcTemplate admin;
    static JdbcTemplate db;
    static DocumentRepository documents;
    static DocumentRecorder recorder;
    static IdempotencyRepository idempotency;
    static TransactionTemplate tx;
    static String seed;
    static int appModelCountBefore;
    static int appVersionBefore;

    static String env(String k, String d) {
        String v = System.getenv(k);
        return v == null || v.isBlank() ? d : v;
    }

    static DriverManagerDataSource migrateSource(String schema) {
        return sourceAs(schema, env("BEE_FLYWAY_DB_USER", "bee_app"), env("BEE_FLYWAY_DB_PASSWORD", env("BEE_APP_DB_PASSWORD", "bee-local-app")));
    }

    static DriverManagerDataSource runtimeSource(String schema) {
        return sourceAs(schema, env("BEE_RUNTIME_DB_USER", "bee_runtime"), env("BEE_RUNTIME_DB_PASSWORD", "bee-local-runtime"));
    }

    static DriverManagerDataSource sourceAs(String schema, String user, String password) {
        String url = "jdbc:postgresql://127.0.0.1:" + env("BEE_PG_PORT", "5434") + "/" + env("BEE_APP_DB", "bee_app")
            + (schema == null ? "" : "?currentSchema=" + schema);
        return new DriverManagerDataSource(url, user, password);
    }

    static Flyway flyway(String schema) {
        return Flyway.configure().dataSource(migrateSource(schema)).schemas(schema).defaultSchema(schema).createSchemas(false)
            .locations("classpath:db/migration").load();
    }

    static void createSchema(String schema) {
        if (!schema.startsWith("wp061a_test_")) {
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
            id, "LOCAL-MA-T" + Math.abs(model.hashCode()), NOVA, model, NOVA_COOL, NOVA);
        return id;
    }

    @BeforeAll
    static void migrateAndSeed() throws Exception {
        admin = new JdbcTemplate(migrateSource(null));
        appModelCountBefore = admin.queryForObject("SELECT count(*) FROM app.model_application", Integer.class);
        appVersionBefore = admin.queryForObject("SELECT max(version::int) FROM app.flyway_schema_history WHERE success", Integer.class);
        seed = Files.readString(SEED);
        createSchema(MAIN);
        flyway(MAIN).migrate();
        var superuser = new JdbcTemplate(sourceAs(MAIN, "bee_super", env("BEE_PG_SUPER_PASSWORD", "bee-local-super")));
        String maint = env("BEE_MAINT_DB_USER", "bee_local_maint");
        superuser.execute("GRANT USAGE ON SCHEMA " + MAIN + " TO " + maint);
        var migrate = new JdbcTemplate(migrateSource(MAIN));
        migrate.execute("GRANT ALL ON ALL TABLES IN SCHEMA " + MAIN + " TO " + maint);
        migrate.execute("GRANT EXECUTE ON FUNCTION " + MAIN + ".app_disposable_model_cleanup(uuid[]) TO " + maint);
        db = new JdbcTemplate(runtimeSource(MAIN));
        migrate.execute(seed);
        // One shared DataSource so JdbcTemplate calls join the TransactionTemplate's transaction.
        var rt = runtimeSource(MAIN);
        db = new JdbcTemplate(rt);
        documents = new DocumentRepository(db);
        idempotency = new IdempotencyRepository(db);
        recorder = new DocumentRecorder(documents, idempotency);
        tx = new TransactionTemplate(new DataSourceTransactionManager(rt));
        Integer max = migrate.queryForObject("SELECT max(installed_rank) FROM flyway_schema_history", Integer.class);
        assertEquals(23, max, "throwaway schema migrated V1 through V23");
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
    void uploadCreatesDocumentAndAppendOnlyVersions() {
        UUID appId = insertDraft("NC-DOC-1");
        DocumentRepository.DocumentRow doc = documents.insertDocument(UUID.randomUUID(), appId, "test_report");
        DocumentRepository.VersionRow v1 = documents.insertVersion(UUID.randomUUID(), doc.id(), 1, "a".repeat(64), 12,
            "application/pdf", "a.pdf", "Lab", null, null, NOVA_USER);
        DocumentRepository.VersionRow v2 = documents.insertVersion(UUID.randomUUID(), doc.id(), 2, "b".repeat(64), 14,
            "application/pdf", "b.pdf", "Lab 2", null, "Demo Lab", NOVA_USER);
        assertEquals(2, documents.listVersions(doc.id()).size());
        assertEquals(1, v1.versionNumber());
        assertEquals(2, v2.versionNumber());
        assertThrows(Exception.class, () -> db.update("UPDATE model_application_document_version SET size_bytes = 1 WHERE id = ?", v1.id()));
        assertThrows(Exception.class, () -> db.update("DELETE FROM model_application_document_version WHERE id = ?", v1.id()));
    }

    @Test
    void runtimeCannotDeleteDocumentRows() {
        UUID appId = insertDraft("NC-DOC-PRIV");
        DocumentRepository.DocumentRow doc = documents.insertDocument(UUID.randomUUID(), appId, "test_report");
        documents.insertVersion(UUID.randomUUID(), doc.id(), 1, "c".repeat(64), 10, "application/pdf", "c.pdf", "L", null, null, NOVA_USER);
        assertThrows(Exception.class, () -> db.update("DELETE FROM model_application_document WHERE id = ?", doc.id()));
    }

    @Test
    void disposableCleanupRemovesDocumentRows() {
        UUID appId = insertDraft("NC-DOC-CLEAN");
        DocumentRepository.DocumentRow doc = documents.insertDocument(UUID.randomUUID(), appId, "test_report");
        documents.insertVersion(UUID.randomUUID(), doc.id(), 1, "d".repeat(64), 10, "application/pdf", "d.pdf", "L", null, null, NOVA_USER);
        var maint = new JdbcTemplate(sourceAs(MAIN, env("BEE_MAINT_DB_USER", "bee_local_maint"), env("BEE_MAINT_DB_PASSWORD", "bee-local-maint")));
        maint.execute(
            "SELECT set_config('bee.cleanup_schema', '" + MAIN + "', true); "
                + "INSERT INTO " + MAIN + ".local_disposable_application (application_id) VALUES ('" + appId + "'); "
                + "SELECT " + MAIN + ".app_disposable_model_cleanup(ARRAY['" + appId + "']::uuid[])");
        assertTrue(documents.listDocuments(appId).isEmpty());
        assertEquals(0, db.queryForObject("SELECT count(*) FROM model_application WHERE id = ?", Integer.class, appId));
    }

    @Test
    void runtimeCannotExecuteCleanupFunction() {
        Boolean can = db.queryForObject(
            "SELECT has_function_privilege(current_user, '" + MAIN + ".app_disposable_model_cleanup(uuid[])', 'EXECUTE')",
            Boolean.class);
        assertEquals(Boolean.FALSE, can);
    }

    static DocumentRecorder.NewVersion version(String sha) {
        return new DocumentRecorder.NewVersion(sha, 10, "r.pdf", "Lab", null, null);
    }

    static DocumentRecorder.Recorded upload(UUID appId, String key, String sha) {
        byte[] hash = new byte[32];
        hash[0] = (byte) key.hashCode();
        if (!idempotency.begin(NOVA_USER, "POST", DocumentService.ROUTE_UPLOAD, appId, key, hash)) {
            throw new IllegalStateException("begin refused");
        }
        return tx.execute(status -> recorder.record(NOVA_USER, appId, key, version(sha), r -> "{}"));
    }

    @Test
    void recorderRefusesAnApplicationThatIsNoLongerDraftAndWritesNothing() {
        UUID appId = insertDraft("NC-DOC-SUBMITTED");
        new JdbcTemplate(migrateSource(MAIN)).update("UPDATE model_application SET state = 'fee_due' WHERE id = ?", appId);
        var denied = assertThrows(DocumentRecorder.Denied.class, () -> upload(appId, "0123456789abcdef-nd1", "e".repeat(64)));
        assertEquals("not_editable", denied.code());
        assertTrue(documents.listDocuments(appId).isEmpty(), "rolled back: no header or version after a refused upload");
    }

    @Test
    void recorderCompletesTheIdempotencyRecordInTheSameTransaction() {
        UUID appId = insertDraft("NC-DOC-IDEM");
        String key = "0123456789abcdef-id1";
        upload(appId, key, "f".repeat(64));
        var stored = idempotency.find(NOVA_USER, "POST", DocumentService.ROUTE_UPLOAD, appId, key).orElseThrow();
        assertEquals(false, stored.inProgress());
        assertEquals(201, stored.responseStatus());
        assertEquals(1, documents.listVersions(documents.findByApplicationAndKind(appId, "test_report").orElseThrow().id()).size());
    }

    @Test
    void aFailureAfterTheVersionInsertRollsBackTheVersionToo() {
        UUID appId = insertDraft("NC-DOC-ROLLBACK");
        // The body renderer throws after the header and version were inserted; everything must roll back.
        assertThrows(Exception.class, () -> tx.execute(status ->
            recorder.record(NOVA_USER, appId, "0123456789abcdef-rb1", version("1".repeat(64)), r -> { throw new IllegalStateException("render"); })));
        assertTrue(documents.listDocuments(appId).isEmpty(), "no empty header and no version survive a failed upload");
    }

    @Test
    void concurrentFirstUploadsSerialiseIntoNumberedVersions() throws Exception {
        UUID appId = insertDraft("NC-DOC-RACE");
        int n = 4;
        ExecutorService pool = Executors.newFixedThreadPool(n);
        CountDownLatch go = new CountDownLatch(1);
        List<Future<DocumentRecorder.Recorded>> results = new ArrayList<>();
        for (int i = 0; i < n; i++) {
            String key = "0123456789abcdef-rc" + i;
            String sha = Integer.toString(i).repeat(64);
            results.add(pool.submit(() -> {
                go.await();
                return upload(appId, key, sha);
            }));
        }
        go.countDown();
        for (Future<DocumentRecorder.Recorded> f : results) {
            f.get();
        }
        pool.shutdown();
        assertEquals(1, documents.listDocuments(appId).size(), "exactly one header");
        var versions = documents.listVersions(documents.listDocuments(appId).get(0).id());
        assertEquals(n, versions.size());
        for (int i = 0; i < n; i++) {
            assertEquals(i + 1, versions.get(i).versionNumber());
        }
    }

    @Test
    void anUploadAfterSubmitIsRefusedEvenIfItReadTheDraftStateEarlier() throws Exception {
        UUID appId = insertDraft("NC-DOC-SUBMIT-RACE");
        var migrate = new JdbcTemplate(migrateSource(MAIN));
        // Submit commits between the service's early draft check and the recorder's transaction.
        migrate.update("UPDATE model_application SET state = 'fee_due', version = version + 1 WHERE id = ?", appId);
        assertThrows(DocumentRecorder.Denied.class, () -> upload(appId, "0123456789abcdef-sr1", "2".repeat(64)));
        assertTrue(documents.listDocuments(appId).isEmpty());
    }
}
