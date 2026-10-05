package gov.bee.api.feerules;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import gov.bee.api.feerules.FeeRuleRepository.NewProposal;
import gov.bee.api.feerules.FeeRuleRepository.Outcome;
import gov.bee.api.masters.MasterDataRepository;
import java.math.BigDecimal;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDate;
import java.time.ZoneId;
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
 * Fee-rule proposals against throwaway PostgreSQL: the two-person rule, the capability, the not-in-the-past rule, and the
 * close-and-start of the rule in force. The shared app schema is untouched.
 */
@Tag("db")
class FeeRuleDatabaseTest {

    static final String TAG = HexFormat.of().toHexDigits(ThreadLocalRandom.current().nextInt());
    static final String MAIN = "wp08_test_" + TAG;
    static final Path SEED = Path.of("..", "local", "seed", "seed.sql");
    static final UUID NOVA_USER = UUID.fromString("00000000-0000-4000-a000-000000000001");
    static final UUID FINANCE_USER = UUID.fromString("00000000-0000-4000-a000-000000000003");
    static final UUID ADMIN_USER = UUID.fromString("00000000-0000-4000-a000-000000000009");
    static final LocalDate TODAY = LocalDate.now(ZoneId.of("Asia/Kolkata"));

    static JdbcTemplate admin;
    static JdbcTemplate owner;
    static JdbcTemplate db;
    static FeeRuleRepository repo;
    static MasterDataRepository masters;
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
        db = new JdbcTemplate(sourceAs(MAIN, env("BEE_RUNTIME_DB_USER", "bee_runtime"), env("BEE_RUNTIME_DB_PASSWORD", "bee-local-runtime")));
        repo = new FeeRuleRepository(db);
        masters = new MasterDataRepository(db);
        assertEquals(36, owner.queryForObject("SELECT max(installed_rank) FROM flyway_schema_history", Integer.class), "migrated V1 through V36");
    }

    @AfterAll
    static void dropAndAssertAppUntouched() {
        if (admin != null) {
            admin.execute("DROP SCHEMA IF EXISTS " + MAIN + " CASCADE");
            assertEquals(appModelCountBefore, admin.queryForObject("SELECT count(*) FROM app.model_application", Integer.class));
        }
    }

    static NewProposal rac(String type, String amount, String tax, LocalDate from) {
        return new NewProposal("RAC", type, new BigDecimal(amount), new BigDecimal(tax), from, "Test source", "Test reason");
    }

    /** Lets the Finance officer approve too: the permission follows the role it is granted to, not a fixed role. */
    static void grantFinance() {
        owner.update("INSERT INTO capability_grant (capability, role) VALUES ('fee_rule_manage', 'finance') ON CONFLICT DO NOTHING");
    }

    static void revokeFinance() {
        owner.update("DELETE FROM capability_grant WHERE capability = 'fee_rule_manage' AND role = 'finance'");
    }

    @Test
    void theAdministratorHoldsTheCapabilityAndNobodyElseDoes() {
        assertEquals(java.util.Set.of("admin"), repo.rolesHolding(FeeRuleRepository.CAPABILITY));
        assertEquals(java.util.List.of("new_model"), repo.applicationTypes().stream().map(FeeRuleRepository.AppType::code).toList());
        assertTrue(repo.categoryAppliesOn("RAC", TODAY));
        assertFalse(repo.categoryAppliesOn("ZZ", TODAY));
    }

    @Test
    void anApprovedProposalClosesTheRuleInForceAndStartsTheNewOneFromItsDate() {
        grantFinance();
        try {
            LocalDate from = TODAY.plusDays(10);
            var p = repo.insert(ADMIN_USER, rac("new_model", "26000.00", "18.00", from));
            assertEquals("pending", p.state());
            var done = repo.decide(p.id(), FINANCE_USER, "approve", "ok");
            assertEquals(Outcome.DONE, done.outcome());
            assertEquals("approved", done.state());
            assertEquals(3, done.appliedVersion(), "RAC:new_model had versions 1 and 2");
            // The fee in force before the date is unchanged; from the date the new rule applies, with its separate tax line.
            assertEquals(new BigDecimal("24000.00"), masters.feeRule("RAC", "new_model", TODAY).orElseThrow().amountInr());
            assertEquals(new BigDecimal("26000.00"), masters.feeRule("RAC", "new_model", from).orElseThrow().amountInr());
            assertEquals(new BigDecimal("18.00"), owner.queryForObject("SELECT tax_rate_percent FROM master_fee_rule WHERE rule_key = 'RAC:new_model' AND version = 3", BigDecimal.class));
            assertEquals(from.toString(), owner.queryForObject("SELECT effective_to::text FROM master_closure WHERE rule_key = 'RAC:new_model' AND version = 2", String.class));
            var after = repo.proposal(p.id()).orElseThrow();
            assertEquals("approved", after.state());
            assertEquals(3, after.appliedVersion());
            // A second proposal for a date before the queued rule's start cannot be applied (the open version starts later).
            var early = repo.insert(ADMIN_USER, rac("new_model", "27000.00", "0", TODAY.plusDays(5)));
            assertEquals(Outcome.RULE_CONFLICT, repo.decide(early.id(), FINANCE_USER, "approve", null).outcome());
            assertEquals("pending", repo.proposal(early.id()).orElseThrow().state(), "a refused decision changes nothing");
        } finally {
            revokeFinance();
        }
    }

    @Test
    void theProposerCannotApproveOrRejectTheirOwnProposalButMayWithdrawIt() {
        grantFinance();
        try {
            var p = repo.insert(ADMIN_USER, rac("new_model", "28000.00", "0", TODAY.plusDays(40)));
            assertEquals(Outcome.SAME_PERSON, repo.decide(p.id(), ADMIN_USER, "approve", null).outcome());
            assertEquals(Outcome.SAME_PERSON, repo.decide(p.id(), ADMIN_USER, "reject", null).outcome());
            assertEquals(Outcome.ONLY_PROPOSER, repo.decide(p.id(), FINANCE_USER, "withdraw", null).outcome());
            var w = repo.decide(p.id(), ADMIN_USER, "withdraw", "mistake");
            assertEquals("withdrawn", w.state());
            assertNull(w.appliedVersion());
            assertEquals(Outcome.NOT_PENDING, repo.decide(p.id(), FINANCE_USER, "approve", null).outcome(), "a decided proposal is final");
        } finally {
            revokeFinance();
        }
    }

    @Test
    void aSecondPersonMayRejectAndOnlyHoldersOfTheCapabilityMayDecide() {
        grantFinance();
        try {
            var p = repo.insert(ADMIN_USER, rac("new_model", "29000.00", "0", TODAY.plusDays(60)));
            assertEquals(Outcome.NOT_PERMITTED, repo.decide(p.id(), NOVA_USER, "approve", null).outcome(), "an applicant holds no fee-rule permission");
            var r = repo.decide(p.id(), FINANCE_USER, "reject", "not now");
            assertEquals("rejected", r.state());
            assertEquals("not now", repo.proposal(p.id()).orElseThrow().decisionNote());
        } finally {
            revokeFinance();
        }
        // Take the permission away from the role again: the same person is refused, so it really follows the grant.
        var q = repo.insert(ADMIN_USER, rac("new_model", "29500.00", "0", TODAY.plusDays(61)));
        assertEquals(Outcome.NOT_PERMITTED, repo.decide(q.id(), FINANCE_USER, "approve", null).outcome());
        repo.decide(q.id(), ADMIN_USER, "withdraw", null);
    }

    @Test
    void aProposalWhoseDateHasPassedCannotBeApproved() {
        grantFinance();
        try {
            // The service refuses a past date at proposal; here the date passes while the proposal waits.
            UUID id = owner.queryForObject("INSERT INTO fee_rule_proposal (category_code, application_type, amount_inr, effective_from, source_reference, reason, proposed_by) "
                + "VALUES ('RAC', 'new_model', 31000, ?, 's', 'r', ?) RETURNING id", UUID.class, java.sql.Date.valueOf(TODAY.minusDays(1)), ADMIN_USER);
            assertEquals(Outcome.DATE_PASSED, repo.decide(id, FINANCE_USER, "approve", null).outcome());
            assertEquals("pending", repo.proposal(id).orElseThrow().state());
            repo.decide(id, ADMIN_USER, "withdraw", null);
        } finally {
            revokeFinance();
        }
    }

    @Test
    void aRuleForANewApplicationTypeStartsAsVersionOneAndThenIsSupersededLikeAnyOther() {
        grantFinance();
        owner.update("INSERT INTO fee_application_type (code, label) VALUES ('renewal', 'Renewal')");
        try {
            var first = repo.insert(ADMIN_USER, rac("renewal", "5000.00", "0", TODAY.plusDays(1)));
            var done = repo.decide(first.id(), FINANCE_USER, "approve", null);
            assertEquals(1, done.appliedVersion());
            assertTrue(masters.feeRule("RAC", "renewal", TODAY.plusDays(1)).isPresent());
            assertFalse(masters.feeRule("RAC", "renewal", TODAY).isPresent(), "nothing applies before the first rule starts");
            var second = repo.insert(ADMIN_USER, rac("renewal", "6000.00", "5.00", TODAY.plusDays(30)));
            assertEquals(2, repo.decide(second.id(), FINANCE_USER, "approve", null).appliedVersion());
            assertEquals(new BigDecimal("6000.00"), masters.feeRule("RAC", "renewal", TODAY.plusDays(30)).orElseThrow().amountInr());
        } finally {
            revokeFinance();
        }
    }

    @Test
    void theMenuLearnsThePermissionsFromTheRolesThatHoldThem() {
        var identity = new gov.bee.api.identity.IdentityRepository(db);
        assertEquals(java.util.List.of("fee_rule_manage", "rating_scheme_manage"), identity.capabilities(java.util.List.of("admin")));
        assertEquals(java.util.List.of("fee_confirmation_correct"), identity.capabilities(java.util.List.of("finance")), "Finance holds only the right to correct a fee confirmation until a permission is given to it");
        assertEquals(java.util.List.of(), identity.capabilities(java.util.List.of()));
        grantFinance();
        try {
            assertEquals(java.util.List.of("fee_confirmation_correct", "fee_rule_manage"), identity.capabilities(java.util.List.of("finance", "reviewer")));
            assertEquals(java.util.List.of("fee_confirmation_correct", "fee_rule_manage", "rating_scheme_manage"), identity.capabilities(java.util.List.of("admin", "finance")), "each permission once");
        } finally {
            revokeFinance();
        }
        assertEquals(java.util.List.of("fee_confirmation_correct"), identity.capabilities(java.util.List.of("finance")));
    }

    @Test
    void anUnknownProposalIsNotFound() {
        assertEquals(Outcome.NOT_FOUND, repo.decide(UUID.randomUUID(), ADMIN_USER, "approve", null).outcome());
    }

    @Test
    void theRuntimeLoginCannotWriteARuleDirectlyNotEvenOneThatDoesNotOverlap() {
        // No overlap: a brand-new application type. Only the missing privilege stops it, so a fee rule can start only through the decision function.
        assertThrows(Exception.class, () -> db.update(
            "INSERT INTO master_fee_rule (rule_key, version, effective_from, source_reference, verification_status, note, category_code, application_type, amount_inr) "
                + "VALUES ('RAC:sneaky', 1, DATE '2090-01-01', 's', 'provisional', 'n', 'RAC', 'sneaky', 1)"));
        assertThrows(Exception.class, () -> db.update(
            "INSERT INTO master_fee_rule (rule_key, version, effective_from, source_reference, verification_status, note, category_code, application_type, amount_inr) "
                + "VALUES ('RAC:new_model', 99, DATE '2030-01-01', 's', 'provisional', 'n', 'RAC', 'new_model', 1)"));
        assertThrows(Exception.class, () -> db.update("UPDATE master_fee_rule SET amount_inr = 1"));
        assertThrows(Exception.class, () -> db.update("DELETE FROM master_fee_rule"));
    }
}
