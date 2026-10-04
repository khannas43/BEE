package gov.bee.api.iame;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import gov.bee.api.application.ModelApplicationRepository;
import gov.bee.api.application.ModelApplicationSubmitRepository;
import gov.bee.api.finance.FeeConfirmationRepository;
import gov.bee.api.iame.IameRecommendationRepository.Outcome;
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

/** First slice step 3 (the IAME officer recommends) against throwaway PostgreSQL; the shared app schema is untouched. */
@Tag("db")
class IameRecommendationDatabaseTest {

    static final String TAG = HexFormat.of().toHexDigits(ThreadLocalRandom.current().nextInt());
    static final String MAIN = "wp07b_test_" + TAG;
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
    static IameRecommendationRepository repo;
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
        repo = transactional(new IameRecommendationRepository(db));
        assertEquals(30, owner.queryForObject("SELECT max(installed_rank) FROM flyway_schema_history", Integer.class), "migrated V1 through V30");
    }

    @AfterAll
    static void dropAndAssertAppUntouched() {
        if (admin != null) {
            admin.execute("DROP SCHEMA IF EXISTS " + MAIN + " CASCADE");
            assertEquals(appModelCountBefore, admin.queryForObject("SELECT count(*) FROM app.model_application", Integer.class));
        }
    }

    /** An application as Finance leaves it: iame_scrutiny, version 2, assigned to the IAME officer. */
    static UUID inScrutiny(String model) {
        UUID id = UUID.randomUUID();
        applications.insertDraft(id, applications.nextReference(), NOVA, NOVA, NOVA_COOL, "Nova Cool", "RAC", model);
        var done = submissions.submit(id, NOVA, 0, NOVA_USER, "manufacturer", new BigDecimal("24000.00"), "RAC:new_model", 2, "provisional", "ref", "note");
        assertTrue(done.isPresent());
        UUID snapshot = submissions.findFeeSnapshot(id).orElseThrow().id();
        assertEquals(FeeConfirmationRepository.Outcome.CONFIRMED,
            feeRepo.confirm(id, 1, FINANCE_USER, "finance", snapshot, new BigDecimal("24000.00"), "UTR-" + id.toString().substring(0, 8), LocalDate.of(2026, 10, 2)).outcome());
        return id;
    }

    static IameRecommendationRepository.Result recommend(UUID appId, int version) {
        return repo.recommend(appId, version, IAME_USER, "iame", "verified", "Report matches the declared laboratory and date.");
    }

    static int count(String table, UUID appId) {
        return owner.queryForObject("SELECT count(*) FROM " + table + " WHERE application_id = ?", Integer.class, appId);
    }

    @Test
    void recommendationMovesTheStateAndWritesEventRecommendationAndAssignmentsTogether() {
        UUID id = inScrutiny("IR-HAPPY");
        var r = recommend(id, 2);
        assertEquals(Outcome.RECOMMENDED, r.outcome());
        assertEquals(3, r.versionAfter());
        assertEquals("bee_scrutiny", owner.queryForObject("SELECT state FROM model_application WHERE id = ?", String.class, id));
        assertEquals(3, owner.queryForObject("SELECT version FROM model_application WHERE id = ?", Integer.class, id));
        var ev = owner.queryForMap("SELECT action, from_state, to_state, actor_account_id, actor_role, version_after FROM model_application_transition_event "
            + "WHERE application_id = ? AND action = 'iame_recommend'", id);
        assertEquals("iame_scrutiny", ev.get("from_state"));
        assertEquals("bee_scrutiny", ev.get("to_state"));
        assertEquals(IAME_USER, ev.get("actor_account_id"));
        assertEquals("iame", ev.get("actor_role"));
        assertEquals(3, ev.get("version_after"));
        var rec = owner.queryForMap("SELECT verification, note, recommended_by_account_id FROM model_application_iame_recommendation WHERE application_id = ?", id);
        assertEquals("verified", rec.get("verification"));
        assertEquals("Report matches the declared laboratory and date.", rec.get("note"));
        assertEquals(IAME_USER, rec.get("recommended_by_account_id"));
        assertEquals(0, owner.queryForObject("SELECT count(*) FROM assignment WHERE subject_id = ? AND stage = 'iame_scrutiny' AND active", Integer.class, id),
            "the officer's own assignment is closed");
        assertEquals(1, owner.queryForObject("SELECT count(*) FROM assignment WHERE subject_id = ? AND stage = 'bee_scrutiny' AND active AND user_id = ?", Integer.class, id, REVIEWER_USER));
        assertEquals(java.util.Set.of(NOVA_USER, FINANCE_USER, IAME_USER), repo.actorsAtOtherStages(id), "the submitter, Finance and the officer are all recorded");
    }

    @Test
    void aNotVerifiedFindingIsRecordedAndForwardedWithItsNote() {
        UUID id = inScrutiny("IR-NOTVERIFIED");
        assertEquals(Outcome.RECOMMENDED, repo.recommend(id, 2, IAME_USER, "iame", "not_verified", "The laboratory name does not match the report.").outcome());
        assertEquals("not_verified", owner.queryForObject("SELECT verification FROM model_application_iame_recommendation WHERE application_id = ?", String.class, id));
        assertEquals("bee_scrutiny", owner.queryForObject("SELECT state FROM model_application WHERE id = ?", String.class, id));
    }

    @Test
    void aStaleVersionOrWrongStateWritesNothing() {
        UUID id = inScrutiny("IR-STALE");
        assertEquals(Outcome.STALE, recommend(id, 1).outcome(), "the application is at version 2");
        assertEquals(0, count("model_application_iame_recommendation", id));
        assertEquals(1, count("model_application_transition_event", id), "only Finance's event exists");
        assertEquals(Outcome.RECOMMENDED, recommend(id, 2).outcome());
        assertEquals(Outcome.STALE, recommend(id, 3).outcome(), "it is no longer iame_scrutiny, so a second recommendation cannot apply");
        assertEquals(1, count("model_application_iame_recommendation", id));
        assertEquals(2, count("model_application_transition_event", id));
    }

    @Test
    void withNoAvailableReviewerNothingIsWrittenAndTheStateStays() {
        UUID id = inScrutiny("IR-NOREVIEWER");
        owner.update("UPDATE role_assignment SET active = false WHERE role = 'reviewer'");
        try {
            assertEquals(Outcome.NO_ASSIGNEE, recommend(id, 2).outcome());
            assertEquals("iame_scrutiny", owner.queryForObject("SELECT state FROM model_application WHERE id = ?", String.class, id));
            assertEquals(0, count("model_application_iame_recommendation", id));
            assertEquals(1, count("model_application_transition_event", id));
            assertEquals(1, owner.queryForObject("SELECT count(*) FROM assignment WHERE subject_id = ? AND stage = 'iame_scrutiny' AND active", Integer.class, id),
                "the officer keeps the assignment");
        } finally {
            owner.update("UPDATE role_assignment SET active = true WHERE role = 'reviewer' AND user_id = ?", REVIEWER_USER);
        }
        assertEquals(Outcome.RECOMMENDED, recommend(id, 2).outcome(), "the same application moves once a reviewer is available");
    }

    @Test
    void theNextReviewerIsTheLeastLoadedActiveReviewerAccount() {
        UUID second = UUID.randomUUID();
        owner.update("INSERT INTO user_account (id, keycloak_subject, username, display_name) VALUES (?, ?, 'reviewer.second', 'Reviewer Second')", second, second);
        owner.update("INSERT INTO role_assignment (user_id, role, scope) VALUES (?, 'reviewer', 'assigned')", second);
        for (int i = 0; i < 4; i++) {
            UUID id = inScrutiny("IR-LOAD-" + i);
            UUID expected = owner.queryForObject(
                "SELECT u.id FROM user_account u JOIN role_assignment r ON r.user_id = u.id WHERE r.role = 'reviewer' AND r.scope = 'assigned' AND r.active AND u.status = 'active' "
                    + "ORDER BY (SELECT count(*) FROM assignment a WHERE a.user_id = u.id AND a.stage = 'bee_scrutiny' AND a.active), u.id LIMIT 1",
                UUID.class);
            assertEquals(Outcome.RECOMMENDED, recommend(id, 2).outcome());
            UUID actual = owner.queryForObject("SELECT user_id FROM assignment WHERE subject_id = ? AND stage = 'bee_scrutiny'", UUID.class, id);
            assertEquals(expected, actual, "assignment " + i + " goes to whoever had the fewest open bee_scrutiny assignments");
        }
        assertTrue(owner.queryForObject("SELECT count(*) FROM assignment WHERE user_id = ? AND stage = 'bee_scrutiny'", Long.class, second) > 0, "the second reviewer was used");
    }

    @Test
    void theRuntimeRoleCannotChangeOrRemoveTheRecommendation() {
        UUID id = inScrutiny("IR-APPENDONLY");
        recommend(id, 2);
        for (String sql : List.of(
            "UPDATE model_application_iame_recommendation SET note = 'x' WHERE application_id = ?",
            "DELETE FROM model_application_iame_recommendation WHERE application_id = ?")) {
            assertThrows(Exception.class, () -> db.update(sql, id), sql);
        }
        assertThrows(Exception.class, () -> db.execute("TRUNCATE model_application_iame_recommendation"));
        assertEquals(1, count("model_application_iame_recommendation", id));
        // The owner is refused too: the triggers make the table append-only.
        assertThrows(Exception.class, () -> owner.update("DELETE FROM model_application_iame_recommendation WHERE application_id = ?", id));
    }

    @Test
    void theTableRefusesAnUnknownFindingOrAnEmptyOrOverlongNote() {
        UUID id = inScrutiny("IR-CHECKS");
        UUID event = owner.queryForObject("SELECT id FROM model_application_transition_event WHERE application_id = ?", UUID.class, id);
        String sql = "INSERT INTO model_application_iame_recommendation (application_id, transition_event_id, verification, note, recommended_by_account_id) VALUES (?, ?, ?, ?, ?)";
        assertThrows(Exception.class, () -> owner.update(sql, id, event, "maybe", "note", IAME_USER));
        assertThrows(Exception.class, () -> owner.update(sql, id, event, "verified", "", IAME_USER));
        assertThrows(Exception.class, () -> owner.update(sql, id, event, "verified", "x".repeat(501), IAME_USER));
        assertEquals(0, count("model_application_iame_recommendation", id));
    }

    @Test
    void twoSimultaneousRecommendationsHaveExactlyOneWinner() throws Exception {
        UUID id = inScrutiny("IR-RACE");
        ExecutorService pool = Executors.newFixedThreadPool(2);
        CountDownLatch go = new CountDownLatch(1);
        try {
            List<Future<Outcome>> results = List.of(
                pool.submit(() -> { go.await(); return recommend(id, 2).outcome(); }),
                pool.submit(() -> { go.await(); return recommend(id, 2).outcome(); }));
            go.countDown();
            List<Outcome> outcomes = List.of(results.get(0).get(10, TimeUnit.SECONDS), results.get(1).get(10, TimeUnit.SECONDS));
            assertEquals(1, outcomes.stream().filter(o -> o == Outcome.RECOMMENDED).count(), outcomes.toString());
            assertEquals(1, outcomes.stream().filter(o -> o == Outcome.STALE).count(), outcomes.toString());
        } finally {
            pool.shutdownNow();
        }
        assertEquals(1, count("model_application_iame_recommendation", id));
        assertEquals(1, owner.queryForObject("SELECT count(*) FROM assignment WHERE subject_id = ? AND stage = 'bee_scrutiny'", Integer.class, id));
    }

    @Test
    void disposableCleanupRemovesTheNewRowsAndOnlyForRegisteredApplications() {
        UUID id = inScrutiny("IR-CLEAN");
        recommend(id, 2);
        int seededAssignments = owner.queryForObject("SELECT count(*) FROM assignment WHERE subject_id <> ?", Integer.class, id);
        var maint = new JdbcTemplate(sourceAs(MAIN, env("BEE_MAINT_DB_USER", "bee_local_maint"), env("BEE_MAINT_DB_PASSWORD", "bee-local-maint")));
        maint.execute(
            "SELECT set_config('bee.cleanup_schema', '" + MAIN + "', true); "
                + "INSERT INTO " + MAIN + ".local_disposable_application (application_id) VALUES ('" + id + "'); "
                + "SELECT " + MAIN + ".app_disposable_model_cleanup(ARRAY['" + id + "']::uuid[])");
        assertEquals(0, count("model_application_iame_recommendation", id));
        assertEquals(0, count("model_application_transition_event", id));
        assertEquals(0, count("model_application_fee_confirmation", id));
        assertEquals(0, owner.queryForObject("SELECT count(*) FROM assignment WHERE subject_id = ?", Integer.class, id));
        assertEquals(0, owner.queryForObject("SELECT count(*) FROM model_application WHERE id = ?", Integer.class, id));
        assertEquals(seededAssignments, owner.queryForObject("SELECT count(*) FROM assignment", Integer.class), "seeded assignments are untouched");
        assertFalse(owner.queryForObject("SELECT has_function_privilege('" + env("BEE_RUNTIME_DB_USER", "bee_runtime") + "', '" + MAIN + ".app_disposable_model_cleanup(uuid[])', 'EXECUTE')", Boolean.class));
    }
}
