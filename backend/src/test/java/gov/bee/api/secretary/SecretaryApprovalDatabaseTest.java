package gov.bee.api.secretary;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import gov.bee.api.application.ModelApplicationRepository;
import gov.bee.api.application.ModelApplicationSubmitRepository;
import gov.bee.api.finance.FeeConfirmationRepository;
import gov.bee.api.iame.IameRecommendationRepository;
import gov.bee.api.director.DirectorRecommendationRepository;
import gov.bee.api.secretary.SecretaryApprovalRepository.Outcome;
import gov.bee.api.rating.RatingRepository;
import gov.bee.api.reviewer.ReviewerForwardRepository;
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
import org.springframework.aop.framework.ProxyFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.transaction.annotation.AnnotationTransactionAttributeSource;
import org.springframework.transaction.interceptor.TransactionInterceptor;

/** First slice step 7 (the Secretary gives final approval) against throwaway PostgreSQL; the shared app schema is untouched. */
@Tag("db")
class SecretaryApprovalDatabaseTest {

    static final String TAG = HexFormat.of().toHexDigits(ThreadLocalRandom.current().nextInt());
    static final String MAIN = "wp07f_test_" + TAG;
    static final Path SEED = Path.of("..", "local", "seed", "seed.sql");
    static final UUID NOVA = UUID.fromString("00000000-0000-4000-b000-000000000001");
    static final UUID NOVA_USER = UUID.fromString("00000000-0000-4000-a000-000000000001");
    static final UUID FINANCE_USER = UUID.fromString("00000000-0000-4000-a000-000000000003");
    static final UUID IAME_USER = UUID.fromString("00000000-0000-4000-a000-000000000004");
    static final UUID REVIEWER_USER = UUID.fromString("00000000-0000-4000-a000-000000000005");
    static final UUID PROGRAMME_USER = UUID.fromString("00000000-0000-4000-a000-000000000006");
    static final UUID DIRECTOR_USER = UUID.fromString("00000000-0000-4000-a000-000000000007");
    static final UUID SECRETARY_USER = UUID.fromString("00000000-0000-4000-a000-000000000008");
    static final UUID NOVA_COOL = UUID.fromString("00000000-0000-4000-d000-000000000001");

    static JdbcTemplate admin;
    static JdbcTemplate owner;
    static JdbcTemplate db;
    static DriverManagerDataSource runtime;
    static ModelApplicationRepository applications;
    static ModelApplicationSubmitRepository submissions;
    static FeeConfirmationRepository feeRepo;
    static IameRecommendationRepository iameRepo;
    static ReviewerForwardRepository reviewerRepo;
    static RatingRepository ratingRepo;
    static DirectorRecommendationRepository directorRepo;
    static SecretaryApprovalRepository repo;
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

    @SuppressWarnings("unchecked")
    static <T> T transactional(T target) {
        ProxyFactory factory = new ProxyFactory(target);
        factory.setProxyTargetClass(true);
        factory.addAdvice(new TransactionInterceptor(new DataSourceTransactionManager(runtime), new AnnotationTransactionAttributeSource()));
        return (T) factory.getProxy();
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
        var superuser = new JdbcTemplate(sourceAs(MAIN, "bee_super", env("BEE_PG_SUPER_PASSWORD", "bee-local-super")));
        String maint = env("BEE_MAINT_DB_USER", "bee_local_maint");
        superuser.execute("GRANT USAGE ON SCHEMA " + MAIN + " TO " + maint);
        owner.execute("GRANT ALL ON ALL TABLES IN SCHEMA " + MAIN + " TO " + maint);
        owner.execute("GRANT EXECUTE ON FUNCTION " + MAIN + ".app_disposable_model_cleanup(uuid[]) TO " + maint);
        runtime = sourceAs(MAIN, env("BEE_RUNTIME_DB_USER", "bee_runtime"), env("BEE_RUNTIME_DB_PASSWORD", "bee-local-runtime"));
        db = new JdbcTemplate(runtime);
        applications = new ModelApplicationRepository(db);
        submissions = new ModelApplicationSubmitRepository(db, applications);
        feeRepo = transactional(new FeeConfirmationRepository(db));
        iameRepo = transactional(new IameRecommendationRepository(db));
        reviewerRepo = transactional(new ReviewerForwardRepository(db));
        ratingRepo = transactional(new RatingRepository(db));
        directorRepo = transactional(new DirectorRecommendationRepository(db));
        repo = transactional(new SecretaryApprovalRepository(db));
        assertEquals(32, owner.queryForObject("SELECT max(installed_rank) FROM flyway_schema_history", Integer.class), "migrated V1 through V32");
    }

