package gov.bee.api.rating;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import gov.bee.api.application.ModelApplicationRepository;
import gov.bee.api.application.ModelApplicationSubmitRepository;
import gov.bee.api.finance.FeeConfirmationRepository;
import gov.bee.api.iame.IameRecommendationRepository;
import gov.bee.api.rating.RatingRepository.Outcome;
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

/** First slice step 5 (Programme computes the rating) against throwaway PostgreSQL; the shared app schema is untouched. */
@Tag("db")
class RatingDatabaseTest {

    static final String TAG = HexFormat.of().toHexDigits(ThreadLocalRandom.current().nextInt());
    static final String MAIN = "wp07d_test_" + TAG;
    static final Path SEED = Path.of("..", "local", "seed", "seed.sql");
    static final UUID NOVA = UUID.fromString("00000000-0000-4000-b000-000000000001");
    static final UUID NOVA_USER = UUID.fromString("00000000-0000-4000-a000-000000000001");
    static final UUID FINANCE_USER = UUID.fromString("00000000-0000-4000-a000-000000000003");
    static final UUID IAME_USER = UUID.fromString("00000000-0000-4000-a000-000000000004");
    static final UUID REVIEWER_USER = UUID.fromString("00000000-0000-4000-a000-000000000005");
    static final UUID PROGRAMME_USER = UUID.fromString("00000000-0000-4000-a000-000000000006");
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
    static RatingRepository repo;
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
        repo = transactional(new RatingRepository(db));
        assertEquals(39, owner.queryForObject("SELECT max(installed_rank) FROM flyway_schema_history", Integer.class), "migrated V1 through V39");
    }

    @AfterAll
    static void dropAndAssertAppUntouched() {
        if (admin != null) {
            admin.execute("DROP SCHEMA IF EXISTS " + MAIN + " CASCADE");
            assertEquals(appModelCountBefore, admin.queryForObject("SELECT count(*) FROM app.model_application", Integer.class));
        }
    }

    /** An application as the Reviewer leaves it: rating, version 4, with a declared figure of 4.50. */
    static UUID inRating(String model) {
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
        return id;
    }

    static RatingRepository.Result compute(UUID appId, int version) {
        return repo.compute(appId, version, PROGRAMME_USER, "programme", "RAC-ISEER-DEMO-1", new BigDecimal("4.50"), new BigDecimal("4.62"), 4);
    }

    static int count(String table, UUID appId) {
        return owner.queryForObject("SELECT count(*) FROM " + table + " WHERE application_id = ?", Integer.class, appId);
    }

    @Test
    void theDemoBandsAreTheFiveLocalPlaceholdersAndAreAppendOnly() {
        var bands = repo.bandsInForce("RAC", LocalDate.of(2026, 10, 4));
        assertEquals(5, bands.size());
        assertEquals("RAC-ISEER-DEMO-1", bands.get(0).schemeKey());
        assertEquals(List.of(1, 2, 3, 4, 5), bands.stream().map(RatingRepository.Band::stars).toList());
        for (int i = 1; i < bands.size(); i++) {
            assertTrue(bands.get(i).minIseer().compareTo(bands.get(i - 1).minIseer()) > 0, "thresholds rise with the stars");
        }
        assertTrue(repo.bandsInForce("RAC", LocalDate.of(2025, 12, 31)).isEmpty(), "no scheme before it starts");
        assertTrue(repo.bandsInForce("XYZ", LocalDate.of(2026, 10, 4)).isEmpty(), "no scheme for another category");
        assertEquals(1, owner.queryForObject("SELECT count(DISTINCT source_reference) FROM rating_demo_band WHERE source_reference LIKE '%not a BEE value'", Integer.class));
        assertThrows(Exception.class, () -> db.update("UPDATE rating_demo_band SET min_iseer = 1"));
        assertThrows(Exception.class, () -> db.update("INSERT INTO rating_demo_band (scheme_key, category_code, effective_from, stars, min_iseer, source_reference, note) VALUES ('X-1','RAC','2026-01-01',1,1,'s','n')"));
        assertThrows(Exception.class, () -> owner.update("DELETE FROM rating_demo_band"));
    }

    @Test
    void theMasterFormulaGuardIsUntouchedAndStillRefusesComputation() {
        assertEquals(0, owner.queryForObject("SELECT count(*) FROM master_rating_formula WHERE computation_allowed OR verification_status = 'verified'", Integer.class));
    }

    @Test
    void computeMovesTheStateAndWritesEventAndVersionedRatingTogether() {
        UUID id = inRating("RT-HAPPY");
        var r = compute(id, 4);
        assertEquals(Outcome.COMPUTED, r.outcome());
        assertEquals(5, r.versionAfter());
        assertEquals(1, r.ratingVersion());
        assertEquals("director_review", owner.queryForObject("SELECT state FROM model_application WHERE id = ?", String.class, id));
        assertEquals(5, owner.queryForObject("SELECT version FROM model_application WHERE id = ?", Integer.class, id));
        var ev = owner.queryForMap("SELECT from_state, to_state, actor_account_id, actor_role, version_after FROM model_application_transition_event "
            + "WHERE application_id = ? AND action = 'compute_rating'", id);
        assertEquals("rating", ev.get("from_state"));
        assertEquals("director_review", ev.get("to_state"));
        assertEquals(PROGRAMME_USER, ev.get("actor_account_id"));
        assertEquals("programme", ev.get("actor_role"));
        assertEquals(5, ev.get("version_after"));
        var rec = owner.queryForMap("SELECT rating_version, basis, scheme_key, declared_iseer, verified_iseer, stars, computed_by_account_id FROM model_application_rating WHERE application_id = ?", id);
        assertEquals(1, rec.get("rating_version"));
        assertEquals("local_demo", rec.get("basis"));
        assertEquals("RAC-ISEER-DEMO-1", rec.get("scheme_key"));
        assertEquals(0, new BigDecimal("4.50").compareTo((BigDecimal) rec.get("declared_iseer")), "the declared figure is kept");
        assertEquals(0, new BigDecimal("4.62").compareTo((BigDecimal) rec.get("verified_iseer")), "beside the verified one");
        assertEquals(4, ((Number) rec.get("stars")).intValue());
        assertEquals(PROGRAMME_USER, rec.get("computed_by_account_id"));
        assertEquals(0, owner.queryForObject("SELECT count(*) FROM assignment WHERE subject_id = ? AND stage IN ('rating', 'director_review')", Integer.class, id),
            "Directors read the next stage by role, so no assignment is made");
        assertEquals(java.util.Set.of(NOVA_USER, FINANCE_USER, IAME_USER, REVIEWER_USER), repo.actorsAtOtherStages(id), "the earlier stages count; Programme's own rating is this stage and does not");
    }

    @Test
    void aStaleVersionOrWrongStateWritesNothing() {
        UUID id = inRating("RT-STALE");
        assertEquals(Outcome.STALE, compute(id, 3).outcome(), "the application is at version 4");
        assertEquals(0, count("model_application_rating", id));
        assertEquals(3, count("model_application_transition_event", id));
        assertEquals(Outcome.COMPUTED, compute(id, 4).outcome());
        assertEquals(Outcome.STALE, compute(id, 5).outcome(), "it is no longer in rating, so a second computation cannot apply");
        assertEquals(1, count("model_application_rating", id));
        assertEquals(4, count("model_application_transition_event", id));
    }

    @Test
    void theRatingRecordIsAppendOnlyAndRefusesBadValues() {
        UUID id = inRating("RT-APPENDONLY");
        compute(id, 4);
        for (String sql : List.of(
            "UPDATE model_application_rating SET stars = 5 WHERE application_id = ?",
            "DELETE FROM model_application_rating WHERE application_id = ?")) {
            assertThrows(Exception.class, () -> db.update(sql, id), sql);
        }
        assertThrows(Exception.class, () -> db.execute("TRUNCATE model_application_rating"));
        assertThrows(Exception.class, () -> owner.update("DELETE FROM model_application_rating WHERE application_id = ?", id));
        assertEquals(1, count("model_application_rating", id));
        UUID event = owner.queryForObject("SELECT id FROM model_application_transition_event WHERE application_id = ? AND action = 'iame_recommend'", UUID.class, id);
        String sql = "INSERT INTO model_application_rating (application_id, transition_event_id, rating_version, basis, scheme_key, declared_iseer, verified_iseer, stars, computed_by_account_id) VALUES (?, ?, ?, ?, 'S', 4.5, 4.5, ?, ?)";
        assertThrows(Exception.class, () -> owner.update(sql, id, event, 2, "verified_formula", 3, PROGRAMME_USER), "only the local demonstration basis exists today");
        assertThrows(Exception.class, () -> owner.update(sql, id, event, 2, "local_demo", 6, PROGRAMME_USER));
        assertThrows(Exception.class, () -> owner.update(sql, id, event, 2, "local_demo", 0, PROGRAMME_USER));
        assertThrows(Exception.class, () -> owner.update(sql, id, event, 0, "local_demo", 3, PROGRAMME_USER));
        assertEquals(1, count("model_application_rating", id));
    }

    @Test
    void twoSimultaneousComputationsHaveExactlyOneWinner() throws Exception {
        UUID id = inRating("RT-RACE");
        ExecutorService pool = Executors.newFixedThreadPool(2);
        CountDownLatch go = new CountDownLatch(1);
        try {
            List<Future<Outcome>> results = List.of(
                pool.submit(() -> { go.await(); return compute(id, 4).outcome(); }),
                pool.submit(() -> { go.await(); return compute(id, 4).outcome(); }));
            go.countDown();
            List<Outcome> outcomes = List.of(results.get(0).get(10, TimeUnit.SECONDS), results.get(1).get(10, TimeUnit.SECONDS));
            assertEquals(1, outcomes.stream().filter(o -> o == Outcome.COMPUTED).count(), outcomes.toString());
            assertEquals(1, outcomes.stream().filter(o -> o == Outcome.STALE).count(), outcomes.toString());
        } finally {
            pool.shutdownNow();
        }
        assertEquals(1, count("model_application_rating", id));
    }

    @Test
    void disposableCleanupRemovesTheNewRowsAndOnlyForRegisteredApplications() {
        UUID id = inRating("RT-CLEAN");
        compute(id, 4);
        int seededAssignments = owner.queryForObject("SELECT count(*) FROM assignment WHERE subject_id <> ?", Integer.class, id);
        var maint = new JdbcTemplate(sourceAs(MAIN, env("BEE_MAINT_DB_USER", "bee_local_maint"), env("BEE_MAINT_DB_PASSWORD", "bee-local-maint")));
        maint.execute(
            "SELECT set_config('bee.cleanup_schema', '" + MAIN + "', true); "
                + "INSERT INTO " + MAIN + ".local_disposable_application (application_id) VALUES ('" + id + "'); "
                + "SELECT " + MAIN + ".app_disposable_model_cleanup(ARRAY['" + id + "']::uuid[])");
        for (String table : List.of("model_application_rating", "model_application_reviewer_forward", "model_application_iame_recommendation",
            "model_application_transition_event", "model_application_fee_confirmation")) {
            assertEquals(0, count(table, id), table);
        }
        assertEquals(0, owner.queryForObject("SELECT count(*) FROM model_application WHERE id = ?", Integer.class, id));
        assertEquals(seededAssignments, owner.queryForObject("SELECT count(*) FROM assignment", Integer.class), "seeded assignments are untouched");
        assertEquals(5, owner.queryForObject("SELECT count(*) FROM rating_demo_band", Integer.class), "the demonstration bands are untouched");
        assertFalse(owner.queryForObject("SELECT has_function_privilege('" + env("BEE_RUNTIME_DB_USER", "bee_runtime") + "', '" + MAIN + ".app_disposable_model_cleanup(uuid[])', 'EXECUTE')", Boolean.class));
    }
}
