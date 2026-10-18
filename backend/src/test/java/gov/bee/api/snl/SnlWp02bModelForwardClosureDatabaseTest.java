package gov.bee.api.snl;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import gov.bee.api.application.IdempotencyRepository;
import gov.bee.api.application.ModelApplicationRepository;
import gov.bee.api.application.ModelApplicationSubmitRepository;
import gov.bee.api.director.DirectorRecommendationRepository;
import gov.bee.api.document.DocumentRepository;
import gov.bee.api.finance.FeeConfirmationRepository;
import gov.bee.api.notifications.NotificationCommandRepository;
import gov.bee.api.director.DirectorRecommendationService;
import gov.bee.api.iame.IameRecommendationRepository;
import gov.bee.api.iame.IameRecommendationService;
import gov.bee.api.identity.Caller;
import gov.bee.api.rating.RatingRepository;
import gov.bee.api.rating.RatingService;
import gov.bee.api.reviewer.ReviewerForwardRepository;
import gov.bee.api.reviewer.ReviewerForwardService;
import gov.bee.api.secretary.SecretaryApprovalRepository;
import gov.bee.api.secretary.SecretaryApprovalService;
import gov.bee.api.settings.BusinessSettingRepository;
import gov.bee.api.settings.BusinessSettingService;
import gov.bee.api.rework.ResubmitApplicationRepository;
import gov.bee.api.rework.StageRejectRepository;
import gov.bee.api.rework.StageReturnRepository;
import gov.bee.api.workflow.SnlReturnResponsePolicyRepository;
import gov.bee.api.workflow.WorkflowFoundationRepository;
import gov.bee.api.workflow.WorkflowIdempotencyConflictException;
import java.math.BigDecimal;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.SQLException;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataAccessException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.transaction.support.TransactionTemplate;

/** Brief 19B-2: cycle lifecycle, forward closure command, service hooks, multi-cycle journeys. */
@Tag("db")
class SnlWp02bModelForwardClosureDatabaseTest extends SnlWp02bModelReturnWiringDatabaseTest {

    static final UUID SECRETARY_USER = UUID.fromString("00000000-0000-4000-a000-000000000008");
    static final Caller REVIEWER_CALLER = new Caller(REVIEWER_USER, "bee.reviewer", List.of(new gov.bee.api.identity.IdentityRepository.RoleGrant("reviewer", "assigned")), Set.of());
    static final Caller PROGRAMME_CALLER = new Caller(PROGRAMME_USER, "bee.programme", List.of(new gov.bee.api.identity.IdentityRepository.RoleGrant("programme", "assigned")), Set.of());
    static final Caller DIRECTOR_CALLER = new Caller(DIRECTOR_USER, "bee.director", List.of(new gov.bee.api.identity.IdentityRepository.RoleGrant("director", "all")), Set.of());
    static final Caller SECRETARY_CALLER = new Caller(SECRETARY_USER, "bee.secretary", List.of(new gov.bee.api.identity.IdentityRepository.RoleGrant("secretary", "all")), Set.of());

    static IameRecommendationService iameService;
    static ReviewerForwardService reviewerService;
    static RatingService ratingService;
    static DirectorRecommendationService directorService;
    static SecretaryApprovalService secretaryService;
    static SecretaryApprovalRepository secretaryApprovalRepo;

    @BeforeAll
    static void forwardServices() {
        var idempotency = transactional(new IdempotencyRepository(db));
        secretaryApprovalRepo = transactional(new SecretaryApprovalRepository(db));
        iameService = transactional(new IameRecommendationService(applications, iameRepo, idempotency, json, wiring));
        reviewerService = transactional(new ReviewerForwardService(applications, reviewerRepo, idempotency, json, wiring));
        var settings = new BusinessSettingService(new BusinessSettingRepository(db), null, null);
        ratingService = transactional(new RatingService(applications, ratingRepo, idempotency, json, settings, wiring));
        directorService = transactional(new DirectorRecommendationService(applications, directorRepo, idempotency, json, wiring));
        secretaryService = transactional(new SecretaryApprovalService(applications, secretaryApprovalRepo, idempotency, json, wiring));
    }

    static String sqlState(Throwable e) {
        for (Throwable t = e; t != null; t = t.getCause()) {
            if (t instanceof SQLException s) {
                return s.getSQLState();
            }
        }
        return null;
    }

    static String sqlMessage(Throwable e) {
        for (Throwable t = e; t != null; t = t.getCause()) {
            if (t instanceof SQLException s) {
                return s.getMessage();
            }
        }
        return e.getMessage();
    }

    static String runtimeRole() {
        return env("BEE_RUNTIME_DB_USER", "bee_runtime");
    }

    void returnResubmitAt(UUID id, String stage, UUID officer, String role) {
        wiredReturn(id, stage, officer, role, UUID.randomUUID().toString());
        wiredResubmit(id, UUID.randomUUID().toString(), "Applicant note.");
    }

    void assertNoExtraForwardClosureSurvivors(UUID id) {
        assertEquals(1, owner.queryForObject("SELECT count(*) FROM model_application_transition_event e "
            + "JOIN model_application_iame_recommendation r ON r.transition_event_id = e.id WHERE e.application_id = ?", Integer.class, id));
        assertEquals(1, owner.queryForObject(
            "SELECT count(*) FROM workflow_discrepancy_disposition d JOIN model_return_response_cycle c ON c.discrepancy_id = d.discrepancy_id "
                + "WHERE c.application_id = ? AND d.outcome = 'accepted'",
            Integer.class, id));
        assertEquals(1, owner.queryForObject(
            "SELECT count(*) FROM workflow_sla_clock_event e JOIN workflow_sla_clock cl ON cl.id = e.clock_id "
                + "JOIN model_return_response_cycle c ON c.task_id = cl.task_id WHERE c.application_id = ? AND e.event_kind = 'stop'",
            Integer.class, id));
        assertEquals(1, owner.queryForObject(
            "SELECT count(*) FROM workflow_task t JOIN model_return_response_cycle c ON c.task_id = t.id WHERE c.application_id = ? AND t.status = 'completed'",
            Integer.class, id));
        assertEquals(1, owner.queryForObject("SELECT count(*) FROM model_return_response_cycle WHERE application_id = ? AND status = 'closed'", Integer.class, id));
        assertEquals(1, owner.queryForObject("SELECT count(*) FROM model_return_response_wiring_evidence WHERE application_id = ? AND purpose = 'forward_closure'", Integer.class, id));
        assertEquals(1, owner.queryForObject("SELECT count(*) FROM workflow_task WHERE subject_id = ? AND action = 'review'", Integer.class, id));
        assertEquals(1, owner.queryForObject("SELECT count(*) FROM workflow_discrepancy WHERE subject_id = ? AND line_code = 'return_response'", Integer.class, id));
        assertEquals(1, owner.queryForObject("SELECT count(*) FROM workflow_sla_clock cl JOIN model_return_response_cycle c ON c.task_id = cl.task_id WHERE c.application_id = ?", Integer.class, id));
        assertEquals(0, owner.queryForObject("SELECT count(*) FROM model_return_response_cycle WHERE application_id = ? AND status = 'open'", Integer.class, id));
    }

    UUID openTask(UUID id) {
        return owner.queryForObject("SELECT task_id FROM model_return_response_cycle WHERE application_id = ? AND status = 'open'", UUID.class, id);
    }

    @Test
    void existingV71OpenCycleMigratesWithoutHistoryLoss() {
        UUID id = atIame("WP02B2F-MIG-" + TAG);
        wiredReturn(id, "iame_scrutiny", IAME_USER, "iame", UUID.randomUUID().toString());
        wiredResubmit(id, UUID.randomUUID().toString(), "Keep history.");
        int responses = owner.queryForObject(
            "SELECT count(*) FROM workflow_discrepancy_response r JOIN model_return_response_cycle c ON c.discrepancy_id = r.discrepancy_id WHERE c.application_id = ?",
            Integer.class, id);
        UUID task = owner.queryForObject("SELECT task_id FROM model_return_response_cycle WHERE application_id = ?", UUID.class, id);
        assertEquals(1, owner.queryForObject("SELECT cycle_seq FROM model_return_response_cycle WHERE application_id = ?", Integer.class, id));
        assertEquals("open", owner.queryForObject("SELECT status FROM model_return_response_cycle WHERE application_id = ?", String.class, id));
        assertEquals(responses, owner.queryForObject(
            "SELECT count(*) FROM workflow_discrepancy_response r JOIN model_return_response_cycle c ON c.discrepancy_id = r.discrepancy_id WHERE c.application_id = ?",
            Integer.class, id));
        assertEquals(task, owner.queryForObject("SELECT task_id FROM model_return_response_cycle WHERE application_id = ?", UUID.class, id));
    }

