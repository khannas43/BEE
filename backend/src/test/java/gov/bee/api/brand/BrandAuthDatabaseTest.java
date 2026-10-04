package gov.bee.api.brand;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import gov.bee.api.brand.BrandAuth.Verification;
import gov.bee.api.brand.BrandAuthService.Outcome;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.sql.Statement;
import java.time.LocalDate;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.ThreadLocalRandom;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

/**
 * WP04.2a against real PostgreSQL (bee-local-postgres), in throwaway schemas wp042_test_*
 * that are dropped afterwards; schema "app" is never migrated or seeded by this suite.
 * Tagged "db": excluded from npm run api:test; run by npm run api:test:brand-auth (and by
 * api:test:masters / local:check). Fails if the database is unreachable.
 *
 * <p>Throwaway schemas migrate V1 through V6. The shared app schema is snapshotted before
 * and after this suite, and the suite never migrates or seeds it.
 */
@Tag("db")
class BrandAuthDatabaseTest {

    static final String TAG = HexFormat.of().toHexDigits(ThreadLocalRandom.current().nextInt());
    static final String MAIN = "wp042_test_" + TAG;
    static final Path SEED = Path.of("..", "local", "seed", "seed.sql");

    static final UUID NOVA = UUID.fromString("00000000-0000-4000-b000-000000000001");
    static final UUID PIXEL = UUID.fromString("00000000-0000-4000-b000-000000000002");
    static final UUID BEE = UUID.fromString("00000000-0000-4000-b000-000000000003");
    static final UUID NOVA_COOL = UUID.fromString("00000000-0000-4000-d000-000000000001");
    static final UUID PIXEL_AUTH = UUID.fromString("00000000-0000-4000-e000-000000000001");
    static final LocalDate D = LocalDate.of(2026, 6, 15);

    static JdbcTemplate admin;
    static JdbcTemplate db;
    static BrandAuthService service;
    static BrandAuthRepository repository;
    static String seed;
    static int appUsersBefore;
    static int appOrgsBefore;
    static int appBrandTablesBefore;
    static int appVersionBefore;
    static List<Map<String, Object>> appBrandsBefore;
    static List<Map<String, Object>> appAuthorisationsBefore;

    static String env(String k, String d) {
        String v = System.getenv(k);
        return v == null || v.isBlank() ? d : v;
    }

    static DriverManagerDataSource source(String schema) {
        String url = "jdbc:postgresql://127.0.0.1:" + env("BEE_PG_PORT", "5434") + "/" + env("BEE_APP_DB", "bee_app")
            + (schema == null ? "" : "?currentSchema=" + schema);
        return new DriverManagerDataSource(url, env("BEE_APP_DB_USER", "bee_app"), env("BEE_APP_DB_PASSWORD", "bee-local-app"));
    }

    static Flyway flyway(String schema) {
        return Flyway.configure().dataSource(source(schema)).schemas(schema).defaultSchema(schema).createSchemas(false)
            .locations("classpath:db/migration").load();
    }

    static void createSchema(String schema) {
        if (!schema.startsWith("wp042_test_")) throw new IllegalArgumentException(schema);
        admin.execute("DROP SCHEMA IF EXISTS " + schema + " CASCADE");
        admin.execute("CREATE SCHEMA " + schema);
    }

    @BeforeAll
    static void migrateAndSeed() throws Exception {
        admin = new JdbcTemplate(source(null));
        appUsersBefore = admin.queryForObject("SELECT count(*) FROM app.user_account", Integer.class);
        appOrgsBefore = admin.queryForObject("SELECT count(*) FROM app.organisation", Integer.class);
        appBrandTablesBefore = admin.queryForObject(
            "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'app' AND table_name IN ('brand', 'agency_authorisation')",
            Integer.class);
        appVersionBefore = admin.queryForObject("SELECT max(version::int) FROM app.flyway_schema_history WHERE success", Integer.class);
        appBrandsBefore = admin.queryForList("SELECT id::text AS id, to_jsonb(t)::text AS body FROM app.brand t ORDER BY id");
        appAuthorisationsBefore = admin.queryForList("SELECT id::text AS id, to_jsonb(t)::text AS body FROM app.agency_authorisation t ORDER BY id");
        seed = Files.readString(SEED);
        createSchema(MAIN);
        flyway(MAIN).migrate();
        db = new JdbcTemplate(source(MAIN));
        db.execute(seed);
        repository = new BrandAuthRepository(db);
        service = new BrandAuthService(repository);
    }

