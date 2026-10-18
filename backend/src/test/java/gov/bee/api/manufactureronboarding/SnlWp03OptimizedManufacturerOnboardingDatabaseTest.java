package gov.bee.api.manufactureronboarding;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;

import com.fasterxml.jackson.databind.ObjectMapper;
import gov.bee.api.application.IdempotencyRepository;
import gov.bee.api.identity.Caller;
import gov.bee.api.identity.IdentityRepository.RoleGrant;
import gov.bee.api.masters.MasterDataRepository;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

@Tag("db")
class SnlWp03OptimizedManufacturerOnboardingDatabaseTest {

    static final UUID ONBOARD_ORG = UUID.fromString("00000000-0000-4000-b000-000000000007");
    static final UUID ONBOARD_USER = UUID.fromString("00000000-0000-4000-a000-000000000017");
    static final UUID NOVA_USER = UUID.fromString("00000000-0000-4000-a000-000000000001");
    static final UUID DIRECTOR = UUID.fromString("00000000-0000-4000-a000-000000000007");
    static final UUID FINANCE = UUID.fromString("00000000-0000-4000-a000-000000000003");
    static final UUID NOVA_ORG = UUID.fromString("00000000-0000-4000-b000-000000000001");
    static final ZoneId IST = ZoneId.of("Asia/Kolkata");

    static String schemaName;
    static JdbcTemplate admin;
    static JdbcTemplate owner;
    static JdbcTemplate db;
    static ManufacturerOnboardingRepository repo;
    static ManufacturerOnboardingDocumentRepository docRepo;
    static ManufacturerOnboardingService service;
    static ObjectMapper json;
    static JdbcTemplate maint;

    static String env(String k, String d) {
        String v = System.getenv(k);
        return v == null || v.isBlank() ? d : v;
    }

    static DriverManagerDataSource migrateSource(String schema) {
        String url = "jdbc:postgresql://127.0.0.1:" + env("BEE_PG_PORT", "5434") + "/" + env("BEE_APP_DB", "bee_app")
            + (schema == null ? "" : "?currentSchema=" + schema);
        return new DriverManagerDataSource(url, env("BEE_FLYWAY_DB_USER", "bee_app"), env("BEE_FLYWAY_DB_PASSWORD", env("BEE_APP_DB_PASSWORD", "bee-local-app")));
    }

    static DriverManagerDataSource runtimeSource(String schema) {
        return new DriverManagerDataSource(
            "jdbc:postgresql://127.0.0.1:" + env("BEE_PG_PORT", "5434") + "/" + env("BEE_APP_DB", "bee_app") + "?currentSchema=" + schema,
            env("BEE_RUNTIME_DB_USER", "bee_runtime"), env("BEE_RUNTIME_DB_PASSWORD", "bee-local-runtime"));
    }

    @BeforeAll
    static void migrateAndSeed() throws Exception {
        schemaName = "wp03_mob_" + UUID.randomUUID().toString().replace("-", "").substring(0, 10);
        admin = new JdbcTemplate(migrateSource(null));
        admin.execute("DROP SCHEMA IF EXISTS " + schemaName + " CASCADE");
        admin.execute("CREATE SCHEMA " + schemaName);
        Flyway.configure().dataSource(migrateSource(schemaName)).schemas(schemaName).defaultSchema(schemaName).createSchemas(false)
            .locations("classpath:db/migration").load().migrate();
        owner = new JdbcTemplate(migrateSource(schemaName));
        owner.execute(Files.readString(Path.of("..", "local", "seed", "seed.sql")));
        db = new JdbcTemplate(runtimeSource(schemaName));
        maint = new JdbcTemplate(new DriverManagerDataSource(
            "jdbc:postgresql://127.0.0.1:" + env("BEE_PG_PORT", "5434") + "/" + env("BEE_APP_DB", "bee_app") + "?currentSchema=" + schemaName,
            env("BEE_MAINT_DB_USER", "bee_local_maint"), env("BEE_MAINT_DB_PASSWORD", "bee-local-maint")));
        repo = new ManufacturerOnboardingRepository(db);
        docRepo = new ManufacturerOnboardingDocumentRepository(db);
        json = new ObjectMapper();
        service = new ManufacturerOnboardingService(repo, docRepo, new MasterDataRepository(db), new IdempotencyRepository(db), json);
        assertEquals(75, owner.queryForObject("SELECT max(installed_rank) FROM flyway_schema_history", Integer.class));
        assertEquals("none", owner.queryForObject("SELECT permittee_lifecycle FROM organisation WHERE id = ?", String.class, ONBOARD_ORG));
        assertEquals("active", owner.queryForObject("SELECT permittee_lifecycle FROM organisation WHERE id = ?", String.class, NOVA_ORG));
    }

