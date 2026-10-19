package gov.bee.api.snl;

import static org.junit.jupiter.api.Assertions.assertEquals;
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
import gov.bee.api.workflow.WorkflowFoundationRepository;
import java.time.Instant;
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
    static final Caller DIRECTOR_CALLER = new Caller(DIRECTOR_USER, "dir", List.of(new RoleGrant("officer", "all")), Set.of());
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
        CompleteBundleSnapshot afterReturn = snapshot(id);
        UUID returnId = latestReturnId(id);
        var returnedAt = owner.queryForObject("SELECT returned_at FROM registration_application_return WHERE id = ?", Instant.class, returnId);
        owner.update("UPDATE role_assignment SET valid_to = ? WHERE user_id = ? AND role = 'programme'",
            java.sql.Timestamp.from(returnedAt.plusNanos(1_000)), returningOfficer);
        int version = owner.queryForObject("SELECT version FROM registration_application WHERE id = ?", Integer.class, id);
        var res = reviewService.transition(NOVA_CALLER, id, UUID.randomUUID().toString(), parse("{\"action\":\"resubmit\",\"version\":" + version + "}"));
        assertEquals(HttpStatus.CONFLICT, res.getStatusCode());
        assertEquals("assignee_unavailable", res.getBody().get("error"));
        assertSnapshot(id, afterReturn);
    }

    @Test
    void repeatCycleReturnResubmitJourneyBindsLatestReturn() {
        UUID id = atProgrammeReview("WP02C-SVC-REPEAT-" + TAG);
        UUID firstOfficer = UUID.randomUUID();
        UUID secondOfficer = UUID.randomUUID();
        for (UUID officer : List.of(firstOfficer, secondOfficer)) {
            owner.update("INSERT INTO user_account (id, keycloak_subject, username, display_name, status) VALUES (?, ?, ?, ?, 'active')",
                officer, UUID.randomUUID(), "wp02c-svc-rpt-" + officer.toString().substring(0, 8), "WP02C repeat officer");
            owner.update("INSERT INTO role_assignment (user_id, role, scope, active, valid_from, valid_to) VALUES (?, 'programme', 'all', true, '-infinity', 'infinity')",
                officer);
        }
        int v0 = owner.queryForObject("SELECT version FROM registration_application WHERE id = ?", Integer.class, id);
        var off1 = new Caller(firstOfficer, "off1", List.of(new RoleGrant("programme", "all")), Set.of());
        assertEquals(HttpStatus.OK, reviewService.transition(off1, id, UUID.randomUUID().toString(),
            parse("{\"action\":\"return\",\"version\":" + v0 + ",\"note\":\"First return.\"}")).getStatusCode());
        UUID firstReturnId = latestReturnId(id);
        resubmit(id, UUID.randomUUID().toString());
        int v1 = owner.queryForObject("SELECT version FROM registration_application WHERE id = ?", Integer.class, id);
        var off2 = new Caller(secondOfficer, "off2", List.of(new RoleGrant("programme", "all")), Set.of());
        assertEquals(HttpStatus.OK, reviewService.transition(off2, id, UUID.randomUUID().toString(),
            parse("{\"action\":\"return\",\"version\":" + v1 + ",\"note\":\"Second return same cycle.\"}")).getStatusCode());
        UUID secondReturnId = latestReturnId(id);
        assertEquals(2, owner.queryForObject("SELECT count(*) FROM registration_application_return WHERE application_id = ?", Integer.class, id));
        assertEquals(1, owner.queryForObject("SELECT count(*) FROM registration_return_response_cycle WHERE application_id = ? AND status = 'open'", Integer.class, id));
        assertEquals(2, owner.queryForObject(
            "SELECT count(*) FROM registration_return_response_cycle_return cr JOIN registration_return_response_cycle c ON c.id = cr.cycle_id WHERE c.application_id = ?",
            Integer.class, id));
        int responsesBefore = owner.queryForObject(
            "SELECT count(*) FROM workflow_discrepancy_response dr JOIN registration_return_response_cycle c ON c.discrepancy_id = dr.discrepancy_id WHERE c.application_id = ?",
            Integer.class, id);
        int notifyBefore = owner.queryForObject(
            "SELECT count(*) FROM notification WHERE recipient_account_id = ? AND kind = 'applicant_resubmitted' AND subject_id = ?", Integer.class, secondOfficer, id);
        resubmit(id, UUID.randomUUID().toString());
        assertEquals(secondReturnId, owner.queryForObject(
            "SELECT return_id FROM registration_application_resubmission WHERE application_id = ? ORDER BY resubmitted_at DESC LIMIT 1", UUID.class, id));
        assertEquals(2, owner.queryForObject("SELECT count(*) FROM registration_application_resubmission WHERE application_id = ?", Integer.class, id));
        assertEquals(responsesBefore + 1, owner.queryForObject(
            "SELECT count(*) FROM workflow_discrepancy_response dr JOIN registration_return_response_cycle c ON c.discrepancy_id = dr.discrepancy_id WHERE c.application_id = ?",
            Integer.class, id));
        assertEquals(notifyBefore + 1, owner.queryForObject(
            "SELECT count(*) FROM notification WHERE recipient_account_id = ? AND kind = 'applicant_resubmitted' AND subject_id = ?", Integer.class, secondOfficer, id));
        assertEquals(secondReturnId, registrations.latestReturnForOpenCycle(id).map(r -> r.returnId()).orElseThrow());
    }

    @Test
    void latestOpenCycleReturnOrdersByReturnedAtNotReturnId() {
        UUID id = atProgrammeReview("WP02C-SVC-ORDER-" + TAG);
        UUID highReturnId = UUID.fromString("ffffffff-ffff-4fff-8fff-ffffffffffff");
        UUID lowReturnId = UUID.fromString("00000000-0000-4000-8000-000000000001");
        wiredReturnWithReturnId(id, highReturnId, "programme_review", PROGRAMME_USER, "programme", "First wired return.");
        wiredResubmit(id, highReturnId, "programme_review",
            owner.queryForObject("SELECT returned_at FROM registration_application_return WHERE id = ?", Instant.class, highReturnId),
            "First wired return.", UUID.randomUUID().toString(), null);
        wiredReturnWithReturnId(id, lowReturnId, "programme_review", PROGRAMME_USER, "programme", "Second wired return.");
        var latest = registrations.latestReturnForOpenCycle(id).orElseThrow();
        assertEquals(lowReturnId, latest.returnId());
        assertEquals(PROGRAMME_USER, latest.returnedByAccountId());
        assertEquals("programme", latest.returnedByRole());
        assertEquals("Second wired return.", latest.reason());
    }

    @Test
    void javaWiringHashesMatchV73FunctionsWithMicrosecondAndUnicodeText() {
        UUID applicationId = UUID.fromString("11111111-1111-4111-8111-111111111111");
        UUID transitionEventId = UUID.fromString("22222222-2222-4222-8222-222222222222");
        UUID returnId = UUID.fromString("33333333-3333-4333-8333-333333333333");
        UUID resubmissionId = UUID.fromString("44444444-4444-4444-8444-444444444444");
        String reason = "Café «hold» — 日本語; sub-ms OK.";
        Instant returnedAt = Instant.parse("2026-10-18T10:15:30.123456Z");
        Instant resubmittedAt = Instant.parse("2026-10-18T11:20:45.654321Z");
        Instant dueAt = Instant.parse("2026-11-17T18:29:59.000000Z");
        UUID policyVersionId = policyRepo.requireApplicableVersion(returnedAt).id();
        UUID notifyCommand = commandId("0123456789abcdef0123456789abcdef", "registration_return_notify", applicationId);
        String notifySuffix = "was returned to you: " + reason + " Respond by 17 Nov 2026. Edit it and send it again.";
        String notifyHash = NotificationCommandRepository.payloadHash(
            new NotificationCommandRepository.DeliverCommand(WorkflowFoundationRepository.SUBJECT_REGISTRATION, applicationId, "returned", notifySuffix));
        UUID taskCommand = commandId("0123456789abcdef0123456789abcdef", "registration_return_task", applicationId);
        var taskCmd = new WorkflowFoundationRepository.TaskCommand(
            WorkflowFoundationRepository.SUBJECT_REGISTRATION, applicationId, "programme_review", "review", "programme", PROGRAMME_USER, dueAt, policyVersionId, returnedAt);
        String taskPayloadHash = WorkflowFoundationRepository.payloadHash(taskCmd);
        String javaReturn = wiringRepo.computeReturnHash(applicationId, transitionEventId, returnId, "programme_review", reason, PROGRAMME_USER, returnedAt,
            "programme", notifyCommand, notifyHash, notifySuffix, taskCommand, taskPayloadHash, "programme", PROGRAMME_USER, dueAt, policyVersionId, PROGRAMME_USER);
        String sqlReturn = wiringReturnHash(applicationId, transitionEventId, returnId, "programme_review", reason, PROGRAMME_USER, returnedAt, "programme",
            notifyCommand, notifyHash, notifySuffix, taskCommand, taskPayloadHash, "programme", PROGRAMME_USER, dueAt, policyVersionId, PROGRAMME_USER);
        assertEquals(sqlReturn, javaReturn);
        UUID resubmitNotify = commandId("fedcba9876543210fedcba9876543210", "registration_resubmit_notify", applicationId);
        UUID resubmitTask = commandId("fedcba9876543210fedcba9876543210", "registration_resubmit_task", applicationId);
        String body = "Applicant fixed the «enclosure» — 日本語.";
        String javaResubmit = wiringRepo.computeResubmitHash(applicationId, returnId, resubmissionId, transitionEventId, "programme_review", returnedAt, reason,
            "programme_review", body, resubmittedAt, NOVA_USER, "manufacturer", resubmitNotify, resubmitTask, taskPayloadHash, "programme", PROGRAMME_USER, dueAt,
            policyVersionId, NOVA_USER);
        String sqlResubmit = wiringResubmitHash(applicationId, returnId, resubmissionId, transitionEventId, "programme_review", returnedAt, reason, body, resubmittedAt,
            NOVA_USER, "manufacturer", resubmitNotify, resubmitTask, taskPayloadHash, "programme", PROGRAMME_USER, dueAt, policyVersionId, NOVA_USER);
        assertEquals(sqlResubmit, javaResubmit);
    }

    void wiredReturnWithReturnId(UUID id, UUID returnId, String stage, UUID officer, String role, String reason) {
        tx.executeWithoutResult(s -> {
            int version = owner.queryForObject("SELECT version FROM registration_application WHERE id = ?", Integer.class, id);
            var leg = legacyReturn(id, version, stage, officer, role, reason);
            completeWiredReturn(id, returnId, leg.transitionEventId(), stage, reason, leg.returnedAt(), officer, role, UUID.randomUUID().toString());
        });
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
