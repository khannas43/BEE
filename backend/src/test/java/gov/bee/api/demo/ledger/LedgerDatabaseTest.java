package gov.bee.api.demo.ledger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import gov.bee.api.demo.DemoResult;
import gov.bee.api.identity.Caller;
import gov.bee.api.identity.IdentityRepository.RoleGrant;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDate;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ThreadLocalRandom;
import java.util.concurrent.atomic.AtomicInteger;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

/** The simulated ledger against throwaway PostgreSQL as the restricted runtime login: the seed, the state machine, segregation, scope, the hash chain. */
@Tag("db")
class LedgerDatabaseTest {

    static final String TAG = HexFormat.of().toHexDigits(ThreadLocalRandom.current().nextInt());
    static final String MAIN = "demos3_test_" + TAG;
    static final Path SEED = Path.of("..", "local", "seed", "seed.sql");
    static final Path LEDGER_SEED = Path.of("..", "local", "seed", "demo", "s3_ledger.sql");
    static final UUID NOVA_ORG = UUID.fromString("00000000-0000-4000-b000-000000000001");
    static final UUID PIXEL_ORG = UUID.fromString("00000000-0000-4000-b000-000000000002");
    static final UUID BEE_ORG = UUID.fromString("00000000-0000-4000-b000-000000000003");
    static final UUID NOVA_USER = UUID.fromString("00000000-0000-4000-a000-000000000001");
    static final UUID PIXEL_USER = UUID.fromString("00000000-0000-4000-a000-000000000002");
    static final UUID PROGRAMME_USER = UUID.fromString("00000000-0000-4000-a000-000000000006");
    static final UUID SECRETARY_USER = UUID.fromString("00000000-0000-4000-a000-000000000008");
    static final UUID ADMIN_USER = UUID.fromString("00000000-0000-4000-a000-000000000009");
    static final UUID AUDITOR_USER = UUID.fromString("00000000-0000-4000-a000-000000000011");

    static final Caller NOVA = new Caller(NOVA_USER, "nova.applicant", List.of(new RoleGrant("manufacturer", "own-org")), Set.of(NOVA_ORG));
    static final Caller PIXEL_MFR = new Caller(PIXEL_USER, "pixel.applicant", List.of(new RoleGrant("manufacturer", "own-org")), Set.of(PIXEL_ORG));
    static final Caller PROGRAMME = new Caller(PROGRAMME_USER, "bee.programme", List.of(new RoleGrant("programme", "all")), Set.of(BEE_ORG));
    static final Caller SECRETARY = new Caller(SECRETARY_USER, "bee.secretary", List.of(new RoleGrant("secretary", "all")), Set.of(BEE_ORG));
    static final Caller ADMIN = new Caller(ADMIN_USER, "bee.admin", List.of(new RoleGrant("admin", "all")), Set.of(BEE_ORG));
    static final Caller AUDITOR = new Caller(AUDITOR_USER, "bee.auditor", List.of(new RoleGrant("auditor", "all")), Set.of(BEE_ORG));
    static final Caller FINANCE = new Caller(UUID.fromString("00000000-0000-4000-a000-000000000003"), "bee.finance", List.of(new RoleGrant("finance", "all")), Set.of(BEE_ORG));

    static JdbcTemplate admin;
    static JdbcTemplate owner;
    static JdbcTemplate db;
    static LedgerModule module;
    static final AtomicInteger NEXT = new AtomicInteger(10100);
    static List<UUID> seeded;

    static String env(String k, String d) {
        String v = System.getenv(k);
        return v == null || v.isBlank() ? d : v;
    }

    static DriverManagerDataSource sourceAs(String schema, String user, String password) {
        String url = "jdbc:postgresql://127.0.0.1:" + env("BEE_PG_PORT", "5434") + "/" + env("BEE_APP_DB", "bee_app") + (schema == null ? "" : "?currentSchema=" + schema);
        return new DriverManagerDataSource(url, user, password);
    }

    static DriverManagerDataSource migrateSource(String schema) {
        return sourceAs(schema, env("BEE_FLYWAY_DB_USER", "bee_app"), env("BEE_FLYWAY_DB_PASSWORD", env("BEE_APP_DB_PASSWORD", "bee-local-app")));
    }

