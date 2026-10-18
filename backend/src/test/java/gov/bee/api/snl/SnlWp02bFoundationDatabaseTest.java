package gov.bee.api.snl;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import gov.bee.api.notifications.NotificationCommandRepository;
import gov.bee.api.notifications.NotificationRepository;
import gov.bee.api.workflow.SnlReturnResponsePolicyRepository;
import gov.bee.api.workflow.WorkflowFoundationRepository;
import gov.bee.api.workflow.WorkingDaySla;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZonedDateTime;
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
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

@Tag("db")
class SnlWp02bFoundationDatabaseTest {

    static final String TAG = HexFormat.of().toHexDigits(ThreadLocalRandom.current().nextInt());
    static final String MAIN = "wp02b1_test_" + TAG;
    static final UUID NOVA_ORG = UUID.fromString("00000000-0000-4000-b000-000000000001");
    static final UUID NOVA_USER = UUID.fromString("00000000-0000-4000-a000-000000000001");
    static final UUID MODEL_ID = UUID.fromString("00000000-0000-4000-c000-000000000001");
    static final ZoneId KOLKATA = WorkingDaySla.ZONE;

    static JdbcTemplate admin;
    static JdbcTemplate owner;
    static JdbcTemplate runtime;
    static JdbcTemplate maint;
    static SnlReturnResponsePolicyRepository policyRepo;
    static NotificationCommandRepository commandRepo;
    static NotificationRepository notificationRepo;
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

    @BeforeAll
    static void migrateAndSeed() throws Exception {
        admin = new JdbcTemplate(migrateSource(null));
        appModelCountBefore = admin.queryForObject("SELECT count(*) FROM app.model_application", Integer.class);
        admin.execute("DROP SCHEMA IF EXISTS " + MAIN + " CASCADE");
        admin.execute("CREATE SCHEMA " + MAIN);
        Flyway.configure().dataSource(migrateSource(MAIN)).schemas(MAIN).defaultSchema(MAIN).createSchemas(false)
            .locations("classpath:db/migration").load().migrate();
        owner = new JdbcTemplate(migrateSource(MAIN));
        assertEquals(75, owner.queryForObject("SELECT max(installed_rank) FROM flyway_schema_history", Integer.class));
        owner.execute(Files.readString(Path.of("..", "local", "seed", "seed.sql")));
        runtime = new JdbcTemplate(runtimeSource(MAIN));
        maint = new JdbcTemplate(maintSource(MAIN));
        policyRepo = new SnlReturnResponsePolicyRepository(runtime);
        commandRepo = new NotificationCommandRepository(runtime);
        notificationRepo = new NotificationRepository(runtime);
    }

    @AfterAll
    static void dropAndAssertAppUntouched() {
        if (admin != null) {
            admin.execute("DROP SCHEMA IF EXISTS " + MAIN + " CASCADE");
            assertEquals(appModelCountBefore, admin.queryForObject("SELECT count(*) FROM app.model_application", Integer.class));
        }
    }

    @Test
    void v70SeedsSnlReturnResponsePolicyWithProvisionalNote() {
        var policy = policyRepo.findSeededVersion().orElseThrow();
        assertEquals(SnlReturnResponsePolicyRepository.POLICY_KEY, policy.policyKey());
        assertEquals("india_bee_default", policy.calendarKey());
        assertEquals(7, policy.workingDayLimit());
        assertTrue(policy.pauseWhileApplicant());
        assertEquals(LocalDate.of(2026, 1, 1), policy.effectiveFrom());
        String note = owner.queryForObject("SELECT note FROM workflow_sla_policy_version WHERE policy_key = ? AND version = 1", String.class,
            SnlReturnResponsePolicyRepository.POLICY_KEY);
        assertTrue(note.contains("provisional A08 / BL-255"));
    }

    @Test
    void policyAnchorUsesKolkataCalendarDateAtUtcMidnightBoundary() {
        Instant anchor = ZonedDateTime.of(2026, 3, 15, 18, 30, 0, 0, ZoneId.of("UTC")).toInstant();
        assertEquals(LocalDate.of(2026, 3, 16), anchor.atZone(KOLKATA).toLocalDate());
        var version = policyRepo.requireApplicableVersion(anchor);
        assertEquals(1, version.version());
    }

