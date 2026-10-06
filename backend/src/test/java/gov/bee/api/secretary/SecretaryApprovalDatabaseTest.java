package gov.bee.api.secretary;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import gov.bee.api.application.ModelApplicationRepository;
import gov.bee.api.application.ModelApplicationSubmitRepository;
import gov.bee.api.finance.FeeConfirmationRepository;
import gov.bee.api.iame.IameRecommendationRepository;
import gov.bee.api.director.DirectorRecommendationRepository;
import gov.bee.api.secretary.SecretaryApprovalRepository.Outcome;
import gov.bee.api.rating.RatingRepository;
import gov.bee.api.reviewer.ReviewerForwardRepository;
import java.math.BigDecimal;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDate;
import java.util.HexFormat;
import java.util.List;
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
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.transaction.annotation.AnnotationTransactionAttributeSource;
import org.springframework.transaction.interceptor.TransactionInterceptor;

/** First slice step 7 (the Secretary gives final approval) against throwaway PostgreSQL; the shared app schema is untouched. */
@Tag("db")
class SecretaryApprovalDatabaseTest {

    static final String TAG = HexFormat.of().toHexDigits(ThreadLocalRandom.current().nextInt());
    static final String MAIN = "wp07f_test_" + TAG;
    static final Path SEED = Path.of("..", "local", "seed", "seed.sql");
    static final UUID NOVA = UUID.fromString("00000000-0000-4000-b000-000000000001");
    static final UUID NOVA_USER = UUID.fromString("00000000-0000-4000-a000-000000000001");
    static final UUID FINANCE_USER = UUID.fromString("00000000-0000-4000-a000-000000000003");
    static final UUID IAME_USER = UUID.fromString("00000000-0000-4000-a000-000000000004");
    static final UUID REVIEWER_USER = UUID.fromString("00000000-0000-4000-a000-000000000005");
    static final UUID PROGRAMME_USER = UUID.fromString("00000000-0000-4000-a000-000000000006");
    static final UUID DIRECTOR_USER = UUID.fromString("00000000-0000-4000-a000-000000000007");
    static final UUID SECRETARY_USER = UUID.fromString("00000000-0000-4000-a000-000000000008");
    static final UUID NOVA_COOL = UUID.fromString("00000000-0000-4000-d000-000000000001");

