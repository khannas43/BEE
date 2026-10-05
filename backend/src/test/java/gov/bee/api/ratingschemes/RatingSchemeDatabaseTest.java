package gov.bee.api.ratingschemes;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import gov.bee.api.rating.RatingRepository;
import gov.bee.api.ratingschemes.RatingSchemeRepository.NewProposal;
import gov.bee.api.ratingschemes.RatingSchemeRepository.Outcome;
import java.math.BigDecimal;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.HexFormat;
import java.util.List;
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
 * Rating-scheme proposals against throwaway PostgreSQL: the two-person rule, the permission, the not-in-the-past rule, the
 * "later than every scheme already there" rule, and that the rating step picks an approved scheme up from its date. The shared app
 * schema is untouched.
 */
@Tag("db")
class RatingSchemeDatabaseTest {

    static final String TAG = HexFormat.of().toHexDigits(ThreadLocalRandom.current().nextInt());
    static final String MAIN = "wp08c_test_" + TAG;
    static final Path SEED = Path.of("..", "local", "seed", "seed.sql");
    static final UUID NOVA_USER = UUID.fromString("00000000-0000-4000-a000-000000000001");
    static final UUID FINANCE_USER = UUID.fromString("00000000-0000-4000-a000-000000000003");
    static final UUID ADMIN_USER = UUID.fromString("00000000-0000-4000-a000-000000000009");
    static final LocalDate TODAY = LocalDate.now(ZoneId.of("Asia/Kolkata"));

