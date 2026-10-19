package gov.bee.api.snl;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import gov.bee.api.iame.IameRecommendationRepository;
import java.util.UUID;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;

/** Spring-proxied stage-forward services: real post-legacy 409 rollback proofs (Brief 19B-2B section 2). */
@Tag("db")
class SnlWp02bModelForwardServiceDatabaseTest extends SnlWp02bModelForwardClosureDatabaseTest {

    static final String IAME_ROUTE = "/api/model-applications/{id}/iame-recommendation";
    static final String SECRETARY_ROUTE = "/api/model-applications/{id}/secretary-approval";

    void seedForwardClosureConflict(UUID applicationId, String idempotencyKey) {
        UUID wiringCommand = WorkflowReturnResponseWiring.commandId(idempotencyKey, "model_forward_closure", applicationId);
        owner.update(
            "INSERT INTO model_return_response_wiring_evidence (command_id, application_id, purpose, payload_hash) VALUES (?, ?, 'forward_closure', repeat('b', 64))",
            wiringCommand, applicationId);
    }

    int idempotencyRows(UUID accountId, String route, UUID appId, String idem) {
        return owner.queryForObject(
            "SELECT count(*) FROM idempotency_record WHERE account_id = ? AND http_method = 'POST' AND route_template = ? AND target_record_id = ? AND idempotency_key = ?",
            Integer.class, accountId, route, appId, idem);
    }

    int forwardClosureBundleRows(UUID id) {
        return owner.queryForObject(
            "SELECT (SELECT count(*) FROM model_application_transition_event WHERE application_id = ? AND action = ?)"
                + " + (SELECT count(*) FROM workflow_discrepancy_disposition d JOIN model_return_response_cycle c ON c.discrepancy_id = d.discrepancy_id "
                + "WHERE c.application_id = ? AND d.outcome = 'accepted')"
                + " + (SELECT count(*) FROM workflow_sla_clock_event e JOIN workflow_sla_clock cl ON cl.id = e.clock_id "
                + "JOIN model_return_response_cycle c ON c.task_id = cl.task_id WHERE c.application_id = ? AND e.event_kind = 'stop')"
                + " + (SELECT count(*) FROM workflow_task t JOIN model_return_response_cycle c ON c.task_id = t.id WHERE c.application_id = ? AND t.status = 'completed')"
                + " + (SELECT count(*) FROM model_return_response_cycle WHERE application_id = ? AND status = 'closed')",
            Integer.class, id, IameRecommendationRepository.ACTION, id, id, id, id);
    }

    @Test
    void serviceForwardClosureConflictReturns409AndRollsBackAssignment() throws Exception {
        UUID id = atIame("WP02B2B-SVC-FWD-" + TAG);
        returnResubmitAt(id, "iame_scrutiny", IAME_USER, "iame");
        int v = owner.queryForObject("SELECT version FROM model_application WHERE id = ?", Integer.class, id);
        int transitionsBefore = owner.queryForObject("SELECT count(*) FROM model_application_transition_event WHERE application_id = ?", Integer.class, id);
        int recsBefore = owner.queryForObject("SELECT count(*) FROM model_application_iame_recommendation WHERE application_id = ?", Integer.class, id);
        String idem = idemKey("0000000000000050");
        seedForwardClosureConflict(id, idem);
        var body = json.readTree("{\"version\":" + v + ",\"verification\":\"verified\",\"note\":\"ok\"}");
        var res = iameService.run(IAME_CALLER, id, idem, body);
        assertEquals(HttpStatus.CONFLICT, res.getStatusCode());
        assertEquals("idempotency_key_conflict", res.getBody().get("error"));
        assertEquals("iame_scrutiny", owner.queryForObject("SELECT state FROM model_application WHERE id = ?", String.class, id));
        assertEquals(v, owner.queryForObject("SELECT version FROM model_application WHERE id = ?", Integer.class, id));
        assertEquals(transitionsBefore, owner.queryForObject("SELECT count(*) FROM model_application_transition_event WHERE application_id = ?", Integer.class, id));
        assertEquals(recsBefore, owner.queryForObject("SELECT count(*) FROM model_application_iame_recommendation WHERE application_id = ?", Integer.class, id));
        assertEquals("open", owner.queryForObject("SELECT status FROM model_return_response_cycle WHERE application_id = ? AND status = 'open'", String.class, id));
        assertEquals(0, owner.queryForObject(
            "SELECT count(*) FROM assignment WHERE subject_id = ? AND stage = 'bee_scrutiny' AND active = true", Integer.class, id));
        assertEquals(0, forwardClosureBundleRows(id));
        assertEquals(1, owner.queryForObject(
            "SELECT count(*) FROM model_return_response_wiring_evidence WHERE application_id = ? AND purpose = 'forward_closure' AND payload_hash = repeat('b', 64)",
            Integer.class, id));
        assertEquals(0, idempotencyRows(IAME_USER, IAME_ROUTE, id, idem));
    }