    @AfterAll
    static void dropSchemasAndAssertAppUntouched() {
        if (admin != null) {
            admin.execute("DROP SCHEMA IF EXISTS " + MAIN + " CASCADE");
            Integer left = admin.queryForObject(
                "SELECT count(*) FROM information_schema.schemata WHERE schema_name LIKE 'wp042_test_%'", Integer.class);
            assertEquals(0, left, "no throwaway wp042_test_* schemas left");
            assertEquals(appUsersBefore, admin.queryForObject("SELECT count(*) FROM app.user_account", Integer.class),
                "seeded users in app schema untouched");
            assertEquals(appOrgsBefore, admin.queryForObject("SELECT count(*) FROM app.organisation", Integer.class),
                "organisations in app schema untouched");
            assertEquals(appBrandTablesBefore, admin.queryForObject(
                "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'app' AND table_name IN ('brand', 'agency_authorisation')",
                Integer.class), "shared app brand table count unchanged");
            assertEquals(appVersionBefore, admin.queryForObject(
                "SELECT max(version::int) FROM app.flyway_schema_history WHERE success", Integer.class),
                "shared app migration version unchanged");
            assertEquals(appBrandsBefore, admin.queryForList(
                "SELECT id::text AS id, to_jsonb(t)::text AS body FROM app.brand t ORDER BY id"),
                "shared app brands unchanged");
            assertEquals(appAuthorisationsBefore, admin.queryForList(
                "SELECT id::text AS id, to_jsonb(t)::text AS body FROM app.agency_authorisation t ORDER BY id"),
                "shared app agency authorisations unchanged");
        }
    }

    static String sqlState(Throwable e) {
        for (Throwable t = e; t != null; t = t.getCause()) if (t instanceof SQLException s) return s.getSQLState();
        return null;
    }

    @Test
    void seededNovaBrandAndPixelAuthorisationResolveOnDate() {
        var brand = service.ownedBrand(NOVA_COOL, NOVA).orElseThrow();
        assertEquals("Nova Cool", brand.name());
        assertTrue(brand.active());
        assertFalse(brand.provenance().beeVerified());
        assertEquals(Verification.SYNTHETIC, brand.provenance().verification());
        var decision = service.agencyAuthorisation(PIXEL, NOVA_COOL, NOVA, D);
        assertTrue(decision.authorised());
        assertEquals(Outcome.AUTHORISED, decision.outcome());
        assertEquals(PIXEL_AUTH, decision.authorisation().orElseThrow().id());
        assertTrue(decision.authorisation().orElseThrow().covers(LocalDate.of(2026, 1, 1)));
        assertTrue(decision.authorisation().orElseThrow().covers(LocalDate.of(2099, 12, 31)));
        assertFalse(decision.authorisation().orElseThrow().covers(LocalDate.of(2025, 12, 31)));
    }