    /** An approved application and its certificate, inserted directly as the owner (the real issue path is tested elsewhere). */
    static UUID newCertificate(UUID org) {
        int n = NEXT.incrementAndGet();
        UUID app = UUID.randomUUID();
        UUID ev = UUID.randomUUID();
        owner.update("INSERT INTO model_application (id, reference, organisation_id, brand_name, category, model_number, state, version) VALUES (?, ?, ?, 'Nova Cool', 'RAC', ?, 'approved', 0)",
            app, "S3-MA-" + n, org, "S3-" + n);
        owner.update("INSERT INTO model_application_transition_event (id, application_id, action, from_state, to_state, actor_account_id, actor_role, version_after) VALUES (?, ?, 'approve', 'secretary_approval', 'approved', ?, 'secretary', 1)",
            ev, app, SECRETARY_USER);
        UUID cert = UUID.randomUUID();
        owner.update("INSERT INTO certificate (id, application_id, transition_event_id, registration_id, category_code, issue_year, sequence_no, valid_from, valid_to, organisation_name, brand_name, model_number, stars, declared_iseer, verified_iseer, scheme_key, issued_by_account_id) "
            + "VALUES (?, ?, ?, ?, 'RAC', 2026, ?, DATE '2026-10-01', DATE '2029-09-30', 'Nova Cool Appliances (synthetic)', 'Nova Cool', ?, 4, 4.10, 4.05, 'demo', ?)",
            cert, app, ev, "BEE/RAC/2026/" + n, n, "S3-" + n, SECRETARY_USER);
        return cert;
    }

    @BeforeAll
    static void migrateAndSeed() throws Exception {
        admin = new JdbcTemplate(migrateSource(null));
        admin.execute("DROP SCHEMA IF EXISTS " + MAIN + " CASCADE");
        admin.execute("CREATE SCHEMA " + MAIN);
        Flyway.configure().dataSource(migrateSource(MAIN)).schemas(MAIN).defaultSchema(MAIN).createSchemas(false).locations("classpath:db/migration").load().migrate();
        owner = new JdbcTemplate(migrateSource(MAIN));
        owner.execute(Files.readString(SEED));
        db = new JdbcTemplate(sourceAs(MAIN, env("BEE_RUNTIME_DB_USER", "bee_runtime"), env("BEE_RUNTIME_DB_PASSWORD", "bee-local-runtime")));
        module = new LedgerModule(new LedgerRepository(db));
        seeded = List.of(newCertificate(NOVA_ORG), newCertificate(NOVA_ORG), newCertificate(NOVA_ORG), newCertificate(NOVA_ORG));
        owner.execute(Files.readString(LEDGER_SEED));
        owner.execute(Files.readString(LEDGER_SEED)); // idempotent
    }

    @AfterAll
    static void drop() {
        if (admin != null) {
            admin.execute("DROP SCHEMA IF EXISTS " + MAIN + " CASCADE");
        }
    }

    static DemoResult get(Caller c, String id, String action) {
        return module.handle(c, "GET", id, action, Map.of(), Map.of());
    }

    static DemoResult post(Caller c, UUID cert, String action, Map<String, Object> body) {
        return module.handle(c, "POST", cert.toString(), action, Map.of(), body);
    }

    static String status(UUID cert) {
        return (String) get(ADMIN, cert.toString(), null).body().get("ledgerStatus");
    }

    static String verify(UUID cert) {
        return (String) get(ADMIN, cert.toString(), "verify").body().get("result");
    }

    @Test
    void seededStatesAndTheSeededMismatch() {
        assertEquals("active", status(seeded.get(0)));
        assertEquals("pending", status(seeded.get(1)));
        assertEquals("failed", status(seeded.get(2)));
        assertEquals("active", status(seeded.get(3)));
        assertEquals("MATCH", verify(seeded.get(0)));
        assertEquals("MATCH", verify(seeded.get(1)));
        assertEquals("MATCH", verify(seeded.get(2)));
        assertEquals("MISMATCH", verify(seeded.get(3)), "seeded mismatch");
        assertEquals(1, owner.queryForObject("SELECT count(*) FROM ledger_tx WHERE certificate_id = ?", Integer.class, seeded.get(0)));
        assertEquals(2, owner.queryForObject("SELECT count(*) FROM ledger_tx WHERE certificate_id = ?", Integer.class, seeded.get(2)), "failed attempt kept next to the retry");
    }