    @Test
    void dueDateSkipsWeekendsAndPersistedClosure() {
        owner.update("INSERT INTO workflow_calendar_closure (calendar_key, closure_date, reason) VALUES ('india_bee_default', ?, 'test closure') ON CONFLICT DO NOTHING",
            LocalDate.of(2026, 3, 18));
        Instant anchor = ZonedDateTime.of(2026, 3, 16, 10, 0, 0, 0, KOLKATA).toInstant();
        var version = policyRepo.requireApplicableVersion(anchor);
        Instant due = policyRepo.dueAtEndOfWorkingDays(anchor, version);
        assertEquals(LocalDate.of(2026, 3, 25), due.atZone(KOLKATA).toLocalDate(), "seven working days from Mon 16 Mar 2026 skipping closure Wed 18");
    }

    @Test
    void existingModelNotificationsRemainReadableWithUnchangedApiShape() {
        int before = owner.queryForObject("SELECT count(*) FROM notification WHERE subject_kind = 'model_application' AND subject_id = ?", Integer.class, MODEL_ID);
        owner.queryForObject("SELECT notify_application_organisation(?, 'returned', 'WP02B shape test.')", Integer.class, MODEL_ID);
        assertTrue(owner.queryForObject("SELECT count(*) FROM notification WHERE subject_kind = 'model_application' AND subject_id = ?", Integer.class, MODEL_ID) > before);
        List<NotificationRepository.Item> items = notificationRepo.newest(NOVA_USER);
        NotificationRepository.Item latest = items.stream().filter(i -> i.applicationId().equals(MODEL_ID)).findFirst().orElseThrow();
        assertNotNull(latest.reference());
        assertNotNull(latest.kind());
        assertNotNull(latest.message());
    }

    @Test
    void registrationSubjectReceivesNotificationWithoutModelRow() {
        UUID regId = UUID.randomUUID();
        owner.update(
            "INSERT INTO registration_application (id, reference, kind, organisation_id, brand_name, state, version) VALUES (?, ?, 'brand', ?, ?, 'draft', 0)",
            regId, "WP02B-N-" + TAG, NOVA_ORG, "Notify " + TAG);
        var cmd = new NotificationCommandRepository.DeliverCommand(WorkflowFoundationRepository.SUBJECT_REGISTRATION, regId, "returned",
            "was returned to you for edits.");
        UUID commandId = UUID.randomUUID();
        int n = commandRepo.deliver(cmd, commandId, NOVA_USER).recipientCount();
        assertTrue(n >= 1);
        assertEquals(0, owner.queryForObject("SELECT count(*) FROM notification WHERE subject_id = ? AND application_id IS NOT NULL", Integer.class, regId));
        assertTrue(owner.queryForObject("SELECT count(*) FROM notification WHERE subject_kind = 'registration_application' AND subject_id = ?", Integer.class, regId) >= 1);
    }

    @Test
    void inactiveMembershipAndInactiveAccountReceiveNothing() {
        UUID regId = UUID.randomUUID();
        owner.update(
            "INSERT INTO registration_application (id, reference, kind, organisation_id, brand_name, state, version) VALUES (?, ?, 'brand', ?, ?, 'draft', 0)",
            regId, "WP02B-INACTIVE-" + TAG, NOVA_ORG, "Inactive " + TAG);
        owner.update("UPDATE organisation_membership SET active = false WHERE organisation_id = ? AND user_id = ?", NOVA_ORG, NOVA_USER);
        try {
            var cmd = new NotificationCommandRepository.DeliverCommand(WorkflowFoundationRepository.SUBJECT_REGISTRATION, regId, "returned", "x");
            assertEquals(0, commandRepo.deliver(cmd, UUID.randomUUID(), NOVA_USER).recipientCount());
        } finally {
            owner.update("UPDATE organisation_membership SET active = true WHERE organisation_id = ? AND user_id = ?", NOVA_ORG, NOVA_USER);
        }
    }

