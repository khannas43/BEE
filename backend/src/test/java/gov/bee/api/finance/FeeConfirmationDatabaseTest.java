package gov.bee.api.finance;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import gov.bee.api.application.ModelApplicationRepository;
import gov.bee.api.application.ModelApplicationSubmitRepository;
import gov.bee.api.finance.FeeConfirmationRepository.Outcome;
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

/** First slice step 2 (Finance confirms the fee) against throwaway PostgreSQL; the shared app schema is untouched. */
@Tag("db")
class FeeConfirmationDatabaseTest {

    static final String TAG = HexFormat.of().toHexDigits(ThreadLocalRandom.current().nextInt());
    static final String MAIN = "wp07a_test_" + TAG;
    static final Path SEED = Path.of("..", "local", "seed", "seed.sql");
    static final UUID NOVA = UUID.fromString("00000000-0000-4000-b000-000000000001");
    static final UUID NOVA_USER = UUID.fromString("00000000-0000-4000-a000-000000000001");
    static final UUID FINANCE_USER = UUID.fromString("00000000-0000-4000-a000-000000000003");
    static final UUID IAME_USER = UUID.fromString("00000000-0000-4000-a000-000000000004");
    static final UUID NOVA_COOL = UUID.fromString("00000000-0000-4000-d000-000000000001");