    static JdbcTemplate admin;
    static JdbcTemplate owner;
    static JdbcTemplate db;
    static DriverManagerDataSource runtime;
    static ModelApplicationRepository applications;
    static ModelApplicationSubmitRepository submissions;
    static FeeConfirmationRepository feeRepo;
    static IameRecommendationRepository iameRepo;
    static ReviewerForwardRepository reviewerRepo;
    static RatingRepository ratingRepo;
    static DirectorRecommendationRepository directorRepo;
    static SecretaryApprovalRepository repo;
    static int appModelCountBefore;

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
        appModelCountBefore = admin.queryForObject("SELECT count(*) FROM app.model_application", Integer.class);
        admin.execute("DROP SCHEMA IF EXISTS " + MAIN + " CASCADE");
        admin.execute("CREATE SCHEMA " + MAIN);
        Flyway.configure().dataSource(migrateSource(MAIN)).schemas(MAIN).defaultSchema(MAIN).createSchemas(false)
            .locations("classpath:db/migration").load().migrate();
        owner = new JdbcTemplate(migrateSource(MAIN));
        owner.execute(Files.readString(SEED));
        var superuser = new JdbcTemplate(sourceAs(MAIN, "bee_super", env("BEE_PG_SUPER_PASSWORD", "bee-local-super")));
        String maint = env("BEE_MAINT_DB_USER", "bee_local_maint");
        superuser.execute("GRANT USAGE ON SCHEMA " + MAIN + " TO " + maint);
        owner.execute("GRANT ALL ON ALL TABLES IN SCHEMA " + MAIN + " TO " + maint);
        owner.execute("GRANT EXECUTE ON FUNCTION " + MAIN + ".app_disposable_model_cleanup(uuid[]) TO " + maint);
        runtime = sourceAs(MAIN, env("BEE_RUNTIME_DB_USER", "bee_runtime"), env("BEE_RUNTIME_DB_PASSWORD", "bee-local-runtime"));
        db = new JdbcTemplate(runtime);
        applications = new ModelApplicationRepository(db);
        submissions = new ModelApplicationSubmitRepository(db, applications);
        feeRepo = transactional(new FeeConfirmationRepository(db));
        iameRepo = transactional(new IameRecommendationRepository(db));
        reviewerRepo = transactional(new ReviewerForwardRepository(db));
        ratingRepo = transactional(new RatingRepository(db));
        directorRepo = transactional(new DirectorRecommendationRepository(db));
        repo = transactional(new SecretaryApprovalRepository(db));
        assertEquals(40, owner.queryForObject("SELECT max(installed_rank) FROM flyway_schema_history", Integer.class), "migrated V1 through V40");
    }

    @AfterAll
    static void dropAndAssertAppUntouched() {
        if (admin != null) {
            admin.execute("DROP SCHEMA IF EXISTS " + MAIN + " CASCADE");
            assertEquals(appModelCountBefore, admin.queryForObject("SELECT count(*) FROM app.model_application", Integer.class));
        }
    }

    /** An application as the Director's recommendation leaves it: secretary_approval, version 6. */
    static UUID inSecretaryApproval(String model) {
        UUID id = UUID.randomUUID();
        applications.insertDraft(id, applications.nextReference(), NOVA, NOVA, NOVA_COOL, "Nova Cool", "RAC", model);
        var done = submissions.submit(id, NOVA, 0, NOVA_USER, "manufacturer", new BigDecimal("24000.00"), "RAC:new_model", 2, "provisional", "ref", "note");
        assertTrue(done.isPresent());
        UUID snapshot = submissions.findFeeSnapshot(id).orElseThrow().id();
        assertEquals(FeeConfirmationRepository.Outcome.CONFIRMED,
            feeRepo.confirm(id, 1, FINANCE_USER, "finance", snapshot, new BigDecimal("24000.00"), "UTR-" + id.toString().substring(0, 8), LocalDate.of(2026, 10, 2)).outcome());
        assertEquals(IameRecommendationRepository.Outcome.RECOMMENDED,
            iameRepo.recommend(id, 2, IAME_USER, "iame", "verified", "Report matches the declared laboratory and date.").outcome());
        assertEquals(ReviewerForwardRepository.Outcome.FORWARDED,
            reviewerRepo.forward(id, 3, REVIEWER_USER, "reviewer", "Checked against the application and the IAME note.").outcome());
        assertEquals(RatingRepository.Outcome.COMPUTED,
            ratingRepo.compute(id, 4, PROGRAMME_USER, "programme", "RAC-ISEER-DEMO-1", new BigDecimal("4.50"), new BigDecimal("4.62"), 4).outcome());
        assertEquals(DirectorRecommendationRepository.Outcome.RECOMMENDED,
            directorRepo.recommend(id, 5, DIRECTOR_USER, "director", "Rating reviewed; recommend approval.", false).outcome());
        return id;
    }

    static SecretaryApprovalRepository.Result approve(UUID appId, int version) {
        return repo.approve(appId, version, SECRETARY_USER, "secretary", "Rating reviewed; approved.");
    }

    static int count(String table, UUID appId) {
        return owner.queryForObject("SELECT count(*) FROM " + table + " WHERE application_id = ?", Integer.class, appId);
    }

    // ---- WP09.1a: the certificate is issued in the same transaction as the step that ends in "approved" ----

    static final java.time.ZoneId INDIA = java.time.ZoneId.of("Asia/Kolkata");

    static UUID finalByTheDirector(String model) {
        UUID id = UUID.randomUUID();
        applications.insertDraft(id, applications.nextReference(), NOVA, NOVA, NOVA_COOL, "Nova Cool", "RAC", model);
        submissions.submit(id, NOVA, 0, NOVA_USER, "manufacturer", new BigDecimal("24000.00"), "RAC:new_model", 2, "provisional", "ref", "note");
        UUID snapshot = submissions.findFeeSnapshot(id).orElseThrow().id();
        feeRepo.confirm(id, 1, FINANCE_USER, "finance", snapshot, new BigDecimal("24000.00"), "UTR-" + id.toString().substring(0, 8), LocalDate.of(2026, 10, 2));
        iameRepo.recommend(id, 2, IAME_USER, "iame", "verified", "n");
        reviewerRepo.forward(id, 3, REVIEWER_USER, "reviewer", "n");
        ratingRepo.compute(id, 4, PROGRAMME_USER, "programme", "RAC-ISEER-DEMO-1", new BigDecimal("4.50"), new BigDecimal("4.62"), 4);
        assertEquals("approved", directorRepo.recommend(id, 5, DIRECTOR_USER, "director", "final", true).toState());
        return id;
    }

    @Test
    void approvalIssuesOneCertificateWithTheRegistrationIdTheValidityAndTheFactsItWasIssuedOn() {
        UUID id = inSecretaryApproval("SA-CERT");
        assertEquals(0, count("certificate", id), "nothing is issued before the approval");
        assertEquals(Outcome.APPROVED, approve(id, 6).outcome());
        assertEquals(1, count("certificate", id));
        var c = owner.queryForMap("SELECT * FROM certificate WHERE application_id = ?", id);
        LocalDate today = LocalDate.now(INDIA);
        assertTrue(((String) c.get("registration_id")).matches("^BEE/RAC/" + today.getYear() + "/1[0-9]{4}$"), String.valueOf(c.get("registration_id")));
        assertEquals(today, ((java.sql.Date) c.get("valid_from")).toLocalDate());
        assertEquals(today.plusYears(3).minusDays(1), ((java.sql.Date) c.get("valid_to")).toLocalDate(), "three years, ending the day before the anniversary");
        assertEquals("Nova Cool", c.get("brand_name"));
        assertEquals("SA-CERT", c.get("model_number"));
        assertEquals(owner.queryForObject("SELECT legal_name FROM organisation WHERE id = ?", String.class, NOVA), c.get("organisation_name"));
        assertEquals(4, ((Number) c.get("stars")).intValue());
        assertEquals(new BigDecimal("4.62"), c.get("verified_iseer"));
        assertEquals("RAC-ISEER-DEMO-1", c.get("scheme_key"));
        assertEquals("local_demo", c.get("basis"));
        assertEquals(SECRETARY_USER, c.get("issued_by_account_id"));
        assertEquals(owner.queryForObject("SELECT id FROM model_application_transition_event WHERE application_id = ? AND action = 'secretary_approve'", UUID.class, id), c.get("transition_event_id"));
    }

    @Test
    void aDirectorsFinalRecommendationIssuesTheCertificateToo() {
        UUID id = finalByTheDirector("SA-CERT-FINAL");
        assertEquals(1, count("certificate", id));
        assertEquals(DIRECTOR_USER, owner.queryForObject("SELECT issued_by_account_id FROM certificate WHERE application_id = ?", UUID.class, id));
        UUID other = inSecretaryApproval("SA-CERT-NOT-FINAL");
        assertEquals(0, count("certificate", other), "a recommendation that is not final issues nothing");
    }

    @Test
    void numbersRiseByOneAndConcurrentApprovalsNeverShareOne() throws Exception {
        UUID a = inSecretaryApproval("SA-NUM-1");
        UUID b = inSecretaryApproval("SA-NUM-2");
        ExecutorService pool = Executors.newFixedThreadPool(2);
        CountDownLatch go = new CountDownLatch(1);
        try {
            Future<?> fa = pool.submit(() -> { go.await(); return approve(a, 6).outcome(); });
            Future<?> fb = pool.submit(() -> { go.await(); return approve(b, 6).outcome(); });
            go.countDown();
            assertEquals(Outcome.APPROVED, fa.get(30, TimeUnit.SECONDS));
            assertEquals(Outcome.APPROVED, fb.get(30, TimeUnit.SECONDS));
        } finally {
            pool.shutdownNow();
        }
        int na = owner.queryForObject("SELECT sequence_no FROM certificate WHERE application_id = ?", Integer.class, a);
        int nb = owner.queryForObject("SELECT sequence_no FROM certificate WHERE application_id = ?", Integer.class, b);
        assertEquals(1, Math.abs(na - nb), "two approvals at once get the next two numbers");
        assertEquals(Math.max(na, nb) + 1, owner.queryForObject("SELECT next_value FROM certificate_allocator WHERE category_code = 'RAC' AND issue_year = ?", Integer.class, LocalDate.now(INDIA).getYear()));
        UUID c = inSecretaryApproval("SA-NUM-3");
        approve(c, 6);
        assertEquals(Math.max(na, nb) + 1, owner.queryForObject("SELECT sequence_no FROM certificate WHERE application_id = ?", Integer.class, c));
    }

    @Test
    void theCertificateIsAppendOnlyAndTheRuntimeLoginCanOnlyIssueOneThroughTheFunction() {
        UUID id = inSecretaryApproval("SA-CERT-PRIV");
        approve(id, 6);
        assertThrows(Exception.class, () -> owner.update("UPDATE certificate SET stars = 5 WHERE application_id = ?", id), "append-only");
        assertThrows(Exception.class, () -> owner.update("DELETE FROM certificate WHERE application_id = ?", id), "append-only");
        assertThrows(Exception.class, () -> db.update("INSERT INTO certificate_allocator (category_code, issue_year, next_value) VALUES ('ZZ', 2026, 10001)"), "the runtime login cannot touch the numbers");
        UUID waiting = inSecretaryApproval("SA-CERT-EARLY");
        UUID event = owner.queryForObject("SELECT id FROM model_application_transition_event WHERE application_id = ? LIMIT 1", UUID.class, waiting);
        assertThrows(Exception.class, () -> db.queryForObject("SELECT issue_certificate(?, ?, ?)", String.class, waiting, event, SECRETARY_USER), "not approved, so nothing is issued");
        assertEquals(0, count("certificate", waiting));
    }

    @Test
    void thePublicViewShowsOnlyPublicFieldsAndTheRuntimeLoginCanReadNothingElseOfTheCertificate() {
        UUID id = inSecretaryApproval("SA-CERT-PUBLIC");
        approve(id, 6);
        String reg = owner.queryForObject("SELECT registration_id FROM certificate WHERE application_id = ?", String.class, id);
        var cols = owner.queryForList("SELECT column_name FROM information_schema.columns WHERE table_schema = ? AND table_name = 'public_certificate' ORDER BY ordinal_position", String.class, MAIN);
        assertEquals(java.util.List.of("registration_id", "brand_name", "model_number", "category_code", "stars", "verified_iseer", "valid_from", "valid_to", "manufacturer"), cols,
            "no applicant, account, application or note field is reachable through the public view");
        assertEquals(1, db.queryForObject("SELECT count(*) FROM public_certificate WHERE registration_id = ?", Integer.class, reg));
        assertEquals(0, db.queryForObject("SELECT count(*) FROM public_certificate WHERE registration_id = 'BEE/RAC/2026/00000'", Integer.class));
        assertThrows(Exception.class, () -> db.update("UPDATE public_certificate SET stars = 1 WHERE registration_id = ?", reg), "read-only");
    }

    // ---- WP10.1a: the approval notifies the applicant's organisation; reading a notification is the recipient's alone ----
    @Test
    void anApprovalNotifiesTheOrganisationAndOnlyTheRecipientMarksTheirOwnReadOnce() {
        UUID id = inSecretaryApproval("SA-NOTE");
        approve(id, 6);
        String reg = owner.queryForObject("SELECT registration_id FROM certificate WHERE application_id = ?", String.class, id);
        var rows = owner.queryForList("SELECT id, recipient_account_id, message FROM notification WHERE application_id = ? AND kind = 'approved'", id);
        assertFalse(rows.isEmpty(), "the approval notifies");
        assertTrue(((String) rows.get(0).get("message")).contains("was approved. Certificate " + reg + " is valid from "), (String) rows.get(0).get("message"));
        UUID mine = (UUID) rows.get(0).get("id");
        UUID recipient = (UUID) rows.get(0).get("recipient_account_id");
        UUID stranger = UUID.fromString("00000000-0000-4000-a000-000000000003");
        assertEquals(0, db.queryForObject("SELECT notification_mark_read(?, ?)", Integer.class, stranger, mine), "another person's id changes nothing");
        assertEquals(1, db.queryForObject("SELECT notification_mark_read(?, ?)", Integer.class, recipient, mine));
        assertEquals(0, db.queryForObject("SELECT notification_mark_read(?, ?)", Integer.class, recipient, mine), "it is marked once");
        assertEquals(1, owner.queryForObject("SELECT count(*) FROM notification WHERE id = ? AND read_at IS NOT NULL", Integer.class, mine));
        int others = owner.queryForObject("SELECT count(*) FROM notification WHERE recipient_account_id = ? AND read_at IS NULL", Integer.class, recipient);
        assertEquals(others, db.queryForObject("SELECT notification_mark_all_read(?)", Integer.class, recipient));
        assertEquals(0, owner.queryForObject("SELECT count(*) FROM notification WHERE recipient_account_id = ? AND read_at IS NULL", Integer.class, recipient));
    }

    @Test
    void aNotificationNeverChangesExceptItsReadMarkAndTheRuntimeLoginCannotWriteTheTable() {
        UUID id = inSecretaryApproval("SA-NOTE-GUARD");
        approve(id, 6);
        UUID row = owner.queryForObject("SELECT id FROM notification WHERE application_id = ? LIMIT 1", UUID.class, id);
        assertThrows(Exception.class, () -> owner.update("UPDATE notification SET message = 'changed' WHERE id = ?", row), "the text is fixed");
        assertThrows(Exception.class, () -> owner.update("UPDATE notification SET kind = 'rejected' WHERE id = ?", row));
        assertThrows(Exception.class, () -> owner.update("UPDATE notification SET read_at = NULL WHERE id = ?", row), "a read mark never goes back");
        assertThrows(Exception.class, () -> owner.update("DELETE FROM notification WHERE id = ?", row), "append-only");
        assertThrows(Exception.class, () -> db.update("UPDATE notification SET read_at = now() WHERE id = ?", row), "the runtime login marks only through the function");
        assertThrows(Exception.class, () -> db.update("INSERT INTO notification (recipient_account_id, application_id, kind, message) SELECT recipient_account_id, application_id, kind, message FROM notification WHERE id = ?", row));
        assertThrows(Exception.class, () -> db.update("DELETE FROM notification WHERE id = ?", row));
        assertTrue(db.queryForObject("SELECT count(*) FROM notification WHERE id = ?", Integer.class, row) == 1, "but it can read");
        assertThrows(Exception.class, () -> db.queryForObject("SELECT notify_application_organisation(?, 'approved', 'x')", Integer.class, id), "only the triggers write");
    }

    @Test
    void disposableCleanupRemovesTheCertificateOfARegisteredApplicationToo() {
        UUID id = inSecretaryApproval("SA-CERT-CLEAN");
        approve(id, 6);
        assertEquals(1, count("certificate", id));
        var maint = new JdbcTemplate(sourceAs(MAIN, env("BEE_MAINT_DB_USER", "bee_local_maint"), env("BEE_MAINT_DB_PASSWORD", "bee-local-maint")));
        maint.execute("SELECT set_config('bee.cleanup_schema', '" + MAIN + "', true); INSERT INTO " + MAIN + ".local_disposable_application (application_id) VALUES ('" + id + "'); "
            + "SELECT " + MAIN + ".app_disposable_model_cleanup(ARRAY['" + id + "']::uuid[])");
        assertEquals(0, count("certificate", id));
        assertEquals(0, owner.queryForObject("SELECT count(*) FROM model_application WHERE id = ?", Integer.class, id));
    }

    @Test
    void approveMovesTheStateToApprovedWithEventAndRecordTogether() {
        UUID id = inSecretaryApproval("SA-HAPPY");
        var r = approve(id, 6);
        assertEquals(Outcome.APPROVED, r.outcome());
        assertEquals(7, r.versionAfter());
        assertEquals("approved", owner.queryForObject("SELECT state FROM model_application WHERE id = ?", String.class, id));
        assertEquals(7, owner.queryForObject("SELECT version FROM model_application WHERE id = ?", Integer.class, id));
        var ev = owner.queryForMap("SELECT from_state, to_state, actor_account_id, actor_role, version_after FROM model_application_transition_event "
            + "WHERE application_id = ? AND action = 'secretary_approve'", id);
        assertEquals("secretary_approval", ev.get("from_state"));
        assertEquals("approved", ev.get("to_state"));
        assertEquals(SECRETARY_USER, ev.get("actor_account_id"));
        assertEquals("secretary", ev.get("actor_role"));
        assertEquals(7, ev.get("version_after"));
        var rec = owner.queryForMap("SELECT note, approved_by_account_id FROM model_application_secretary_approval WHERE application_id = ?", id);
        assertEquals("Rating reviewed; approved.", rec.get("note"));
        assertEquals(SECRETARY_USER, rec.get("approved_by_account_id"));
        assertEquals(0, owner.queryForObject("SELECT count(*) FROM assignment WHERE subject_id = ? AND active", Integer.class, id));
        assertEquals(java.util.Set.of(NOVA_USER, FINANCE_USER, IAME_USER, REVIEWER_USER, PROGRAMME_USER, DIRECTOR_USER), repo.actorsAtOtherStages(id),
            "every earlier stage counts, so none of those officers can also approve; the Secretary's own step is this stage and does not");
    }

    @Test
    void theWholeChainRunsInOrderAndEachStepWroteItsOwnEvent() {
        UUID id = inSecretaryApproval("SA-CHAIN");
        approve(id, 6);
        var actions = owner.queryForList("SELECT action FROM model_application_transition_event WHERE application_id = ? ORDER BY occurred_at, version_after", String.class, id);
        assertEquals(List.of("confirm_fee", "iame_recommend", "reviewer_forward", "compute_rating", "director_recommend", "secretary_approve"), actions);
        var versions = owner.queryForList("SELECT version_after FROM model_application_transition_event WHERE application_id = ? ORDER BY version_after", Integer.class, id);
        assertEquals(List.of(2, 3, 4, 5, 6, 7), versions, "one version bump per step");
    }

    @Test
    void anApplicationTheDirectorMadeFinalIsAlreadyApprovedAndCannotBeApprovedAgain() {
        UUID id = UUID.randomUUID();
        applications.insertDraft(id, applications.nextReference(), NOVA, NOVA, NOVA_COOL, "Nova Cool", "RAC", "SA-FINAL");
        submissions.submit(id, NOVA, 0, NOVA_USER, "manufacturer", new BigDecimal("24000.00"), "RAC:new_model", 2, "provisional", "ref", "note");
        UUID snapshot = submissions.findFeeSnapshot(id).orElseThrow().id();
        feeRepo.confirm(id, 1, FINANCE_USER, "finance", snapshot, new BigDecimal("24000.00"), "UTR-" + id.toString().substring(0, 8), LocalDate.of(2026, 10, 2));
        iameRepo.recommend(id, 2, IAME_USER, "iame", "verified", "n");
        reviewerRepo.forward(id, 3, REVIEWER_USER, "reviewer", "n");
        ratingRepo.compute(id, 4, PROGRAMME_USER, "programme", "RAC-ISEER-DEMO-1", new BigDecimal("4.50"), new BigDecimal("4.62"), 4);
        assertEquals("approved", directorRepo.recommend(id, 5, DIRECTOR_USER, "director", "final", true).toState());
        assertEquals(Outcome.STALE, approve(id, 6).outcome(), "the Director's final recommendation already approved it; the Secretary has nothing to do");
        assertEquals(0, count("model_application_secretary_approval", id));
    }

    @Test
    void aStaleVersionOrWrongStateWritesNothing() {
        UUID id = inSecretaryApproval("SA-STALE");
        assertEquals(Outcome.STALE, approve(id, 5).outcome(), "the application is at version 6");
        assertEquals(0, count("model_application_secretary_approval", id));
        assertEquals(5, count("model_application_transition_event", id));
        assertEquals(Outcome.APPROVED, approve(id, 6).outcome());
        assertEquals(Outcome.STALE, approve(id, 7).outcome(), "it is approved, so a second approval cannot apply");
        assertEquals(1, count("model_application_secretary_approval", id));
        assertEquals(6, count("model_application_transition_event", id));
    }

    @Test
    void theApprovalIsAppendOnlyOnePerApplicationAndRefusesBadNotes() {
        UUID id = inSecretaryApproval("SA-APPENDONLY");
        approve(id, 6);
        for (String sql : List.of(
            "UPDATE model_application_secretary_approval SET note = 'x' WHERE application_id = ?",
            "DELETE FROM model_application_secretary_approval WHERE application_id = ?")) {
            assertThrows(Exception.class, () -> db.update(sql, id), sql);
        }
        assertThrows(Exception.class, () -> db.execute("TRUNCATE model_application_secretary_approval"));
        assertThrows(Exception.class, () -> owner.update("DELETE FROM model_application_secretary_approval WHERE application_id = ?", id));
        UUID event = owner.queryForObject("SELECT id FROM model_application_transition_event WHERE application_id = ? AND action = 'iame_recommend'", UUID.class, id);
        String sql = "INSERT INTO model_application_secretary_approval (application_id, transition_event_id, note, approved_by_account_id) VALUES (?, ?, ?, ?)";
        assertThrows(Exception.class, () -> owner.update(sql, id, event, "a second approval", SECRETARY_USER), "one approval per application");
        UUID other = inSecretaryApproval("SA-CHECKS");
        UUID otherEvent = owner.queryForObject("SELECT id FROM model_application_transition_event WHERE application_id = ? AND action = 'iame_recommend'", UUID.class, other);
        assertThrows(Exception.class, () -> owner.update(sql, other, otherEvent, "", SECRETARY_USER), "empty note");
        assertThrows(Exception.class, () -> owner.update(sql, other, otherEvent, "x".repeat(501), SECRETARY_USER), "long note");
        assertEquals(1, count("model_application_secretary_approval", id));
        assertEquals(0, count("model_application_secretary_approval", other));
    }

    @Test
    void twoSimultaneousApprovalsHaveExactlyOneWinner() throws Exception {
        UUID id = inSecretaryApproval("SA-RACE");
        ExecutorService pool = Executors.newFixedThreadPool(2);
        CountDownLatch go = new CountDownLatch(1);
        try {
            List<Future<Outcome>> results = List.of(
                pool.submit(() -> { go.await(); return approve(id, 6).outcome(); }),
                pool.submit(() -> { go.await(); return approve(id, 6).outcome(); }));
            go.countDown();
            List<Outcome> outcomes = List.of(results.get(0).get(10, TimeUnit.SECONDS), results.get(1).get(10, TimeUnit.SECONDS));
            assertEquals(1, outcomes.stream().filter(o -> o == Outcome.APPROVED).count(), outcomes.toString());
            assertEquals(1, outcomes.stream().filter(o -> o == Outcome.STALE).count(), outcomes.toString());
        } finally {
            pool.shutdownNow();
        }
        assertEquals(1, count("model_application_secretary_approval", id));
    }

    @Test
    void disposableCleanupRemovesTheNewRowsAndOnlyForRegisteredApplications() {
        UUID id = inSecretaryApproval("SA-CLEAN");
        approve(id, 6);
        int seededAssignments = owner.queryForObject("SELECT count(*) FROM assignment WHERE subject_id <> ?", Integer.class, id);
        var maint = new JdbcTemplate(sourceAs(MAIN, env("BEE_MAINT_DB_USER", "bee_local_maint"), env("BEE_MAINT_DB_PASSWORD", "bee-local-maint")));
        maint.execute(
            "SELECT set_config('bee.cleanup_schema', '" + MAIN + "', true); "
                + "INSERT INTO " + MAIN + ".local_disposable_application (application_id) VALUES ('" + id + "'); "
                + "SELECT " + MAIN + ".app_disposable_model_cleanup(ARRAY['" + id + "']::uuid[])");
        for (String table : List.of("model_application_secretary_approval", "model_application_director_recommendation", "model_application_rating",
            "model_application_reviewer_forward", "model_application_iame_recommendation", "model_application_transition_event", "model_application_fee_confirmation")) {
            assertEquals(0, count(table, id), table);
        }
        assertEquals(0, owner.queryForObject("SELECT count(*) FROM model_application WHERE id = ?", Integer.class, id));
        assertEquals(seededAssignments, owner.queryForObject("SELECT count(*) FROM assignment", Integer.class), "seeded assignments are untouched");
        assertFalse(owner.queryForObject("SELECT has_function_privilege('" + env("BEE_RUNTIME_DB_USER", "bee_runtime") + "', '" + MAIN + ".app_disposable_model_cleanup(uuid[])', 'EXECUTE')", Boolean.class));
    }
}