    @Test
    void zeroRecipientReplayRemainsFinalAfterMembershipBecomesEligible() {
        UUID regId = UUID.randomUUID();
        owner.update(
            "INSERT INTO registration_application (id, reference, kind, organisation_id, brand_name, state, version) VALUES (?, ?, 'brand', ?, ?, 'draft', 0)",
            regId, "WP02B-ZERO-" + TAG, NOVA_ORG, "Zero " + TAG);
        UUID commandId = UUID.randomUUID();
        var command = new NotificationCommandRepository.DeliverCommand(
            WorkflowFoundationRepository.SUBJECT_REGISTRATION, regId, "returned", "zero recipient replay");
        owner.update("UPDATE organisation_membership SET active = false WHERE organisation_id = ? AND user_id = ?", NOVA_ORG, NOVA_USER);
        try {
            assertEquals(0, commandRepo.deliver(command, commandId, NOVA_USER).recipientCount());
        } finally {
            owner.update("UPDATE organisation_membership SET active = true WHERE organisation_id = ? AND user_id = ?", NOVA_ORG, NOVA_USER);
        }

        assertEquals(0, commandRepo.deliver(command, commandId, NOVA_USER).recipientCount());
        assertEquals(0, owner.queryForObject("SELECT count(*) FROM notification WHERE subject_id = ?", Integer.class, regId));
        assertNotNull(owner.queryForObject("SELECT delivered_at FROM notification_command WHERE command_id = ?", java.sql.Timestamp.class, commandId));
    }

    @Test
    void replayAndConcurrentIdenticalCommandsDeliverOncePerRecipient() throws Exception {
        UUID regId = UUID.randomUUID();
        owner.update(
            "INSERT INTO registration_application (id, reference, kind, organisation_id, brand_name, state, version) VALUES (?, ?, 'brand', ?, ?, 'draft', 0)",
            regId, "WP02B-REPLAY-" + TAG, NOVA_ORG, "Replay " + TAG);
        var cmd = new NotificationCommandRepository.DeliverCommand(WorkflowFoundationRepository.SUBJECT_REGISTRATION, regId, "returned", "replay body");
        UUID commandId = UUID.randomUUID();
        int first = commandRepo.deliver(cmd, commandId, NOVA_USER).recipientCount();
        int second = commandRepo.deliver(cmd, commandId, NOVA_USER).recipientCount();
        assertEquals(first, second);
        int rows = owner.queryForObject("SELECT count(*) FROM notification WHERE subject_id = ?", Integer.class, regId);
        assertEquals(first, rows);

        UUID commandId2 = UUID.randomUUID();
        ExecutorService pool = Executors.newFixedThreadPool(4);
        CountDownLatch start = new CountDownLatch(1);
        var cmd2 = new NotificationCommandRepository.DeliverCommand(WorkflowFoundationRepository.SUBJECT_REGISTRATION, regId, "fee_due", "concurrent");
        List<Future<Integer>> futures = new java.util.ArrayList<>();
        for (int i = 0; i < 4; i++) {
            futures.add(pool.submit(() -> {
                start.await(30, TimeUnit.SECONDS);
                return commandRepo.deliver(cmd2, commandId2, NOVA_USER).recipientCount();
            }));
        }
        start.countDown();
        int expected = futures.get(0).get(60, TimeUnit.SECONDS);
        for (Future<Integer> f : futures) {
            assertEquals(expected, f.get(60, TimeUnit.SECONDS));
        }
        pool.shutdown();
        assertEquals(expected, owner.queryForObject("SELECT count(*) FROM notification WHERE subject_id = ? AND kind = 'fee_due'", Integer.class, regId));
    }

    @Test
    void changedPayloadReplayConflicts() {
        UUID regId = UUID.randomUUID();
        owner.update(
            "INSERT INTO registration_application (id, reference, kind, organisation_id, brand_name, state, version) VALUES (?, ?, 'brand', ?, ?, 'draft', 0)",
            regId, "WP02B-CONFLICT-" + TAG, NOVA_ORG, "Conflict " + TAG);
        UUID commandId = UUID.randomUUID();
        commandRepo.deliver(new NotificationCommandRepository.DeliverCommand(WorkflowFoundationRepository.SUBJECT_REGISTRATION, regId, "returned", "first"), commandId,
            NOVA_USER);
        var changed = new NotificationCommandRepository.DeliverCommand(WorkflowFoundationRepository.SUBJECT_REGISTRATION, regId, "returned", "second");
        assertThrows(DataAccessException.class, () -> commandRepo.deliver(changed, commandId, NOVA_USER));
    }

