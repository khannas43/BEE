package gov.bee.api.snl;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import gov.bee.api.application.IdempotencyRepository;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;

/** Spring-proxied return/resubmit services against throwaway PostgreSQL (Brief 19B-B section 4 and 6). */
@Tag("db")
class SnlWp02bModelReturnServiceDatabaseTest extends SnlWp02bModelReturnWiringDatabaseTest {

    @Test
    void serviceAssigneeUnavailableReturns409AndRollsBackEverything() throws Exception {
        UUID id = atIame("WP02B2-SVC-ASSIGN-" + TAG);
        wiredReturn(id, "iame_scrutiny", IAME_USER, "iame", UUID.randomUUID().toString());
        owner.update("UPDATE assignment SET active = false WHERE subject_id = ? AND stage = 'iame_scrutiny'", id);
        int version = owner.queryForObject("SELECT version FROM model_application WHERE id = ?", Integer.class, id);
        var body = json.readTree("{\"version\":" + version + "}");
        var res = resubmitService.run(MANUFACTURER, id, "0123456789abcdef0123456789ab", body);
        assertEquals(HttpStatus.CONFLICT, res.getStatusCode(), String.valueOf(res.getBody()));
        assertEquals("assignee_unavailable", res.getBody().get("error"));
        assertEquals("returned", owner.queryForObject("SELECT state FROM model_application WHERE id = ?", String.class, id));
        assertEquals(0, owner.queryForObject(
            "SELECT count(*) FROM workflow_discrepancy_response r JOIN model_return_response_cycle c ON c.discrepancy_id = r.discrepancy_id WHERE c.application_id = ?",
            Integer.class, id));
    }

    @Test
    void serviceWiringConflictReturns409AndRollsBackEverything() throws Exception {
        UUID id = atIame("WP02B2-SVC-CONFLICT-" + TAG);
        String idem = idemKey("0000000000000002");
        int version = owner.queryForObject("SELECT version FROM model_application WHERE id = ?", Integer.class, id);
        var ok = json.readTree("{\"version\":" + version + ",\"reason\":\"" + REASON + "\"}");
        var idempotencyRepo = new IdempotencyRepository(db);
        String route = "/api/model-applications/{id}/return";
        idempotencyRepo.begin(IAME_USER, "POST", route, id, idem, new byte[] {9});
        idempotencyRepo.complete(IAME_USER, "POST", route, id, idem, 200, "{}", version);
        var res = stageReturnService.run(IAME_CALLER, id, idem, ok);
        assertEquals(HttpStatus.CONFLICT, res.getStatusCode());
        assertEquals("idempotency_key_conflict", res.getBody().get("error"));
        assertEquals("iame_scrutiny", owner.queryForObject("SELECT state FROM model_application WHERE id = ?", String.class, id));
        assertEquals(0, owner.queryForObject("SELECT count(*) FROM model_application_return WHERE application_id = ?", Integer.class, id));
    }

    @Test
    void serviceInjectedMidWorkflowFailureRollsBackEverything() throws Exception {
        UUID id = atIame("WP02B2-SVC-INJECT-" + TAG);
        WorkflowReturnResponseWiring.testMidWiringFailureHook = () -> {
            throw new IllegalStateException("test_mid_wiring_failure");
        };
        try {
            int version = owner.queryForObject("SELECT version FROM model_application WHERE id = ?", Integer.class, id);
            var body = json.readTree("{\"version\":" + version + ",\"reason\":\"" + REASON + "\"}");
            assertThrows(IllegalStateException.class, () -> stageReturnService.run(IAME_CALLER, id, idemKey("0000000000000003"), body));
            assertEquals("iame_scrutiny", owner.queryForObject("SELECT state FROM model_application WHERE id = ?", String.class, id));
            assertEquals(0, owner.queryForObject("SELECT count(*) FROM model_application_return WHERE application_id = ?", Integer.class, id));
        } finally {
            WorkflowReturnResponseWiring.testMidWiringFailureHook = null;
        }
    }