    @AfterAll
    static void drop() {
        if (admin != null && schemaName != null) {
            admin.execute("DROP SCHEMA IF EXISTS " + schemaName + " CASCADE");
        }
    }

    static Caller onboardApplicant() {
        return new Caller(ONBOARD_USER, "onboarding.applicant", List.of(new RoleGrant("manufacturer", "own-org")), Set.of(ONBOARD_ORG));
    }

    static Caller director() {
        return new Caller(DIRECTOR, "bee.director", List.of(new RoleGrant("director", "all")), Set.of());
    }

    static Caller finance() {
        return new Caller(FINANCE, "bee.finance", List.of(new RoleGrant("finance", "all")), Set.of());
    }

    void addDoc(UUID appId, String kind) {
        if (owner.queryForObject("SELECT count(*) FROM manufacturer_onboarding_document WHERE application_id = ? AND document_kind = ?",
            Integer.class, appId, kind) == 0) {
            owner.update("INSERT INTO manufacturer_onboarding_document (id, application_id, document_kind) VALUES (?, ?, ?)",
                UUID.randomUUID(), appId, kind);
        }
        owner.update("INSERT INTO manufacturer_onboarding_document_version (id, document_id, version_number, content_sha256, size_bytes, media_type, original_filename, label, uploaded_by_account_id) "
            + "SELECT ?, id, 1, repeat('a', 64), 100, 'application/pdf', ? || '.pdf', ?, ? FROM manufacturer_onboarding_document WHERE application_id = ? AND document_kind = ?",
            UUID.randomUUID(), kind, kind, ONBOARD_USER, appId, kind);
    }

    void addAllRequiredDocs(UUID appId) {
        for (String kind : ManufacturerOnboardingDocumentRepository.DOCUMENT_KINDS) {
            addDoc(appId, kind);
        }
    }

    void applyCompleteDraft(UUID appId, int version) {
        var addr = json.createObjectNode().put("line1", "1 Industrial Area").put("city", "Delhi").put("state", "DL").put("pincode", "110001");
        var signatory = json.createObjectNode().put("name", "A. Signatory").put("designation", "Director");
        var draft = json.createObjectNode().put("cin", "U12345AB6789XYZ123456").put("gstin", "22AAAAA0000A1Z5")
            .put("declarationAccepted", true).put("agreementAccepted", true);
        draft.set("registeredAddress", addr);
        draft.set("authorisedSignatory", signatory);
        service.patch(onboardApplicant(), appId, json.createObjectNode().put("version", version).set("draft", draft));
    }

    int readyToSubmit(UUID appId) {
        applyCompleteDraft(appId, repo.find(appId).orElseThrow().version());
        addAllRequiredDocs(appId);
        return repo.find(appId).orElseThrow().version();
    }

    void resetOnboardOrg() {
        owner.update("UPDATE organisation SET permittee_lifecycle = 'none' WHERE id = ?", ONBOARD_ORG);
        owner.update("""
            UPDATE manufacturer_onboarding_application SET state = 'revoked'
             WHERE organisation_id = ? AND state NOT IN ('rejected', 'revoked')
            """, ONBOARD_ORG);
    }

    UUID draftApp() {
        resetOnboardOrg();
        var created = service.create(onboardApplicant(), UUID.randomUUID().toString(), json.createObjectNode().put("legalName", "Onboard Manufacturing Pvt Ltd"));
        return UUID.fromString((String) created.getBody().get("id"));
    }

