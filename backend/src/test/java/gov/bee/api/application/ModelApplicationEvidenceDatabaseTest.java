package gov.bee.api.application;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import gov.bee.api.application.ModelApplicationEvidence.Gate;
import gov.bee.api.document.DocumentRepository;
import gov.bee.api.masters.MasterDataRepository;
import gov.bee.api.masters.MasterDataService;
import java.math.BigDecimal;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDate;
import java.util.HexFormat;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.ThreadLocalRandom;
import java.util.concurrent.TimeUnit;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.transaction.support.TransactionTemplate;

/** WP05.1d evidence fields, uniqueness and gates against throwaway PostgreSQL and the seeded masters. */
@Tag("db")
class ModelApplicationEvidenceDatabaseTest {

    static final String TAG = HexFormat.of().toHexDigits(ThreadLocalRandom.current().nextInt());
    static final String MAIN = "wp05d_test_" + TAG;
    static final Path SEED = Path.of("..", "local", "seed", "seed.sql");
    static final UUID NOVA = UUID.fromString("00000000-0000-4000-b000-000000000001");
    static final UUID NOVA_USER = UUID.fromString("00000000-0000-4000-a000-000000000001");
    static final UUID NOVA_COOL = UUID.fromString("00000000-0000-4000-d000-000000000001");
    static final LocalDate TODAY = LocalDate.of(2026, 10, 3);

