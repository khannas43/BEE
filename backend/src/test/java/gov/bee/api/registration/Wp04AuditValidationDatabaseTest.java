package gov.bee.api.registration;

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
import gov.bee.api.masters.MasterDataRepository;
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
 * WP04.3: audit and validation of the whole of WP04 on one throwaway schema, as the restricted runtime login. A registration's decisions, a
 * revocation and a master supersession each leave an immutable, attributable record; a revoked brand's name can be registered again; an
 * agency period that ended before approval is refused; the half-open period boundaries hold.
 */
@Tag("db")
class Wp04AuditValidationDatabaseTest {

    static final String TAG = HexFormat.of().toHexDigits(ThreadLocalRandom.current().nextInt());
    static final String MAIN = "wp043_test_" + TAG;
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
    static final Caller ADMIN = new Caller(ADMIN_USER, "bee.admin", List.of(new RoleGrant("admin", "all")), Set.of(BEE_ORG));

    static final ObjectMapper JSON = new ObjectMapper();
    static JdbcTemplate admin;
    static JdbcTemplate owner;
    static JdbcTemplate db;
    static RegistrationService service;
    static RegistrationDocumentService documentService;
    static RegistrationFeeService feeService;
    static RegistrationReviewService review;
    static gov.bee.api.revocation.RevocationService revocation;
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
        var props = new gov.bee.api.document.DocumentProperties();
        props.setStorePath(java.nio.file.Files.createTempDirectory("bee-reg-docs").toString());
        var registrationRepo = new RegistrationRepository(db);
        var documentRepo = new RegistrationDocumentRepository(db);
        var idem = new IdempotencyRepository(db);
        service = new RegistrationService(registrationRepo, new MasterDataRepository(db), idem, JSON);
        feeService = new RegistrationFeeService(registrationRepo, idem, new gov.bee.api.settings.BusinessSettingService(
            new gov.bee.api.settings.BusinessSettingRepository(db), idem, JSON), JSON);
        revocation = new gov.bee.api.revocation.RevocationService(new gov.bee.api.revocation.RevocationRepository(db), idem, JSON);
        review = new RegistrationReviewService(registrationRepo, service, idem, JSON);
        documentService = new RegistrationDocumentService(registrationRepo, documentRepo, new RegistrationDocumentRecorder(documentRepo, idem),
            new gov.bee.api.document.LocalSha256FileStore(props), idem, JSON);
        assertEquals(64, owner.queryForObject("SELECT max(installed_rank) FROM flyway_schema_history", Integer.class), "migrated V1 through V64");
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

    static void addLicence(Object applicationId, UUID uploader) {
        UUID doc = UUID.randomUUID();
        owner.update("INSERT INTO registration_document (id, application_id, document_kind) VALUES (?, ?::uuid, 'trade_licence')", doc, applicationId.toString());
        owner.update("INSERT INTO registration_document_version (id, document_id, version_number, content_sha256, size_bytes, media_type, original_filename, label, "
            + "uploaded_by_account_id) VALUES (?, ?, 1, repeat('a', 64), 100, 'application/pdf', 'licence.pdf', 'Trade licence', ?)", UUID.randomUUID(), doc, uploader);
    }

    static final String FEE = "\"expectedFee\":{\"amountInr\":\"5000.00\",\"feeRuleKey\":\"REG:brand_registration\",\"feeRuleVersion\":1}";

    /** A filed and fee-confirmed brand request, ready for Programme (version 2). */
    static UUID atProgrammeReview(String brandName) {
        var draft = ok(service.create(NOVA, key(), json("{\"brandName\":\"" + brandName + "\"}")), 201);
        UUID id = UUID.fromString((String) draft.get("id"));
        addLicence(id, NOVA_USER);
        ok(service.submit(NOVA, id, key(), json("{\"version\":0," + FEE + "}")), 200);
        ok(feeService.confirm(FINANCE, id, key(), json("{\"version\":1,\"receiptReference\":\"R-1\",\"receivedOn\":\"" + TODAY + "\",\"amountInr\":\"5000.00\"}")), 200);
        return id;
    }

    static ResponseEntity<Map<String, Object>> act(Caller who, UUID id, String action, int version, String note) {
        return review.transition(who, id, key(), json("{\"action\":\"" + action + "\",\"version\":" + version
            + (note == null ? "" : ",\"note\":\"" + note + "\"") + "}"));
    }

