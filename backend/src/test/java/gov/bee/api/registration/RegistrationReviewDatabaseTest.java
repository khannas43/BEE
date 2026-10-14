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
 * Review and approval of a registration (WP04.2b-2), against throwaway PostgreSQL as the restricted runtime login: recommend, return,
 * reject, approve and resubmit, the second-person rule in the service and in the database, the register entry approval writes, and the
 * legal state moves. The shared app schema is untouched.
 */
@Tag("db")
class RegistrationReviewDatabaseTest {

    static final String TAG = HexFormat.of().toHexDigits(ThreadLocalRandom.current().nextInt());
    static final String MAIN = "wp042b2_test_" + TAG;
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
        review = new RegistrationReviewService(registrationRepo, service, idem, JSON);
        documentService = new RegistrationDocumentService(registrationRepo, documentRepo, new RegistrationDocumentRecorder(documentRepo, idem),
            new gov.bee.api.document.LocalSha256FileStore(props), idem, JSON);
        assertEquals(44, owner.queryForObject("SELECT max(installed_rank) FROM flyway_schema_history", Integer.class), "migrated V1 through V44");
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
    void migrationAddsTheDirectorCapabilityAndTheTransitionGuards() {
        assertEquals(1, owner.queryForObject("SELECT count(*) FROM capability_grant WHERE capability = 'registration_approve' AND role = 'director'", Integer.class));
        UUID id = atProgrammeReview("Guard Cool");
        // An illegal move is refused by the database, whoever asks: programme_review cannot jump to approved or rejected.
        assertThrows(DataAccessException.class, () -> db.update("UPDATE registration_application SET state = 'approved' WHERE id = ?", id));
        assertThrows(DataAccessException.class, () -> db.update("UPDATE registration_application SET state = 'rejected' WHERE id = ?", id));
        assertThrows(DataAccessException.class, () -> db.update("UPDATE registration_application SET state = 'draft' WHERE id = ?", id));
    }

    @Test
    void programmeRecommendsAndTheDirectorApprovesAndTheBrandIsRegistered() {
        UUID id = atProgrammeReview("Halcyon Cool");
        refused(act(NOVA, id, "recommend", 2, null), 403, "role_not_permitted");
        refused(act(DIRECTOR, id, "recommend", 2, null), 403, "role_not_permitted");
        refused(act(DIRECTOR, id, "approve", 2, null), 404, "not_found");
        refused(act(PROGRAMME, id, "approve", 2, null), 404, "not_found");
        refused(act(PROGRAMME, id, "bogus", 2, null), 422, "validation_failed");
        refused(act(PROGRAMME, id, "return", 2, null), 422, "validation_failed");
        refused(act(PROGRAMME, id, "recommend", 1, null), 409, "version_conflict");
        refused(review.transition(PROGRAMME, id, null, json("{\"action\":\"recommend\",\"version\":2}")), 422, "idempotency_key_required");

        String k = key();
        var body = "{\"action\":\"recommend\",\"version\":2,\"note\":\"Licence checked\"}";
        var rec = ok(review.transition(PROGRAMME, id, k, json(body)), 200);
        assertEquals("director_approval", rec.get("toState"));
        assertEquals(3, rec.get("version"));
        assertEquals("true", review.transition(PROGRAMME, id, k, json(body)).getHeaders().getFirst("Idempotency-Replayed"));
        refused(review.transition(PROGRAMME, id, k, json(body.replace("Licence", "Other"))), 409, "idempotency_key_conflict");
        assertEquals("director_approval", ok(service.get(DIRECTOR, id), 200).get("state"));
        assertEquals("director_approval", ok(service.get(PROGRAMME, id), 200).get("state"), "Programme still follows what it recommended");
        refused(service.get(FINANCE, id), 404, "not_found");

        // The Director is a second person; the applicant cannot approve, nor can Programme.
        refused(act(PROGRAMME, id, "approve", 3, null), 403, "role_not_permitted");
        refused(act(NOVA, id, "approve", 3, null), 403, "role_not_permitted");
        assertEquals(0, owner.queryForObject("SELECT count(*) FROM brand WHERE name = 'Halcyon Cool'", Integer.class));
        var done = ok(act(DIRECTOR, id, "approve", 3, "Approved on the provisional rules"), 200);
        assertEquals("approved", done.get("toState"));
        assertNotNull(done.get("registeredBrandId"));
        assertEquals(1, owner.queryForObject("SELECT count(*) FROM brand WHERE name = 'Halcyon Cool' AND owner_organisation_id = ? AND status = 'active'",
            Integer.class, NOVA_ORG));
        var view = ok(service.get(NOVA, id), 200);
        assertEquals("approved", view.get("state"));
        assertEquals(done.get("registeredBrandId"), view.get("registeredBrandId"));
        @SuppressWarnings("unchecked") List<Map<String, Object>> applicantTrail = (List<Map<String, Object>>) view.get("trail");
        assertEquals(List.of("approve"), applicantTrail.stream().map(t -> t.get("action")).toList(), "the applicant sees the decision, not the fee step or the recommendation");
        @SuppressWarnings("unchecked") List<Map<String, Object>> fullTrail = (List<Map<String, Object>>) ok(service.get(DIRECTOR, id), 200).get("trail");
        assertEquals(List.of("confirm_fee", "recommend", "approve"), fullTrail.stream().map(t -> t.get("action")).toList());
        refused(act(DIRECTOR, id, "approve", 4, null), 404, "not_found");
        refused(act(DIRECTOR, id, "reject", 4, "late"), 404, "not_found");
        // The register now holds the name, so a second manufacturer cannot file it.
        refused(service.create(NOVA, key(), json("{\"brandName\":\"halcyon cool\"}")), 409, "brand_name_taken");
    }