    @Test
    void onlyOneOpenCyclePerApplication() {
        UUID id = atIame("WP02B2F-ONEOPEN-" + TAG);
        wiredReturn(id, "iame_scrutiny", IAME_USER, "iame", UUID.randomUUID().toString());
        assertThrows(DataAccessException.class, () -> owner.update(
            "INSERT INTO model_return_response_cycle (application_id, review_stage, task_id, discrepancy_id, cycle_seq, status) "
                + "SELECT application_id, review_stage, task_id, discrepancy_id, 2, 'open' FROM model_return_response_cycle WHERE application_id = ?",
            id));
    }

    @Test
    void acceptedCycleThenLaterStageReturnCreatesIndependentCycle() {
        UUID id = atIame("WP02B2F-INDEP-" + TAG);
        returnResubmitAt(id, "iame_scrutiny", IAME_USER, "iame");
        UUID cycle1 = owner.queryForObject("SELECT id FROM model_return_response_cycle WHERE application_id = ? AND cycle_seq = 1", UUID.class, id);
        UUID task1 = owner.queryForObject("SELECT task_id FROM model_return_response_cycle WHERE id = ?", UUID.class, cycle1);
        int v = owner.queryForObject("SELECT version FROM model_application WHERE id = ?", Integer.class, id);
        var done = iameRepo.recommend(id, v, IAME_USER, "iame", "verified", "n");
        wiring.afterAcceptedForward(id, done.transitionEventId(), IameRecommendationRepository.ACTION, IameRecommendationRepository.FROM_STATE,
            IameRecommendationRepository.TO_STATE, done.versionAfter(), IAME_USER, "iame", done.recommendedAt(), UUID.randomUUID().toString());
        assertEquals("closed", owner.queryForObject("SELECT status FROM model_return_response_cycle WHERE id = ?", String.class, cycle1));
        wiredReturn(id, "bee_scrutiny", REVIEWER_USER, "reviewer", UUID.randomUUID().toString());
        UUID task2 = openTask(id);
        assertNotEquals(task1, task2);
        assertEquals(2, owner.queryForObject("SELECT count(*) FROM model_return_response_cycle WHERE application_id = ?", Integer.class, id));
        assertEquals(2, owner.queryForObject("SELECT count(*) FROM workflow_discrepancy WHERE subject_id = ? AND line_code = 'return_response'", Integer.class, id));
    }

    @Test
    void closedCycleCannotReceiveNewResponseDispositionOrClockEvent() {
        UUID id = atIame("WP02B2F-CLOSED-" + TAG);
        returnResubmitAt(id, "iame_scrutiny", IAME_USER, "iame");
        UUID disc = owner.queryForObject("SELECT discrepancy_id FROM model_return_response_cycle WHERE application_id = ? AND status = 'open'", UUID.class, id);
        int v = owner.queryForObject("SELECT version FROM model_application WHERE id = ?", Integer.class, id);
        iameRepo.recommend(id, v, IAME_USER, "iame", "verified", "n");
        var te = owner.queryForMap("SELECT id, version_after, occurred_at FROM model_application_transition_event WHERE application_id = ? ORDER BY occurred_at DESC LIMIT 1", id);
        wiring.afterAcceptedForward(id, (UUID) te.get("id"), IameRecommendationRepository.ACTION, IameRecommendationRepository.FROM_STATE,
            IameRecommendationRepository.TO_STATE, (Integer) te.get("version_after"), IAME_USER, "iame", ((java.sql.Timestamp) te.get("occurred_at")).toInstant(),
            UUID.randomUUID().toString());
        assertThrows(DataAccessException.class, () -> db.query("SELECT model_return_response_append_response(?, 'x', ?)", rs -> {
        }, disc, NOVA_USER));
        UUID clock = owner.queryForObject("SELECT cl.id FROM workflow_sla_clock cl JOIN model_return_response_cycle c ON c.task_id = cl.task_id WHERE c.discrepancy_id = ?", UUID.class, disc);
        assertThrows(DataAccessException.class,
            () -> db.query("SELECT workflow_foundation_append_clock_event(?, 'stop', 'bureau', now(), NULL)", rs -> {
            }, clock));
    }

    @Test
    void forwardClosureAcceptsLatestResponseStopsClockAndCompletesTask() {
        UUID id = atIame("WP02B2F-FWD-" + TAG);
        returnResubmitAt(id, "iame_scrutiny", IAME_USER, "iame");
        UUID task = openTask(id);
        int v = owner.queryForObject("SELECT version FROM model_application WHERE id = ?", Integer.class, id);
        var done = iameRepo.recommend(id, v, IAME_USER, "iame", "verified", "n");
        wiring.afterAcceptedForward(id, done.transitionEventId(), IameRecommendationRepository.ACTION, IameRecommendationRepository.FROM_STATE,
            IameRecommendationRepository.TO_STATE, done.versionAfter(), IAME_USER, "iame", done.recommendedAt(), idemKey("0000000000000010"));
        assertEquals("closed", owner.queryForObject("SELECT d.status FROM workflow_discrepancy d JOIN model_return_response_cycle c ON c.discrepancy_id = d.id WHERE c.application_id = ? AND c.cycle_seq = 1", String.class, id));
        assertEquals("completed", owner.queryForObject("SELECT status FROM workflow_task WHERE id = ?", String.class, task));
        assertEquals("accepted", owner.queryForObject(
            "SELECT outcome FROM workflow_discrepancy_disposition d JOIN model_return_response_cycle c ON c.discrepancy_id = d.discrepancy_id WHERE c.application_id = ?",
            String.class, id));
        assertTrue(owner.queryForObject(
            "SELECT count(*) FROM workflow_sla_clock_event e JOIN workflow_sla_clock cl ON cl.id = e.clock_id WHERE cl.task_id = ? AND e.event_kind = 'stop'",
            Integer.class, task) >= 1);
        assertEquals(0, owner.queryForObject("SELECT count(*) FROM model_return_response_cycle WHERE application_id = ? AND status = 'open'", Integer.class, id));
    }

    @Test
    void forwardClosureWithoutOpenCycleIsNoOp() {
        UUID id = atIame("WP02B2F-NOOP-" + TAG);
        int v = owner.queryForObject("SELECT version FROM model_application WHERE id = ?", Integer.class, id);
        var done = iameRepo.recommend(id, v, IAME_USER, "iame", "verified", "n");
        wiring.afterAcceptedForward(id, done.transitionEventId(), IameRecommendationRepository.ACTION, IameRecommendationRepository.FROM_STATE,
            IameRecommendationRepository.TO_STATE, done.versionAfter(), IAME_USER, "iame", done.recommendedAt(), idemKey("0000000000000011"));
        assertEquals(0, owner.queryForObject("SELECT count(*) FROM model_return_response_wiring_evidence WHERE application_id = ? AND purpose = 'forward_closure'", Integer.class, id));
    }

    @Test
    void forwardClosureRejectsWrongStageActorActionOrTransition() {
        UUID id = atIame("WP02B2F-REJECT-" + TAG);
        returnResubmitAt(id, "iame_scrutiny", IAME_USER, "iame");
        int v = owner.queryForObject("SELECT version FROM model_application WHERE id = ?", Integer.class, id);
        var done = iameRepo.recommend(id, v, IAME_USER, "iame", "verified", "n");
        assertThrows(DataAccessException.class, () -> wiring.afterAcceptedForward(id, done.transitionEventId(), "wrong_action",
            IameRecommendationRepository.FROM_STATE, IameRecommendationRepository.TO_STATE, done.versionAfter(), IAME_USER, "iame", done.recommendedAt(),
            UUID.randomUUID().toString()));
    }