    @Test
    void wp03OptimizedManufacturerOnboardingProofs() {
        assertThrows(DataAccessException.class, () -> db.update(
            "INSERT INTO manufacturer_onboarding_command_evidence (command_id, application_id, purpose, payload_hash) VALUES (?, ?, 'submit', repeat('a', 64))",
            UUID.randomUUID(), UUID.randomUUID()));

        owner.update("UPDATE organisation SET permittee_lifecycle = 'on_hold' WHERE id = ?", NOVA_ORG);
        UUID appId = owner.queryForObject("SELECT id FROM model_application WHERE reference = 'LOCAL-MA-0001'", UUID.class);
        assertThrows(DataAccessException.class, () -> db.update(
            "UPDATE model_application SET state = 'fee_due', version = version + 1 WHERE id = ? AND state = 'draft'", appId));
        owner.update("UPDATE organisation SET permittee_lifecycle = 'active' WHERE id = ?", NOVA_ORG);

        assertThrows(DataAccessException.class, () -> db.update(
            "INSERT INTO manufacturer_onboarding_application (id, reference, organisation_id, legal_name) VALUES (?, 'X', ?, 'X')",
            UUID.randomUUID(), ONBOARD_ORG));

        UUID id = draftApp();
        var fail = service.submit(onboardApplicant(), id, UUID.randomUUID().toString(), json.createObjectNode().put("version", 0));
        assertEquals("automatic_checks_failed", fail.getBody().get("state"));
        assertEquals(1, owner.queryForObject("SELECT count(*) FROM manufacturer_onboarding_command_evidence WHERE application_id = ?", Integer.class, id));
        owner.update("UPDATE manufacturer_onboarding_application SET state = 'rejected' WHERE id = ?", id);

        UUID id2 = draftApp();
        int draftVersion = readyToSubmit(id2);
        String submitKey = UUID.randomUUID().toString();
        var body = json.createObjectNode().put("version", draftVersion);
        var preview = service.submitPreview(onboardApplicant(), id2);
        assertEquals("5000.00", ((Map<?, ?>) preview.getBody().get("expectedFee")).get("amountInr"));
        var submitted = service.submit(onboardApplicant(), id2, submitKey, body);
        assertEquals("director_review", submitted.getBody().get("state"));
        assertNotNull(submitted.getBody().get("paymentId"));
        var replay = service.submit(onboardApplicant(), id2, submitKey, body);
        assertEquals(submitted.getBody().get("state"), replay.getBody().get("state"));
        assertEquals(1, owner.queryForObject("SELECT count(*) FROM manufacturer_onboarding_payment_link WHERE application_id = ?", Integer.class, id2));

        int v = (int) submitted.getBody().get("version");
        var approved = service.directorDecision(director(), id2, UUID.randomUUID().toString(),
            json.createObjectNode().put("version", v).put("decision", "approve").put("note", "Approved for observation"));
        assertEquals("active_observation", approved.getBody().get("state"));
        assertNotNull(approved.getBody().get("permitteeNumber"));
        LocalDate ends = LocalDate.parse((String) approved.getBody().get("observationEndsOn"));
        v = (int) approved.getBody().get("version");
        assertEquals(409, service.closeObservation(onboardApplicant(), id2, UUID.randomUUID().toString(), json.createObjectNode().put("version", v)).getStatusCode().value());
        assertEquals(422, service.closeObservation(onboardApplicant(), id2, UUID.randomUUID().toString(),
            json.createObjectNode().put("version", v).put("asOf", ends.plusDays(1).toString())).getStatusCode().value());
        LocalDate obsEnd = LocalDate.now(IST);
        owner.update("UPDATE manufacturer_onboarding_application SET observation_ends_on = ? WHERE id = ?", obsEnd, id2);
        owner.update("UPDATE manufacturer_onboarding_observation SET started_on = ?, ends_on = ? WHERE application_id = ?",
            obsEnd.minusDays(16), obsEnd, id2);
        v = repo.find(id2).orElseThrow().version();
        var closed = service.closeObservation(onboardApplicant(), id2, UUID.randomUUID().toString(), json.createObjectNode().put("version", v));
        assertEquals("active", closed.getBody().get("state"));
        owner.update("UPDATE manufacturer_onboarding_application SET state = 'revoked' WHERE id = ?", id2);
        owner.update("UPDATE organisation SET permittee_lifecycle = 'none' WHERE id = ?", ONBOARD_ORG);

        UUID id3 = draftApp();
        var sub3 = service.submit(onboardApplicant(), id3, UUID.randomUUID().toString(),
            json.createObjectNode().put("version", readyToSubmit(id3)));
        v = (int) sub3.getBody().get("version");
        assertEquals(403, service.directorDecision(onboardApplicant(), id3, UUID.randomUUID().toString(),
            json.createObjectNode().put("version", v).put("decision", "approve")).getStatusCode().value());
        var rejected = service.directorDecision(director(), id3, UUID.randomUUID().toString(),
            json.createObjectNode().put("version", v).put("decision", "reject").put("note", "Incomplete dossier"));
        assertEquals("rejected", rejected.getBody().get("state"));
        assertEquals("rejected", owner.queryForObject("SELECT state FROM manufacturer_onboarding_application WHERE id = ?", String.class, id3));
        owner.update("UPDATE organisation SET permittee_lifecycle = 'none' WHERE id = ?", ONBOARD_ORG);

        UUID id4 = draftApp();
        sub3 = service.submit(onboardApplicant(), id4, UUID.randomUUID().toString(),
            json.createObjectNode().put("version", readyToSubmit(id4)));
        v = (int) sub3.getBody().get("version");
        service.directorDecision(director(), id4, UUID.randomUUID().toString(), json.createObjectNode().put("version", v).put("decision", "approve"));
        v = repo.find(id4).orElseThrow().version();
        var raised = service.raiseAnomaly(finance(), id4, UUID.randomUUID().toString(),
            json.createObjectNode().put("version", v).put("reason", "Ledger mismatch probe"));
        assertEquals("on_hold", raised.getBody().get("state"));
        v = (int) raised.getBody().get("version");
        var cleared = service.resolveAnomaly(director(), id4, UUID.randomUUID().toString(),
            json.createObjectNode().put("version", v).put("resolution", "cleared").put("note", "Cleared"));
        assertEquals("active_observation", cleared.getBody().get("state"));
        owner.update("UPDATE manufacturer_onboarding_application SET state = 'revoked' WHERE id = ?", id4);
        owner.update("UPDATE organisation SET permittee_lifecycle = 'none' WHERE id = ?", ONBOARD_ORG);

        UUID id5 = draftApp();
        sub3 = service.submit(onboardApplicant(), id5, UUID.randomUUID().toString(),
            json.createObjectNode().put("version", readyToSubmit(id5)));
        v = (int) sub3.getBody().get("version");
        service.directorDecision(director(), id5, UUID.randomUUID().toString(), json.createObjectNode().put("version", v).put("decision", "approve"));
        LocalDate pastEnd = LocalDate.now(IST).minusDays(1);
        owner.update("UPDATE manufacturer_onboarding_application SET observation_ends_on = ? WHERE id = ?", pastEnd, id5);
        owner.update("UPDATE manufacturer_onboarding_observation SET started_on = ?, ends_on = ? WHERE application_id = ?",
            pastEnd.minusDays(16), pastEnd, id5);
        v = repo.find(id5).orElseThrow().version();
        service.raiseAnomaly(finance(), id5, UUID.randomUUID().toString(),
            json.createObjectNode().put("version", v).put("reason", "Post-deadline probe"));
        v = repo.find(id5).orElseThrow().version();
        var clearedLate = service.resolveAnomaly(director(), id5, UUID.randomUUID().toString(),
            json.createObjectNode().put("version", v).put("resolution", "cleared").put("note", "After observation window"));
        assertEquals("active", clearedLate.getBody().get("state"));
        assertEquals("active", owner.queryForObject("SELECT permittee_lifecycle FROM organisation WHERE id = ?", String.class, ONBOARD_ORG));
        owner.update("UPDATE manufacturer_onboarding_application SET state = 'revoked' WHERE id = ?", id5);
        owner.update("UPDATE organisation SET permittee_lifecycle = 'none' WHERE id = ?", ONBOARD_ORG);

        UUID id6 = draftApp();
        sub3 = service.submit(onboardApplicant(), id6, UUID.randomUUID().toString(),
            json.createObjectNode().put("version", readyToSubmit(id6)));
        v = (int) sub3.getBody().get("version");
        service.directorDecision(director(), id6, UUID.randomUUID().toString(), json.createObjectNode().put("version", v).put("decision", "approve"));
        v = repo.find(id6).orElseThrow().version();
        service.raiseAnomaly(finance(), id6, UUID.randomUUID().toString(),
            json.createObjectNode().put("version", v).put("reason", "Revocation probe"));
        v = repo.find(id6).orElseThrow().version();
        var revoked = service.resolveAnomaly(director(), id6, UUID.randomUUID().toString(),
            json.createObjectNode().put("version", v).put("resolution", "revoked").put("note", "Permittee revoked"));
        assertEquals("revoked", revoked.getBody().get("state"));
        assertEquals("revoked", owner.queryForObject("SELECT permittee_lifecycle FROM organisation WHERE id = ?", String.class, ONBOARD_ORG));
    }

