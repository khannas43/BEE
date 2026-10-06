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
        assertEquals(39, owner.queryForObject("SELECT max(installed_rank) FROM flyway_schema_history", Integer.class), "migrated V1 through V39");
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

    @Test
    void anUnknownProposalIsNotFound() {
        assertEquals(Outcome.NOT_FOUND, repo.decide(UUID.randomUUID(), FINANCE_USER, "approve", null).outcome());
    }
}
