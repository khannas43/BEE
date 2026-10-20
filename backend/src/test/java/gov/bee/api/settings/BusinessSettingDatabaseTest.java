package gov.bee.api.settings;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import gov.bee.api.settings.BusinessSettingRepository.NewProposal;
import gov.bee.api.settings.BusinessSettingRepository.Outcome;
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
 * Business-setting proposals against throwaway PostgreSQL (WP08.1h): the defaults, the two-person rule, the permission, the
 * not-in-the-past rule, the range of each setting, the shared start day, immutability, and that an approved value takes over from its
 * date, including the certificate validity. The shared app schema is untouched.
 */
@Tag("db")
class BusinessSettingDatabaseTest {

    static final String TAG = HexFormat.of().toHexDigits(ThreadLocalRandom.current().nextInt());
    static final String MAIN = "wp08h_test_" + TAG;
    static final Path SEED = Path.of("..", "local", "seed", "seed.sql");
    static final UUID NOVA_USER = UUID.fromString("00000000-0000-4000-a000-000000000001");
    static final UUID FINANCE_USER = UUID.fromString("00000000-0000-4000-a000-000000000003");
    static final UUID ADMIN_USER = UUID.fromString("00000000-0000-4000-a000-000000000009");
    static final LocalDate TODAY = LocalDate.now(ZoneId.of("Asia/Kolkata"));