    @Test
    void forwardClosureReplayIsStableAndChangedPayloadConflicts() {
        UUID id = atIame("WP02B2F-REPLAY-" + TAG);
        returnResubmitAt(id, "iame_scrutiny", IAME_USER, "iame");
        int v = owner.queryForObject("SELECT version FROM model_application WHERE id = ?", Integer.class, id);
        var done = iameRepo.recommend(id, v, IAME_USER, "iame", "verified", "n");
        String idem = idemKey("0000000000000012");
        wiring.afterAcceptedForward(id, done.transitionEventId(), IameRecommendationRepository.ACTION, IameRecommendationRepository.FROM_STATE,
            IameRecommendationRepository.TO_STATE, done.versionAfter(), IAME_USER, "iame", done.recommendedAt(), idem);
        wiring.afterAcceptedForward(id, done.transitionEventId(), IameRecommendationRepository.ACTION, IameRecommendationRepository.FROM_STATE,
            IameRecommendationRepository.TO_STATE, done.versionAfter(), IAME_USER, "iame", done.recommendedAt(), idem);
        assertEquals(1, owner.queryForObject("SELECT count(*) FROM model_return_response_wiring_evidence WHERE application_id = ? AND purpose = 'forward_closure'", Integer.class, id));
        wiredReturn(id, "bee_scrutiny", REVIEWER_USER, "reviewer", UUID.randomUUID().toString());
        wiredResubmit(id, UUID.randomUUID().toString(), "second cycle");
        v = owner.queryForObject("SELECT version FROM model_application WHERE id = ?", Integer.class, id);
        var doneSecond = reviewerRepo.forward(id, v, REVIEWER_USER, "reviewer", "n");
        assertThrows(WorkflowIdempotencyConflictException.class, () -> wiring.afterAcceptedForward(id, doneSecond.transitionEventId(),
            ReviewerForwardRepository.ACTION, ReviewerForwardRepository.FROM_STATE, "rating", doneSecond.versionAfter(), REVIEWER_USER, "reviewer",
            doneSecond.forwardedAt(), idem));
    }

    @Test
    void runtimeCannotForgeDispositionTaskClockCycleOrEvidence() {
        UUID id = atIame("WP02B2F-FORGE-" + TAG);
        returnResubmitAt(id, "iame_scrutiny", IAME_USER, "iame");
        UUID disc = owner.queryForObject("SELECT discrepancy_id FROM model_return_response_cycle WHERE application_id = ? AND status = 'open'", UUID.class, id);
        UUID task = openTask(id);
        assertThrows(DataAccessException.class,
            () -> db.update("UPDATE model_return_response_cycle SET status = 'closed', closed_at = now(), closure_transition_event_id = ?, "
                + "closure_from_state = 'iame_scrutiny', closure_to_state = 'bee_scrutiny' WHERE application_id = ?",
                UUID.randomUUID(), id));
        assertThrows(DataAccessException.class, () -> db.update(
            "INSERT INTO workflow_discrepancy_disposition (discrepancy_id, response_seq, outcome, disposed_by) VALUES (?, 1, 'accepted', ?)", disc, IAME_USER));
        assertThrows(DataAccessException.class, () -> db.update("UPDATE workflow_task SET status = 'completed' WHERE id = ?", task));
    }

    @Test
    void injectedFailureAfterDispositionRollsBackLegacyForwardAndClosureBundle() {
        UUID id = atIame("WP02B2F-INJ-" + TAG);
        returnResubmitAt(id, "iame_scrutiny", IAME_USER, "iame");
        owner.execute(
            "CREATE FUNCTION wp02b2_fail_after_disposition_for_test() RETURNS trigger LANGUAGE plpgsql AS $$ "
                + "BEGIN IF NEW.outcome = 'accepted' THEN RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'wp02b2_test_failure_after_disposition'; END IF; RETURN NEW; END $$");
        owner.execute("CREATE TRIGGER wp02b2_fail_after_disposition_for_test BEFORE INSERT ON workflow_discrepancy_disposition "
            + "FOR EACH ROW EXECUTE FUNCTION wp02b2_fail_after_disposition_for_test()");
        try {
            int v = owner.queryForObject("SELECT version FROM model_application WHERE id = ?", Integer.class, id);
            assertThrows(Exception.class, () -> tx.executeWithoutResult(s -> {
                iameRepo.recommend(id, v, IAME_USER, "iame", "verified", "n");
                var te = owner.queryForMap("SELECT id, version_after, occurred_at FROM model_application_transition_event WHERE application_id = ? ORDER BY occurred_at DESC LIMIT 1", id);
                wiring.afterAcceptedForward(id, (UUID) te.get("id"), IameRecommendationRepository.ACTION, IameRecommendationRepository.FROM_STATE,
                    IameRecommendationRepository.TO_STATE, (Integer) te.get("version_after"), IAME_USER, "iame",
                    ((java.sql.Timestamp) te.get("occurred_at")).toInstant(), UUID.randomUUID().toString());
            }));
        } finally {
            owner.execute("DROP TRIGGER IF EXISTS wp02b2_fail_after_disposition_for_test ON workflow_discrepancy_disposition");
            owner.execute("DROP FUNCTION IF EXISTS wp02b2_fail_after_disposition_for_test()");
        }
        assertEquals("iame_scrutiny", owner.queryForObject("SELECT state FROM model_application WHERE id = ?", String.class, id));
        assertEquals("open", owner.queryForObject("SELECT status FROM model_return_response_cycle WHERE application_id = ?", String.class, id));
    }

    @Test
    void iameRecommendAcceptedForwardClosesReturnCycle() throws Exception {
        UUID id = atIame("WP02B2F-IAME-" + TAG);
        returnResubmitAt(id, "iame_scrutiny", IAME_USER, "iame");
        int v = owner.queryForObject("SELECT version FROM model_application WHERE id = ?", Integer.class, id);
        var body = json.readTree("{\"version\":" + v + ",\"verification\":\"verified\",\"note\":\"ok\"}");
        assertEquals(HttpStatus.OK, iameService.run(IAME_CALLER, id, idemKey("0000000000000020"), body).getStatusCode());
        assertEquals("closed", owner.queryForObject("SELECT status FROM model_return_response_cycle WHERE application_id = ? AND cycle_seq = 1", String.class, id));
    }

    @Test
    void reviewerForwardAcceptedForwardClosesReturnCycle() throws Exception {
        UUID id = atIame("WP02B2F-REV-" + TAG);
        iameRepo.recommend(id, 2, IAME_USER, "iame", "verified", "n");
        returnResubmitAt(id, "bee_scrutiny", REVIEWER_USER, "reviewer");
        int v = owner.queryForObject("SELECT version FROM model_application WHERE id = ?", Integer.class, id);
        var body = json.readTree("{\"version\":" + v + ",\"note\":\"ok\"}");
        assertEquals(HttpStatus.OK, reviewerService.run(REVIEWER_CALLER, id, idemKey("0000000000000021"), body).getStatusCode());
        assertEquals("closed", owner.queryForObject("SELECT status FROM model_return_response_cycle WHERE application_id = ? AND cycle_seq = 1", String.class, id));
    }

    @Test
    void computeRatingAcceptedForwardClosesReturnCycle() throws Exception {
        UUID id = atDirector("WP02B2F-RAT-" + TAG);
        wiredReturn(id, "director_review", DIRECTOR_USER, "director", UUID.randomUUID().toString());
        applications.setEvidence(id, NOVA, new gov.bee.api.application.ModelApplicationRepository.EvidenceUpdate(true, "LAB", true, java.time.LocalDate.of(2026, 9, 1), true, new BigDecimal("4.80")));
        wiredResubmit(id, UUID.randomUUID().toString(), "Rating input updated.");
        int v = owner.queryForObject("SELECT version FROM model_application WHERE id = ?", Integer.class, id);
        var done = ratingRepo.compute(id, v, PROGRAMME_USER, "programme", "RAC-ISEER-DEMO-1", new BigDecimal("4.50"), new BigDecimal("4.62"), 4);
        wiring.afterAcceptedForward(id, done.transitionEventId(), RatingRepository.ACTION, RatingRepository.FROM_STATE, RatingRepository.TO_STATE,
            done.versionAfter(), PROGRAMME_USER, "programme", done.computedAt(), idemKey("0000000000000022"));
        assertEquals("closed", owner.queryForObject("SELECT status FROM model_return_response_cycle WHERE application_id = ? AND cycle_seq = 1", String.class, id));
    }

