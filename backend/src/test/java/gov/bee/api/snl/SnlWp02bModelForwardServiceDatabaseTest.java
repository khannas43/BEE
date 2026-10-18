package gov.bee.api.snl;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import gov.bee.api.application.IdempotencyRepository;
import java.util.UUID;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;

/** Spring-proxied stage-forward services: real 409 rollback proofs (Brief 19B-2A section 4). */
@Tag("db")
class SnlWp02bModelForwardServiceDatabaseTest extends SnlWp02bModelForwardClosureDatabaseTest {

    @Test
    void serviceForwardClosureConflictReturns409AndRollsBackAssignment() throws Exception {
        UUID id = atIame("WP02B2A-SVC-FWD-" + TAG);
        returnResubmitAt(id, "iame_scrutiny", IAME_USER, "iame");
        int v = owner.queryForObject("SELECT version FROM model_application WHERE id = ?", Integer.class, id);
        String idem = idemKey("0000000000000050");
        var idempotencyRepo = new IdempotencyRepository(db);
        String route = "/api/model-applications/{id}/iame-recommendation";
        idempotencyRepo.begin(IAME_USER, "POST", route, id, idem, new byte[] {2});
        idempotencyRepo.complete(IAME_USER, "POST", route, id, idem, 200, "{}", v);
        var body = json.readTree("{\"version\":" + v + ",\"verification\":\"verified\",\"note\":\"ok\"}");
        var res = iameService.run(IAME_CALLER, id, idem, body);
        assertEquals(HttpStatus.CONFLICT, res.getStatusCode());
        assertEquals("idempotency_key_conflict", res.getBody().get("error"));
        assertEquals("iame_scrutiny", owner.queryForObject("SELECT state FROM model_application WHERE id = ?", String.class, id));
        assertEquals("open", owner.queryForObject("SELECT status FROM model_return_response_cycle WHERE application_id = ? AND status = 'open'", String.class, id));
        assertEquals(0, owner.queryForObject(
            "SELECT count(*) FROM assignment WHERE subject_id = ? AND stage = 'bee_scrutiny' AND active = true", Integer.class, id));
    }

    @Test
    void serviceFinalApprovalClosureConflictReturns409AndRollsBackCertificate() throws Exception {
        UUID id = atDirector("WP02B2A-SVC-SEC-" + TAG);
        directorRepo.recommend(id, owner.queryForObject("SELECT version FROM model_application WHERE id = ?", Integer.class, id), DIRECTOR_USER, "director", "n", false);
        returnResubmitAt(id, "secretary_approval", DIRECTOR_USER, "director");
        int v = owner.queryForObject("SELECT version FROM model_application WHERE id = ?", Integer.class, id);
        String idem = idemKey("0000000000000051");
        var idempotencyRepo = new IdempotencyRepository(db);
        String route = "/api/model-applications/{id}/secretary-approval";
        idempotencyRepo.begin(SECRETARY_USER, "POST", route, id, idem, new byte[] {1});
        idempotencyRepo.complete(SECRETARY_USER, "POST", route, id, idem, 200, "{}", v);
        var body = json.readTree("{\"version\":" + v + ",\"note\":\"approve\"}");
        var res = secretaryService.run(SECRETARY_CALLER, id, idem, body);
        assertEquals(HttpStatus.CONFLICT, res.getStatusCode());
        assertEquals("idempotency_key_conflict", res.getBody().get("error"));
        assertEquals("secretary_approval", owner.queryForObject("SELECT state FROM model_application WHERE id = ?", String.class, id));
        assertEquals(0, owner.queryForObject("SELECT count(*) FROM certificate WHERE application_id = ?", Integer.class, id));
        assertEquals("open", owner.queryForObject("SELECT status FROM model_return_response_cycle WHERE application_id = ? AND status = 'open'", String.class, id));
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
