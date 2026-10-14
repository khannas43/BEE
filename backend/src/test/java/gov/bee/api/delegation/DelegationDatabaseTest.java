package gov.bee.api.delegation;

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
 * Delegation of a stage role (WP02.4c), against throwaway PostgreSQL as the restricted runtime login: who may delegate what to whom, the three-person
 * rule, the period and its limits, revocation, what a delegate may and may not do, the audit trail of requests, decisions and uses.
 */
@Tag("db")
class DelegationDatabaseTest {

    static final String TAG = HexFormat.of().toHexDigits(ThreadLocalRandom.current().nextInt());
    static final String MAIN = "wp024c_test_" + TAG;
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
    static final UUID DIRECTOR_USER = UUID.fromString("00000000-0000-4000-a000-000000000007");
    static final UUID DUAL_USER = UUID.fromString("00000000-0000-4000-a000-0000000000e1");
    static final Caller DIRECTOR = new Caller(DIRECTOR_USER, "bee.director", List.of(new RoleGrant("director", "all")), Set.of(BEE_ORG));
    static final Caller DUAL = new Caller(DUAL_USER, "dual.reviewer", List.of(new RoleGrant("programme", "all"), new RoleGrant("director", "all")), Set.of(BEE_ORG));
    static final UUID SECRETARY_USER = UUID.fromString("00000000-0000-4000-a000-000000000008");
    static final Caller FINANCE_C = FINANCE;
    static final Caller SECRETARY = new Caller(SECRETARY_USER, "bee.secretary", List.of(new RoleGrant("secretary", "all")), Set.of(BEE_ORG));
    static final Caller ADMIN = new Caller(ADMIN_USER, "bee.admin", List.of(new RoleGrant("admin", "all")), Set.of(BEE_ORG));

    static final ObjectMapper JSON = new ObjectMapper();
    static JdbcTemplate admin;
    static JdbcTemplate owner;
    static JdbcTemplate db;
    static DelegationService service;
    static DelegationRepository repo;
    static gov.bee.api.identity.IdentityRepository identity;
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
        repo = new DelegationRepository(db);
        identity = new gov.bee.api.identity.IdentityRepository(db);
        service = new DelegationService(repo, new gov.bee.api.application.IdempotencyRepository(db), JSON);
        assertEquals(49, owner.queryForObject("SELECT max(installed_rank) FROM flyway_schema_history", Integer.class), "migrated V1 through V49");
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

    static String ask(UUID delegate, String role, LocalDate from, LocalDate to) {
        return "{\"delegateId\":\"" + delegate + "\",\"role\":\"" + role + "\",\"validFrom\":\"" + from + "\",\"validTo\":\"" + to + "\",\"reason\":\"Away on leave\"}";
    }

    static ResponseEntity<Map<String, Object>> decide(Caller who, Object id, String decision, String note) {
        return service.decide(who, UUID.fromString(String.valueOf(id)), key(), json("{\"decision\":\"" + decision + "\"" + (note == null ? "" : ",\"note\":\"" + note + "\"") + "}"));
    }