    @AfterAll
    static void dropAndAssertAppUntouched() {
        if (admin != null) {
            admin.execute("DROP SCHEMA IF EXISTS " + MAIN + " CASCADE");
            assertEquals(appModelCountBefore, admin.queryForObject("SELECT count(*) FROM app.model_application", Integer.class));
        }
    }

    /** An application as the Director's recommendation leaves it: secretary_approval, version 6. */
    static UUID inSecretaryApproval(String model) {
        UUID id = UUID.randomUUID();
        applications.insertDraft(id, applications.nextReference(), NOVA, NOVA, NOVA_COOL, "Nova Cool", "RAC", model);
        var done = submissions.submit(id, NOVA, 0, NOVA_USER, "manufacturer", new BigDecimal("24000.00"), "RAC:new_model", 2, "provisional", "ref", "note");
        assertTrue(done.isPresent());
        UUID snapshot = submissions.findFeeSnapshot(id).orElseThrow().id();
        assertEquals(FeeConfirmationRepository.Outcome.CONFIRMED,
            feeRepo.confirm(id, 1, FINANCE_USER, "finance", snapshot, new BigDecimal("24000.00"), "UTR-" + id.toString().substring(0, 8), LocalDate.of(2026, 10, 2)).outcome());
        assertEquals(IameRecommendationRepository.Outcome.RECOMMENDED,
            iameRepo.recommend(id, 2, IAME_USER, "iame", "verified", "Report matches the declared laboratory and date.").outcome());
        assertEquals(ReviewerForwardRepository.Outcome.FORWARDED,
            reviewerRepo.forward(id, 3, REVIEWER_USER, "reviewer", "Checked against the application and the IAME note.").outcome());
        assertEquals(RatingRepository.Outcome.COMPUTED,
            ratingRepo.compute(id, 4, PROGRAMME_USER, "programme", "RAC-ISEER-DEMO-1", new BigDecimal("4.50"), new BigDecimal("4.62"), 4).outcome());
        assertEquals(DirectorRecommendationRepository.Outcome.RECOMMENDED,
            directorRepo.recommend(id, 5, DIRECTOR_USER, "director", "Rating reviewed; recommend approval.", false).outcome());
        return id;
    }

    static SecretaryApprovalRepository.Result approve(UUID appId, int version) {
        return repo.approve(appId, version, SECRETARY_USER, "secretary", "Rating reviewed; approved.");
    }

    static int count(String table, UUID appId) {
        return owner.queryForObject("SELECT count(*) FROM " + table + " WHERE application_id = ?", Integer.class, appId);
    }

    @Test
    void approveMovesTheStateToApprovedWithEventAndRecordTogether() {
        UUID id = inSecretaryApproval("SA-HAPPY");
        var r = approve(id, 6);
        assertEquals(Outcome.APPROVED, r.outcome());
        assertEquals(7, r.versionAfter());
        assertEquals("approved", owner.queryForObject("SELECT state FROM model_application WHERE id = ?", String.class, id));
        assertEquals(7, owner.queryForObject("SELECT version FROM model_application WHERE id = ?", Integer.class, id));
        var ev = owner.queryForMap("SELECT from_state, to_state, actor_account_id, actor_role, version_after FROM model_application_transition_event "
            + "WHERE application_id = ? AND action = 'secretary_approve'", id);
        assertEquals("secretary_approval", ev.get("from_state"));
        assertEquals("approved", ev.get("to_state"));
        assertEquals(SECRETARY_USER, ev.get("actor_account_id"));
        assertEquals("secretary", ev.get("actor_role"));
        assertEquals(7, ev.get("version_after"));
        var rec = owner.queryForMap("SELECT note, approved_by_account_id FROM model_application_secretary_approval WHERE application_id = ?", id);
        assertEquals("Rating reviewed; approved.", rec.get("note"));
        assertEquals(SECRETARY_USER, rec.get("approved_by_account_id"));
        assertEquals(0, owner.queryForObject("SELECT count(*) FROM assignment WHERE subject_id = ? AND active", Integer.class, id));
        assertEquals(java.util.Set.of(NOVA_USER, FINANCE_USER, IAME_USER, REVIEWER_USER, PROGRAMME_USER, DIRECTOR_USER), repo.actorsAtOtherStages(id),
            "every earlier stage counts, so none of those officers can also approve; the Secretary's own step is this stage and does not");
    }

