package gov.bee.api.masters;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import gov.bee.api.masters.MasterDataService.AccreditationOutcome;
import gov.bee.api.masters.MasterVersion.Verification;
import gov.bee.api.masters.Masters.FeeRule;
import java.math.BigDecimal;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.SQLException;
import java.time.LocalDate;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ThreadLocalRandom;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

/**
 * WP04.1 against real PostgreSQL (the local bee-local-postgres container), in throwaway
 * schemas wp041_test_* that are dropped afterwards; schema "app" is never touched.
 * Tagged "db": excluded from npm run api:test, run by npm run api:test:masters (and by
 * local:check). Fails, rather than skips, if the database is unreachable.
 */
@Tag("db")
class MastersDatabaseTest {

    static final String TAG = HexFormat.of().toHexDigits(ThreadLocalRandom.current().nextInt());
    static final String MAIN = "wp041_test_" + TAG;
    static final String RESET = "wp041_test_" + TAG + "_reset";
    static final Path SEED = Path.of("..", "local", "seed", "seed.sql");
    static final String MASTER_TABLES = "master_category, master_standard, master_lab_accreditation, master_fee_rule, master_rating_formula";
    static final LocalDate D = LocalDate.of(2026, 1, 1);

    static JdbcTemplate admin;
    static JdbcTemplate db;
    static MasterDataService service;
    static MasterDataRepository repository;
    static String seed;

    static String env(String k, String d) {
        String v = System.getenv(k);
        return v == null || v.isBlank() ? d : v;
    }

    static DriverManagerDataSource source(String schema) {
        String url = "jdbc:postgresql://127.0.0.1:" + env("BEE_PG_PORT", "5434") + "/" + env("BEE_APP_DB", "bee_app") + (schema == null ? "" : "?currentSchema=" + schema);
        return new DriverManagerDataSource(url, env("BEE_APP_DB_USER", "bee_app"), env("BEE_APP_DB_PASSWORD", "bee-local-app"));
    }

    static Flyway flyway(String schema, String target) {
        var config = Flyway.configure().dataSource(source(schema)).schemas(schema).defaultSchema(schema).createSchemas(false)
            .locations("classpath:db/migration");
        return (target == null ? config : config.target(target)).load();
    }

    static void createSchema(String schema) {
        if (!schema.startsWith("wp041_test_")) throw new IllegalArgumentException(schema);
        admin.execute("DROP SCHEMA IF EXISTS " + schema + " CASCADE");
        admin.execute("CREATE SCHEMA " + schema);
    }

    @BeforeAll
    static void migrateWithLegacyRowsThenSeed() throws Exception {
        admin = new JdbcTemplate(source(null));
        seed = Files.readString(SEED);
        createSchema(MAIN);
        flyway(MAIN, "3").migrate();
        db = new JdbcTemplate(source(MAIN));
        /* the rows the pre-WP04.1 seed wrote into the V2 tables */
        db.update("INSERT INTO fee_rule (id, category, version, amount_inr, status, note) VALUES ('RAC-DEMO', 'RAC', '0-unverified', 1000.00, 'unverified', 'Synthetic local amount only; BEE fee decision pending')");
        db.update("INSERT INTO rating_formula (id, category, version, status, definition, note) VALUES ('RAC-STAR-DEMO', 'RAC', '0-unverified', 'unverified', '{}'::jsonb, 'Placeholder only; no official rating may be computed')");
        flyway(MAIN, null).migrate();
        repository = new MasterDataRepository(db);
        service = new MasterDataService(repository);
    }

    @AfterAll
    static void dropSchemas() {
        if (admin != null) {
            admin.execute("DROP SCHEMA IF EXISTS " + MAIN + " CASCADE");
            admin.execute("DROP SCHEMA IF EXISTS " + RESET + " CASCADE");
        }
    }

    static String sqlState(Throwable e) {
        for (Throwable t = e; t != null; t = t.getCause()) if (t instanceof SQLException s) return s.getSQLState();
        return null;
    }

    /** Seeded master content (probe rows excluded), optionally without the generated id and recorded_at. */
    static List<Map<String, Object>> snapshot(JdbcTemplate t, boolean withIds) {
        StringBuilder sql = new StringBuilder();
        for (String table : MASTER_TABLES.split(", ")) {
            if (!sql.isEmpty()) sql.append(" UNION ALL ");
            sql.append("SELECT '").append(table).append("' AS t, rule_key, version, ")
                .append(withIds ? "id::text || ' ' || recorded_at::text" : "''").append(" AS ids, to_jsonb(m) - 'id' - 'recorded_at' AS body FROM ")
                .append(table).append(" m WHERE rule_key NOT ILIKE '%probe%'");
        }
        return t.queryForList(sql + " ORDER BY 1, 2, 3").stream().map(r -> Map.of("t", r.get("t"), "k", r.get("rule_key") + " v" + r.get("version"),
            "ids", r.get("ids"), "body", String.valueOf(r.get("body")))).toList();
    }

