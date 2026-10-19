package gov.bee.api.revocation;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import gov.bee.api.application.IdempotencyRepository;
import gov.bee.api.identity.Caller;
import gov.bee.api.identity.IdentityRepository.RoleGrant;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ThreadLocalRandom;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataAccessException;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

/**
 * Closing and revoking a registered brand or an agency authorisation (WP04.2b-2b), against throwaway PostgreSQL as the restricted runtime
 * login: Programme proposes, the Director decides, never the same person, and approval changes the register in the same step.
 */
@Tag("db")
class RevocationDatabaseTest {

    static final String TAG = HexFormat.of().toHexDigits(ThreadLocalRandom.current().nextInt());
    static final String MAIN = "wp042b2b_test_" + TAG;
    static final Path SEED = Path.of("..", "local", "seed", "seed.sql");
    static final UUID NOVA_ORG = UUID.fromString("00000000-0000-4000-b000-000000000001");
    static final UUID PIXEL_ORG = UUID.fromString("00000000-0000-4000-b000-000000000002");
    static final UUID BEE_ORG = UUID.fromString("00000000-0000-4000-b000-000000000003");
    static final UUID NOVA_USER = UUID.fromString("00000000-0000-4000-a000-000000000001");
    static final UUID PIXEL_USER = UUID.fromString("00000000-0000-4000-a000-000000000002");
    static final UUID FINANCE_USER = UUID.fromString("00000000-0000-4000-a000-000000000003");
    static final UUID PROGRAMME_USER = UUID.fromString("00000000-0000-4000-a000-000000000006");
    static final UUID ADMIN_USER = UUID.fromString("00000000-0000-4000-a000-000000000009");
    static final UUID NOVA_COOL = UUID.fromString("00000000-0000-4000-d000-000000000001");
    static final LocalDate TODAY = LocalDate.now(ZoneId.of("Asia/Kolkata"));

    static final Caller NOVA = new Caller(NOVA_USER, "nova.applicant", List.of(new RoleGrant("manufacturer", "own-org")), Set.of(NOVA_ORG));
    static final Caller PIXEL = new Caller(PIXEL_USER, "pixel.applicant", List.of(new RoleGrant("agency", "own-org")), Set.of(PIXEL_ORG));
    static final Caller FINANCE = new Caller(FINANCE_USER, "bee.finance", List.of(new RoleGrant("finance", "all")), Set.of(BEE_ORG));
    static final Caller PROGRAMME = new Caller(PROGRAMME_USER, "bee.programme", List.of(new RoleGrant("programme", "all")), Set.of(BEE_ORG));
    static final UUID OFFICER_USER = UUID.fromString("00000000-0000-4000-a000-000000000007");
    static final UUID DIRECTOR_USER = UUID.fromString("00000000-0000-4000-a000-000000000008");
    static final UUID DUAL_USER = UUID.fromString("00000000-0000-4000-a000-0000000000e1");
    static final Caller OFFICER = new Caller(OFFICER_USER, "bee.officer", List.of(new RoleGrant("officer", "all")), Set.of(BEE_ORG));
    static final Caller DIRECTOR = new Caller(DIRECTOR_USER, "bee.director", List.of(new RoleGrant("director", "all")), Set.of(BEE_ORG));
    static final Caller DUAL = new Caller(DUAL_USER, "dual.reviewer", List.of(new RoleGrant("programme", "all"), new RoleGrant("officer", "all")), Set.of(BEE_ORG));
    static final Caller ADMIN = new Caller(ADMIN_USER, "bee.admin", List.of(new RoleGrant("admin", "all")), Set.of(BEE_ORG));