    @Test
    void mobTrustedGucCannotBypassRuntimeGuards() {
        db.execute("SELECT set_config('bee.mob_trusted', 'create', true)");
        assertThrows(DataAccessException.class, () -> db.update(
            "INSERT INTO manufacturer_onboarding_application (id, reference, organisation_id, legal_name) VALUES (?, 'FORGED', ?, 'X')",
            UUID.randomUUID(), ONBOARD_ORG));
        db.execute("SELECT set_config('bee.mob_trusted', 'orchestrator', true)");
        UUID id = draftApp();
        assertThrows(DataAccessException.class, () -> db.update(
            "UPDATE manufacturer_onboarding_application SET legal_name = 'Forged' WHERE id = ?", id));
        assertThrows(DataAccessException.class, () -> db.update(
            "INSERT INTO manufacturer_onboarding_event (id, application_id, event_kind, actor_account_id, actor_role) VALUES (?, ?, 'forged', ?, 'manufacturer')",
            UUID.randomUUID(), id, ONBOARD_USER));
    }

    @Test
    void crossOrganisationCreateRefused() {
        assertThrows(DataAccessException.class, () -> db.queryForObject(
            "SELECT manufacturer_onboarding_trusted_create(?, ?, ?, ?, '{}'::jsonb)",
            UUID.class, NOVA_USER, ONBOARD_ORG, "Wrong org", LocalDate.now(IST).getYear()));
    }

