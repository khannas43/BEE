package gov.bee.api.manufactureronboarding;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import com.fasterxml.jackson.databind.ObjectMapper;
import gov.bee.api.application.DraftRequestSupport;
import gov.bee.api.application.IdempotencyRepository;
import gov.bee.api.identity.Caller;
import gov.bee.api.identity.IdentityRepository.RoleGrant;
import gov.bee.api.masters.MasterDataRepository;
import gov.bee.api.masters.Masters.FeeRule;
import gov.bee.api.masters.MasterVersion;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
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
        schemaName = "wp03_mob_" + nextIdempotencyKey().replace("-", "").substring(0, 10);
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
        assertEquals(83, owner.queryForObject("SELECT max(installed_rank) FROM flyway_schema_history", Integer.class));
        assertEquals(1, owner.queryForObject(
            "SELECT count(*) FROM flyway_schema_history WHERE success AND version = '78'", Integer.class));
        assertEquals("none", owner.queryForObject("SELECT permittee_lifecycle FROM organisation WHERE id = ?", String.class, ONBOARD_ORG));
        assertEquals("active", owner.queryForObject("SELECT permittee_lifecycle FROM organisation WHERE id = ?", String.class, NOVA_ORG));
    }

    static List<String> pinnedSearchPath(String funcName) {
        List<String> cfg = owner.queryForList("""
            SELECT unnest(p.proconfig)::text FROM pg_proc p
              JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = current_schema() AND p.proname = ?
            """, String.class, funcName);
        return cfg.stream().filter(s -> s.startsWith("search_path=")).findFirst()
            .map(s -> List.of(s.substring("search_path=".length()).split(",\\s*")))
            .orElse(List.of());
    }

    @Test
    void wp03SecurityDefinerFunctionsPinSearchPathWithCatalogAndTempLast() {
        List<String> funcs = List.of(
            "manufacturer_onboarding_trusted_create",
            "manufacturer_onboarding_trusted_patch_draft",
            "manufacturer_onboarding_trusted_append_document",
            "manufacturer_onboarding_run_automated_checks",
            "manufacturer_onboarding_orchestrate_submit",
            "manufacturer_onboarding_orchestrate_director_decision",
            "manufacturer_onboarding_orchestrate_raise_anomaly",
            "manufacturer_onboarding_orchestrate_resolve_anomaly",
            "manufacturer_onboarding_orchestrate_observation_close",
            "manufacturer_onboarding_orchestrate_public_signup",
            "manufacturer_onboarding_maint_cleanup_public_signup",
            "manufacturer_onboarding_maint_observation_close_as_of",
            "manufacturer_onboarding_maint_close_expired_observations",
            "manufacturer_onboarding_system_close_expired_observations");
        for (String func : funcs) {
            List<String> path = pinnedSearchPath(func);
            assertEquals(List.of(schemaName, "pg_catalog", "pg_temp"), path, func + " search_path");
            assertEquals("pg_temp", path.get(path.size() - 1), func + " must end in pg_temp");
        }
    }

    @AfterAll
    static void drop() {
        if (admin != null && schemaName != null) {
            admin.execute("DROP SCHEMA IF EXISTS " + schemaName + " CASCADE");
        }
    }

    @BeforeEach
    void isolateOnboardOrganisation() {
        resetOnboardOrg();
    }

    static String nextIdempotencyKey() {
        return UUID.randomUUID().toString().replace("-", "");
    }

    static Caller onboardApplicant() {
        return new Caller(ONBOARD_USER, "onboarding.applicant", List.of(new RoleGrant("manufacturer", "own-org")), Set.of(ONBOARD_ORG));
    }

    static Caller director() {
        return new Caller(DIRECTOR, "bee.officer", List.of(new RoleGrant("officer", "all")), Set.of());
    }

    static Caller finance() {
        return new Caller(FINANCE, "bee.finance", List.of(new RoleGrant("finance", "all")), Set.of());
    }

    static Caller adminDemonstration() {
        return new Caller(UUID.fromString("00000000-0000-4000-a000-000000000009"), "bee.admin",
            List.of(new RoleGrant("admin", "all")), Set.of());
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
        var created = service.create(onboardApplicant(), nextIdempotencyKey(), json.createObjectNode().put("legalName", "Onboard Manufacturing Pvt Ltd"));
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
        int incompleteVersion = repo.find(id).orElseThrow().version();
        var fail = service.submit(onboardApplicant(), id, nextIdempotencyKey(),
            json.createObjectNode().put("version", incompleteVersion));
        assertEquals("automatic_checks_failed", fail.getBody().get("state"));
        assertEquals(1, owner.queryForObject("SELECT count(*) FROM manufacturer_onboarding_command_evidence WHERE application_id = ?", Integer.class, id));
        owner.update("UPDATE manufacturer_onboarding_application SET state = 'rejected' WHERE id = ?", id);

        UUID id2 = draftApp();
        int draftVersion = readyToSubmit(id2);
        String submitKey = nextIdempotencyKey();
        var body = json.createObjectNode().put("version", draftVersion);
        var preview = service.submitPreview(onboardApplicant(), id2);
        assertEquals("5000.00", ((Map<?, ?>) preview.getBody().get("expectedFee")).get("amountInr"));
        var submitted = service.submit(onboardApplicant(), id2, submitKey, body);
        assertEquals("director_review", submitted.getBody().get("state"));
        assertNotNull(submitted.getBody().get("paymentId"));
        assertNull(submitted.getBody().get("permitteeNumber"));
        assertEquals("pending", owner.queryForObject("SELECT permittee_lifecycle FROM organisation WHERE id = ?", String.class, ONBOARD_ORG));
        int directorVersion = (int) submitted.getBody().get("version");
        var approved = service.directorDecision(director(), id2, nextIdempotencyKey(),
            json.createObjectNode().put("version", directorVersion).put("decision", "approve").put("note", "Activate for observation"));
        assertEquals("active_observation", approved.getBody().get("state"));
        assertNotNull(approved.getBody().get("permitteeNumber"));
        var replay = service.submit(onboardApplicant(), id2, submitKey, body);
        assertEquals(submitted.getBody().get("state"), replay.getBody().get("state"));
        assertEquals(1, owner.queryForObject("SELECT count(*) FROM manufacturer_onboarding_payment_link WHERE application_id = ?", Integer.class, id2));

        assertEquals("active", owner.queryForObject("SELECT permittee_lifecycle FROM organisation WHERE id = ?", String.class, ONBOARD_ORG));
        LocalDate obsEnd = LocalDate.now(IST);
        owner.update("UPDATE manufacturer_onboarding_application SET observation_ends_on = ? WHERE id = ?", obsEnd, id2);
        owner.update("UPDATE manufacturer_onboarding_observation SET started_on = ?, ends_on = ? WHERE application_id = ?",
            obsEnd.minusDays(16), obsEnd, id2);
        assertEquals("active", maint.queryForObject("SELECT manufacturer_onboarding_maint_observation_close_as_of(?, ?)",
            String.class, id2, obsEnd));
        owner.update("UPDATE manufacturer_onboarding_application SET state = 'revoked' WHERE id = ?", id2);
        owner.update("UPDATE organisation SET permittee_lifecycle = 'none' WHERE id = ?", ONBOARD_ORG);

        UUID id4 = approvedForObservation();
        int v = repo.find(id4).orElseThrow().version();
        var raised = service.raiseAnomaly(finance(), id4, nextIdempotencyKey(),
            json.createObjectNode().put("version", v).put("reason", "Ledger mismatch probe"));
        assertEquals("on_hold", raised.getBody().get("state"));
        v = (int) raised.getBody().get("version");
        var cleared = service.resolveAnomaly(director(), id4, nextIdempotencyKey(),
            json.createObjectNode().put("version", v).put("resolution", "cleared").put("note", "Cleared"));
        assertEquals("active_observation", cleared.getBody().get("state"));
        owner.update("UPDATE manufacturer_onboarding_application SET state = 'revoked' WHERE id = ?", id4);
        owner.update("UPDATE organisation SET permittee_lifecycle = 'none' WHERE id = ?", ONBOARD_ORG);

        UUID id5 = approvedForObservation();
        LocalDate pastEnd = LocalDate.now(IST).minusDays(1);
        owner.update("UPDATE manufacturer_onboarding_application SET observation_ends_on = ? WHERE id = ?", pastEnd, id5);
        owner.update("UPDATE manufacturer_onboarding_observation SET started_on = ?, ends_on = ? WHERE application_id = ?",
            pastEnd.minusDays(16), pastEnd, id5);
        v = repo.find(id5).orElseThrow().version();
        service.raiseAnomaly(finance(), id5, nextIdempotencyKey(),
            json.createObjectNode().put("version", v).put("reason", "Post-deadline probe"));
        v = repo.find(id5).orElseThrow().version();
        var clearedLate = service.resolveAnomaly(director(), id5, nextIdempotencyKey(),
            json.createObjectNode().put("version", v).put("resolution", "cleared").put("note", "After observation window"));
        assertEquals("active", clearedLate.getBody().get("state"));
        assertEquals("active", owner.queryForObject("SELECT permittee_lifecycle FROM organisation WHERE id = ?", String.class, ONBOARD_ORG));
        owner.update("UPDATE manufacturer_onboarding_application SET state = 'revoked' WHERE id = ?", id5);
        owner.update("UPDATE organisation SET permittee_lifecycle = 'none' WHERE id = ?", ONBOARD_ORG);

        UUID id6 = approvedForObservation();
        v = repo.find(id6).orElseThrow().version();
        service.raiseAnomaly(finance(), id6, nextIdempotencyKey(),
            json.createObjectNode().put("version", v).put("reason", "Revocation probe"));
        v = repo.find(id6).orElseThrow().version();
        var revoked = service.resolveAnomaly(director(), id6, nextIdempotencyKey(),
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
    void runtimeDocumentUploadViaTrustedAppendWithoutDirectTableUpdate() {
        UUID id = draftApp();
        assertEquals("draft", docRepo.readStateForUpload(id).orElseThrow());
        assertThrows(DataAccessException.class, () -> db.update(
            "UPDATE manufacturer_onboarding_application SET legal_name = legal_name WHERE id = ?", id));
        assertThrows(DataAccessException.class, () -> db.update(
            "UPDATE manufacturer_onboarding_document SET document_kind = document_kind WHERE application_id = ?", id));
        int version = docRepo.recordVersion(ONBOARD_ORG, id, "trade_licence", "c".repeat(64), 120, "licence.pdf", "Trade licence", null, null, ONBOARD_USER);
        assertEquals(1, version);
        assertEquals(1, owner.queryForObject(
            "SELECT count(*) FROM manufacturer_onboarding_document_version v JOIN manufacturer_onboarding_document d ON d.id = v.document_id WHERE d.application_id = ?",
            Integer.class, id));
    }

    @Test
    void repeatedAnomalyEpisodesSeparateIdempotencyKeys() {
        UUID id = approvedForObservation();
        int v = repo.find(id).orElseThrow().version();
        String key1 = nextIdempotencyKey();
        service.raiseAnomaly(finance(), id, key1, json.createObjectNode().put("version", v).put("reason", "First episode"));
        v = repo.find(id).orElseThrow().version();
        service.resolveAnomaly(director(), id, nextIdempotencyKey(),
            json.createObjectNode().put("version", v).put("resolution", "cleared").put("note", "Cleared first"));
        v = repo.find(id).orElseThrow().version();
        String key2 = nextIdempotencyKey();
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
            "manufacturer_onboarding_orchestrate_public_signup",
            "manufacturer_onboarding_system_close_expired_observations");
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
                 'manufacturer_onboarding_orchestrate_public_signup',
                 'manufacturer_onboarding_orchestrate_observation_close',
                 'manufacturer_onboarding_system_close_expired_observations')
               AND has_function_privilege('bee_runtime', p.oid, 'EXECUTE')
            """, String.class));
        assertEquals(expected, granted);
    }

    static UUID mobCommandId(String idempotencyKey, String purpose, UUID applicationId) {
        return UUID.nameUUIDFromBytes((idempotencyKey + "|" + purpose + "|" + applicationId).getBytes(StandardCharsets.UTF_8));
    }

    static String payloadHashHex(byte[] bodyHash) {
        return HexFormat.of().formatHex(bodyHash);
    }

    FeeRule mobFeeRule() {
        return new MasterDataRepository(db).feeRule("REG", "manufacturer_onboarding", LocalDate.now(IST)).orElseThrow();
    }

    UUID approvedForObservation() {
        UUID id = draftApp();
        int v = readyToSubmit(id);
        var submitted = service.submit(onboardApplicant(), id, nextIdempotencyKey(), json.createObjectNode().put("version", v));
        v = (int) submitted.getBody().get("version");
        service.directorDecision(director(), id, nextIdempotencyKey(),
            json.createObjectNode().put("version", v).put("decision", "approve").put("note", "Activate for observation"));
        return id;
    }

    int residueCount(UUID appId) {
        return owner.queryForObject("""
            SELECT
              (SELECT count(*) FROM manufacturer_onboarding_payment_link WHERE application_id = ?)
            + (SELECT count(*) FROM manufacturer_onboarding_fee_snapshot WHERE application_id = ?)
            + (SELECT count(*) FROM manufacturer_onboarding_command_evidence WHERE application_id = ?)
            + (SELECT count(*) FROM manufacturer_onboarding_event WHERE application_id = ?)
            """, Integer.class, appId, appId, appId, appId);
    }

    @Test
    void identicalReplayReturnsOriginalResultAfterLifecycleMove() {
        UUID id = draftApp();
        int v = readyToSubmit(id);
        String key = "0123456789abcdef012345a01";
        var body = json.createObjectNode().put("version", v);
        var first = service.submit(onboardApplicant(), id, key, body);
        assertEquals("director_review", first.getBody().get("state"));
        UUID paymentId = UUID.fromString((String) first.getBody().get("paymentId"));
        int firstVersion = (int) first.getBody().get("version");
        service.directorDecision(director(), id, nextIdempotencyKey(),
            json.createObjectNode().put("version", firstVersion).put("decision", "approve").put("note", "Activate after submit replay"));
        int afterApprove = repo.find(id).orElseThrow().version();
        service.raiseAnomaly(finance(), id, nextIdempotencyKey(),
            json.createObjectNode().put("version", afterApprove).put("reason", "Move lifecycle after submit"));
        assertEquals("on_hold", repo.find(id).orElseThrow().state());
        var replay = service.submit(onboardApplicant(), id, key, body);
        assertEquals(200, replay.getStatusCode().value());
        assertEquals("director_review", replay.getBody().get("state"));
        assertEquals(firstVersion, replay.getBody().get("version"));
        assertEquals(paymentId.toString(), replay.getBody().get("paymentId"));
        owner.update("UPDATE manufacturer_onboarding_application SET state = 'revoked' WHERE id = ?", id);
        owner.update("UPDATE organisation SET permittee_lifecycle = 'none' WHERE id = ?", ONBOARD_ORG);
    }

    @Test
    void changedPayloadReplayConflictsSubmit() {
        UUID id = draftApp();
        int v = readyToSubmit(id);
        String key = "0123456789abcdef012345a02";
        service.submit(onboardApplicant(), id, key, json.createObjectNode().put("version", v));
        var conflict = service.submit(onboardApplicant(), id, key, json.createObjectNode().put("version", v + 1));
        assertEquals(409, conflict.getStatusCode().value());
        assertEquals("idempotency_key_conflict", conflict.getBody().get("error"));
        owner.update("UPDATE manufacturer_onboarding_application SET state = 'revoked' WHERE id = ?", id);
        owner.update("UPDATE organisation SET permittee_lifecycle = 'none' WHERE id = ?", ONBOARD_ORG);
    }

    @Test
    void directorApprovalActivatesAndFinanceCannotDecide() {
        UUID id = draftApp();
        int v = readyToSubmit(id);
        var submitted = service.submit(onboardApplicant(), id, nextIdempotencyKey(), json.createObjectNode().put("version", v));
        v = (int) submitted.getBody().get("version");
        assertEquals("director_review", submitted.getBody().get("state"));
        assertEquals("none", owner.queryForObject(
            "SELECT CASE WHEN permittee_number IS NULL THEN 'none' ELSE permittee_number END FROM manufacturer_onboarding_application WHERE id = ?",
            String.class, id));
        var financeDenied = service.directorDecision(finance(), id, "0123456789abcdef012345a03",
            json.createObjectNode().put("version", v).put("decision", "approve").put("note", "Finance must not activate"));
        assertEquals(403, financeDenied.getStatusCode().value());
        var adminDenied = service.directorDecision(adminDemonstration(), id, nextIdempotencyKey(),
            json.createObjectNode().put("version", v).put("decision", "approve").put("note", "Admin must not activate"));
        assertEquals(403, adminDenied.getStatusCode().value());
        var approved = service.directorDecision(director(), id, nextIdempotencyKey(),
            json.createObjectNode().put("version", v).put("decision", "approve").put("note", "Director activates"));
        assertEquals("active_observation", approved.getBody().get("state"));
        assertNotNull(approved.getBody().get("permitteeNumber"));
        assertEquals("active", owner.queryForObject("SELECT permittee_lifecycle FROM organisation WHERE id = ?", String.class, ONBOARD_ORG));
        owner.update("UPDATE manufacturer_onboarding_application SET state = 'revoked' WHERE id = ?", id);
        owner.update("UPDATE organisation SET permittee_lifecycle = 'none' WHERE id = ?", ONBOARD_ORG);
    }

    @Test
    void changedPayloadReplayConflictsRaiseAnomaly() {
        UUID id = approvedForObservation();
        int v = repo.find(id).orElseThrow().version();
        String key = "0123456789abcdef012345a04";
        service.raiseAnomaly(finance(), id, key, json.createObjectNode().put("version", v).put("reason", "First reason"));
        v = repo.find(id).orElseThrow().version();
        service.resolveAnomaly(director(), id, nextIdempotencyKey(),
            json.createObjectNode().put("version", v).put("resolution", "cleared").put("note", "ok"));
        v = repo.find(id).orElseThrow().version();
        var conflict = service.raiseAnomaly(finance(), id, key, json.createObjectNode().put("version", v).put("reason", "Different reason"));
        assertEquals(409, conflict.getStatusCode().value());
        assertEquals("idempotency_key_conflict", conflict.getBody().get("error"));
        owner.update("UPDATE manufacturer_onboarding_application SET state = 'revoked' WHERE id = ?", id);
        owner.update("UPDATE organisation SET permittee_lifecycle = 'none' WHERE id = ?", ONBOARD_ORG);
    }

    @Test
    void changedPayloadReplayConflictsResolveAnomaly() {
        UUID id = approvedForObservation();
        int v = repo.find(id).orElseThrow().version();
        service.raiseAnomaly(finance(), id, nextIdempotencyKey(), json.createObjectNode().put("version", v).put("reason", "Probe"));
        v = repo.find(id).orElseThrow().version();
        String key = "0123456789abcdef012345a05";
        service.resolveAnomaly(director(), id, key,
            json.createObjectNode().put("version", v).put("resolution", "cleared").put("note", "First note"));
        service.raiseAnomaly(finance(), id, nextIdempotencyKey(), json.createObjectNode().put("version", repo.find(id).orElseThrow().version()).put("reason", "Again"));
        v = repo.find(id).orElseThrow().version();
        var conflict = service.resolveAnomaly(director(), id, key,
            json.createObjectNode().put("version", v).put("resolution", "cleared").put("note", "Changed note"));
        assertEquals(409, conflict.getStatusCode().value());
        assertEquals("idempotency_key_conflict", conflict.getBody().get("error"));
        owner.update("UPDATE manufacturer_onboarding_application SET state = 'revoked' WHERE id = ?", id);
        owner.update("UPDATE organisation SET permittee_lifecycle = 'none' WHERE id = ?", ONBOARD_ORG);
    }

    @Test
    void crossApplicationCommandIdReuseConflicts() {
        UUID id1 = draftApp();
        int v1 = readyToSubmit(id1);
        String key = "0123456789abcdef012345a06";
        UUID cmd = mobCommandId(key, "submit", id1);
        FeeRule fee = mobFeeRule();
        MasterVersion fv = fee.version();
        String verification = fv.verification().name().toLowerCase();
        String hash1 = ManufacturerOnboardingCommandHash.submit(id1, ONBOARD_USER, v1, fee.amountInr(), fv.ruleKey(), fv.version(), verification,
            fv.sourceReference(), fv.note());
        repo.orchestrateSubmit(id1, ONBOARD_USER, "manufacturer", v1, fee.amountInr(), fv.ruleKey(), fv.version(), verification,
            fv.sourceReference(), fv.note(), cmd, hash1);
        UUID id2 = draftApp();
        int v2 = readyToSubmit(id2);
        String hash2 = ManufacturerOnboardingCommandHash.submit(id2, ONBOARD_USER, v2, fee.amountInr(), fv.ruleKey(), fv.version(), verification,
            fv.sourceReference(), fv.note());
        assertEquals("idempotency_key_conflict",
            repo.orchestrateSubmit(id2, ONBOARD_USER, "manufacturer", v2, fee.amountInr(), fv.ruleKey(), fv.version(), verification,
                fv.sourceReference(), fv.note(), cmd, hash2).orElseThrow().outState());
        owner.update("UPDATE manufacturer_onboarding_application SET state = 'revoked' WHERE id IN (?, ?)", id1, id2);
        owner.update("UPDATE organisation SET permittee_lifecycle = 'none' WHERE id = ?", ONBOARD_ORG);
    }

    @Test
    void crossPurposeCommandIdReuseConflicts() {
        UUID id = draftApp();
        int v = readyToSubmit(id);
        String key = "0123456789abcdef012345a07";
        UUID cmd = mobCommandId(key, "submit", id);
        FeeRule fee = mobFeeRule();
        MasterVersion fv = fee.version();
        String verification = fv.verification().name().toLowerCase();
        repo.orchestrateSubmit(id, ONBOARD_USER, "manufacturer", v, fee.amountInr(), fv.ruleKey(), fv.version(), verification,
            fv.sourceReference(), fv.note(), cmd, ManufacturerOnboardingCommandHash.submit(id, ONBOARD_USER, v, fee.amountInr(), fv.ruleKey(),
                fv.version(), verification, fv.sourceReference(), fv.note()));
        v = repo.find(id).orElseThrow().version();
        assertEquals("idempotency_key_conflict", repo.orchestrateDirectorDecision(id, DIRECTOR, v, "approve", "note", cmd,
            ManufacturerOnboardingCommandHash.directorDecision(id, DIRECTOR, v, "approve", "note")).orElseThrow().outState());
        owner.update("UPDATE manufacturer_onboarding_application SET state = 'revoked' WHERE id = ?", id);
        owner.update("UPDATE organisation SET permittee_lifecycle = 'none' WHERE id = ?", ONBOARD_ORG);
    }

    @Test
    void forgedSubmitActorRefusedWithoutResidue() {
        UUID id = draftApp();
        int v = readyToSubmit(id);
        FeeRule fee = mobFeeRule();
        MasterVersion fv = fee.version();
        UUID cmd = UUID.randomUUID();
        int before = residueCount(id);
        assertThrows(DataAccessException.class, () -> db.queryForObject(
            "SELECT out_state FROM manufacturer_onboarding_orchestrate_submit(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?::char(64))",
            String.class, id, NOVA_USER, "manufacturer", v, fee.amountInr(), fv.ruleKey(), fv.version(),
            fv.verification().name().toLowerCase(), fv.sourceReference(), fv.note(), cmd, null));
        assertEquals(before, residueCount(id));
        assertThrows(DataAccessException.class, () -> db.queryForObject(
            "SELECT out_state FROM manufacturer_onboarding_orchestrate_submit(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?::char(64))",
            String.class, id, ONBOARD_USER, "finance", v, fee.amountInr(), fv.ruleKey(), fv.version(),
            fv.verification().name().toLowerCase(), fv.sourceReference(), fv.note(), UUID.randomUUID(), null));
        assertEquals(before, residueCount(id));
        owner.update("UPDATE manufacturer_onboarding_application SET state = 'revoked' WHERE id = ?", id);
        owner.update("UPDATE organisation SET permittee_lifecycle = 'none' WHERE id = ?", ONBOARD_ORG);
    }

    @Test
    void inactiveDirectorActorRefused() {
        UUID id = draftApp();
        int v = readyToSubmit(id);
        service.submit(onboardApplicant(), id, nextIdempotencyKey(), json.createObjectNode().put("version", v));
        final int directorVersion = repo.find(id).orElseThrow().version();
        owner.update("UPDATE user_account SET status = 'disabled' WHERE id = ?", DIRECTOR);
        try {
            assertThrows(DataAccessException.class, () -> db.queryForObject(
                "SELECT out_state FROM manufacturer_onboarding_orchestrate_director_decision(?, ?, ?, ?, ?, ?, ?::char(64))",
                String.class, id, DIRECTOR, directorVersion, "approve", "note", UUID.randomUUID(), null));
        } finally {
            owner.update("UPDATE user_account SET status = 'active' WHERE id = ?", DIRECTOR);
        }
        owner.update("UPDATE manufacturer_onboarding_application SET state = 'revoked' WHERE id = ?", id);
        owner.update("UPDATE organisation SET permittee_lifecycle = 'none' WHERE id = ?", ONBOARD_ORG);
    }

    @Test
    void inactiveAnomalyActorRefused() {
        UUID id = approvedForObservation();
        final int anomalyVersion = repo.find(id).orElseThrow().version();
        owner.update("UPDATE user_account SET status = 'disabled' WHERE id = ?", FINANCE);
        try {
            assertThrows(DataAccessException.class, () -> db.queryForObject(
                "SELECT out_state FROM manufacturer_onboarding_orchestrate_raise_anomaly(?, ?, ?, ?, ?, ?, ?::char(64))",
                String.class, id, FINANCE, "finance", anomalyVersion, "Probe", UUID.randomUUID(), null));
        } finally {
            owner.update("UPDATE user_account SET status = 'active' WHERE id = ?", FINANCE);
        }
        owner.update("UPDATE manufacturer_onboarding_application SET state = 'revoked' WHERE id = ?", id);
        owner.update("UPDATE organisation SET permittee_lifecycle = 'none' WHERE id = ?", ONBOARD_ORG);
    }

    @Test
    void runtimeCannotExecuteObservationClose() {
        UUID id = approvedForObservation();
        int v = repo.find(id).orElseThrow().version();
        assertThrows(DataAccessException.class, () -> db.queryForObject(
            "SELECT out_state FROM manufacturer_onboarding_orchestrate_observation_close(?, ?, ?, ?, ?, ?::char(64))",
            String.class, id, DIRECTOR, "director", v, UUID.randomUUID(), null));
        owner.update("UPDATE manufacturer_onboarding_application SET state = 'revoked' WHERE id = ?", id);
        owner.update("UPDATE organisation SET permittee_lifecycle = 'none' WHERE id = ?", ONBOARD_ORG);
    }

    @Test
    void maintObservationCloseAfterDeadlineSucceeds() {
        UUID id = approvedForObservation();
        LocalDate today = LocalDate.now(IST);
        owner.update("UPDATE manufacturer_onboarding_application SET observation_ends_on = ? WHERE id = ?", today, id);
        owner.update("UPDATE manufacturer_onboarding_observation SET started_on = ?, ends_on = ? WHERE application_id = ?",
            today.minusDays(16), today, id);
        assertEquals("active", maint.queryForObject("SELECT manufacturer_onboarding_maint_observation_close_as_of(?, ?)", String.class, id, today));
        assertEquals("active", repo.find(id).orElseThrow().state());
        owner.update("UPDATE manufacturer_onboarding_application SET state = 'revoked' WHERE id = ?", id);
        owner.update("UPDATE organisation SET permittee_lifecycle = 'none' WHERE id = ?", ONBOARD_ORG);
    }

    @Test
    void runtimeSchedulerClosesExpiredObservationWithoutDirectorApproval() {
        UUID id = approvedForObservation();
        LocalDate today = LocalDate.now(IST);
        owner.update("UPDATE manufacturer_onboarding_application SET observation_ends_on = ? WHERE id = ?", today, id);
        owner.update("UPDATE manufacturer_onboarding_observation SET started_on = ?, ends_on = ? WHERE application_id = ?",
            today.minusDays(15), today, id);

        assertEquals(1, repo.closeExpiredObservations());
        assertEquals("active", repo.find(id).orElseThrow().state());
        assertEquals("active", owner.queryForObject(
            "SELECT permittee_lifecycle FROM organisation WHERE id = ?", String.class, ONBOARD_ORG));
        assertEquals(0, repo.closeExpiredObservations());

        Integer version = repo.find(id).orElseThrow().version();
        assertEquals("not_found", db.queryForObject(
            "SELECT out_state FROM manufacturer_onboarding_orchestrate_raise_anomaly(?, ?, ?, ?, ?, ?, ?::char(64))",
            String.class, id, FINANCE, "finance", version, "Outside observation window", UUID.randomUUID(), null));
        assertEquals("active", repo.find(id).orElseThrow().state());

        owner.update("UPDATE manufacturer_onboarding_application SET state = 'revoked' WHERE id = ?", id);
        owner.update("UPDATE organisation SET permittee_lifecycle = 'none' WHERE id = ?", ONBOARD_ORG);
    }

    @Test
    void maintObservationCloseBeforeDeadlineFails() {
        UUID id = approvedForObservation();
        assertEquals("observation_not_ended", maint.queryForObject("SELECT manufacturer_onboarding_maint_observation_close_as_of(?, ?)",
            String.class, id, LocalDate.now(IST)));
        assertEquals("active_observation", repo.find(id).orElseThrow().state());
        owner.update("UPDATE manufacturer_onboarding_application SET state = 'revoked' WHERE id = ?", id);
        owner.update("UPDATE organisation SET permittee_lifecycle = 'none' WHERE id = ?", ONBOARD_ORG);
    }

    @Test
    void maintObservationCloseWithOpenAnomalyFails() {
        UUID id = approvedForObservation();
        int v = repo.find(id).orElseThrow().version();
        service.raiseAnomaly(finance(), id, nextIdempotencyKey(), json.createObjectNode().put("version", v).put("reason", "Hold"));
        LocalDate today = LocalDate.now(IST);
        owner.update("UPDATE manufacturer_onboarding_application SET observation_ends_on = ? WHERE id = ?", today, id);
        owner.update("UPDATE manufacturer_onboarding_observation SET started_on = ?, ends_on = ? WHERE application_id = ?",
            today.minusDays(16), today, id);
        assertEquals("not_found", maint.queryForObject("SELECT manufacturer_onboarding_maint_observation_close_as_of(?, ?)", String.class, id, today));
        assertEquals("on_hold", repo.find(id).orElseThrow().state());
        owner.update("UPDATE manufacturer_onboarding_application SET state = 'revoked' WHERE id = ?", id);
        owner.update("UPDATE organisation SET permittee_lifecycle = 'none' WHERE id = ?", ONBOARD_ORG);
    }

    @Test
    void adminDemonstrationReadsAllOnboardingApplicationsButCannotMutate() {
        UUID id = draftApp();
        assertEquals(200, service.list(adminDemonstration()).getStatusCode().value());
        assertEquals(200, service.get(adminDemonstration(), id).getStatusCode().value());
        assertEquals(403, service.create(adminDemonstration(), nextIdempotencyKey(), json.createObjectNode().put("legalName", "Blocked")).getStatusCode().value());
        owner.update("UPDATE manufacturer_onboarding_application SET state = 'revoked' WHERE id = ?", id);
        owner.update("UPDATE organisation SET permittee_lifecycle = 'none' WHERE id = ?", ONBOARD_ORG);
    }

    @Test
    void conflictingReplayLeavesNoAdditionalEvidence() {
        UUID id = draftApp();
        int v = readyToSubmit(id);
        String key = "0123456789abcdef012345a08";
        service.submit(onboardApplicant(), id, key, json.createObjectNode().put("version", v));
        int evidence = owner.queryForObject("SELECT count(*) FROM manufacturer_onboarding_command_evidence WHERE application_id = ?", Integer.class, id);
        var conflict = service.submit(onboardApplicant(), id, key, json.createObjectNode().put("version", v + 1));
        assertEquals(409, conflict.getStatusCode().value());
        assertEquals(evidence, owner.queryForObject("SELECT count(*) FROM manufacturer_onboarding_command_evidence WHERE application_id = ?", Integer.class, id));
        owner.update("UPDATE manufacturer_onboarding_application SET state = 'revoked' WHERE id = ?", id);
        owner.update("UPDATE organisation SET permittee_lifecycle = 'none' WHERE id = ?", ONBOARD_ORG);
    }

    @Test
    void guestSignupCreatesOwnDraftAndCleanupRemovesIt() {
        String email = "wp3d1+" + nextIdempotencyKey().substring(0, 12) + "@example.invalid";
        String mobile = "9" + nextIdempotencyKey().replaceAll("[^0-9]", "1").substring(0, 9);
        String key = "0123456789abcdef012345s01";
        String subject = UUID.randomUUID().toString();
        var payload = json.createObjectNode()
            .put("fullName", "Guest Applicant")
            .put("email", email)
            .put("mobile", mobile)
            .put("keycloakSubject", subject);
        var created = service.publicSignup(key, payload);
        assertEquals(201, created.getStatusCode().value());
        assertEquals("simulated", created.getBody().get("verification"));
        assertEquals(true, created.getBody().get("emailVerifiedSimulated"));
        assertEquals(true, created.getBody().get("mobileVerifiedSimulated"));
        UUID accountId = UUID.fromString((String) created.getBody().get("accountId"));
        UUID orgId = UUID.fromString((String) created.getBody().get("organisationId"));
        UUID appId = UUID.fromString((String) created.getBody().get("applicationId"));
        assertEquals(email, created.getBody().get("username"));
        assertEquals("draft", repo.find(appId).orElseThrow().state());
        assertEquals("none", owner.queryForObject("SELECT permittee_lifecycle FROM organisation WHERE id = ?", String.class, orgId));
        var same = service.publicSignup(key, payload.deepCopy());
        assertEquals(201, same.getStatusCode().value());
        assertEquals(appId.toString(), same.getBody().get("applicationId"));
        var conflict = service.publicSignup(key, json.createObjectNode()
            .put("fullName", "Changed Name").put("email", email).put("mobile", mobile).put("keycloakSubject", subject));
        assertEquals(409, conflict.getStatusCode().value());
        assertEquals("idempotency_key_conflict", conflict.getBody().get("error"));
        var duplicate = service.publicSignup(nextIdempotencyKey(), json.createObjectNode()
            .put("fullName", "Other Person").put("email", email).put("mobile", "8" + mobile.substring(1)));
        assertEquals(409, duplicate.getStatusCode().value());
        assertEquals("registration_not_available", duplicate.getBody().get("error"));
        assertEquals(1, maint.queryForObject("SELECT manufacturer_onboarding_maint_cleanup_public_signup(?)", Integer.class, accountId));
        assertEquals(0, owner.queryForObject("SELECT count(*) FROM user_account WHERE id = ?", Integer.class, accountId));
        assertEquals(1, owner.queryForObject("SELECT count(*) FROM user_account WHERE username = 'onboarding.applicant'", Integer.class));
    }

    @Test
    void directorRejectAndReturnLeaveManufacturerInactive() {
        UUID id = draftApp();
        int v = readyToSubmit(id);
        var submitted = service.submit(onboardApplicant(), id, nextIdempotencyKey(), json.createObjectNode().put("version", v));
        v = (int) submitted.getBody().get("version");
        var returned = service.directorDecision(director(), id, nextIdempotencyKey(),
            json.createObjectNode().put("version", v).put("decision", "return").put("note", "Add the factory licence page"));
        assertEquals("returned", returned.getBody().get("state"));
        assertEquals("none", owner.queryForObject("SELECT permittee_lifecycle FROM organisation WHERE id = ?", String.class, ONBOARD_ORG));
        v = repo.find(id).orElseThrow().version();
        applyCompleteDraft(id, v);
        v = repo.find(id).orElseThrow().version();
        var resubmitted = service.submit(onboardApplicant(), id, nextIdempotencyKey(), json.createObjectNode().put("version", v));
        assertEquals("director_review", resubmitted.getBody().get("state"));
        assertEquals(1, owner.queryForObject("SELECT count(*) FROM manufacturer_onboarding_payment_link WHERE application_id = ?", Integer.class, id));
        v = (int) resubmitted.getBody().get("version");
        var rejected = service.directorDecision(director(), id, nextIdempotencyKey(),
            json.createObjectNode().put("version", v).put("decision", "reject").put("note", "Material discrepancy in Annexure"));
        assertEquals("rejected", rejected.getBody().get("state"));
        assertNull(repo.find(id).orElseThrow().permitteeNumber());
        assertEquals("none", owner.queryForObject("SELECT permittee_lifecycle FROM organisation WHERE id = ?", String.class, ONBOARD_ORG));
        owner.update("UPDATE manufacturer_onboarding_application SET state = 'revoked' WHERE id = ?", id);
    }

    @Test
    void historicalAutomaticActivationEventsAreNotRewritten() {
        UUID id = draftApp();
        owner.update("""
            INSERT INTO manufacturer_onboarding_event (application_id, event_kind, from_state, to_state, actor_account_id, actor_role, detail)
            VALUES (?, 'automatic_activation', 'submitted', 'active_observation', ?, 'manufacturer', 'Historic V77 automatic activation')
            """, id, ONBOARD_USER);
        int historic = owner.queryForObject(
            "SELECT count(*) FROM manufacturer_onboarding_event WHERE application_id = ? AND event_kind = 'automatic_activation'",
            Integer.class, id);
        int v = readyToSubmit(id);
        service.submit(onboardApplicant(), id, nextIdempotencyKey(), json.createObjectNode().put("version", v));
        assertEquals(historic, owner.queryForObject(
            "SELECT count(*) FROM manufacturer_onboarding_event WHERE application_id = ? AND event_kind = 'automatic_activation' AND detail = 'Historic V77 automatic activation'",
            Integer.class, id));
        assertEquals("director_review", repo.find(id).orElseThrow().state());
        owner.update("UPDATE manufacturer_onboarding_application SET state = 'revoked' WHERE id = ?", id);
        owner.update("UPDATE organisation SET permittee_lifecycle = 'none' WHERE id = ?", ONBOARD_ORG);
    }
}