    @Test
    void fullLifecycleWithSegregationAndHashChain() {
        UUID cert = newCertificate(NOVA_ORG);
        assertEquals("not_submitted", status(cert));
        assertEquals(200, post(SECRETARY, cert, "submit", Map.of()).status().value());
        assertEquals("pending", status(cert));
        assertEquals(409, post(SECRETARY, cert, "submit", Map.of()).status().value(), "already submitted");
        DemoResult own = post(SECRETARY, cert, "commit", Map.of());
        assertEquals("segregation_refused", own.code(), "the submitter cannot commit");
        assertEquals("pending", status(cert));
        assertEquals("segregation_refused", post(SECRETARY, cert, "fail", Map.of("reason", "x")).code());
        assertEquals(400, post(ADMIN, cert, "fail", Map.of()).status().value(), "a failure needs a reason");
        assertEquals(200, post(ADMIN, cert, "fail", Map.of("reason", "simulated peer timeout")).status().value());
        assertEquals("failed", status(cert));
        assertEquals(409, post(ADMIN, cert, "commit", Map.of()).status().value(), "nothing pending after a failure");
        assertEquals(200, post(PROGRAMME, cert, "retry", Map.of()).status().value());
        assertEquals("pending", status(cert));
        assertEquals(2, owner.queryForObject("SELECT max(attempt) FROM ledger_tx WHERE certificate_id = ?", Integer.class, cert));
        assertEquals("failed", owner.queryForObject("SELECT state FROM ledger_tx WHERE certificate_id = ? AND seq = 1", String.class, cert), "previous failure kept");
        assertEquals(200, post(ADMIN, cert, "commit", Map.of()).status().value());
        assertEquals("active", status(cert));
        assertEquals("MATCH", verify(cert));

        // amendment: validTo only, second person
        assertEquals(400, post(SECRETARY, cert, "amend", Map.of("validTo", "2029-06-30")).status().value(), "reason required");
        assertEquals(400, post(SECRETARY, cert, "amend", Map.of("reason", "r", "validTo", "2029-06-30", "stars", 5)).status().value(), "only validTo may change");
        assertEquals(400, post(SECRETARY, cert, "amend", Map.of("reason", "r", "validTo", "2020-01-01")).status().value(), "before valid-from");
        assertEquals(400, post(SECRETARY, cert, "amend", Map.of("reason", "r", "validTo", "2999-01-01")).status().value(), "far beyond any real validity");
        assertEquals(400, post(SECRETARY, cert, "amend", Map.of("reason", "r", "validTo", "+999999999-12-31")).status().value(), "an extreme date is refused, not an error");
        assertEquals(200, post(SECRETARY, cert, "amend", Map.of("reason", "Shorter validity agreed (demo)", "validTo", "2029-06-30")).status().value());
        assertEquals("active", status(cert), "a pending amendment does not change the status yet");
        assertEquals("amend", get(ADMIN, cert.toString(), null).body().get("pendingKind"));
        assertEquals("segregation_refused", post(SECRETARY, cert, "commit", Map.of()).code());
        assertEquals(409, post(ADMIN, cert, "revoke", Map.of("reason", "r")).status().value(), "busy while a transaction is pending");
        assertEquals(200, post(ADMIN, cert, "commit", Map.of()).status().value());
        assertEquals("amended", status(cert));
        assertEquals("2029-06-30", get(ADMIN, cert.toString(), null).body().get("ledgerValidTo"));
        assertEquals("2029-09-30", get(ADMIN, cert.toString(), null).body().get("validTo"), "the certificate itself is untouched");

        // revocation
        assertEquals(400, post(ADMIN, cert, "revoke", Map.of()).status().value(), "revoke needs a reason");
        assertEquals(200, post(ADMIN, cert, "revoke", Map.of("reason", "Test report withdrawn (demo)")).status().value());
        assertEquals("amended", status(cert), "revoke pending");
        assertEquals("segregation_refused", post(ADMIN, cert, "commit", Map.of()).code());
        assertEquals(200, post(PROGRAMME, cert, "commit", Map.of()).status().value());
        assertEquals("revoked", status(cert));
        assertEquals(409, post(ADMIN, cert, "amend", Map.of("reason", "r", "validTo", "2029-01-01")).status().value());
        assertEquals("MATCH", verify(cert));
        assertEquals(4, owner.queryForObject("SELECT count(*) FROM ledger_tx WHERE certificate_id = ?", Integer.class, cert));
        assertTrue(owner.queryForObject("SELECT count(*) FROM ledger_event WHERE certificate_id = ?", Integer.class, cert) >= 8, "every action is audited");
        // the chain: each prev_hash is the earlier hash
        assertEquals(0, owner.queryForObject("SELECT count(*) FROM ledger_tx t JOIN ledger_tx p ON p.certificate_id = t.certificate_id AND p.seq = t.seq - 1 "
            + "WHERE t.certificate_id = ? AND t.prev_hash <> p.hash", Integer.class, cert));
    }

