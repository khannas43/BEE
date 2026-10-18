package gov.bee.api.snl;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import gov.bee.api.application.IdempotencyRepository;
import gov.bee.api.identity.Caller;
import gov.bee.api.identity.IdentityRepository.RoleGrant;
import gov.bee.api.masters.MasterDataRepository;
import gov.bee.api.registration.RegistrationFeeService;
import gov.bee.api.registration.RegistrationRepository;
import gov.bee.api.registration.RegistrationReviewService;
import gov.bee.api.registration.RegistrationService;
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
import org.springframework.aop.framework.ProxyFactory;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.transaction.annotation.AnnotationTransactionAttributeSource;
import org.springframework.transaction.interceptor.TransactionInterceptor;

/** Spring-proxied registration return/resubmit via {@link RegistrationReviewService} (Brief 19C-B). */
@Tag("db")
class SnlWp02cRegistrationReturnServiceDatabaseTest extends SnlWp02cRegistrationReturnWiringDatabaseTest {

    static RegistrationReviewService reviewService;
    static RegistrationService regService;
    static IdempotencyRepository idempotency;
    static final Caller PROGRAMME_CALLER = new Caller(PROGRAMME_USER, "prog", List.of(new RoleGrant("programme", "all")), Set.of());
    static final Caller DIRECTOR_CALLER = new Caller(DIRECTOR_USER, "dir", List.of(new RoleGrant("director", "all")), Set.of());
    static final Caller NOVA_CALLER = new Caller(NOVA_USER, "nova", List.of(new RoleGrant("manufacturer", "own-org")), Set.of(NOVA_ORG));

    @SuppressWarnings("unchecked")
    static <T> T transactionalReview(T target) {
        ProxyFactory factory = new ProxyFactory(target);
        factory.setProxyTargetClass(true);
        factory.addAdvice(new TransactionInterceptor(new DataSourceTransactionManager(runtime), new AnnotationTransactionAttributeSource()));
        return (T) factory.getProxy();
    }

    @BeforeAll
    static void reviewService() {
        idempotency = transactionalReview(new IdempotencyRepository(db));
        regService = new RegistrationService(registrations, new MasterDataRepository(db), idempotency, json);
        var registrationWiring = new RegistrationReturnResponseWiring(wiringRepo, policyRepo);
        reviewService = transactionalReview(new RegistrationReviewService(registrations, regService, registrationWiring, idempotency, json));
    }

    static String idemKey(String suffix) {
        return ("0123456789abcdef" + suffix).substring(0, 32);
    }

    void programmeReturn(UUID id, String idem) {
        int version = owner.queryForObject("SELECT version FROM registration_application WHERE id = ?", Integer.class, id);
        var res = reviewService.transition(PROGRAMME_CALLER, id, idem, parse("{\"action\":\"return\",\"version\":" + version + ",\"note\":\"" + REASON + "\"}"));
        assertEquals(HttpStatus.OK, res.getStatusCode(), String.valueOf(res.getBody()));
    }

    void resubmit(UUID id, String idem) {
        int version = owner.queryForObject("SELECT version FROM registration_application WHERE id = ?", Integer.class, id);
        var res = reviewService.transition(NOVA_CALLER, id, idem, parse("{\"action\":\"resubmit\",\"version\":" + version + "}"));
        assertEquals(HttpStatus.OK, res.getStatusCode(), String.valueOf(res.getBody()));
    }

    @Test
    void programmeReturnSuccess() {
        UUID id = atProgrammeReview("WP02C-SVC-PROG-" + TAG);
        programmeReturn(id, UUID.randomUUID().toString());
        assertEquals(1, owner.queryForObject("SELECT count(*) FROM registration_application_return WHERE application_id = ?", Integer.class, id));
        assertEquals("returned", owner.queryForObject("SELECT state FROM registration_application WHERE id = ?", String.class, id));
    }

    @Test
    void directorReturnSuccess() {
        UUID id = atDirectorReview("WP02C-SVC-DIR-" + TAG);
        int version = owner.queryForObject("SELECT version FROM registration_application WHERE id = ?", Integer.class, id);
        var res = reviewService.transition(DIRECTOR_CALLER, id, UUID.randomUUID().toString(),
            parse("{\"action\":\"return\",\"version\":" + version + ",\"note\":\"" + REASON + "\"}"));
        assertEquals(HttpStatus.OK, res.getStatusCode());
        assertEquals(1, owner.queryForObject("SELECT count(*) FROM registration_return_response_cycle WHERE application_id = ?", Integer.class, id));
    }

    @Test
    void resubmitSuccess() {
        UUID id = atProgrammeReview("WP02C-SVC-SUB-" + TAG);
        programmeReturn(id, UUID.randomUUID().toString());
        resubmit(id, UUID.randomUUID().toString());
        assertEquals(1, owner.queryForObject("SELECT count(*) FROM registration_application_resubmission WHERE application_id = ?", Integer.class, id));
        assertEquals("programme_review", owner.queryForObject("SELECT state FROM registration_application WHERE id = ?", String.class, id));
    }

    @Test
    void replay() {
        UUID id = atProgrammeReview("WP02C-SVC-REPLAY-" + TAG);
        String idem = idemKey("0000000000000001");
        int version = owner.queryForObject("SELECT version FROM registration_application WHERE id = ?", Integer.class, id);
        var body = parse("{\"action\":\"return\",\"version\":" + version + ",\"note\":\"" + REASON + "\"}");
        assertEquals(HttpStatus.OK, reviewService.transition(PROGRAMME_CALLER, id, idem, body).getStatusCode());
        var second = reviewService.transition(PROGRAMME_CALLER, id, idem, body);
        assertEquals(HttpStatus.OK, second.getStatusCode());
        assertEquals("true", second.getHeaders().getFirst("Idempotency-Replayed"));
    }