    @Test
    void onlyAHolderOfAStageRoleDelegatesItToAColleagueForAtMostThirtyDays() {
        // The Secretary's final approval, an administrative role and an applicant cannot delegate anything.
        refused(service.propose(SECRETARY, key(), json(ask(FINANCE_USER, "secretary", TODAY, TODAY.plusDays(5)))), 403, "role_not_permitted");
        refused(service.propose(ADMIN, key(), json(ask(FINANCE_USER, "programme", TODAY, TODAY.plusDays(5)))), 403, "role_not_permitted");
        refused(service.propose(NOVA, key(), json(ask(FINANCE_USER, "programme", TODAY, TODAY.plusDays(5)))), 403, "role_not_permitted");
        // A programme officer cannot delegate a role they do not hold, nor to themselves, nor for the wrong period.
        refused(service.propose(PROGRAMME, key(), json(ask(FINANCE_USER, "director", TODAY, TODAY.plusDays(5)))), 403, "role_not_permitted");
        refused(service.propose(PROGRAMME, key(), json(ask(PROGRAMME_USER, "programme", TODAY, TODAY.plusDays(5)))), 422, "validation_failed");
        refused(service.propose(PROGRAMME, key(), json(ask(FINANCE_USER, "programme", TODAY.minusDays(1), TODAY.plusDays(5)))), 422, "validation_failed");
        refused(service.propose(PROGRAMME, key(), json(ask(FINANCE_USER, "programme", TODAY, TODAY))), 422, "validation_failed");
        refused(service.propose(PROGRAMME, key(), json(ask(FINANCE_USER, "programme", TODAY, TODAY.plusDays(31)))), 422, "validation_failed");
        refused(service.propose(PROGRAMME, null, json(ask(FINANCE_USER, "programme", TODAY, TODAY.plusDays(5)))), 422, "idempotency_key_required");
        refused(service.propose(PROGRAMME, key(), json(ask(UUID.randomUUID(), "programme", TODAY, TODAY.plusDays(5)))), 404, "not_found");
        // Someone from another organisation is not eligible.
        refused(service.propose(PROGRAMME, key(), json(ask(NOVA_USER, "programme", TODAY, TODAY.plusDays(5)))), 409, "delegate_not_eligible");
        var read = ok(service.read(PROGRAMME), 200);
        assertEquals(List.of("programme"), read.get("delegableRoles"));
        @SuppressWarnings("unchecked") List<Map<String, Object>> colleagues = (List<Map<String, Object>>) read.get("colleagues");
        assertTrue(colleagues.stream().anyMatch(c -> FINANCE_USER.toString().equals(c.get("id"))));
        assertTrue(colleagues.stream().noneMatch(c -> NOVA_USER.toString().equals(c.get("id"))));
        assertEquals(List.of(), ok(service.read(NOVA), 200).get("delegableRoles"));

        String k = key();
        var body = ask(FINANCE_USER, "programme", TODAY, TODAY.plusDays(30));
        var d = ok(service.propose(PROGRAMME, k, json(body)), 201);
        assertEquals("pending", d.get("state"));
        assertEquals(false, d.get("inForce"));
        assertEquals("true", service.propose(PROGRAMME, k, json(body)).getHeaders().getFirst("Idempotency-Replayed"));
        refused(service.propose(PROGRAMME, key(), json(body)), 409, "delegation_exists");
        assertEquals(1, owner.queryForObject("SELECT count(*) FROM delegation_event WHERE delegation_id = ?::uuid AND action = 'requested' AND actor_account_id = ?", Integer.class, d.get("id"), PROGRAMME_USER));
        ok(decide(PROGRAMME, d.get("id"), "withdraw", null), 200);
    }

