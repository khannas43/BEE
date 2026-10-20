package gov.bee.api.snl;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNotNull;
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
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Future;
import java.util.concurrent.ThreadLocalRandom;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
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
        owner.execute("GRANT EXECUTE ON FUNCTION " + MAIN + ".app_disposable_registration_cleanup(uuid[]) TO bee_local_maint");
        runtime = sourceAs(MAIN, runtimeRole(), env("BEE_RUNTIME_DB_PASSWORD", "bee-local-runtime"));
        db = new JdbcTemplate(runtime);
        tx = new TransactionTemplate(new DataSourceTransactionManager(runtime));
        registrations = transactional(new RegistrationRepository(db));
        wiringRepo = new RegistrationReturnResponseWiringRepository(db);
        policyRepo = new SnlReturnResponsePolicyRepository(db);
        json = new ObjectMapper();
        assertEquals(87, owner.queryForObject("SELECT max(installed_rank) FROM flyway_schema_history", Integer.class));
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
        var wiringForReview = new RegistrationReturnResponseWiring(wiringRepo, policyRepo);
        var review = new RegistrationReviewService(new RegistrationRepository(db), new RegistrationService(new RegistrationRepository(db), new MasterDataRepository(db),
            new IdempotencyRepository(db), json), wiringForReview, new IdempotencyRepository(db), json);
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
        String taskPayloadHash = WorkflowFoundationRepository.payloadHash(taskCmd);
        String wiringHash = wiringReturnHash(applicationId, transitionEventId, returnId, fromStage, reason, actor, returnedAt, role,
            notifyCommand, notifyHash, notifySuffix, taskCommand, taskPayloadHash, role, actor, dueAt, policy.id(), actor);
        wiringRepo.orchestrateWiredReturn(new RegistrationReturnResponseWiringRepository.OrchestrateWiredReturnCommand(
            returnId, applicationId, transitionEventId, fromStage, reason, actor, returnedAt, role,
            notifyCommand, notifyHash, notifySuffix, taskCommand, taskPayloadHash, role, actor,
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
        UUID notifyCommand = commandId(idempotencyKey, "registration_resubmit_notify", applicationId);
        UUID taskCommand = commandId(idempotencyKey, "registration_resubmit_task", applicationId);
        UUID taskOwner = owner.queryForObject("SELECT returned_by_account_id FROM registration_application_return WHERE id = ?", UUID.class, returnId);
        String taskOwnerRole = owner.queryForObject(
            "SELECT CASE returned_from_state WHEN 'programme_review' THEN 'programme' WHEN 'director_approval' THEN 'officer' END "
                + "FROM registration_application_return WHERE id = ?",
            String.class, returnId);
        var taskCmd = new WorkflowFoundationRepository.TaskCommand(WorkflowFoundationRepository.SUBJECT_REGISTRATION, applicationId, returnedFrom, "review",
            taskOwnerRole, taskOwner, dueAt, policy.id(), returnedAt);
        String taskPayloadHash = WorkflowFoundationRepository.payloadHash(taskCmd);
        String wiringHash = wiringResubmitHash(applicationId, returnId, resubmissionId, transitionEventId, returnedFrom, returnedAt, returnReason, body,
            resubmittedAt, NOVA_USER, "manufacturer", notifyCommand, taskCommand, taskPayloadHash, taskOwnerRole, taskOwner, dueAt, policy.id(), NOVA_USER);
        wiringRepo.orchestrateResubmit(new RegistrationReturnResponseWiringRepository.OrchestrateResubmitCommand(
            applicationId, returnId, resubmissionId, transitionEventId, returnedFrom, returnedAt, returnReason, "programme_review", body, resubmittedAt,
            NOVA_USER, "manufacturer", wiringCommand, wiringHash, notifyCommand, taskCommand, taskPayloadHash,
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

    String wiringReturnHash(UUID applicationId, UUID transitionEventId, UUID returnId, String fromStage, String reason, UUID returnedBy,
                            Instant returnedAt, String actorRole, UUID notifyCommandId, String notifyPayloadHash, String notifyMessageSuffix,
                            UUID taskCommandId, String taskPayloadHash, String taskOwnerRole, UUID taskOwnerAccount, Instant dueAt, UUID policyVersionId,
                            UUID actorAccount) {
        return owner.queryForObject(
            "SELECT registration_return_response_wiring_return_hash(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            String.class, applicationId, transitionEventId, returnId, fromStage, reason, returnedBy, java.sql.Timestamp.from(returnedAt), actorRole,
            notifyCommandId, notifyPayloadHash, notifyMessageSuffix, taskCommandId, taskPayloadHash, taskOwnerRole, taskOwnerAccount,
            java.sql.Timestamp.from(dueAt), policyVersionId, actorAccount);
    }

    String wiringResubmitHash(UUID applicationId, UUID returnId, UUID resubmissionId, UUID transitionEventId, String returnedFromStage, Instant returnedAt,
                              String returnReason, String responseBody, Instant resubmittedAt, UUID respondedBy, String respondedRole, UUID notifyCommandId,
                              UUID taskCommandId, String taskPayloadHash, String taskOwnerRole, UUID taskOwnerAccount, Instant dueAt, UUID policyVersionId,
                              UUID actorAccount) {
        return owner.queryForObject(
            "SELECT registration_return_response_wiring_resubmit_hash(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            String.class, applicationId, returnId, resubmissionId, transitionEventId, returnedFromStage, java.sql.Timestamp.from(returnedAt), returnReason,
            "programme_review", responseBody, java.sql.Timestamp.from(resubmittedAt), respondedBy, respondedRole, notifyCommandId, taskCommandId, taskPayloadHash,
            taskOwnerRole, taskOwnerAccount, java.sql.Timestamp.from(dueAt), policyVersionId, actorAccount);
    }

    record CompleteBundleSnapshot(
        String appState,
        int appVersion,
        int transitionEvents,
        int returns,
        int resubmissions,
        int cycles,
        int cycleReturns,
        int tasks,
        int taskEvents,
        int clocks,
        int clockEvents,
        int discrepancies,
        int dispositions,
        int responses,
        int notificationCommands,
        int notifications,
        int wiringEvidence) {
    }

    CompleteBundleSnapshot snapshot(UUID applicationId) {
        int tasks = owner.queryForObject("SELECT count(*) FROM workflow_task WHERE subject_kind = 'registration_application' AND subject_id = ?", Integer.class, applicationId);
        return new CompleteBundleSnapshot(
            owner.queryForObject("SELECT state FROM registration_application WHERE id = ?", String.class, applicationId),
            owner.queryForObject("SELECT version FROM registration_application WHERE id = ?", Integer.class, applicationId),
            owner.queryForObject("SELECT count(*) FROM registration_transition_event WHERE application_id = ?", Integer.class, applicationId),
            owner.queryForObject("SELECT count(*) FROM registration_application_return WHERE application_id = ?", Integer.class, applicationId),
            owner.queryForObject("SELECT count(*) FROM registration_application_resubmission WHERE application_id = ?", Integer.class, applicationId),
            owner.queryForObject("SELECT count(*) FROM registration_return_response_cycle WHERE application_id = ?", Integer.class, applicationId),
            owner.queryForObject("SELECT count(*) FROM registration_return_response_cycle_return cr JOIN registration_return_response_cycle c ON c.id = cr.cycle_id WHERE c.application_id = ?",
                Integer.class, applicationId),
            tasks,
            owner.queryForObject("SELECT count(*) FROM workflow_task_event e JOIN workflow_task t ON t.id = e.task_id WHERE t.subject_kind = 'registration_application' AND t.subject_id = ?",
                Integer.class, applicationId),
            owner.queryForObject("SELECT count(*) FROM workflow_sla_clock c JOIN workflow_task t ON t.id = c.task_id WHERE t.subject_kind = 'registration_application' AND t.subject_id = ?",
                Integer.class, applicationId),
            owner.queryForObject("SELECT count(*) FROM workflow_sla_clock_event ce JOIN workflow_sla_clock c ON c.id = ce.clock_id JOIN workflow_task t ON t.id = c.task_id "
                + "WHERE t.subject_kind = 'registration_application' AND t.subject_id = ?", Integer.class, applicationId),
            owner.queryForObject("SELECT count(*) FROM workflow_discrepancy d JOIN registration_return_response_cycle cy ON cy.discrepancy_id = d.id WHERE cy.application_id = ?",
                Integer.class, applicationId),
            owner.queryForObject("SELECT count(*) FROM workflow_discrepancy_disposition dd JOIN workflow_discrepancy d ON d.id = dd.discrepancy_id "
                + "JOIN registration_return_response_cycle cy ON cy.discrepancy_id = d.id WHERE cy.application_id = ?", Integer.class, applicationId),
            owner.queryForObject("SELECT count(*) FROM workflow_discrepancy_response dr JOIN workflow_discrepancy d ON d.id = dr.discrepancy_id "
                + "JOIN registration_return_response_cycle cy ON cy.discrepancy_id = d.id WHERE cy.application_id = ?", Integer.class, applicationId),
            owner.queryForObject("SELECT count(*) FROM notification_command WHERE subject_kind = 'registration_application' AND subject_id = ?", Integer.class, applicationId),
            owner.queryForObject("SELECT count(*) FROM notification WHERE subject_kind = 'registration_application' AND subject_id = ?", Integer.class, applicationId),
            owner.queryForObject("SELECT count(*) FROM registration_return_response_wiring_evidence WHERE application_id = ?", Integer.class, applicationId));
    }

    void assertSnapshot(UUID applicationId, CompleteBundleSnapshot expected) {
        assertEquals(expected, snapshot(applicationId));
    }

    void assertNoReturnWorkflowResidue(UUID applicationId, CompleteBundleSnapshot baseline) {
        assertSnapshot(applicationId, baseline);
    }

    CompleteBundleSnapshot expectedAfterReference(CompleteBundleSnapshot subjectBefore, CompleteBundleSnapshot refBefore, CompleteBundleSnapshot refAfter) {
        return new CompleteBundleSnapshot(
            refAfter.appState(),
            subjectBefore.appVersion() + (refAfter.appVersion() - refBefore.appVersion()),
            subjectBefore.transitionEvents() + (refAfter.transitionEvents() - refBefore.transitionEvents()),
            subjectBefore.returns() + (refAfter.returns() - refBefore.returns()),
            subjectBefore.resubmissions() + (refAfter.resubmissions() - refBefore.resubmissions()),
            subjectBefore.cycles() + (refAfter.cycles() - refBefore.cycles()),
            subjectBefore.cycleReturns() + (refAfter.cycleReturns() - refBefore.cycleReturns()),
            subjectBefore.tasks() + (refAfter.tasks() - refBefore.tasks()),
            subjectBefore.taskEvents() + (refAfter.taskEvents() - refBefore.taskEvents()),
            subjectBefore.clocks() + (refAfter.clocks() - refBefore.clocks()),
            subjectBefore.clockEvents() + (refAfter.clockEvents() - refBefore.clockEvents()),
            subjectBefore.discrepancies() + (refAfter.discrepancies() - refBefore.discrepancies()),
            subjectBefore.dispositions() + (refAfter.dispositions() - refBefore.dispositions()),
            subjectBefore.responses() + (refAfter.responses() - refBefore.responses()),
            subjectBefore.notificationCommands() + (refAfter.notificationCommands() - refBefore.notificationCommands()),
            subjectBefore.notifications() + (refAfter.notifications() - refBefore.notifications()),
            subjectBefore.wiringEvidence() + (refAfter.wiringEvidence() - refBefore.wiringEvidence()));
    }

    void assertSqlMessage(DataAccessException ex, String code) {
        assertTrue(WorkflowFoundationRepository.isSqlMessage(ex, code), ex.toString());
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
        wiredReturn(id, "director_approval", DIRECTOR_USER, "officer", UUID.randomUUID().toString(), REASON);
        wiredResubmit(id, latestReturnId(id), "director_approval",
            owner.queryForObject("SELECT returned_at FROM registration_application_return WHERE application_id = ?", Instant.class, id),
            REASON, UUID.randomUUID().toString(), null);
        assertEquals(1, owner.queryForObject("SELECT count(*) FROM notification WHERE recipient_account_id = ? AND kind = 'applicant_resubmitted'", Integer.class,
            DIRECTOR_USER));
    }

    @Test
    void returnNotificationUsesExactEligibleRecipientSetWithoutOfficerIdentity() {
        UUID id = atProgrammeReview("WP02C-FANOUT-" + TAG);
        UUID extraActive = UUID.randomUUID();
        UUID inactiveMember = UUID.randomUUID();
        UUID wrongOrgUser = UUID.randomUUID();
        owner.update("INSERT INTO user_account (id, keycloak_subject, username, display_name, status) VALUES (?, ?, ?, ?, 'active')",
            extraActive, UUID.randomUUID(), "wp02c-extra-" + TAG, "WP02C extra");
        owner.update("INSERT INTO user_account (id, keycloak_subject, username, display_name, status) VALUES (?, ?, ?, ?, 'disabled')",
            inactiveMember, UUID.randomUUID(), "wp02c-inact-" + TAG, "WP02C inactive");
        owner.update("INSERT INTO user_account (id, keycloak_subject, username, display_name, status) VALUES (?, ?, ?, ?, 'active')",
            wrongOrgUser, UUID.randomUUID(), "wp02c-wrong-" + TAG, "WP02C wrong org");
        owner.update("INSERT INTO organisation_membership (organisation_id, user_id, active) VALUES (?, ?, true)", NOVA_ORG, extraActive);
        owner.update("INSERT INTO organisation_membership (organisation_id, user_id, active) VALUES (?, ?, false)", NOVA_ORG, inactiveMember);
        owner.update("INSERT INTO organisation_membership (organisation_id, user_id, active) VALUES (?, ?, true)",
            UUID.fromString("00000000-0000-4000-b000-000000000002"), wrongOrgUser);
        wiredReturn(id, "programme_review", PROGRAMME_USER, "programme", UUID.randomUUID().toString(), REASON);
        List<UUID> recipients = owner.queryForList(
            "SELECT recipient_account_id FROM notification WHERE subject_kind = 'registration_application' AND subject_id = ? AND kind = 'returned' ORDER BY 1",
            UUID.class, id);
        List<UUID> eligible = owner.queryForList(
            "SELECT DISTINCT m.user_id FROM organisation_membership m JOIN user_account u ON u.id = m.user_id "
                + "WHERE m.organisation_id = ? AND m.active AND u.status = 'active' ORDER BY 1",
            UUID.class, NOVA_ORG);
        assertEquals(eligible, recipients);
        assertFalse(recipients.contains(PROGRAMME_USER));
        String msg = owner.queryForObject("SELECT message FROM notification WHERE subject_id = ? AND kind = 'returned' LIMIT 1", String.class, id);
        assertTrue(msg.contains(REASON));
        assertFalse(msg.toLowerCase(Locale.ENGLISH).contains("programme"));
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
    void concurrentReturnHasOneCompleteSurvivorAndAssertedLoser() throws Exception {
        UUID id = atProgrammeReview("WP02C-CONC-RET-" + TAG);
        CompleteBundleSnapshot before = snapshot(id);
        int version = before.appVersion();
        ExecutorService pool = Executors.newFixedThreadPool(2);
        CountDownLatch start = new CountDownLatch(1);
        AtomicReference<Throwable> loser = new AtomicReference<>();
        Future<?> f1 = pool.submit(() -> {
            try {
                start.await(5, TimeUnit.SECONDS);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new IllegalStateException(e);
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
                throw new IllegalStateException(e);
            }
            tx.executeWithoutResult(s -> {
                var leg = legacyReturn(id, version, "programme_review", PROGRAMME_USER, "programme", REASON);
                completeWiredReturn(id, leg.returnId(), leg.transitionEventId(), "programme_review", REASON, leg.returnedAt(), PROGRAMME_USER, "programme",
                    UUID.randomUUID().toString());
            });
        });
        start.countDown();
        int winners = 0;
        for (Future<?> f : List.of(f1, f2)) {
            try {
                f.get(30, TimeUnit.SECONDS);
                winners++;
            } catch (ExecutionException ex) {
                loser.compareAndSet(null, ex.getCause());
            }
        }
        pool.shutdown();
        assertEquals(1, winners);
        assertNotNull(loser.get());
        assertInstanceOf(IllegalStateException.class, loser.get());
        assertTrue(loser.get().getMessage().contains("registration return transition stale"), loser.get().getMessage());
        UUID refId = atProgrammeReview("WP02C-DELTA-RET-" + TAG);
        CompleteBundleSnapshot refBefore = snapshot(refId);
        wiredReturn(refId, "programme_review", PROGRAMME_USER, "programme", UUID.randomUUID().toString(), REASON);
        CompleteBundleSnapshot expected = expectedAfterReference(before, refBefore, snapshot(refId));
        assertSnapshot(id, expected);
    }

    @Test
    void returnFailureLeavesNoLegacyOrWorkflowResidue() {
        UUID id = atProgrammeReview("WP02C-ROLLBACK-" + TAG);
        CompleteBundleSnapshot baseline = snapshot(id);
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
        assertNoReturnWorkflowResidue(id, baseline);
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
    void concurrentResubmitHasOneCompleteSurvivorAndAssertedLoser() throws Exception {
        UUID id = atProgrammeReview("WP02C-CONC-SUB-" + TAG);
        wiredReturn(id, "programme_review", PROGRAMME_USER, "programme", UUID.randomUUID().toString(), REASON);
        CompleteBundleSnapshot afterReturn = snapshot(id);
        UUID returnId = latestReturnId(id);
        Instant returnAt = owner.queryForObject("SELECT returned_at FROM registration_application_return WHERE id = ?", Instant.class, returnId);
        int version = afterReturn.appVersion();
        ExecutorService pool = Executors.newFixedThreadPool(2);
        CountDownLatch start = new CountDownLatch(1);
        AtomicReference<Throwable> loser = new AtomicReference<>();
        Runnable attempt = () -> {
            try {
                start.await(5, TimeUnit.SECONDS);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new IllegalStateException(e);
            }
            tx.executeWithoutResult(s -> {
                var leg = legacyResubmit(id, version, returnId, "programme_review", returnAt, REASON, NOVA_USER, "manufacturer");
                completeResubmit(id, returnId, UUID.randomUUID(), leg.transitionEventId(), "programme_review", returnAt, REASON, null, leg.returnedAt(),
                    UUID.randomUUID().toString());
            });
        };
        Future<?> f1 = pool.submit(attempt);
        Future<?> f2 = pool.submit(attempt);
        start.countDown();
        int winners = 0;
        for (Future<?> f : List.of(f1, f2)) {
            try {
                f.get(30, TimeUnit.SECONDS);
                winners++;
            } catch (ExecutionException ex) {
                loser.compareAndSet(null, ex.getCause());
            }
        }
        pool.shutdown();
        assertEquals(1, winners);
        assertNotNull(loser.get());
        assertInstanceOf(IllegalStateException.class, loser.get());
        assertTrue(loser.get().getMessage().contains("registration resubmit transition stale"), loser.get().getMessage());
        UUID refId = atProgrammeReview("WP02C-DELTA-SUB-" + TAG);
        wiredReturn(refId, "programme_review", PROGRAMME_USER, "programme", UUID.randomUUID().toString(), REASON);
        CompleteBundleSnapshot refAfterReturn = snapshot(refId);
        wiredResubmit(refId, latestReturnId(refId), "programme_review",
            owner.queryForObject("SELECT returned_at FROM registration_application_return WHERE application_id = ?", Instant.class, refId),
            REASON, UUID.randomUUID().toString(), null);
        CompleteBundleSnapshot expected = expectedAfterReference(afterReturn, refAfterReturn, snapshot(refId));
        assertSnapshot(id, expected);
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
    void runtimeCannotInsertUpdateOrDeleteAnyRegistrationWorkflowHistory() {
        UUID id = atProgrammeReview("WP02C-TAMPER-" + TAG);
        wiredReturn(id, "programme_review", PROGRAMME_USER, "programme", UUID.randomUUID().toString(), REASON);
        UUID returnId = latestReturnId(id);
        UUID cycleId = owner.queryForObject("SELECT id FROM registration_return_response_cycle WHERE application_id = ?", UUID.class, id);
        wiredResubmit(id, returnId, "programme_review",
            owner.queryForObject("SELECT returned_at FROM registration_application_return WHERE id = ?", Instant.class, returnId),
            REASON, UUID.randomUUID().toString(), null);
        UUID resubId = owner.queryForObject("SELECT id FROM registration_application_resubmission WHERE application_id = ? ORDER BY resubmitted_at DESC LIMIT 1", UUID.class, id);
        UUID evidenceId = owner.queryForObject("SELECT command_id FROM registration_return_response_wiring_evidence WHERE application_id = ? LIMIT 1", UUID.class, id);
        assertThrows(DataAccessException.class, () -> db.update("INSERT INTO registration_application_return (id, application_id, transition_event_id, returned_from_state, "
            + "reason, returned_by_account_id, returned_at, foundation_notify_command_id) SELECT gen_random_uuid(), application_id, transition_event_id, returned_from_state, "
            + "reason, returned_by_account_id, returned_at, foundation_notify_command_id FROM registration_application_return WHERE id = ?", returnId));
        assertThrows(DataAccessException.class, () -> db.update("UPDATE registration_application_return SET reason = reason WHERE id = ?", returnId));
        assertThrows(DataAccessException.class, () -> db.update("DELETE FROM registration_application_return WHERE id = ?", returnId));
        assertThrows(DataAccessException.class, () -> db.update("INSERT INTO registration_application_resubmission (id, application_id, return_id, transition_event_id, resumed_state, resubmitted_by_account_id, resubmitted_at) "
            + "VALUES (gen_random_uuid(), ?, ?, gen_random_uuid(), 'programme_review', ?, now())", id, returnId, NOVA_USER));
        assertThrows(DataAccessException.class, () -> db.update("UPDATE registration_application_resubmission SET resumed_state = resumed_state WHERE id = ?", resubId));
        assertThrows(DataAccessException.class, () -> db.update("DELETE FROM registration_application_resubmission WHERE id = ?", resubId));
        assertThrows(DataAccessException.class, () -> db.update("INSERT INTO registration_return_response_cycle (id, application_id, cycle_seq, status, review_stage, task_id, discrepancy_id) "
            + "SELECT gen_random_uuid(), application_id, 99, 'open', review_stage, task_id, discrepancy_id FROM registration_return_response_cycle WHERE id = ?", cycleId));
        assertThrows(DataAccessException.class, () -> db.update("UPDATE registration_return_response_cycle SET task_id = gen_random_uuid() WHERE id = ?", cycleId));
        assertThrows(DataAccessException.class, () -> db.update("DELETE FROM registration_return_response_cycle WHERE id = ?", cycleId));
        assertThrows(DataAccessException.class, () -> db.queryForObject("SELECT return_id FROM registration_return_response_cycle_return WHERE cycle_id = ? LIMIT 1", UUID.class, cycleId));
        assertThrows(DataAccessException.class, () -> db.update("INSERT INTO registration_return_response_cycle_return (cycle_id, return_id) VALUES (?, gen_random_uuid())", cycleId));
        assertThrows(DataAccessException.class, () -> db.update("UPDATE registration_return_response_cycle_return SET return_id = return_id WHERE cycle_id = ?", cycleId));
        assertThrows(DataAccessException.class, () -> db.update("DELETE FROM registration_return_response_cycle_return WHERE cycle_id = ?", cycleId));
        assertThrows(DataAccessException.class, () -> db.update("INSERT INTO registration_return_response_wiring_evidence (command_id, application_id, purpose, payload_hash) "
            + "VALUES (gen_random_uuid(), ?, 'registration_return_wiring', repeat('b', 64))", id));
        assertThrows(DataAccessException.class, () -> db.update("UPDATE registration_return_response_wiring_evidence SET payload_hash = repeat('a', 64) WHERE command_id = ?", evidenceId));
        assertThrows(DataAccessException.class, () -> db.update("DELETE FROM registration_return_response_wiring_evidence WHERE command_id = ?", evidenceId));
    }

    @Test
    void registrationReturnResponseExecutePrivilegeInventory() {
        var runtimeAllowed = owner.queryForList(
            "SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace "
                + "WHERE n.nspname = ? AND p.proname LIKE 'registration_return_response_%' AND p.prosecdef "
                + "AND has_function_privilege(?, p.oid, 'EXECUTE') ORDER BY 1",
            String.class, MAIN, runtimeRole());
        assertEquals(
            List.of(
                "registration_return_response_latest_open_cycle_return",
                "registration_return_response_orchestrate_resubmit",
                "registration_return_response_orchestrate_wired_return"),
            runtimeAllowed);
        var publicHelpers = owner.queryForList(
            "SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace "
                + "WHERE n.nspname = ? AND p.proname LIKE 'registration_return_response_%' AND p.prosecdef "
                + "AND has_function_privilege('public', p.oid, 'EXECUTE') ORDER BY 1",
            String.class, MAIN);
        assertTrue(publicHelpers.isEmpty(), publicHelpers.toString());
        var flywayOwned = owner.queryForList(
            "SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace "
                + "WHERE n.nspname = ? AND p.proname LIKE 'registration_return_response_%' AND p.prosecdef "
                + "AND pg_get_userbyid(p.proowner) = 'bee_app' AND p.proname NOT LIKE '%orchestrate%'",
            String.class, MAIN);
        assertFalse(flywayOwned.isEmpty());
        JdbcTemplate runtimeDb = new JdbcTemplate(sourceAs(MAIN, runtimeRole(), env("BEE_RUNTIME_DB_PASSWORD", "bee-local-runtime")));
        assertThrows(DataAccessException.class, () -> runtimeDb.queryForObject(
            "SELECT registration_return_response_append_response(gen_random_uuid(), 'x', ?)", String.class, PROGRAMME_USER));
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
        maint.query("SELECT " + MAIN + ".app_disposable_registration_cleanup(ARRAY[?]::uuid[])", rs -> {
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
    void returnReplayWithOldHashAndChangedMaterialInputConflicts() {
        UUID id = atProgrammeReview("WP02C-OLD-HASH-RET-" + TAG);
        String idem = UUID.randomUUID().toString();
        UUID wiringCommand = commandId(idem, "registration_return_wiring", id);
        LegacyReturn leg = tx.execute(s -> {
            int version = db.queryForObject("SELECT version FROM registration_application WHERE id = ?", Integer.class, id);
            var first = legacyReturn(id, version, "programme_review", PROGRAMME_USER, "programme", REASON);
            completeWiredReturn(id, first.returnId(), first.transitionEventId(), "programme_review", REASON, first.returnedAt(), PROGRAMME_USER, "programme", idem);
            return first;
        });
        String storedHash = owner.queryForObject("SELECT payload_hash FROM registration_return_response_wiring_evidence WHERE command_id = ?", String.class, wiringCommand);
        var policy = policyRepo.requireApplicableVersion(leg.returnedAt());
        Instant dueAt = policyRepo.dueAtEndOfWorkingDays(leg.returnedAt(), policy);
        String suffix = "was returned to you: Changed reason. Respond by " + DUE_LABEL.format(dueAt) + ". Edit it and send it again.";
        assertThrows(WorkflowIdempotencyConflictException.class, () -> tx.executeWithoutResult(s -> wiringRepo.orchestrateWiredReturn(
            new RegistrationReturnResponseWiringRepository.OrchestrateWiredReturnCommand(
                leg.returnId(), id, leg.transitionEventId(), "programme_review", "Changed reason.", PROGRAMME_USER, leg.returnedAt(), "programme",
                commandId(idem, "registration_return_notify", id),
                NotificationCommandRepository.payloadHash(new NotificationCommandRepository.DeliverCommand(
                    WorkflowFoundationRepository.SUBJECT_REGISTRATION, id, "returned", suffix)),
                suffix, commandId(idem, "registration_return_task", id),
                WorkflowFoundationRepository.payloadHash(new WorkflowFoundationRepository.TaskCommand(
                    WorkflowFoundationRepository.SUBJECT_REGISTRATION, id, "programme_review", "review", "programme", PROGRAMME_USER, dueAt, policy.id(), leg.returnedAt())),
                "programme", PROGRAMME_USER, dueAt, policy.id(), wiringCommand, storedHash, PROGRAMME_USER))));
        assertEquals(REASON, owner.queryForObject("SELECT reason FROM registration_application_return WHERE id = ?", String.class, leg.returnId()));
        assertEquals(1, owner.queryForObject("SELECT count(*) FROM registration_return_response_wiring_evidence WHERE command_id = ?", Integer.class, wiringCommand));
    }

    @Test
    void returnReplayWithOldHashAndSubMillisecondTimestampConflicts() {
        UUID id = atProgrammeReview("WP02C-SUBMS-RET-" + TAG);
        String idem = UUID.randomUUID().toString();
        UUID wiringCommand = commandId(idem, "registration_return_wiring", id);
        LegacyReturn leg = tx.execute(s -> {
            int version = db.queryForObject("SELECT version FROM registration_application WHERE id = ?", Integer.class, id);
            var first = legacyReturn(id, version, "programme_review", PROGRAMME_USER, "programme", REASON);
            completeWiredReturn(id, first.returnId(), first.transitionEventId(), "programme_review", REASON, first.returnedAt(), PROGRAMME_USER, "programme", idem);
            return first;
        });
        String storedHash = owner.queryForObject("SELECT payload_hash FROM registration_return_response_wiring_evidence WHERE command_id = ?", String.class, wiringCommand);
        Instant tamperedReturnedAt = Instant.ofEpochMilli(leg.returnedAt().toEpochMilli()).plusNanos(500_000);
        assertTrue(tamperedReturnedAt.toEpochMilli() == leg.returnedAt().toEpochMilli());
        assertFalse(tamperedReturnedAt.equals(leg.returnedAt()));
        var policy = policyRepo.requireApplicableVersion(leg.returnedAt());
        Instant dueAt = policyRepo.dueAtEndOfWorkingDays(leg.returnedAt(), policy);
        String suffix = "was returned to you: " + REASON + " Respond by " + DUE_LABEL.format(dueAt) + ". Edit it and send it again.";
        assertThrows(WorkflowIdempotencyConflictException.class, () -> tx.executeWithoutResult(s -> wiringRepo.orchestrateWiredReturn(
            new RegistrationReturnResponseWiringRepository.OrchestrateWiredReturnCommand(
                leg.returnId(), id, leg.transitionEventId(), "programme_review", REASON, PROGRAMME_USER, tamperedReturnedAt, "programme",
                commandId(idem, "registration_return_notify", id),
                NotificationCommandRepository.payloadHash(new NotificationCommandRepository.DeliverCommand(
                    WorkflowFoundationRepository.SUBJECT_REGISTRATION, id, "returned", suffix)),
                suffix, commandId(idem, "registration_return_task", id),
                WorkflowFoundationRepository.payloadHash(new WorkflowFoundationRepository.TaskCommand(
                    WorkflowFoundationRepository.SUBJECT_REGISTRATION, id, "programme_review", "review", "programme", PROGRAMME_USER, dueAt, policy.id(), tamperedReturnedAt)),
                "programme", PROGRAMME_USER, dueAt, policy.id(), wiringCommand, storedHash, PROGRAMME_USER))));
    }

    @Test
    void resubmitReplayWithOldHashAndChangedMaterialInputConflicts() {
        UUID id = atProgrammeReview("WP02C-OLD-HASH-SUB-" + TAG);
        wiredReturn(id, "programme_review", PROGRAMME_USER, "programme", UUID.randomUUID().toString(), REASON);
        UUID returnId = latestReturnId(id);
        Instant returnAt = owner.queryForObject("SELECT returned_at FROM registration_application_return WHERE id = ?", Instant.class, returnId);
        String idem = UUID.randomUUID().toString();
        UUID wiringCommand = commandId(idem, "registration_resubmit_wiring", id);
        UUID resubmissionId = UUID.randomUUID();
        LegacyReturn leg = tx.execute(s -> {
            int version = db.queryForObject("SELECT version FROM registration_application WHERE id = ?", Integer.class, id);
            var first = legacyResubmit(id, version, returnId, "programme_review", returnAt, REASON, NOVA_USER, "manufacturer");
            completeResubmit(id, returnId, resubmissionId, first.transitionEventId(), "programme_review", returnAt, REASON, null, first.returnedAt(), idem);
            return first;
        });
        String storedHash = owner.queryForObject("SELECT payload_hash FROM registration_return_response_wiring_evidence WHERE command_id = ?", String.class, wiringCommand);
        var policy = policyRepo.requireApplicableVersion(returnAt);
        Instant dueAt = policyRepo.dueAtEndOfWorkingDays(returnAt, policy);
        UUID taskOwner = owner.queryForObject("SELECT returned_by_account_id FROM registration_application_return WHERE id = ?", UUID.class, returnId);
        String taskOwnerRole = "programme";
        var taskCmd = new WorkflowFoundationRepository.TaskCommand(WorkflowFoundationRepository.SUBJECT_REGISTRATION, id, "programme_review", "review",
            taskOwnerRole, taskOwner, dueAt, policy.id(), returnAt);
        assertThrows(WorkflowIdempotencyConflictException.class, () -> tx.executeWithoutResult(s -> wiringRepo.orchestrateResubmit(
            new RegistrationReturnResponseWiringRepository.OrchestrateResubmitCommand(
                id, returnId, UUID.randomUUID(), leg.transitionEventId(), "programme_review", returnAt, REASON, "programme_review", "Tampered body.", leg.returnedAt(),
                NOVA_USER, "manufacturer", wiringCommand, storedHash, commandId(idem, "registration_resubmit_notify", id),
                commandId(idem, "registration_resubmit_task", id), WorkflowFoundationRepository.payloadHash(taskCmd), taskOwnerRole, taskOwner, dueAt, policy.id(), NOVA_USER))));
        UUID discrepancyId = wiringRepo.findOpenCycle(id).orElseThrow().discrepancyId();
        assertEquals(NEUTRAL, owner.queryForObject(
            "SELECT body FROM workflow_discrepancy_response WHERE discrepancy_id = ? ORDER BY response_seq DESC LIMIT 1", String.class, discrepancyId));
        assertEquals(1, owner.queryForObject("SELECT count(*) FROM registration_return_response_wiring_evidence WHERE command_id = ?", Integer.class, wiringCommand));
    }

    @Test
    void resubmitReplayWithOldHashAndSubMillisecondTimestampConflicts() {
        UUID id = atProgrammeReview("WP02C-SUBMS-SUB-" + TAG);
        wiredReturn(id, "programme_review", PROGRAMME_USER, "programme", UUID.randomUUID().toString(), REASON);
        UUID returnId = latestReturnId(id);
        Instant returnAt = owner.queryForObject("SELECT returned_at FROM registration_application_return WHERE id = ?", Instant.class, returnId);
        String idem = UUID.randomUUID().toString();
        UUID wiringCommand = commandId(idem, "registration_resubmit_wiring", id);
        UUID resubmissionId = UUID.randomUUID();
        LegacyReturn leg = tx.execute(s -> {
            int version = db.queryForObject("SELECT version FROM registration_application WHERE id = ?", Integer.class, id);
            var first = legacyResubmit(id, version, returnId, "programme_review", returnAt, REASON, NOVA_USER, "manufacturer");
            completeResubmit(id, returnId, resubmissionId, first.transitionEventId(), "programme_review", returnAt, REASON, null, first.returnedAt(), idem);
            return first;
        });
        String storedHash = owner.queryForObject("SELECT payload_hash FROM registration_return_response_wiring_evidence WHERE command_id = ?", String.class, wiringCommand);
        Instant tamperedResubmittedAt = Instant.ofEpochMilli(leg.returnedAt().toEpochMilli()).plusNanos(500_000);
        assertTrue(tamperedResubmittedAt.toEpochMilli() == leg.returnedAt().toEpochMilli());
        assertFalse(tamperedResubmittedAt.equals(leg.returnedAt()));
        var policy = policyRepo.requireApplicableVersion(returnAt);
        Instant dueAt = policyRepo.dueAtEndOfWorkingDays(returnAt, policy);
        UUID taskOwner = owner.queryForObject("SELECT returned_by_account_id FROM registration_application_return WHERE id = ?", UUID.class, returnId);
        var taskCmd = new WorkflowFoundationRepository.TaskCommand(WorkflowFoundationRepository.SUBJECT_REGISTRATION, id, "programme_review", "review",
            "programme", taskOwner, dueAt, policy.id(), returnAt);
        assertThrows(WorkflowIdempotencyConflictException.class, () -> tx.executeWithoutResult(s -> wiringRepo.orchestrateResubmit(
            new RegistrationReturnResponseWiringRepository.OrchestrateResubmitCommand(
                id, returnId, resubmissionId, leg.transitionEventId(), "programme_review", returnAt, REASON, "programme_review", NEUTRAL, tamperedResubmittedAt,
                NOVA_USER, "manufacturer", wiringCommand, storedHash, commandId(idem, "registration_resubmit_notify", id),
                commandId(idem, "registration_resubmit_task", id), WorkflowFoundationRepository.payloadHash(taskCmd), "programme", taskOwner, dueAt, policy.id(), NOVA_USER))));
    }

    @Test
    void notYetValidRoleRollBackCompleteBundle() {
        UUID id = atProgrammeReview("WP02C-ROLE-FUTURE-" + TAG);
        CompleteBundleSnapshot baseline = snapshot(id);
        UUID futureOfficer = UUID.randomUUID();
        owner.update("INSERT INTO user_account (id, keycloak_subject, username, display_name, status) VALUES (?, ?, ?, ?, 'active')",
            futureOfficer, UUID.randomUUID(), "wp02c-future-" + TAG, "WP02C future role");
        owner.update("INSERT INTO role_assignment (user_id, role, scope, active, valid_from, valid_to) VALUES (?, 'programme', 'all', true, now() + interval '7 days', 'infinity')",
            futureOfficer);
        assertThrows(DataAccessException.class, () -> tx.executeWithoutResult(s -> {
            int version = db.queryForObject("SELECT version FROM registration_application WHERE id = ?", Integer.class, id);
            var leg = legacyReturn(id, version, "programme_review", futureOfficer, "programme", REASON);
            completeWiredReturn(id, leg.returnId(), leg.transitionEventId(), "programme_review", REASON, leg.returnedAt(), futureOfficer, "programme",
                UUID.randomUUID().toString());
        }));
        assertNoReturnWorkflowResidue(id, baseline);
    }

    @Test
    void expiredRoleRollBackCompleteBundle() {
        UUID id = atProgrammeReview("WP02C-ROLE-EXP-" + TAG);
        CompleteBundleSnapshot baseline = snapshot(id);
        UUID expiredOfficer = UUID.randomUUID();
        owner.update("INSERT INTO user_account (id, keycloak_subject, username, display_name, status) VALUES (?, ?, ?, ?, 'active')",
            expiredOfficer, UUID.randomUUID(), "wp02c-expired-" + TAG, "WP02C expired role");
        owner.update("INSERT INTO role_assignment (user_id, role, scope, active, valid_from, valid_to) VALUES (?, 'programme', 'all', true, '-infinity', now() - interval '1 day')",
            expiredOfficer);
        assertThrows(DataAccessException.class, () -> tx.executeWithoutResult(s -> {
            int version = db.queryForObject("SELECT version FROM registration_application WHERE id = ?", Integer.class, id);
            var leg = legacyReturn(id, version, "programme_review", expiredOfficer, "programme", REASON);
            completeWiredReturn(id, leg.returnId(), leg.transitionEventId(), "programme_review", REASON, leg.returnedAt(), expiredOfficer, "programme",
                UUID.randomUUID().toString());
        }));
        assertNoReturnWorkflowResidue(id, baseline);
    }

    @Test
    void wrongRoleRollBackCompleteBundle() {
        UUID id = atProgrammeReview("WP02C-WRONG-ROLE-" + TAG);
        CompleteBundleSnapshot baseline = snapshot(id);
        var failure = assertThrows(DataAccessException.class, () -> tx.executeWithoutResult(s -> {
            int version = db.queryForObject("SELECT version FROM registration_application WHERE id = ?", Integer.class, id);
            var leg = legacyReturn(id, version, "programme_review", PROGRAMME_USER, "programme", REASON);
            completeWiredReturn(id, leg.returnId(), leg.transitionEventId(), "programme_review", REASON, leg.returnedAt(), PROGRAMME_USER, "director",
                UUID.randomUUID().toString());
        }));
        assertSqlMessage(failure, "registration_return_response_stage_role_mismatch");
        assertNoReturnWorkflowResidue(id, baseline);
    }

    @Test
    void wrongActorRollBackCompleteBundle() {
        UUID id = atProgrammeReview("WP02C-WRONG-ACTOR-" + TAG);
        CompleteBundleSnapshot baseline = snapshot(id);
        var failure = assertThrows(DataAccessException.class, () -> tx.executeWithoutResult(s -> {
            int version = db.queryForObject("SELECT version FROM registration_application WHERE id = ?", Integer.class, id);
            var leg = legacyReturn(id, version, "programme_review", PROGRAMME_USER, "programme", REASON);
            var policy = policyRepo.requireApplicableVersion(leg.returnedAt());
            Instant dueAt = policyRepo.dueAtEndOfWorkingDays(leg.returnedAt(), policy);
            String idem = UUID.randomUUID().toString();
            String suffix = "was returned to you: " + REASON + " Respond by " + DUE_LABEL.format(dueAt) + ". Edit it and send it again.";
            UUID notifyCommand = commandId(idem, "registration_return_notify", id);
            String notifyHash = NotificationCommandRepository.payloadHash(
                new NotificationCommandRepository.DeliverCommand(WorkflowFoundationRepository.SUBJECT_REGISTRATION, id, "returned", suffix));
            UUID taskCommand = commandId(idem, "registration_return_task", id);
            var taskCmd = new WorkflowFoundationRepository.TaskCommand(WorkflowFoundationRepository.SUBJECT_REGISTRATION, id, "programme_review", "review",
                "programme", PROGRAMME_USER, dueAt, policy.id(), leg.returnedAt());
            String taskPayloadHash = WorkflowFoundationRepository.payloadHash(taskCmd);
            UUID wiringCommand = commandId(idem, "registration_return_wiring", id);
            String wiringHash = wiringReturnHash(id, leg.transitionEventId(), leg.returnId(), "programme_review", REASON, PROGRAMME_USER, leg.returnedAt(), "programme",
                notifyCommand, notifyHash, suffix, taskCommand, taskPayloadHash, "programme", PROGRAMME_USER, dueAt, policy.id(), DIRECTOR_USER);
            wiringRepo.orchestrateWiredReturn(new RegistrationReturnResponseWiringRepository.OrchestrateWiredReturnCommand(
                leg.returnId(), id, leg.transitionEventId(), "programme_review", REASON, PROGRAMME_USER, leg.returnedAt(), "programme",
                notifyCommand, notifyHash, suffix, taskCommand, taskPayloadHash, "programme", PROGRAMME_USER, dueAt, policy.id(), wiringCommand, wiringHash, DIRECTOR_USER));
        }));
        assertSqlMessage(failure, "registration_return_response_actor_mismatch");
        assertNoReturnWorkflowResidue(id, baseline);
    }

    @Test
    void inactiveOfficerRollBackCompleteBundle() {
        UUID id = atProgrammeReview("WP02C-INACT-OFF-" + TAG);
        CompleteBundleSnapshot baseline = snapshot(id);
        UUID inactive = UUID.randomUUID();
        owner.update("INSERT INTO user_account (id, keycloak_subject, username, display_name, status) VALUES (?, ?, ?, ?, 'disabled')",
            inactive, UUID.randomUUID(), "wp02c-off-inact-" + TAG, "WP02C inactive officer");
        owner.update("INSERT INTO role_assignment (user_id, role, scope, active, valid_from, valid_to) VALUES (?, 'programme', 'all', true, '-infinity', 'infinity')", inactive);
        var failure = assertThrows(DataAccessException.class, () -> tx.executeWithoutResult(s -> {
            int version = db.queryForObject("SELECT version FROM registration_application WHERE id = ?", Integer.class, id);
            var leg = legacyReturn(id, version, "programme_review", inactive, "programme", REASON);
            completeWiredReturn(id, leg.returnId(), leg.transitionEventId(), "programme_review", REASON, leg.returnedAt(), inactive, "programme",
                UUID.randomUUID().toString());
        }));
        assertSqlMessage(failure, "registration_return_response_stage_role_mismatch");
        assertNoReturnWorkflowResidue(id, baseline);
    }

    @Test
    void resubmitOfficerRoleValidityUsesPersistedResubmitTransitionTime() {
        UUID id = atProgrammeReview("WP02C-RESUB-ROLE-" + TAG);
        UUID returningOfficer = UUID.randomUUID();
        owner.update("INSERT INTO user_account (id, keycloak_subject, username, display_name, status) VALUES (?, ?, ?, ?, 'active')",
            returningOfficer, UUID.randomUUID(), "wp02c-return-off-" + TAG, "WP02C return officer");
        owner.update("INSERT INTO role_assignment (user_id, role, scope, active, valid_from, valid_to) VALUES (?, 'programme', 'all', true, '-infinity', 'infinity')",
            returningOfficer);
        wiredReturn(id, "programme_review", returningOfficer, "programme", UUID.randomUUID().toString(), REASON);
        CompleteBundleSnapshot afterReturn = snapshot(id);
        UUID returnId = latestReturnId(id);
        Instant returnedAt = owner.queryForObject("SELECT returned_at FROM registration_application_return WHERE id = ?", Instant.class, returnId);
        owner.query("SELECT registration_return_response_resolve_officer(?, ?)", rs -> {
        }, id, returnId);
        owner.update("UPDATE role_assignment SET valid_to = ? WHERE user_id = ? AND role = 'programme'",
            java.sql.Timestamp.from(returnedAt.plusNanos(1_000)), returningOfficer);
        var failure = assertThrows(DataAccessException.class, () -> tx.executeWithoutResult(s -> {
            int version = db.queryForObject("SELECT version FROM registration_application WHERE id = ?", Integer.class, id);
            var leg = legacyResubmit(id, version, returnId, "programme_review", returnedAt, REASON, NOVA_USER, "manufacturer");
            completeResubmit(id, returnId, UUID.randomUUID(), leg.transitionEventId(), "programme_review", returnedAt, REASON, null, leg.returnedAt(),
                UUID.randomUUID().toString());
        }));
        assertSqlMessage(failure, "notification_recipient_inactive");
        assertSnapshot(id, afterReturn);
        owner.update("UPDATE role_assignment SET valid_to = 'infinity' WHERE user_id = ? AND role = 'programme'", returningOfficer);
    }

    @Test
    void wrongDueTimeIsRejectedWithNoPartialBundle() {
        UUID id = atProgrammeReview("WP02C-DUE-REJ-" + TAG);
        CompleteBundleSnapshot baseline = snapshot(id);
        assertThrows(DataAccessException.class, () -> tx.executeWithoutResult(s -> {
            int version = db.queryForObject("SELECT version FROM registration_application WHERE id = ?", Integer.class, id);
            var leg = legacyReturn(id, version, "programme_review", PROGRAMME_USER, "programme", REASON);
            var policy = policyRepo.requireApplicableVersion(leg.returnedAt());
            Instant wrongDue = policyRepo.dueAtEndOfWorkingDays(leg.returnedAt(), policy).plusSeconds(3600);
            Instant dueAt = policyRepo.dueAtEndOfWorkingDays(leg.returnedAt(), policy);
            String suffix = "was returned to you: " + REASON + " Respond by " + DUE_LABEL.format(dueAt) + ". Edit it and send it again.";
            UUID notifyCommand = commandId(UUID.randomUUID().toString(), "registration_return_notify", id);
            UUID taskCommand = commandId(UUID.randomUUID().toString(), "registration_return_task", id);
            UUID wiringCommand = commandId(UUID.randomUUID().toString(), "registration_return_wiring", id);
            var taskCmd = new WorkflowFoundationRepository.TaskCommand(WorkflowFoundationRepository.SUBJECT_REGISTRATION, id, "programme_review", "review",
                "programme", PROGRAMME_USER, dueAt, policy.id(), leg.returnedAt());
            String notifyHash = NotificationCommandRepository.payloadHash(new NotificationCommandRepository.DeliverCommand(
                WorkflowFoundationRepository.SUBJECT_REGISTRATION, id, "returned", suffix));
            String taskPayloadHash = WorkflowFoundationRepository.payloadHash(taskCmd);
            String wiringHash = wiringReturnHash(id, leg.transitionEventId(), leg.returnId(), "programme_review", REASON, PROGRAMME_USER, leg.returnedAt(), "programme",
                notifyCommand, notifyHash, suffix, taskCommand, taskPayloadHash, "programme", PROGRAMME_USER, wrongDue, policy.id(), PROGRAMME_USER);
            wiringRepo.orchestrateWiredReturn(new RegistrationReturnResponseWiringRepository.OrchestrateWiredReturnCommand(
                leg.returnId(), id, leg.transitionEventId(), "programme_review", REASON, PROGRAMME_USER, leg.returnedAt(), "programme",
                notifyCommand, notifyHash, suffix, taskCommand, taskPayloadHash, "programme", PROGRAMME_USER, wrongDue, policy.id(), wiringCommand, wiringHash,
                PROGRAMME_USER));
        }));
        assertNoReturnWorkflowResidue(id, baseline);
    }

    @Test
    void wrongTaskOwnerIsRejectedAtomically() {
        UUID id = atProgrammeReview("WP02C-OWNER-REJ-" + TAG);
        CompleteBundleSnapshot baseline = snapshot(id);
        assertThrows(DataAccessException.class, () -> tx.executeWithoutResult(s -> {
            int version = db.queryForObject("SELECT version FROM registration_application WHERE id = ?", Integer.class, id);
            var leg = legacyReturn(id, version, "programme_review", PROGRAMME_USER, "programme", REASON);
            var policy = policyRepo.requireApplicableVersion(leg.returnedAt());
            Instant dueAt = policyRepo.dueAtEndOfWorkingDays(leg.returnedAt(), policy);
            String suffix = "was returned to you: " + REASON + " Respond by " + DUE_LABEL.format(dueAt) + ". Edit it and send it again.";
            var taskCmd = new WorkflowFoundationRepository.TaskCommand(WorkflowFoundationRepository.SUBJECT_REGISTRATION, id, "programme_review", "review",
                "programme", PROGRAMME_USER, dueAt, policy.id(), leg.returnedAt());
            UUID notifyCommand = commandId(UUID.randomUUID().toString(), "registration_return_notify", id);
            UUID taskCommand = commandId(UUID.randomUUID().toString(), "registration_return_task", id);
            UUID wiringCommand = commandId(UUID.randomUUID().toString(), "registration_return_wiring", id);
            String notifyHash = NotificationCommandRepository.payloadHash(new NotificationCommandRepository.DeliverCommand(
                WorkflowFoundationRepository.SUBJECT_REGISTRATION, id, "returned", suffix));
            String taskPayloadHash = WorkflowFoundationRepository.payloadHash(taskCmd);
            String wiringHash = wiringReturnHash(id, leg.transitionEventId(), leg.returnId(), "programme_review", REASON, PROGRAMME_USER, leg.returnedAt(), "programme",
                notifyCommand, notifyHash, suffix, taskCommand, taskPayloadHash, "programme", DIRECTOR_USER, dueAt, policy.id(), PROGRAMME_USER);
            wiringRepo.orchestrateWiredReturn(new RegistrationReturnResponseWiringRepository.OrchestrateWiredReturnCommand(
                leg.returnId(), id, leg.transitionEventId(), "programme_review", REASON, PROGRAMME_USER, leg.returnedAt(), "programme",
                notifyCommand, notifyHash, suffix, taskCommand, taskPayloadHash, "programme", DIRECTOR_USER, dueAt, policy.id(), wiringCommand, wiringHash,
                PROGRAMME_USER));
        }));
        assertNoReturnWorkflowResidue(id, baseline);
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
                + "AND p.proname NOT IN ('registration_return_response_orchestrate_wired_return', 'registration_return_response_orchestrate_resubmit', "
                + "'registration_return_response_latest_open_cycle_return') "
                + "AND has_function_privilege(?, p.oid, 'EXECUTE') ORDER BY 1",
            String.class, MAIN, runtimeRole());
        assertTrue(internal.isEmpty(), internal.toString());
    }
}
