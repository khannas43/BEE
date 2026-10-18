package gov.bee.api.snl;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import gov.bee.api.application.ModelApplicationRepository;
import gov.bee.api.application.ModelApplicationSubmitRepository;
import gov.bee.api.director.DirectorRecommendationRepository;
import gov.bee.api.finance.FeeConfirmationRepository;
import gov.bee.api.iame.IameRecommendationRepository;
import gov.bee.api.notifications.NotificationCommandRepository;
import gov.bee.api.rating.RatingRepository;
import gov.bee.api.reviewer.ReviewerForwardRepository;
import gov.bee.api.rework.ResubmitApplicationRepository;
import gov.bee.api.rework.StageReturnRepository;
import gov.bee.api.workflow.SnlReturnResponsePolicyRepository;
import gov.bee.api.workflow.WorkflowFoundationRepository;
import gov.bee.api.workflow.WorkflowIdempotencyConflictException;
import java.math.BigDecimal;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDate;
import java.util.HexFormat;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ThreadLocalRandom;
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
import org.springframework.transaction.support.TransactionTemplate;

@Tag("db")
class SnlWp02bModelReturnWiringDatabaseTest {

    static final String TAG = HexFormat.of().toHexDigits(ThreadLocalRandom.current().nextInt());
    static final String MAIN = "wp02b2_test_" + TAG;
    static final UUID NOVA = UUID.fromString("00000000-0000-4000-b000-000000000001");
    static final UUID NOVA_USER = UUID.fromString("00000000-0000-4000-a000-000000000001");
    static final UUID FINANCE_USER = UUID.fromString("00000000-0000-4000-a000-000000000003");
    static final UUID IAME_USER = UUID.fromString("00000000-0000-4000-a000-000000000004");
    static final UUID REVIEWER_USER = UUID.fromString("00000000-0000-4000-a000-000000000005");
    static final UUID PROGRAMME_USER = UUID.fromString("00000000-0000-4000-a000-000000000006");
    static final UUID DIRECTOR_USER = UUID.fromString("00000000-0000-4000-a000-000000000007");
    static final UUID NOVA_COOL = UUID.fromString("00000000-0000-4000-d000-000000000001");
    static final String REASON = "WP02B wiring proof.";