    @Test
    void directorRecommendToSecretaryAcceptedForwardClosesReturnCycle() throws Exception {
        UUID id = atDirector("WP02B2F-DIR-S-" + TAG);
        returnResubmitAt(id, "director_review", DIRECTOR_USER, "director");
        int v = owner.queryForObject("SELECT version FROM model_application WHERE id = ?", Integer.class, id);
        var body = json.readTree("{\"version\":" + v + ",\"note\":\"ok\"}");
        assertEquals(HttpStatus.OK, directorService.run(DIRECTOR_CALLER, id, idemKey("0000000000000023"), body).getStatusCode());
        assertEquals("closed", owner.queryForObject("SELECT status FROM model_return_response_cycle WHERE application_id = ? AND cycle_seq = 1", String.class, id));
    }

    @Test
    void directorFinalRecommendAcceptedForwardClosesReturnCycle() throws Exception {
        UUID id = atDirector("WP02B2F-DIR-F-" + TAG);
        returnResubmitAt(id, "director_review", DIRECTOR_USER, "director");
        int v = owner.queryForObject("SELECT version FROM model_application WHERE id = ?", Integer.class, id);
        owner.update("INSERT INTO director_final_rule (category_code, effective_from, director_final, source_reference, note) VALUES ('RAC', '2020-01-01', true, 'wp02b2-test', 'test final') ON CONFLICT DO NOTHING");
        var body = json.readTree("{\"version\":" + v + ",\"note\":\"final ok\"}");
        assertEquals(HttpStatus.OK, directorService.run(DIRECTOR_CALLER, id, idemKey("0000000000000024"), body).getStatusCode());
        assertEquals("closed", owner.queryForObject("SELECT status FROM model_return_response_cycle WHERE application_id = ? AND cycle_seq = 1", String.class, id));
    }

    @Test
    void secretaryApproveAcceptedForwardClosesReturnCycle() throws Exception {
        UUID id = atDirector("WP02B2F-SEC-" + TAG);
        directorRepo.recommend(id, owner.queryForObject("SELECT version FROM model_application WHERE id = ?", Integer.class, id), DIRECTOR_USER, "director", "n", false);
        returnResubmitAt(id, "secretary_approval", DIRECTOR_USER, "director");
        int v = owner.queryForObject("SELECT version FROM model_application WHERE id = ?", Integer.class, id);
        var body = json.readTree("{\"version\":" + v + ",\"note\":\"ok\"}");
        assertEquals(HttpStatus.OK, secretaryService.run(SECRETARY_CALLER, id, idemKey("0000000000000025"), body).getStatusCode());
        assertEquals("closed", owner.queryForObject("SELECT status FROM model_return_response_cycle WHERE application_id = ? AND cycle_seq = 1", String.class, id));
    }

    @Test
    void legacyForwardWithoutReturnCycleMatchesPriorDatabaseShape() {
        UUID id = atIame("WP02B2F-LEG-" + TAG);
        int v = owner.queryForObject("SELECT version FROM model_application WHERE id = ?", Integer.class, id);
        iameRepo.recommend(id, v, IAME_USER, "iame", "verified", "n");
        assertEquals("bee_scrutiny", owner.queryForObject("SELECT state FROM model_application WHERE id = ?", String.class, id));
        assertEquals(0, owner.queryForObject("SELECT count(*) FROM model_return_response_cycle WHERE application_id = ?", Integer.class, id));
        assertEquals(0, owner.queryForObject("SELECT count(*) FROM model_return_response_wiring_evidence WHERE purpose = 'forward_closure' AND application_id = ?", Integer.class, id));
    }

    @Test
    void forwardClosureConflictRollsBackLegacyTransition() throws Exception {
        UUID id = atIame("WP02B2F-SVC-RB-" + TAG);
        returnResubmitAt(id, "iame_scrutiny", IAME_USER, "iame");
        int v = owner.queryForObject("SELECT version FROM model_application WHERE id = ?", Integer.class, id);
        String idem = idemKey("0000000000000026");
        var ok = json.readTree("{\"version\":" + v + ",\"verification\":\"verified\",\"note\":\"ok\"}");
        WorkflowReturnResponseWiring.testMidWiringFailureHook = () -> {
            throw new IllegalStateException("test_mid_forward_closure_failure");
        };
        try {
            assertThrows(IllegalStateException.class, () -> iameService.run(IAME_CALLER, id, idem, ok));
        } finally {
            WorkflowReturnResponseWiring.testMidWiringFailureHook = null;
        }
        assertEquals("iame_scrutiny", owner.queryForObject("SELECT state FROM model_application WHERE id = ?", String.class, id));
        assertEquals("open", owner.queryForObject("SELECT status FROM model_return_response_cycle WHERE application_id = ?", String.class, id));
    }

    @Test
    void concurrentIdenticalStageForwardCreatesOneClosureBundle() throws Exception {
        UUID id = atIame("WP02B2F-CONC-" + TAG);
        returnResubmitAt(id, "iame_scrutiny", IAME_USER, "iame");
        int v = owner.queryForObject("SELECT version FROM model_application WHERE id = ?", Integer.class, id);
        String idem = idemKey("0000000000000027");
        var body = json.readTree("{\"version\":" + v + ",\"verification\":\"verified\",\"note\":\"ok\"}");
        ExecutorService pool = Executors.newFixedThreadPool(2);
        CountDownLatch start = new CountDownLatch(1);
        Future<?> a = pool.submit(() -> {
            start.await(5, TimeUnit.SECONDS);
            return iameService.run(IAME_CALLER, id, idem, body);
        });
        Future<?> b = pool.submit(() -> {
            start.await(5, TimeUnit.SECONDS);
            return iameService.run(IAME_CALLER, id, idem, body);
        });
        start.countDown();
        pool.shutdown();
        assertTrue(pool.awaitTermination(30, TimeUnit.SECONDS));
        int ok = 0;
        for (Future<?> f : List.of(a, b)) {
            @SuppressWarnings("unchecked")
            var res = (org.springframework.http.ResponseEntity<java.util.Map<String, Object>>) f.get();
            if (res.getStatusCode().is2xxSuccessful()) {
                ok++;
            }
        }
        assertEquals(1, ok);
        assertEquals(1, owner.queryForObject("SELECT count(*) FROM model_return_response_wiring_evidence WHERE application_id = ? AND purpose = 'forward_closure'", Integer.class, id));
    }

    @Test
    void multiCycleIameThenBeeJourney() throws Exception {
        UUID id = atIame("WP02B2F-MC1-" + TAG);
        returnResubmitAt(id, "iame_scrutiny", IAME_USER, "iame");
        int v = owner.queryForObject("SELECT version FROM model_application WHERE id = ?", Integer.class, id);
        iameService.run(IAME_CALLER, id, idemKey("0000000000000030"), json.readTree("{\"version\":" + v + ",\"verification\":\"verified\",\"note\":\"c1\"}"));
        UUID c1 = owner.queryForObject("SELECT id FROM model_return_response_cycle WHERE application_id = ? AND cycle_seq = 1", UUID.class, id);
        wiredReturn(id, "bee_scrutiny", REVIEWER_USER, "reviewer", UUID.randomUUID().toString());
        wiredResubmit(id, UUID.randomUUID().toString(), "c2");
        v = owner.queryForObject("SELECT version FROM model_application WHERE id = ?", Integer.class, id);
        reviewerService.run(REVIEWER_CALLER, id, idemKey("0000000000000031"), json.readTree("{\"version\":" + v + ",\"note\":\"c2\"}"));
        UUID c2 = owner.queryForObject("SELECT id FROM model_return_response_cycle WHERE application_id = ? AND cycle_seq = 2", UUID.class, id);
        assertNotEquals(c1, c2);
        assertEquals("closed", owner.queryForObject("SELECT status FROM model_return_response_cycle WHERE id = ?", String.class, c1));
        assertEquals("closed", owner.queryForObject("SELECT status FROM model_return_response_cycle WHERE id = ?", String.class, c2));
        assertEquals(0, owner.queryForObject("SELECT count(*) FROM workflow_task WHERE subject_id = ? AND status = 'open' AND action = 'review'", Integer.class, id));
    }