    static JdbcTemplate admin;
    static JdbcTemplate owner;
    static JdbcTemplate db;
    static DriverManagerDataSource runtime;
    static ModelApplicationRepository applications;
    static DocumentRepository documents;
    static ModelApplicationEvidence evidence;
    static int appModelCountBefore;

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
        appModelCountBefore = admin.queryForObject("SELECT count(*) FROM app.model_application", Integer.class);
        admin.execute("DROP SCHEMA IF EXISTS " + MAIN + " CASCADE");
        admin.execute("CREATE SCHEMA " + MAIN);
        Flyway.configure().dataSource(migrateSource(MAIN)).schemas(MAIN).defaultSchema(MAIN).createSchemas(false)
            .locations("classpath:db/migration").load().migrate();
        owner = new JdbcTemplate(migrateSource(MAIN));
        owner.execute(Files.readString(SEED));
        runtime = sourceAs(MAIN, env("BEE_RUNTIME_DB_USER", "bee_runtime"), env("BEE_RUNTIME_DB_PASSWORD", "bee-local-runtime"));
        db = new JdbcTemplate(runtime);
        applications = new ModelApplicationRepository(db);
        documents = new DocumentRepository(db);
        evidence = new ModelApplicationEvidence(documents, new MasterDataService(new MasterDataRepository(db)), applications);
    }

    @AfterAll
    static void dropAndAssertAppUntouched() {
        if (admin != null) {
            admin.execute("DROP SCHEMA IF EXISTS " + MAIN + " CASCADE");
            assertEquals(appModelCountBefore, admin.queryForObject("SELECT count(*) FROM app.model_application", Integer.class));
        }
    }

    static UUID draft(String model) {
        UUID id = UUID.randomUUID();
        applications.insertDraft(id, applications.nextReference(), NOVA, NOVA, NOVA_COOL, "Nova Cool", "RAC", model);
        return id;
    }

    static void setState(UUID id, String state) {
        owner.update("UPDATE model_application SET state = ? WHERE id = ?", state, id);
    }

    static ModelApplicationRepository.Row row(UUID id) {
        return applications.findOwned(id, NOVA).orElseThrow();
    }

    static void uploadReport(UUID appId) {
        var doc = documents.insertDocument(UUID.randomUUID(), appId, "test_report");
        documents.insertVersion(UUID.randomUUID(), doc.id(), 1, "a".repeat(64), 12, "application/pdf", "r.pdf", "Lab", null, null, NOVA_USER);
    }

    static void evidenceFields(UUID id, String lab, LocalDate testedOn, String iseer) {
        applications.setEvidence(id, NOVA, new ModelApplicationRepository.EvidenceUpdate(true, lab, true, testedOn, true,
            iseer == null ? null : new BigDecimal(iseer)));
    }

    static List<Gate> unmet(UUID id) {
        return evidence.evaluate(row(id), TODAY).gates().stream().filter(g -> !g.met()).map(ModelApplicationEvidence.GateResult::gate).toList();
    }

    @Test
    void evidenceUpdateSetsOnlyWhatTheWriteCarried() {
        UUID id = draft("EV-PARTIAL");
        evidenceFields(id, "LAB", LocalDate.of(2026, 9, 1), "4.50");
        applications.setEvidence(id, NOVA, new ModelApplicationRepository.EvidenceUpdate(false, null, true, LocalDate.of(2026, 9, 2), false, null));
        var r = row(id);
        assertEquals("LAB", r.laboratoryCode());
        assertEquals(LocalDate.of(2026, 9, 2), r.testedOn());
        assertEquals(0, new BigDecimal("4.50").compareTo(r.declaredIseer()));
        applications.setEvidence(id, NOVA, new ModelApplicationRepository.EvidenceUpdate(true, null, false, null, true, null));
        var cleared = row(id);
        assertEquals(null, cleared.laboratoryCode());
        assertEquals(null, cleared.declaredIseer());
        assertEquals(LocalDate.of(2026, 9, 2), cleared.testedOn(), "an explicit null clears only that field");
        assertEquals(0, cleared.version(), "evidence writes never touch the version");
    }

    @Test
    void evidenceCannotBeChangedOnceTheApplicationLeavesDraft() {
        UUID id = draft("EV-FROZEN");
        evidenceFields(id, "LAB", LocalDate.of(2026, 9, 1), "4.50");
        setState(id, "fee_due");
        evidenceFields(id, "OTHER", LocalDate.of(2026, 9, 5), "3.00");
        assertEquals("LAB", row(id).laboratoryCode(), "the update is guarded by state = 'draft'");
    }

    @Test
    void databaseRefusesNonPositiveEfficiencyAndUnknownLaboratory() {
        UUID id = draft("EV-CHECKS");
        assertThrows(Exception.class, () -> evidenceFields(id, "LAB", null, "0"));
        assertThrows(Exception.class, () -> evidenceFields(id, "NO-SUCH-LAB", null, null));
    }

    @Test
    void laboratoryChoicesAndExistence() {
        assertEquals(List.of("LAB"), applications.laboratoriesFor("RAC").stream().map(ModelApplicationRepository.LaboratoryChoice::code).toList());
        assertTrue(applications.laboratoriesFor("XX").isEmpty());
        assertTrue(applications.laboratoryExists("LAB"));
        assertFalse(applications.laboratoryExists("NOVA"), "an organisation that is not a laboratory");
        assertFalse(applications.laboratoryExists("NOPE"));
    }

    @Test
    void oneLiveApplicationPerBrandAndModelNumber() {
        UUID a = draft("DUP-1");
        UUID b = draft("  dup-1 ");
        assertFalse(applications.modelNumberTaken(NOVA_COOL, "DUP-1", b), "drafts do not claim the number");
        setState(a, "fee_due");
        assertTrue(applications.modelNumberTaken(NOVA_COOL, "dup-1", b), "case and surrounding spaces are ignored");
        assertFalse(applications.modelNumberTaken(NOVA_COOL, "DUP-1", a), "an application does not conflict with itself");
        assertThrows(DuplicateKeyException.class, () -> setState(b, "fee_due"), "the index backs the check");
        setState(a, "rejected");
        setState(b, "fee_due");
        assertFalse(applications.modelNumberTaken(NOVA_COOL, "DUP-1", b), "a rejected application releases the number");
    }

    @Test
    void gatesAgainstTheSeededAccreditationHistory() {
        UUID id = draft("GATE-DATES");
        uploadReport(id);
        record Case(LocalDate tested, boolean accredited, boolean standard, String why) {
        }
        for (Case c : List.of(
            new Case(LocalDate.of(2026, 5, 1), true, true, "active v1, standard v1"),
            new Case(LocalDate.of(2026, 9, 1), true, true, "active v3, standard v2"),
            new Case(LocalDate.of(2026, 6, 15), false, true, "suspended"),
            new Case(LocalDate.of(2026, 7, 15), false, true, "gap between accreditations"),
            new Case(LocalDate.of(2025, 12, 1), false, false, "before any record"))) {
            evidenceFields(id, "LAB", c.tested(), "4.50");
            List<Gate> unmet = unmet(id);
            assertEquals(c.accredited(), !unmet.contains(Gate.LABORATORY_NOT_ACCREDITED), c.why());
            assertEquals(c.standard(), !unmet.contains(Gate.STANDARD_NOT_AVAILABLE), c.why());
        }
    }

    @Test
    void everyGateAndTheResolvedVersions() {
        UUID id = draft("GATE-ALL");
        assertEquals(List.of(Gate.TEST_REPORT_REQUIRED, Gate.DECLARED_EFFICIENCY_REQUIRED, Gate.TEST_DATE_INVALID,
            Gate.LABORATORY_NOT_ACCREDITED, Gate.STANDARD_NOT_AVAILABLE), unmet(id), "an empty draft misses all but uniqueness");
        uploadReport(id);
        evidenceFields(id, "LAB", LocalDate.of(2026, 9, 1), "4.50");
        var result = evidence.evaluate(row(id), TODAY);
        assertTrue(result.allMet());
        assertEquals("LAB:RAC", result.resolved().orElseThrow().accreditationRuleKey());
        assertEquals(3, result.resolved().orElseThrow().accreditationVersion());
        assertEquals("RAC:performance_test", result.resolved().orElseThrow().standardRuleKey());
        assertEquals(2, result.resolved().orElseThrow().standardVersion());
        evidenceFields(id, "LAB", TODAY.plusDays(1), "4.50");
        assertTrue(unmet(id).contains(Gate.TEST_DATE_INVALID), "a future test date is refused");
        evidenceFields(id, "LAB", TODAY, "4.50");
        assertFalse(unmet(id).contains(Gate.TEST_DATE_INVALID), "today is allowed");
        assertTrue(evidence.evaluate(row(id), TODAY).resolved().isPresent());
    }

    @Test
    void snapshotKeepsTheResolvedMasterVersions() {
        UUID id = draft("GATE-SNAPSHOT");
        var submissions = new ModelApplicationSubmitRepository(db, applications);
        submissions.recordEvidenceSnapshot(id, NOVA, "LAB:RAC", 3, "RAC:performance_test", 2);
        assertEquals(3, owner.queryForObject("SELECT accreditation_version FROM model_application WHERE id = ?", Integer.class, id));
        assertEquals("RAC:performance_test", owner.queryForObject("SELECT standard_rule_key FROM model_application WHERE id = ?", String.class, id));
    }

    @Test
    void sameModelSubmitsQueueOnTheAdvisoryLock() throws Exception {
        var tm = new DataSourceTransactionManager(runtime);
        var tx = new TransactionTemplate(tm);
        var shared = new ModelApplicationRepository(new JdbcTemplate(runtime));
        CountDownLatch holding = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        // Three threads: one holds the lock, one waits on it, and a third must still be able to run.
        ExecutorService pool = Executors.newFixedThreadPool(3);
        try {
            Future<?> first = pool.submit(() -> tx.execute(status -> {
                shared.lockModelKey(NOVA_COOL, "LOCK-1");
                holding.countDown();
                try {
                    release.await(10, TimeUnit.SECONDS);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
                return null;
            }));
            assertTrue(holding.await(5, TimeUnit.SECONDS));
            Future<?> second = pool.submit(() -> tx.execute(status -> {
                shared.lockModelKey(NOVA_COOL, " lock-1 ");
                return null;
            }));
            Thread.sleep(600);
            assertFalse(second.isDone(), "a second submit of the same model waits for the first");
            Future<?> other = pool.submit(() -> tx.execute(status -> {
                shared.lockModelKey(NOVA_COOL, "A-DIFFERENT-MODEL");
                return null;
            }));
            other.get(5, TimeUnit.SECONDS);
            release.countDown();
            first.get(5, TimeUnit.SECONDS);
            second.get(5, TimeUnit.SECONDS);
        } finally {
            release.countDown();
            pool.shutdownNow();
        }
    }
}
