package gov.bee.api.reviewer;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import gov.bee.api.application.ModelApplicationRepository;
import gov.bee.api.application.ModelApplicationSubmitRepository;
import gov.bee.api.finance.FeeConfirmationRepository;
import gov.bee.api.iame.IameRecommendationRepository;
import gov.bee.api.reviewer.ReviewerForwardRepository.Outcome;
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

/** First slice step 4 (the Reviewer forwards) against throwaway PostgreSQL; the shared app schema is untouched. */
@Tag("db")
class ReviewerForwardDatabaseTest {

    static final String TAG = HexFormat.of().toHexDigits(ThreadLocalRandom.current().nextInt());
    static final String MAIN = "wp07c_test_" + TAG;
    static final Path SEED = Path.of("..", "local", "seed", "seed.sql");
    static final UUID NOVA = UUID.fromString("00000000-0000-4000-b000-000000000001");
    static final UUID NOVA_USER = UUID.fromString("00000000-0000-4000-a000-000000000001");
    static final UUID FINANCE_USER = UUID.fromString("00000000-0000-4000-a000-000000000003");
    static final UUID IAME_USER = UUID.fromString("00000000-0000-4000-a000-000000000004");
    static final UUID REVIEWER_USER = UUID.fromString("00000000-0000-4000-a000-000000000005");
    static final UUID NOVA_COOL = UUID.fromString("00000000-0000-4000-d000-000000000001");