    @Test
    void theApproverIsNeverTheSubmitterOrTheRecommender() {
        UUID id = atProgrammeReview("Ibis Cool");
        // A person who holds both roles can recommend, but cannot then approve what they recommended.
        owner.update("INSERT INTO user_account (id, keycloak_subject, username, display_name) VALUES (?, ?, 'dual.reviewer', 'Dual Reviewer')", DUAL_USER, DUAL_USER);
        owner.update("INSERT INTO role_assignment (user_id, role, scope) VALUES (?, 'programme', 'all'), (?, 'director', 'all')", DUAL_USER, DUAL_USER);
        ok(act(DUAL, id, "recommend", 2, null), 200);
        refused(act(DUAL, id, "approve", 3, null), 403, "segregation_refused");
        // Applied directly to the database, the same rule holds: no approval event by the recommender.
        assertThrows(DataAccessException.class, () -> db.update("INSERT INTO registration_transition_event (id, application_id, action, from_state, to_state, "
            + "actor_account_id, actor_role, version_after) VALUES (?, ?, 'approve', 'director_approval', 'approved', ?, 'director', 4)", UUID.randomUUID(), id, DUAL_USER));
        assertEquals("not_permitted", db.queryForObject("SELECT out_state FROM registration_approve(?, ?, 3, NULL)", String.class, id, PROGRAMME_USER));
        assertEquals("segregation_refused", db.queryForObject("SELECT out_state FROM registration_approve(?, ?, 3, NULL)", String.class, id, DUAL_USER));
        assertEquals(0, owner.queryForObject("SELECT count(*) FROM brand WHERE name = 'Ibis Cool'", Integer.class));
        ok(act(DIRECTOR, id, "approve", 3, null), 200);

        // The person who filed it cannot review it, whatever role they also hold.
        UUID second = atProgrammeReview("Jackal Cool");
        var submitterReviewer = new Caller(NOVA_USER, "nova.applicant", List.of(new RoleGrant("programme", "all")), Set.of(BEE_ORG));
        refused(act(submitterReviewer, second, "recommend", 2, null), 403, "segregation_refused");
        var applicantsOwnProgramme = new Caller(PROGRAMME_USER, "bee.programme", List.of(new RoleGrant("programme", "all")), Set.of(NOVA_ORG));
        refused(act(applicantsOwnProgramme, second, "recommend", 2, null), 403, "segregation_refused");
    }

    @Test
    void returnedRequestsAreEditedAndResubmittedWithoutANewFee() {
        UUID id = atProgrammeReview("Kestrel Cool");
        var ret = ok(act(PROGRAMME, id, "return", 2, "Licence is unreadable"), 200);
        assertEquals("returned", ret.get("toState"));
        var view = ok(service.get(NOVA, id), 200);
        assertEquals("returned", view.get("state"));
        @SuppressWarnings("unchecked") List<Map<String, Object>> trail = (List<Map<String, Object>>) view.get("trail");
        assertEquals("Licence is unreadable", trail.get(trail.size() - 1).get("note"));

        refused(act(NOVA, id, "resubmit", 2, null), 409, "version_conflict");
        refused(act(PROGRAMME, id, "resubmit", 3, null), 403, "role_not_permitted");
        refused(act(PIXEL, id, "resubmit", 3, null), 404, "not_found");
        refused(review.transition(NOVA, id, key(), json("{\"action\":\"resubmit\",\"version\":3,\"note\":\"x\"}")), 422, "validation_failed");
        var edited = ok(service.patch(NOVA, id, key(), json("{\"version\":3,\"brandName\":\"Kestrel Air\"}")), 200);
        assertEquals("Kestrel Air", edited.get("brandName"));
        var again = ok(act(NOVA, id, "resubmit", 4, null), 200);
        assertEquals("programme_review", again.get("toState"));
        assertEquals(1, owner.queryForObject("SELECT count(*) FROM registration_fee_snapshot WHERE application_id = ?", Integer.class, id), "no second fee");
        assertEquals(1, owner.queryForObject("SELECT count(*) FROM registration_fee_confirmation WHERE application_id = ?", Integer.class, id));
        refused(service.patch(NOVA, id, key(), json("{\"version\":5,\"brandName\":\"Kestrel Late\"}")), 403, "not_editable");
    }