    @Test
    void multiCycleDirectorRatingSecretaryJourney() throws Exception {
        UUID id = atDirector("WP02B2F-MC2-" + TAG);
        wiredReturn(id, "director_review", DIRECTOR_USER, "director", UUID.randomUUID().toString());
        applications.setEvidence(id, NOVA, new gov.bee.api.application.ModelApplicationRepository.EvidenceUpdate(true, "LAB", true, java.time.LocalDate.of(2026, 9, 1), true, new BigDecimal("4.80")));
        wiredResubmit(id, UUID.randomUUID().toString(), "superseded to rating");
        int v = owner.queryForObject("SELECT version FROM model_application WHERE id = ?", Integer.class, id);
        var rated = ratingRepo.compute(id, v, PROGRAMME_USER, "programme", "RAC-ISEER-DEMO-1", new BigDecimal("4.50"), new BigDecimal("4.62"), 4);
        wiring.afterAcceptedForward(id, rated.transitionEventId(), RatingRepository.ACTION, RatingRepository.FROM_STATE, RatingRepository.TO_STATE,
            rated.versionAfter(), PROGRAMME_USER, "programme", rated.computedAt(), idemKey("0000000000000033"));
        directorRepo.recommend(id, owner.queryForObject("SELECT version FROM model_application WHERE id = ?", Integer.class, id), DIRECTOR_USER, "director", "n", false);
        assertEquals("secretary_approval", owner.queryForObject("SELECT state FROM model_application WHERE id = ?", String.class, id));
        returnResubmitAt(id, "secretary_approval", DIRECTOR_USER, "director");
        v = owner.queryForObject("SELECT version FROM model_application WHERE id = ?", Integer.class, id);
        secretaryService.run(SECRETARY_CALLER, id, idemKey("0000000000000034"), json.readTree("{\"version\":" + v + ",\"note\":\"ok\"}"));
        assertTrue(owner.queryForObject("SELECT count(*) FROM model_return_response_cycle WHERE application_id = ? AND status = 'closed'", Integer.class, id) >= 2);
        assertEquals(0, owner.queryForObject("SELECT count(*) FROM model_return_response_cycle WHERE application_id = ? AND status = 'open'", Integer.class, id));
    }

    @Test
    void v71ReturnsBackfillIntoMigratedCycle() throws Exception {
        String mig = MAIN + "_v71bf";
        admin.execute("DROP SCHEMA IF EXISTS " + mig + " CASCADE");
        admin.execute("CREATE SCHEMA " + mig);
        Flyway.configure().dataSource(migrateSource(mig)).schemas(mig).defaultSchema(mig).createSchemas(false)
            .locations("classpath:db/migration").target("71").load().migrate();
        JdbcTemplate migOwner = new JdbcTemplate(migrateSource(mig));
        migOwner.execute(Files.readString(Path.of("..", "local", "seed", "seed.sql")));
        DriverManagerDataSource migRuntimeDs = sourceAs(mig, runtimeRole(), env("BEE_RUNTIME_DB_PASSWORD", "bee-local-runtime"));
        JdbcTemplate migDb = new JdbcTemplate(migRuntimeDs);
        TransactionTemplate migTx = new TransactionTemplate(new DataSourceTransactionManager(migRuntimeDs));
        var migApps = new ModelApplicationRepository(migDb);
        var migSubmissions = new ModelApplicationSubmitRepository(migDb, migApps);
        var migFee = transactional(new FeeConfirmationRepository(migDb));
        var migReturns = transactional(new StageReturnRepository(migDb));
        var migResub = transactional(new ResubmitApplicationRepository(migDb));
        var migFoundation = new WorkflowFoundationRepository(migDb);
        var migWiringRepo = new ModelReturnResponseWiringRepository(migDb);
        var migPolicy = new SnlReturnResponsePolicyRepository(migDb);
        var migWiring = new WorkflowReturnResponseWiring(migWiringRepo, migFoundation, migPolicy, new NotificationCommandRepository(migDb));
        UUID id = UUID.randomUUID();
        migApps.insertDraft(id, migApps.nextReference(), NOVA, NOVA, NOVA_COOL, "Nova Cool", "RAC", "WP02B2B-V71BF-" + TAG);
        var migDocs = new DocumentRepository(migDb);
        var migDoc = migDocs.insertDocument(UUID.randomUUID(), id, "test_report");
        migDocs.insertVersion(UUID.randomUUID(), migDoc.id(), 1, "a".repeat(64), 12, "application/pdf", "r.pdf", "Lab", null, null, NOVA_USER);
        migApps.setEvidence(id, NOVA, new gov.bee.api.application.ModelApplicationRepository.EvidenceUpdate(true, "LAB", true, java.time.LocalDate.of(2026, 9, 1), true, new BigDecimal("4.50")));
        int version = migSubmissions.submit(id, NOVA, 0, NOVA_USER, "manufacturer", new BigDecimal("24000.00"), "RAC:new_model", 2, "provisional", "ref", "note")
            .orElseThrow().application().version();
        UUID snapshot = migSubmissions.findFeeSnapshot(id).orElseThrow().id();
        migFee.confirm(id, version, FINANCE_USER, "finance", snapshot, new BigDecimal("24000.00"), "UTR-" + id.toString().substring(0, 8), LocalDate.of(2026, 10, 2));
        int responsesBefore = migOwner.queryForObject(
            "SELECT count(*) FROM workflow_discrepancy_response r JOIN model_return_response_cycle c ON c.discrepancy_id = r.discrepancy_id WHERE c.application_id = ?",
            Integer.class, id);
        migTx.executeWithoutResult(s -> {
            int v = migOwner.queryForObject("SELECT version FROM model_application WHERE id = ?", Integer.class, id);
            UUID returnId = UUID.randomUUID();
            var trans = migReturns.transitionToReturned(id, v, IAME_USER, "iame", "iame_scrutiny");
            migWiring.completeWiredReturn(id, returnId, trans.transitionEventId(), "iame_scrutiny", REASON, trans.returnedAt(), IAME_USER, "iame",
                UUID.randomUUID().toString());
        });
        assertEquals(0, migOwner.queryForObject(
            "SELECT count(*) FROM information_schema.tables WHERE table_schema = ? AND table_name = 'model_return_response_cycle_return'", Integer.class, mig));
        int returnCount = migOwner.queryForObject("SELECT count(*) FROM model_application_return WHERE application_id = ?", Integer.class, id);
        UUID cycleId = migOwner.queryForObject("SELECT id FROM model_return_response_cycle WHERE application_id = ?", UUID.class, id);
        Flyway.configure().dataSource(migrateSource(mig)).schemas(mig).defaultSchema(mig).createSchemas(false)
            .locations("classpath:db/migration").load().migrate();
        assertEquals(returnCount, migOwner.queryForObject(
            "SELECT count(*) FROM model_return_response_cycle_return cr JOIN model_return_response_cycle c ON c.id = cr.cycle_id WHERE c.application_id = ?",
            Integer.class, id));
        assertEquals(cycleId, migOwner.queryForObject(
            "SELECT cycle_id FROM model_return_response_cycle_return cr JOIN model_return_response_cycle c ON c.id = cr.cycle_id WHERE c.application_id = ? LIMIT 1",
            UUID.class, id));
        assertEquals(responsesBefore, migOwner.queryForObject(
            "SELECT count(*) FROM workflow_discrepancy_response r JOIN model_return_response_cycle c ON c.discrepancy_id = r.discrepancy_id WHERE c.application_id = ?",
            Integer.class, id));
        admin.execute("DROP SCHEMA IF EXISTS " + mig + " CASCADE");
    }

    @Test
    void eachNewAndRepeatReturnIsBoundToExactlyOneCycle() {
        UUID id = atIame("WP02B2A-BIND-" + TAG);
        wiredReturn(id, "iame_scrutiny", IAME_USER, "iame", UUID.randomUUID().toString());
        UUID cycle = owner.queryForObject("SELECT id FROM model_return_response_cycle WHERE application_id = ? AND status = 'open'", UUID.class, id);
        UUID return1 = owner.queryForObject("SELECT return_id FROM model_return_response_cycle_return WHERE cycle_id = ? ORDER BY bound_at LIMIT 1", UUID.class, cycle);
        wiredResubmit(id, UUID.randomUUID().toString(), "between returns");
        wiredReturn(id, "iame_scrutiny", IAME_USER, "iame", UUID.randomUUID().toString());
        UUID return2 = owner.queryForObject("SELECT return_id FROM model_return_response_cycle_return WHERE cycle_id = ? ORDER BY bound_at DESC LIMIT 1", UUID.class, cycle);
        assertNotEquals(return1, return2);
        assertEquals(2, owner.queryForObject("SELECT count(*) FROM model_return_response_cycle_return WHERE cycle_id = ?", Integer.class, cycle));
        assertEquals(1, owner.queryForObject("SELECT count(*) FROM model_return_response_cycle_return WHERE return_id = ?", Integer.class, return1));
    }