    @Test
    void anAdministratorApprovesThirdPersonOnlyAndTheDelegateThenHoldsTheRoleButNotMoreThanThat() {
        var d = ok(service.propose(PROGRAMME, key(), json(ask(FINANCE_USER, "programme", TODAY, TODAY.plusDays(10)))), 201);
        Object id = d.get("id");
        // Not the delegator, not the delegate, not a holder of some other role, not an applicant.
        refused(decide(PROGRAMME, id, "approve", null), 403, "role_not_permitted");
        refused(decide(FINANCE, id, "approve", null), 403, "role_not_permitted");
        refused(decide(DIRECTOR, id, "approve", null), 403, "role_not_permitted");
        refused(decide(NOVA, id, "approve", null), 403, "role_not_permitted");
        refused(decide(ADMIN, id, "reject", null), 422, "validation_failed");
        refused(decide(ADMIN, UUID.randomUUID(), "approve", null), 404, "not_found");
        // A person who holds both the approving role and the delegable role cannot approve their own delegation (the database refuses, not only the service).
        UUID dual = UUID.fromString("00000000-0000-4000-a000-0000000000e2");
        owner.update("INSERT INTO user_account (id, keycloak_subject, username, display_name) VALUES (?, ?, 'dual.delegator', 'Dual Delegator')", dual, dual);
        owner.update("INSERT INTO role_assignment (user_id, role, scope) VALUES (?, 'admin', 'all'), (?, 'director', 'all')", dual, dual);
        owner.update("INSERT INTO organisation_membership (user_id, organisation_id) VALUES (?, ?)", dual, BEE_ORG);
        var dualCaller = new Caller(dual, "dual.delegator", List.of(new RoleGrant("admin", "all"), new RoleGrant("director", "all")), Set.of(BEE_ORG));
        var own = ok(service.propose(dualCaller, key(), json(ask(FINANCE_USER, "director", TODAY, TODAY.plusDays(4)))), 201);
        refused(decide(dualCaller, own.get("id"), "approve", null), 403, "segregation_refused");
        assertEquals("same_person", db.queryForObject("SELECT out_state FROM delegation_decide(?::uuid, ?, 'approve', NULL)", String.class, own.get("id"), dual));
        ok(decide(dualCaller, own.get("id"), "withdraw", null), 200);
        // Nor can the delegate approve: a second dual person who is the delegate.
        assertEquals("not_permitted", db.queryForObject("SELECT out_state FROM delegation_decide(?::uuid, ?, 'approve', NULL)", String.class, id, PROGRAMME_USER));
        assertEquals("pending", owner.queryForObject("SELECT state FROM delegation WHERE id = ?::uuid", String.class, id));
        assertEquals(0, identity.activeDelegations(FINANCE_USER, TODAY).size(), "nothing is delegated before approval");

        var approved = ok(decide(ADMIN, id, "approve", "Cover agreed"), 200);
        assertEquals("approved", approved.get("state"));
        assertEquals(true, approved.get("inForce"));
        refused(decide(ADMIN, id, "approve", null), 409, "proposal_not_pending");

        var delegated = identity.activeDelegations(FINANCE_USER, TODAY);
        assertEquals(1, delegated.size());
        assertEquals("programme", delegated.get(0).role());
        assertEquals(PROGRAMME_USER, delegated.get(0).delegatorId());
        var delegate = new Caller(FINANCE_USER, "bee.finance", List.of(new RoleGrant("finance", "all")), Set.of(BEE_ORG), delegated, null);
        assertTrue(delegate.roles().stream().anyMatch(g -> g.role().equals("programme") && g.scope().equals("all")), "the stage role is held");
        assertTrue(delegate.ownRoles().stream().noneMatch(g -> g.role().equals("programme")), "but it is not one of their own");
        assertEquals(true, delegate.holdsOwn("finance", "all"));
        assertEquals(false, delegate.holdsOwn("programme", "all"));
        assertEquals(false, delegate.usesDelegation(), "own roles never note a delegation");
        assertEquals(true, delegate.holds("finance", "all"));
        assertEquals(false, delegate.usesDelegation());
        assertEquals(true, delegate.holds("programme", "all"));
        assertEquals(true, delegate.usesDelegation(), "a delegated role that was needed is noted as used");
        assertEquals(false, delegate.holds("director", "all"), "only the delegated role");
        assertEquals(Set.of(FINANCE_USER, PROGRAMME_USER), delegate.actingIdentities(), "segregation counts the delegator too");
        // Administrative capabilities and registration review are not delegable: they read the caller's own roles only.
        assertTrue(delegate.ownRoles().stream().noneMatch(g -> g.role().equals("admin")));
        // Not yet in force, or after the period, nothing is held.
        assertEquals(0, identity.activeDelegations(FINANCE_USER, TODAY.plusDays(10)).size(), "the period ends the day it names");
        assertEquals(0, identity.activeDelegations(FINANCE_USER, TODAY.minusDays(1)).size());
        assertEquals(1, identity.activeDelegations(FINANCE_USER, TODAY.plusDays(9)).size());
        // The delegator losing the role ends it at once.
        owner.update("UPDATE role_assignment SET active = false WHERE user_id = ? AND role = 'programme'", PROGRAMME_USER);
        try {
            assertEquals(0, identity.activeDelegations(FINANCE_USER, TODAY).size());
            assertEquals(false, ok(service.read(FINANCE), 200).get("canApprove"));
        } finally {
            owner.update("UPDATE role_assignment SET active = true WHERE user_id = ? AND role = 'programme'", PROGRAMME_USER);
        }
        assertEquals(1, identity.activeDelegations(FINANCE_USER, TODAY).size());

        // Only the delegator or an approver revokes; the delegate cannot.
        refused(decide(FINANCE, id, "revoke", null), 403, "role_not_permitted");
        refused(decide(DIRECTOR, id, "revoke", null), 403, "role_not_permitted");
        refused(decide(PROGRAMME, id, "withdraw", null), 409, "proposal_not_pending");
        var revoked = ok(decide(PROGRAMME, id, "revoke", "Back early"), 200);
        assertEquals("revoked", revoked.get("state"));
        assertEquals(false, revoked.get("inForce"));
        assertEquals("Back early", revoked.get("revokeNote"));
        assertEquals(0, identity.activeDelegations(FINANCE_USER, TODAY).size(), "revoked, the next request holds nothing");
        refused(decide(PROGRAMME, id, "revoke", null), 409, "delegation_not_active");

        // The trail names who did what; it cannot be changed.
        var events = owner.queryForList("SELECT action, actor_account_id::text AS actor FROM delegation_event WHERE delegation_id = ?::uuid ORDER BY occurred_at, action", id);
        assertEquals(List.of("requested", "approved", "revoked").stream().sorted().toList(), events.stream().map(m -> (String) m.get("action")).sorted().toList());
        assertEquals(PROGRAMME_USER.toString(), events.stream().filter(m -> "requested".equals(m.get("action"))).findFirst().orElseThrow().get("actor"));
        assertEquals(ADMIN_USER.toString(), events.stream().filter(m -> "approved".equals(m.get("action"))).findFirst().orElseThrow().get("actor"));
        assertEquals(PROGRAMME_USER.toString(), events.stream().filter(m -> "revoked".equals(m.get("action"))).findFirst().orElseThrow().get("actor"));
        assertThrows(DataAccessException.class, () -> owner.update("UPDATE delegation_event SET note = 'x' WHERE delegation_id = ?::uuid", id));
        assertThrows(DataAccessException.class, () -> owner.update("DELETE FROM delegation_event WHERE delegation_id = ?::uuid", id));
        assertThrows(DataAccessException.class, () -> db.update("UPDATE delegation SET state = 'approved' WHERE id = ?::uuid", id), "the runtime login decides only through the function");
        assertThrows(DataAccessException.class, () -> owner.update("UPDATE delegation SET valid_to = valid_to - 1 WHERE id = ?::uuid", id), "who, what and when never change");
        assertThrows(DataAccessException.class, () -> owner.update("UPDATE delegation SET state = 'approved' WHERE id = ?::uuid", id), "a revoked delegation cannot be revived");
    }