    @Test
    void changedPayloadConflict() {
        UUID id = atProgrammeReview("WP02C-SVC-PAYLOAD-" + TAG);
        String idem = idemKey("0000000000000002");
        int version = owner.queryForObject("SELECT version FROM registration_application WHERE id = ?", Integer.class, id);
        var first = reviewService.transition(PROGRAMME_CALLER, id, idem, parse("{\"action\":\"return\",\"version\":" + version + ",\"note\":\"" + REASON + "\"}"));
        assertEquals(HttpStatus.OK, first.getStatusCode());
        resubmit(id, UUID.randomUUID().toString());
        version = owner.queryForObject("SELECT version FROM registration_application WHERE id = ?", Integer.class, id);
        var conflict = reviewService.transition(PROGRAMME_CALLER, id, idem,
            parse("{\"action\":\"return\",\"version\":" + version + ",\"note\":\"Other reason entirely.\"}"));
        assertEquals(HttpStatus.CONFLICT, conflict.getStatusCode());
        assertEquals("idempotency_key_conflict", conflict.getBody().get("error"));
    }

    @Test
    void concurrent() throws Exception {
        UUID id = atProgrammeReview("WP02C-SVC-CONC-" + TAG);
        CompleteBundleSnapshot before = snapshot(id);
        int version = before.appVersion();
        String idem = idemKey("0000000000000003");
        var body = parse("{\"action\":\"return\",\"version\":" + version + ",\"note\":\"" + REASON + "\"}");
        ExecutorService pool = Executors.newFixedThreadPool(2);
        CountDownLatch start = new CountDownLatch(1);
        Future<?> a = pool.submit(() -> {
            start.await(5, TimeUnit.SECONDS);
            return reviewService.transition(PROGRAMME_CALLER, id, idem, body);
        });
        Future<?> b = pool.submit(() -> {
            start.await(5, TimeUnit.SECONDS);
            return reviewService.transition(PROGRAMME_CALLER, id, idem, body);
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
        UUID refId = atProgrammeReview("WP02C-SVC-CONC-REF-" + TAG);
        CompleteBundleSnapshot refBefore = snapshot(refId);
        programmeReturn(refId, UUID.randomUUID().toString());
        assertSnapshot(id, expectedAfterReference(before, refBefore, snapshot(refId)));
        pool.shutdownNow();
    }

    @Test
    void assigneeFailure() {
        UUID id = atProgrammeReview("WP02C-SVC-ASSIGN-" + TAG);
        UUID returningOfficer = UUID.randomUUID();
        owner.update("INSERT INTO user_account (id, keycloak_subject, username, display_name, status) VALUES (?, ?, ?, ?, 'active')",
            returningOfficer, UUID.randomUUID(), "wp02c-svc-off-" + TAG, "WP02C svc officer");
        owner.update("INSERT INTO role_assignment (user_id, role, scope, active, valid_from, valid_to) VALUES (?, 'programme', 'all', true, '-infinity', 'infinity')",
            returningOfficer);
        int atReturn = owner.queryForObject("SELECT version FROM registration_application WHERE id = ?", Integer.class, id);
        var officer = new Caller(returningOfficer, "wp02c-svc-off", List.of(new RoleGrant("programme", "all")), Set.of());
        assertEquals(HttpStatus.OK, reviewService.transition(officer, id, UUID.randomUUID().toString(),
            parse("{\"action\":\"return\",\"version\":" + atReturn + ",\"note\":\"" + REASON + "\"}")).getStatusCode());
        UUID returnId = latestReturnId(id);
        var returnedAt = owner.queryForObject("SELECT returned_at FROM registration_application_return WHERE id = ?", java.time.Instant.class, returnId);
        owner.update("UPDATE role_assignment SET valid_to = ? WHERE user_id = ? AND role = 'programme'",
            java.sql.Timestamp.from(returnedAt.plusNanos(1_000)), returningOfficer);
        int version = owner.queryForObject("SELECT version FROM registration_application WHERE id = ?", Integer.class, id);
        var res = reviewService.transition(NOVA_CALLER, id, UUID.randomUUID().toString(), parse("{\"action\":\"resubmit\",\"version\":" + version + "}"));
        assertEquals(HttpStatus.CONFLICT, res.getStatusCode());
        assertEquals("assignee_unavailable", res.getBody().get("error"));
        assertEquals("returned", owner.queryForObject("SELECT state FROM registration_application WHERE id = ?", String.class, id));
    }

    @Test
    void injectedMidWorkflowRollbackNoResidue() {
        UUID id = atProgrammeReview("WP02C-SVC-INJECT-" + TAG);
        CompleteBundleSnapshot baseline = snapshot(id);
        RegistrationReturnResponseWiring.testMidWiringFailureHook = () -> {
            throw new IllegalStateException("test_mid_wiring_failure");
        };
        try {
            int version = owner.queryForObject("SELECT version FROM registration_application WHERE id = ?", Integer.class, id);
            assertThrows(IllegalStateException.class, () -> reviewService.transition(PROGRAMME_CALLER, id, idemKey("0000000000000004"),
                parse("{\"action\":\"return\",\"version\":" + version + ",\"note\":\"" + REASON + "\"}")));
            assertNoReturnWorkflowResidue(id, baseline);
        } finally {
            RegistrationReturnResponseWiring.testMidWiringFailureHook = null;
        }
    }
}