    @Test
    void aRegistrationAndItsRevocationLeaveAnImmutableAttributableTrailAndTheNameCanBeRegisteredAgain() {
        UUID id = atProgrammeReview("Trail Cool");
        ok(act(PROGRAMME, id, "recommend", 2, "Licence checked"), 200);
        var approved = ok(act(DIRECTOR, id, "approve", 3, "Approved on the provisional rules"), 200);
        UUID brand = UUID.fromString((String) approved.get("registeredBrandId"));

        // Every step is recorded with who, when, from/to and why.
        assertEquals(1, owner.queryForObject("SELECT count(*) FROM registration_submission_event WHERE application_id = ? AND actor_account_id = ?", Integer.class, id, NOVA_USER));
        assertEquals("REG:brand_registration", owner.queryForObject("SELECT fee_rule_key FROM registration_fee_snapshot WHERE application_id = ?", String.class, id));
        assertEquals(1, owner.queryForObject("SELECT fee_rule_version FROM registration_fee_snapshot WHERE application_id = ?", Integer.class, id));
        var steps = owner.queryForList("SELECT action, from_state, to_state, actor_account_id::text AS actor, note FROM registration_transition_event WHERE application_id = ? ORDER BY version_after", id);
        assertEquals(List.of("confirm_fee", "recommend", "approve"), steps.stream().map(m -> m.get("action")).toList());
        assertEquals(List.of(FINANCE_USER.toString(), PROGRAMME_USER.toString(), DIRECTOR_USER.toString()), steps.stream().map(m -> m.get("actor")).toList());
        assertEquals("Approved on the provisional rules", steps.get(2).get("note"));
        var reg = owner.queryForMap("SELECT source, actor_account_id::text AS actor, from_status, to_status, registration_id::text AS reg FROM register_status_event WHERE brand_id = ?", brand);
        assertEquals("registration", reg.get("source"));
        assertEquals(DIRECTOR_USER.toString(), reg.get("actor"));
        assertEquals(null, reg.get("from_status"));
        assertEquals("active", reg.get("to_status"));
        assertEquals(id.toString(), reg.get("reg"));

        // The records cannot be changed or removed, by anyone but the local maintenance login.
        assertThrows(DataAccessException.class, () -> owner.update("UPDATE registration_transition_event SET note = 'x' WHERE application_id = ?", id));
        assertThrows(DataAccessException.class, () -> owner.update("DELETE FROM registration_submission_event WHERE application_id = ?", id));
        assertThrows(DataAccessException.class, () -> owner.update("UPDATE register_status_event SET reason = 'x' WHERE brand_id = ?", brand));
        assertThrows(DataAccessException.class, () -> owner.update("DELETE FROM register_status_event WHERE brand_id = ?", brand));
        assertThrows(DataAccessException.class, () -> db.update("INSERT INTO register_status_event (brand_id, to_status, source, registration_id, actor_account_id) VALUES (?, 'revoked', 'registration', ?, ?)", brand, id, DIRECTOR_USER),
            "the runtime login cannot write the trail");
        // Even the owner cannot write a row that breaks the pairing of source and request, or that names neither or both records.
        assertThrows(DataAccessException.class, () -> owner.update("INSERT INTO register_status_event (brand_id, to_status, source, actor_account_id) VALUES (?, 'revoked', 'registration', ?)", brand, DIRECTOR_USER));
        assertThrows(DataAccessException.class, () -> owner.update("INSERT INTO register_status_event (to_status, source, registration_id, actor_account_id) VALUES ('active', 'registration', ?, ?)", id, DIRECTOR_USER));

        // An agency authorisation on that brand, then the brand is revoked by two people: the cascade is recorded row by row.
        UUID auth = owner.queryForObject("INSERT INTO agency_authorisation (agency_organisation_id, principal_organisation_id, brand_id, valid_from, status, source_reference, "
            + "verification_status, note) VALUES (?, ?, ?, ?, 'active', 'test', 'synthetic', 'test') RETURNING id", UUID.class, PIXEL_ORG, NOVA_ORG, brand, TODAY.minusDays(5));
        var proposal = ok(revocation.propose(PROGRAMME, key(), json("{\"targetKind\":\"brand\",\"targetId\":\"" + brand + "\",\"action\":\"revoke\",\"reason\":\"Owner withdrew\"}")), 201);
        ok(revocation.decide(DIRECTOR, UUID.fromString((String) proposal.get("id")), key(), json("{\"decision\":\"approve\"}")), 200);
        var rev = owner.queryForList("SELECT brand_id::text AS b, authorisation_id::text AS a, from_status, to_status, cascaded, actor_account_id::text AS actor, reason, proposal_id::text AS p "
            + "FROM register_status_event WHERE source = 'revocation' AND (brand_id = ? OR authorisation_id = ?) ORDER BY cascaded DESC", brand, auth);
        assertEquals(2, rev.size());
        assertEquals(auth.toString(), rev.get(0).get("a"));
        assertEquals(true, rev.get(0).get("cascaded"));
        assertEquals(brand.toString(), rev.get(1).get("b"));
        assertEquals("active", rev.get(1).get("from_status"));
        assertEquals("revoked", rev.get(1).get("to_status"));
        assertEquals(DIRECTOR_USER.toString(), rev.get(1).get("actor"));
        assertEquals("Owner withdrew", rev.get(1).get("reason"));
        assertEquals(proposal.get("id"), rev.get(1).get("p"));
        var read = ok(revocation.read(DIRECTOR), 200);
        @SuppressWarnings("unchecked") List<Map<String, Object>> events = (List<Map<String, Object>>) read.get("events");
        assertTrue(events.stream().anyMatch(e -> brand.toString().equals(e.get("targetId")) && "revoked".equals(e.get("kind")) && "BEE Director".equals(e.get("by"))), "the audit trail is readable");

        // The revoked name can be registered again by the same owner.
        UUID again = atProgrammeReview("Trail Cool");
        ok(act(PROGRAMME, again, "recommend", 2, null), 200);
        var second = ok(act(DIRECTOR, again, "approve", 3, null), 200);
        assertNotNull(second.get("registeredBrandId"));
        assertEquals(1, owner.queryForObject("SELECT count(*) FROM brand WHERE lower(name) = 'trail cool' AND status = 'active'", Integer.class));
        assertEquals(2, owner.queryForObject("SELECT count(*) FROM brand WHERE lower(name) = 'trail cool'", Integer.class));
        // Two live brands of one name for one owner are still impossible.
        assertThrows(DataAccessException.class, () -> owner.update("INSERT INTO brand (name, owner_organisation_id, status, source_reference, verification_status, note) "
            + "VALUES ('TRAIL cool ', ?, 'active', 't', 'synthetic', 't')", NOVA_ORG));
    }

