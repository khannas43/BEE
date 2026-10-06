package gov.bee.api.feecorrections;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import gov.bee.api.application.ModelApplicationRepository;
import gov.bee.api.application.ModelApplicationSubmitRepository;
import gov.bee.api.feecorrections.FeeCorrectionRepository.NewProposal;
import gov.bee.api.feecorrections.FeeCorrectionRepository.Outcome;
import gov.bee.api.finance.FeeConfirmationRepository;
import gov.bee.api.history.HistoryRepository;
import java.math.BigDecimal;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDate;
import java.util.HexFormat;
import java.util.UUID;
import java.util.concurrent.ThreadLocalRandom;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

/**
 * Corrections to a fee confirmation against throwaway PostgreSQL: the confirmation is never edited, a different permission holder
 * decides, nobody from the paying organisation or from another stage of the application may, and one correction waits at a time.
 * The shared app schema is untouched.
 */
@Tag("db")
class FeeCorrectionDatabaseTest {

    static final String TAG = HexFormat.of().toHexDigits(ThreadLocalRandom.current().nextInt());
    static final String MAIN = "wp08d_test_" + TAG;
    static final Path SEED = Path.of("..", "local", "seed", "seed.sql");
    static final UUID NOVA = UUID.fromString("00000000-0000-4000-b000-000000000001");
    static final UUID NOVA_USER = UUID.fromString("00000000-0000-4000-a000-000000000001");
    static final UUID FINANCE_USER = UUID.fromString("00000000-0000-4000-a000-000000000003");
    static final UUID IAME_USER = UUID.fromString("00000000-0000-4000-a000-000000000004");
    static final UUID PROGRAMME_USER = UUID.fromString("00000000-0000-4000-a000-000000000006");
    static final UUID NOVA_COOL = UUID.fromString("00000000-0000-4000-d000-000000000001");
    static final LocalDate RECEIVED = LocalDate.of(2026, 10, 2);