    @Test
    void oldCycleReturnCannotResubmitOrNotifyCurrentCycle() throws Exception {
        UUID id = atIame("WP02B2A-OLDRET-" + TAG);
        returnResubmitAt(id, "iame_scrutiny", IAME_USER, "iame");
        UUID oldReturn = owner.queryForObject(
            "SELECT cr.return_id FROM model_return_response_cycle_return cr JOIN model_return_response_cycle c ON c.id = cr.cycle_id WHERE c.application_id = ? AND c.cycle_seq = 1",
            UUID.class, id);
        int v = owner.queryForObject("SELECT version FROM model_application WHERE id = ?", Integer.class, id);
        iameService.run(IAME_CALLER, id, idemKey("0000000000000040"), json.readTree("{\"version\":" + v + ",\"verification\":\"verified\",\"note\":\"c1\"}"));
        wiredReturn(id, "bee_scrutiny", REVIEWER_USER, "reviewer", UUID.randomUUID().toString());
        UUID staleResub = owner.queryForObject("SELECT id FROM model_application_resubmission WHERE return_id = ? ORDER BY resubmitted_at DESC LIMIT 1", UUID.class, oldReturn);
        assertThrows(DataAccessException.class, () -> tx.executeWithoutResult(s -> wiring.afterResubmit(
            id, oldReturn, staleResub, "bee_scrutiny", Instant.now(), REASON, "bee_scrutiny", "stale", Instant.now(), NOVA_USER, "manufacturer",
            UUID.randomUUID().toString())));
    }

    @Test
    void currentCycleLatestReturnResubmitsNormally() throws Exception {
        UUID id = atIame("WP02B2A-CURR-" + TAG);
        wiredReturn(id, "iame_scrutiny", IAME_USER, "iame", UUID.randomUUID().toString());
        int version = owner.queryForObject("SELECT version FROM model_application WHERE id = ?", Integer.class, id);
        assertEquals(HttpStatus.OK, resubmitService.run(MANUFACTURER, id, idemKey("0000000000000041"), json.readTree("{\"version\":" + version + "}")).getStatusCode());
    }

    @Test
    void stalePreResubmitForwardEventCannotCloseCurrentCycle() {
        UUID id = atIame("WP02B2A-STALE-" + TAG);
        returnResubmitAt(id, "iame_scrutiny", IAME_USER, "iame");
        int v = owner.queryForObject("SELECT version FROM model_application WHERE id = ?", Integer.class, id);
        var resumeAt = owner.queryForObject(
            "SELECT max(e.occurred_at) FROM workflow_sla_clock_event e JOIN workflow_sla_clock cl ON cl.id = e.clock_id "
                + "JOIN model_return_response_cycle c ON c.task_id = cl.task_id WHERE c.application_id = ? AND e.event_kind = 'resume'",
            java.sql.Timestamp.class, id);
        UUID staleEvent = UUID.randomUUID();
        java.sql.Timestamp staleAt = new java.sql.Timestamp(resumeAt.getTime() - 2 * 3600_000L);
        owner.update(
            "INSERT INTO model_application_transition_event (id, application_id, action, from_state, to_state, version_after, actor_account_id, actor_role, occurred_at) "
                + "VALUES (?, ?, 'iame_recommend', 'iame_scrutiny', 'bee_scrutiny', ?, ?, 'iame', ?)",
            staleEvent, id, v + 1, IAME_USER, staleAt);
        owner.update("UPDATE model_application SET state = 'bee_scrutiny', version = ? WHERE id = ?", v + 1, id);
        assertThrows(DataAccessException.class, () -> wiring.afterAcceptedForward(
            id, staleEvent, IameRecommendationRepository.ACTION, IameRecommendationRepository.FROM_STATE, IameRecommendationRepository.TO_STATE,
            v + 1, IAME_USER, "iame", Instant.now(), UUID.randomUUID().toString()));
        assertEquals("open", owner.queryForObject("SELECT status FROM model_return_response_cycle WHERE application_id = ? AND status = 'open'", String.class, id));
    }

    @Test
    void rejectionOrReturnTransitionCannotCloseCycleAsAccepted() {
        UUID id = atIame("WP02B2A-REJ-" + TAG);
        returnResubmitAt(id, "iame_scrutiny", IAME_USER, "iame");
        var retTe = owner.queryForMap(
            "SELECT e.id, e.version_after, e.occurred_at FROM model_application_transition_event e "
                + "JOIN model_application_return r ON r.transition_event_id = e.id WHERE r.application_id = ? ORDER BY e.occurred_at DESC LIMIT 1",
            id);
        assertThrows(DataAccessException.class, () -> wiring.afterAcceptedForward(
            id, (UUID) retTe.get("id"), "return", "iame_scrutiny", "returned", (Integer) retTe.get("version_after"), IAME_USER, "iame",
            ((java.sql.Timestamp) retTe.get("occurred_at")).toInstant(), UUID.randomUUID().toString()));
        UUID rejectApp = atIame("WP02B2A-REJ2-" + TAG);
        returnResubmitAt(rejectApp, "iame_scrutiny", IAME_USER, "iame");
        var rejectRepo = transactional(new StageRejectRepository(db));
        int version = owner.queryForObject("SELECT version FROM model_application WHERE id = ?", Integer.class, rejectApp);
        var rejected = rejectRepo.doReject(rejectApp, version, IAME_USER, "iame", "iame_scrutiny", "Permanent refusal.");
        assertEquals(StageRejectRepository.Outcome.REJECTED, rejected.outcome());
        var rejTe = owner.queryForMap(
            "SELECT e.id, e.version_after, e.occurred_at FROM model_application_transition_event e WHERE e.application_id = ? AND e.action = ? ORDER BY e.occurred_at DESC LIMIT 1",
            rejectApp, StageRejectRepository.ACTION);
        var rejectFailure = assertThrows(DataAccessException.class, () -> wiring.afterAcceptedForward(
            rejectApp, (UUID) rejTe.get("id"), StageRejectRepository.ACTION, "iame_scrutiny", StageRejectRepository.TO_STATE,
            (Integer) rejTe.get("version_after"), IAME_USER, "iame", ((java.sql.Timestamp) rejTe.get("occurred_at")).toInstant(), UUID.randomUUID().toString()));
        assertTrue(sqlMessage(rejectFailure).contains("model_return_response_forward_action_refused"));
    }

    @Test
    void forgedForwardTimestampCannotChangeAuditOrClockTime() {
        UUID id = atIame("WP02B2A-FORGE-T-" + TAG);
        returnResubmitAt(id, "iame_scrutiny", IAME_USER, "iame");
        int v = owner.queryForObject("SELECT version FROM model_application WHERE id = ?", Integer.class, id);
        var done = iameRepo.recommend(id, v, IAME_USER, "iame", "verified", "n");
        Instant forged = done.recommendedAt().plusSeconds(86400);
        wiring.afterAcceptedForward(id, done.transitionEventId(), IameRecommendationRepository.ACTION, IameRecommendationRepository.FROM_STATE,
            IameRecommendationRepository.TO_STATE, done.versionAfter(), IAME_USER, "iame", forged, idemKey("0000000000000042"));
        var closedAt = owner.queryForObject("SELECT closed_at FROM model_return_response_cycle WHERE application_id = ? AND cycle_seq = 1", java.sql.Timestamp.class, id);
        assertEquals(done.recommendedAt(), closedAt.toInstant());
        UUID task = owner.queryForObject("SELECT task_id FROM model_return_response_cycle WHERE application_id = ? AND cycle_seq = 1", UUID.class, id);
        var stopAt = owner.queryForObject(
            "SELECT e.occurred_at FROM workflow_sla_clock_event e JOIN workflow_sla_clock cl ON cl.id = e.clock_id WHERE cl.task_id = ? AND e.event_kind = 'stop' ORDER BY e.occurred_at DESC LIMIT 1",
            java.sql.Timestamp.class, task);
        assertTrue(stopAt.toInstant().isBefore(forged));
    }