    @Test
    void anAgencyPeriodThatEndedBeforeApprovalIsRefusedAndTheBoundariesAreHalfOpen() {
        var created = ok(service.create(PIXEL, key(), json("{\"brandId\":\"" + NOVA_COOL + "\",\"validFrom\":\"" + TODAY.plusDays(2) + "\",\"validTo\":\"" + TODAY.plusDays(9) + "\"}")), 201);
        UUID id = UUID.fromString((String) created.get("id"));
        addLicence(id, PIXEL_USER);
        ok(service.submit(PIXEL, id, key(), json("{\"version\":0,\"expectedFee\":{\"amountInr\":\"3000.00\",\"feeRuleKey\":\"REG:agency_registration\",\"feeRuleVersion\":1}}")), 200);
        ok(feeService.confirm(FINANCE, id, key(), json("{\"version\":1,\"receiptReference\":\"R-9\",\"receivedOn\":\"" + TODAY + "\",\"amountInr\":\"3000.00\"}")), 200);
        ok(act(PROGRAMME, id, "recommend", 2, null), 200);
        // The request waits; its period passes. (The record is aged in the database: the rule is the approval's, not the clock's.)
        owner.update("UPDATE agency_authorisation SET status = 'revoked' WHERE brand_id = ?", NOVA_COOL);
        owner.update("UPDATE registration_application SET valid_from = ?, valid_to = ? WHERE id = ?", TODAY.minusDays(10), TODAY.minusDays(1), id);
        refused(act(DIRECTOR, id, "approve", 3, null), 422, "validation_failed");
        assertEquals("director_approval", owner.queryForObject("SELECT state FROM registration_application WHERE id = ?", String.class, id));
        assertEquals(0, owner.queryForObject("SELECT count(*) FROM agency_authorisation WHERE source_reference = (SELECT reference FROM registration_application WHERE id = ?)", Integer.class, id));
        // The period ends today: half-open, so it is already over today.
        owner.update("UPDATE registration_application SET valid_to = ? WHERE id = ?", TODAY, id);
        refused(act(DIRECTOR, id, "approve", 3, null), 422, "validation_failed");
        // Ending in five days it is fine, and it applies from its first day.
        owner.update("UPDATE registration_application SET valid_from = ?, valid_to = ? WHERE id = ?", TODAY, TODAY.plusDays(5), id);
        var done = ok(act(DIRECTOR, id, "approve", 3, null), 200);
        UUID auth = UUID.fromString((String) done.get("registeredAuthorisationId"));
        var bounds = owner.queryForMap("SELECT valid_from::text AS f, valid_to::text AS t FROM agency_authorisation WHERE id = ?", auth);
        assertEquals(TODAY.toString(), bounds.get("f"));
        assertEquals(TODAY.plusDays(5).toString(), bounds.get("t"));
        assertEquals(1, owner.queryForObject("SELECT count(*) FROM register_status_event WHERE authorisation_id = ? AND source = 'registration' AND valid_to_after = ?", Integer.class, auth, TODAY.plusDays(5)));

        // Closing it earlier is its own event: the status stays, the end date moves, and the trail says so.
        var close = ok(revocation.propose(PROGRAMME, key(), json("{\"targetKind\":\"authorisation\",\"targetId\":\"" + auth + "\",\"action\":\"close\",\"closeOn\":\"" + TODAY.plusDays(2) + "\",\"reason\":\"Ends early\"}")), 201);
        ok(revocation.decide(DIRECTOR, UUID.fromString((String) close.get("id")), key(), json("{\"decision\":\"approve\"}")), 200);
        var closed = owner.queryForMap("SELECT from_status, to_status, valid_to_before::text AS before, valid_to_after::text AS after, cascaded FROM register_status_event WHERE authorisation_id = ? AND source = 'revocation'", auth);
        assertEquals("active", closed.get("from_status"));
        assertEquals("active", closed.get("to_status"));
        assertEquals(TODAY.plusDays(2).toString(), closed.get("after"));
        assertEquals(TODAY.plusDays(5).toString(), closed.get("before"));
        assertEquals(false, closed.get("cascaded"));
    }