    static JdbcTemplate admin;
    static JdbcTemplate owner;
    static JdbcTemplate db;
    static DriverManagerDataSource runtime;
    static TransactionTemplate tx;
    static ModelApplicationRepository applications;
    static ModelApplicationSubmitRepository submissions;
    static FeeConfirmationRepository feeRepo;
    static IameRecommendationRepository iameRepo;
    static ReviewerForwardRepository reviewerRepo;
    static RatingRepository ratingRepo;
    static DirectorRecommendationRepository directorRepo;
    static StageReturnRepository returns;
    static ResubmitApplicationRepository resub;
    static WorkflowReturnResponseWiring wiring;

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
        admin.execute("DROP SCHEMA IF EXISTS " + MAIN + " CASCADE");
        admin.execute("CREATE SCHEMA " + MAIN);
        Flyway.configure().dataSource(migrateSource(MAIN)).schemas(MAIN).defaultSchema(MAIN).createSchemas(false)
            .locations("classpath:db/migration").load().migrate();
        owner = new JdbcTemplate(migrateSource(MAIN));
        owner.execute(Files.readString(Path.of("..", "local", "seed", "seed.sql")));
        runtime = sourceAs(MAIN, env("BEE_RUNTIME_DB_USER", "bee_runtime"), env("BEE_RUNTIME_DB_PASSWORD", "bee-local-runtime"));
        db = new JdbcTemplate(runtime);
        tx = new TransactionTemplate(new DataSourceTransactionManager(runtime));
        applications = new ModelApplicationRepository(db);
        submissions = new ModelApplicationSubmitRepository(db, applications);
        feeRepo = transactional(new FeeConfirmationRepository(db));
        iameRepo = transactional(new IameRecommendationRepository(db));
        reviewerRepo = transactional(new ReviewerForwardRepository(db));
        ratingRepo = transactional(new RatingRepository(db));
        directorRepo = transactional(new DirectorRecommendationRepository(db));
        returns = transactional(new StageReturnRepository(db));
        resub = transactional(new ResubmitApplicationRepository(db));
        var foundation = new WorkflowFoundationRepository(db);
        wiring = new WorkflowReturnResponseWiring(new ModelReturnResponseWiringRepository(db), foundation, new SnlReturnResponsePolicyRepository(db),
            new NotificationCommandRepository(db));
        assertEquals(71, owner.queryForObject("SELECT max(installed_rank) FROM flyway_schema_history", Integer.class));
    }

    @AfterAll
    static void drop() {
        if (admin != null) {
            admin.execute("DROP SCHEMA IF EXISTS " + MAIN + " CASCADE");
        }
    }

    static UUID atIame(String model) {
        UUID id = UUID.randomUUID();
        applications.insertDraft(id, applications.nextReference(), NOVA, NOVA, NOVA_COOL, "Nova Cool", "RAC", model);
        applications.setEvidence(id, NOVA, new ModelApplicationRepository.EvidenceUpdate(true, "LAB", true, LocalDate.of(2026, 9, 1), true, new BigDecimal("4.50")));
        int version = submissions.submit(id, NOVA, 0, NOVA_USER, "manufacturer", new BigDecimal("24000.00"), "RAC:new_model", 2, "provisional", "ref", "note")
            .orElseThrow().application().version();
        UUID snapshot = submissions.findFeeSnapshot(id).orElseThrow().id();
        feeRepo.confirm(id, version, FINANCE_USER, "finance", snapshot, new BigDecimal("24000.00"), "UTR-" + id.toString().substring(0, 8), LocalDate.of(2026, 10, 2));
        return id;
    }

    void wiredReturn(UUID id, String stage, UUID officer, String role, String idem) {
        tx.executeWithoutResult(s -> {
            returns.prepareWiredApplicantNotification();
            var r = returns.doReturn(id, owner.queryForObject("SELECT version FROM model_application WHERE id = ?", Integer.class, id), officer, role, stage, REASON);
            wiring.afterReturn(id, r.returnId(), stage, REASON, r.returnedAt(), officer, role, idem);
        });
    }

    void wiredResubmit(UUID id, String idem, String note) {
        tx.executeWithoutResult(s -> {
            var open = resub.openReturn(id).orElseThrow();
            boolean superseded = false;
            String resumed = open.returnedFromState();
            var done = resub.resubmit(id, owner.queryForObject("SELECT version FROM model_application WHERE id = ?", Integer.class, id), NOVA_USER, "manufacturer",
                open.id(), resumed, superseded, note);
            wiring.afterResubmit(id, open.id(), open.returnedFromState(), open.returnedAt(), open.reason(), resumed, note, done.resubmittedAt(), NOVA_USER,
                "manufacturer", idem);
        });
    }

    @Test
    void firstReturnCreatesTaskClockDiscrepancyAndOneApplicantNotification() {
        UUID id = atIame("WP02B2-FIRST-" + TAG);
        wiredReturn(id, "iame_scrutiny", IAME_USER, "iame", UUID.randomUUID().toString());
        assertEquals(1, owner.queryForObject("SELECT count(*) FROM model_return_response_cycle WHERE application_id = ?", Integer.class, id));
        assertEquals(1, owner.queryForObject("SELECT count(*) FROM workflow_task WHERE subject_id = ? AND stage = 'iame_scrutiny' AND action = 'review'", Integer.class, id));
        assertEquals(1, owner.queryForObject("SELECT count(*) FROM workflow_discrepancy WHERE subject_id = ? AND line_code = 'return_response'", Integer.class, id));
        assertEquals(2, owner.queryForObject(
            "SELECT count(*) FROM workflow_sla_clock_event e JOIN workflow_sla_clock c ON c.id = e.clock_id JOIN workflow_task t ON t.id = c.task_id WHERE t.subject_id = ?",
            Integer.class, id));
        var msg = owner.queryForObject("SELECT message FROM notification WHERE application_id = ? AND kind = 'returned' LIMIT 1", String.class, id);
        assertTrue(msg.contains("Respond by"), msg);
        assertTrue(msg.contains(REASON), msg);
    }

    @Test
    void resubmitAddsResponseResumeAndOfficerNotificationOnly() {
        UUID id = atIame("WP02B2-RESUB-" + TAG);
        String idem = UUID.randomUUID().toString();
        wiredReturn(id, "iame_scrutiny", IAME_USER, "iame", UUID.randomUUID().toString());
        int beforeOfficer = owner.queryForObject("SELECT count(*) FROM notification WHERE recipient_account_id = ?", Integer.class, IAME_USER);
        wiredResubmit(id, idem, null);
        assertEquals(1, owner.queryForObject("SELECT count(*) FROM workflow_discrepancy_response r JOIN model_return_response_cycle c ON c.discrepancy_id = r.discrepancy_id WHERE c.application_id = ?", Integer.class, id));
        assertEquals(beforeOfficer + 1, owner.queryForObject("SELECT count(*) FROM notification WHERE recipient_account_id = ? AND kind = 'applicant_resubmitted'", Integer.class, IAME_USER));
        assertEquals(0, owner.queryForObject("SELECT count(*) FROM notification WHERE application_id = ? AND kind = 'applicant_resubmitted' AND recipient_account_id = ?", Integer.class, id, NOVA_USER));
    }

    @Test
    void replayAddsNoExtraWiringEvidence() {
        UUID id = atIame("WP02B2-REPLAY-" + TAG);
        String idem = UUID.randomUUID().toString();
        tx.executeWithoutResult(s -> {
            returns.prepareWiredApplicantNotification();
            var r = returns.doReturn(id, owner.queryForObject("SELECT version FROM model_application WHERE id = ?", Integer.class, id), IAME_USER, "iame", "iame_scrutiny",
                REASON);
            wiring.afterReturn(id, r.returnId(), "iame_scrutiny", REASON, r.returnedAt(), IAME_USER, "iame", idem);
            wiring.afterReturn(id, r.returnId(), "iame_scrutiny", REASON, r.returnedAt(), IAME_USER, "iame", idem);
        });
        assertTrue(owner.queryForObject("SELECT count(*) FROM model_return_response_wiring_evidence WHERE application_id = ? AND purpose = 'model_return_wiring'",
            Integer.class, id) >= 1);
        assertEquals(1, owner.queryForObject("SELECT count(*) FROM workflow_task WHERE subject_id = ?", Integer.class, id));
    }

    @Test
    void returnResubmitReturnCycleUsesNeedsMoreAndSameTask() {
        UUID id = atIame("WP02B2-CYCLE-" + TAG);
        wiredReturn(id, "iame_scrutiny", IAME_USER, "iame", UUID.randomUUID().toString());
        wiredResubmit(id, UUID.randomUUID().toString(), "Applicant note.");
        UUID taskBefore = owner.queryForObject("SELECT task_id FROM model_return_response_cycle WHERE application_id = ?", UUID.class, id);
        wiredReturn(id, "iame_scrutiny", IAME_USER, "iame", UUID.randomUUID().toString());
        assertEquals(taskBefore, owner.queryForObject("SELECT task_id FROM model_return_response_cycle WHERE application_id = ?", UUID.class, id));
        Map<String, Object> disp = owner.queryForMap(
            "SELECT outcome FROM workflow_discrepancy_disposition d JOIN model_return_response_cycle c ON c.discrepancy_id = d.discrepancy_id WHERE c.application_id = ? LIMIT 1",
            id);
        assertEquals("needs_more", disp.get("outcome"));
    }

    @Test
    void resubmitWithNoNoteUsesNeutralResponseBody() {
        UUID id = atIame("WP02B2-NEUTRAL-" + TAG);
        wiredReturn(id, "iame_scrutiny", IAME_USER, "iame", UUID.randomUUID().toString());
        wiredResubmit(id, UUID.randomUUID().toString(), null);
        String body = owner.queryForObject(
            "SELECT r.body FROM workflow_discrepancy_response r JOIN model_return_response_cycle c ON c.discrepancy_id = r.discrepancy_id WHERE c.application_id = ?",
            String.class, id);
        assertEquals(WorkflowReturnResponseWiring.NEUTRAL_RESUBMIT_BODY, body);
    }

    @Test
    void lazyLinksPreV71OpenReturnOnFirstWiredResubmit() {
        UUID id = atIame("WP02B2-LAZY-" + TAG);
        tx.executeWithoutResult(s -> returns.doReturn(id, owner.queryForObject("SELECT version FROM model_application WHERE id = ?", Integer.class, id), IAME_USER,
            "iame", "iame_scrutiny", REASON));
        assertEquals(0, owner.queryForObject("SELECT count(*) FROM model_return_response_cycle WHERE application_id = ?", Integer.class, id));
        wiredResubmit(id, UUID.randomUUID().toString(), "Late link.");
        assertEquals(1, owner.queryForObject("SELECT count(*) FROM model_return_response_cycle WHERE application_id = ?", Integer.class, id));
        assertEquals(1, owner.queryForObject("SELECT count(*) FROM workflow_task WHERE subject_id = ?", Integer.class, id));
    }

    @Test
    void changedPayloadOnSameIdempotencyKeyConflicts() {
        UUID id = atIame("WP02B2-CONFLICT-" + TAG);
        String idem = UUID.randomUUID().toString();
        tx.executeWithoutResult(s -> {
            returns.prepareWiredApplicantNotification();
            var r = returns.doReturn(id, owner.queryForObject("SELECT version FROM model_application WHERE id = ?", Integer.class, id), IAME_USER, "iame",
                "iame_scrutiny", REASON);
            wiring.afterReturn(id, r.returnId(), "iame_scrutiny", REASON, r.returnedAt(), IAME_USER, "iame", idem);
            assertThrows(WorkflowIdempotencyConflictException.class,
                () -> wiring.afterReturn(id, r.returnId(), "iame_scrutiny", "Different reason.", r.returnedAt(), IAME_USER, "iame", idem));
        });
    }

    @Test
    void fullDoubleCycleKeepsOneTaskAndContiguousResponses() {
        UUID id = atIame("WP02B2-DOUBLE-" + TAG);
        wiredReturn(id, "iame_scrutiny", IAME_USER, "iame", UUID.randomUUID().toString());
        wiredResubmit(id, UUID.randomUUID().toString(), "First response.");
        wiredReturn(id, "iame_scrutiny", IAME_USER, "iame", UUID.randomUUID().toString());
        wiredResubmit(id, UUID.randomUUID().toString(), "Second response.");
        assertEquals(1, owner.queryForObject("SELECT count(*) FROM workflow_task WHERE subject_id = ?", Integer.class, id));
        assertEquals(1, owner.queryForObject("SELECT count(*) FROM workflow_discrepancy WHERE subject_id = ?", Integer.class, id));
        assertEquals(2, owner.queryForObject(
            "SELECT count(*) FROM workflow_discrepancy_response r JOIN model_return_response_cycle c ON c.discrepancy_id = r.discrepancy_id WHERE c.application_id = ?",
            Integer.class, id));
    }
}