    @Test
    void wrongBrandExpiredRevokedAndCrossOrgAreDenied() {
        UUID otherBrand = UUID.fromString("00000000-0000-4000-d000-000000000099");
        db.update("INSERT INTO brand (id, name, owner_organisation_id, status, source_reference, verification_status, note) VALUES "
            + "(?, 'Aurora Probe', ?, 'active', 'test', 'synthetic', 'probe')", otherBrand, NOVA);

        assertEquals(Outcome.WRONG_BRAND, service.agencyAuthorisation(PIXEL, otherBrand, NOVA, D).outcome());
        assertEquals(Outcome.WRONG_BRAND, service.agencyAuthorisation(PIXEL, UUID.randomUUID(), NOVA, D).outcome(),
            "unknown brand id while the agency holds a grant for another brand of the same principal");
        assertEquals(Outcome.PRINCIPAL_MISMATCH, service.agencyAuthorisation(PIXEL, NOVA_COOL, BEE, D).outcome());
        assertEquals(Outcome.NO_AUTHORISATION, service.agencyAuthorisation(BEE, NOVA_COOL, NOVA, D).outcome(),
            "BEE is not an agency with a grant");
        assertEquals(Outcome.NO_AUTHORISATION, service.agencyAuthorisation(PIXEL, UUID.randomUUID(), BEE, D).outcome(),
            "unknown brand and principal with no grants at all");

        db.update("INSERT INTO agency_authorisation (id, agency_organisation_id, principal_organisation_id, brand_id, "
            + "valid_from, valid_to, status, source_reference, verification_status, note) VALUES "
            + "(gen_random_uuid(), ?, ?, ?, '2024-01-01', '2025-01-01', 'active', 'test', 'synthetic', 'expired probe')",
            PIXEL, NOVA, otherBrand);
        assertEquals(Outcome.EXPIRED, service.agencyAuthorisation(PIXEL, otherBrand, NOVA, D).outcome());
        assertEquals(Outcome.EXPIRED, service.agencyAuthorisation(PIXEL, otherBrand, NOVA, LocalDate.of(2025, 1, 1)).outcome(),
            "exclusive end");
        assertEquals(Outcome.AUTHORISED, service.agencyAuthorisation(PIXEL, otherBrand, NOVA, LocalDate.of(2024, 6, 1)).outcome());

        UUID revokedBrand = UUID.fromString("00000000-0000-4000-d000-000000000098");
        db.update("INSERT INTO brand (id, name, owner_organisation_id, status, source_reference, verification_status, note) VALUES "
            + "(?, 'Revoked Probe', ?, 'active', 'test', 'synthetic', 'probe')", revokedBrand, NOVA);
        db.update("INSERT INTO agency_authorisation (id, agency_organisation_id, principal_organisation_id, brand_id, "
            + "valid_from, valid_to, status, source_reference, verification_status, note) VALUES "
            + "(gen_random_uuid(), ?, ?, ?, '2026-01-01', NULL, 'revoked', 'test', 'synthetic', 'revoked probe')",
            PIXEL, NOVA, revokedBrand);
        assertEquals(Outcome.REVOKED, service.agencyAuthorisation(PIXEL, revokedBrand, NOVA, D).outcome());
    }

    @Test
    void brandOwnershipMustMatchPrincipalAndReferentialIntegrityHolds() {
        DataAccessException wrongOwner = assertThrows(DataAccessException.class, () -> db.update(
            "INSERT INTO brand (name, owner_organisation_id, status, source_reference, verification_status, note) VALUES "
                + "('Not A Manufacturer Brand', ?, 'active', 'test', 'synthetic', 'probe')", PIXEL));
        assertEquals("23514", sqlState(wrongOwner));

        UUID otherMfr = UUID.fromString("00000000-0000-4000-b000-000000000099");
        db.update("INSERT INTO organisation (id, code, kind, legal_name) VALUES (?, 'OTHERMFR', 'manufacturer', 'Other Manufacturer (probe)')",
            otherMfr);
        DataAccessException principalMismatch = assertThrows(DataAccessException.class, () -> db.update(
            "INSERT INTO agency_authorisation (agency_organisation_id, principal_organisation_id, brand_id, valid_from, status, "
                + "source_reference, verification_status, note) VALUES (?, ?, ?, '2026-01-01', 'active', 'test', 'synthetic', 'probe')",
            PIXEL, otherMfr, NOVA_COOL));
        assertEquals("23514", sqlState(principalMismatch));
        assertTrue(principalMismatch.getMessage().contains("must own the brand"));

        DataAccessException unknownBrand = assertThrows(DataAccessException.class, () -> db.update(
            "INSERT INTO agency_authorisation (agency_organisation_id, principal_organisation_id, brand_id, valid_from, status, "
                + "source_reference, verification_status, note) VALUES (?, ?, ?, '2026-01-01', 'active', 'test', 'synthetic', 'probe')",
            PIXEL, NOVA, UUID.randomUUID()));
        assertEquals("23503", sqlState(unknownBrand));

        DataAccessException notAgency = assertThrows(DataAccessException.class, () -> db.update(
            "INSERT INTO agency_authorisation (agency_organisation_id, principal_organisation_id, brand_id, valid_from, status, "
                + "source_reference, verification_status, note) VALUES (?, ?, ?, '2026-01-01', 'active', 'test', 'synthetic', 'probe')",
            NOVA, NOVA, NOVA_COOL));
        assertEquals("23514", sqlState(notAgency));
    }