    @Test
    void legacyV2RowsArePreservedAsVersionOneAndTheV2TablesRetired() {
        db.execute(seed);
        var fee = repository.history(MasterDataRepository.Table.FEE_RULE, "RAC:new_model");
        assertEquals(2, fee.size());
        assertEquals("RAC-DEMO", fee.get(0).legacyId());
        assertEquals(Verification.SYNTHETIC, fee.get(0).verification());
        assertEquals(new BigDecimal("1000.00"), service.feeRule("RAC", "new_model", LocalDate.of(2026, 9, 30)).orElseThrow().amountInr());
        assertEquals("RAC-STAR-DEMO", repository.history(MasterDataRepository.Table.RATING_FORMULA, "RAC:star_rating").get(0).legacyId());
        assertEquals(0, db.queryForObject("SELECT count(*) FROM information_schema.tables WHERE table_schema = ? AND table_name IN ('fee_rule', 'rating_formula')", Integer.class, MAIN));
    }

    @Test
    void feeVersionIsSelectedByDateWithInclusiveStartAndExclusiveEnd() {
        db.execute(seed);
        assertTrue(service.feeRule("RAC", "new_model", D.minusDays(1)).isEmpty(), "before the first version: no rule");
        FeeRule first = service.feeRule("RAC", "new_model", D).orElseThrow();
        assertEquals(1, first.version().version());
        assertEquals(new BigDecimal("1000.00"), first.amountInr());
        assertEquals(1, service.feeRule("RAC", "new_model", LocalDate.of(2026, 9, 30)).orElseThrow().version().version(), "last day of v1");
        FeeRule second = service.feeRule("RAC", "new_model", LocalDate.of(2026, 10, 1)).orElseThrow();
        assertEquals(2, second.version().version(), "v1's effective_to is v2's first day");
        assertEquals(new BigDecimal("24000.00"), second.amountInr());
        assertEquals(Verification.PROVISIONAL, second.version().verification());
        assertTrue(second.version().sourceReference().contains("D6"));
        assertEquals(2, service.feeRule("RAC", "new_model", LocalDate.of(2099, 12, 31)).orElseThrow().version().version(), "open-ended");
        assertFalse(first.version().beeVerified() || second.version().beeVerified());
        assertTrue(service.feeRule("RAC", "renewal", LocalDate.of(2026, 10, 1)).isEmpty(), "unknown application type");
        assertTrue(service.feeRule("XYZ", "new_model", LocalDate.of(2026, 10, 1)).isEmpty(), "unknown category");
    }

    @Test
    void standardVersionChangesOnItsBoundary() {
        db.execute(seed);
        assertEquals("synthetic-2025", service.applicableStandard("RAC", "performance_test", LocalDate.of(2026, 6, 30)).orElseThrow().edition());
        assertEquals("synthetic-2026", service.applicableStandard("RAC", "performance_test", LocalDate.of(2026, 7, 1)).orElseThrow().edition());
        assertTrue(service.applicableStandard("RAC", "performance_test", D.minusDays(1)).isEmpty());
        assertTrue(service.categoryApplies("RAC", D) && !service.categoryApplies("RAC", D.minusDays(1)));
    }

    @Test
    void aGapBetweenVersionsHasNoApplicableRule() {
        db.execute(seed);
        db.update("INSERT INTO master_fee_rule (rule_key, version, effective_from, effective_to, source_reference, verification_status, note, category_code, application_type, amount_inr) VALUES "
            + "('RAC:gap_probe', 1, '2030-01-01', '2030-02-01', 'test', 'synthetic', 'probe', 'RAC', 'gap_probe', 1), "
            + "('RAC:gap_probe', 2, '2030-03-01', NULL, 'test', 'synthetic', 'probe', 'RAC', 'gap_probe', 2)");
        assertEquals(1, service.feeRule("RAC", "gap_probe", LocalDate.of(2030, 1, 31)).orElseThrow().version().version());
        assertTrue(service.feeRule("RAC", "gap_probe", LocalDate.of(2030, 2, 1)).isEmpty(), "first day of the gap");
        assertTrue(service.feeRule("RAC", "gap_probe", LocalDate.of(2030, 2, 28)).isEmpty(), "last day of the gap");
        assertEquals(2, service.feeRule("RAC", "gap_probe", LocalDate.of(2030, 3, 1)).orElseThrow().version().version());
        assertEquals(AccreditationOutcome.NO_RECORD, service.accreditation("LAB", "RAC", LocalDate.of(2026, 7, 1)).outcome(), "seeded accreditation gap");
        assertEquals(AccreditationOutcome.NO_RECORD, service.accreditation("LAB", "RAC", LocalDate.of(2026, 7, 31)).outcome());
    }