    @Test
    void aRequestWhoseDetailsNoLongerHoldIsRefusedAtApprovalAndEveryUseIsLogged() {
        // A period that has gone by cannot be approved.
        UUID late = owner.queryForObject("INSERT INTO delegation (delegator_id, delegate_id, role, reason, valid_from, valid_to) VALUES (?, ?, 'programme', 'late', ?, ?) RETURNING id",
            UUID.class, PROGRAMME_USER, FINANCE_USER, TODAY.minusDays(10), TODAY.minusDays(1));
        refused(decide(ADMIN, late, "approve", null), 409, "effective_date_passed");
        ok(decide(ADMIN, late, "reject", "Too late"), 200);
        // A delegator who no longer holds the role, or a delegate in another organisation, is not eligible when the approval comes.
        var d = ok(service.propose(PROGRAMME, key(), json(ask(FINANCE_USER, "programme", TODAY, TODAY.plusDays(3)))), 201);
        owner.update("UPDATE role_assignment SET active = false WHERE user_id = ? AND role = 'programme'", PROGRAMME_USER);
        try {
            refused(decide(ADMIN, d.get("id"), "approve", null), 409, "delegate_not_eligible");
        } finally {
            owner.update("UPDATE role_assignment SET active = true WHERE user_id = ? AND role = 'programme'", PROGRAMME_USER);
        }
        // The delegator can withdraw their own request, nobody else.
        refused(decide(FINANCE, d.get("id"), "withdraw", null), 403, "role_not_permitted");
        refused(decide(ADMIN, d.get("id"), "withdraw", null), 403, "role_not_permitted");
        ok(decide(PROGRAMME, d.get("id"), "withdraw", null), 200);

        // Approved, then used: the use is a row the runtime login can add but not change.
        var again = ok(service.propose(PROGRAMME, key(), json(ask(FINANCE_USER, "programme", TODAY, TODAY.plusDays(3)))), 201);
        ok(decide(ADMIN, again.get("id"), "approve", null), 200);
        UUID delegation = UUID.fromString((String) again.get("id"));
        repo.recordUse(delegation, FINANCE_USER, PROGRAMME_USER, "programme", "POST", "/api/model-applications/{id}/rating", 200, "corr-1");
        var use = owner.queryForMap("SELECT acting_account_id::text AS actor, delegator_id::text AS delegator, role, method, route, status FROM delegation_use WHERE delegation_id = ?", delegation);
        assertEquals(FINANCE_USER.toString(), use.get("actor"));
        assertEquals(PROGRAMME_USER.toString(), use.get("delegator"));
        assertEquals("programme", use.get("role"));
        assertFalse(((List<?>) ok(service.read(FINANCE), 200).get("mine")).isEmpty(), "the delegate sees it too");
        @SuppressWarnings("unchecked") List<Map<String, Object>> mine = (List<Map<String, Object>>) ok(service.read(PROGRAMME), 200).get("mine");
        assertEquals(1, mine.stream().filter(m -> delegation.toString().equals(m.get("id"))).map(m -> m.get("uses")).filter(u -> Integer.valueOf(1).equals(u)).count(), "the use count is shown");
        assertThrows(DataAccessException.class, () -> owner.update("UPDATE delegation_use SET status = 500 WHERE delegation_id = ?", delegation));
        assertThrows(DataAccessException.class, () -> owner.update("DELETE FROM delegation_use WHERE delegation_id = ?", delegation));
        // Segregation of duties follows the delegation: the delegator having acted at another stage counts against the delegate.
        var delegate = new Caller(FINANCE_USER, "bee.finance", List.of(new RoleGrant("finance", "all")), Set.of(BEE_ORG), identity.activeDelegations(FINANCE_USER, TODAY), null);
        var facts = new gov.bee.api.policy.ApplicationFacts(UUID.randomUUID(), NOVA_ORG, "rating", Set.of(), Set.of(PROGRAMME_USER), false);
        var decision = gov.bee.api.policy.SlicePolicy.check(gov.bee.api.policy.SliceAction.COMPUTE_RATING, delegate, facts);
        assertEquals("same_user_other_stage", decision.reason());
        var withoutDelegation = new Caller(FINANCE_USER, "bee.finance", List.of(new RoleGrant("finance", "all")), Set.of(BEE_ORG));
        assertEquals("role_not_permitted", gov.bee.api.policy.SlicePolicy.check(gov.bee.api.policy.SliceAction.COMPUTE_RATING, withoutDelegation, facts).reason());
        ok(decide(ADMIN, delegation, "revoke", "Done"), 200);
    }
}
