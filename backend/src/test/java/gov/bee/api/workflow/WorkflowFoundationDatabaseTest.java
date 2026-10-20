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
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.ThreadLocalRandom;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataAccessException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.transaction.support.TransactionTemplate;

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
    static TransactionTemplate tx;
    static WorkflowFoundationRepository repo;
    static UUID registrationId;
    static UUID policyVersionId;
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

    static DriverManagerDataSource maintSource(String schema) {
        return new DriverManagerDataSource(
            "jdbc:postgresql://127.0.0.1:" + env("BEE_PG_PORT", "5434") + "/" + env("BEE_APP_DB", "bee_app") + "?currentSchema=" + schema,
            env("BEE_MAINT_DB_USER", "bee_local_maint"), env("BEE_MAINT_DB_PASSWORD", "bee-local-maint"));
    }

    static WorkflowFoundationRepository.TaskCommand cmd(String kind, UUID subject, String stage, String action) {
        return new WorkflowFoundationRepository.TaskCommand(kind, subject, stage, action, "programme", PROGRAMME);
    }

    static WorkflowFoundationRepository.TaskCommand slaCmd(String kind, UUID subject, String stage, String action, Instant due, UUID policy, Instant anchor) {
        return new WorkflowFoundationRepository.TaskCommand(kind, subject, stage, action, "programme", PROGRAMME, due, policy, anchor);
    }

    static UUID clockForTask(UUID taskId) {
        return repo.findClockByTaskId(taskId).orElseThrow().id();
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
        assertEquals(81, owner.queryForObject("SELECT max(installed_rank) FROM flyway_schema_history", Integer.class));
        owner.execute(Files.readString(Path.of("..", "local", "seed", "seed.sql")));
        runtime = new JdbcTemplate(runtimeSource(MAIN));
        tx = new TransactionTemplate(new DataSourceTransactionManager(runtime.getDataSource()));
        repo = new WorkflowFoundationRepository(runtime, tx);
        registrationId = UUID.randomUUID();
        owner.update(
            "INSERT INTO registration_application (id, reference, kind, organisation_id, brand_name, state, version) VALUES (?, ?, 'brand', ?, ?, 'draft', 0)",
            registrationId, "WF2A-" + TAG, NOVA_ORG, "WF Brand " + TAG);
        policyVersionId = insertPolicy("sla_demo", 1, LocalDate.of(2026, 1, 1), LocalDate.of(2026, 12, 31), 10);
    }

    @AfterAll
    static void dropAndAssertAppUntouched() {
        if (admin != null) {
            admin.execute("DROP SCHEMA IF EXISTS " + MAIN + " CASCADE");
            assertEquals(appModelCountBefore, admin.queryForObject("SELECT count(*) FROM app.model_application", Integer.class));
        }
    }

    static UUID insertPolicy(String key, int version, LocalDate from, LocalDate to, int limit) {
        return owner.queryForObject(
            "INSERT INTO workflow_sla_policy_version (policy_key, version, effective_from, effective_to, calendar_key, working_day_limit, pause_while_applicant) "
                + "VALUES (?, ?, ?, ?, 'india_bee_default', ?, true) RETURNING id",
            UUID.class, key, version, java.sql.Date.valueOf(from), to == null ? null : java.sql.Date.valueOf(to), limit);
    }

    @Test
    void policyAdjacentVersionsAcceptedAndOverlapRefused() {
        insertPolicy("adj_a", 1, LocalDate.of(2026, 1, 1), LocalDate.of(2026, 6, 1), 5);
        insertPolicy("adj_a", 2, LocalDate.of(2026, 6, 1), null, 7);
        insertPolicy("adj_b", 1, LocalDate.of(2026, 1, 1), LocalDate.of(2026, 7, 1), 5);
        assertThrows(DataIntegrityViolationException.class, () -> insertPolicy("adj_b", 2, LocalDate.of(2026, 6, 1), null, 6));
        assertThrows(DataAccessException.class, () -> runtime.update("UPDATE workflow_sla_policy_version SET note = 'x' WHERE policy_key = 'adj_a'"));
        assertThrows(DataAccessException.class, () -> owner.update("UPDATE workflow_sla_policy_version SET note = 'x' WHERE policy_key = 'adj_a'"));
    }

    @Test
    void policyApplicabilityUsesIndiaDateAtUtcBoundary() {
        UUID policy = insertPolicy("india_date", 1, LocalDate.of(2026, 1, 1), LocalDate.of(2026, 1, 2), 1);
        Instant indiaNewYear = Instant.parse("2025-12-31T18:45:00Z");
        Instant due = indiaNewYear.plusSeconds(86400);

        var task = repo.createTask(
            slaCmd(WorkflowFoundationRepository.SUBJECT_REGISTRATION, registrationId, "india_date", "review", due, policy, indiaNewYear),
            UUID.randomUUID(), PROGRAMME, "programme");

        assertEquals(indiaNewYear, repo.findClockByTaskId(task.id()).orElseThrow().policyAnchorAt());
    }

    @Test
    void idempotentReplayAndConflictAndTerminalRetention() {
        UUID command = UUID.randomUUID();
        var first = repo.createTaskIdempotent(cmd(WorkflowFoundationRepository.SUBJECT_REGISTRATION, registrationId, "scr_a", "review"), command, PROGRAMME,
            "programme");
        var replay = repo.createTaskIdempotent(cmd(WorkflowFoundationRepository.SUBJECT_REGISTRATION, registrationId, "scr_a", "review"), command, PROGRAMME,
            "programme");
        assertEquals(first.id(), replay.id());
        assertEquals(1, repo.countTaskEvents(first.id()));
        var conflict = cmd(WorkflowFoundationRepository.SUBJECT_REGISTRATION, registrationId, "scr_a", "other_action");
        assertThrows(WorkflowIdempotencyConflictException.class,
            () -> repo.createTaskIdempotent(conflict, command, PROGRAMME, "programme"));
        repo.completeTask(first.id(), first.version(), PROGRAMME, "programme", "done");
        var afterTerminal = repo.findTaskByCommandId(command).orElseThrow();
        assertEquals("completed", afterTerminal.status());
        assertEquals(command, afterTerminal.commandId());
    }

    @Test
    void staleReassignRollsBackWithoutEvent() {
        UUID command = UUID.randomUUID();
        var task = repo.createTask(cmd(WorkflowFoundationRepository.SUBJECT_MODEL, MODEL_ID, "scr_b", "review"), command, PROGRAMME, "programme");
        assertThrows(DataIntegrityViolationException.class,
            () -> repo.reassignTask(task.id(), task.version() + 1, "director", NOVA_USER, PROGRAMME, "programme", "nope"));
        assertEquals(1, repo.countTaskEvents(task.id()));
        assertEquals("programme", repo.findTask(task.id()).orElseThrow().ownerRole());
    }

    @Test
    void createTaskRollsBackWhenSecondInsertFails() {
        UUID c1 = UUID.randomUUID();
        UUID c2 = UUID.randomUUID();
        assertThrows(DataAccessException.class, () -> tx.executeWithoutResult(s -> {
            repo.createTask(cmd(WorkflowFoundationRepository.SUBJECT_MODEL, MODEL_ID, "scr_rb", "review"), c1, PROGRAMME, "programme");
            repo.createTask(cmd(WorkflowFoundationRepository.SUBJECT_MODEL, MODEL_ID, "scr_rb", "review"), c2, PROGRAMME, "programme");
        }));
        assertTrue(repo.findTaskByCommandId(c1).isEmpty());
        assertTrue(repo.findTaskByCommandId(c2).isEmpty());
    }

    @Test
    void runtimeCannotTamperProtectedColumns() {
        UUID command = UUID.randomUUID();
        var task = repo.createTask(cmd(WorkflowFoundationRepository.SUBJECT_REGISTRATION, registrationId, "scr_c", "review"), command, PROGRAMME, "programme");
        assertThrows(DataAccessException.class, () -> runtime.update("UPDATE workflow_task SET stage = 'x' WHERE id = ?", task.id()));
        UUID disc = repo.openDiscrepancy(WorkflowFoundationRepository.SUBJECT_REGISTRATION, registrationId, "tamper", "orig", PROGRAMME);
        assertThrows(DataAccessException.class, () -> runtime.update("UPDATE workflow_discrepancy SET summary = 'x' WHERE id = ?", disc));
        UUID eventId = runtime.queryForObject("SELECT id FROM workflow_task_event WHERE task_id = ? LIMIT 1", UUID.class, task.id());
        assertThrows(DataAccessException.class, () -> runtime.update("UPDATE workflow_task_event SET reason = 'tamper' WHERE id = ?", eventId));
        assertThrows(DataAccessException.class, () -> runtime.update("INSERT INTO workflow_calendar_closure (calendar_key, closure_date) VALUES ('india_bee_default', DATE '2099-01-01')"));
        runtime.execute((org.springframework.jdbc.core.ConnectionCallback<Void>) con -> {
            try (var st = con.createStatement()) {
                st.execute("SELECT set_config('bee.workflow_discrepancy_status', 'allow', true)");
            }
            return null;
        });
        assertThrows(DataAccessException.class, () -> runtime.update("UPDATE workflow_discrepancy SET status = 'closed' WHERE id = ?", disc));
        Instant due = LocalDate.of(2026, 8, 1).atTime(17, 0).atZone(ZoneId.of("Asia/Kolkata")).toInstant();
        Instant anchor = LocalDate.of(2026, 8, 1).atStartOfDay(ZoneId.of("Asia/Kolkata")).toInstant();
        var slaTask = repo.createTask(
            slaCmd(WorkflowFoundationRepository.SUBJECT_REGISTRATION, registrationId, "scr_due", "review", due, policyVersionId, anchor), UUID.randomUUID(),
            PROGRAMME, "programme");
        UUID clockId = clockForTask(slaTask.id());
        assertThrows(DataAccessException.class, () -> runtime.update("UPDATE workflow_task SET due_at = ? WHERE id = ?", java.sql.Timestamp.from(due.plusSeconds(60)), slaTask.id()));
        assertThrows(DataAccessException.class, () -> runtime.update("UPDATE workflow_sla_clock SET policy_version_id = ? WHERE id = ?", policyVersionId, clockId));
        assertThrows(DataAccessException.class, () -> runtime.update("INSERT INTO workflow_sla_clock_event (clock_id, event_kind, responsible_party, occurred_at) VALUES (?, 'start', 'bureau', ?)", clockId,
            java.sql.Timestamp.from(anchor)));
    }

    @Test
    void runtimeCommandFunctionsAppendInseparableAuditEvidence() {
        UUID command = UUID.randomUUID();
        var task = repo.createTask(cmd(WorkflowFoundationRepository.SUBJECT_REGISTRATION, registrationId, "scr_cmd", "review"), command, PROGRAMME, "programme");
        int eventsBefore = repo.countTaskEvents(task.id());
        runtime.query(
            "SELECT workflow_foundation_reassign_task(?, ?, ?, ?, ?, ?, ?)",
            rs -> null,
            task.id(), task.version(), "director", NOVA_USER, PROGRAMME, "programme", "via function");
        assertEquals(eventsBefore + 1, repo.countTaskEvents(task.id()));
    }

    @Test
    void discrepancyThreeCycleNeedsMoreThenClose() {
        UUID disc = repo.openDiscrepancy(WorkflowFoundationRepository.SUBJECT_REGISTRATION, registrationId, "line1", "Need docs", PROGRAMME);
        repo.addDiscrepancyResponse(disc, 1, "First upload", NOVA_USER);
        assertThrows(DataAccessException.class, () -> repo.addDiscrepancyResponse(disc, 2, "too soon", NOVA_USER));
        repo.disposeDiscrepancy(disc, 1, "needs_more", "more detail", PROGRAMME);
        assertThrows(DataAccessException.class, () -> repo.disposeDiscrepancy(disc, 1, "accepted", "dup", PROGRAMME));
        repo.addDiscrepancyResponse(disc, 2, "Second upload", NOVA_USER);
        repo.disposeDiscrepancy(disc, 2, "needs_more", "again", PROGRAMME);
        repo.addDiscrepancyResponse(disc, 3, "Third upload", NOVA_USER);
        repo.disposeDiscrepancy(disc, 3, "accepted", "ok", PROGRAMME);
        assertEquals("closed", owner.queryForObject("SELECT status FROM workflow_discrepancy WHERE id = ?", String.class, disc));
        assertThrows(DataAccessException.class, () -> repo.addDiscrepancyResponse(disc, 4, "late", NOVA_USER));
    }

    @Test
    void concurrentIdempotentCreateSharesOneTaskAndOneEvent() throws Exception {
        UUID command = UUID.randomUUID();
        var body = cmd(WorkflowFoundationRepository.SUBJECT_REGISTRATION, registrationId, "scr_race", "review");
        ExecutorService pool = Executors.newFixedThreadPool(2);
        CountDownLatch go = new CountDownLatch(1);
        List<UUID> ids = new ArrayList<>();
        try {
            List<Future<UUID>> futures = List.of(
                pool.submit(() -> {
                    go.await();
                    return new WorkflowFoundationRepository(new JdbcTemplate(runtimeSource(MAIN)))
                        .createTaskIdempotent(body, command, PROGRAMME, "programme").id();
                }),
                pool.submit(() -> {
                    go.await();
                    return new WorkflowFoundationRepository(new JdbcTemplate(runtimeSource(MAIN)))
                        .createTaskIdempotent(body, command, PROGRAMME, "programme").id();
                }));
            go.countDown();
            for (Future<UUID> f : futures) {
                ids.add(f.get(15, TimeUnit.SECONDS));
            }
        } finally {
            pool.shutdownNow();
        }
        assertEquals(1, ids.stream().distinct().count());
        assertEquals(1, repo.countTaskEvents(ids.get(0)));
    }

    @Test
    void concurrentDiscrepancyResponseAllowsOneWinner() throws Exception {
        UUID disc = repo.openDiscrepancy(WorkflowFoundationRepository.SUBJECT_REGISTRATION, registrationId, "line_race", "Race", PROGRAMME);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        CountDownLatch go = new CountDownLatch(1);
        AtomicInteger ok = new AtomicInteger();
        AtomicInteger fail = new AtomicInteger();
        try {
            List<Future<?>> futures = List.of(
                pool.submit(() -> {
                    go.await();
                    try {
                        new WorkflowFoundationRepository(new JdbcTemplate(runtimeSource(MAIN))).addDiscrepancyResponse(disc, 1, "A", NOVA_USER);
                        ok.incrementAndGet();
                    } catch (DataAccessException ex) {
                        fail.incrementAndGet();
                    }
                    return null;
                }),
                pool.submit(() -> {
                    go.await();
                    try {
                        new WorkflowFoundationRepository(new JdbcTemplate(runtimeSource(MAIN))).addDiscrepancyResponse(disc, 1, "B", NOVA_USER);
                        ok.incrementAndGet();
                    } catch (DataAccessException ex) {
                        fail.incrementAndGet();
                    }
                    return null;
                }));
            go.countDown();
            for (Future<?> f : futures) {
                f.get(15, TimeUnit.SECONDS);
            }
        } finally {
            pool.shutdownNow();
        }
        assertEquals(1, ok.get());
        assertEquals(1, fail.get());
        assertEquals(1, owner.queryForObject("SELECT count(*)::int FROM workflow_discrepancy_response WHERE discrepancy_id = ?", Integer.class, disc));
    }

    @Test
    void referencedPolicyVersionCannotChangeOrDelete() {
        Instant start = LocalDate.of(2026, 5, 1).atTime(9, 0).atZone(ZoneId.of("Asia/Kolkata")).toInstant();
        Instant due = LocalDate.of(2026, 5, 15).atTime(17, 0).atZone(ZoneId.of("Asia/Kolkata")).toInstant();
        UUID regClock = UUID.randomUUID();
        owner.update(
            "INSERT INTO registration_application (id, reference, kind, organisation_id, brand_name, state, version) VALUES (?, ?, 'brand', ?, ?, 'draft', 0)",
            regClock, "WF2A-POL-" + TAG, NOVA_ORG, "WF Pol " + TAG);
        var task = repo.createTask(
            slaCmd(WorkflowFoundationRepository.SUBJECT_REGISTRATION, regClock, "scr_pol", "review", due, policyVersionId, start), UUID.randomUUID(), PROGRAMME,
            "programme");
        repo.appendClockEvent(clockForTask(task.id()), "start", "bureau", start, null);
        assertThrows(DataAccessException.class, () -> owner.update("UPDATE workflow_sla_policy_version SET note = 'tamper' WHERE id = ?", policyVersionId));
        assertThrows(DataAccessException.class, () -> owner.update("DELETE FROM workflow_sla_policy_version WHERE id = ?", policyVersionId));
        var maint = new JdbcTemplate(maintSource(MAIN));
        assertThrows(DataAccessException.class, () -> maint.update("DELETE FROM workflow_sla_policy_version WHERE id = ?", policyVersionId));
        UUID unused = insertPolicy("unused_del", 1, LocalDate.of(2027, 1, 1), LocalDate.of(2027, 12, 31), 3);
        maint.update("DELETE FROM workflow_sla_policy_version WHERE id = ?", unused);
    }

    @Test
    void registrationAndModelSubjectsWithOpenTaskUniqueness() {
        UUID c1 = UUID.randomUUID();
        UUID c2 = UUID.randomUUID();
        var reg = repo.createTaskIdempotent(cmd(WorkflowFoundationRepository.SUBJECT_REGISTRATION, registrationId, "scr_d", "review"), c1, PROGRAMME, "programme");
        var model = repo.createTask(cmd(WorkflowFoundationRepository.SUBJECT_MODEL, MODEL_ID, "scr_d", "review"), c2, PROGRAMME, "programme");
        assertNotEquals(reg.id(), model.id());
        assertThrows(DataAccessException.class,
            () -> repo.createTask(cmd(WorkflowFoundationRepository.SUBJECT_MODEL, MODEL_ID, "scr_d", "review"), UUID.randomUUID(), PROGRAMME, "programme"));
    }

    @Test
    void subjectDeleteBlockedWhenFoundationRowsExist() {
        UUID reg2 = UUID.randomUUID();
        owner.update(
            "INSERT INTO registration_application (id, reference, kind, organisation_id, brand_name, state, version) VALUES (?, ?, 'brand', ?, ?, 'draft', 0)",
            reg2, "WF2A-DEL-" + TAG, NOVA_ORG, "WF Del " + TAG);
        repo.createTask(cmd(WorkflowFoundationRepository.SUBJECT_REGISTRATION, reg2, "scr_del", "review"), UUID.randomUUID(), PROGRAMME, "programme");
        assertThrows(DataAccessException.class, () -> owner.update("DELETE FROM registration_application WHERE id = ?", reg2));
        UUID modelOnly = UUID.fromString("00000000-0000-4000-c000-000000000002");
        repo.createTask(cmd(WorkflowFoundationRepository.SUBJECT_MODEL, modelOnly, "scr_del_m", "review"), UUID.randomUUID(), PROGRAMME, "programme");
        assertThrows(DataAccessException.class, () -> owner.update("DELETE FROM model_application WHERE id = ?", modelOnly));
    }

    @Test
    void clockEventsRequireValidSequenceAndPinnedPolicy() {
        Instant start = LocalDate.of(2026, 4, 1).atTime(9, 0).atZone(ZoneId.of("Asia/Kolkata")).toInstant();
        Instant due = LocalDate.of(2026, 4, 15).atTime(17, 0).atZone(ZoneId.of("Asia/Kolkata")).toInstant();
        var task = repo.createTask(
            slaCmd(WorkflowFoundationRepository.SUBJECT_REGISTRATION, registrationId, "scr_clk", "review", due, policyVersionId, start), UUID.randomUUID(),
            PROGRAMME, "programme");
        UUID clockId = clockForTask(task.id());
        repo.appendClockEvent(clockId, "start", "bureau", start, null);
        assertThrows(DataAccessException.class, () -> repo.appendClockEvent(clockId, "resume", "applicant", start.plusSeconds(5), null));
        assertThrows(DataAccessException.class, () -> runtime.update(
            "INSERT INTO workflow_sla_clock_event (clock_id, event_kind, responsible_party, occurred_at) VALUES (?, 'pause', 'applicant', ?)", clockId,
            java.sql.Timestamp.from(start.plusSeconds(8))));
        repo.appendClockEvent(clockId, "pause", "applicant", start.plusSeconds(10), null);
        repo.appendClockEvent(clockId, "resume", "applicant", start.plusSeconds(20), null);
        repo.appendClockEvent(clockId, "stop", "bureau", start.plusSeconds(30), null);
        assertEquals(policyVersionId, repo.findClockByTaskId(task.id()).orElseThrow().policyVersionId());
    }

    @Test
    void sequentialTwoClocksOnOneSubjectStopThenStart() {
        Instant t0 = LocalDate.of(2026, 9, 1).atTime(9, 0).atZone(ZoneId.of("Asia/Kolkata")).toInstant();
        Instant due1 = t0.plusSeconds(86400 * 10);
        var taskA = repo.createTask(
            slaCmd(WorkflowFoundationRepository.SUBJECT_REGISTRATION, registrationId, "stage_a", "review", due1, policyVersionId, t0), UUID.randomUUID(),
            PROGRAMME, "programme");
        UUID clockA = clockForTask(taskA.id());
        repo.appendClockEvent(clockA, "start", "bureau", t0, null);
        repo.appendClockEvent(clockA, "stop", "bureau", t0.plusSeconds(30), null);
        repo.completeTask(taskA.id(), taskA.version(), PROGRAMME, "programme", "done");
        Instant t1 = t0.plusSeconds(100);
        Instant due2 = due1.plusSeconds(86400);
        var taskB = repo.createTask(
            slaCmd(WorkflowFoundationRepository.SUBJECT_REGISTRATION, registrationId, "stage_b", "review", due2, policyVersionId, t1), UUID.randomUUID(),
            PROGRAMME, "programme");
        UUID clockB = clockForTask(taskB.id());
        repo.appendClockEvent(clockB, "start", "bureau", t1, null);
        assertEquals(2, repo.loadClockEvents(clockA).size());
        assertEquals(1, repo.loadClockEvents(clockB).size());
    }

    @Test
    void separateStageClockHistoriesDoNotMerge() {
        Instant t = LocalDate.of(2026, 10, 1).atTime(9, 0).atZone(ZoneId.of("Asia/Kolkata")).toInstant();
        var t1 = repo.createTask(
            slaCmd(WorkflowFoundationRepository.SUBJECT_REGISTRATION, registrationId, "st_m1", "pay", t.plusSeconds(1), policyVersionId, t), UUID.randomUUID(),
            PROGRAMME, "programme");
        var t2 = repo.createTask(
            slaCmd(WorkflowFoundationRepository.SUBJECT_REGISTRATION, registrationId, "st_m2", "approve", t.plusSeconds(2), policyVersionId, t), UUID.randomUUID(),
            PROGRAMME, "programme");
        UUID c1 = clockForTask(t1.id());
        UUID c2 = clockForTask(t2.id());
        repo.appendClockEvent(c1, "start", "bureau", t.plusSeconds(10), null);
        repo.appendClockEvent(c2, "start", "bureau", t.plusSeconds(20), null);
        assertEquals(1, repo.loadClockEvents(c1).size());
        assertEquals(1, repo.loadClockEvents(c2).size());
    }

    @Test
    void slaCreateRollbackLeavesNoPartialTaskClockOrEvent() {
        Instant anchor = LocalDate.of(2026, 11, 2).atStartOfDay(ZoneId.of("Asia/Kolkata")).toInstant();
        Instant due = LocalDate.of(2026, 11, 12).atTime(17, 0).atZone(ZoneId.of("Asia/Kolkata")).toInstant();
        UUID c1 = UUID.randomUUID();
        UUID c2 = UUID.randomUUID();
        int clocksBefore = owner.queryForObject("SELECT count(*)::int FROM workflow_sla_clock", Integer.class);
        assertThrows(DataAccessException.class, () -> tx.executeWithoutResult(s -> {
            repo.createTask(
                slaCmd(WorkflowFoundationRepository.SUBJECT_MODEL, MODEL_ID, "scr_sla_rb", "review", due, policyVersionId, anchor), c1, PROGRAMME, "programme");
            repo.createTask(
                slaCmd(WorkflowFoundationRepository.SUBJECT_MODEL, MODEL_ID, "scr_sla_rb", "review", due, policyVersionId, anchor), c2, PROGRAMME, "programme");
        }));
        assertTrue(repo.findTaskByCommandId(c1).isEmpty());
        assertTrue(repo.findTaskByCommandId(c2).isEmpty());
        assertEquals(clocksBefore, owner.queryForObject("SELECT count(*)::int FROM workflow_sla_clock", Integer.class));
    }

    @Test
    void slaTaskCreatedWithDueAndClockAtomically() {
        Instant anchor = LocalDate.of(2026, 11, 1).atStartOfDay(ZoneId.of("Asia/Kolkata")).toInstant();
        Instant due = LocalDate.of(2026, 11, 12).atTime(17, 0).atZone(ZoneId.of("Asia/Kolkata")).toInstant();
        UUID command = UUID.randomUUID();
        var task = repo.createTaskIdempotent(
            slaCmd(WorkflowFoundationRepository.SUBJECT_REGISTRATION, registrationId, "scr_sla", "review", due, policyVersionId, anchor), command, PROGRAMME,
            "programme");
        assertEquals(due, task.dueAt());
        var clock = repo.findClockByTaskId(task.id()).orElseThrow();
        assertEquals(policyVersionId, clock.policyVersionId());
        assertEquals(anchor, clock.policyAnchorAt());
        assertEquals(1, repo.countTaskEvents(task.id()));
    }

    @Test
    void slaIdempotentReplayAndDuePolicyConflict() {
        Instant anchor = LocalDate.of(2026, 12, 1).atStartOfDay(ZoneId.of("Asia/Kolkata")).toInstant();
        Instant due = LocalDate.of(2026, 12, 10).atTime(17, 0).atZone(ZoneId.of("Asia/Kolkata")).toInstant();
        UUID command = UUID.randomUUID();
        var first = repo.createTaskIdempotent(
            slaCmd(WorkflowFoundationRepository.SUBJECT_REGISTRATION, registrationId, "scr_idem", "review", due, policyVersionId, anchor), command, PROGRAMME,
            "programme");
        var replay = repo.createTaskIdempotent(
            slaCmd(WorkflowFoundationRepository.SUBJECT_REGISTRATION, registrationId, "scr_idem", "review", due, policyVersionId, anchor), command, PROGRAMME,
            "programme");
        assertEquals(first.id(), replay.id());
        assertEquals(first.id(), repo.findClockByTaskId(replay.id()).orElseThrow().taskId());
        var otherDue = slaCmd(WorkflowFoundationRepository.SUBJECT_REGISTRATION, registrationId, "scr_idem", "review", due.plusSeconds(60), policyVersionId, anchor);
        assertThrows(WorkflowIdempotencyConflictException.class, () -> repo.createTaskIdempotent(otherDue, command, PROGRAMME, "programme"));
    }

    @Test
    void preV69SecurityDefinerSearchPathNotRewrittenByV69() {
        String cfg = owner.queryForObject(
            "SELECT coalesce(array_to_string(p.proconfig, ','), '') FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace "
                + "WHERE n.nspname = ? AND p.proname = 'demo_message_on_payment' AND p.prosecdef",
            String.class, MAIN);
        assertTrue(cfg.contains("search_path=") && cfg.contains("pg_temp"), cfg);
        String wf = owner.queryForObject(
            "SELECT coalesce(array_to_string(p.proconfig, ','), '') FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace "
                + "WHERE n.nspname = ? AND p.proname = 'workflow_foundation_create_task'",
            String.class, MAIN);
        assertTrue(wf.contains("search_path=") && wf.contains("pg_temp"), wf);
    }

    @Test
    void concurrentClockAppendAllowsOneValidSuccessor() throws Exception {
        Instant start = LocalDate.of(2026, 7, 1).atTime(9, 0).atZone(ZoneId.of("Asia/Kolkata")).toInstant();
        Instant due = start.plusSeconds(86400 * 5);
        var task = repo.createTask(
            slaCmd(WorkflowFoundationRepository.SUBJECT_REGISTRATION, registrationId, "scr_cnc", "review", due, policyVersionId, start), UUID.randomUUID(),
            PROGRAMME, "programme");
        UUID clockId = clockForTask(task.id());
        Instant next = start.plusSeconds(10);
        repo.appendClockEvent(clockId, "start", "bureau", start, null);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        CountDownLatch go = new CountDownLatch(1);
        AtomicInteger ok = new AtomicInteger();
        AtomicInteger fail = new AtomicInteger();
        try {
            List<Future<?>> futures = List.of(
                pool.submit(() -> {
                    go.await();
                    try {
                        new WorkflowFoundationRepository(new JdbcTemplate(runtimeSource(MAIN))).appendClockEvent(clockId, "pause", "applicant", next, null);
                        ok.incrementAndGet();
                    } catch (DataAccessException ex) {
                        fail.incrementAndGet();
                    }
                    return null;
                }),
                pool.submit(() -> {
                    go.await();
                    try {
                        new WorkflowFoundationRepository(new JdbcTemplate(runtimeSource(MAIN))).appendClockEvent(clockId, "pause", "applicant", next, null);
                        ok.incrementAndGet();
                    } catch (DataAccessException ex) {
                        fail.incrementAndGet();
                    }
                    return null;
                }));
            go.countDown();
            for (Future<?> f : futures) {
                f.get(15, TimeUnit.SECONDS);
            }
        } finally {
            pool.shutdownNow();
        }
        assertEquals(1, ok.get());
        assertEquals(1, fail.get());
        assertEquals(2, owner.queryForObject("SELECT count(*)::int FROM workflow_sla_clock_event WHERE clock_id = ?", Integer.class, clockId));
    }

    @Test
    void independentClocksOnSameSubjectDoNotSerializeEachOther() throws Exception {
        Instant t = LocalDate.of(2026, 7, 2).atTime(9, 0).atZone(ZoneId.of("Asia/Kolkata")).toInstant();
        var task1 = repo.createTask(
            slaCmd(WorkflowFoundationRepository.SUBJECT_REGISTRATION, registrationId, "ind_a", "review", t.plusSeconds(100), policyVersionId, t), UUID.randomUUID(),
            PROGRAMME, "programme");
        var task2 = repo.createTask(
            slaCmd(WorkflowFoundationRepository.SUBJECT_REGISTRATION, registrationId, "ind_b", "review", t.plusSeconds(200), policyVersionId, t), UUID.randomUUID(),
            PROGRAMME, "programme");
        UUID c1 = clockForTask(task1.id());
        UUID c2 = clockForTask(task2.id());
        ExecutorService pool = Executors.newFixedThreadPool(2);
        CountDownLatch go = new CountDownLatch(1);
        AtomicInteger ok = new AtomicInteger();
        try {
            List<Future<?>> futures = List.of(
                pool.submit(() -> {
                    go.await();
                    new WorkflowFoundationRepository(new JdbcTemplate(runtimeSource(MAIN))).appendClockEvent(c1, "start", "bureau", t.plusSeconds(10), null);
                    ok.incrementAndGet();
                    return null;
                }),
                pool.submit(() -> {
                    go.await();
                    new WorkflowFoundationRepository(new JdbcTemplate(runtimeSource(MAIN))).appendClockEvent(c2, "start", "bureau", t.plusSeconds(10), null);
                    ok.incrementAndGet();
                    return null;
                }));
            go.countDown();
            for (Future<?> f : futures) {
                f.get(15, TimeUnit.SECONDS);
            }
        } finally {
            pool.shutdownNow();
        }
        assertEquals(2, ok.get());
    }
}