    static JdbcTemplate admin;
    static JdbcTemplate owner;
    static JdbcTemplate db;
    static DriverManagerDataSource runtime;
    static ModelApplicationRepository applications;
    static ModelApplicationSubmitRepository submissions;
    static FeeConfirmationRepository feeRepo;
    static IameRecommendationRepository iameRepo;
    static ReviewerForwardRepository repo;
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
        repo = transactional(new ReviewerForwardRepository(db));
        assertEquals(41, owner.queryForObject("SELECT max(installed_rank) FROM flyway_schema_history", Integer.class), "migrated V1 through V41");
    }

    @AfterAll
    static void dropAndAssertAppUntouched() {
        if (admin != null) {
            admin.execute("DROP SCHEMA IF EXISTS " + MAIN + " CASCADE");
            assertEquals(appModelCountBefore, admin.queryForObject("SELECT count(*) FROM app.model_application", Integer.class));
        }
    }

    /** An application as the IAME officer leaves it: bee_scrutiny, version 3, assigned to the Reviewer. */
    static UUID inBeeScrutiny(String model) {
        UUID id = UUID.randomUUID();
        applications.insertDraft(id, applications.nextReference(), NOVA, NOVA, NOVA_COOL, "Nova Cool", "RAC", model);
        var done = submissions.submit(id, NOVA, 0, NOVA_USER, "manufacturer", new BigDecimal("24000.00"), "RAC:new_model", 2, "provisional", "ref", "note");
        assertTrue(done.isPresent());
        UUID snapshot = submissions.findFeeSnapshot(id).orElseThrow().id();
        assertEquals(FeeConfirmationRepository.Outcome.CONFIRMED,
            feeRepo.confirm(id, 1, FINANCE_USER, "finance", snapshot, new BigDecimal("24000.00"), "UTR-" + id.toString().substring(0, 8), LocalDate.of(2026, 10, 2)).outcome());
        assertEquals(IameRecommendationRepository.Outcome.RECOMMENDED,
            iameRepo.recommend(id, 2, IAME_USER, "iame", "verified", "Report matches the declared laboratory and date.").outcome());
        return id;
    }

    static ReviewerForwardRepository.Result forward(UUID appId, int version) {
        return repo.forward(appId, version, REVIEWER_USER, "reviewer", "Checked against the application and the IAME note.");
    }

    static int count(String table, UUID appId) {
        return owner.queryForObject("SELECT count(*) FROM " + table + " WHERE application_id = ?", Integer.class, appId);
    }

    @Test
    void forwardMovesTheStateAndWritesEventAndRecordAndClosesTheAssignment() {
        UUID id = inBeeScrutiny("RF-HAPPY");
        var r = forward(id, 3);
        assertEquals(Outcome.FORWARDED, r.outcome());
        assertEquals(4, r.versionAfter());
        assertEquals("rating", owner.queryForObject("SELECT state FROM model_application WHERE id = ?", String.class, id));
        assertEquals(4, owner.queryForObject("SELECT version FROM model_application WHERE id = ?", Integer.class, id));
        var ev = owner.queryForMap("SELECT from_state, to_state, actor_account_id, actor_role, version_after FROM model_application_transition_event "
            + "WHERE application_id = ? AND action = 'reviewer_forward'", id);
        assertEquals("bee_scrutiny", ev.get("from_state"));
        assertEquals("rating", ev.get("to_state"));
        assertEquals(REVIEWER_USER, ev.get("actor_account_id"));
        assertEquals("reviewer", ev.get("actor_role"));
        assertEquals(4, ev.get("version_after"));
        var rec = owner.queryForMap("SELECT note, forwarded_by_account_id FROM model_application_reviewer_forward WHERE application_id = ?", id);
        assertEquals("Checked against the application and the IAME note.", rec.get("note"));
        assertEquals(REVIEWER_USER, rec.get("forwarded_by_account_id"));
        assertEquals(0, owner.queryForObject("SELECT count(*) FROM assignment WHERE subject_id = ? AND stage = 'bee_scrutiny' AND active", Integer.class, id),
            "the reviewer's own assignment is closed");
        assertEquals(0, owner.queryForObject("SELECT count(*) FROM assignment WHERE subject_id = ? AND stage = 'rating'", Integer.class, id),
            "Programme reads the rating stage by role, so no assignment is made");
        assertEquals(java.util.Set.of(NOVA_USER, FINANCE_USER, IAME_USER), repo.actorsAtOtherStages(id), "the submitter, Finance and the IAME officer count; the Reviewer's own step is this stage and does not");
    }

    @Test
    void aStaleVersionOrWrongStateWritesNothing() {
        UUID id = inBeeScrutiny("RF-STALE");
        assertEquals(Outcome.STALE, forward(id, 2).outcome(), "the application is at version 3");
        assertEquals(0, count("model_application_reviewer_forward", id));
        assertEquals(2, count("model_application_transition_event", id), "only Finance's and the IAME officer's events exist");
        assertEquals(Outcome.FORWARDED, forward(id, 3).outcome());
        assertEquals(Outcome.STALE, forward(id, 4).outcome(), "it is no longer bee_scrutiny, so a second forward cannot apply");
        assertEquals(1, count("model_application_reviewer_forward", id));
        assertEquals(3, count("model_application_transition_event", id));
    }

    @Test
    void theRuntimeRoleCannotChangeOrRemoveTheForward() {
        UUID id = inBeeScrutiny("RF-APPENDONLY");
        forward(id, 3);
        for (String sql : List.of(
            "UPDATE model_application_reviewer_forward SET note = 'x' WHERE application_id = ?",
            "DELETE FROM model_application_reviewer_forward WHERE application_id = ?")) {
            assertThrows(Exception.class, () -> db.update(sql, id), sql);
        }
        assertThrows(Exception.class, () -> db.execute("TRUNCATE model_application_reviewer_forward"));
        assertEquals(1, count("model_application_reviewer_forward", id));
        // The owner is refused too: the triggers make the table append-only.
        assertThrows(Exception.class, () -> owner.update("DELETE FROM model_application_reviewer_forward WHERE application_id = ?", id));
    }

    @Test
    void theTableRefusesAnEmptyOrOverlongNote() {
        UUID id = inBeeScrutiny("RF-CHECKS");
        UUID event = owner.queryForObject("SELECT id FROM model_application_transition_event WHERE application_id = ? AND action = 'iame_recommend'", UUID.class, id);
        String sql = "INSERT INTO model_application_reviewer_forward (application_id, transition_event_id, note, forwarded_by_account_id) VALUES (?, ?, ?, ?)";
        assertThrows(Exception.class, () -> owner.update(sql, id, event, "", REVIEWER_USER));
        assertThrows(Exception.class, () -> owner.update(sql, id, event, "x".repeat(501), REVIEWER_USER));
        assertEquals(0, count("model_application_reviewer_forward", id));
    }

    @Test
    void twoSimultaneousForwardsHaveExactlyOneWinner() throws Exception {
        UUID id = inBeeScrutiny("RF-RACE");
        ExecutorService pool = Executors.newFixedThreadPool(2);
        CountDownLatch go = new CountDownLatch(1);
        try {
            List<Future<Outcome>> results = List.of(
                pool.submit(() -> { go.await(); return forward(id, 3).outcome(); }),
                pool.submit(() -> { go.await(); return forward(id, 3).outcome(); }));
            go.countDown();
            List<Outcome> outcomes = List.of(results.get(0).get(10, TimeUnit.SECONDS), results.get(1).get(10, TimeUnit.SECONDS));
            assertEquals(1, outcomes.stream().filter(o -> o == Outcome.FORWARDED).count(), outcomes.toString());
            assertEquals(1, outcomes.stream().filter(o -> o == Outcome.STALE).count(), outcomes.toString());
        } finally {
            pool.shutdownNow();
        }
        assertEquals(1, count("model_application_reviewer_forward", id));
    }

    @Test
    void disposableCleanupRemovesTheNewRowsAndOnlyForRegisteredApplications() {
        UUID id = inBeeScrutiny("RF-CLEAN");
        forward(id, 3);
        int seededAssignments = owner.queryForObject("SELECT count(*) FROM assignment WHERE subject_id <> ?", Integer.class, id);
        var maint = new JdbcTemplate(sourceAs(MAIN, env("BEE_MAINT_DB_USER", "bee_local_maint"), env("BEE_MAINT_DB_PASSWORD", "bee-local-maint")));
        maint.execute(
            "SELECT set_config('bee.cleanup_schema', '" + MAIN + "', true); "
                + "INSERT INTO " + MAIN + ".local_disposable_application (application_id) VALUES ('" + id + "'); "
                + "SELECT " + MAIN + ".app_disposable_model_cleanup(ARRAY['" + id + "']::uuid[])");
        assertEquals(0, count("model_application_reviewer_forward", id));
        assertEquals(0, count("model_application_iame_recommendation", id));
        assertEquals(0, count("model_application_transition_event", id));
        assertEquals(0, count("model_application_fee_confirmation", id));
        assertEquals(0, owner.queryForObject("SELECT count(*) FROM assignment WHERE subject_id = ?", Integer.class, id));
        assertEquals(0, owner.queryForObject("SELECT count(*) FROM model_application WHERE id = ?", Integer.class, id));
        assertEquals(seededAssignments, owner.queryForObject("SELECT count(*) FROM assignment", Integer.class), "seeded assignments are untouched");
        assertFalse(owner.queryForObject("SELECT has_function_privilege('" + env("BEE_RUNTIME_DB_USER", "bee_runtime") + "', '" + MAIN + ".app_disposable_model_cleanup(uuid[])', 'EXECUTE')", Boolean.class));
    }
}