    static JdbcTemplate admin;
    static JdbcTemplate owner;
    static JdbcTemplate db;
    static DriverManagerDataSource runtime;
    static ModelApplicationRepository applications;
    static ModelApplicationSubmitRepository submissions;
    static FeeConfirmationRepository repo;
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
        repo = transactional(new FeeConfirmationRepository(db));
        assertEquals(29, owner.queryForObject("SELECT max(installed_rank) FROM flyway_schema_history", Integer.class), "migrated V1 through V29");
    }

    @AfterAll
    static void dropAndAssertAppUntouched() {
        if (admin != null) {
            admin.execute("DROP SCHEMA IF EXISTS " + MAIN + " CASCADE");
            assertEquals(appModelCountBefore, admin.queryForObject("SELECT count(*) FROM app.model_application", Integer.class));
        }
    }

    /** A submitted application (fee_due, version 1) with its fee snapshot, as submit leaves it. */
    static UUID feeDue(String model) {
        UUID id = UUID.randomUUID();
        applications.insertDraft(id, applications.nextReference(), NOVA, NOVA, NOVA_COOL, "Nova Cool", "RAC", model);
        var done = submissions.submit(id, NOVA, 0, NOVA_USER, "manufacturer", new BigDecimal("24000.00"), "RAC:new_model", 2, "provisional", "ref", "note");
        assertTrue(done.isPresent());
        return id;
    }

    static UUID feeSnapshot(UUID appId) {
        return submissions.findFeeSnapshot(appId).orElseThrow().id();
    }

    static FeeConfirmationRepository.Result confirm(UUID appId, int version) {
        return repo.confirm(appId, version, FINANCE_USER, "finance", feeSnapshot(appId), new BigDecimal("24000.00"), "UTR-" + appId.toString().substring(0, 8), LocalDate.of(2026, 10, 2));
    }

    static int count(String table, UUID appId) {
        return owner.queryForObject("SELECT count(*) FROM " + table + " WHERE application_id = ?", Integer.class, appId);
    }

    @Test
    void confirmationMovesTheStateAndWritesEventConfirmationAndAssignmentTogether() {
        UUID id = feeDue("FC-HAPPY");
        var r = confirm(id, 1);
        assertEquals(Outcome.CONFIRMED, r.outcome());
        assertEquals(2, r.versionAfter());
        assertEquals("iame_scrutiny", owner.queryForObject("SELECT state FROM model_application WHERE id = ?", String.class, id));
        assertEquals(2, owner.queryForObject("SELECT version FROM model_application WHERE id = ?", Integer.class, id));
        var ev = owner.queryForMap("SELECT action, from_state, to_state, actor_account_id, actor_role, version_after FROM model_application_transition_event WHERE application_id = ?", id);
        assertEquals("confirm_fee", ev.get("action"));
        assertEquals("fee_due", ev.get("from_state"));
        assertEquals("iame_scrutiny", ev.get("to_state"));
        assertEquals(FINANCE_USER, ev.get("actor_account_id"));
        assertEquals("finance", ev.get("actor_role"));
        assertEquals(2, ev.get("version_after"));
        var fc = owner.queryForMap("SELECT amount_inr, receipt_reference, received_on, confirmed_by_account_id, fee_snapshot_id FROM model_application_fee_confirmation WHERE application_id = ?", id);
        assertEquals(0, new BigDecimal("24000.00").compareTo((BigDecimal) fc.get("amount_inr")));
        assertEquals(feeSnapshot(id), fc.get("fee_snapshot_id"));
        assertEquals(FINANCE_USER, fc.get("confirmed_by_account_id"));
        assertEquals(1, owner.queryForObject("SELECT count(*) FROM assignment WHERE subject_id = ? AND stage = 'iame_scrutiny' AND active AND user_id = ?", Integer.class, id, IAME_USER));
        assertEquals(java.util.Set.of(NOVA_USER, FINANCE_USER), repo.actorsAtOtherStages(id), "the submitter and the confirmer are both recorded");
    }

    @Test
    void aStaleVersionOrWrongStateWritesNothing() {
        UUID id = feeDue("FC-STALE");
        assertEquals(Outcome.STALE, confirm(id, 0).outcome(), "the application is at version 1");
        assertEquals(0, count("model_application_transition_event", id));
        assertEquals(Outcome.CONFIRMED, confirm(id, 1).outcome());
        assertEquals(Outcome.STALE, confirm(id, 2).outcome(), "it is no longer fee_due, so a second confirmation cannot apply");
        assertEquals(1, count("model_application_transition_event", id));
        assertEquals(1, count("model_application_fee_confirmation", id));
    }

    @Test
    void withNoAvailableOfficerNothingIsWrittenAndTheStateStays() {
        UUID id = feeDue("FC-NOOFFICER");
        owner.update("UPDATE role_assignment SET active = false WHERE role = 'iame'");
        try {
            var r = confirm(id, 1);
            assertEquals(Outcome.NO_ASSIGNEE, r.outcome());
            assertEquals("fee_due", owner.queryForObject("SELECT state FROM model_application WHERE id = ?", String.class, id));
            assertEquals(0, count("model_application_transition_event", id));
            assertEquals(0, count("model_application_fee_confirmation", id));
        } finally {
            owner.update("UPDATE role_assignment SET active = true WHERE role = 'iame'");
        }
        assertEquals(Outcome.CONFIRMED, confirm(id, 1).outcome(), "the same application confirms once an officer is available");
    }

    /** The active IAME account with the fewest open iame_scrutiny assignments, ties by id (the provisional D2 rule). */
    static UUID expectedOfficer() {
        return owner.queryForObject(
            "SELECT u.id FROM user_account u JOIN role_assignment r ON r.user_id = u.id WHERE r.role = 'iame' AND r.active AND u.status = 'active' "
                + "ORDER BY (SELECT count(*) FROM assignment a WHERE a.user_id = u.id AND a.stage = 'iame_scrutiny' AND a.active), u.id LIMIT 1",
            UUID.class);
    }

    @Test
    void theNextOfficerIsTheLeastLoadedActiveIameAccount() {
        UUID second = UUID.randomUUID();
        owner.update("INSERT INTO user_account (id, keycloak_subject, username, display_name) VALUES (?, ?, 'iame.second', 'IAME Second')", second, second);
        owner.update("INSERT INTO role_assignment (user_id, role, scope) VALUES (?, 'iame', 'assigned')", second);
        java.util.Set<UUID> chosen = new java.util.HashSet<>();
        for (int i = 0; i < 4; i++) {
            UUID id = feeDue("FC-LOAD-" + i);
            UUID expected = expectedOfficer();
            assertEquals(Outcome.CONFIRMED, confirm(id, 1).outcome());
            UUID actual = owner.queryForObject("SELECT user_id FROM assignment WHERE subject_id = ?", UUID.class, id);
            assertEquals(expected, actual, "assignment " + i + " goes to whoever had the fewest open assignments");
            chosen.add(actual);
        }
        // Whatever the earlier tests left behind, the load evens out across the two officers within a few applications.
        long first = owner.queryForObject("SELECT count(*) FROM assignment WHERE user_id = ? AND stage = 'iame_scrutiny'", Long.class, IAME_USER);
        long other = owner.queryForObject("SELECT count(*) FROM assignment WHERE user_id = ? AND stage = 'iame_scrutiny'", Long.class, second);
        assertTrue(Math.abs(first - other) <= Math.max(first, other), "both officers carry load: " + first + " and " + other);
        assertTrue(other > 0, "the less-loaded second officer was used");
    }

    @Test
    void theRuntimeRoleCannotChangeOrRemoveTheHistory() {
        UUID id = feeDue("FC-APPENDONLY");
        confirm(id, 1);
        for (String sql : List.of(
            "UPDATE model_application_transition_event SET actor_role = 'x' WHERE application_id = ?",
            "DELETE FROM model_application_transition_event WHERE application_id = ?",
            "UPDATE model_application_fee_confirmation SET receipt_reference = 'x' WHERE application_id = ?",
            "DELETE FROM model_application_fee_confirmation WHERE application_id = ?")) {
            assertThrows(Exception.class, () -> db.update(sql, id), sql);
        }
        assertThrows(Exception.class, () -> db.execute("TRUNCATE model_application_transition_event"));
        assertEquals(1, count("model_application_transition_event", id));
        // The owner is refused too: the triggers make both tables append-only.
        assertThrows(Exception.class, () -> owner.update("DELETE FROM model_application_fee_confirmation WHERE application_id = ?", id));
    }

    @Test
    void twoSimultaneousConfirmationsHaveExactlyOneWinner() throws Exception {
        UUID id = feeDue("FC-RACE");
        ExecutorService pool = Executors.newFixedThreadPool(2);
        CountDownLatch go = new CountDownLatch(1);
        try {
            List<Future<Outcome>> results = List.of(
                pool.submit(() -> { go.await(); return confirm(id, 1).outcome(); }),
                pool.submit(() -> { go.await(); return confirm(id, 1).outcome(); }));
            go.countDown();
            List<Outcome> outcomes = List.of(results.get(0).get(10, TimeUnit.SECONDS), results.get(1).get(10, TimeUnit.SECONDS));
            assertEquals(1, outcomes.stream().filter(o -> o == Outcome.CONFIRMED).count(), outcomes.toString());
            assertEquals(1, outcomes.stream().filter(o -> o == Outcome.STALE).count(), outcomes.toString());
        } finally {
            pool.shutdownNow();
        }
        assertEquals(1, count("model_application_transition_event", id));
        assertEquals(1, count("model_application_fee_confirmation", id));
        assertEquals(1, owner.queryForObject("SELECT count(*) FROM assignment WHERE subject_id = ?", Integer.class, id));
    }

    @Test
    void disposableCleanupRemovesTheNewRowsAndOnlyForRegisteredApplications() {
        UUID id = feeDue("FC-CLEAN");
        confirm(id, 1);
        int seededAssignments = owner.queryForObject("SELECT count(*) FROM assignment WHERE subject_id <> ?", Integer.class, id);
        var maint = new JdbcTemplate(sourceAs(MAIN, env("BEE_MAINT_DB_USER", "bee_local_maint"), env("BEE_MAINT_DB_PASSWORD", "bee-local-maint")));
        maint.execute(
            "SELECT set_config('bee.cleanup_schema', '" + MAIN + "', true); "
                + "INSERT INTO " + MAIN + ".local_disposable_application (application_id) VALUES ('" + id + "'); "
                + "SELECT " + MAIN + ".app_disposable_model_cleanup(ARRAY['" + id + "']::uuid[])");
        assertEquals(0, count("model_application_transition_event", id));
        assertEquals(0, count("model_application_fee_confirmation", id));
        assertEquals(0, owner.queryForObject("SELECT count(*) FROM assignment WHERE subject_id = ?", Integer.class, id));
        assertEquals(0, owner.queryForObject("SELECT count(*) FROM model_application WHERE id = ?", Integer.class, id));
        assertEquals(seededAssignments, owner.queryForObject("SELECT count(*) FROM assignment", Integer.class), "seeded assignments are untouched");
        assertFalse(owner.queryForObject("SELECT has_function_privilege('" + env("BEE_RUNTIME_DB_USER", "bee_runtime") + "', '" + MAIN + ".app_disposable_model_cleanup(uuid[])', 'EXECUTE')", Boolean.class));
    }
}