    @Test
    void theDirectorMayReturnOrRejectAndARejectedNameIsFreeAgain() {
        UUID id = atProgrammeReview("Lynx Cool");
        ok(act(PROGRAMME, id, "recommend", 2, null), 200);
        refused(act(PROGRAMME, id, "return", 3, "no"), 403, "role_not_permitted");
        refused(act(DIRECTOR, id, "reject", 3, null), 422, "validation_failed");
        var rej = ok(act(DIRECTOR, id, "reject", 3, "Name is confusingly close to a registered brand"), 200);
        assertEquals("rejected", rej.get("toState"));
        assertEquals(0, owner.queryForObject("SELECT count(*) FROM brand WHERE name = 'Lynx Cool'", Integer.class));
        refused(act(NOVA, id, "resubmit", 4, null), 404, "not_found");
        ok(service.create(NOVA, key(), json("{\"brandName\":\"Lynx Cool\"}")), 201);

        UUID second = atProgrammeReview("Marlin Cool");
        ok(act(PROGRAMME, second, "recommend", 2, null), 200);
        assertEquals("returned", ok(act(DIRECTOR, second, "return", 3, "Add the licence page 2"), 200).get("toState"));
    }

    @Test
    void anApprovedAgencyRequestWritesTheAuthorisationAndOverlapsAreRefused() {
        String from = TODAY.plusDays(3).toString();
        var created = ok(service.create(PIXEL, key(), json("{\"brandId\":\"" + NOVA_COOL + "\",\"validFrom\":\"" + from + "\"}")), 201);
        UUID id = UUID.fromString((String) created.get("id"));
        UUID doc = UUID.randomUUID();
        owner.update("INSERT INTO registration_document (id, application_id, document_kind) VALUES (?, ?, 'trade_licence')", doc, id);
        owner.update("INSERT INTO registration_document_version (id, document_id, version_number, content_sha256, size_bytes, media_type, original_filename, label, "
            + "uploaded_by_account_id) VALUES (?, ?, 1, repeat('b', 64), 100, 'application/pdf', 'licence.pdf', 'Trade licence', ?)", UUID.randomUUID(), doc, PIXEL_USER);
        ok(service.submit(PIXEL, id, key(), json("{\"version\":0,\"expectedFee\":{\"amountInr\":\"3000.00\",\"feeRuleKey\":\"REG:agency_registration\",\"feeRuleVersion\":1}}")), 200);
        ok(feeService.confirm(FINANCE, id, key(), json("{\"version\":1,\"receiptReference\":\"R-2\",\"receivedOn\":\"" + TODAY + "\",\"amountInr\":\"3000.00\"}")), 200);
        ok(act(PROGRAMME, id, "recommend", 2, null), 200);
        // The seed already grants this agency this brand without an end date, so an overlapping request is refused and nothing changes.
        refused(act(DIRECTOR, id, "approve", 3, null), 409, "authorisation_overlap");
        assertEquals("director_approval", owner.queryForObject("SELECT state FROM registration_application WHERE id = ?", String.class, id));
        owner.update("UPDATE agency_authorisation SET status = 'revoked' WHERE agency_organisation_id = ? AND brand_id = ?", PIXEL_ORG, NOVA_COOL);
        var done = ok(act(DIRECTOR, id, "approve", 3, null), 200);
        assertNotNull(done.get("registeredAuthorisationId"));
        assertEquals(1, owner.queryForObject("SELECT count(*) FROM agency_authorisation WHERE agency_organisation_id = ? AND brand_id = ? AND status = 'active' "
            + "AND valid_from = ?::date AND source_reference = ?", Integer.class, PIXEL_ORG, NOVA_COOL, from, created.get("reference")));
    }
}
