package gov.bee.api.director;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import gov.bee.api.application.ModelApplicationRepository;
import gov.bee.api.application.ModelApplicationSubmitRepository;
import gov.bee.api.finance.FeeConfirmationRepository;
import gov.bee.api.iame.IameRecommendationRepository;
import gov.bee.api.director.DirectorRecommendationRepository.Outcome;
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

/** First slice step 6 (the Director recommends) against throwaway PostgreSQL; the shared app schema is untouched. */
@Tag("db")
class DirectorRecommendationDatabaseTest {

    static final String TAG = HexFormat.of().toHexDigits(ThreadLocalRandom.current().nextInt());
    static final String MAIN = "wp07e_test_" + TAG;
    static final Path SEED = Path.of("..", "local", "seed", "seed.sql");
    static final UUID NOVA = UUID.fromString("00000000-0000-4000-b000-000000000001");
    static final UUID NOVA_USER = UUID.fromString("00000000-0000-4000-a000-000000000001");
    static final UUID FINANCE_USER = UUID.fromString("00000000-0000-4000-a000-000000000003");
    static final UUID IAME_USER = UUID.fromString("00000000-0000-4000-a000-000000000004");
    static final UUID REVIEWER_USER = UUID.fromString("00000000-0000-4000-a000-000000000005");
    static final UUID PROGRAMME_USER = UUID.fromString("00000000-0000-4000-a000-000000000006");
    static final UUID DIRECTOR_USER = UUID.fromString("00000000-0000-4000-a000-000000000007");
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
    static DirectorRecommendationRepository repo;
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
        repo = transactional(new DirectorRecommendationRepository(db));
        assertEquals(39, owner.queryForObject("SELECT max(installed_rank) FROM flyway_schema_history", Integer.class), "migrated V1 through V39");
    }

    @AfterAll
    static void dropAndAssertAppUntouched() {
        if (admin != null) {
            admin.execute("DROP SCHEMA IF EXISTS " + MAIN + " CASCADE");
            assertEquals(appModelCountBefore, admin.queryForObject("SELECT count(*) FROM app.model_application", Integer.class));
        }
    }

    /** An application as Programme leaves it: director_review, version 5, with a recorded rating. */
    static UUID inDirectorReview(String model) {
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
        return id;
    }

    static DirectorRecommendationRepository.Result recommend(UUID appId, int version, boolean directorFinal) {
        return repo.recommend(appId, version, DIRECTOR_USER, "director", "Rating reviewed; recommend approval.", directorFinal);
    }

    static int count(String table, UUID appId) {
        return owner.queryForObject("SELECT count(*) FROM " + table + " WHERE application_id = ?", Integer.class, appId);
    }

    @Test
    void theOnlySeededRuleKeepsTheSecretaryInTheChainAndIsAppendOnly() {
        assertFalse(repo.directorFinal("RAC", LocalDate.of(2026, 10, 4)), "RAC is not final by default, so the Secretary step is exercised");
        assertFalse(repo.directorFinal("RAC", LocalDate.of(2025, 12, 31)), "no rule has started: fail safe, not final");
        assertFalse(repo.directorFinal("XYZ", LocalDate.of(2026, 10, 4)), "no rule for the category: not final");
        assertEquals(1, owner.queryForObject("SELECT count(*) FROM director_final_rule WHERE category_code = 'RAC'", Integer.class), "the only seeded rule is RAC");
        assertThrows(Exception.class, () -> db.update("INSERT INTO director_final_rule (category_code, effective_from, director_final, source_reference, note) VALUES ('RAC','2026-11-01',true,'s','n')"));
        assertThrows(Exception.class, () -> db.update("UPDATE director_final_rule SET director_final = true"));
        assertThrows(Exception.class, () -> owner.update("DELETE FROM director_final_rule"));
    }

    @Test
    void theLatestStartedRuleWinsAndAChangeIsANewRow() {
        // A throwaway category, so the seeded RAC rule is untouched; the table is append-only, so this schema is simply dropped afterwards.
        owner.update("INSERT INTO director_final_rule (category_code, effective_from, director_final, source_reference, note) VALUES ('TST', '2026-01-01', false, 'test', 'n')");
        owner.update("INSERT INTO director_final_rule (category_code, effective_from, director_final, source_reference, note) VALUES ('TST', '2026-06-01', true, 'test', 'n')");
        owner.update("INSERT INTO director_final_rule (category_code, effective_from, director_final, source_reference, note) VALUES ('TST', '2027-01-01', false, 'test', 'n')");
        assertFalse(repo.directorFinal("TST", LocalDate.of(2026, 5, 31)));
        assertTrue(repo.directorFinal("TST", LocalDate.of(2026, 6, 1)), "final from the day the row starts");
        assertTrue(repo.directorFinal("TST", LocalDate.of(2026, 12, 31)));
        assertFalse(repo.directorFinal("TST", LocalDate.of(2027, 1, 1)), "a later row can take it back");
    }

    @Test
    void notFinalGoesToTheSecretaryWithEventAndRecordTogether() {
        UUID id = inDirectorReview("DR-SECRETARY");
        var r = recommend(id, 5, false);
        assertEquals(Outcome.RECOMMENDED, r.outcome());
        assertEquals(6, r.versionAfter());
        assertEquals("secretary_approval", r.toState());
        assertEquals("secretary_approval", owner.queryForObject("SELECT state FROM model_application WHERE id = ?", String.class, id));
        assertEquals(6, owner.queryForObject("SELECT version FROM model_application WHERE id = ?", Integer.class, id));
        var ev = owner.queryForMap("SELECT from_state, to_state, actor_account_id, actor_role, version_after FROM model_application_transition_event "
            + "WHERE application_id = ? AND action = 'director_recommend'", id);
        assertEquals("director_review", ev.get("from_state"));
        assertEquals("secretary_approval", ev.get("to_state"));
        assertEquals(DIRECTOR_USER, ev.get("actor_account_id"));
        assertEquals("director", ev.get("actor_role"));
        var rec = owner.queryForMap("SELECT note, director_final, resulting_state, recommended_by_account_id FROM model_application_director_recommendation WHERE application_id = ?", id);
        assertEquals("Rating reviewed; recommend approval.", rec.get("note"));
        assertEquals(false, rec.get("director_final"));
        assertEquals("secretary_approval", rec.get("resulting_state"));
        assertEquals(0, owner.queryForObject("SELECT count(*) FROM assignment WHERE subject_id = ? AND active", Integer.class, id), "the Secretary reads the stage by role");
        assertEquals(java.util.Set.of(NOVA_USER, FINANCE_USER, IAME_USER, REVIEWER_USER, PROGRAMME_USER), repo.actorsAtOtherStages(id), "the earlier stages count; the Director's own step is this stage and does not");
    }

    @Test
    void finalForTheCategoryGoesStraightToApproved() {
        UUID id = inDirectorReview("DR-FINAL");
        var r = recommend(id, 5, true);
        assertEquals(Outcome.RECOMMENDED, r.outcome());
        assertEquals("approved", r.toState());
        assertEquals("approved", owner.queryForObject("SELECT state FROM model_application WHERE id = ?", String.class, id));
        var ev = owner.queryForMap("SELECT to_state FROM model_application_transition_event WHERE application_id = ? AND action = 'director_recommend'", id);
        assertEquals("approved", ev.get("to_state"));
        var rec = owner.queryForMap("SELECT director_final, resulting_state FROM model_application_director_recommendation WHERE application_id = ?", id);
        assertEquals(true, rec.get("director_final"));
        assertEquals("approved", rec.get("resulting_state"));
    }

    @Test
    void theRecordRefusesAFinalFlagThatDisagreesWithTheState() {
        UUID id = inDirectorReview("DR-CHECK");
        UUID event = owner.queryForObject("SELECT id FROM model_application_transition_event WHERE application_id = ? AND action = 'iame_recommend'", UUID.class, id);
        String sql = "INSERT INTO model_application_director_recommendation (application_id, transition_event_id, note, director_final, resulting_state, recommended_by_account_id) VALUES (?, ?, ?, ?, ?, ?)";
        assertThrows(Exception.class, () -> owner.update(sql, id, event, "n", true, "secretary_approval", DIRECTOR_USER), "final but not approved");
        assertThrows(Exception.class, () -> owner.update(sql, id, event, "n", false, "approved", DIRECTOR_USER), "approved but not final");
        assertThrows(Exception.class, () -> owner.update(sql, id, event, "", false, "secretary_approval", DIRECTOR_USER), "empty note");
        assertThrows(Exception.class, () -> owner.update(sql, id, event, "x".repeat(501), false, "secretary_approval", DIRECTOR_USER), "long note");
        assertEquals(0, count("model_application_director_recommendation", id));
    }

    @Test
    void aStaleVersionOrWrongStateWritesNothing() {
        UUID id = inDirectorReview("DR-STALE");
        assertEquals(Outcome.STALE, recommend(id, 4, false).outcome(), "the application is at version 5");
        assertEquals(0, count("model_application_director_recommendation", id));
        assertEquals(4, count("model_application_transition_event", id));
        assertEquals(Outcome.RECOMMENDED, recommend(id, 5, false).outcome());
        assertEquals(Outcome.STALE, recommend(id, 6, true).outcome(), "it is no longer in director_review, so a second recommendation cannot apply");
        assertEquals(1, count("model_application_director_recommendation", id));
    }

    @Test
    void theRuntimeRoleCannotChangeOrRemoveTheRecommendation() {
        UUID id = inDirectorReview("DR-APPENDONLY");
        recommend(id, 5, false);
        for (String sql : List.of(
            "UPDATE model_application_director_recommendation SET note = 'x' WHERE application_id = ?",
            "DELETE FROM model_application_director_recommendation WHERE application_id = ?")) {
            assertThrows(Exception.class, () -> db.update(sql, id), sql);
        }
        assertThrows(Exception.class, () -> db.execute("TRUNCATE model_application_director_recommendation"));
        assertThrows(Exception.class, () -> owner.update("DELETE FROM model_application_director_recommendation WHERE application_id = ?", id));
        assertEquals(1, count("model_application_director_recommendation", id));
    }

    @Test
    void theApplicationReadCarriesTheLatestRatingOnceThereIsOne() {
        UUID id = inDirectorReview("DR-VIEW");
        var rating = submissions.findLatestRating(id).orElseThrow();
        assertEquals(1, rating.ratingVersion());
        assertEquals("RAC-ISEER-DEMO-1", rating.schemeKey());
        assertEquals(0, new BigDecimal("4.50").compareTo(rating.declaredIseer()));
        assertEquals(0, new BigDecimal("4.62").compareTo(rating.verifiedIseer()));
        assertEquals(4, rating.stars());
        UUID unrated = UUID.randomUUID();
        applications.insertDraft(unrated, applications.nextReference(), NOVA, NOVA, NOVA_COOL, "Nova Cool", "RAC", "DR-NORATING");
        assertTrue(submissions.findLatestRating(unrated).isEmpty());
    }

    @Test
    void twoSimultaneousRecommendationsHaveExactlyOneWinner() throws Exception {
        UUID id = inDirectorReview("DR-RACE");
        ExecutorService pool = Executors.newFixedThreadPool(2);
        CountDownLatch go = new CountDownLatch(1);
        try {
            List<Future<Outcome>> results = List.of(
                pool.submit(() -> { go.await(); return recommend(id, 5, false).outcome(); }),
                pool.submit(() -> { go.await(); return recommend(id, 5, false).outcome(); }));
            go.countDown();
            List<Outcome> outcomes = List.of(results.get(0).get(10, TimeUnit.SECONDS), results.get(1).get(10, TimeUnit.SECONDS));
            assertEquals(1, outcomes.stream().filter(o -> o == Outcome.RECOMMENDED).count(), outcomes.toString());
            assertEquals(1, outcomes.stream().filter(o -> o == Outcome.STALE).count(), outcomes.toString());
        } finally {
            pool.shutdownNow();
        }
        assertEquals(1, count("model_application_director_recommendation", id));
    }

    @Test
    void disposableCleanupRemovesTheNewRowsAndOnlyForRegisteredApplications() {
        UUID id = inDirectorReview("DR-CLEAN");
        recommend(id, 5, false);
        int seededAssignments = owner.queryForObject("SELECT count(*) FROM assignment WHERE subject_id <> ?", Integer.class, id);
        int rules = owner.queryForObject("SELECT count(*) FROM director_final_rule", Integer.class);
        var maint = new JdbcTemplate(sourceAs(MAIN, env("BEE_MAINT_DB_USER", "bee_local_maint"), env("BEE_MAINT_DB_PASSWORD", "bee-local-maint")));
        maint.execute(
            "SELECT set_config('bee.cleanup_schema', '" + MAIN + "', true); "
                + "INSERT INTO " + MAIN + ".local_disposable_application (application_id) VALUES ('" + id + "'); "
                + "SELECT " + MAIN + ".app_disposable_model_cleanup(ARRAY['" + id + "']::uuid[])");
        for (String table : List.of("model_application_director_recommendation", "model_application_rating", "model_application_reviewer_forward",
            "model_application_iame_recommendation", "model_application_transition_event", "model_application_fee_confirmation")) {
            assertEquals(0, count(table, id), table);
        }
        assertEquals(0, owner.queryForObject("SELECT count(*) FROM model_application WHERE id = ?", Integer.class, id));
        assertEquals(seededAssignments, owner.queryForObject("SELECT count(*) FROM assignment", Integer.class), "seeded assignments are untouched");
        assertEquals(rules, owner.queryForObject("SELECT count(*) FROM director_final_rule", Integer.class), "the rules are untouched");
        assertFalse(owner.queryForObject("SELECT has_function_privilege('" + env("BEE_RUNTIME_DB_USER", "bee_runtime") + "', '" + MAIN + ".app_disposable_model_cleanup(uuid[])', 'EXECUTE')", Boolean.class));
    }
}