    @Test
    void tamperingIsDetectedAndRowsAreAppendOnly() {
        UUID cert = newCertificate(NOVA_ORG);
        post(SECRETARY, cert, "submit", Map.of());
        post(ADMIN, cert, "commit", Map.of());
        assertEquals("MATCH", verify(cert));
        // the runtime login cannot write the table at all
        assertThrows(Exception.class, () -> db.update("UPDATE ledger_tx SET hash = repeat('f', 64) WHERE certificate_id = ?", cert));
        assertThrows(Exception.class, () -> db.update("DELETE FROM ledger_tx WHERE certificate_id = ?", cert));
        // even the owner may not rewrite a committed row
        assertThrows(Exception.class, () -> owner.update("UPDATE ledger_tx SET state = 'failed', failure_reason = 'x' WHERE certificate_id = ?", cert));
        assertThrows(Exception.class, () -> owner.update("DELETE FROM ledger_tx WHERE certificate_id = ?", cert));
        // a tampered hash (done with the guard bypassed, as a maintenance user would) is caught
        owner.execute("ALTER TABLE ledger_tx DISABLE TRIGGER ledger_tx_guard");
        owner.update("UPDATE ledger_tx SET hash = repeat('e', 64) WHERE certificate_id = ?", cert);
        owner.execute("ALTER TABLE ledger_tx ENABLE TRIGGER ledger_tx_guard");
        assertEquals("MISMATCH", verify(cert));
        assertEquals(1, ((Number) get(ADMIN, cert.toString(), "verify").body().get("firstBadSeq")).intValue());
    }

    @Test
    void readScopeAndRoleDenials() {
        UUID cert = seeded.get(0);
        // manufacturer: own organisation read-only
        assertEquals(200, get(NOVA, cert.toString(), null).status().value());
        DemoResult list = get(NOVA, null, null);
        assertTrue(((List<?>) list.body().get("certificates")).size() >= 4);
        assertEquals(404, get(PIXEL_MFR, cert.toString(), null).status().value(), "other organisation: same answer as unknown");
        assertEquals(404, get(PIXEL_MFR, UUID.randomUUID().toString(), null).status().value());
        assertTrue(((List<?>) get(PIXEL_MFR, null, null).body().get("certificates")).isEmpty());
        assertTrue(((List<?>) get(PIXEL_MFR, "transactions", null).body().get("transactions")).isEmpty());
        assertEquals(403, post(NOVA, cert, "revoke", Map.of("reason", "r")).status().value(), "manufacturer cannot write");
        assertEquals(403, post(AUDITOR, cert, "revoke", Map.of("reason", "r")).status().value(), "auditor reads only");
        assertEquals(200, get(AUDITOR, cert.toString(), null).status().value());
        assertEquals(403, get(FINANCE, null, null).status().value(), "other roles read nothing");
        assertEquals(404, get(ADMIN, "not-a-uuid", null).status().value());
        assertEquals(false, ((List<?>) get(ADMIN, "transactions", null).body().get("transactions")).isEmpty());
        // actions offered: the submitter is not offered commit
        UUID pending = seeded.get(1);
        var actions = (List<?>) get(SECRETARY, pending.toString(), null).body().get("actions");
        assertTrue(actions.toString().contains("action=commit") && actions.toString().contains("allowed=false"));
        assertNotNull(get(ADMIN, pending.toString(), null).body().get("notice"));
    }

    @Test
    void certificatesAndPublicViewAreUntouched() {
        assertEquals(LocalDate.parse("2029-09-30"), owner.queryForObject("SELECT valid_to FROM public_certificate WHERE registration_id = (SELECT registration_id FROM certificate WHERE id = ?)",
            LocalDate.class, seeded.get(0)));
    }
}
