package gov.bee.api.rework;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import gov.bee.api.application.ModelApplicationRepository;
import gov.bee.api.application.ModelApplicationSubmitRepository;
import gov.bee.api.finance.FeeConfirmationRepository;
import gov.bee.api.history.HistoryRepository;
import gov.bee.api.iame.IameRecommendationRepository;
import gov.bee.api.director.DirectorRecommendationRepository;
import gov.bee.api.secretary.SecretaryApprovalRepository;
import gov.bee.api.rating.RatingRepository;
import gov.bee.api.reviewer.ReviewerForwardRepository;
import java.math.BigDecimal;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDate;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
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

/** Return to the applicant and resubmit against throwaway PostgreSQL; the shared app schema is untouched. */
@Tag("db")
class ReworkDatabaseTest {

    static final String TAG = HexFormat.of().toHexDigits(ThreadLocalRandom.current().nextInt());
    static final String MAIN = "wp07g_test_" + TAG;
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
    static SecretaryApprovalRepository secretaryRepo;
    static StageReturnRepository returns;
    static ResubmitApplicationRepository resub;
    static StageRejectRepository rejects;
    static HistoryRepository history;
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
        secretaryRepo = transactional(new SecretaryApprovalRepository(db));
        returns = transactional(new StageReturnRepository(db));
        resub = transactional(new ResubmitApplicationRepository(db));
        rejects = transactional(new StageRejectRepository(db));
        history = new HistoryRepository(db);
        assertEquals(36, owner.queryForObject("SELECT max(installed_rank) FROM flyway_schema_history", Integer.class), "migrated V1 through V36");
    }

    @AfterAll
    static void dropAndAssertAppUntouched() {
        if (admin != null) {
            admin.execute("DROP SCHEMA IF EXISTS " + MAIN + " CASCADE");
            assertEquals(appModelCountBefore, admin.queryForObject("SELECT count(*) FROM app.model_application", Integer.class));
        }
    }

    static final BigDecimal DECLARED = new BigDecimal("4.50");

    /** Walks a fresh application up to the given stage, with its evidence set, using the real repositories. */
    static UUID at(String stage, String model) {
        UUID id = UUID.randomUUID();
        applications.insertDraft(id, applications.nextReference(), NOVA, NOVA, NOVA_COOL, "Nova Cool", "RAC", model);
        applications.setEvidence(id, NOVA, new ModelApplicationRepository.EvidenceUpdate(true, "LAB", true, LocalDate.of(2026, 9, 1), true, DECLARED));
        int version = submissions.submit(id, NOVA, 0, NOVA_USER, "manufacturer", new BigDecimal("24000.00"), "RAC:new_model", 2, "provisional", "ref", "note").orElseThrow().application().version();
        UUID snapshot = submissions.findFeeSnapshot(id).orElseThrow().id();
        feeRepo.confirm(id, version, FINANCE_USER, "finance", snapshot, new BigDecimal("24000.00"), "UTR-" + id.toString().substring(0, 8), LocalDate.of(2026, 10, 2));
        if (stage.equals("iame_scrutiny")) return id;
        iameRepo.recommend(id, 2, IAME_USER, "iame", "verified", "n");
        if (stage.equals("bee_scrutiny")) return id;
        reviewerRepo.forward(id, 3, REVIEWER_USER, "reviewer", "n");
        if (stage.equals("rating")) return id;
        ratingRepo.compute(id, 4, PROGRAMME_USER, "programme", "RAC-ISEER-DEMO-1", DECLARED, new BigDecimal("4.62"), 4);
        if (stage.equals("director_review")) return id;
        directorRepo.recommend(id, 5, DIRECTOR_USER, "director", "n", false);
        return id;
    }

    static final Map<String, UUID> OFFICER = Map.of("iame_scrutiny", IAME_USER, "bee_scrutiny", REVIEWER_USER, "rating", PROGRAMME_USER, "director_review", DIRECTOR_USER, "secretary_approval", SECRETARY_USER);
    static final Map<String, String> ROLE = Map.of("iame_scrutiny", "iame", "bee_scrutiny", "reviewer", "rating", "programme", "director_review", "director", "secretary_approval", "secretary");

    static int version(UUID id) {
        return owner.queryForObject("SELECT version FROM model_application WHERE id = ?", Integer.class, id);
    }

    static String state(UUID id) {
        return owner.queryForObject("SELECT state FROM model_application WHERE id = ?", String.class, id);
    }

    static StageReturnRepository.Result giveBack(UUID id, String stage) {
        return returns.doReturn(id, version(id), OFFICER.get(stage), ROLE.get(stage), stage, "The report does not match the application.");
    }

    static ResubmitApplicationRepository.Result resubmit(UUID id) {
        var open = resub.openReturn(id).orElseThrow();
        boolean from = open.returnedFromState().equals("director_review") || open.returnedFromState().equals("secretary_approval");
        boolean superseded = from && resub.ratingInputsChanged(id, open);
        return resub.resubmit(id, version(id), NOVA_USER, "manufacturer", open.id(), superseded ? "rating" : open.returnedFromState(), superseded, null);
    }

    static int count(String table, UUID appId) {
        return owner.queryForObject("SELECT count(*) FROM " + table + " WHERE application_id = ?", Integer.class, appId);
    }

    @Test
    void eachStageOwnerCanReturnFromItsOwnStageWithEventRecordAndTheAssignmentKept() {
        for (String stage : List.of("iame_scrutiny", "bee_scrutiny", "director_review", "secretary_approval")) {
            UUID id = at(stage, "RW-RET-" + stage);
            int before = version(id);
            var r = giveBack(id, stage);
            assertEquals(StageReturnRepository.Outcome.RETURNED, r.outcome(), stage);
            assertEquals(before + 1, r.versionAfter(), stage);
            assertEquals("returned", state(id), stage);
            var ev = owner.queryForMap("SELECT from_state, to_state, actor_account_id, actor_role FROM model_application_transition_event WHERE application_id = ? AND action = 'return'", id);
            assertEquals(stage, ev.get("from_state"));
            assertEquals("returned", ev.get("to_state"));
            assertEquals(OFFICER.get(stage), ev.get("actor_account_id"));
            assertEquals(ROLE.get(stage), ev.get("actor_role"));
            var rec = owner.queryForMap("SELECT returned_from_state, reason, fp_laboratory_code, fp_report_versions, returned_by_account_id FROM model_application_return WHERE application_id = ?", id);
            assertEquals(stage, rec.get("returned_from_state"));
            assertEquals("The report does not match the application.", rec.get("reason"));
            assertEquals("LAB", rec.get("fp_laboratory_code"), "the rating inputs are fingerprinted at the return");
            assertEquals(OFFICER.get(stage), rec.get("returned_by_account_id"));
        }
        UUID iame = at("iame_scrutiny", "RW-KEEP");
        giveBack(iame, "iame_scrutiny");
        assertEquals(1, owner.queryForObject("SELECT count(*) FROM assignment WHERE subject_id = ? AND stage = 'iame_scrutiny' AND active AND user_id = ?", Integer.class, iame, IAME_USER),
            "the officer's assignment is kept, so the same officer sees the application again when it comes back");
    }

    @Test
    void aReturnByAStaleVersionOrWrongStateWritesNothing() {
        UUID id = at("iame_scrutiny", "RW-STALE");
        assertEquals(StageReturnRepository.Outcome.STALE, returns.doReturn(id, version(id) - 1, IAME_USER, "iame", "iame_scrutiny", "r").outcome());
        assertEquals(StageReturnRepository.Outcome.STALE, returns.doReturn(id, version(id), REVIEWER_USER, "reviewer", "bee_scrutiny", "r").outcome(), "it is not in bee_scrutiny");
        assertEquals(0, count("model_application_return", id));
        assertEquals("iame_scrutiny", state(id));
        assertEquals(StageReturnRepository.Outcome.RETURNED, giveBack(id, "iame_scrutiny").outcome());
        assertEquals(StageReturnRepository.Outcome.STALE, giveBack(id, "iame_scrutiny").outcome(), "it is already returned");
        assertEquals(1, count("model_application_return", id));
    }

    @Test
    void anOfficerWhoReturnedACaseMayActOnItAgainButAnEarlierStageOfficerStillMayNot() {
        UUID id = at("director_review", "RW-AGAIN");
        giveBack(id, "director_review");
        assertEquals(false, returns.actorsAtOtherStages(id, "director_review").contains(DIRECTOR_USER), "a return is the officer's own stage, so it does not count as another stage");
        assertEquals(true, returns.actorsAtOtherStages(id, "director_review").containsAll(java.util.Set.of(NOVA_USER, FINANCE_USER, IAME_USER, REVIEWER_USER, PROGRAMME_USER)), "the earlier stages still do");
        assertEquals(false, directorRepo.actorsAtOtherStages(id).contains(DIRECTOR_USER));
        assertEquals(true, secretaryRepo.actorsAtOtherStages(id).contains(DIRECTOR_USER), "but a Director who returned it at the Director stage still cannot approve it as the Secretary: that is another stage");
    }

    @Test
    void anEarlierActionAtTheSameStageNeverBlocksButAnyOtherStageStillDoes() {
        UUID id = at("director_review", "RW-SAMESTAGE");
        // Programme rated once. When the rating is redone Programme acts at the same stage again, so it must not be refused...
        assertEquals(false, ratingRepo.actorsAtOtherStages(id).contains(PROGRAMME_USER), "Programme's own earlier rating is the same stage");
        assertEquals(true, ratingRepo.actorsAtOtherStages(id).containsAll(java.util.Set.of(NOVA_USER, FINANCE_USER, IAME_USER, REVIEWER_USER)), "the other stages still count");
        // ...but a person who took a different stage is still refused at this one.
        assertEquals(true, ratingRepo.actorsAtOtherStages(id).contains(REVIEWER_USER));
        assertEquals(true, directorRepo.actorsAtOtherStages(id).contains(PROGRAMME_USER), "Programme cannot also be the Director");
        assertEquals(false, directorRepo.actorsAtOtherStages(id).contains(DIRECTOR_USER));
        directorRepo.recommend(id, version(id), DIRECTOR_USER, "director", "n", false);
        assertEquals(false, directorRepo.actorsAtOtherStages(id).contains(DIRECTOR_USER), "after recommending, the Director is still not 'another stage' for the Director step");
        assertEquals(true, secretaryRepo.actorsAtOtherStages(id).contains(DIRECTOR_USER), "but the Director cannot also approve as the Secretary");
    }

    @Test
    void resubmitGoesBackToTheStageThatReturnedItWhenNoRatingInputChanged() {
        for (String stage : List.of("iame_scrutiny", "bee_scrutiny", "director_review", "secretary_approval")) {
            UUID id = at(stage, "RW-BACK-" + stage);
            giveBack(id, stage);
            int before = version(id);
            var open = resub.openReturn(id).orElseThrow();
            assertEquals(stage, open.returnedFromState());
            assertEquals(false, resub.ratingInputsChanged(id, open), "nothing changed: " + stage);
            var r = resubmit(id);
            assertEquals(ResubmitApplicationRepository.Outcome.RESUBMITTED, r.outcome(), stage);
            assertEquals(before + 1, r.versionAfter());
            assertEquals(stage, state(id), "back to the stage that returned it");
            var rec = owner.queryForMap("SELECT resumed_state, rating_superseded FROM model_application_resubmission WHERE application_id = ?", id);
            assertEquals(stage, rec.get("resumed_state"));
            assertEquals(false, rec.get("rating_superseded"));
            assertTrue(resub.openReturn(id).isEmpty(), "the return is answered");
            var ev = owner.queryForMap("SELECT from_state, to_state, actor_account_id FROM model_application_transition_event WHERE application_id = ? AND action = 'resubmit'", id);
            assertEquals("returned", ev.get("from_state"));
            assertEquals(stage, ev.get("to_state"));
            assertEquals(NOVA_USER, ev.get("actor_account_id"));
        }
    }

    @Test
    void aChangedRatingInputAfterTheRatingSendsItBackThroughRatingAndSupersedesTheEarlierRating() {
        for (String stage : List.of("director_review", "secretary_approval")) {
            UUID id = at(stage, "RW-SUP-" + stage);
            giveBack(id, stage);
            owner.update("UPDATE model_application SET declared_iseer = 4.80 WHERE id = ?", id);   // the applicant corrected the declared figure
            var open = resub.openReturn(id).orElseThrow();
            assertEquals(true, resub.ratingInputsChanged(id, open));
            assertEquals(ResubmitApplicationRepository.Outcome.RESUBMITTED, resubmit(id).outcome());
            assertEquals("rating", state(id), "through rating again, not straight back to " + stage);
            assertEquals(true, owner.queryForObject("SELECT rating_superseded FROM model_application_resubmission WHERE application_id = ?", Boolean.class, id));
            // Programme computes the new rating: version 2 beside the earlier version 1, which is kept.
            var again = ratingRepo.compute(id, version(id), PROGRAMME_USER, "programme", "RAC-ISEER-DEMO-1", new BigDecimal("4.80"), new BigDecimal("4.85"), 4);
            assertEquals(RatingRepository.Outcome.COMPUTED, again.outcome());
            assertEquals(2, again.ratingVersion());
            assertEquals(List.of(1, 2), owner.queryForList("SELECT rating_version FROM model_application_rating WHERE application_id = ? ORDER BY rating_version", Integer.class, id));
            assertEquals("director_review", state(id));
            // The Director who may have returned it can recommend again; the Secretary never sees the stale rating.
            assertEquals(DirectorRecommendationRepository.Outcome.RECOMMENDED, directorRepo.recommend(id, version(id), DIRECTOR_USER, "director", "n", false).outcome());
            assertEquals("secretary_approval", state(id));
        }
    }

    @Test
    void aChangeBeforeTheRatingExistedNeverSupersedesAnything() {
        UUID id = at("bee_scrutiny", "RW-EARLY");
        giveBack(id, "bee_scrutiny");
        owner.update("UPDATE model_application SET declared_iseer = 4.80 WHERE id = ?", id);
        assertEquals(ResubmitApplicationRepository.Outcome.RESUBMITTED, resubmit(id).outcome());
        assertEquals("bee_scrutiny", state(id), "no rating exists yet, so there is nothing to supersede");
        assertEquals(false, owner.queryForObject("SELECT rating_superseded FROM model_application_resubmission WHERE application_id = ?", Boolean.class, id));
        assertEquals(0, count("model_application_rating", id));
    }

    @Test
    void aReportAddedWhileReturnedCountsAsAChangedRatingInput() {
        UUID id = at("director_review", "RW-REPORT");
        giveBack(id, "director_review");
        var open = resub.openReturn(id).orElseThrow();
        assertEquals(false, resub.ratingInputsChanged(id, open));
        UUID doc = UUID.randomUUID();
        owner.update("INSERT INTO model_application_document (id, application_id, document_kind) VALUES (?, ?, 'test_report')", doc, id);
        owner.update("INSERT INTO model_application_document_version (id, document_id, version_number, content_sha256, size_bytes, media_type, original_filename, report_label, uploaded_by_account_id) "
            + "VALUES (?, ?, 1, ?, 10, 'application/pdf', 'r.pdf', 'r', ?)", UUID.randomUUID(), doc, "a".repeat(64), NOVA_USER);
        assertEquals(true, resub.ratingInputsChanged(id, open), "a new report version is a rating input");
    }

    @Test
    void anApplicantEditsWhileReturnedWithoutTouchingTheIdentityAndNeverAfterResubmission() {
        UUID id = at("iame_scrutiny", "RW-EDIT");
        assertTrue(applications.bumpReturned(id, NOVA, version(id)).isEmpty(), "not returned yet: nothing to edit");
        giveBack(id, "iame_scrutiny");
        int before = version(id);
        var bumped = applications.bumpReturned(id, NOVA, before).orElseThrow();
        assertEquals(before + 1, bumped.version());
        assertEquals("RW-EDIT", bumped.modelNumber(), "the model number is untouched");
        applications.setEvidence(id, NOVA, new ModelApplicationRepository.EvidenceUpdate(true, "LAB", false, null, true, new BigDecimal("4.70")));
        assertEquals(0, new BigDecimal("4.70").compareTo(owner.queryForObject("SELECT declared_iseer FROM model_application WHERE id = ?", BigDecimal.class, id)), "the evidence is editable while returned");
        assertTrue(applications.bumpReturned(id, NOVA, before).isEmpty(), "a stale version loses");
        assertEquals(ResubmitApplicationRepository.Outcome.RESUBMITTED, resubmit(id).outcome());
        assertTrue(applications.bumpReturned(id, NOVA, version(id)).isEmpty(), "never after resubmission");
        applications.setEvidence(id, NOVA, new ModelApplicationRepository.EvidenceUpdate(false, null, false, null, true, new BigDecimal("1.00")));
        assertEquals(0, new BigDecimal("4.70").compareTo(owner.queryForObject("SELECT declared_iseer FROM model_application WHERE id = ?", BigDecimal.class, id)), "and the evidence is frozen again");
    }

    @Test
    void aSecondResubmissionOfTheSameReturnIsRefused() {
        UUID id = at("iame_scrutiny", "RW-ONCE");
        giveBack(id, "iame_scrutiny");
        var open = resub.openReturn(id).orElseThrow();
        assertEquals(ResubmitApplicationRepository.Outcome.RESUBMITTED, resubmit(id).outcome());
        assertEquals(ResubmitApplicationRepository.Outcome.STALE, resub.resubmit(id, version(id), NOVA_USER, "manufacturer", open.id(), "iame_scrutiny", false, null).outcome(),
            "it is no longer returned");
        UUID event = owner.queryForObject("SELECT id FROM model_application_transition_event WHERE application_id = ? AND action = 'iame_recommend'", UUID.class, at("bee_scrutiny", "RW-ONCE2"));
        assertThrows(Exception.class, () -> owner.update(
            "INSERT INTO model_application_resubmission (application_id, return_id, transition_event_id, resumed_state, rating_superseded, resubmitted_by_account_id) VALUES (?, ?, ?, 'iame_scrutiny', false, ?)",
            id, open.id(), event, NOVA_USER), "one resubmission per return");
        assertEquals(1, count("model_application_resubmission", id));
    }

    @Test
    void theRecordsAreAppendOnlyAndRefuseBadValues() {
        UUID id = at("director_review", "RW-APPEND");
        giveBack(id, "director_review");
        resubmit(id);
        for (String table : List.of("model_application_return", "model_application_resubmission")) {
            assertThrows(Exception.class, () -> db.update("UPDATE " + table + " SET application_id = application_id"), table);
            assertThrows(Exception.class, () -> db.update("DELETE FROM " + table), table);
            assertThrows(Exception.class, () -> db.execute("TRUNCATE " + table), table);
            assertThrows(Exception.class, () -> owner.update("DELETE FROM " + table), table + " (the owner too)");
        }
        UUID other = at("iame_scrutiny", "RW-CHECKS");
        UUID event = owner.queryForObject("SELECT id FROM model_application_transition_event WHERE application_id = ? AND action = 'confirm_fee'", UUID.class, other);
        String ret = "INSERT INTO model_application_return (application_id, transition_event_id, returned_from_state, reason, fp_report_versions, returned_by_account_id) VALUES (?, ?, ?, ?, 0, ?)";
        assertThrows(Exception.class, () -> owner.update(ret, other, event, "rating", "r", IAME_USER), "only the four owner stages return");
        assertThrows(Exception.class, () -> owner.update(ret, other, event, "iame_scrutiny", "", IAME_USER), "a reason is required");
        assertThrows(Exception.class, () -> owner.update(ret, other, event, "iame_scrutiny", "x".repeat(501), IAME_USER), "and is at most 500 characters");
        giveBack(other, "iame_scrutiny");
        UUID rid = resub.openReturn(other).orElseThrow().id();
        UUID rEvent = owner.queryForObject("SELECT id FROM model_application_transition_event WHERE application_id = ? AND action = 'iame_recommend'", UUID.class, at("bee_scrutiny", "RW-CHECKS2"));
        String re = "INSERT INTO model_application_resubmission (application_id, return_id, transition_event_id, resumed_state, rating_superseded, resubmitted_by_account_id) VALUES (?, ?, ?, ?, ?, ?)";
        assertThrows(Exception.class, () -> owner.update(re, other, rid, rEvent, "approved", false, NOVA_USER), "it can only resume at a working stage");
        assertThrows(Exception.class, () -> owner.update(re, other, rid, rEvent, "bee_scrutiny", true, NOVA_USER), "superseded means it went through rating");
    }

    @Test
    void twoSimultaneousReturnsHaveExactlyOneWinner() throws Exception {
        UUID id = at("iame_scrutiny", "RW-RACE");
        int v = version(id);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        CountDownLatch go = new CountDownLatch(1);
        try {
            List<Future<StageReturnRepository.Outcome>> results = List.of(
                pool.submit(() -> { go.await(); return returns.doReturn(id, v, IAME_USER, "iame", "iame_scrutiny", "r").outcome(); }),
                pool.submit(() -> { go.await(); return returns.doReturn(id, v, IAME_USER, "iame", "iame_scrutiny", "r").outcome(); }));
            go.countDown();
            List<StageReturnRepository.Outcome> outcomes = List.of(results.get(0).get(10, TimeUnit.SECONDS), results.get(1).get(10, TimeUnit.SECONDS));
            assertEquals(1, outcomes.stream().filter(o -> o == StageReturnRepository.Outcome.RETURNED).count(), outcomes.toString());
            assertEquals(1, outcomes.stream().filter(o -> o == StageReturnRepository.Outcome.STALE).count(), outcomes.toString());
        } finally {
            pool.shutdownNow();
        }
        assertEquals(1, count("model_application_return", id));
    }

    @Test
    void disposableCleanupRemovesTheNewRowsAndOnlyForRegisteredApplications() {
        UUID id = at("director_review", "RW-CLEAN");
        giveBack(id, "director_review");
        resubmit(id);
        int seededAssignments = owner.queryForObject("SELECT count(*) FROM assignment WHERE subject_id <> ?", Integer.class, id);
        var maint = new JdbcTemplate(sourceAs(MAIN, env("BEE_MAINT_DB_USER", "bee_local_maint"), env("BEE_MAINT_DB_PASSWORD", "bee-local-maint")));
        maint.execute(
            "SELECT set_config('bee.cleanup_schema', '" + MAIN + "', true); "
                + "INSERT INTO " + MAIN + ".local_disposable_application (application_id) VALUES ('" + id + "'); "
                + "SELECT " + MAIN + ".app_disposable_model_cleanup(ARRAY['" + id + "']::uuid[])");
        for (String table : List.of("model_application_resubmission", "model_application_return", "model_application_secretary_approval", "model_application_director_recommendation",
            "model_application_rating", "model_application_reviewer_forward", "model_application_iame_recommendation", "model_application_transition_event", "model_application_fee_confirmation")) {
            assertEquals(0, count(table, id), table);
        }
        assertEquals(0, owner.queryForObject("SELECT count(*) FROM model_application WHERE id = ?", Integer.class, id));
        assertEquals(seededAssignments, owner.queryForObject("SELECT count(*) FROM assignment", Integer.class), "seeded assignments are untouched");
        assertFalse(owner.queryForObject("SELECT has_function_privilege('" + env("BEE_RUNTIME_DB_USER", "bee_runtime") + "', '" + MAIN + ".app_disposable_model_cleanup(uuid[])', 'EXECUTE')", Boolean.class));
    }

    static StageRejectRepository.Result reject(UUID id, String stage) {
        return rejects.doReject(id, version(id), OFFICER.get(stage), ROLE.get(stage), stage, "The report is for a different model.");
    }

    @Test
    void eachStageOwnerIncludingProgrammeCanRejectPermanentlyWithEventRecordAndAssignmentsClosed() {
        for (String stage : List.of("iame_scrutiny", "bee_scrutiny", "rating", "director_review", "secretary_approval")) {
            UUID id = at(stage, "RW-REJ-" + stage);
            int before = version(id);
            var r = reject(id, stage);
            assertEquals(StageRejectRepository.Outcome.REJECTED, r.outcome(), stage);
            assertEquals(before + 1, r.versionAfter(), stage);
            assertEquals("rejected", state(id), stage);
            var ev = owner.queryForMap("SELECT from_state, to_state, actor_account_id, actor_role FROM model_application_transition_event WHERE application_id = ? AND action = 'reject'", id);
            assertEquals(stage, ev.get("from_state"));
            assertEquals("rejected", ev.get("to_state"));
            assertEquals(OFFICER.get(stage), ev.get("actor_account_id"));
            assertEquals(ROLE.get(stage), ev.get("actor_role"));
            var rec = owner.queryForMap("SELECT rejected_from_state, reason, rejected_by_account_id FROM model_application_rejection WHERE application_id = ?", id);
            assertEquals(stage, rec.get("rejected_from_state"));
            assertEquals("The report is for a different model.", rec.get("reason"));
            assertEquals(OFFICER.get(stage), rec.get("rejected_by_account_id"));
            assertEquals(0, owner.queryForObject("SELECT count(*) FROM assignment WHERE subject_id = ? AND active", Integer.class, id), "nothing is left to do, so no assignment stays open: " + stage);
        }
    }

    @Test
    void rejectedIsTerminalNothingAppliesToItAnyMore() {
        UUID id = at("iame_scrutiny", "RW-TERMINAL");
        reject(id, "iame_scrutiny");
        int v = version(id);
        assertEquals(StageReturnRepository.Outcome.STALE, returns.doReturn(id, v, IAME_USER, "iame", "iame_scrutiny", "r").outcome(), "cannot be returned");
        assertEquals(StageRejectRepository.Outcome.STALE, reject(id, "iame_scrutiny").outcome(), "cannot be rejected twice");
        assertEquals(IameRecommendationRepository.Outcome.STALE, iameRepo.recommend(id, v, IAME_USER, "iame", "verified", "n").outcome(), "cannot move forward");
        assertTrue(resub.openReturn(id).isEmpty(), "there is nothing to resubmit");
        assertTrue(applications.bumpReturned(id, NOVA, v).isEmpty(), "and nothing to edit");
        assertEquals(1, count("model_application_rejection", id));
    }

    @Test
    void aReturnedApplicationCannotBeRejectedBecauseNoOneHoldsItsStage() {
        UUID id = at("director_review", "RW-NOT-RETURNED");
        giveBack(id, "director_review");
        assertEquals(StageRejectRepository.Outcome.STALE, rejects.doReject(id, version(id), DIRECTOR_USER, "director", "director_review", "r").outcome());
        assertEquals("returned", state(id));
        assertEquals(0, count("model_application_rejection", id));
    }

    @Test
    void aRejectionByAStaleVersionOrWrongStateWritesNothing() {
        UUID id = at("rating", "RW-REJ-STALE");
        assertEquals(StageRejectRepository.Outcome.STALE, rejects.doReject(id, version(id) - 1, PROGRAMME_USER, "programme", "rating", "r").outcome());
        assertEquals(StageRejectRepository.Outcome.STALE, rejects.doReject(id, version(id), DIRECTOR_USER, "director", "director_review", "r").outcome(), "it is not in director_review");
        assertEquals("rating", state(id));
        assertEquals(0, count("model_application_rejection", id));
        assertEquals(1, owner.queryForObject("SELECT count(*) FROM assignment WHERE subject_id = ? AND stage = 'bee_scrutiny'", Integer.class, id), "the earlier assignment record is unchanged");
    }

    @Test
    void rejectingFreesTheModelNumberForANewApplication() {
        UUID id = at("iame_scrutiny", "RW-FREED");
        UUID brand = NOVA_COOL;
        assertEquals(true, applications.modelNumberTaken(brand, "RW-FREED", UUID.randomUUID()), "while it is live the number is taken");
        reject(id, "iame_scrutiny");
        assertEquals(false, applications.modelNumberTaken(brand, "RW-FREED", UUID.randomUUID()), "once rejected a new application may use it");
        UUID again = UUID.randomUUID();
        applications.insertDraft(again, applications.nextReference(), NOVA, NOVA, NOVA_COOL, "Nova Cool", "RAC", "RW-FREED");
        applications.setEvidence(again, NOVA, new ModelApplicationRepository.EvidenceUpdate(true, "LAB", true, LocalDate.of(2026, 9, 1), true, DECLARED));
        assertTrue(submissions.submit(again, NOVA, 0, NOVA_USER, "manufacturer", new BigDecimal("24000.00"), "RAC:new_model", 2, "provisional", "ref", "note").isPresent(),
            "and the new application can be submitted");
    }

    @Test
    void anActorsOwnStageNeverCountsAgainstThemButAnotherStageDoes() {
        UUID id = at("director_review", "RW-REJ-ACTORS");   // Programme has already rated it
        assertEquals(false, rejects.actorsAtOtherStages(id, "rating").contains(PROGRAMME_USER), "Programme rejecting at the rating stage: its own rating is the same stage");
        assertEquals(true, rejects.actorsAtOtherStages(id, "rating").containsAll(java.util.Set.of(NOVA_USER, FINANCE_USER, IAME_USER, REVIEWER_USER)), "the earlier stages count");
        assertEquals(true, rejects.actorsAtOtherStages(id, "director_review").contains(PROGRAMME_USER), "but Programme cannot also be the Director");
        assertEquals(false, rejects.actorsAtOtherStages(id, "director_review").contains(DIRECTOR_USER));
    }

    @Test
    void theRejectionIsAppendOnlyOnePerApplicationAndRefusesBadValues() {
        UUID id = at("director_review", "RW-REJ-APPEND");
        reject(id, "director_review");
        assertThrows(Exception.class, () -> db.update("UPDATE model_application_rejection SET reason = 'x'"));
        assertThrows(Exception.class, () -> db.update("DELETE FROM model_application_rejection"));
        assertThrows(Exception.class, () -> db.execute("TRUNCATE model_application_rejection"));
        assertThrows(Exception.class, () -> owner.update("DELETE FROM model_application_rejection"), "the owner too");
        UUID other = at("iame_scrutiny", "RW-REJ-CHECKS");
        UUID event = owner.queryForObject("SELECT id FROM model_application_transition_event WHERE application_id = ? AND action = 'confirm_fee'", UUID.class, other);
        String sql = "INSERT INTO model_application_rejection (application_id, transition_event_id, rejected_from_state, reason, rejected_by_account_id) VALUES (?, ?, ?, ?, ?)";
        assertThrows(Exception.class, () -> owner.update(sql, other, event, "fee_due", "r", IAME_USER), "only the working stages reject");
        assertThrows(Exception.class, () -> owner.update(sql, other, event, "approved", "r", IAME_USER));
        assertThrows(Exception.class, () -> owner.update(sql, other, event, "iame_scrutiny", "", IAME_USER), "a reason is required");
        assertThrows(Exception.class, () -> owner.update(sql, other, event, "iame_scrutiny", "x".repeat(501), IAME_USER), "and is at most 500 characters");
        assertEquals(0, count("model_application_rejection", other));
        reject(other, "iame_scrutiny");
        UUID third = at("bee_scrutiny", "RW-REJ-ONCE");
        UUID e3 = owner.queryForObject("SELECT id FROM model_application_transition_event WHERE application_id = ? AND action = 'iame_recommend'", UUID.class, third);
        assertThrows(Exception.class, () -> owner.update(sql, other, e3, "iame_scrutiny", "a second rejection", IAME_USER), "one rejection per application");
    }

    @Test
    void twoSimultaneousRejectionsHaveExactlyOneWinner() throws Exception {
        UUID id = at("rating", "RW-REJ-RACE");
        int v = version(id);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        CountDownLatch go = new CountDownLatch(1);
        try {
            List<Future<StageRejectRepository.Outcome>> results = List.of(
                pool.submit(() -> { go.await(); return rejects.doReject(id, v, PROGRAMME_USER, "programme", "rating", "r").outcome(); }),
                pool.submit(() -> { go.await(); return rejects.doReject(id, v, PROGRAMME_USER, "programme", "rating", "r").outcome(); }));
            go.countDown();
            List<StageRejectRepository.Outcome> outcomes = List.of(results.get(0).get(10, TimeUnit.SECONDS), results.get(1).get(10, TimeUnit.SECONDS));
            assertEquals(1, outcomes.stream().filter(o -> o == StageRejectRepository.Outcome.REJECTED).count(), outcomes.toString());
            assertEquals(1, outcomes.stream().filter(o -> o == StageRejectRepository.Outcome.STALE).count(), outcomes.toString());
        } finally {
            pool.shutdownNow();
        }
        assertEquals(1, count("model_application_rejection", id));
    }

    @Test
    void theCleanupAlsoRemovesTheRejection() {
        UUID id = at("secretary_approval", "RW-REJ-CLEAN");
        reject(id, "secretary_approval");
        var maint = new JdbcTemplate(sourceAs(MAIN, env("BEE_MAINT_DB_USER", "bee_local_maint"), env("BEE_MAINT_DB_PASSWORD", "bee-local-maint")));
        maint.execute(
            "SELECT set_config('bee.cleanup_schema', '" + MAIN + "', true); "
                + "INSERT INTO " + MAIN + ".local_disposable_application (application_id) VALUES ('" + id + "'); "
                + "SELECT " + MAIN + ".app_disposable_model_cleanup(ARRAY['" + id + "']::uuid[])");
        assertEquals(0, count("model_application_rejection", id));
        assertEquals(0, count("model_application_transition_event", id));
        assertEquals(0, owner.queryForObject("SELECT count(*) FROM model_application WHERE id = ?", Integer.class, id));
    }

    @Test
    void theHistoryJoinsEachStepToItsOwnRecordInOrderWithWhoTookIt() {
        UUID id = at("secretary_approval", "RW-HIST");
        giveBack(id, "secretary_approval");
        resubmit(id);
        secretaryRepo.approve(id, version(id), SECRETARY_USER, "secretary", "Approved after the correction.");
        var rows = history.events(id);
        assertEquals(List.of("submit", "confirm_fee", "iame_recommend", "reviewer_forward", "compute_rating", "director_recommend", "return", "resubmit", "secretary_approve"),
            rows.stream().map(HistoryRepository.Row::action).toList(), "every step in order, the submission first");
        assertEquals(List.of("draft", "fee_due", "iame_scrutiny", "bee_scrutiny", "rating", "director_review", "secretary_approval", "returned", "secretary_approval"),
            rows.stream().map(HistoryRepository.Row::fromState).toList());
        assertEquals(List.of("fee_due", "iame_scrutiny", "bee_scrutiny", "rating", "director_review", "secretary_approval", "returned", "secretary_approval", "approved"),
            rows.stream().map(HistoryRepository.Row::toState).toList());
        for (int i = 1; i < rows.size(); i++) {
            assertTrue(!rows.get(i).at().isBefore(rows.get(i - 1).at()), "time never goes backwards");
        }
        var byAction = rows.stream().collect(java.util.stream.Collectors.toMap(HistoryRepository.Row::action, r -> r));
        assertEquals("manufacturer", byAction.get("submit").actorRole());
        assertEquals("finance", byAction.get("confirm_fee").actorRole());
        assertEquals(owner.queryForObject("SELECT display_name FROM user_account WHERE id = ?", String.class, FINANCE_USER), byAction.get("confirm_fee").actorName(), "the actor's display name");
        assertTrue(byAction.get("confirm_fee").actorOrganisation() != null, "and the organisation they belong to");
        assertTrue(byAction.get("confirm_fee").receiptReference().startsWith("UTR-"), "the fee step carries its receipt");
        assertEquals(0, new BigDecimal("24000.00").compareTo(byAction.get("confirm_fee").feeAmount()));
        assertEquals("verified", byAction.get("iame_recommend").iameVerification());
        assertEquals("n", byAction.get("iame_recommend").iameNote());
        assertEquals(4, byAction.get("compute_rating").stars());
        assertEquals(1, byAction.get("compute_rating").ratingVersion());
        assertEquals(0, new BigDecimal("4.62").compareTo(byAction.get("compute_rating").verifiedIseer()));
        assertEquals(false, byAction.get("director_recommend").directorFinal());
        assertEquals("The report does not match the application.", byAction.get("return").returnReason(), "the reason of the return");
        assertEquals(false, byAction.get("resubmit").ratingSuperseded());
        assertEquals("Approved after the correction.", byAction.get("secretary_approve").secretaryNote());
        // A step carries only its own record: nothing leaks across steps.
        assertEquals(null, byAction.get("confirm_fee").iameNote());
        assertEquals(null, byAction.get("return").secretaryNote());
        assertEquals(null, byAction.get("secretary_approve").returnReason());
    }

    @Test
    void aRedoneRatingShowsBothRatingsEachWithItsOwnFigures() {
        UUID id = at("director_review", "RW-HIST-RATING");
        giveBack(id, "director_review");
        owner.update("UPDATE model_application SET declared_iseer = 4.80 WHERE id = ?", id);
        resubmit(id);
        ratingRepo.compute(id, version(id), PROGRAMME_USER, "programme", "RAC-ISEER-DEMO-1", new BigDecimal("4.80"), new BigDecimal("4.85"), 4);
        var ratings = history.events(id).stream().filter(r -> r.action().equals("compute_rating")).toList();
        assertEquals(2, ratings.size());
        assertEquals(List.of(1, 2), ratings.stream().map(HistoryRepository.Row::ratingVersion).toList());
        assertEquals(0, new BigDecimal("4.62").compareTo(ratings.get(0).verifiedIseer()));
        assertEquals(0, new BigDecimal("4.85").compareTo(ratings.get(1).verifiedIseer()));
        var resub = history.events(id).stream().filter(r -> r.action().equals("resubmit")).findFirst().orElseThrow();
        assertEquals(true, resub.ratingSuperseded(), "and the resubmission says the rating was replaced");
        assertEquals("rating", resub.toState());
    }

    @Test
    void aRejectedApplicationsHistoryEndsInTheRejectionWithItsReason() {
        UUID id = at("rating", "RW-HIST-REJECT");
        reject(id, "rating");
        var rows = history.events(id);
        var last = rows.get(rows.size() - 1);
        assertEquals("reject", last.action());
        assertEquals("rating", last.fromState());
        assertEquals("rejected", last.toState());
        assertEquals("programme", last.actorRole());
        assertEquals("The report is for a different model.", last.rejectReason());
    }

    @Test
    void theHistoryOfOneApplicationNeverIncludesAnotherAndAnUnknownOneIsEmpty() {
        UUID a = at("iame_scrutiny", "RW-HIST-A");
        UUID b = at("bee_scrutiny", "RW-HIST-B");
        assertEquals(2, history.events(a).size());
        assertEquals(3, history.events(b).size());
        assertEquals(List.of(), history.events(UUID.randomUUID()));
    }
}