    static JdbcTemplate admin;
    static JdbcTemplate owner;
    static JdbcTemplate db;
    static DriverManagerDataSource runtime;
    static ModelApplicationRepository applications;
    static ModelApplicationSubmitRepository submissions;
    static FeeConfirmationRepository confirmations;
    static FeeCorrectionRepository repo;
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
        confirmations = new FeeConfirmationRepository(db);
        repo = new FeeCorrectionRepository(db);
        assertEquals(40, owner.queryForObject("SELECT max(installed_rank) FROM flyway_schema_history", Integer.class), "migrated V1 through V40");
    }

    @AfterAll
    static void dropAndAssertAppUntouched() {
        if (admin != null) {
            admin.execute("DROP SCHEMA IF EXISTS " + MAIN + " CASCADE");
            assertEquals(appModelCountBefore, admin.queryForObject("SELECT count(*) FROM app.model_application", Integer.class));
        }
    }

    /** An application the applicant submitted and Finance confirmed (now in IAME scrutiny). */
    static UUID confirmed(String model) {
        UUID id = UUID.randomUUID();
        applications.insertDraft(id, applications.nextReference(), NOVA, NOVA, NOVA_COOL, "Nova Cool", "RAC", model);
        assertTrue(submissions.submit(id, NOVA, 0, NOVA_USER, "manufacturer", new BigDecimal("24000.00"), "RAC:new_model", 2, "provisional", "ref", "note").isPresent());
        UUID snapshot = submissions.findFeeSnapshot(id).orElseThrow().id();
        var done = confirmations.confirm(id, 1, FINANCE_USER, "finance", snapshot, new BigDecimal("24000.00"), "UTR-WRONG-" + id.toString().substring(0, 4), RECEIVED);
        assertEquals(FeeConfirmationRepository.Outcome.CONFIRMED, done.outcome());
        return id;
    }

    static NewProposal fix(UUID app, String receipt, LocalDate on) {
        var c = repo.confirmationOf(app).orElseThrow();
        return new NewProposal(app, c.confirmationId(), c.effectiveReceiptReference(), c.effectiveReceivedOn(), receipt, on, "The reference was mistyped");
    }

    static void grant(String role) {
        owner.update("INSERT INTO capability_grant (capability, role) VALUES ('fee_confirmation_correct', ?) ON CONFLICT DO NOTHING", role);
    }

    static void revoke(String role) {
        owner.update("DELETE FROM capability_grant WHERE capability = 'fee_confirmation_correct' AND role = ?", role);
    }

    @Test
    void financeHoldsThePermissionAndTheConfirmationIsListedWithItsEffectiveValues() {
        assertEquals(java.util.Set.of("finance"), repo.rolesHolding(FeeCorrectionRepository.CAPABILITY));
        UUID app = confirmed("NC-FC-LIST");
        var c = repo.confirmationOf(app).orElseThrow();
        assertEquals(c.receiptReference(), c.effectiveReceiptReference());
        assertEquals(RECEIVED, c.effectiveReceivedOn());
        assertNull(c.pendingProposalId());
        assertTrue(repo.recentConfirmations(50).stream().anyMatch(x -> x.applicationId().equals(app)));
    }

    @Test
    void anApprovedCorrectionChangesTheEffectiveValuesAndNeverTheConfirmation() {
        grant("programme");
        try {
            UUID app = confirmed("NC-FC-APPROVE");
            var before = repo.confirmationOf(app).orElseThrow();
            var p = repo.insert(FINANCE_USER, fix(app, "UTR-RIGHT-1", RECEIVED.minusDays(1)));
            assertEquals("pending", p.state());
            assertEquals(before.receiptReference(), p.previousReceiptReference());
            assertNotNull(repo.confirmationOf(app).orElseThrow().pendingProposalId());
            var done = repo.decide(p.id(), PROGRAMME_USER, "approve", "checked against the bank statement");
            assertEquals(Outcome.DONE, done.outcome());
            assertEquals("approved", done.state());
            var after = repo.confirmationOf(app).orElseThrow();
            assertEquals("UTR-RIGHT-1", after.effectiveReceiptReference());
            assertEquals(RECEIVED.minusDays(1), after.effectiveReceivedOn());
            // The confirmation itself is exactly as Finance wrote it.
            assertEquals(before.receiptReference(), after.receiptReference());
            assertEquals(RECEIVED, after.receivedOn());
            assertEquals(before.amountInr(), after.amountInr());
            assertNull(after.pendingProposalId());
            // A second correction starts from the corrected values, and the latest approved one wins.
            var second = repo.insert(FINANCE_USER, fix(app, "UTR-RIGHT-2", RECEIVED));
            assertEquals("UTR-RIGHT-1", second.previousReceiptReference());
            assertEquals(Outcome.DONE, repo.decide(second.id(), PROGRAMME_USER, "approve", null).outcome());
            assertEquals("UTR-RIGHT-2", repo.confirmationOf(app).orElseThrow().effectiveReceiptReference());
            // The history shows the correction beside the confirmation.
            var hist = new HistoryRepository(db).events(app).stream().filter(e -> e.action().equals("confirm_fee")).findFirst().orElseThrow();
            assertEquals("UTR-RIGHT-2", hist.correctedReceiptReference());
            assertEquals(before.receiptReference(), hist.receiptReference());
        } finally {
            revoke("programme");
        }
    }

    @Test
    void theProposerCannotApproveOrRejectTheirOwnCorrectionButMayWithdrawIt() {
        grant("programme");
        try {
            UUID app = confirmed("NC-FC-OWN");
            var p = repo.insert(FINANCE_USER, fix(app, "UTR-X1", RECEIVED));
            assertEquals(Outcome.SAME_PERSON, repo.decide(p.id(), FINANCE_USER, "approve", null).outcome());
            assertEquals(Outcome.SAME_PERSON, repo.decide(p.id(), FINANCE_USER, "reject", null).outcome());
            assertEquals(Outcome.ONLY_PROPOSER, repo.decide(p.id(), PROGRAMME_USER, "withdraw", null).outcome());
            assertEquals("withdrawn", repo.decide(p.id(), FINANCE_USER, "withdraw", "mistake").state());
            assertEquals(Outcome.NOT_PENDING, repo.decide(p.id(), PROGRAMME_USER, "approve", null).outcome(), "a decided proposal is final");
            assertEquals("UTR-X1".equals(repo.confirmationOf(app).orElseThrow().effectiveReceiptReference()), false, "a withdrawn correction changes nothing");
        } finally {
            revoke("programme");
        }
    }

    @Test
    void aSecondPersonMayRejectAndOnlyHoldersOfThePermissionMayDecide() {
        grant("programme");
        try {
            UUID app = confirmed("NC-FC-REJECT");
            var p = repo.insert(FINANCE_USER, fix(app, "UTR-Y1", RECEIVED));
            assertEquals(Outcome.NOT_PERMITTED, repo.decide(p.id(), IAME_USER, "approve", null).outcome(), "the IAME officer holds no such permission");
            assertEquals("rejected", repo.decide(p.id(), PROGRAMME_USER, "reject", "the statement shows the original").state());
            assertEquals("the statement shows the original", repo.proposal(p.id()).orElseThrow().decisionNote());
        } finally {
            revoke("programme");
        }
        UUID app2 = confirmed("NC-FC-NOGRANT");
        var q = repo.insert(FINANCE_USER, fix(app2, "UTR-Y2", RECEIVED));
        assertEquals(Outcome.NOT_PERMITTED, repo.decide(q.id(), PROGRAMME_USER, "approve", null).outcome(), "the permission follows the grant");
        repo.decide(q.id(), FINANCE_USER, "withdraw", null);
    }

    @Test
    void nobodyFromThePayingOrganisationOrFromAnotherStageMayDecide() {
        grant("manufacturer");
        grant("iame");
        try {
            UUID app = confirmed("NC-FC-SEG");
            assertTrue(repo.segregated(app, NOVA_USER), "the applicant's own organisation");
            assertFalse(repo.segregated(app, PROGRAMME_USER));
            var p = repo.insert(FINANCE_USER, fix(app, "UTR-Z1", RECEIVED));
            assertEquals(Outcome.SEGREGATED, repo.decide(p.id(), NOVA_USER, "approve", null).outcome());
            // An officer who acted at another stage of this application is refused too.
            owner.update("INSERT INTO model_application_transition_event (application_id, action, from_state, to_state, actor_account_id, actor_role, version_after) "
                + "VALUES (?, 'iame_recommend', 'iame_scrutiny', 'bee_scrutiny', ?, 'iame', 99)", app, IAME_USER);
            assertTrue(repo.segregated(app, IAME_USER));
            assertEquals(Outcome.SEGREGATED, repo.decide(p.id(), IAME_USER, "approve", null).outcome());
            assertEquals("pending", repo.proposal(p.id()).orElseThrow().state(), "a refused decision changes nothing");
            repo.decide(p.id(), FINANCE_USER, "withdraw", null);
        } finally {
            revoke("manufacturer");
            revoke("iame");
        }
    }

    @Test
    void oneCorrectionWaitsPerConfirmationAndAnUnchangedCorrectionIsRefused() {
        UUID app = confirmed("NC-FC-ONE");
        var first = repo.insert(FINANCE_USER, fix(app, "UTR-W1", RECEIVED));
        assertThrows(Exception.class, () -> repo.insert(FINANCE_USER, fix(app, "UTR-W2", RECEIVED)), "a second pending correction for the same confirmation");
        repo.decide(first.id(), FINANCE_USER, "withdraw", null);
        var c = repo.confirmationOf(app).orElseThrow();
        assertThrows(Exception.class, () -> repo.insert(FINANCE_USER, new NewProposal(app, c.confirmationId(), c.effectiveReceiptReference(), c.effectiveReceivedOn(),
            c.effectiveReceiptReference(), c.effectiveReceivedOn(), "no change")), "a correction that changes nothing");
    }

    @Test
    void theRuntimeLoginCanOnlyAddAProposalNeverEditOrDeleteOne() {
        UUID app = confirmed("NC-FC-PRIV");
        var p = repo.insert(FINANCE_USER, fix(app, "UTR-V1", RECEIVED));
        assertThrows(Exception.class, () -> db.update("UPDATE fee_correction_proposal SET state = 'approved' WHERE id = ?", p.id()));
        assertThrows(Exception.class, () -> db.update("DELETE FROM fee_correction_proposal WHERE id = ?", p.id()));
        assertThrows(Exception.class, () -> db.update("UPDATE model_application_fee_confirmation SET receipt_reference = 'EDITED' WHERE application_id = ?", app));
        repo.decide(p.id(), FINANCE_USER, "withdraw", null);
    }

    @Test
    void disposableCleanupRemovesTheCorrectionsOfARegisteredApplicationToo() {
        UUID app = confirmed("NC-FC-CLEAN");
        repo.insert(FINANCE_USER, fix(app, "UTR-U1", RECEIVED));
        assertEquals(1, owner.queryForObject("SELECT count(*) FROM fee_correction_proposal WHERE application_id = ?", Integer.class, app));
        var maint = new JdbcTemplate(sourceAs(MAIN, env("BEE_MAINT_DB_USER", "bee_local_maint"), env("BEE_MAINT_DB_PASSWORD", "bee-local-maint")));
        maint.execute("SELECT set_config('bee.cleanup_schema', '" + MAIN + "', true); INSERT INTO " + MAIN + ".local_disposable_application (application_id) VALUES ('" + app + "'); "
            + "SELECT " + MAIN + ".app_disposable_model_cleanup(ARRAY['" + app + "']::uuid[])");
        assertEquals(0, owner.queryForObject("SELECT count(*) FROM fee_correction_proposal WHERE application_id = ?", Integer.class, app));
        assertEquals(0, owner.queryForObject("SELECT count(*) FROM model_application WHERE id = ?", Integer.class, app));
    }

    // ---- BL-142: reversing a fee confirmation recorded in error (the owner's assumption B17) ----
    static FeeCorrectionRepository.Reversal reverseProposal(UUID app) {
        var c = repo.confirmationOf(app).orElseThrow();
        return repo.insertReversal(FINANCE_USER, app, c.confirmationId(), "No money was received");
    }

    static int versionOf(UUID app) {
        return owner.queryForObject("SELECT version FROM model_application WHERE id = ?", Integer.class, app);
    }

    static String stateOf(UUID app) {
        return owner.queryForObject("SELECT state FROM model_application WHERE id = ?", String.class, app);
    }

    @Test
    void anApprovedReversalMovesTheApplicationBackToFeeDueReleasesTheOfficerTellsTheApplicantAndNeverEditsTheConfirmation() {
        grant("programme");
        try {
            UUID app = confirmed("NC-FR-OK");
            assertEquals("iame_scrutiny", stateOf(app));
            assertEquals(1, owner.queryForObject("SELECT count(*) FROM assignment WHERE subject_id = ? AND stage = 'iame_scrutiny' AND active", Integer.class, app));
            int before = versionOf(app);
            var confirmation = repo.confirmationOf(app).orElseThrow();
            var p = reverseProposal(app);
            assertEquals("pending", p.state());
            assertNotNull(repo.confirmationOf(app).orElseThrow().pendingReversalId());
            assertTrue(repo.reversalPossible(app, confirmation.confirmationId()));
            var done = repo.decideReversal(p.id(), PROGRAMME_USER, "approve", "checked against the bank statement");
            assertEquals(FeeCorrectionRepository.ReversalOutcome.DONE, done.outcome());
            assertEquals("fee_due", stateOf(app));
            assertEquals(before + 1, versionOf(app));
            var ev = owner.queryForMap("SELECT action, from_state, to_state, actor_account_id, actor_role FROM model_application_transition_event WHERE application_id = ? AND action = 'reverse_fee'", app);
            assertEquals("iame_scrutiny", ev.get("from_state"));
            assertEquals("fee_due", ev.get("to_state"));
            assertEquals(PROGRAMME_USER, ev.get("actor_account_id"));
            assertEquals(0, owner.queryForObject("SELECT count(*) FROM assignment WHERE subject_id = ? AND stage = 'iame_scrutiny' AND active", Integer.class, app), "the officer is released");
            // The confirmation is exactly as written; it is now reversed, so it is no longer the one in effect.
            assertEquals(1, owner.queryForObject("SELECT count(*) FROM model_application_fee_confirmation WHERE application_id = ? AND receipt_reference = ?", Integer.class, app, confirmation.receiptReference()));
            assertTrue(repo.confirmationOf(app).isEmpty(), "no confirmation is in effect until Finance confirms again");
            var listed = repo.recentConfirmations(50).stream().filter(x -> x.applicationId().equals(app)).findFirst().orElseThrow();
            assertTrue(listed.reversed());
            assertNotNull(listed.reversedBy());
            // The applicant's organisation is told the fee is due again, without Finance's reason.
            var told = owner.queryForList("SELECT message FROM notification WHERE application_id = ? AND kind = 'fee_due' ORDER BY created_at", String.class, app);
            assertTrue(told.stream().anyMatch(m -> m.contains("has its fee due again: Finance reversed the confirmation of the fee")), told.toString());
            assertTrue(told.stream().noneMatch(m -> m.contains("No money was received")), "the reason is Finance's internal note");
            // The history shows the step, with the reason for officers.
            var hist = new HistoryRepository(db).events(app).stream().filter(e -> e.action().equals("reverse_fee")).findFirst().orElseThrow();
            assertEquals("No money was received", hist.reversalReason());
            // Finance confirms again: a new confirmation, and the reversal's approver is not barred from the fee stage.
            assertFalse(confirmations.actorsAtOtherStages(app).contains(PROGRAMME_USER), "a reversal step does not bar its approver");
            UUID snapshot = submissions.findFeeSnapshot(app).orElseThrow().id();
            var again = confirmations.confirm(app, versionOf(app), FINANCE_USER, "finance", snapshot, new BigDecimal("24000.00"), "UTR-AGAIN-" + app.toString().substring(0, 4), RECEIVED);
            assertEquals(FeeConfirmationRepository.Outcome.CONFIRMED, again.outcome());
            assertEquals("iame_scrutiny", stateOf(app));
            assertEquals("UTR-AGAIN-" + app.toString().substring(0, 4), repo.confirmationOf(app).orElseThrow().receiptReference(), "the new confirmation is the one in effect");
            assertEquals(2, owner.queryForObject("SELECT count(*) FROM model_application_fee_confirmation WHERE application_id = ?", Integer.class, app));
            // The second confirmation cannot be reversed by the first reversal, and a reversed confirmation is never reversed twice.
            assertFalse(repo.reversalPossible(app, confirmation.confirmationId()));
        } finally {
            revoke("programme");
        }
    }

    @Test
    void aReversalNeedsASecondPersonWhoMayTouchTheFeeAndOnlyTheProposerMayWithdraw() {
        grant("programme");
        grant("manufacturer");
        try {
            UUID app = confirmed("NC-FR-SEG");
            var p = reverseProposal(app);
            assertEquals(FeeCorrectionRepository.ReversalOutcome.SAME_PERSON, repo.decideReversal(p.id(), FINANCE_USER, "approve", null).outcome());
            assertEquals(FeeCorrectionRepository.ReversalOutcome.ONLY_PROPOSER, repo.decideReversal(p.id(), PROGRAMME_USER, "withdraw", null).outcome());
            assertEquals(FeeCorrectionRepository.ReversalOutcome.SEGREGATED, repo.decideReversal(p.id(), NOVA_USER, "approve", null).outcome(), "the paying organisation");
            assertEquals(FeeCorrectionRepository.ReversalOutcome.NOT_PERMITTED, repo.decideReversal(p.id(), IAME_USER, "approve", null).outcome(), "no permission");
            assertEquals("iame_scrutiny", stateOf(app), "a refused decision changes nothing");
            assertEquals("pending", repo.reversal(p.id()).orElseThrow().state());
            assertEquals(FeeCorrectionRepository.ReversalOutcome.DONE, repo.decideReversal(p.id(), PROGRAMME_USER, "reject", "it was received").outcome());
            assertEquals("iame_scrutiny", stateOf(app), "a rejected reversal changes nothing");
            assertEquals(FeeCorrectionRepository.ReversalOutcome.NOT_PENDING, repo.decideReversal(p.id(), PROGRAMME_USER, "approve", null).outcome());
            var second = reverseProposal(app);
            assertEquals(FeeCorrectionRepository.ReversalOutcome.DONE, repo.decideReversal(second.id(), FINANCE_USER, "withdraw", null).outcome());
        } finally {
            revoke("programme");
            revoke("manufacturer");
        }
    }

    @Test
    void aReversalIsRefusedOnceAnythingHasHappenedSinceTheConfirmationAndOneWaitsPerConfirmation() {
        grant("programme");
        try {
            UUID app = confirmed("NC-FR-LATE");
            var p = reverseProposal(app);
            assertThrows(Exception.class, () -> reverseProposal(app), "a second reversal waiting for the same confirmation");
            // Something happened after the confirmation: a later step. Approving refuses and changes nothing.
            owner.update("INSERT INTO model_application_transition_event (application_id, action, from_state, to_state, actor_account_id, actor_role, version_after) "
                + "VALUES (?, 'resubmit', 'returned', 'iame_scrutiny', ?, 'manufacturer', 99)", app, NOVA_USER);
            int version = versionOf(app);
            assertEquals(FeeCorrectionRepository.ReversalOutcome.NOT_POSSIBLE, repo.decideReversal(p.id(), PROGRAMME_USER, "approve", null).outcome());
            assertEquals("iame_scrutiny", stateOf(app));
            assertEquals(version, versionOf(app));
            assertEquals("pending", repo.reversal(p.id()).orElseThrow().state(), "the proposal stays, so it can be rejected");
            assertEquals(FeeCorrectionRepository.ReversalOutcome.DONE, repo.decideReversal(p.id(), PROGRAMME_USER, "reject", "work has started").outcome());
            // The application moved on to another stage: not possible to propose either.
            UUID moved = confirmed("NC-FR-MOVED");
            owner.update("UPDATE model_application SET state = 'bee_scrutiny' WHERE id = ?", moved);
            assertFalse(repo.reversalPossible(moved, repo.confirmationOf(moved).orElseThrow().confirmationId()));
        } finally {
            revoke("programme");
        }
    }

    @Test
    void theRuntimeLoginCanAddAReversalButNeverEditDeleteOrDecideOneDirectly() {
        UUID app = confirmed("NC-FR-PRIV");
        var p = reverseProposal(app);
        assertThrows(Exception.class, () -> db.update("UPDATE fee_reversal_proposal SET state = 'approved' WHERE id = ?", p.id()));
        assertThrows(Exception.class, () -> db.update("DELETE FROM fee_reversal_proposal WHERE id = ?", p.id()));
        assertThrows(Exception.class, () -> db.update("INSERT INTO fee_reversal_proposal (application_id, fee_confirmation_id, reason, proposed_by, state, decided_by, decided_at) "
            + "SELECT application_id, id, 'x', ?, 'rejected', ?, now() FROM model_application_fee_confirmation WHERE application_id = ?", FINANCE_USER, FINANCE_USER, app),
            "a proposal is born pending: the runtime login cannot insert one that is already decided");
        repo.decideReversal(p.id(), FINANCE_USER, "withdraw", null);
    }

    @Test
    void disposableCleanupRemovesTheReversalsOfARegisteredApplicationToo() {
        UUID app = confirmed("NC-FR-CLEAN");
        reverseProposal(app);
        assertEquals(1, owner.queryForObject("SELECT count(*) FROM fee_reversal_proposal WHERE application_id = ?", Integer.class, app));
        var maint = new JdbcTemplate(sourceAs(MAIN, env("BEE_MAINT_DB_USER", "bee_local_maint"), env("BEE_MAINT_DB_PASSWORD", "bee-local-maint")));
        maint.execute("SELECT set_config('bee.cleanup_schema', '" + MAIN + "', true); INSERT INTO " + MAIN + ".local_disposable_application (application_id) VALUES ('" + app + "'); "
            + "SELECT " + MAIN + ".app_disposable_model_cleanup(ARRAY['" + app + "']::uuid[])");
        assertEquals(0, owner.queryForObject("SELECT count(*) FROM fee_reversal_proposal WHERE application_id = ?", Integer.class, app));
        assertEquals(0, owner.queryForObject("SELECT count(*) FROM model_application WHERE id = ?", Integer.class, app));
    }

    @Test
    void anUnknownProposalIsNotFound() {
        assertEquals(Outcome.NOT_FOUND, repo.decide(UUID.randomUUID(), FINANCE_USER, "approve", null).outcome());
    }
}
