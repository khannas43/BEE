package gov.bee.api.snl;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import gov.bee.api.application.IdempotencyRepository;
import gov.bee.api.identity.Caller;
import gov.bee.api.identity.IdentityRepository.RoleGrant;
import gov.bee.api.masters.MasterDataRepository;
import gov.bee.api.notifications.NotificationCommandRepository;
import gov.bee.api.registration.RegistrationFeeService;
import gov.bee.api.registration.RegistrationRepository;
import gov.bee.api.registration.RegistrationReviewService;
import gov.bee.api.registration.RegistrationService;
import gov.bee.api.workflow.SnlReturnResponsePolicyRepository;
import gov.bee.api.workflow.WorkflowFoundationRepository;
import gov.bee.api.workflow.WorkflowIdempotencyConflictException;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
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
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.transaction.annotation.AnnotationTransactionAttributeSource;
import org.springframework.transaction.interceptor.TransactionInterceptor;
import org.springframework.transaction.support.TransactionTemplate;

@Tag("db")
class SnlWp02cRegistrationReturnWiringDatabaseTest {

    static final String TAG = HexFormat.of().toHexDigits(ThreadLocalRandom.current().nextInt());
    static final String MAIN = "wp02c_reg_test_" + TAG;
    static final UUID NOVA_ORG = UUID.fromString("00000000-0000-4000-b000-000000000001");
    static final UUID NOVA_USER = UUID.fromString("00000000-0000-4000-a000-000000000001");
    static final UUID FINANCE_USER = UUID.fromString("00000000-0000-4000-a000-000000000003");
    static final UUID PROGRAMME_USER = UUID.fromString("00000000-0000-4000-a000-000000000006");
    static final UUID DIRECTOR_USER = UUID.fromString("00000000-0000-4000-a000-000000000007");
    static final String REASON = "WP02C registration wiring proof.";
    static final String NEUTRAL = "Applicant resubmitted the registration request.";
    static final DateTimeFormatter DUE_LABEL = DateTimeFormatter.ofPattern("d MMM uuuu", Locale.ENGLISH).withZone(ZoneId.of("Asia/Kolkata"));
    static final ZoneId KOLKATA = ZoneId.of("Asia/Kolkata");
    static final LocalDate TODAY = LocalDate.now(KOLKATA);
    static final String FEE = "\"expectedFee\":{\"amountInr\":\"5000.00\",\"feeRuleKey\":\"REG:brand_registration\",\"feeRuleVersion\":1}";

    static JdbcTemplate admin;
    static JdbcTemplate owner;
    static JdbcTemplate maint;
    static JdbcTemplate db;
    static DriverManagerDataSource runtime;
    static TransactionTemplate tx;
    static RegistrationRepository registrations;
    static RegistrationReturnResponseWiringRepository wiringRepo;
    static SnlReturnResponsePolicyRepository policyRepo;
    static ObjectMapper json;

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

    static String runtimeRole() {
        return env("BEE_RUNTIME_DB_USER", "bee_runtime");
    }

    @SuppressWarnings("unchecked")
    static <T> T transactional(T target) {
        ProxyFactory factory = new ProxyFactory(target);
        factory.setProxyTargetClass(true);
        factory.addAdvice(new TransactionInterceptor(new DataSourceTransactionManager(runtime), new AnnotationTransactionAttributeSource()));
        return (T) factory.getProxy();
    }

    static UUID commandId(String idempotencyKey, String purpose, UUID applicationId) {
        return UUID.nameUUIDFromBytes((idempotencyKey + "|" + purpose + "|" + applicationId).getBytes(StandardCharsets.UTF_8));
    }

    @BeforeAll
    static void migrateAndSeed() throws Exception {
        admin = new JdbcTemplate(migrateSource(null));
        admin.execute("DROP SCHEMA IF EXISTS " + MAIN + " CASCADE");
        admin.execute("CREATE SCHEMA " + MAIN);
        Flyway.configure().dataSource(migrateSource(MAIN)).schemas(MAIN).defaultSchema(MAIN).createSchemas(false)
            .locations("classpath:db/migration").load().migrate();
        owner = new JdbcTemplate(migrateSource(MAIN));
        owner.execute(Files.readString(Path.of("..", "local", "seed", "seed.sql")));
        maint = new JdbcTemplate(sourceAs(MAIN, "bee_local_maint", env("BEE_MAINT_DB_PASSWORD", "bee-local-maint")));
        runtime = sourceAs(MAIN, runtimeRole(), env("BEE_RUNTIME_DB_PASSWORD", "bee-local-runtime"));
        db = new JdbcTemplate(runtime);
        tx = new TransactionTemplate(new DataSourceTransactionManager(runtime));
        registrations = transactional(new RegistrationRepository(db));
        wiringRepo = new RegistrationReturnResponseWiringRepository(db);
        policyRepo = new SnlReturnResponsePolicyRepository(db);
        json = new ObjectMapper();
        assertEquals(73, owner.queryForObject("SELECT max(installed_rank) FROM flyway_schema_history", Integer.class));
    }

    @AfterAll
    static void drop() {
        if (admin != null) {
            admin.execute("DROP SCHEMA IF EXISTS " + MAIN + " CASCADE");
        }
    }

    static void addLicence(UUID id) {
        UUID doc = UUID.randomUUID();
        owner.update("INSERT INTO registration_document (id, application_id, document_kind) VALUES (?, ?, 'trade_licence')", doc, id);
        owner.update("INSERT INTO registration_document_version (id, document_id, version_number, content_sha256, size_bytes, media_type, original_filename, label, "
            + "uploaded_by_account_id) VALUES (?, ?, 1, repeat('a', 64), 100, 'application/pdf', 'licence.pdf', 'Trade licence', ?)", UUID.randomUUID(), doc, NOVA_USER);
    }