    @Test
    void runtimeDirectUpdateRefused() {
        UUID id = draftApp();
        assertThrows(DataAccessException.class, () -> db.update(
            "UPDATE manufacturer_onboarding_application SET draft_payload = '{\"cin\":\"X\"}'::jsonb WHERE id = ?", id));
    }

    @Test
    void crossOrganisationUpdateRefused() {
        UUID id = draftApp();
        assertThrows(DataAccessException.class, () -> db.queryForObject(
            "SELECT manufacturer_onboarding_trusted_patch_draft(?, ?, ?, ?, ?, '{}'::jsonb)",
            Integer.class, NOVA_USER, id, ONBOARD_ORG, 0, null));
    }

    @Test
    void tradeLicenceUploadedRequiresTradeLicenceDocument() {
        UUID id = draftApp();
        addDoc(id, "pan_card");
        var preview = service.submitPreview(onboardApplicant(), id);
        assertEquals(false, preview.getBody().get("tradeLicenceUploaded"));
        addDoc(id, "trade_licence");
        preview = service.submitPreview(onboardApplicant(), id);
        assertEquals(true, preview.getBody().get("tradeLicenceUploaded"));
    }

    @Test
    void trustedAppendDocumentConcurrentVersions() {
        UUID id = draftApp();
        String sha = "a".repeat(64);
        docRepo.recordVersion(ONBOARD_ORG, id, "trade_licence", sha, 100, "a.pdf", "trade", null, null, ONBOARD_USER);
        docRepo.recordVersion(ONBOARD_ORG, id, "trade_licence", sha, 100, "b.pdf", "trade", null, null, ONBOARD_USER);
        assertEquals(2, owner.queryForObject(
            "SELECT max(version_number) FROM manufacturer_onboarding_document_version v JOIN manufacturer_onboarding_document d ON d.id = v.document_id WHERE d.application_id = ? AND d.document_kind = 'trade_licence'",
            Integer.class, id));
    }