    @Test
    void runtimeDirectMutationAndMissingSubjectAreRefused() {
        UUID regId = UUID.randomUUID();
        assertThrows(DataAccessException.class, () -> runtime.update(
            "INSERT INTO notification (recipient_account_id, subject_kind, subject_id, kind, message) VALUES (?, 'registration_application', ?, 'returned', 'x')",
            NOVA_USER, regId));
        var cmd = new NotificationCommandRepository.DeliverCommand(WorkflowFoundationRepository.SUBJECT_REGISTRATION, regId, "returned", "missing");
        assertThrows(DataAccessException.class, () -> commandRepo.deliver(cmd, UUID.randomUUID(), NOVA_USER));
    }

    @Test
    void notificationIdentityImmutableReadTransitionStillWorks() {
        UUID regId = UUID.randomUUID();
        owner.update(
            "INSERT INTO registration_application (id, reference, kind, organisation_id, brand_name, state, version) VALUES (?, ?, 'brand', ?, ?, 'draft', 0)",
            regId, "WP02B-GUARD-" + TAG, NOVA_ORG, "Guard " + TAG);
        commandRepo.deliver(new NotificationCommandRepository.DeliverCommand(WorkflowFoundationRepository.SUBJECT_REGISTRATION, regId, "returned", "guard"), UUID.randomUUID(),
            NOVA_USER);
        UUID row = owner.queryForObject("SELECT id FROM notification WHERE subject_id = ? LIMIT 1", UUID.class, regId);
        assertThrows(Exception.class, () -> owner.update("UPDATE notification SET message = 'changed' WHERE id = ?", row));
        assertEquals(1, runtime.queryForObject("SELECT notification_mark_read(?, ?)", Integer.class, NOVA_USER, row));
        assertThrows(Exception.class, () -> runtime.update("UPDATE notification SET read_at = NULL WHERE id = ?", row));
    }

    @Test
    void disposableCleanupRemovesNotificationAndCommandEvidence() {
        UUID modelApp = UUID.randomUUID();
        owner.update(
            "INSERT INTO model_application (id, reference, organisation_id, brand_name, category, model_number, state, version) "
                + "SELECT ?, ?, organisation_id, 'Disposable', category, 'X', 'draft', 0 FROM model_application WHERE id = ? LIMIT 1",
            modelApp, "WP02B-M-" + TAG, MODEL_ID);
        maint.execute("SELECT set_config('bee.cleanup_schema', '" + MAIN + "', true); INSERT INTO " + MAIN + ".local_disposable_application (application_id) VALUES ('"
            + modelApp + "'); SELECT " + MAIN + ".app_disposable_model_cleanup(ARRAY['" + modelApp + "']::uuid[])");
        assertEquals(0, owner.queryForObject("SELECT count(*) FROM notification_command WHERE subject_id = ?", Integer.class, modelApp));
        assertEquals(0, owner.queryForObject("SELECT count(*) FROM notification WHERE subject_id = ?", Integer.class, modelApp));

        UUID regId = UUID.randomUUID();
        owner.update(
            "INSERT INTO registration_application (id, reference, kind, organisation_id, brand_name, state, version) VALUES (?, ?, 'brand', ?, ?, 'draft', 0)",
            regId, "WP02B-R-" + TAG, NOVA_ORG, "Reg clean " + TAG);
        commandRepo.deliver(new NotificationCommandRepository.DeliverCommand(WorkflowFoundationRepository.SUBJECT_REGISTRATION, regId, "returned", "cleanup"), UUID.randomUUID(),
            NOVA_USER);
        maint.execute("SELECT set_config('bee.cleanup_schema', '" + MAIN + "', true); INSERT INTO " + MAIN + ".local_disposable_registration (application_id) VALUES ('" + regId
            + "'); SELECT " + MAIN + ".app_disposable_registration_cleanup(ARRAY['" + regId + "']::uuid[])");
        assertEquals(0, owner.queryForObject("SELECT count(*) FROM notification_command WHERE subject_id = ?", Integer.class, regId));
        assertEquals(0, owner.queryForObject("SELECT count(*) FROM notification WHERE subject_id = ?", Integer.class, regId));
        assertFalse(owner.queryForObject("SELECT EXISTS (SELECT 1 FROM registration_application WHERE id = ?)", Boolean.class, regId));
    }
}