    @Test
    void inactiveAccreditationIsNotAnAccreditation() {
        db.execute(seed);
        assertEquals(AccreditationOutcome.ACCREDITED, service.accreditation("LAB", "RAC", LocalDate.of(2026, 5, 31)).outcome());
        var suspended = service.accreditation("LAB", "RAC", LocalDate.of(2026, 6, 1));
        assertEquals(AccreditationOutcome.SUSPENDED, suspended.outcome());
        assertFalse(suspended.accredited());
        assertEquals("SYN-LAB-RAC-0002", suspended.record().orElseThrow().certificateRef(), "the suspended record is still returned");
        assertTrue(service.accreditation("LAB", "RAC", LocalDate.of(2026, 8, 1)).accredited(), "re-accredited after the gap");
        db.update("INSERT INTO master_lab_accreditation (rule_key, version, effective_from, effective_to, source_reference, verification_status, note, laboratory_code, category_code, accreditation_body, certificate_ref, accreditation_status) "
            + "VALUES ('LAB:PROBE', 1, '2026-01-01', NULL, 'test', 'synthetic', 'probe', 'LAB', 'PROBE', 'SYN', 'SYN-W', 'withdrawn')");
        assertEquals(AccreditationOutcome.WITHDRAWN, service.accreditation("LAB", "PROBE", LocalDate.of(2026, 3, 1)).outcome());
        assertEquals(AccreditationOutcome.NO_RECORD, service.accreditation("NOVA", "RAC", LocalDate.of(2026, 3, 1)).outcome(), "a manufacturer has no accreditation");
        DataAccessException unknownLab = assertThrows(DataAccessException.class, () -> db.update(
            "INSERT INTO master_lab_accreditation (rule_key, version, effective_from, source_reference, verification_status, note, laboratory_code, category_code, accreditation_body, certificate_ref, accreditation_status) "
                + "VALUES ('NOLAB:PROBE', 1, '2026-01-01', 'test', 'synthetic', 'probe', 'NOLAB', 'PROBE', 'SYN', 'SYN-X', 'active')"));
        assertEquals("23503", sqlState(unknownLab), "laboratory must be a known organisation");
    }

    static void probe(int version, String from, String to) {
        db.update("INSERT INTO master_fee_rule (rule_key, version, effective_from, effective_to, source_reference, verification_status, note, category_code, application_type, amount_inr) "
            + "VALUES ('RAC:overlap_probe', ?, ?::date, ?::date, 'test', 'synthetic', 'probe', 'RAC', 'overlap_probe', ?)", version, from, to, version);
    }

    @Test
    void overlappingPeriodsForOneRuleKeyAreRejected() {
        db.execute(seed);
        probe(1, "2031-01-01", "2031-06-01");
        String[][] overlapping = {{"2031-01-01", "2031-06-01"}, {"2031-03-01", "2031-09-01"}, {"2030-12-01", "2031-07-01"}, {"2030-01-01", null}, {"2031-05-31", "2031-06-01"}};
        int v = 10;
        for (String[] p : overlapping) {
            int version = v++;
            DataAccessException e = assertThrows(DataAccessException.class, () -> probe(version, p[0], p[1]), p[0] + ".." + p[1]);
            assertEquals("23P01", sqlState(e), p[0] + ".." + p[1]);
            assertTrue(e.getMessage().contains("overlaps v1"));
        }
        probe(2, "2031-06-01", "2031-07-01");
        probe(3, "2031-07-01", null);
        DataAccessException afterOpen = assertThrows(DataAccessException.class, () -> probe(4, "2032-01-01", null));
        assertEquals("23P01", sqlState(afterOpen), "an open-ended version blocks any later start");
        assertEquals(3, repository.history(MasterDataRepository.Table.FEE_RULE, "RAC:overlap_probe").size());
        DataAccessException seeded = assertThrows(DataAccessException.class, () -> db.update(
            "INSERT INTO master_fee_rule (rule_key, version, effective_from, source_reference, verification_status, note, category_code, application_type, amount_inr) "
                + "VALUES ('RAC:new_model', 3, '2027-04-01', 'test', 'synthetic', 'probe', 'RAC', 'new_model', 1)"));
        assertEquals("23P01", sqlState(seeded), "the seeded open-ended v2 blocks a new version until BEE closes it (decision M6)");
        String dup = "INSERT INTO master_fee_rule (rule_key, version, effective_from, effective_to, source_reference, verification_status, note, category_code, application_type, amount_inr) "
            + "VALUES ('RAC:dup_probe', 1, ?::date, ?::date, 'test', 'synthetic', 'probe', 'RAC', 'dup_probe', 1)";
        db.update(dup, "2040-01-01", "2040-02-01");
        DataAccessException duplicate = assertThrows(DataAccessException.class, () -> db.update(dup, "2041-01-01", "2041-02-01"));
        assertEquals("23505", sqlState(duplicate), "one row per (rule_key, version), even for a free period");
    }