    @Test
    void theWholeChainRunsInOrderAndEachStepWroteItsOwnEvent() {
        UUID id = inSecretaryApproval("SA-CHAIN");
        approve(id, 6);
        var actions = owner.queryForList("SELECT action FROM model_application_transition_event WHERE application_id = ? ORDER BY occurred_at, version_after", String.class, id);
        assertEquals(List.of("confirm_fee", "iame_recommend", "reviewer_forward", "compute_rating", "director_recommend", "secretary_approve"), actions);
        var versions = owner.queryForList("SELECT version_after FROM model_application_transition_event WHERE application_id = ? ORDER BY version_after", Integer.class, id);
        assertEquals(List.of(2, 3, 4, 5, 6, 7), versions, "one version bump per step");
    }

    @Test
    void anApplicationTheDirectorMadeFinalIsAlreadyApprovedAndCannotBeApprovedAgain() {
        UUID id = UUID.randomUUID();
        applications.insertDraft(id, applications.nextReference(), NOVA, NOVA, NOVA_COOL, "Nova Cool", "RAC", "SA-FINAL");
        submissions.submit(id, NOVA, 0, NOVA_USER, "manufacturer", new BigDecimal("24000.00"), "RAC:new_model", 2, "provisional", "ref", "note");
        UUID snapshot = submissions.findFeeSnapshot(id).orElseThrow().id();
        feeRepo.confirm(id, 1, FINANCE_USER, "finance", snapshot, new BigDecimal("24000.00"), "UTR-" + id.toString().substring(0, 8), LocalDate.of(2026, 10, 2));
        iameRepo.recommend(id, 2, IAME_USER, "iame", "verified", "n");
        reviewerRepo.forward(id, 3, REVIEWER_USER, "reviewer", "n");
        ratingRepo.compute(id, 4, PROGRAMME_USER, "programme", "RAC-ISEER-DEMO-1", new BigDecimal("4.50"), new BigDecimal("4.62"), 4);
        assertEquals("approved", directorRepo.recommend(id, 5, DIRECTOR_USER, "director", "final", true).toState());
        assertEquals(Outcome.STALE, approve(id, 6).outcome(), "the Director's final recommendation already approved it; the Secretary has nothing to do");
        assertEquals(0, count("model_application_secretary_approval", id));
    }

    @Test
    void aStaleVersionOrWrongStateWritesNothing() {
        UUID id = inSecretaryApproval("SA-STALE");
        assertEquals(Outcome.STALE, approve(id, 5).outcome(), "the application is at version 6");
        assertEquals(0, count("model_application_secretary_approval", id));
        assertEquals(5, count("model_application_transition_event", id));
        assertEquals(Outcome.APPROVED, approve(id, 6).outcome());
        assertEquals(Outcome.STALE, approve(id, 7).outcome(), "it is approved, so a second approval cannot apply");
        assertEquals(1, count("model_application_secretary_approval", id));
        assertEquals(6, count("model_application_transition_event", id));
    }

