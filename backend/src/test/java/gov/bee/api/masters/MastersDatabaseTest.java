package gov.bee.api.masters;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
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
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.transaction.support.TransactionTemplate;

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
        if (!schema.startsWith("wp041_test_" + TAG)) throw new IllegalArgumentException(schema);
        admin.execute("DROP SCHEMA IF EXISTS " + schema + " CASCADE");
        admin.execute("CREATE SCHEMA " + schema);
    }

    /**
     * A new throwaway schema, either upgraded as the shared runtime was (V3 with the V2 rows,
     * then V4 and its seed, then the rest) or migrated fresh as a targeted reset is. The
     * caller seeds it (again).
     */
    static JdbcTemplate build(String schema, boolean upgrade) {
        createSchema(schema);
        JdbcTemplate t = new JdbcTemplate(source(schema));
        if (upgrade) {
            flyway(schema, "3").migrate();
            /* the rows the pre-WP04.1 seed wrote into the V2 tables */
            t.update("INSERT INTO fee_rule (id, category, version, amount_inr, status, note) VALUES ('RAC-DEMO', 'RAC', '0-unverified', 1000.00, 'unverified', 'Synthetic local amount only; BEE fee decision pending')");
            t.update("INSERT INTO rating_formula (id, category, version, status, definition, note) VALUES ('RAC-STAR-DEMO', 'RAC', '0-unverified', 'unverified', '{}'::jsonb, 'Placeholder only; no official rating may be computed')");
            flyway(schema, "4").migrate();
            t.execute(seed);
        }
        flyway(schema, null).migrate();
        return t;
    }

    @BeforeAll
    static void migrateWithLegacyRowsThenSeed() throws Exception {
        admin = new JdbcTemplate(source(null));
        seed = Files.readString(SEED);
        db = build(MAIN, true);
        repository = new MasterDataRepository(db);
        service = new MasterDataService(repository);
    }

    @AfterAll
    static void dropSchemas() {
        if (admin != null) {
            for (String schema : admin.queryForList("SELECT nspname FROM pg_namespace WHERE nspname LIKE ?", String.class, "wp041_test_" + TAG + "%")) {
                admin.execute("DROP SCHEMA IF EXISTS " + schema + " CASCADE");
            }
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
        assertEquals("23P01", sqlState(seeded), "the seeded open-ended v2 blocks a direct insert; a successor needs master_supersede()");
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
        assertEquals(0, fresh.queryForObject("SELECT count(*) FROM master_closure", Integer.class), "the seed closes nothing");
    }

    static final LocalDate HANDOVER = LocalDate.of(2027, 4, 1);
    static final String ACTOR = "test.master.steward";
    static final String CLOSURE_SOURCE = "TEST-ONLY closure in a throwaway schema; not a BEE decision";
    static final String REASON = "TEST-ONLY: prove the boundary handover";

    static String successor(String status, String payload) {
        return "{\"source_reference\": \"TEST-ONLY successor; not a BEE rule\", \"verification_status\": \"" + status + "\", \"note\": \"test only\", " + payload + "}";
    }

    static int closures(JdbcTemplate t) {
        return t.queryForObject("SELECT count(*) FROM master_closure", Integer.class);
    }

    /** Close every seeded open-ended version (one per master type), on an upgraded and on a freshly reset schema. */
    @Test
    void supersedingOpenEndedVersionsHandsOverExactlyOnTheBoundary() {
        for (boolean upgrade : new boolean[] {true, false}) {
            String label = upgrade ? "upgraded" : "fresh";
            JdbcTemplate t = build(MAIN + "_close_" + label, upgrade);
            t.execute(seed);
            var repo = new MasterDataRepository(t);
            var svc = new MasterDataService(repo);
            var before = snapshot(t, true);
            LocalDate last = HANDOVER.minusDays(1);

            assertEquals(3, repo.supersede(MasterDataRepository.Table.FEE_RULE, "RAC:new_model", 2, HANDOVER, ACTOR, CLOSURE_SOURCE, REASON,
                successor("verified", "\"category_code\": \"RAC\", \"application_type\": \"new_model\", \"amount_inr\": 30000")), label);
            assertEquals(2, repo.supersede(MasterDataRepository.Table.RATING_FORMULA, "RAC:star_rating", 1, HANDOVER, ACTOR, CLOSURE_SOURCE, REASON,
                successor("provisional", "\"category_code\": \"RAC\", \"formula_label\": \"test-only-1\", \"inputs\": [], \"definition\": {}, \"computation_allowed\": false")), label);
            assertEquals(2, repo.supersede(MasterDataRepository.Table.CATEGORY, "RAC", 1, HANDOVER, ACTOR, CLOSURE_SOURCE, REASON,
                successor("provisional", "\"name\": \"Room air conditioner (test-only successor)\"")), label);
            assertEquals(3, repo.supersede(MasterDataRepository.Table.STANDARD, "RAC:performance_test", 2, HANDOVER, ACTOR, CLOSURE_SOURCE, REASON,
                successor("synthetic", "\"category_code\": \"RAC\", \"purpose\": \"performance_test\", \"standard_code\": \"SYN-RAC-PERF\", \"title\": \"test only\", \"edition\": \"test-2027\"")), label);
            assertEquals(4, repo.supersede(MasterDataRepository.Table.LAB_ACCREDITATION, "LAB:RAC", 3, HANDOVER, ACTOR, CLOSURE_SOURCE, REASON,
                successor("synthetic", "\"laboratory_code\": \"LAB\", \"category_code\": \"RAC\", \"accreditation_body\": \"SYN-ACCREDITATION-BODY\", \"certificate_ref\": \"TEST-ONLY\", \"accreditation_status\": \"withdrawn\"")), label);

            FeeRule old = svc.feeRule("RAC", "new_model", last).orElseThrow();
            FeeRule next = svc.feeRule("RAC", "new_model", HANDOVER).orElseThrow();
            assertEquals(2, old.version().version(), label + ": the day before the boundary is still v2");
            assertEquals(new BigDecimal("24000.00"), old.amountInr());
            assertEquals(3, next.version().version(), label + ": the boundary itself is the successor");
            assertEquals(new BigDecimal("30000.00"), next.amountInr());
            assertTrue(next.version().beeVerified(), "a verified successor can now follow an open-ended version");
            assertEquals(2, svc.feeRule("RAC", "new_model", LocalDate.of(2026, 10, 1)).orElseThrow().version().version(), "earlier dates unchanged");
            assertEquals(1, svc.feeRule("RAC", "new_model", LocalDate.of(2026, 9, 30)).orElseThrow().version().version());
            assertEquals("0-unverified", svc.ratingFormula("RAC", last).orElseThrow().formulaLabel(), label);
            assertEquals("test-only-1", svc.ratingFormula("RAC", HANDOVER).orElseThrow().formulaLabel(), label);
            assertEquals("Room air conditioner", repo.category("RAC", last).orElseThrow().name());
            assertEquals(2, repo.category("RAC", HANDOVER).orElseThrow().version().version());
            assertEquals("synthetic-2026", svc.applicableStandard("RAC", "performance_test", last).orElseThrow().edition());
            assertEquals("test-2027", svc.applicableStandard("RAC", "performance_test", HANDOVER).orElseThrow().edition());
            assertTrue(svc.accreditation("LAB", "RAC", last).accredited());
            assertEquals(AccreditationOutcome.WITHDRAWN, svc.accreditation("LAB", "RAC", HANDOVER).outcome());

            /* the closed rows are byte-for-byte what they were; the closure sits beside them */
            var after = snapshot(t, true);
            assertTrue(after.containsAll(before), label + ": every original version, id and recorded_at unchanged");
            assertEquals(before.size() + 5, after.size());
            MasterVersion closed = repo.history(MasterDataRepository.Table.FEE_RULE, "RAC:new_model").get(1);
            assertNull(closed.effectiveTo(), "the recorded end of v2 stays open-ended");
            assertEquals(HANDOVER, closed.effectiveUntil());
            assertEquals(new MasterVersion.Closure(HANDOVER, 3, ACTOR, CLOSURE_SOURCE, REASON, closed.closure().recordedAt()), closed.closure());
            assertNull(repo.history(MasterDataRepository.Table.FEE_RULE, "RAC:new_model").get(2).closure(), "the successor is open");

            /* a second closure, a direct closure, a direct successor, an overlap and any change to a closure are refused */
            DataAccessException again = assertThrows(DataAccessException.class, () -> repo.supersede(MasterDataRepository.Table.FEE_RULE, "RAC:new_model", 2,
                LocalDate.of(2028, 1, 1), ACTOR, CLOSURE_SOURCE, REASON, successor("synthetic", "\"category_code\": \"RAC\", \"application_type\": \"new_model\", \"amount_inr\": 1")));
            assertEquals("23505", sqlState(again));
            assertTrue(again.getMessage().contains("already closed"));
            DataAccessException direct = assertThrows(DataAccessException.class, () -> t.update(
                "INSERT INTO master_closure (master_table, rule_key, version, effective_to, successor_version, closed_by, source_reference, reason) "
                    + "VALUES ('master_fee_rule', 'RAC:new_model', 3, '2028-01-01', 4, 'x', 'x', 'x')"));
            assertEquals("42501", sqlState(direct), "closures are written only by master_supersede()");
            for (String from : List.of("2026-12-01", "2027-03-31", "2028-01-01")) {
                DataAccessException overlap = assertThrows(DataAccessException.class, () -> t.update(
                    "INSERT INTO master_fee_rule (rule_key, version, effective_from, effective_to, source_reference, verification_status, note, category_code, application_type, amount_inr) "
                        + "VALUES ('RAC:new_model', 9, ?::date, ?::date + 1, 'test', 'synthetic', 'probe', 'RAC', 'new_model', 1)", from, from));
                assertEquals("23P01", sqlState(overlap), from + " lies in closed v2 or open v3");
            }
            for (String sql : List.of("UPDATE master_closure SET effective_to = '2028-01-01'", "DELETE FROM master_closure", "TRUNCATE master_closure")) {
                DataAccessException e = assertThrows(DataAccessException.class, () -> t.execute(sql), sql);
                assertEquals("55000", sqlState(e), sql);
            }
            assertEquals(5, closures(t));
            assertEquals(after, snapshot(t, true), label + ": the refusals changed nothing");

            /* repeat seeding leaves the closures and successors alone */
            t.execute(seed);
            assertEquals(after, snapshot(t, true), label + ": repeat seed after supersession");
            assertEquals(5, closures(t));
        }

        /* a targeted reset rebuilds the seeded state: no closures, fee v2 open-ended again */
        JdbcTemplate reset = build(MAIN + "_close_fresh", false);
        reset.execute(seed);
        assertEquals(0, closures(reset));
        assertEquals(snapshot(db, false).stream().filter(r -> !String.valueOf(r.get("k")).contains("probe")).toList(), snapshot(reset, false));
        assertNull(new MasterDataRepository(reset).feeRule("RAC", "new_model", HANDOVER).orElseThrow().version().effectiveUntil());
    }

    /** Every refused supersession leaves neither a closure nor a successor, and the open-ended version still applies. */
    @Test
    void aFailedSupersessionRollsBackBothChanges() {
        JdbcTemplate t = build(MAIN + "_rollback", true);
        t.execute(seed);
        var repo = new MasterDataRepository(t);
        var before = snapshot(t, true);
        String fee = "\"category_code\": \"RAC\", \"application_type\": \"new_model\", ";
        record Attempt(String why, String state, MasterDataRepository.Table table, String key, int version, LocalDate on, String actor, String reason, String successor) {
        }
        List<Attempt> attempts = List.of(
            new Attempt("closure date on the version's start", "22023", MasterDataRepository.Table.FEE_RULE, "RAC:new_model", 2, LocalDate.of(2026, 10, 1), ACTOR, REASON, successor("provisional", fee + "\"amount_inr\": 1")),
            new Attempt("closure date before the version's start", "22023", MasterDataRepository.Table.FEE_RULE, "RAC:new_model", 2, LocalDate.of(2026, 9, 1), ACTOR, REASON, successor("provisional", fee + "\"amount_inr\": 1")),
            new Attempt("no closure date", "22023", MasterDataRepository.Table.FEE_RULE, "RAC:new_model", 2, null, ACTOR, REASON, successor("provisional", fee + "\"amount_inr\": 1")),
            new Attempt("a bounded version", "22023", MasterDataRepository.Table.FEE_RULE, "RAC:new_model", 1, LocalDate.of(2026, 6, 1), ACTOR, REASON, successor("provisional", fee + "\"amount_inr\": 1")),
            new Attempt("an unknown version", "P0002", MasterDataRepository.Table.FEE_RULE, "RAC:new_model", 7, HANDOVER, ACTOR, REASON, successor("provisional", fee + "\"amount_inr\": 1")),
            new Attempt("a blank actor", "23514", MasterDataRepository.Table.FEE_RULE, "RAC:new_model", 2, HANDOVER, " ", REASON, successor("provisional", fee + "\"amount_inr\": 1")),
            new Attempt("a blank reason", "23514", MasterDataRepository.Table.FEE_RULE, "RAC:new_model", 2, HANDOVER, ACTOR, "", successor("provisional", fee + "\"amount_inr\": 1")),
            new Attempt("the successor sets its own version", "22023", MasterDataRepository.Table.FEE_RULE, "RAC:new_model", 2, HANDOVER, ACTOR, REASON, successor("provisional", fee + "\"amount_inr\": 1, \"version\": 9")),
            new Attempt("an unknown successor column", "22023", MasterDataRepository.Table.FEE_RULE, "RAC:new_model", 2, HANDOVER, ACTOR, REASON, successor("provisional", fee + "\"amount\": 1")),
            /* these fail on the successor insert, after the closure row is written */
            new Attempt("an invalid successor amount", "23514", MasterDataRepository.Table.FEE_RULE, "RAC:new_model", 2, HANDOVER, ACTOR, REASON, successor("provisional", fee + "\"amount_inr\": -1")),
            new Attempt("a successor ending on its own start", "23514", MasterDataRepository.Table.FEE_RULE, "RAC:new_model", 2, HANDOVER, ACTOR, REASON, successor("provisional", fee + "\"amount_inr\": 1, \"effective_to\": \"2027-04-01\"")),
            new Attempt("a successor with a missing payload column", "23502", MasterDataRepository.Table.FEE_RULE, "RAC:new_model", 2, HANDOVER, ACTOR, REASON, successor("provisional", "\"category_code\": \"RAC\", \"application_type\": \"new_model\"")),
            new Attempt("a computable unverified formula", "23514", MasterDataRepository.Table.RATING_FORMULA, "RAC:star_rating", 1, HANDOVER, ACTOR, REASON,
                successor("provisional", "\"category_code\": \"RAC\", \"formula_label\": \"x\", \"inputs\": [], \"definition\": {}, \"computation_allowed\": true")));
        for (Attempt a : attempts) {
            DataAccessException e = assertThrows(DataAccessException.class, () -> repo.supersede(a.table(), a.key(), a.version(), a.on(), a.actor(), CLOSURE_SOURCE, a.reason(), a.successor()), a.why());
            assertEquals(a.state(), sqlState(e), a.why() + ": " + e.getMessage());
            assertEquals(0, closures(t), a.why());
            assertEquals(before, snapshot(t, true), a.why());
        }

        /* a supersession that succeeded inside a transaction that then fails is rolled back with it */
        var ds = (DriverManagerDataSource) t.getDataSource();
        var tx = new TransactionTemplate(new DataSourceTransactionManager(ds));
        var txRepo = new MasterDataRepository(new JdbcTemplate(ds));
        assertThrows(IllegalStateException.class, () -> tx.executeWithoutResult(status -> {
            assertEquals(3, txRepo.supersede(MasterDataRepository.Table.FEE_RULE, "RAC:new_model", 2, HANDOVER, ACTOR, CLOSURE_SOURCE, REASON, successor("provisional", fee + "\"amount_inr\": 1")));
            throw new IllegalStateException("caller failed after superseding");
        }));
        assertEquals(0, closures(t));
        assertEquals(before, snapshot(t, true));
        assertEquals(new BigDecimal("24000.00"), repo.feeRule("RAC", "new_model", HANDOVER).orElseThrow().amountInr(), "v2 still applies, open-ended");
        assertEquals(0, t.queryForObject("SELECT count(*) FROM master_fee_rule WHERE verification_status = 'verified'", Integer.class));
    }
}