    @Test
    void runtimeDirectDocumentInsertRefused() {
        UUID id = draftApp();
        assertThrows(DataAccessException.class, () -> db.update(
            "INSERT INTO manufacturer_onboarding_document (id, application_id, document_kind) VALUES (?, ?, 'pan_card')",
            UUID.randomUUID(), id));
    }

    @Test
    void repeatedAnomalyEpisodesSeparateIdempotencyKeys() {
        UUID id = draftApp();
        var sub = service.submit(onboardApplicant(), id, UUID.randomUUID().toString(),
            json.createObjectNode().put("version", readyToSubmit(id)));
        int v = (int) sub.getBody().get("version");
        service.directorDecision(director(), id, UUID.randomUUID().toString(),
            json.createObjectNode().put("version", v).put("decision", "approve"));
        v = repo.find(id).orElseThrow().version();
        String key1 = UUID.randomUUID().toString();
        service.raiseAnomaly(finance(), id, key1, json.createObjectNode().put("version", v).put("reason", "First episode"));
        v = repo.find(id).orElseThrow().version();
        service.resolveAnomaly(director(), id, UUID.randomUUID().toString(),
            json.createObjectNode().put("version", v).put("resolution", "cleared").put("note", "Cleared first"));
        v = repo.find(id).orElseThrow().version();
        String key2 = UUID.randomUUID().toString();
        var second = service.raiseAnomaly(finance(), id, key2, json.createObjectNode().put("version", v).put("reason", "Second episode"));
        assertEquals("on_hold", second.getBody().get("state"));
        assertEquals(2, owner.queryForObject("SELECT count(*) FROM manufacturer_onboarding_anomaly WHERE application_id = ?", Integer.class, id));
        owner.update("UPDATE manufacturer_onboarding_application SET state = 'revoked' WHERE id = ?", id);
        owner.update("UPDATE organisation SET permittee_lifecycle = 'none' WHERE id = ?", ONBOARD_ORG);
    }

    @Test
    void runtimeExecuteInventoryPublished() {
        var expected = java.util.Set.of(
            "manufacturer_onboarding_trusted_create",
            "manufacturer_onboarding_trusted_patch_draft",
            "manufacturer_onboarding_trusted_append_document",
            "manufacturer_onboarding_orchestrate_submit",
            "manufacturer_onboarding_orchestrate_director_decision",
            "manufacturer_onboarding_orchestrate_raise_anomaly",
            "manufacturer_onboarding_orchestrate_resolve_anomaly",
            "manufacturer_onboarding_orchestrate_observation_close");
        var granted = new java.util.HashSet<>(owner.queryForList("""
            SELECT p.proname FROM pg_proc p
              JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = current_schema()
               AND p.proname IN (
                 'manufacturer_onboarding_trusted_create',
                 'manufacturer_onboarding_trusted_patch_draft',
                 'manufacturer_onboarding_trusted_append_document',
                 'manufacturer_onboarding_orchestrate_submit',
                 'manufacturer_onboarding_orchestrate_director_decision',
                 'manufacturer_onboarding_orchestrate_raise_anomaly',
                 'manufacturer_onboarding_orchestrate_resolve_anomaly',
                 'manufacturer_onboarding_orchestrate_observation_close')
               AND has_function_privilege('bee_runtime', p.oid, 'EXECUTE')
            """, String.class));
        assertEquals(expected, granted);
    }
}