    static com.fasterxml.jackson.databind.JsonNode parse(String s) {
        try {
            return json.readTree(s);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    static UUID atProgrammeReview(String brand) {
        var nova = new Caller(NOVA_USER, "nova", List.of(new RoleGrant("manufacturer", "own-org")), Set.of(NOVA_ORG));
        var finance = new Caller(FINANCE_USER, "fin", List.of(new RoleGrant("finance", "all")), Set.of());
        var regRepo = new RegistrationRepository(db);
        var service = new RegistrationService(regRepo, new MasterDataRepository(db), new IdempotencyRepository(db), json);
        var fee = new RegistrationFeeService(regRepo, new IdempotencyRepository(db),
            new gov.bee.api.settings.BusinessSettingService(new gov.bee.api.settings.BusinessSettingRepository(db), null, null), json);
        var draft = service.create(nova, UUID.randomUUID().toString(), parse("{\"brandName\":\"" + brand + "\"}"));
        UUID id = UUID.fromString((String) draft.getBody().get("id"));
        addLicence(id);
        service.submit(nova, id, UUID.randomUUID().toString(), parse("{\"version\":0," + FEE + "}"));
        fee.confirm(finance, id, UUID.randomUUID().toString(), parse("{\"version\":1,\"receiptReference\":\"R-1\",\"receivedOn\":\"" + TODAY + "\",\"amountInr\":\"5000.00\"}"));
        return id;
    }

    static UUID atDirectorReview(String brand) {
        UUID id = atProgrammeReview(brand);
        var programme = new Caller(PROGRAMME_USER, "prog", List.of(new RoleGrant("programme", "all")), Set.of());
        var review = new RegistrationReviewService(new RegistrationRepository(db), new RegistrationService(new RegistrationRepository(db), new MasterDataRepository(db),
            new IdempotencyRepository(db), json), new IdempotencyRepository(db), json);
        review.transition(programme, id, UUID.randomUUID().toString(), parse("{\"action\":\"recommend\",\"version\":2,\"note\":\"ok\"}"));
        return id;
    }

    record LegacyReturn(UUID transitionEventId, Instant returnedAt, UUID returnId) {
    }

    LegacyReturn legacyReturn(UUID id, int version, String from, UUID actor, String role, String reason) {
        if (registrations.transition(id, version, from, "returned", "return", actor, role, reason).isEmpty()) {
            throw new IllegalStateException("registration return transition stale");
        }
        var row = db.queryForMap(
            "SELECT id, occurred_at FROM registration_transition_event WHERE application_id = ? ORDER BY occurred_at DESC LIMIT 1", id);
        return new LegacyReturn((UUID) row.get("id"), ((java.sql.Timestamp) row.get("occurred_at")).toInstant(), UUID.randomUUID());
    }

    LegacyReturn legacyResubmit(UUID id, int version, UUID returnId, String returnFrom, Instant returnAt, String returnReason, UUID actor, String role) {
        if (registrations.transition(id, version, "returned", "programme_review", "resubmit", actor, role, null).isEmpty()) {
            throw new IllegalStateException("registration resubmit transition stale");
        }
        var row = db.queryForMap(
            "SELECT id, occurred_at FROM registration_transition_event WHERE application_id = ? ORDER BY occurred_at DESC LIMIT 1", id);
        return new LegacyReturn((UUID) row.get("id"), ((java.sql.Timestamp) row.get("occurred_at")).toInstant(), UUID.randomUUID());
    }

    void wiredReturn(UUID id, String stage, UUID officer, String role, String idem, String reason) {
        tx.executeWithoutResult(s -> {
            int version = db.queryForObject("SELECT version FROM registration_application WHERE id = ?", Integer.class, id);
            var leg = legacyReturn(id, version, stage, officer, role, reason);
            completeWiredReturn(id, leg.returnId(), leg.transitionEventId(), stage, reason, leg.returnedAt(), officer, role, idem);
        });
    }

    void completeWiredReturn(UUID applicationId, UUID returnId, UUID transitionEventId, String fromStage, String reason, Instant returnedAt,
                             UUID actor, String role, String idempotencyKey) {
        var policy = policyRepo.requireApplicableVersion(returnedAt);
        Instant dueAt = policyRepo.dueAtEndOfWorkingDays(returnedAt, policy);
        String dueText = DUE_LABEL.format(dueAt);
        UUID notifyCommand = commandId(idempotencyKey, "registration_return_notify", applicationId);
        String notifySuffix = "was returned to you: " + reason + " Respond by " + dueText + ". Edit it and send it again.";
        String notifyHash = NotificationCommandRepository.payloadHash(
            new NotificationCommandRepository.DeliverCommand(WorkflowFoundationRepository.SUBJECT_REGISTRATION, applicationId, "returned", notifySuffix));
        UUID taskCommand = commandId(idempotencyKey, "registration_return_task", applicationId);
        var taskCmd = new WorkflowFoundationRepository.TaskCommand(WorkflowFoundationRepository.SUBJECT_REGISTRATION, applicationId, fromStage, "review",
            role, actor, dueAt, policy.id(), returnedAt);
        UUID wiringCommand = commandId(idempotencyKey, "registration_return_wiring", applicationId);
        String wiringHash = sha256(returnId + "|" + fromStage + "|" + reason + "|" + returnedAt + "|return");
        wiringRepo.orchestrateWiredReturn(new RegistrationReturnResponseWiringRepository.OrchestrateWiredReturnCommand(
            returnId, applicationId, transitionEventId, fromStage, reason, actor, returnedAt, role,
            notifyCommand, notifyHash, notifySuffix, taskCommand, WorkflowFoundationRepository.payloadHash(taskCmd), role, actor,
            dueAt, policy.id(), wiringCommand, wiringHash, actor));
    }

    void wiredResubmit(UUID id, UUID returnId, String returnFrom, Instant returnAt, String returnReason, String idem, String note) {
        tx.executeWithoutResult(s -> {
            int version = db.queryForObject("SELECT version FROM registration_application WHERE id = ?", Integer.class, id);
            UUID resubId = UUID.randomUUID();
            var leg = legacyResubmit(id, version, returnId, returnFrom, returnAt, returnReason, NOVA_USER, "manufacturer");
            completeResubmit(id, returnId, resubId, leg.transitionEventId(), returnFrom, returnAt, returnReason, note, leg.returnedAt(), idem);
        });
    }

    void completeResubmit(UUID applicationId, UUID returnId, UUID resubmissionId, UUID transitionEventId, String returnedFrom, Instant returnedAt,
                          String returnReason, String note, Instant resubmittedAt, String idempotencyKey) {
        var policy = policyRepo.requireApplicableVersion(returnedAt);
        Instant dueAt = policyRepo.dueAtEndOfWorkingDays(returnedAt, policy);
        String body = note == null || note.isBlank() ? NEUTRAL : note.trim();
        UUID wiringCommand = commandId(idempotencyKey, "registration_resubmit_wiring", applicationId);
        String wiringHash = sha256(returnId + "|programme_review|" + (note == null ? "" : note) + "|" + resubmittedAt + "|resubmit");
        UUID notifyCommand = commandId(idempotencyKey, "registration_resubmit_notify", applicationId);
        UUID taskCommand = commandId(idempotencyKey, "registration_resubmit_task", applicationId);
        UUID taskOwner = owner.queryForObject("SELECT returned_by_account_id FROM registration_application_return WHERE id = ?", UUID.class, returnId);
        String taskOwnerRole = owner.queryForObject(
            "SELECT CASE returned_from_state WHEN 'programme_review' THEN 'programme' WHEN 'director_approval' THEN 'director' END "
                + "FROM registration_application_return WHERE id = ?",
            String.class, returnId);
        var taskCmd = new WorkflowFoundationRepository.TaskCommand(WorkflowFoundationRepository.SUBJECT_REGISTRATION, applicationId, returnedFrom, "review",
            taskOwnerRole, taskOwner, dueAt, policy.id(), returnedAt);
        wiringRepo.orchestrateResubmit(new RegistrationReturnResponseWiringRepository.OrchestrateResubmitCommand(
            applicationId, returnId, resubmissionId, transitionEventId, returnedFrom, returnedAt, returnReason, "programme_review", body, resubmittedAt,
            NOVA_USER, "manufacturer", wiringCommand, wiringHash, notifyCommand, taskCommand, WorkflowFoundationRepository.payloadHash(taskCmd),
            taskOwnerRole, taskOwner, dueAt, policy.id(), NOVA_USER));
    }

    void closeOpenCycleAsTestFixture(UUID applicationId, UUID closureTransitionEventId, UUID actor) {
        UUID taskId = owner.queryForObject("SELECT task_id FROM registration_return_response_cycle WHERE application_id = ? AND status = 'open'", UUID.class, applicationId);
        int taskVersion = owner.queryForObject("SELECT version FROM workflow_task WHERE id = ?", Integer.class, taskId);
        UUID clockId = owner.queryForObject("SELECT id FROM workflow_sla_clock WHERE task_id = ?", UUID.class, taskId);
        owner.query("SELECT workflow_foundation_append_clock_event(?, 'stop', 'bureau', now() + interval '1 millisecond', NULL)", rs -> {
        }, clockId);
        owner.query("SELECT workflow_foundation_terminal_task(?, ?, 'completed', ?, 'programme', 'wp02c_test_fixture_close')", rs -> {
        }, taskId, taskVersion, actor);
        owner.update(
            "UPDATE registration_return_response_cycle SET status = 'closed', closed_at = now(), closure_transition_event_id = ?, "
                + "closure_from_state = 'programme_review', closure_to_state = 'director_approval' WHERE application_id = ? AND status = 'open'",
            closureTransitionEventId, applicationId);
    }

    static String sha256(String s) {
        try {
            return HexFormat.of().formatHex(java.security.MessageDigest.getInstance("SHA-256").digest(s.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    UUID latestReturnId(UUID applicationId) {
        return owner.queryForObject("SELECT id FROM registration_application_return WHERE application_id = ? ORDER BY returned_at DESC LIMIT 1", UUID.class, applicationId);
    }

    @Test
    void firstProgrammeReturnCreatesCompleteAtomicBundle() {
        UUID id = atProgrammeReview("WP02C-FIRST-" + TAG);
        wiredReturn(id, "programme_review", PROGRAMME_USER, "programme", UUID.randomUUID().toString(), REASON);
        assertEquals(1, owner.queryForObject("SELECT count(*) FROM registration_application_return WHERE application_id = ?", Integer.class, id));
        assertEquals(1, owner.queryForObject("SELECT count(*) FROM registration_return_response_cycle WHERE application_id = ?", Integer.class, id));
        assertEquals(1, owner.queryForObject("SELECT count(*) FROM workflow_task WHERE subject_id = ? AND action = 'review'", Integer.class, id));
    }

    @Test
    void directorReturnUsesPersistedTransitionAndReturningDirectorRule() {
        UUID id = atDirectorReview("WP02C-DIR-" + TAG);
        wiredReturn(id, "director_approval", DIRECTOR_USER, "director", UUID.randomUUID().toString(), REASON);
        wiredResubmit(id, latestReturnId(id), "director_approval",
            owner.queryForObject("SELECT returned_at FROM registration_application_return WHERE application_id = ?", Instant.class, id),
            REASON, UUID.randomUUID().toString(), null);
        assertEquals(1, owner.queryForObject("SELECT count(*) FROM notification WHERE recipient_account_id = ? AND kind = 'applicant_resubmitted'", Integer.class,
            DIRECTOR_USER));
    }

    @Test
    void returnNotificationFansOutOnlyToActiveFilingOrganisationAccounts() {
        UUID id = atProgrammeReview("WP02C-FANOUT-" + TAG);
        wiredReturn(id, "programme_review", PROGRAMME_USER, "programme", UUID.randomUUID().toString(), REASON);
        int orgMembers = owner.queryForObject(
            "SELECT count(DISTINCT m.user_id) FROM organisation_membership m JOIN user_account u ON u.id = m.user_id "
                + "WHERE m.organisation_id = ? AND m.active AND u.status = 'active'", Integer.class, NOVA_ORG);
        assertEquals(orgMembers, owner.queryForObject("SELECT count(*) FROM notification WHERE subject_kind = 'registration_application' AND subject_id = ? AND kind = 'returned'",
            Integer.class, id));
        assertEquals(0, owner.queryForObject("SELECT count(*) FROM notification WHERE subject_kind = 'registration_application' AND subject_id = ? AND recipient_account_id = ?",
            Integer.class, id, PROGRAMME_USER));
    }

    @Test
    void returnPersistsAndNotifiesExactCalendarDueDate() {
        owner.update("INSERT INTO workflow_calendar_closure (calendar_key, closure_date, reason) VALUES ('india_bee_default', ?, 'wp02c') ON CONFLICT DO NOTHING",
            LocalDate.of(2026, 3, 18));
        UUID id = atProgrammeReview("WP02C-DUE-" + TAG);
        Instant anchor = ZonedDateTime.of(2026, 3, 16, 10, 0, 0, 0, KOLKATA).toInstant();
        LegacyReturn leg = tx.execute(s -> {
            int version = db.queryForObject("SELECT version FROM registration_application WHERE id = ?", Integer.class, id);
            return legacyReturn(id, version, "programme_review", PROGRAMME_USER, "programme", REASON);
        });
        maint.update("UPDATE registration_transition_event SET occurred_at = ? WHERE id = ?", java.sql.Timestamp.from(anchor), leg.transitionEventId());
        tx.executeWithoutResult(s -> completeWiredReturn(id, leg.returnId(), leg.transitionEventId(), "programme_review", REASON, anchor, PROGRAMME_USER, "programme",
            UUID.randomUUID().toString()));
        var policy = policyRepo.requireApplicableVersion(anchor);
        Instant due = policyRepo.dueAtEndOfWorkingDays(anchor, policy);
        assertEquals(due, owner.queryForObject(
            "SELECT t.due_at FROM workflow_task t JOIN registration_return_response_cycle c ON c.task_id = t.id WHERE c.application_id = ?", Instant.class, id));
        String msg = owner.queryForObject("SELECT message FROM notification WHERE subject_id = ? AND kind = 'returned' LIMIT 1", String.class, id);
        assertTrue(msg.contains("Respond by " + DUE_LABEL.format(due)), msg);
    }

    @Test
    void identicalReturnReplayIsStableAndChangedPayloadConflicts() {
        UUID id = atProgrammeReview("WP02C-REPLAY-" + TAG);
        String idem = UUID.randomUUID().toString();
        LegacyReturn first = tx.execute(s -> {
            int version = db.queryForObject("SELECT version FROM registration_application WHERE id = ?", Integer.class, id);
            var leg = legacyReturn(id, version, "programme_review", PROGRAMME_USER, "programme", REASON);
            completeWiredReturn(id, leg.returnId(), leg.transitionEventId(), "programme_review", REASON, leg.returnedAt(), PROGRAMME_USER, "programme", idem);
            completeWiredReturn(id, leg.returnId(), leg.transitionEventId(), "programme_review", REASON, leg.returnedAt(), PROGRAMME_USER, "programme", idem);
            return leg;
        });
        wiredResubmit(id, first.returnId(), "programme_review", first.returnedAt(), REASON, UUID.randomUUID().toString(), null);
        assertThrows(WorkflowIdempotencyConflictException.class, () -> tx.executeWithoutResult(s -> {
            var second = legacyReturn(id, db.queryForObject("SELECT version FROM registration_application WHERE id = ?", Integer.class, id),
                "programme_review", PROGRAMME_USER, "programme", "Other reason.");
            completeWiredReturn(id, second.returnId(), second.transitionEventId(), "programme_review", "Other reason.", second.returnedAt(), PROGRAMME_USER,
                "programme", idem);
        }));
        assertEquals(1, owner.queryForObject("SELECT count(*) FROM registration_return_response_wiring_evidence WHERE application_id = ? AND purpose = 'registration_return_wiring'",
            Integer.class, id));
    }

    @Test
    void concurrentReturnCreatesOneCompleteOutcome() throws Exception {
        UUID id = atProgrammeReview("WP02C-CONC-RET-" + TAG);
        int version = owner.queryForObject("SELECT version FROM registration_application WHERE id = ?", Integer.class, id);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        CountDownLatch start = new CountDownLatch(1);
        Future<?> f1 = pool.submit(() -> {
            try {
                start.await(5, TimeUnit.SECONDS);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return;
            }
            tx.executeWithoutResult(s -> {
                var leg = legacyReturn(id, version, "programme_review", PROGRAMME_USER, "programme", REASON);
                completeWiredReturn(id, leg.returnId(), leg.transitionEventId(), "programme_review", REASON, leg.returnedAt(), PROGRAMME_USER, "programme",
                    UUID.randomUUID().toString());
            });
        });
        Future<?> f2 = pool.submit(() -> {
            try {
                start.await(5, TimeUnit.SECONDS);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return;
            }
            tx.executeWithoutResult(s -> {
                var leg = legacyReturn(id, version, "programme_review", PROGRAMME_USER, "programme", REASON);
                completeWiredReturn(id, leg.returnId(), leg.transitionEventId(), "programme_review", REASON, leg.returnedAt(), PROGRAMME_USER, "programme",
                    UUID.randomUUID().toString());
            });
        });
        start.countDown();
        int ok = 0;
        for (Future<?> f : List.of(f1, f2)) {
            try {
                f.get(30, TimeUnit.SECONDS);
                ok++;
            } catch (Exception ignored) {
            }
        }
        pool.shutdown();
        assertEquals(1, ok);
        assertEquals(1, owner.queryForObject("SELECT count(*) FROM registration_application_return WHERE application_id = ?", Integer.class, id));
        assertEquals(1, owner.queryForObject("SELECT count(*) FROM registration_return_response_cycle WHERE application_id = ?", Integer.class, id));
    }

    @Test
    void returnFailureRollsBackNotificationTaskClockDiscrepancyCycleAndEvidence() {
        UUID id = atProgrammeReview("WP02C-ROLLBACK-" + TAG);
        String subject = id.toString();
        owner.execute(
            "CREATE FUNCTION wp02c_fail_after_task_for_test() RETURNS trigger LANGUAGE plpgsql AS $$ "
                + "BEGIN IF NEW.event_kind = 'pause' AND EXISTS (SELECT 1 FROM workflow_sla_clock c JOIN workflow_task t ON t.id = c.task_id "
                + "WHERE c.id = NEW.clock_id AND t.subject_id = '" + subject + "'::uuid) THEN "
                + "RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'wp02c_test_failure_after_task'; END IF; RETURN NEW; END $$");
        owner.execute("CREATE TRIGGER wp02c_fail_after_task_for_test BEFORE INSERT ON workflow_sla_clock_event FOR EACH ROW EXECUTE FUNCTION wp02c_fail_after_task_for_test()");
        try {
            assertThrows(DataAccessException.class, () -> wiredReturn(id, "programme_review", PROGRAMME_USER, "programme", UUID.randomUUID().toString(), REASON));
        } finally {
            owner.execute("DROP TRIGGER IF EXISTS wp02c_fail_after_task_for_test ON workflow_sla_clock_event");
            owner.execute("DROP FUNCTION IF EXISTS wp02c_fail_after_task_for_test()");
        }
        assertEquals("programme_review", owner.queryForObject("SELECT state FROM registration_application WHERE id = ?", String.class, id));
        assertEquals(0, owner.queryForObject("SELECT count(*) FROM registration_application_return WHERE application_id = ?", Integer.class, id));
    }

    @Test
    void resubmitRequiresLatestReturnBoundToOpenCycle() {
        UUID id = atProgrammeReview("WP02C-RESUB-MATCH-" + TAG);
        wiredReturn(id, "programme_review", PROGRAMME_USER, "programme", UUID.randomUUID().toString(), REASON);
        UUID wrongReturn = UUID.randomUUID();
        assertThrows(DataAccessException.class, () -> tx.executeWithoutResult(s -> {
            int version = owner.queryForObject("SELECT version FROM registration_application WHERE id = ?", Integer.class, id);
            var leg = legacyResubmit(id, version, wrongReturn, "programme_review", Instant.now(), REASON, NOVA_USER, "manufacturer");
            completeResubmit(id, wrongReturn, UUID.randomUUID(), leg.transitionEventId(), "programme_review", Instant.now(), REASON, null, leg.returnedAt(),
                UUID.randomUUID().toString());
        }));
    }

    @Test
    void resubmitAppendsResponseResumesClockAndNotifiesResolvedOfficer() {
        UUID id = atProgrammeReview("WP02C-RESUB-" + TAG);
        wiredReturn(id, "programme_review", PROGRAMME_USER, "programme", UUID.randomUUID().toString(), REASON);
        int before = owner.queryForObject(
            "SELECT count(*) FROM notification WHERE recipient_account_id = ? AND kind = 'applicant_resubmitted' AND subject_id = ?", Integer.class, PROGRAMME_USER, id);
        wiredResubmit(id, latestReturnId(id), "programme_review",
            owner.queryForObject("SELECT returned_at FROM registration_application_return WHERE application_id = ?", Instant.class, id),
            REASON, UUID.randomUUID().toString(), "Fixed licence.");
        assertEquals(1, wiringRepo.countDiscrepancyResponses(wiringRepo.findOpenCycle(id).orElseThrow().discrepancyId()));
        assertEquals(before + 1, owner.queryForObject(
            "SELECT count(*) FROM notification WHERE recipient_account_id = ? AND kind = 'applicant_resubmitted' AND subject_id = ?", Integer.class, PROGRAMME_USER, id));
    }

    @Test
    void identicalResubmitReplayIsStableAndChangedPayloadConflicts() {
        UUID id = atProgrammeReview("WP02C-RESUB-REPLAY-" + TAG);
        wiredReturn(id, "programme_review", PROGRAMME_USER, "programme", UUID.randomUUID().toString(), REASON);
        UUID returnId = latestReturnId(id);
        Instant returnAt = owner.queryForObject("SELECT returned_at FROM registration_application_return WHERE id = ?", Instant.class, returnId);
        String idem = UUID.randomUUID().toString();
        UUID resubmissionId = UUID.randomUUID();
        tx.execute(s -> {
            int version = db.queryForObject("SELECT version FROM registration_application WHERE id = ?", Integer.class, id);
            var leg = legacyResubmit(id, version, returnId, "programme_review", returnAt, REASON, NOVA_USER, "manufacturer");
            completeResubmit(id, returnId, resubmissionId, leg.transitionEventId(), "programme_review", returnAt, REASON, null, leg.returnedAt(), idem);
            completeResubmit(id, returnId, resubmissionId, leg.transitionEventId(), "programme_review", returnAt, REASON, null, leg.returnedAt(), idem);
            return null;
        });
        wiredReturn(id, "programme_review", PROGRAMME_USER, "programme", UUID.randomUUID().toString(), "Need more.");
        UUID secondReturn = latestReturnId(id);
        Instant secondReturnAt = owner.queryForObject("SELECT returned_at FROM registration_application_return WHERE id = ?", Instant.class, secondReturn);
        assertThrows(WorkflowIdempotencyConflictException.class, () -> tx.execute(s -> {
            int version = db.queryForObject("SELECT version FROM registration_application WHERE id = ?", Integer.class, id);
            var leg = legacyResubmit(id, version, secondReturn, "programme_review", secondReturnAt, "Need more.", NOVA_USER, "manufacturer");
            completeResubmit(id, secondReturn, UUID.randomUUID(), leg.transitionEventId(), "programme_review", secondReturnAt, "Need more.", "changed", leg.returnedAt(), idem);
            return null;
        }));
    }

    @Test
    void concurrentResubmitCreatesOneCompleteOutcome() throws Exception {
        UUID id = atProgrammeReview("WP02C-CONC-SUB-" + TAG);
        wiredReturn(id, "programme_review", PROGRAMME_USER, "programme", UUID.randomUUID().toString(), REASON);
        UUID returnId = latestReturnId(id);
        Instant returnAt = owner.queryForObject("SELECT returned_at FROM registration_application_return WHERE id = ?", Instant.class, returnId);
        int version = owner.queryForObject("SELECT version FROM registration_application WHERE id = ?", Integer.class, id);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        CountDownLatch start = new CountDownLatch(1);
        Runnable attempt = () -> {
            try {
                start.await(5, TimeUnit.SECONDS);
                tx.executeWithoutResult(s -> {
                    var leg = legacyResubmit(id, version, returnId, "programme_review", returnAt, REASON, NOVA_USER, "manufacturer");
                    completeResubmit(id, returnId, UUID.randomUUID(), leg.transitionEventId(), "programme_review", returnAt, REASON, null, leg.returnedAt(),
                        UUID.randomUUID().toString());
                });
            } catch (Exception ignored) {
            }
        };
        Future<?> f1 = pool.submit(attempt);
        Future<?> f2 = pool.submit(attempt);
        start.countDown();
        f1.get(30, TimeUnit.SECONDS);
        f2.get(30, TimeUnit.SECONDS);
        pool.shutdown();
        assertEquals(1, owner.queryForObject("SELECT count(*) FROM registration_application_resubmission WHERE application_id = ?", Integer.class, id));
    }

    @Test
    void reReturnUsesSameCycleNeedsMoreAndPausesClockAgain() {
        UUID id = atProgrammeReview("WP02C-RERET-" + TAG);
        wiredReturn(id, "programme_review", PROGRAMME_USER, "programme", UUID.randomUUID().toString(), REASON);
        UUID task = owner.queryForObject("SELECT task_id FROM registration_return_response_cycle WHERE application_id = ?", UUID.class, id);
        wiredResubmit(id, latestReturnId(id), "programme_review",
            owner.queryForObject("SELECT returned_at FROM registration_application_return WHERE application_id = ?", Instant.class, id),
            REASON, UUID.randomUUID().toString(), null);
        wiredReturn(id, "programme_review", PROGRAMME_USER, "programme", UUID.randomUUID().toString(), "Still incomplete.");
        assertEquals(task, owner.queryForObject("SELECT task_id FROM registration_return_response_cycle WHERE application_id = ?", UUID.class, id));
        assertEquals("needs_more", owner.queryForObject(
            "SELECT outcome FROM workflow_discrepancy_disposition d JOIN registration_return_response_cycle c ON c.discrepancy_id = d.discrepancy_id WHERE c.application_id = ? LIMIT 1",
            String.class, id));
    }

    @Test
    void returnAfterClosedCycleStartsNextCycle() {
        UUID id = atProgrammeReview("WP02C-NEXT-CYCLE-" + TAG);
        wiredReturn(id, "programme_review", PROGRAMME_USER, "programme", UUID.randomUUID().toString(), REASON);
        UUID returnId = latestReturnId(id);
        wiredResubmit(id, returnId, "programme_review",
            owner.queryForObject("SELECT returned_at FROM registration_application_return WHERE id = ?", Instant.class, returnId),
            REASON, UUID.randomUUID().toString(), null);
        UUID closeEvent = UUID.randomUUID();
        owner.update("INSERT INTO registration_transition_event (id, application_id, action, from_state, to_state, actor_account_id, actor_role, version_after) "
            + "VALUES (?, ?, 'recommend', 'programme_review', 'director_approval', ?, 'programme', 99)", closeEvent, id, PROGRAMME_USER);
        closeOpenCycleAsTestFixture(id, closeEvent, PROGRAMME_USER);
        wiredReturn(id, "programme_review", PROGRAMME_USER, "programme", UUID.randomUUID().toString(), "Second cycle.");
        assertEquals(2, owner.queryForObject("SELECT count(*) FROM registration_return_response_cycle WHERE application_id = ?", Integer.class, id));
        assertEquals(1, owner.queryForObject("SELECT count(*) FROM registration_return_response_cycle WHERE application_id = ? AND status = 'open'", Integer.class, id));
    }

    @Test
    void runtimeCannotInsertRewriteOrDeleteRegistrationWorkflowHistory() {
        UUID id = atProgrammeReview("WP02C-TAMPER-" + TAG);
        wiredReturn(id, "programme_review", PROGRAMME_USER, "programme", UUID.randomUUID().toString(), REASON);
        assertThrows(DataAccessException.class, () -> db.update("INSERT INTO registration_application_return (id, application_id, transition_event_id, returned_from_state, "
            + "reason, returned_by_account_id, returned_at, foundation_notify_command_id) SELECT gen_random_uuid(), application_id, transition_event_id, returned_from_state, "
            + "reason, returned_by_account_id, returned_at, foundation_notify_command_id FROM registration_application_return LIMIT 1"));
        assertThrows(DataAccessException.class, () -> db.update("UPDATE registration_return_response_cycle SET task_id = gen_random_uuid() WHERE application_id = ?", id));
    }

    @Test
    void runtimeExecuteListContainsOnlyRegistrationHighLevelCommands() {
        var allowed = owner.queryForList(
            "SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace "
                + "WHERE n.nspname = ? AND p.proname LIKE 'registration_return_response_%' AND p.prosecdef "
                + "AND has_function_privilege(?, p.oid, 'EXECUTE') ORDER BY 1",
            String.class, MAIN, runtimeRole());
        assertEquals(
            List.of("registration_return_response_orchestrate_resubmit", "registration_return_response_orchestrate_wired_return"),
            allowed);
    }

    @Test
    void internalHelperCannotBindReturnToClosedOrDifferentApplicationCycle() {
        UUID id = atProgrammeReview("WP02C-BIND-" + TAG);
        wiredReturn(id, "programme_review", PROGRAMME_USER, "programme", UUID.randomUUID().toString(), REASON);
        UUID returnId = latestReturnId(id);
        wiredResubmit(id, returnId, "programme_review",
            owner.queryForObject("SELECT returned_at FROM registration_application_return WHERE id = ?", Instant.class, returnId),
            REASON, UUID.randomUUID().toString(), null);
        UUID cycle = owner.queryForObject("SELECT id FROM registration_return_response_cycle WHERE application_id = ?", UUID.class, id);
        UUID closeEvent = UUID.randomUUID();
        owner.update("INSERT INTO registration_transition_event (id, application_id, action, from_state, to_state, actor_account_id, actor_role, version_after) "
            + "VALUES (?, ?, 'recommend', 'programme_review', 'director_approval', ?, 'programme', 99)", closeEvent, id, PROGRAMME_USER);
        closeOpenCycleAsTestFixture(id, closeEvent, PROGRAMME_USER);
        UUID extraReturn = UUID.randomUUID();
        var failure = assertThrows(DataAccessException.class, () -> owner.query("SELECT registration_return_response_bind_cycle_return(?, ?)", rs -> {
        }, cycle, extraReturn));
        assertTrue(String.valueOf(failure.getMostSpecificCause().getMessage()).contains("registration_return_response_return_cycle_bind_invalid"));
    }

    @Test
    void subjectDeleteBlockedWhileRegistrationWorkflowHistoryExists() {
        UUID id = atProgrammeReview("WP02C-DEL-" + TAG);
        wiredReturn(id, "programme_review", PROGRAMME_USER, "programme", UUID.randomUUID().toString(), REASON);
        assertThrows(DataAccessException.class, () -> owner.update("DELETE FROM registration_application WHERE id = ?", id));
    }

    @Test
    void disposableRegistrationCleanupRemovesNewRowsInDependencyOrder() {
        UUID id = atProgrammeReview("WP02C-CLEAN-" + TAG);
        wiredReturn(id, "programme_review", PROGRAMME_USER, "programme", UUID.randomUUID().toString(), REASON);
        owner.update("INSERT INTO local_disposable_registration (application_id) VALUES (?)", id);
        maint.execute("SELECT set_config('bee.cleanup_schema', '" + MAIN + "', true)");
        maint.query("SELECT app_disposable_registration_cleanup(ARRAY[?]::uuid[])", rs -> {
        }, id);
        assertEquals(0, owner.queryForObject("SELECT count(*) FROM registration_application WHERE id = ?", Integer.class, id));
        assertEquals(0, owner.queryForObject("SELECT count(*) FROM registration_return_response_cycle WHERE application_id = ?", Integer.class, id));
    }

    @Test
    void productionMaintClosureFunctionIsAbsentFromMigratedSchema() {
        assertEquals(0, owner.queryForObject(
            "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace "
                + "WHERE n.nspname = ? AND p.proname = 'registration_return_response_maint_close_cycle'",
            Integer.class, MAIN));
    }

    @Test
    void wrongDueTimeIsRejectedWithNoPartialBundle() {
        UUID id = atProgrammeReview("WP02C-DUE-REJ-" + TAG);
        LegacyReturn leg = tx.execute(s -> {
            int version = db.queryForObject("SELECT version FROM registration_application WHERE id = ?", Integer.class, id);
            return legacyReturn(id, version, "programme_review", PROGRAMME_USER, "programme", REASON);
        });
        var policy = policyRepo.requireApplicableVersion(leg.returnedAt());
        Instant wrongDue = policyRepo.dueAtEndOfWorkingDays(leg.returnedAt(), policy).plusSeconds(3600);
        assertThrows(DataAccessException.class, () -> tx.executeWithoutResult(s -> wiringRepo.orchestrateWiredReturn(
            new RegistrationReturnResponseWiringRepository.OrchestrateWiredReturnCommand(
                leg.returnId(), id, leg.transitionEventId(), "programme_review", REASON, PROGRAMME_USER, leg.returnedAt(), "programme",
                commandId(UUID.randomUUID().toString(), "registration_return_notify", id),
                NotificationCommandRepository.payloadHash(new NotificationCommandRepository.DeliverCommand(
                    WorkflowFoundationRepository.SUBJECT_REGISTRATION, id, "returned",
                    "was returned to you: " + REASON + " Respond by " + DUE_LABEL.format(policyRepo.dueAtEndOfWorkingDays(leg.returnedAt(), policy))
                        + ". Edit it and send it again.")),
                "was returned to you: " + REASON + " Respond by " + DUE_LABEL.format(policyRepo.dueAtEndOfWorkingDays(leg.returnedAt(), policy))
                    + ". Edit it and send it again.",
                commandId(UUID.randomUUID().toString(), "registration_return_task", id),
                "deadbeef".repeat(8), "programme", PROGRAMME_USER, wrongDue, policy.id(),
                commandId(UUID.randomUUID().toString(), "registration_return_wiring", id),
                sha256(leg.returnId() + "|programme_review|" + REASON + "|" + leg.returnedAt() + "|return"), PROGRAMME_USER))));
        assertEquals(0, owner.queryForObject("SELECT count(*) FROM registration_application_return WHERE application_id = ?", Integer.class, id));
    }

    @Test
    void wrongTaskOwnerIsRejectedAtomically() {
        UUID id = atProgrammeReview("WP02C-OWNER-REJ-" + TAG);
        LegacyReturn leg = tx.execute(s -> {
            int version = db.queryForObject("SELECT version FROM registration_application WHERE id = ?", Integer.class, id);
            return legacyReturn(id, version, "programme_review", PROGRAMME_USER, "programme", REASON);
        });
        var policy = policyRepo.requireApplicableVersion(leg.returnedAt());
        Instant dueAt = policyRepo.dueAtEndOfWorkingDays(leg.returnedAt(), policy);
        String suffix = "was returned to you: " + REASON + " Respond by " + DUE_LABEL.format(dueAt) + ". Edit it and send it again.";
        var taskCmd = new WorkflowFoundationRepository.TaskCommand(WorkflowFoundationRepository.SUBJECT_REGISTRATION, id, "programme_review", "review",
            "programme", PROGRAMME_USER, dueAt, policy.id(), leg.returnedAt());
        assertThrows(DataAccessException.class, () -> tx.executeWithoutResult(s -> wiringRepo.orchestrateWiredReturn(
            new RegistrationReturnResponseWiringRepository.OrchestrateWiredReturnCommand(
                leg.returnId(), id, leg.transitionEventId(), "programme_review", REASON, PROGRAMME_USER, leg.returnedAt(), "programme",
                commandId(UUID.randomUUID().toString(), "registration_return_notify", id),
                NotificationCommandRepository.payloadHash(new NotificationCommandRepository.DeliverCommand(
                    WorkflowFoundationRepository.SUBJECT_REGISTRATION, id, "returned", suffix)),
                suffix, commandId(UUID.randomUUID().toString(), "registration_return_task", id),
                WorkflowFoundationRepository.payloadHash(taskCmd), "programme", DIRECTOR_USER, dueAt, policy.id(),
                commandId(UUID.randomUUID().toString(), "registration_return_wiring", id),
                sha256(leg.returnId() + "|programme_review|" + REASON + "|" + leg.returnedAt() + "|return"), PROGRAMME_USER))));
        assertEquals(0, owner.queryForObject("SELECT count(*) FROM registration_application_return WHERE application_id = ?", Integer.class, id));
    }

    @Test
    void identicalReturnReplayAfterResubmitIsStable() {
        UUID id = atProgrammeReview("WP02C-RET-REPLAY-LIFE-" + TAG);
        String idem = UUID.randomUUID().toString();
        LegacyReturn leg = tx.execute(s -> {
            int version = db.queryForObject("SELECT version FROM registration_application WHERE id = ?", Integer.class, id);
            var first = legacyReturn(id, version, "programme_review", PROGRAMME_USER, "programme", REASON);
            completeWiredReturn(id, first.returnId(), first.transitionEventId(), "programme_review", REASON, first.returnedAt(), PROGRAMME_USER, "programme", idem);
            return first;
        });
        wiredResubmit(id, leg.returnId(), "programme_review", leg.returnedAt(), REASON, UUID.randomUUID().toString(), null);
        UUID replayed = tx.execute(s -> {
            completeWiredReturn(id, leg.returnId(), leg.transitionEventId(), "programme_review", REASON, leg.returnedAt(), PROGRAMME_USER, "programme", idem);
            return owner.queryForObject("SELECT id FROM registration_application_return WHERE transition_event_id = ?", UUID.class, leg.transitionEventId());
        });
        assertEquals(leg.returnId(), replayed);
    }

    @Test
    void identicalResubmitReplayAfterReReturnIsStable() {
        UUID id = atProgrammeReview("WP02C-SUB-REPLAY-LIFE-" + TAG);
        wiredReturn(id, "programme_review", PROGRAMME_USER, "programme", UUID.randomUUID().toString(), REASON);
        UUID returnId = latestReturnId(id);
        Instant returnAt = owner.queryForObject("SELECT returned_at FROM registration_application_return WHERE id = ?", Instant.class, returnId);
        String idem = UUID.randomUUID().toString();
        UUID resubId = UUID.randomUUID();
        LegacyReturn leg = tx.execute(s -> {
            int version = db.queryForObject("SELECT version FROM registration_application WHERE id = ?", Integer.class, id);
            var first = legacyResubmit(id, version, returnId, "programme_review", returnAt, REASON, NOVA_USER, "manufacturer");
            completeResubmit(id, returnId, resubId, first.transitionEventId(), "programme_review", returnAt, REASON, null, first.returnedAt(), idem);
            return first;
        });
        wiredReturn(id, "programme_review", PROGRAMME_USER, "programme", UUID.randomUUID().toString(), "Need more.");
        tx.executeWithoutResult(s -> completeResubmit(id, returnId, resubId, leg.transitionEventId(), "programme_review", returnAt, REASON, null, leg.returnedAt(), idem));
        assertEquals(resubId, owner.queryForObject("SELECT id FROM registration_application_resubmission WHERE transition_event_id = ?", UUID.class, leg.transitionEventId()));
    }

    @Test
    void returnFromApplicationACannotBindToApplicationBCycle() {
        UUID idA = atProgrammeReview("WP02C-CROSS-A-" + TAG);
        UUID idB = atProgrammeReview("WP02C-CROSS-B-" + TAG);
        wiredReturn(idA, "programme_review", PROGRAMME_USER, "programme", UUID.randomUUID().toString(), REASON);
        wiredReturn(idB, "programme_review", PROGRAMME_USER, "programme", UUID.randomUUID().toString(), REASON);
        UUID cycleB = owner.queryForObject("SELECT id FROM registration_return_response_cycle WHERE application_id = ?", UUID.class, idB);
        UUID returnA = latestReturnId(idA);
        var failure = assertThrows(DataAccessException.class, () -> owner.query("SELECT registration_return_response_bind_cycle_return(?, ?)", rs -> {
        }, cycleB, returnA));
        assertTrue(String.valueOf(failure.getMostSpecificCause().getMessage()).contains("registration_return_response_return_cycle_bind_invalid"));
    }

    @Test
    void runtimeCannotExecuteInternalRegistrationHelpers() {
        var internal = owner.queryForList(
            "SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace "
                + "WHERE n.nspname = ? AND p.proname LIKE 'registration_return_response_%' AND p.prosecdef "
                + "AND p.proname NOT IN ('registration_return_response_orchestrate_wired_return', 'registration_return_response_orchestrate_resubmit') "
                + "AND has_function_privilege(?, p.oid, 'EXECUTE') ORDER BY 1",
            String.class, MAIN, runtimeRole());
        assertTrue(internal.isEmpty(), internal.toString());
    }
}