    @Test
    void allAllowedForwardMappingsStillCloseNormally() throws Exception {
        UUID id = atIame("WP02B2A-MAP-" + TAG);
        returnResubmitAt(id, "iame_scrutiny", IAME_USER, "iame");
        int v = owner.queryForObject("SELECT version FROM model_application WHERE id = ?", Integer.class, id);
        iameService.run(IAME_CALLER, id, idemKey("0000000000000043"), json.readTree("{\"version\":" + v + ",\"verification\":\"verified\",\"note\":\"m1\"}"));
        returnResubmitAt(id, "bee_scrutiny", REVIEWER_USER, "reviewer");
        v = owner.queryForObject("SELECT version FROM model_application WHERE id = ?", Integer.class, id);
        reviewerService.run(REVIEWER_CALLER, id, idemKey("0000000000000044"), json.readTree("{\"version\":" + v + ",\"note\":\"m2\"}"));
        UUID idDir = atDirector("WP02B2A-MAP2-" + TAG);
        returnResubmitAt(idDir, "director_review", DIRECTOR_USER, "director");
        v = owner.queryForObject("SELECT version FROM model_application WHERE id = ?", Integer.class, idDir);
        directorService.run(DIRECTOR_CALLER, idDir, idemKey("0000000000000045"), json.readTree("{\"version\":" + v + ",\"note\":\"m3\"}"));
        directorRepo.recommend(idDir, owner.queryForObject("SELECT version FROM model_application WHERE id = ?", Integer.class, idDir), DIRECTOR_USER, "director", "n", false);
        returnResubmitAt(idDir, "secretary_approval", DIRECTOR_USER, "director");
        v = owner.queryForObject("SELECT version FROM model_application WHERE id = ?", Integer.class, idDir);
        secretaryService.run(SECRETARY_CALLER, idDir, idemKey("0000000000000046"), json.readTree("{\"version\":" + v + ",\"note\":\"m4\"}"));
        assertEquals(0, owner.queryForObject("SELECT count(*) FROM model_return_response_cycle WHERE application_id = ? AND status = 'open'", Integer.class, idDir));
    }

    @Test
    void duplicateCycleSeqTaskOrDiscrepancyRefused() throws Exception {
        UUID id = atIame("WP02B2A-UNIQ-" + TAG);
        returnResubmitAt(id, "iame_scrutiny", IAME_USER, "iame");
        int v = owner.queryForObject("SELECT version FROM model_application WHERE id = ?", Integer.class, id);
        iameService.run(IAME_CALLER, id, idemKey("0000000000000048"), json.readTree("{\"version\":" + v + ",\"verification\":\"verified\",\"note\":\"close\"}"));
        var closed = owner.queryForMap("SELECT application_id, review_stage, task_id, discrepancy_id, cycle_seq, closed_at, closure_transition_event_id, "
            + "closure_from_state, closure_to_state FROM model_return_response_cycle WHERE application_id = ? AND cycle_seq = 1", id);
        var dupSeq = assertThrows(DataAccessException.class, () -> owner.update(
            "INSERT INTO model_return_response_cycle (application_id, review_stage, task_id, discrepancy_id, cycle_seq, status, closed_at, "
                + "closure_transition_event_id, closure_from_state, closure_to_state) VALUES (?, ?, ?, ?, ?, 'closed', ?, ?, ?, ?)",
            closed.get("application_id"), closed.get("review_stage"), UUID.randomUUID(), UUID.randomUUID(), closed.get("cycle_seq"),
            closed.get("closed_at"), closed.get("closure_transition_event_id"), closed.get("closure_from_state"), closed.get("closure_to_state")));
        assertEquals("23505", sqlState(dupSeq));
        assertTrue(sqlMessage(dupSeq).contains("model_return_response_cycle_application_id_cycle_seq_key"));
        var dupTask = assertThrows(DataAccessException.class, () -> owner.update(
            "INSERT INTO model_return_response_cycle (application_id, review_stage, task_id, discrepancy_id, cycle_seq, status, closed_at, "
                + "closure_transition_event_id, closure_from_state, closure_to_state) VALUES (?, ?, ?, ?, 99, 'closed', ?, ?, ?, ?)",
            closed.get("application_id"), closed.get("review_stage"), closed.get("task_id"), UUID.randomUUID(), closed.get("closed_at"),
            closed.get("closure_transition_event_id"), closed.get("closure_from_state"), closed.get("closure_to_state")));
        assertEquals("23505", sqlState(dupTask));
        assertTrue(sqlMessage(dupTask).contains("model_return_response_cycle_task_id_key"));
        var dupDisc = assertThrows(DataAccessException.class, () -> owner.update(
            "INSERT INTO model_return_response_cycle (application_id, review_stage, task_id, discrepancy_id, cycle_seq, status, closed_at, "
                + "closure_transition_event_id, closure_from_state, closure_to_state) VALUES (?, ?, ?, ?, 99, 'closed', ?, ?, ?, ?)",
            closed.get("application_id"), closed.get("review_stage"), UUID.randomUUID(), closed.get("discrepancy_id"), closed.get("closed_at"),
            closed.get("closure_transition_event_id"), closed.get("closure_from_state"), closed.get("closure_to_state")));
        assertEquals("23505", sqlState(dupDisc));
        assertTrue(sqlMessage(dupDisc).contains("model_return_response_cycle_discrepancy_id_key"));
    }

    @Test
    void incompleteOpenOrClosedCycleLifecycleRefused() {
        UUID id = atIame("WP02B2B-LIFE-" + TAG);
        wiredReturn(id, "iame_scrutiny", IAME_USER, "iame", UUID.randomUUID().toString());
        var row = owner.queryForMap("SELECT application_id, review_stage, task_id, discrepancy_id, cycle_seq FROM model_return_response_cycle WHERE application_id = ?", id);
        var incompleteClosed = assertThrows(DataAccessException.class, () -> owner.update(
            "INSERT INTO model_return_response_cycle (application_id, review_stage, task_id, discrepancy_id, cycle_seq, status) VALUES (?, ?, ?, ?, 99, 'closed')",
            row.get("application_id"), row.get("review_stage"), UUID.randomUUID(), UUID.randomUUID()));
        assertEquals("23514", sqlState(incompleteClosed));
        assertTrue(sqlMessage(incompleteClosed).contains("model_return_response_cycle_lifecycle_check"));
        var openWithClosure = assertThrows(DataAccessException.class, () -> owner.update(
            "UPDATE model_return_response_cycle SET closure_from_state = 'iame_scrutiny' WHERE application_id = ? AND status = 'open'", id));
        assertTrue(sqlMessage(openWithClosure).contains("model_return_response_cycle_lifecycle_check")
            || sqlMessage(openWithClosure).contains("model_return_response_cycle_closed_immutable"));
    }

    @Test
    void concurrentChangedForwardPayloadHasOneWinnerAndOneConflict() throws Exception {
        UUID id = atIame("WP02B2A-CONC-PAY-" + TAG);
        returnResubmitAt(id, "iame_scrutiny", IAME_USER, "iame");
        int v = owner.queryForObject("SELECT version FROM model_application WHERE id = ?", Integer.class, id);
        String idem = idemKey("0000000000000047");
        var first = json.readTree("{\"version\":" + v + ",\"verification\":\"verified\",\"note\":\"a\"}");
        var second = json.readTree("{\"version\":" + v + ",\"verification\":\"verified\",\"note\":\"b\"}");
        ExecutorService pool = Executors.newFixedThreadPool(2);
        CountDownLatch start = new CountDownLatch(1);
        Future<?> a = pool.submit(() -> {
            start.await(5, TimeUnit.SECONDS);
            return iameService.run(IAME_CALLER, id, idem, first);
        });
        Future<?> b = pool.submit(() -> {
            start.await(5, TimeUnit.SECONDS);
            return iameService.run(IAME_CALLER, id, idem, second);
        });
        start.countDown();
        pool.shutdown();
        assertTrue(pool.awaitTermination(30, TimeUnit.SECONDS));
        int ok = 0;
        int conflict = 0;
        for (Future<?> f : List.of(a, b)) {
            @SuppressWarnings("unchecked")
            var res = (org.springframework.http.ResponseEntity<java.util.Map<String, Object>>) f.get();
            if (res.getStatusCode().is2xxSuccessful()) {
                ok++;
            } else if (HttpStatus.CONFLICT.equals(res.getStatusCode())) {
                conflict++;
            }
        }
        assertEquals(1, ok);
        assertEquals(1, conflict);
        assertNoExtraForwardClosureSurvivors(id);
        assertEquals(0, owner.queryForObject(
            "SELECT count(*) FROM idempotency_record WHERE target_record_id = ? AND idempotency_key = ? AND in_progress",
            Integer.class, id, idem));
    }

