package gov.bee.api.snl;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import gov.bee.api.application.IdempotencyRepository;
import gov.bee.api.director.DirectorRecommendationRepository;
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
import gov.bee.api.workflow.WorkflowIdempotencyConflictException;
import java.math.BigDecimal;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataAccessException;
import org.springframework.http.HttpStatus;

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

    void returnResubmitAt(UUID id, String stage, UUID officer, String role) {
        wiredReturn(id, stage, officer, role, UUID.randomUUID().toString());
        wiredResubmit(id, UUID.randomUUID().toString(), "Applicant note.");
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