    @Test
    void aMasterSupersessionIsAttributableAndTheVersionsStayUnchanged() {
        var v = owner.queryForMap("SELECT version, amount_inr FROM master_fee_rule WHERE rule_key = 'REG:agency_registration' ORDER BY version DESC LIMIT 1");
        int version = (Integer) v.get("version");
        String json = "{\"category_code\":\"REG\",\"application_type\":\"agency_registration\",\"amount_inr\":3500.00,\"tax_rate_percent\":0,"
            + "\"source_reference\":\"WP04.3 test\",\"verification_status\":\"provisional\",\"note\":\"test successor\"}";
        Integer next = owner.queryForObject("SELECT master_supersede('master_fee_rule', 'REG:agency_registration', ?, ?::date, 'wp04.3 test actor', 'WP04.3 test', 'Fee updated for the test', ?::jsonb)",
            Integer.class, version, TODAY.plusDays(30), json);
        assertEquals(version + 1, next);
        var closure = owner.queryForMap("SELECT closed_by, source_reference, reason, effective_to::text AS effective_to, recorded_at IS NOT NULL AS stamped FROM master_closure "
            + "WHERE master_table = 'master_fee_rule' AND rule_key = 'REG:agency_registration' AND version = ?", version);
        assertEquals("wp04.3 test actor", closure.get("closed_by"));
        assertEquals("Fee updated for the test", closure.get("reason"));
        assertEquals(TODAY.plusDays(30).toString(), closure.get("effective_to"));
        assertEquals(true, closure.get("stamped"));
        assertEquals(0, new java.math.BigDecimal("3000.00").compareTo((java.math.BigDecimal) owner.queryForObject(
            "SELECT amount_inr FROM master_fee_rule WHERE rule_key = 'REG:agency_registration' AND version = ?", java.math.BigDecimal.class, version)), "the earlier version is unchanged");
        assertThrows(DataAccessException.class, () -> owner.update("UPDATE master_fee_rule SET amount_inr = 1 WHERE rule_key = 'REG:agency_registration' AND version = ?", version));
        assertThrows(DataAccessException.class, () -> owner.update("DELETE FROM master_closure WHERE rule_key = 'REG:agency_registration'"));
        // Today's registrations still take the version in force today.
        assertEquals(version, owner.queryForObject("SELECT max(version) FROM master_fee_rule WHERE rule_key = 'REG:agency_registration' AND effective_from <= ?", Integer.class, TODAY));
    }
}