    static JdbcTemplate admin;
    static JdbcTemplate owner;
    static JdbcTemplate db;
    static RatingSchemeRepository repo;
    static RatingRepository ratings;
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
        repo = new RatingSchemeRepository(db);
        ratings = new RatingRepository(db);
        assertEquals(35, owner.queryForObject("SELECT max(installed_rank) FROM flyway_schema_history", Integer.class), "migrated V1 through V35");
    }

    @AfterAll
    static void dropAndAssertAppUntouched() {
        if (admin != null) {
            admin.execute("DROP SCHEMA IF EXISTS " + MAIN + " CASCADE");
            assertEquals(appModelCountBefore, admin.queryForObject("SELECT count(*) FROM app.model_application", Integer.class));
        }
    }

    static NewProposal scheme(LocalDate from, String... figures) {
        return new NewProposal("RAC", from, java.util.Arrays.stream(figures).map(BigDecimal::new).toList(), "Test source", "Test reason");
    }

    static void grantFinance() {
        owner.update("INSERT INTO capability_grant (capability, role) VALUES ('rating_scheme_manage', 'finance') ON CONFLICT DO NOTHING");
    }

    static void revokeFinance() {
        owner.update("DELETE FROM capability_grant WHERE capability = 'rating_scheme_manage' AND role = 'finance'");
    }

    @Test
    void onlyTheAdministratorHoldsThePermissionAndNothingElseDoes() {
        assertEquals(java.util.Set.of("admin"), repo.rolesHolding(RatingSchemeRepository.CAPABILITY));
        assertTrue(repo.categoryAppliesOn("RAC", TODAY));
        assertFalse(repo.categoryAppliesOn("ZZ", TODAY));
        var demo = repo.schemes().stream().filter(s -> s.schemeKey().equals("RAC-ISEER-DEMO-1")).findFirst().orElseThrow();
        assertEquals(5, demo.bands().size());
    }

    @Test
    void anApprovedSchemeTakesOverFromItsDateAndTheRatingStepPicksItUp() {
        grantFinance();
        try {
            LocalDate from = TODAY.plusDays(20);
            var p = repo.insert(ADMIN_USER, scheme(from, "3.00", "3.40", "3.90", "4.40", "4.90"));
            assertEquals("pending", p.state());
            var done = repo.decide(p.id(), FINANCE_USER, "approve", "ok");
            assertEquals(Outcome.DONE, done.outcome());
            assertEquals("approved", done.state());
            assertTrue(done.appliedScheme().startsWith("RAC-ISEER-"), done.appliedScheme());
            // Before the date the demonstration scheme still applies; from the date the new one does.
            var before = ratings.bandsInForce("RAC", TODAY);
            assertEquals("RAC-ISEER-DEMO-1", before.get(0).schemeKey());
            var after = ratings.bandsInForce("RAC", from);
            assertEquals(done.appliedScheme(), after.get(0).schemeKey());
            assertEquals(List.of(new BigDecimal("3.00"), new BigDecimal("3.40"), new BigDecimal("3.90"), new BigDecimal("4.40"), new BigDecimal("4.90")),
                after.stream().map(RatingRepository.Band::minIseer).toList());
            assertEquals("approved", repo.proposal(p.id()).orElseThrow().state());
            // Two schemes of one category may not start on the same day, or it would be ambiguous which is in force.
            var same = repo.insert(ADMIN_USER, scheme(from, "3.10", "3.50", "4.00", "4.50", "5.00"));
            assertEquals(Outcome.RULE_CONFLICT, repo.decide(same.id(), FINANCE_USER, "approve", null).outcome());
            assertEquals("pending", repo.proposal(same.id()).orElseThrow().state(), "a refused decision changes nothing");
            // A scheme that starts earlier than one already queued is a point on the timeline: it applies until the queued one starts.
            LocalDate earlierDate = TODAY.plusDays(5);
            var earlier = repo.insert(ADMIN_USER, scheme(earlierDate, "3.10", "3.50", "4.00", "4.50", "5.00"));
            var earlierDone = repo.decide(earlier.id(), FINANCE_USER, "approve", null);
            assertEquals(Outcome.DONE, earlierDone.outcome());
            assertEquals(earlierDone.appliedScheme(), ratings.bandsInForce("RAC", earlierDate).get(0).schemeKey());
            assertEquals(earlierDone.appliedScheme(), ratings.bandsInForce("RAC", from.minusDays(1)).get(0).schemeKey());
            assertEquals(done.appliedScheme(), ratings.bandsInForce("RAC", from).get(0).schemeKey(), "the later scheme takes over on its own date");
            repo.decide(same.id(), ADMIN_USER, "withdraw", null);
        } finally {
            revokeFinance();
        }
    }

    @Test
    void theProposerCannotApproveOrRejectTheirOwnSchemeButMayWithdrawIt() {
        grantFinance();
        try {
            var p = repo.insert(ADMIN_USER, scheme(TODAY.plusDays(100), "3.00", "3.40", "3.90", "4.40", "4.90"));
            assertEquals(Outcome.SAME_PERSON, repo.decide(p.id(), ADMIN_USER, "approve", null).outcome());
            assertEquals(Outcome.SAME_PERSON, repo.decide(p.id(), ADMIN_USER, "reject", null).outcome());
            assertEquals(Outcome.ONLY_PROPOSER, repo.decide(p.id(), FINANCE_USER, "withdraw", null).outcome());
            assertEquals("withdrawn", repo.decide(p.id(), ADMIN_USER, "withdraw", "mistake").state());
            assertEquals(Outcome.NOT_PENDING, repo.decide(p.id(), FINANCE_USER, "approve", null).outcome(), "a decided proposal is final");
        } finally {
            revokeFinance();
        }
    }

    @Test
    void aSecondPersonMayRejectAndOnlyHoldersOfThePermissionMayDecide() {
        grantFinance();
        try {
            var p = repo.insert(ADMIN_USER, scheme(TODAY.plusDays(200), "3.00", "3.40", "3.90", "4.40", "4.90"));
            assertEquals(Outcome.NOT_PERMITTED, repo.decide(p.id(), NOVA_USER, "approve", null).outcome());
            assertEquals("rejected", repo.decide(p.id(), FINANCE_USER, "reject", "not now").state());
            assertEquals("not now", repo.proposal(p.id()).orElseThrow().decisionNote());
        } finally {
            revokeFinance();
        }
        var q = repo.insert(ADMIN_USER, scheme(TODAY.plusDays(201), "3.00", "3.40", "3.90", "4.40", "4.90"));
        assertEquals(Outcome.NOT_PERMITTED, repo.decide(q.id(), FINANCE_USER, "approve", null).outcome(), "the permission follows the grant");
        repo.decide(q.id(), ADMIN_USER, "withdraw", null);
    }

    @Test
    void aSchemeWhoseDateHasPassedCannotBeApproved() {
        grantFinance();
        try {
            UUID id = owner.queryForObject("INSERT INTO rating_scheme_proposal (category_code, effective_from, min_iseer_1, min_iseer_2, min_iseer_3, min_iseer_4, min_iseer_5, "
                + "source_reference, reason, proposed_by) VALUES ('RAC', ?, 3, 3.5, 4, 4.5, 5, 's', 'r', ?) RETURNING id", UUID.class, java.sql.Date.valueOf(TODAY.minusDays(1)), ADMIN_USER);
            assertEquals(Outcome.DATE_PASSED, repo.decide(id, FINANCE_USER, "approve", null).outcome());
            assertEquals("pending", repo.proposal(id).orElseThrow().state());
            repo.decide(id, ADMIN_USER, "withdraw", null);
        } finally {
            revokeFinance();
        }
    }

    @Test
    void theBandsMustRiseAndTheDatabaseRefusesAScheme_thatDoesNot() {
        assertThrows(Exception.class, () -> repo.insert(ADMIN_USER, scheme(TODAY.plusDays(300), "3.00", "3.00", "3.90", "4.40", "4.90")));
        assertThrows(Exception.class, () -> repo.insert(ADMIN_USER, scheme(TODAY.plusDays(300), "3.00", "3.40", "3.30", "4.40", "4.90")));
        assertThrows(Exception.class, () -> repo.insert(ADMIN_USER, scheme(TODAY.plusDays(300), "0", "3.40", "3.90", "4.40", "4.90")));
    }

    @Test
    void anUnknownProposalIsNotFound() {
        assertEquals(Outcome.NOT_FOUND, repo.decide(UUID.randomUUID(), ADMIN_USER, "approve", null).outcome());
    }

    @Test
    void theRuntimeLoginCannotWriteAMasterOrASchemeDirectly() {
        // Not the fee rules, not the schemes, not the closures: a change goes through a decision function, which needs two people.
        assertThrows(Exception.class, () -> db.update("INSERT INTO rating_demo_band (scheme_key, category_code, effective_from, stars, min_iseer, source_reference, note) "
            + "VALUES ('RAC-ISEER-SNEAK', 'RAC', DATE '2090-01-01', 1, 3.3, 's', 'n')"));
        assertThrows(Exception.class, () -> db.update("INSERT INTO master_fee_rule (rule_key, version, effective_from, source_reference, verification_status, note, category_code, application_type, amount_inr) "
            + "VALUES ('RAC:renewal', 1, DATE '2090-01-01', 's', 'provisional', 'n', 'RAC', 'renewal', 1)"));
        assertThrows(Exception.class, () -> db.update("UPDATE rating_demo_band SET min_iseer = 1"));
        assertThrows(Exception.class, () -> db.update("DELETE FROM master_fee_rule"));
    }
}