    static JdbcTemplate admin;
    static JdbcTemplate owner;
    static JdbcTemplate db;
    static BusinessSettingRepository repo;
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
        repo = new BusinessSettingRepository(db);
        assertEquals(83, owner.queryForObject("SELECT max(installed_rank) FROM flyway_schema_history", Integer.class), "migrated V1 through V83");
    }

    @AfterAll
    static void dropAndAssertAppUntouched() {
        if (admin != null) {
            admin.execute("DROP SCHEMA IF EXISTS " + MAIN + " CASCADE");
            assertEquals(appModelCountBefore, admin.queryForObject("SELECT count(*) FROM app.model_application", Integer.class));
        }
    }

    static NewProposal setting(String key, String value, LocalDate from) {
        return new NewProposal(key, from, new BigDecimal(value), "Test source", "Test reason");
    }

    static void grantFinance() {
        owner.update("INSERT INTO capability_grant (capability, role) VALUES ('business_setting_manage', 'finance') ON CONFLICT DO NOTHING");
    }

    static void revokeFinance() {
        owner.update("DELETE FROM capability_grant WHERE capability = 'business_setting_manage' AND role = 'finance'");
    }

    @Test
    void onlyTheAdministratorHoldsThePermissionAndTheFiveSettingsHaveTheirOwnersAssumptionAsDefault() {
        assertEquals(java.util.Set.of("admin"), repo.rolesHolding(BusinessSettingRepository.CAPABILITY));
        assertEquals(5, repo.definitions().size());
        assertEquals(new BigDecimal("99.99"), repo.valueOn("declared_iseer_max", TODAY));
        assertEquals(0, new BigDecimal("1095").compareTo(repo.valueOn("test_report_max_age_days", TODAY)));
        assertEquals(0, BigDecimal.ZERO.compareTo(repo.valueOn("payment_tolerance_amount", TODAY)));
        assertEquals(0, new BigDecimal("99.99").compareTo(repo.valueOn("iseer_verify_tolerance", TODAY)));
        assertEquals(0, new BigDecimal("3").compareTo(repo.valueOn("certificate_validity_years", TODAY)));
        assertThrows(Exception.class, () -> repo.valueOn("no_such_setting", TODAY).toString() .charAt(0), "an unknown key has no value");
    }

    @Test
    void anApprovedValueTakesOverFromItsDateAndEarlierDaysKeepTheEarlierValue() {
        grantFinance();
        try {
            LocalDate from = TODAY.plusDays(20);
            var p = repo.insert(ADMIN_USER, setting("payment_tolerance_amount", "50.00", from));
            assertEquals("pending", p.state());
            var done = repo.decide(p.id(), FINANCE_USER, "approve", "ok");
            assertEquals(Outcome.DONE, done.outcome());
            assertEquals("approved", done.state());
            assertTrue(repo.proposal(p.id()).orElseThrow().applied());
            assertEquals(0, BigDecimal.ZERO.compareTo(repo.valueOn("payment_tolerance_amount", from.minusDays(1))));
            assertEquals(0, new BigDecimal("50").compareTo(repo.valueOn("payment_tolerance_amount", from)));
            assertEquals(0, new BigDecimal("50").compareTo(repo.valueOn("payment_tolerance_amount", from.plusYears(5))));
            // A second change on the same day is a conflict, and a refused decision changes nothing.
            var same = repo.insert(ADMIN_USER, setting("payment_tolerance_amount", "60.00", from));
            assertEquals(Outcome.RULE_CONFLICT, repo.decide(same.id(), FINANCE_USER, "approve", null).outcome());
            assertEquals("pending", repo.proposal(same.id()).orElseThrow().state());
            repo.decide(same.id(), ADMIN_USER, "withdraw", null);
            // Another setting is unaffected.
            assertEquals(0, new BigDecimal("3").compareTo(repo.valueOn("certificate_validity_years", from)));
        } finally {
            revokeFinance();
        }
    }

    @Test
    void theProposerCannotApproveOrRejectTheirOwnValueButMayWithdrawIt() {
        grantFinance();
        try {
            var p = repo.insert(ADMIN_USER, setting("test_report_max_age_days", "500", TODAY.plusDays(100)));
            assertEquals(Outcome.SAME_PERSON, repo.decide(p.id(), ADMIN_USER, "approve", null).outcome());
            assertEquals(Outcome.SAME_PERSON, repo.decide(p.id(), ADMIN_USER, "reject", null).outcome());
            assertEquals(Outcome.ONLY_PROPOSER, repo.decide(p.id(), FINANCE_USER, "withdraw", null).outcome());
            assertEquals("withdrawn", repo.decide(p.id(), ADMIN_USER, "withdraw", "mistake").state());
            assertEquals(Outcome.NOT_PENDING, repo.decide(p.id(), FINANCE_USER, "approve", null).outcome(), "a decided proposal is final");
            assertEquals(0, new BigDecimal("1095").compareTo(repo.valueOn("test_report_max_age_days", TODAY.plusDays(100))));
        } finally {
            revokeFinance();
        }
    }

    @Test
    void aSecondPersonMayRejectAndOnlyHoldersOfThePermissionMayDecide() {
        grantFinance();
        try {
            var p = repo.insert(ADMIN_USER, setting("certificate_validity_years", "5", TODAY.plusDays(200)));
            assertEquals(Outcome.NOT_PERMITTED, repo.decide(p.id(), NOVA_USER, "approve", null).outcome());
            assertEquals("rejected", repo.decide(p.id(), FINANCE_USER, "reject", "not now").state());
            assertEquals("not now", repo.proposal(p.id()).orElseThrow().decisionNote());
        } finally {
            revokeFinance();
        }
        var q = repo.insert(ADMIN_USER, setting("certificate_validity_years", "5", TODAY.plusDays(201)));
        assertEquals(Outcome.NOT_PERMITTED, repo.decide(q.id(), FINANCE_USER, "approve", null).outcome(), "the permission follows the grant");
        repo.decide(q.id(), ADMIN_USER, "withdraw", null);
    }

    @Test
    void aValueWhoseDateHasPassedCannotBeApproved() {
        grantFinance();
        try {
            UUID id = owner.queryForObject("INSERT INTO business_setting_proposal (setting_key, effective_from, value, source_reference, reason, proposed_by) "
                + "VALUES ('payment_tolerance_amount', ?, 5, 's', 'r', ?) RETURNING id", UUID.class, java.sql.Date.valueOf(TODAY.minusDays(1)), ADMIN_USER);
            assertEquals(Outcome.DATE_PASSED, repo.decide(id, FINANCE_USER, "approve", null).outcome());
            assertEquals("pending", repo.proposal(id).orElseThrow().state());
            repo.decide(id, ADMIN_USER, "withdraw", null);
        } finally {
            revokeFinance();
        }
    }

    @Test
    void aValueOutsideTheRangeOrWithTheWrongPrecisionIsRefusedByTheDecisionFunctionToo() {
        grantFinance();
        try {
            // The service refuses these at proposal time; a row written by hand must still not become a version.
            for (String[] bad : new String[][] {{"declared_iseer_max", "100.00"}, {"certificate_validity_years", "0"}, {"certificate_validity_years", "2.5"}, {"test_report_max_age_days", "0"}}) {
                UUID id = owner.queryForObject("INSERT INTO business_setting_proposal (setting_key, effective_from, value, source_reference, reason, proposed_by) "
                    + "VALUES (?, ?, ?, 's', 'r', ?) RETURNING id", UUID.class, bad[0], java.sql.Date.valueOf(TODAY.plusDays(300)), new BigDecimal(bad[1]), ADMIN_USER);
                assertEquals(Outcome.RULE_CONFLICT, repo.decide(id, FINANCE_USER, "approve", null).outcome(), bad[0] + " " + bad[1]);
                repo.decide(id, ADMIN_USER, "withdraw", null);
            }
            assertEquals(0, owner.queryForObject("SELECT count(*) FROM business_setting_version WHERE effective_from = ?", Integer.class, java.sql.Date.valueOf(TODAY.plusDays(300))));
        } finally {
            revokeFinance();
        }
    }

    @Test
    void anUnknownProposalIsNotFoundAndAnUnknownSettingCannotBeProposed() {
        assertEquals(Outcome.NOT_FOUND, repo.decide(UUID.randomUUID(), ADMIN_USER, "approve", null).outcome());
        assertThrows(Exception.class, () -> repo.insert(ADMIN_USER, setting("no_such_setting", "1", TODAY.plusDays(10))));
    }

    @Test
    void versionsAndDefinitionsAreImmutableAndTheRuntimeLoginCannotWriteThem() {
        grantFinance();
        try {
            var p = repo.insert(ADMIN_USER, setting("iseer_verify_tolerance", "0.50", TODAY.plusDays(600)));
            repo.decide(p.id(), FINANCE_USER, "approve", null);
        } finally {
            revokeFinance();
        }
        assertThrows(Exception.class, () -> db.update("INSERT INTO business_setting_version (setting_key, effective_from, value, source_reference, reason) VALUES ('payment_tolerance_amount', DATE '2090-01-01', 1, 's', 'r')"));
        assertThrows(Exception.class, () -> db.update("UPDATE business_setting_version SET value = 1"));
        assertThrows(Exception.class, () -> db.update("UPDATE business_setting_def SET default_value = 1"));
        assertThrows(Exception.class, () -> owner.update("UPDATE business_setting_version SET value = 1"), "immutable for everyone");
        assertThrows(Exception.class, () -> owner.update("DELETE FROM business_setting_version"), "immutable for everyone");
        assertThrows(Exception.class, () -> owner.update("UPDATE business_setting_def SET default_value = 1"), "the catalogue is immutable too");
    }

    @Test
    void aProposalIsBornPendingSoNoRowCanSkipTheSecondPerson() {
        String insert = "INSERT INTO business_setting_proposal (setting_key, effective_from, value, source_reference, reason, proposed_by, state, decided_by, decided_at) "
            + "VALUES ('payment_tolerance_amount', ?, 5, 's', 'r', ?, ?, ?, now())";
        java.sql.Date when = java.sql.Date.valueOf(TODAY.plusDays(401));
        assertThrows(Exception.class, () -> db.update(insert, when, ADMIN_USER, "rejected", ADMIN_USER), "already rejected");
        assertThrows(Exception.class, () -> owner.update(insert, when, ADMIN_USER, "rejected", ADMIN_USER), "the guard holds for everyone, not only the runtime login");
        assertEquals(0, owner.queryForObject("SELECT count(*) FROM business_setting_proposal WHERE effective_from = ?", Integer.class, when));
    }

    @Test
    void theRuntimeLoginMayRunTheDecisionFunctionButNotRewriteAProposal() {
        assertThrows(Exception.class, () -> db.update("UPDATE business_setting_proposal SET state = 'approved'"));
        assertThrows(Exception.class, () -> db.update("DELETE FROM business_setting_proposal"));
    }
}