    @Test
    void theApprovalIsAppendOnlyOnePerApplicationAndRefusesBadNotes() {
        UUID id = inSecretaryApproval("SA-APPENDONLY");
        approve(id, 6);
        for (String sql : List.of(
            "UPDATE model_application_secretary_approval SET note = 'x' WHERE application_id = ?",
            "DELETE FROM model_application_secretary_approval WHERE application_id = ?")) {
            assertThrows(Exception.class, () -> db.update(sql, id), sql);
        }
        assertThrows(Exception.class, () -> db.execute("TRUNCATE model_application_secretary_approval"));
        assertThrows(Exception.class, () -> owner.update("DELETE FROM model_application_secretary_approval WHERE application_id = ?", id));
        UUID event = owner.queryForObject("SELECT id FROM model_application_transition_event WHERE application_id = ? AND action = 'iame_recommend'", UUID.class, id);
        String sql = "INSERT INTO model_application_secretary_approval (application_id, transition_event_id, note, approved_by_account_id) VALUES (?, ?, ?, ?)";
        assertThrows(Exception.class, () -> owner.update(sql, id, event, "a second approval", SECRETARY_USER), "one approval per application");
        UUID other = inSecretaryApproval("SA-CHECKS");
        UUID otherEvent = owner.queryForObject("SELECT id FROM model_application_transition_event WHERE application_id = ? AND action = 'iame_recommend'", UUID.class, other);
        assertThrows(Exception.class, () -> owner.update(sql, other, otherEvent, "", SECRETARY_USER), "empty note");
        assertThrows(Exception.class, () -> owner.update(sql, other, otherEvent, "x".repeat(501), SECRETARY_USER), "long note");
        assertEquals(1, count("model_application_secretary_approval", id));
        assertEquals(0, count("model_application_secretary_approval", other));
    }

    @Test
    void twoSimultaneousApprovalsHaveExactlyOneWinner() throws Exception {
        UUID id = inSecretaryApproval("SA-RACE");
        ExecutorService pool = Executors.newFixedThreadPool(2);
        CountDownLatch go = new CountDownLatch(1);
        try {
            List<Future<Outcome>> results = List.of(
                pool.submit(() -> { go.await(); return approve(id, 6).outcome(); }),
                pool.submit(() -> { go.await(); return approve(id, 6).outcome(); }));
            go.countDown();
            List<Outcome> outcomes = List.of(results.get(0).get(10, TimeUnit.SECONDS), results.get(1).get(10, TimeUnit.SECONDS));
            assertEquals(1, outcomes.stream().filter(o -> o == Outcome.APPROVED).count(), outcomes.toString());
            assertEquals(1, outcomes.stream().filter(o -> o == Outcome.STALE).count(), outcomes.toString());
        } finally {
            pool.shutdownNow();
        }
        assertEquals(1, count("model_application_secretary_approval", id));
    }

    @Test
    void disposableCleanupRemovesTheNewRowsAndOnlyForRegisteredApplications() {
        UUID id = inSecretaryApproval("SA-CLEAN");
        approve(id, 6);
        int seededAssignments = owner.queryForObject("SELECT count(*) FROM assignment WHERE subject_id <> ?", Integer.class, id);
        var maint = new JdbcTemplate(sourceAs(MAIN, env("BEE_MAINT_DB_USER", "bee_local_maint"), env("BEE_MAINT_DB_PASSWORD", "bee-local-maint")));
        maint.execute(
            "SELECT set_config('bee.cleanup_schema', '" + MAIN + "', true); "
                + "INSERT INTO " + MAIN + ".local_disposable_application (application_id) VALUES ('" + id + "'); "
                + "SELECT " + MAIN + ".app_disposable_model_cleanup(ARRAY['" + id + "']::uuid[])");
        for (String table : List.of("model_application_secretary_approval", "model_application_director_recommendation", "model_application_rating",
            "model_application_reviewer_forward", "model_application_iame_recommendation", "model_application_transition_event", "model_application_fee_confirmation")) {
            assertEquals(0, count(table, id), table);
        }
        assertEquals(0, owner.queryForObject("SELECT count(*) FROM model_application WHERE id = ?", Integer.class, id));
        assertEquals(seededAssignments, owner.queryForObject("SELECT count(*) FROM assignment", Integer.class), "seeded assignments are untouched");
        assertFalse(owner.queryForObject("SELECT has_function_privilege('" + env("BEE_RUNTIME_DB_USER", "bee_runtime") + "', '" + MAIN + ".app_disposable_model_cleanup(uuid[])', 'EXECUTE')", Boolean.class));
    }
}