    @Test
    void overlappingActiveAuthorisationPeriodsAreRejectedIncludingConcurrentGrants() throws Exception {
        UUID brandId = UUID.fromString("00000000-0000-4000-d000-000000000097");
        db.update("INSERT INTO brand (id, name, owner_organisation_id, status, source_reference, verification_status, note) VALUES "
            + "(?, 'Overlap Probe', ?, 'active', 'test', 'synthetic', 'probe')", brandId, NOVA);
        db.update("INSERT INTO agency_authorisation (agency_organisation_id, principal_organisation_id, brand_id, valid_from, valid_to, "
            + "status, source_reference, verification_status, note) VALUES (?, ?, ?, '2031-01-01', '2031-06-01', 'active', 'test', "
            + "'synthetic', 'probe')", PIXEL, NOVA, brandId);

        String[][] overlapping = {
            {"2031-01-01", "2031-06-01"}, {"2031-03-01", "2031-09-01"}, {"2030-12-01", "2031-07-01"},
            {"2030-01-01", null}, {"2031-05-31", "2031-06-01"}
        };
        for (String[] p : overlapping) {
            DataAccessException e = assertThrows(DataAccessException.class, () -> insertAuth(brandId, p[0], p[1], "active"),
                p[0] + ".." + p[1]);
            assertEquals("23P01", sqlState(e), p[0] + ".." + p[1]);
        }
        insertAuth(brandId, "2031-06-01", "2031-07-01", "active");
        insertAuth(brandId, "2031-07-01", null, "active");
        DataAccessException afterOpen = assertThrows(DataAccessException.class,
            () -> insertAuth(brandId, "2032-01-01", null, "active"));
        assertEquals("23P01", sqlState(afterOpen), "open-ended active grant blocks a later start");

        insertAuth(brandId, "2028-01-01", "2028-06-01", "revoked");
        insertAuth(brandId, "2028-03-01", "2028-09-01", "active");

        UUID concurrentBrand = UUID.fromString("00000000-0000-4000-d000-000000000096");
        db.update("INSERT INTO brand (id, name, owner_organisation_id, status, source_reference, verification_status, note) VALUES "
            + "(?, 'Concurrent Probe', ?, 'active', 'test', 'synthetic', 'probe')", concurrentBrand, NOVA);
        AtomicInteger successes = new AtomicInteger();
        AtomicInteger conflicts = new AtomicInteger();
        AtomicReference<String> unexpected = new AtomicReference<>();
        CyclicBarrier start = new CyclicBarrier(2);
        CountDownLatch done = new CountDownLatch(2);
        Runnable attempt = () -> {
            try {
                start.await(10, TimeUnit.SECONDS);
                try (Connection c = DriverManager.getConnection(source(MAIN).getUrl(), source(MAIN).getUsername(),
                    source(MAIN).getPassword()); Statement s = c.createStatement()) {
                    s.execute("INSERT INTO agency_authorisation (agency_organisation_id, principal_organisation_id, brand_id, "
                        + "valid_from, valid_to, status, source_reference, verification_status, note) VALUES ('"
                        + PIXEL + "', '" + NOVA + "', '" + concurrentBrand
                        + "', '2035-01-01', '2035-12-01', 'active', 'test', 'synthetic', 'concurrent')");
                    successes.incrementAndGet();
                } catch (SQLException e) {
                    if ("23P01".equals(e.getSQLState())) conflicts.incrementAndGet();
                    else unexpected.compareAndSet(null, e.getSQLState() + ":" + e.getMessage());
                }
            } catch (Exception e) {
                unexpected.compareAndSet(null, e.toString());
            } finally {
                done.countDown();
            }
        };
        Thread t1 = new Thread(attempt, "auth-a");
        Thread t2 = new Thread(attempt, "auth-b");
        t1.start();
        t2.start();
        assertTrue(done.await(30, TimeUnit.SECONDS));
        assertEquals(null, unexpected.get());
        assertEquals(1, successes.get(), "exactly one concurrent grant succeeds");
        assertEquals(1, conflicts.get(), "the other concurrent grant hits the overlap guard");
        assertEquals(1, db.queryForObject(
            "SELECT count(*) FROM agency_authorisation WHERE brand_id = ? AND status = 'active' AND valid_from = DATE '2035-01-01'",
            Integer.class, concurrentBrand));
    }