    @Test
    void historicalVersionsAreImmutable() {
        db.execute(seed);
        var before = snapshot(db, true);
        for (String sql : List.of("UPDATE master_fee_rule SET amount_inr = 1 WHERE rule_key = 'RAC:new_model' AND version = 1",
            "UPDATE master_fee_rule SET effective_to = '2027-01-01' WHERE rule_key = 'RAC:new_model' AND version = 2",
            "UPDATE master_lab_accreditation SET accreditation_status = 'active' WHERE version = 2",
            "DELETE FROM master_standard WHERE version = 1", "DELETE FROM master_category", "TRUNCATE master_rating_formula")) {
            DataAccessException e = assertThrows(DataAccessException.class, () -> db.execute(sql), sql);
            assertEquals("55000", sqlState(e), sql);
            assertTrue(e.getMessage().contains("immutable"), sql);
        }
        assertEquals(before, snapshot(db, true));
    }

    @Test
    void ratingFormulaIsMetadataThatCannotBeMarkedComputableUnlessVerified() {
        db.execute(seed);
        var formula = service.ratingFormula("RAC", LocalDate.of(2026, 10, 1)).orElseThrow();
        assertEquals("0-unverified", formula.formulaLabel());
        assertFalse(formula.computationAllowed());
        assertFalse(formula.version().beeVerified());
        assertEquals("{}", formula.definitionJson());
        DataAccessException e = assertThrows(DataAccessException.class, () -> db.update(
            "INSERT INTO master_rating_formula (rule_key, version, effective_from, source_reference, verification_status, note, category_code, formula_label, inputs, definition, computation_allowed) "
                + "VALUES ('PROBE:star_rating', 1, '2026-01-01', 'test', 'provisional', 'probe', 'PROBE', 'x', '[]', '{}', true)"));
        assertEquals("23514", sqlState(e));
        assertEquals(0, db.queryForObject("SELECT (SELECT count(*) FROM master_fee_rule WHERE verification_status = 'verified') + (SELECT count(*) FROM master_rating_formula WHERE verification_status = 'verified' OR computation_allowed)", Integer.class));
    }

    @Test
    void repeatSeedingChangesNothingAndAChangedFixtureIsRefused() {
        db.execute(seed);
        var once = snapshot(db, true);
        db.execute(seed);
        db.execute(seed);
        assertEquals(once, snapshot(db, true), "same rows, same ids, same recorded_at");
        String changed = seed.replace("'24000.00'::numeric", "'25000.00'::numeric");
        assertNotEquals(seed, changed);
        DataAccessException e = assertThrows(DataAccessException.class, () -> db.execute(changed));
        assertTrue(e.getMessage().contains("master_fee_rule: a stored version differs from the fixture"), e.getMessage());
        assertEquals(once, snapshot(db, true), "the refused seed rolled back");
    }

    @Test
    void targetedResetRebuildsTheSameMasters() {
        db.execute(seed);
        var migrated = snapshot(db, false);
        JdbcTemplate fresh = new JdbcTemplate(source(RESET));
        for (int run = 1; run <= 2; run++) {
            createSchema(RESET);
            flyway(RESET, null).migrate();
            fresh.execute(seed);
            assertEquals(migrated, snapshot(fresh, false), "reset run " + run + ": fresh migrate + seed equals the upgraded schema");
        }
        assertEquals(1, fresh.queryForObject("SELECT count(*) FROM seed_run WHERE seed_version = 'wp04.1-masters-v1'", Integer.class));
    }
}