    @Test
    void concurrentServiceReturnCreatesOneCompleteOutcome() throws Exception {
        UUID id = atIame("WP02B2-CONC-RET-" + TAG);
        int version = owner.queryForObject("SELECT version FROM model_application WHERE id = ?", Integer.class, id);
        String idem = idemKey("0000000000000004");
        var body = json.readTree("{\"version\":" + version + ",\"reason\":\"" + REASON + "\"}");
        ExecutorService pool = Executors.newFixedThreadPool(2);
        CountDownLatch start = new CountDownLatch(1);
        Future<?> a = pool.submit(() -> {
            start.await(5, TimeUnit.SECONDS);
            return stageReturnService.run(IAME_CALLER, id, idem, body);
        });
        Future<?> b = pool.submit(() -> {
            start.await(5, TimeUnit.SECONDS);
            return stageReturnService.run(IAME_CALLER, id, idem, body);
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
        assertEquals(1, owner.queryForObject("SELECT count(*) FROM model_application_return WHERE application_id = ?", Integer.class, id));
        pool.shutdownNow();
    }

    @Test
    void concurrentServiceResubmitCreatesOneCompleteOutcome() throws Exception {
        UUID id = atIame("WP02B2-CONC-RESUB-" + TAG);
        wiredReturn(id, "iame_scrutiny", IAME_USER, "iame", idemKey("0000000000000005"));
        int version = owner.queryForObject("SELECT version FROM model_application WHERE id = ?", Integer.class, id);
        String idem = idemKey("0000000000000006");
        var body = json.readTree("{\"version\":" + version + "}");
        ExecutorService pool = Executors.newFixedThreadPool(2);
        CountDownLatch start = new CountDownLatch(1);
        Future<?> a = pool.submit(() -> {
            start.await(5, TimeUnit.SECONDS);
            return resubmitService.run(MANUFACTURER, id, idem, body);
        });
        Future<?> b = pool.submit(() -> {
            start.await(5, TimeUnit.SECONDS);
            return resubmitService.run(MANUFACTURER, id, idem, body);
        });
        start.countDown();
        pool.shutdown();
        assertTrue(pool.awaitTermination(30, TimeUnit.SECONDS));
        assertEquals(1, owner.queryForObject("SELECT count(*) FROM model_application_resubmission WHERE application_id = ?", Integer.class, id));
        assertEquals(1, owner.queryForObject(
            "SELECT count(*) FROM workflow_discrepancy_response r JOIN model_return_response_cycle c ON c.discrepancy_id = r.discrepancy_id WHERE c.application_id = ?",
            Integer.class, id));
        pool.shutdownNow();
    }

    @Test
    void concurrentChangedPayloadHasOneWinnerAndOneConflict() throws Exception {
        UUID id = atIame("WP02B2-CONC-PAYLOAD-" + TAG);
        int version = owner.queryForObject("SELECT version FROM model_application WHERE id = ?", Integer.class, id);
        String idem = idemKey("0000000000000007");
        var first = json.readTree("{\"version\":" + version + ",\"reason\":\"" + REASON + "\"}");
        var second = json.readTree("{\"version\":" + version + ",\"reason\":\"Another reason entirely.\"}");
        ExecutorService pool = Executors.newFixedThreadPool(2);
        CountDownLatch start = new CountDownLatch(1);
        Future<?> a = pool.submit(() -> {
            start.await(5, TimeUnit.SECONDS);
            return stageReturnService.run(IAME_CALLER, id, idem, first);
        });
        Future<?> b = pool.submit(() -> {
            start.await(5, TimeUnit.SECONDS);
            return stageReturnService.run(IAME_CALLER, id, idem, second);
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
        assertEquals(1, owner.queryForObject("SELECT count(*) FROM model_application_return WHERE application_id = ?", Integer.class, id));
        pool.shutdownNow();
    }
}