    static final ObjectMapper JSON = new ObjectMapper();
    static JdbcTemplate admin;
    static JdbcTemplate owner;
    static JdbcTemplate db;
    static RevocationService service;
    static int appRegistrationTablesBefore;

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
        appRegistrationTablesBefore = admin.queryForObject(
            "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'app' AND table_name LIKE 'registration_%'", Integer.class);
        admin.execute("DROP SCHEMA IF EXISTS " + MAIN + " CASCADE");
        admin.execute("CREATE SCHEMA " + MAIN);
        Flyway.configure().dataSource(migrateSource(MAIN)).schemas(MAIN).defaultSchema(MAIN).createSchemas(false)
            .locations("classpath:db/migration").load().migrate();
        owner = new JdbcTemplate(migrateSource(MAIN));
        owner.execute(Files.readString(SEED));
        db = new JdbcTemplate(sourceAs(MAIN, env("BEE_RUNTIME_DB_USER", "bee_runtime"), env("BEE_RUNTIME_DB_PASSWORD", "bee-local-runtime")));
        service = new RevocationService(new RevocationRepository(db), new gov.bee.api.application.IdempotencyRepository(db), JSON);
        assertEquals(80, owner.queryForObject("SELECT max(installed_rank) FROM flyway_schema_history", Integer.class), "migrated V1 through V80");
    }

    @AfterAll
    static void dropAndAssertAppUntouched() {
        if (admin != null) {
            admin.execute("DROP SCHEMA IF EXISTS " + MAIN + " CASCADE");
            assertEquals(appRegistrationTablesBefore, admin.queryForObject(
                "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'app' AND table_name LIKE 'registration_%'", Integer.class),
                "the shared app schema was not migrated by this suite");
        }
    }

    static String key() {
        return UUID.randomUUID().toString();
    }

    static JsonNode json(String s) {
        try {
            return JSON.readTree(s);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    static Map<String, Object> ok(ResponseEntity<Map<String, Object>> r, int status) {
        assertEquals(status, r.getStatusCode().value(), String.valueOf(r.getBody()));
        return r.getBody();
    }

    static void refused(ResponseEntity<Map<String, Object>> r, int status, String code) {
        assertEquals(status, r.getStatusCode().value(), String.valueOf(r.getBody()));
        assertEquals(code, r.getBody().get("error"));
    }

    /** A fresh brand owned by Nova, with an open-ended active authorisation for Pixel that started a month ago. */
    record Fixture(UUID brand, UUID auth) {
    }

    static Fixture fixture() {
        UUID brand = owner.queryForObject("INSERT INTO brand (name, owner_organisation_id, status, source_reference, verification_status, note) "
            + "VALUES (?, ?, 'active', 'test', 'synthetic', 'test') RETURNING id", UUID.class, "Rv " + UUID.randomUUID().toString().substring(0, 8), NOVA_ORG);
        UUID auth = owner.queryForObject("INSERT INTO agency_authorisation (agency_organisation_id, principal_organisation_id, brand_id, valid_from, status, "
            + "source_reference, verification_status, note) VALUES (?, ?, ?, ?, 'active', 'test', 'synthetic', 'test') RETURNING id", UUID.class,
            PIXEL_ORG, NOVA_ORG, brand, TODAY.minusDays(30));
        return new Fixture(brand, auth);
    }

    static String propose(String kind, UUID target, String action, String extra) {
        return "{\"targetKind\":\"" + kind + "\",\"targetId\":\"" + target + "\",\"action\":\"" + action + "\",\"reason\":\"Licence withdrawn by the owner\"" + extra + "}";
    }

    static ResponseEntity<Map<String, Object>> decide(Caller who, Object id, String decision, String note) {
        return service.decide(who, UUID.fromString(String.valueOf(id)), key(), json("{\"decision\":\"" + decision + "\"" + (note == null ? "" : ",\"note\":\"" + note + "\"") + "}"));
    }

    @Test
    void migrationAddsTheCapabilitiesAndTheRunTimeLoginCannotChangeAProposal() {
        assertEquals(1, owner.queryForObject("SELECT count(*) FROM capability_grant WHERE capability = 'register_revoke_propose' AND role = 'programme'", Integer.class));
        assertEquals(1, owner.queryForObject("SELECT count(*) FROM capability_grant WHERE capability = 'register_revoke_decide' AND role = 'officer'", Integer.class));
        var f = fixture();
        var p = ok(service.propose(PROGRAMME, key(), json(propose("brand", f.brand(), "revoke", ""))), 201);
        assertEquals("pending", p.get("state"));
        assertThrows(DataAccessException.class, () -> db.update("UPDATE register_revocation_proposal SET state = 'approved' WHERE id = ?::uuid", p.get("id")));
    }

    @Test
    void adminDemonstrationReadsRegisterButCannotMutate() {
        var f = fixture();
        var read = ok(service.read(ADMIN), 200);
        assertEquals(false, read.get("canPropose"));
        assertEquals(false, read.get("canDecide"));
        assertTrue(read.get("brands") instanceof List<?>);
        refused(service.propose(ADMIN, key(), json(propose("brand", f.brand(), "revoke", ""))), 403, "role_not_permitted");
        var p = ok(service.propose(PROGRAMME, key(), json(propose("brand", f.brand(), "revoke", ""))), 201);
        refused(decide(ADMIN, p.get("id"), "approve", "No"), 403, "role_not_permitted");
        refused(decide(ADMIN, p.get("id"), "reject", "No"), 403, "role_not_permitted");
        refused(decide(ADMIN, p.get("id"), "withdraw", null), 403, "role_not_permitted");
        ok(decide(PROGRAMME, p.get("id"), "withdraw", null), 200);
    }

    @Test
    void programmeProposesTheDirectorRevokesABrandAndItsAuthorisationsGoWithIt() {
        var f = fixture();
        refused(service.propose(NOVA, key(), json(propose("brand", f.brand(), "revoke", ""))), 403, "role_not_permitted");
        refused(service.propose(OFFICER, key(), json(propose("brand", f.brand(), "revoke", ""))), 403, "role_not_permitted");
        refused(service.propose(ADMIN, key(), json(propose("brand", f.brand(), "revoke", ""))), 403, "role_not_permitted");
        refused(service.propose(PROGRAMME, null, json(propose("brand", f.brand(), "revoke", ""))), 422, "idempotency_key_required");
        refused(service.propose(PROGRAMME, key(), json(propose("brand", f.brand(), "close", ",\"closeOn\":\"" + TODAY.plusDays(5) + "\""))), 422, "validation_failed");
        refused(service.propose(PROGRAMME, key(), json(propose("brand", UUID.randomUUID(), "revoke", ""))), 404, "not_found");

        String k = key();
        var body = propose("brand", f.brand(), "revoke", "");
        var p = ok(service.propose(PROGRAMME, k, json(body)), 201);
        assertEquals("true", service.propose(PROGRAMME, k, json(body)).getHeaders().getFirst("Idempotency-Replayed"));
        refused(service.propose(PROGRAMME, key(), json(body)), 409, "revocation_pending");

        // The proposer cannot decide (no decide capability), nor can the applicant or the administrator; a missing note on a rejection is refused.
        refused(decide(PROGRAMME, p.get("id"), "approve", null), 403, "role_not_permitted");
        refused(decide(NOVA, p.get("id"), "approve", null), 403, "role_not_permitted");
        refused(decide(ADMIN, p.get("id"), "approve", null), 403, "role_not_permitted");
        refused(decide(OFFICER, p.get("id"), "reject", null), 422, "validation_failed");
        refused(decide(DIRECTOR, p.get("id"), "withdraw", null), 403, "role_not_permitted");
        refused(decide(OFFICER, UUID.randomUUID(), "approve", null), 404, "not_found");
        assertEquals("active", owner.queryForObject("SELECT status FROM brand WHERE id = ?", String.class, f.brand()));

        var done = ok(decide(OFFICER, p.get("id"), "approve", "Agreed"), 200);
        assertEquals("approved", done.get("state"));
        assertEquals("Agreed", done.get("decisionNote"));
        assertEquals("revoked", owner.queryForObject("SELECT status FROM brand WHERE id = ?", String.class, f.brand()));
        assertEquals("revoked", owner.queryForObject("SELECT status FROM agency_authorisation WHERE id = ?", String.class, f.auth()), "its authorisations go with it");
        refused(decide(OFFICER, p.get("id"), "approve", null), 409, "proposal_not_pending");
        refused(service.propose(PROGRAMME, key(), json(body)), 409, "target_not_active");
        refused(service.propose(PROGRAMME, key(), json(propose("authorisation", f.auth(), "revoke", ""))), 409, "target_not_active");
        var read = ok(service.read(OFFICER), 200);
        assertEquals(true, read.get("canDecide"));
        assertEquals(false, read.get("canPropose"));
        refused(service.read(NOVA), 403, "role_not_permitted");
    }

    @Test
    void anAuthorisationIsRevokedOrClosedOnADateAndTheSecondPersonRuleHolds() {
        var f = fixture();
        // Closing outside the period is refused when proposed.
        refused(service.propose(PROGRAMME, key(), json(propose("authorisation", f.auth(), "close", ",\"closeOn\":\"" + TODAY.minusDays(1) + "\""))), 422, "validation_failed");
        refused(service.propose(PROGRAMME, key(), json(propose("authorisation", f.auth(), "close", ",\"closeOn\":\"" + TODAY.minusDays(30) + "\""))), 422, "validation_failed");
        refused(service.propose(PROGRAMME, key(), json(propose("authorisation", f.auth(), "close", ""))), 422, "validation_failed");
        refused(service.propose(PROGRAMME, key(), json(propose("authorisation", f.auth(), "revoke", ",\"closeOn\":\"" + TODAY.plusDays(2) + "\""))), 422, "validation_failed");
        var close = ok(service.propose(PROGRAMME, key(), json(propose("authorisation", f.auth(), "close", ",\"closeOn\":\"" + TODAY.plusDays(10) + "\""))), 201);
        assertEquals("close", close.get("action"));
        assertEquals(TODAY.plusDays(10).toString(), close.get("closeOn"));

        // The proposer may withdraw; nobody else may.
        refused(decide(DIRECTOR, close.get("id"), "withdraw", null), 403, "role_not_permitted");
        ok(decide(PROGRAMME, close.get("id"), "withdraw", null), 200);
        refused(decide(PROGRAMME, close.get("id"), "withdraw", null), 409, "proposal_not_pending");

        // A person who holds both capabilities proposes and cannot decide their own proposal: refused in the service and in the database.
        owner.update("INSERT INTO user_account (id, keycloak_subject, username, display_name) VALUES (?, ?, 'dual.reviewer2', 'Dual Reviewer')", DUAL_USER, DUAL_USER);
        owner.update("INSERT INTO role_assignment (user_id, role, scope) VALUES (?, 'programme', 'all'), (?, 'officer', 'all')", DUAL_USER, DUAL_USER);
        var again = ok(service.propose(DUAL, key(), json(propose("authorisation", f.auth(), "close", ",\"closeOn\":\"" + TODAY.plusDays(10) + "\""))), 201);
        refused(decide(DUAL, again.get("id"), "approve", null), 403, "segregation_refused");
        assertEquals("same_person", db.queryForObject("SELECT out_state FROM register_revocation_decide(?::uuid, ?, 'approve', NULL)", String.class, again.get("id"), DUAL_USER));
        assertEquals("not_permitted", db.queryForObject("SELECT out_state FROM register_revocation_decide(?::uuid, ?, 'approve', NULL)", String.class, again.get("id"), PROGRAMME_USER));

        var done = ok(decide(OFFICER, again.get("id"), "approve", null), 200);
        assertEquals("approved", done.get("state"));
        assertEquals(TODAY.plusDays(10), owner.queryForObject("SELECT valid_to FROM agency_authorisation WHERE id = ?", java.sql.Date.class, f.auth()).toLocalDate());
        assertEquals("active", owner.queryForObject("SELECT status FROM agency_authorisation WHERE id = ?", String.class, f.auth()), "closed on a date, still active until then");
        assertEquals("active", owner.queryForObject("SELECT status FROM brand WHERE id = ?", String.class, f.brand()));

        // A closing date that has gone by at the time of approval is refused by the function and nothing changes.
        var f2 = fixture();
        UUID late = owner.queryForObject("INSERT INTO register_revocation_proposal (target_authorisation_id, action, close_on, reason, proposed_by) "
            + "VALUES (?, 'close', ?, 'late', ?) RETURNING id", UUID.class, f2.auth(), TODAY.minusDays(1), PROGRAMME_USER);
        assertEquals("date_passed", db.queryForObject("SELECT out_state FROM register_revocation_decide(?, ?, 'approve', NULL)", String.class, late, OFFICER_USER));
        assertEquals(null, owner.queryForObject("SELECT valid_to FROM agency_authorisation WHERE id = ?", java.sql.Date.class, f2.auth()));
        ok(decide(OFFICER, late, "reject", "Stale date"), 200);
        // A revoke of an authorisation, then a rejection of another.
        var rev = ok(service.propose(PROGRAMME, key(), json(propose("authorisation", f2.auth(), "revoke", ""))), 201);
        ok(decide(OFFICER, rev.get("id"), "approve", null), 200);
        assertEquals("revoked", owner.queryForObject("SELECT status FROM agency_authorisation WHERE id = ?", String.class, f2.auth()));
        var f3 = fixture();
        var rej = ok(service.propose(PROGRAMME, key(), json(propose("brand", f3.brand(), "revoke", ""))), 201);
        var rejected = ok(decide(OFFICER, rej.get("id"), "reject", "Not warranted"), 200);
        assertEquals("rejected", rejected.get("state"));
        assertEquals("active", owner.queryForObject("SELECT status FROM brand WHERE id = ?", String.class, f3.brand()));
        // A rejected proposal frees the record for a new one.
        ok(service.propose(PROGRAMME, key(), json(propose("brand", f3.brand(), "revoke", ""))), 201);
    }

    @Test
    void aClosureThatNoLongerFitsAtApprovalAndABrandRevocationWithAPendingSiblingAreRefusedOrLeftHarmless() {
        var f = fixture();
        // Proposals inserted directly (as the runtime login can) with dates that no longer fit the authorisation's period.
        for (var date : new java.time.LocalDate[] {TODAY.minusDays(30), TODAY.minusDays(40)}) {
            UUID bad = owner.queryForObject("INSERT INTO register_revocation_proposal (target_authorisation_id, action, close_on, reason, proposed_by) "
                + "VALUES (?, 'close', ?, 'x', ?) RETURNING id", UUID.class, f.auth(), date.isBefore(TODAY) ? TODAY : date, PROGRAMME_USER);
            owner.update("UPDATE agency_authorisation SET valid_to = ? WHERE id = ?", TODAY.plusDays(3), f.auth());
            // close_on (today) is inside [valid_from, valid_to): fine; now shorten the period so close_on is at or beyond valid_to.
            owner.update("UPDATE agency_authorisation SET valid_to = ? WHERE id = ?", TODAY.plusDays(1), f.auth());
            owner.update("UPDATE register_revocation_proposal SET close_on = ? WHERE id = ?", TODAY.plusDays(1), bad);
            assertEquals("rule_conflict".toUpperCase(), db.queryForObject("SELECT upper(out_state) FROM register_revocation_decide(?, ?, 'approve', NULL)", String.class, bad, OFFICER_USER));
            owner.update("DELETE FROM register_revocation_proposal WHERE id = ?", bad);
            owner.update("UPDATE agency_authorisation SET valid_to = NULL WHERE id = ?", f.auth());
        }
        // A pending proposal for the authorisation does not stop the brand being revoked; it then answers target_not_active.
        UUID sibling = owner.queryForObject("INSERT INTO register_revocation_proposal (target_authorisation_id, action, reason, proposed_by) VALUES (?, 'revoke', 'x', ?) RETURNING id",
            UUID.class, f.auth(), PROGRAMME_USER);
        var brand = ok(service.propose(PROGRAMME, key(), json(propose("brand", f.brand(), "revoke", ""))), 201);
        ok(decide(OFFICER, brand.get("id"), "approve", null), 200);
        refused(decide(OFFICER, sibling, "approve", null), 409, "target_not_active");
        ok(decide(OFFICER, sibling, "reject", "Superseded by the brand revocation"), 200);
    }
}