    void insertAuth(UUID brandId, String from, String to, String status) {
        db.update("INSERT INTO agency_authorisation (agency_organisation_id, principal_organisation_id, brand_id, valid_from, valid_to, "
            + "status, source_reference, verification_status, note) VALUES (?, ?, ?, ?::date, ?::date, ?, 'test', 'synthetic', 'probe')",
            PIXEL, NOVA, brandId, from, to, status);
    }

    @Test
    void repeatSeedingIsIdempotentAndChangedFixtureIsRefused() {
        var once = snapshot();
        db.execute(seed);
        db.execute(seed);
        assertEquals(once, snapshot(), "same brand and authorisation rows after repeat seed");
        assertEquals(1, db.queryForObject("SELECT count(*) FROM seed_run WHERE seed_version = 'wp04.2-brand-auth-v1'", Integer.class));
        String changed = seed.replace("Nova Cool", "Nova Cool Renamed");
        assertNotEquals(seed, changed);
        DataAccessException e = assertThrows(DataAccessException.class, () -> db.execute(changed));
        assertTrue(e.getMessage().contains("brand: a stored row differs from the fixture"), e.getMessage());
        assertEquals(once, snapshot(), "refused seed rolled back");
        assertEquals("Nova Cool", db.queryForObject("SELECT brand_name FROM model_application WHERE reference = 'LOCAL-MA-0001'", String.class),
            "model_application.brand_name unchanged by this activity");
    }

    @Test
    void flywayOnThrowawayIncludesV5AndV6AndDoesNotTouchApp() {
        Integer max = db.queryForObject("SELECT max(installed_rank) FROM flyway_schema_history", Integer.class);
        List<Map<String, Object>> versions = db.queryForList(
            "SELECT version, script FROM flyway_schema_history WHERE success ORDER BY installed_rank");
        assertTrue(versions.stream().anyMatch(v -> "4".equals(String.valueOf(v.get("version")))));
        assertTrue(versions.stream().anyMatch(v -> "6".equals(String.valueOf(v.get("version")))));
        assertTrue(versions.stream().anyMatch(v -> "5".equals(String.valueOf(v.get("version")))));
        assertEquals(33, max, "throwaway schema migrated V1 through V33");
        assertEquals(appBrandTablesBefore, admin.queryForObject(
            "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'app' AND table_name IN ('brand', 'agency_authorisation')",
            Integer.class));
        assertEquals(appVersionBefore, admin.queryForObject(
            "SELECT max(version::int) FROM app.flyway_schema_history WHERE success", Integer.class));
    }

    List<Map<String, Object>> snapshot() {
        return db.queryForList(
            "SELECT 'brand' AS t, id::text AS id, name || '|' || owner_organisation_id::text || '|' || status || '|' || verification_status AS body "
                + "FROM brand WHERE name NOT ILIKE '%probe%' "
                + "UNION ALL SELECT 'auth', id::text, agency_organisation_id::text || '|' || brand_id::text || '|' || status || '|' "
                + "|| valid_from::text || '|' || coalesce(valid_to::text, 'open') FROM agency_authorisation "
                + "WHERE note NOT ILIKE '%probe%' ORDER BY 1, 2");
    }
}