    @Test
    void runtimeHighLevelClosureRejectsStaleRejectionAndWrongCycleInputs() {
        UUID id = atIame("WP02B2A-RT-" + TAG);
        returnResubmitAt(id, "iame_scrutiny", IAME_USER, "iame");
        int v = owner.queryForObject("SELECT version FROM model_application WHERE id = ?", Integer.class, id);
        var done = iameRepo.recommend(id, v, IAME_USER, "iame", "verified", "n");
        wiring.afterAcceptedForward(id, done.transitionEventId(), IameRecommendationRepository.ACTION, IameRecommendationRepository.FROM_STATE,
            IameRecommendationRepository.TO_STATE, done.versionAfter(), IAME_USER, "iame", done.recommendedAt(), idemKey("0000000000000048"));
        UUID cycle1Event = done.transitionEventId();
        wiredReturn(id, "bee_scrutiny", REVIEWER_USER, "reviewer", UUID.randomUUID().toString());
        wiredResubmit(id, UUID.randomUUID().toString(), "cycle2");
        int vAfter = owner.queryForObject("SELECT version FROM model_application WHERE id = ?", Integer.class, id);
        int transitionsBefore = owner.queryForObject("SELECT count(*) FROM model_application_transition_event WHERE application_id = ?", Integer.class, id);
        assertThrows(DataAccessException.class, () -> db.query(
            "SELECT model_return_response_orchestrate_forward_closure(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", rs -> {
            }, id, cycle1Event, ReviewerForwardRepository.ACTION, ReviewerForwardRepository.FROM_STATE, ReviewerForwardRepository.TO_STATE,
            vAfter + 1, REVIEWER_USER, "reviewer", UUID.randomUUID(), "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcd"));
        var retTe = owner.queryForMap(
            "SELECT e.id, e.version_after, e.occurred_at FROM model_application_transition_event e WHERE e.application_id = ? AND e.action = 'return' ORDER BY e.occurred_at DESC LIMIT 1", id);
        assertThrows(DataAccessException.class, () -> db.query(
            "SELECT model_return_response_orchestrate_forward_closure(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", rs -> {
            }, id, retTe.get("id"), ReviewerForwardRepository.ACTION, ReviewerForwardRepository.FROM_STATE, ReviewerForwardRepository.TO_STATE,
            retTe.get("version_after"), REVIEWER_USER, "reviewer", UUID.randomUUID(), "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcd"));
        assertEquals(transitionsBefore, owner.queryForObject("SELECT count(*) FROM model_application_transition_event WHERE application_id = ?", Integer.class, id));
        assertEquals(1, owner.queryForObject("SELECT count(*) FROM model_return_response_cycle WHERE application_id = ? AND status = 'closed'", Integer.class, id));
        assertEquals(1, owner.queryForObject("SELECT count(*) FROM model_return_response_cycle WHERE application_id = ? AND status = 'open'", Integer.class, id));
        assertEquals(1, owner.queryForObject("SELECT count(*) FROM model_return_response_wiring_evidence WHERE application_id = ? AND purpose = 'forward_closure'", Integer.class, id));
        assertEquals(0, owner.queryForObject(
            "SELECT count(*) FROM workflow_discrepancy_disposition d JOIN model_return_response_cycle c ON c.discrepancy_id = d.discrepancy_id "
                + "WHERE c.application_id = ? AND c.status = 'open' AND d.outcome = 'accepted'",
            Integer.class, id));
    }

    @Test
    void runtimeCannotExecuteCycleReturnBindingHelper() {
        UUID id = atIame("WP02B2B-BIND-PRIV-" + TAG);
        wiredReturn(id, "iame_scrutiny", IAME_USER, "iame", UUID.randomUUID().toString());
        UUID cycle = owner.queryForObject("SELECT id FROM model_return_response_cycle WHERE application_id = ?", UUID.class, id);
        UUID returnId = UUID.randomUUID();
        assertFalse(owner.queryForObject(
            "SELECT has_function_privilege(?, ? || '.model_return_response_bind_cycle_return(uuid, uuid)', 'EXECUTE')",
            Boolean.class, runtimeRole(), MAIN));
        assertThrows(DataAccessException.class, () -> db.query("SELECT model_return_response_bind_cycle_return(?, ?)", rs -> {
        }, cycle, returnId));
    }

    @Test
    void closedCycleCannotReceiveReturnBindingThroughInternalHelper() {
        UUID id = atIame("WP02B2B-BIND-CLOSED-" + TAG);
        returnResubmitAt(id, "iame_scrutiny", IAME_USER, "iame");
        int v = owner.queryForObject("SELECT version FROM model_application WHERE id = ?", Integer.class, id);
        iameRepo.recommend(id, v, IAME_USER, "iame", "verified", "n");
        var te = owner.queryForMap("SELECT id, version_after, occurred_at FROM model_application_transition_event WHERE application_id = ? ORDER BY occurred_at DESC LIMIT 1", id);
        wiring.afterAcceptedForward(id, (UUID) te.get("id"), IameRecommendationRepository.ACTION, IameRecommendationRepository.FROM_STATE,
            IameRecommendationRepository.TO_STATE, (Integer) te.get("version_after"), IAME_USER, "iame", ((java.sql.Timestamp) te.get("occurred_at")).toInstant(),
            idemKey("0000000000000049"));
        UUID closedCycle = owner.queryForObject("SELECT id FROM model_return_response_cycle WHERE application_id = ? AND cycle_seq = 1", UUID.class, id);
        UUID extraReturn = UUID.randomUUID();
        var failure = assertThrows(DataAccessException.class, () -> owner.query("SELECT model_return_response_bind_cycle_return(?, ?)", rs -> {
        }, closedCycle, extraReturn));
        assertTrue(sqlMessage(failure).contains("model_return_response_return_cycle_bind_invalid"));
        assertEquals(1, owner.queryForObject("SELECT count(*) FROM model_return_response_cycle_return WHERE cycle_id = ?", Integer.class, closedCycle));
    }

    @Test
    void runtimeExecuteListContainsOnlyDocumentedHighLevelCommands() {
        var allowed = owner.queryForList(
            "SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace "
                + "WHERE n.nspname = ? AND p.proname LIKE 'model_return_response_%' AND p.prosecdef "
                + "AND has_function_privilege(?, p.oid, 'EXECUTE') ORDER BY 1",
            String.class, MAIN, runtimeRole());
        assertEquals(
            List.of(
                "model_return_response_orchestrate_forward_closure",
                "model_return_response_orchestrate_resubmit",
                "model_return_response_orchestrate_wired_return"),
            allowed);
    }

    @Test
    void reReturnBeforeAcceptedForwardContinuesSameOpenCycle() {
        UUID id = atIame("WP02B2F-RERET-" + TAG);
        wiredReturn(id, "iame_scrutiny", IAME_USER, "iame", UUID.randomUUID().toString());
        wiredResubmit(id, UUID.randomUUID().toString(), "first");
        UUID task = openTask(id);
        wiredReturn(id, "iame_scrutiny", IAME_USER, "iame", UUID.randomUUID().toString());
        assertEquals(task, openTask(id));
        assertEquals(1, owner.queryForObject("SELECT count(*) FROM model_return_response_cycle WHERE application_id = ?", Integer.class, id));
        assertEquals(1, owner.queryForObject("SELECT count(*) FROM workflow_task WHERE subject_id = ? AND action = 'review'", Integer.class, id));
        assertEquals("needs_more", owner.queryForObject(
            "SELECT outcome FROM workflow_discrepancy_disposition d JOIN model_return_response_cycle c ON c.discrepancy_id = d.discrepancy_id WHERE c.application_id = ? LIMIT 1",
            String.class, id));
    }

}
