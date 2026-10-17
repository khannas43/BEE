package gov.bee.api.workflow;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.HexFormat;
import java.util.UUID;
import java.util.concurrent.ThreadLocalRandom;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataAccessException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

@Tag("db")
class WorkflowFoundationDatabaseTest {

    static final String TAG = HexFormat.of().toHexDigits(ThreadLocalRandom.current().nextInt());
    static final String MAIN = "wp2a_test_" + TAG;
    static final UUID NOVA_ORG = UUID.fromString("00000000-0000-4000-b000-000000000001");
    static final UUID NOVA_USER = UUID.fromString("00000000-0000-4000-a000-000000000001");
    static final UUID MODEL_ID = UUID.fromString("00000000-0000-4000-c000-000000000001");
    static final UUID PROGRAMME = UUID.fromString("00000000-0000-4000-a000-000000000004");

    static JdbcTemplate admin;
    static JdbcTemplate owner;
    static JdbcTemplate runtime;
    static WorkflowFoundationRepository repo;
    static UUID registrationId;
    static int appModelCountBefore;

    static String env(String k, String d) {
        String v = System.getenv(k);
        return v == null || v.isBlank() ? d : v;
    }

    static DriverManagerDataSource migrateSource(String schema) {
        String url = "jdbc:postgresql://127.0.0.1:" + env("BEE_PG_PORT", "5434") + "/" + env("BEE_APP_DB", "bee_app")
            + (schema == null ? "" : "?currentSchema=" + schema);
        return new DriverManagerDataSource(url, env("BEE_FLYWAY_DB_USER", "bee_app"), env("BEE_FLYWAY_DB_PASSWORD", env("BEE_APP_DB_PASSWORD", "bee-local-app")));
    }

    static DriverManagerDataSource runtimeSource(String schema) {
        return new DriverManagerDataSource(
            "jdbc:postgresql://127.0.0.1:" + env("BEE_PG_PORT", "5434") + "/" + env("BEE_APP_DB", "bee_app") + "?currentSchema=" + schema,
            env("BEE_RUNTIME_DB_USER", "bee_runtime"), env("BEE_RUNTIME_DB_PASSWORD", "bee-local-runtime"));
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
        assertEquals(69, owner.queryForObject("SELECT max(installed_rank) FROM flyway_schema_history", Integer.class));
        owner.execute(Files.readString(Path.of("..", "local", "seed", "seed.sql")));
        runtime = new JdbcTemplate(runtimeSource(MAIN));
        repo = new WorkflowFoundationRepository(runtime);
        registrationId = UUID.randomUUID();
        owner.update(
            "INSERT INTO registration_application (id, reference, kind, organisation_id, brand_name, state, version) VALUES (?, ?, 'brand', ?, ?, 'draft', 0)",
            registrationId, "WF2A-" + TAG, NOVA_ORG, "WF Brand " + TAG);
    }

    @AfterAll
    static void dropAndAssertAppUntouched() {
        if (admin != null) {
            admin.execute("DROP SCHEMA IF EXISTS " + MAIN + " CASCADE");
            assertEquals(appModelCountBefore, admin.queryForObject("SELECT count(*) FROM app.model_application", Integer.class));
        }
    }

    @Test
    void policyOverlapIsRefused() {
        insertPolicy("demo_policy", 1, LocalDate.of(2026, 1, 1), LocalDate.of(2026, 6, 30), 14);
        assertThrows(DataIntegrityViolationException.class, () -> insertPolicy("demo_policy", 2, LocalDate.of(2026, 6, 1), null, 20));
    }

    static void insertPolicy(String key, int version, LocalDate from, LocalDate to, int limit) {
        owner.update(
            "INSERT INTO workflow_sla_policy_version (policy_key, version, effective_from, effective_to, calendar_key, working_day_limit, pause_while_applicant) "
                + "VALUES (?, ?, ?, ?, 'india_bee_default', ?, true)",
            key, version, java.sql.Date.valueOf(from), to == null ? null : java.sql.Date.valueOf(to), limit);
    }

    @Test
    void invalidSubjectKindAndMissingSubjectFail() {
        UUID cmd = UUID.randomUUID();
        assertThrows(DataAccessException.class, () -> runtime.update(
            "INSERT INTO workflow_task (subject_kind, subject_id, stage, action, owner_role, command_id) VALUES ('other_kind', ?, 's', 'a', 'programme', ?)",
            MODEL_ID, cmd));
        assertThrows(DataAccessException.class, () -> repo.createTask(WorkflowFoundationRepository.SUBJECT_MODEL, UUID.randomUUID(), "scrutiny", "review", "programme",
            PROGRAMME, cmd, PROGRAMME, "programme"));
    }