    @Test
    void serviceFinalApprovalClosureConflictReturns409AndRollsBackCertificate() throws Exception {
        UUID id = atDirector("WP02B2B-SVC-SEC-" + TAG);
        directorRepo.recommend(id, owner.queryForObject("SELECT version FROM model_application WHERE id = ?", Integer.class, id), DIRECTOR_USER, "director", "n", false);
        returnResubmitAt(id, "secretary_approval", SECRETARY_USER, "director");
        int v = owner.queryForObject("SELECT version FROM model_application WHERE id = ?", Integer.class, id);
        int transitionsBefore = owner.queryForObject("SELECT count(*) FROM model_application_transition_event WHERE application_id = ?", Integer.class, id);
        int approvalsBefore = owner.queryForObject("SELECT count(*) FROM model_application_secretary_approval WHERE application_id = ?", Integer.class, id);
        String idem = idemKey("0000000000000051");
        seedForwardClosureConflict(id, idem);
        var body = json.readTree("{\"version\":" + v + ",\"note\":\"approve\"}");
        var res = secretaryService.run(SECRETARY_CALLER, id, idem, body);
        assertEquals(HttpStatus.CONFLICT, res.getStatusCode());
        assertEquals("idempotency_key_conflict", res.getBody().get("error"));
        assertEquals("secretary_approval", owner.queryForObject("SELECT state FROM model_application WHERE id = ?", String.class, id));
        assertEquals(v, owner.queryForObject("SELECT version FROM model_application WHERE id = ?", Integer.class, id));
        assertEquals(transitionsBefore, owner.queryForObject("SELECT count(*) FROM model_application_transition_event WHERE application_id = ?", Integer.class, id));
        assertEquals(approvalsBefore, owner.queryForObject("SELECT count(*) FROM model_application_secretary_approval WHERE application_id = ?", Integer.class, id));
        assertEquals(0, owner.queryForObject("SELECT count(*) FROM certificate WHERE application_id = ?", Integer.class, id));
        assertEquals("open", owner.queryForObject("SELECT status FROM model_return_response_cycle WHERE application_id = ? AND status = 'open'", String.class, id));
        assertEquals(0, owner.queryForObject(
            "SELECT count(*) FROM model_return_response_wiring_evidence WHERE application_id = ? AND purpose = 'forward_closure' AND payload_hash <> repeat('b', 64)",
            Integer.class, id));
        assertEquals(0, idempotencyRows(SECRETARY_USER, SECRETARY_ROUTE, id, idem));
    }

    @Test
    void serviceInjectedClosureFailureRollsBackCompleteBundle() throws Exception {
        UUID id = atIame("WP02B2A-SVC-INJ-" + TAG);
        returnResubmitAt(id, "iame_scrutiny", IAME_USER, "iame");
        WorkflowReturnResponseWiring.testMidWiringFailureHook = () -> {
            throw new IllegalStateException("test_mid_forward_closure_failure");
        };
        try {
            int v = owner.queryForObject("SELECT version FROM model_application WHERE id = ?", Integer.class, id);
            var body = json.readTree("{\"version\":" + v + ",\"verification\":\"verified\",\"note\":\"ok\"}");
            assertThrows(IllegalStateException.class, () -> iameService.run(IAME_CALLER, id, idemKey("0000000000000052"), body));
        } finally {
            WorkflowReturnResponseWiring.testMidWiringFailureHook = null;
        }
        assertEquals("iame_scrutiny", owner.queryForObject("SELECT state FROM model_application WHERE id = ?", String.class, id));
        assertEquals("open", owner.queryForObject("SELECT status FROM model_return_response_cycle WHERE application_id = ?", String.class, id));
        assertEquals(0, owner.queryForObject("SELECT count(*) FROM model_return_response_wiring_evidence WHERE application_id = ? AND purpose = 'forward_closure'", Integer.class, id));
    }
}