    @Test
    void registrationAndModelSubjectsAcceptTasksWithReplayAndUniqueness() {
        UUID cmd = UUID.randomUUID();
        var regTask = repo.createTaskIdempotent(WorkflowFoundationRepository.SUBJECT_REGISTRATION, registrationId, "scrutiny", "review", "programme", PROGRAMME, cmd,
            PROGRAMME, "programme");
        var replay = repo.createTaskIdempotent(WorkflowFoundationRepository.SUBJECT_REGISTRATION, registrationId, "scrutiny", "review", "programme", PROGRAMME, cmd,
            PROGRAMME, "programme");
        assertEquals(regTask.id(), replay.id());
        assertEquals(1, repo.countTaskEvents(regTask.id()));

        UUID cmd2 = UUID.randomUUID();
        var modelTask = repo.createTask(WorkflowFoundationRepository.SUBJECT_MODEL, MODEL_ID, "scrutiny", "review", "programme", PROGRAMME, cmd2, PROGRAMME, "programme");
        assertNotEquals(regTask.id(), modelTask.id());
        assertThrows(DataIntegrityViolationException.class, () -> repo.createTask(WorkflowFoundationRepository.SUBJECT_MODEL, MODEL_ID, "scrutiny", "review", "programme",
            PROGRAMME, UUID.randomUUID(), PROGRAMME, "programme"));
    }

    @Test
    void reassignmentKeepsImmutableEvidenceAndVersioning() {
        UUID cmd = UUID.randomUUID();
        var task = repo.createTask(WorkflowFoundationRepository.SUBJECT_MODEL, MODEL_ID, "stage_b", "act_b", "programme", PROGRAMME, cmd, PROGRAMME, "programme");
        repo.reassignTask(task.id(), task.version(), "director", NOVA_USER, PROGRAMME, "programme", "supervisor reroute");
        var after = repo.findTask(task.id()).orElseThrow();
        assertEquals(1, after.version());
        assertEquals(2, repo.countTaskEvents(task.id()));
    }

    @Test
    void appendOnlyTablesRejectRuntimeUpdates() {
        UUID cmd = UUID.randomUUID();
        var task = repo.createTask(WorkflowFoundationRepository.SUBJECT_REGISTRATION, registrationId, "stage_c", "act_c", "programme", PROGRAMME, cmd, PROGRAMME, "programme");
        UUID eventId = runtime.queryForObject("SELECT id FROM workflow_task_event WHERE task_id = ? LIMIT 1", UUID.class, task.id());
        assertThrows(DataAccessException.class, () -> runtime.update("UPDATE workflow_task_event SET reason = 'tamper' WHERE id = ?", eventId));
    }

    @Test
    void discrepancyResponseAndDispositionStayLinked() {
        UUID disc = repo.openDiscrepancy(WorkflowFoundationRepository.SUBJECT_REGISTRATION, registrationId, "doc_missing", "Upload trademark", PROGRAMME);
        assertThrows(DataAccessException.class, () -> repo.disposeDiscrepancy(disc, "accepted", "ok", PROGRAMME));
        repo.addDiscrepancyResponse(disc, 1, "Attached file", NOVA_USER);
        repo.disposeDiscrepancy(disc, "accepted", "ok", PROGRAMME);
        assertThrows(DataIntegrityViolationException.class, () -> repo.addDiscrepancyResponse(disc, 1, "duplicate seq", NOVA_USER));
        assertThrows(DataAccessException.class, () -> runtime.update("UPDATE workflow_discrepancy_response SET body = 'x' WHERE discrepancy_id = ?", disc));
    }

    @Test
    void workingDayDueUsesPersistedCalendarAndPauseEvents() {
        owner.update("INSERT INTO workflow_calendar_closure (calendar_key, closure_date, reason) VALUES ('india_bee_default', DATE '2026-5-1', 'holiday')");
        var spec = repo.loadCalendarSpec("india_bee_default").orElseThrow();
        Instant start = LocalDate.of(2026, 4, 30).atTime(9, 0).atZone(ZoneId.of("Asia/Kolkata")).toInstant();
        Instant due = WorkingDaySla.dueAtEndOfWorkingDay(start, 2, spec);
        assertTrue(due.atZone(WorkingDaySla.ZONE).toLocalDate().isAfter(LocalDate.of(2026, 5, 1)));

        repo.appendClockEvent(WorkflowFoundationRepository.SUBJECT_MODEL, MODEL_ID, "demo_policy", "start", "bureau", start, null);
        repo.appendClockEvent(WorkflowFoundationRepository.SUBJECT_MODEL, MODEL_ID, "demo_policy", "pause", "applicant", start.plusSeconds(60), null);
        repo.appendClockEvent(WorkflowFoundationRepository.SUBJECT_MODEL, MODEL_ID, "demo_policy", "resume", "applicant", start.plusSeconds(86400), null);
        var pauses = WorkingDaySla.applicantPausesFromClockEvents(repo.loadClockEvents(WorkflowFoundationRepository.SUBJECT_MODEL, MODEL_ID));
        assertEquals(1, pauses.size());
    }
}
