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
 * Brand and agency registration, draft to fee due (WP04.2b-1), against throwaway PostgreSQL as the restricted runtime login: filing and
 * editing, the name and duplicate rules, the submit gates, the registration fee from the REG fee rules, idempotent replay, read scope,
 * append-only records and the registration types in the fee-rule decision function. The shared app schema is untouched.
 */
@Tag("db")
class RegistrationDatabaseTest {

    static final String TAG = HexFormat.of().toHexDigits(ThreadLocalRandom.current().nextInt());
    static final String MAIN = "wp042b_test_" + TAG;
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
    static final Caller ADMIN = new Caller(ADMIN_USER, "bee.admin", List.of(new RoleGrant("admin", "all")), Set.of(BEE_ORG));

    static final ObjectMapper JSON = new ObjectMapper();
    static JdbcTemplate admin;
    static JdbcTemplate owner;
    static JdbcTemplate db;
    static RegistrationService service;
    static RegistrationDocumentService documentService;
    static RegistrationFeeService feeService;
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
        documentService = new RegistrationDocumentService(registrationRepo, documentRepo, new RegistrationDocumentRecorder(documentRepo, idem),
            new gov.bee.api.document.LocalSha256FileStore(props), idem, JSON);
        assertEquals(71, owner.queryForObject("SELECT max(installed_rank) FROM flyway_schema_history", Integer.class), "migrated V1 through V71");
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

    static Map<String, Object> draftBrand(String name) {
        return ok(service.create(NOVA, key(), json("{\"brandName\":\"" + name + "\"}")), 201);
    }

    static void addLicence(Object applicationId) {
        UUID doc = UUID.randomUUID();
        owner.update("INSERT INTO registration_document (id, application_id, document_kind) VALUES (?, ?::uuid, 'trade_licence')", doc, applicationId.toString());
        owner.update("INSERT INTO registration_document_version (id, document_id, version_number, content_sha256, size_bytes, media_type, original_filename, label, "
            + "uploaded_by_account_id) VALUES (?, ?, 1, repeat('a', 64), 100, 'application/pdf', 'licence.pdf', 'Trade licence', ?)", UUID.randomUUID(), doc, NOVA_USER);
    }

    @Test
    void registrationFeesAreRegRulesAndRegIsNotAModelCategory() {
        assertEquals(2, owner.queryForObject("SELECT count(*) FROM master_fee_rule WHERE category_code = 'REG'", Integer.class));
        assertEquals(0, owner.queryForObject("SELECT count(*) FROM master_category WHERE rule_key = 'REG'", Integer.class));
        assertEquals(0, new java.math.BigDecimal("5000.00").compareTo(owner.queryForObject(
            "SELECT amount_inr FROM master_fee_rule WHERE rule_key = 'REG:brand_registration'", java.math.BigDecimal.class)));
    }

    @Test
    void aManufacturerFilesAndEditsABrandDraftAndTheNameRulesHold() {
        var created = draftBrand("Zephyr Cool");
        assertEquals("draft", created.get("state"));
        assertEquals("brand", created.get("kind"));
        assertEquals(0, created.get("version"));
        assertTrue(((String) created.get("reference")).startsWith("REG-" + TODAY.getYear() + "-"));
        assertFalse((Boolean) created.get("tradeLicenceUploaded"));

        refused(service.create(NOVA, key(), json("{\"brandName\":\"zephyr cool\"}")), 409, "duplicate_registration");
        refused(service.create(NOVA, key(), json("{\"brandName\":\"Nova Cool\"}")), 409, "brand_name_taken");
        refused(service.create(NOVA, key(), json("{\"brandName\":\"  \"}")), 422, "validation_failed");
        refused(service.create(NOVA, key(), json("{\"brandName\":\"Bad<script>\"}")), 422, "validation_failed");
        refused(service.create(NOVA, key(), json("{\"brandName\":\"X\",\"validFrom\":\"2030-01-01\"}")), 422, "validation_failed");
        refused(service.create(NOVA, null, json("{\"brandName\":\"No Key\"}")), 422, "idempotency_key_required");
        refused(service.create(ADMIN, key(), json("{\"brandName\":\"Admin Brand\"}")), 403, "no_write_scope");

        String id = (String) created.get("id");
        var edited = ok(service.patch(NOVA, UUID.fromString(id), key(), json("{\"version\":0,\"brandName\":\"Zephyr Air\"}")), 200);
        assertEquals("Zephyr Air", edited.get("brandName"));
        assertEquals(1, edited.get("version"));
        refused(service.patch(NOVA, UUID.fromString(id), key(), json("{\"version\":0,\"brandName\":\"Zephyr Stale\"}")), 409, "version_conflict");
        refused(service.patch(PIXEL, UUID.fromString(id), key(), json("{\"version\":1,\"brandId\":\"" + NOVA_COOL + "\"}")), 404, "not_found");
        // The name is free again for the same manufacturer once edited away.
        draftBrand("Zephyr Cool");
    }

    @Test
    void anAgencyAsksToActForAnActiveBrandAndOnlyOnce() {
        var eligible = ok(service.eligibleBrands(PIXEL), 200);
        assertTrue((Integer) eligible.get("count") >= 1);
        assertEquals(0, ((Number) ok(service.eligibleBrands(NOVA), 200).get("count")).intValue(), "a manufacturer names a new brand instead");

        String from = TODAY.plusDays(5).toString();
        var created = ok(service.create(PIXEL, key(), json("{\"brandId\":\"" + NOVA_COOL + "\",\"validFrom\":\"" + from + "\"}")), 201);
        assertEquals("agency", created.get("kind"));
        assertEquals("Nova Cool", created.get("brandName"));
        assertEquals(from, created.get("validFrom"));
        refused(service.create(PIXEL, key(), json("{\"brandId\":\"" + NOVA_COOL + "\"}")), 409, "duplicate_registration");
        refused(service.create(PIXEL, key(), json("{\"brandId\":\"" + UUID.randomUUID() + "\"}")), 422, "validation_failed");
        refused(service.create(PIXEL, key(), json("{\"brandName\":\"Own Brand\"}")), 422, "validation_failed");
        refused(service.create(PIXEL, key(), json("{\"brandId\":\"" + NOVA_COOL + "\",\"validTo\":\"2030-01-01\"}")), 422, "validation_failed");
    }

    @Test
    void submitNeedsTheLicenceThenTakesTheFeeFromTheRegRuleAndIsIdempotent() {
        var draft = draftBrand("Borealis Cool");
        UUID id = UUID.fromString((String) draft.get("id"));
        var preview = ok(service.preview(NOVA, id), 200);
        assertFalse((Boolean) preview.get("ready"));
        String body = "{\"version\":0,\"expectedFee\":{\"amountInr\":\"5000.00\",\"feeRuleKey\":\"REG:brand_registration\",\"feeRuleVersion\":1}}";

        refused(service.submit(NOVA, id, key(), json(body)), 422, "document_required");
        addLicence(id);
        preview = ok(service.preview(NOVA, id), 200);
        assertTrue((Boolean) preview.get("ready"));
        @SuppressWarnings("unchecked") Map<String, Object> shown = (Map<String, Object>) preview.get("submissionFee");
        assertEquals("5000.00", shown.get("amountInr"));
        assertEquals("REG:brand_registration", shown.get("feeRuleKey"));

        refused(service.submit(NOVA, id, key(), json(body.replace("5000.00", "1.00"))), 409, "fee_preview_conflict");
        refused(service.submit(NOVA, id, key(), json(body.replace("\"version\":0", "\"version\":7"))), 409, "version_conflict");
        refused(service.submit(PIXEL, id, key(), json(body)), 404, "not_found");

        String k = key();
        var done = ok(service.submit(NOVA, id, k, json(body)), 200);
        assertEquals("fee_due", done.get("state"));
        assertEquals(1, done.get("version"));
        @SuppressWarnings("unchecked") Map<String, Object> fee = (Map<String, Object>) done.get("submissionFee");
        assertEquals("5000.00", fee.get("amountInr"));
        assertEquals("5000.00", fee.get("totalInr"));
        assertEquals(1, owner.queryForObject("SELECT count(*) FROM registration_submission_event WHERE application_id = ?", Integer.class, id));
        assertEquals(1, owner.queryForObject("SELECT count(*) FROM registration_fee_snapshot WHERE application_id = ?", Integer.class, id));

        var replay = service.submit(NOVA, id, k, json(body));
        assertEquals(200, replay.getStatusCode().value());
        assertEquals("true", replay.getHeaders().getFirst("Idempotency-Replayed"));
        assertEquals(1, owner.queryForObject("SELECT count(*) FROM registration_submission_event WHERE application_id = ?", Integer.class, id));
        refused(service.submit(NOVA, id, k, json(body.replace("5000.00", "6000.00"))), 409, "idempotency_key_conflict");
        refused(service.submit(NOVA, id, key(), json(body.replace("\"version\":0", "\"version\":1"))), 403, "not_submittable");
        refused(service.patch(NOVA, id, key(), json("{\"version\":1,\"brandName\":\"Borealis Air\"}")), 403, "not_editable");
    }

    @Test
    void anAgencyRequestNeedsAFutureStartDateToSubmit() {
        UUID novaAir = UUID.randomUUID();
        owner.update("INSERT INTO brand (id, name, owner_organisation_id, status, source_reference, verification_status, note) VALUES "
            + "(?, 'Nova Air', ?, 'active', 'test', 'synthetic', 'probe')", novaAir, NOVA_ORG);
        var created = ok(service.create(PIXEL, key(), json("{\"brandId\":\"" + novaAir + "\"}")), 201);
        UUID id = UUID.fromString((String) created.get("id"));
        addLicence(id);
        String body = "{\"version\":0,\"expectedFee\":{\"amountInr\":\"3000.00\",\"feeRuleKey\":\"REG:agency_registration\",\"feeRuleVersion\":1}}";
        refused(service.submit(PIXEL, id, key(), json(body)), 422, "validation_failed");
        var edited = ok(service.patch(PIXEL, id, key(), json("{\"version\":0,\"brandId\":\"" + novaAir + "\",\"validFrom\":\"" + TODAY + "\"}")), 200);
        assertEquals(1, edited.get("version"));
        var done = ok(service.submit(PIXEL, id, key(), json(body.replace("\"version\":0", "\"version\":1"))), 200);
        assertEquals("fee_due", done.get("state"));
    }

    @Test
    void whoReadsWhat() {
        var draft = draftBrand("Cirrus Cool");
        UUID id = UUID.fromString((String) draft.get("id"));
        ok(service.get(NOVA, id), 200);
        refused(service.get(PIXEL, id), 404, "not_found");
        refused(service.get(FINANCE, id), 404, "not_found");
        refused(service.get(ADMIN, id), 403, "no_read_scope");
        addLicence(id);
        ok(service.submit(NOVA, id, key(), json("{\"version\":0,\"expectedFee\":{\"amountInr\":\"5000.00\",\"feeRuleKey\":\"REG:brand_registration\",\"feeRuleVersion\":1}}")), 200);
        ok(service.get(FINANCE, id), 200);
        refused(service.get(PROGRAMME, id), 404, "not_found");
        @SuppressWarnings("unchecked") List<Map<String, Object>> financeItems = (List<Map<String, Object>>) ok(service.list(FINANCE), 200).get("items");
        assertTrue(financeItems.stream().allMatch(m -> "fee_due".equals(m.get("state"))));
        assertTrue(financeItems.stream().anyMatch(m -> id.toString().equals(m.get("id"))));
        refused(service.get(NOVA, UUID.randomUUID()), 404, "not_found");
    }

    @Test
    void recordsAreAppendOnlyOwnedByTheRightKindOfOrganisationAndNotDeletable() {
        var draft = draftBrand("Dune Cool");
        UUID id = UUID.fromString((String) draft.get("id"));
        addLicence(id);
        ok(service.submit(NOVA, id, key(), json("{\"version\":0,\"expectedFee\":{\"amountInr\":\"5000.00\",\"feeRuleKey\":\"REG:brand_registration\",\"feeRuleVersion\":1}}")), 200);
        assertThrows(DataAccessException.class, () -> owner.update("UPDATE registration_fee_snapshot SET amount_inr = 1 WHERE application_id = ?", id));
        assertThrows(DataAccessException.class, () -> owner.update("DELETE FROM registration_submission_event WHERE application_id = ?", id));
        assertThrows(DataAccessException.class, () -> db.update("DELETE FROM registration_application WHERE id = ?", id));
        assertThrows(DataAccessException.class, () -> db.update("UPDATE registration_fee_snapshot SET amount_inr = 1 WHERE application_id = ?", id));
        // A brand is registered by a manufacturer and an agency request is filed by an agency.
        assertThrows(DataAccessException.class, () -> owner.update("INSERT INTO registration_application (reference, kind, organisation_id, brand_name) "
            + "VALUES ('REG-X-1', 'brand', ?, 'Wrong Kind')", PIXEL_ORG));
        assertThrows(DataAccessException.class, () -> owner.update("INSERT INTO registration_application (reference, kind, organisation_id, brand_name, brand_id, "
            + "principal_organisation_id) VALUES ('REG-X-2', 'agency', ?, 'Nova Cool', ?, ?)", NOVA_ORG, NOVA_COOL, NOVA_ORG));
        assertNotNull(owner.queryForObject("SELECT id FROM registration_application WHERE id = ?", UUID.class, id));
    }

    @Test
    void theTwoPersonFeeRuleDecisionAcceptsARegistrationFee() {
        owner.update("INSERT INTO capability_grant (capability, role) VALUES ('fee_rule_manage', 'finance') ON CONFLICT DO NOTHING");
        try {
            LocalDate from = TODAY.plusDays(30);
            UUID proposal = owner.queryForObject("INSERT INTO fee_rule_proposal (category_code, application_type, amount_inr, tax_rate_percent, effective_from, "
                + "source_reference, reason, proposed_by) VALUES ('REG', 'brand_registration', 6000, 18, ?, 'Test source', 'Test reason', ?) RETURNING id",
                UUID.class, from, ADMIN_USER);
            var out = owner.queryForMap("SELECT * FROM fee_rule_decide(?, ?, 'approve', 'ok')", proposal, FINANCE_USER);
            assertEquals("approved", out.get("out_state"));
            assertEquals("REG:brand_registration", out.get("out_key"));
            assertEquals(2, out.get("out_version"));
            assertEquals(0, new java.math.BigDecimal("6000").compareTo(owner.queryForObject(
                "SELECT amount_inr FROM master_fee_rule WHERE rule_key = 'REG:brand_registration' AND version = 2", java.math.BigDecimal.class)));
            // A model category that does not exist is still refused, as before.
            UUID bad = owner.queryForObject("INSERT INTO fee_rule_proposal (category_code, application_type, amount_inr, tax_rate_percent, effective_from, "
                + "source_reference, reason, proposed_by) VALUES ('ZZZ', 'new_model', 100, 0, ?, 'Test source', 'Test reason', ?) RETURNING id",
                UUID.class, from, ADMIN_USER);
            assertEquals("rule_conflict", owner.queryForMap("SELECT * FROM fee_rule_decide(?, ?, 'approve', 'no')", bad, FINANCE_USER).get("out_state"));
        } finally {
            owner.update("DELETE FROM capability_grant WHERE capability = 'fee_rule_manage' AND role = 'finance'");
        }
    }

    static org.springframework.mock.web.MockMultipartFile pdf(String name, String body) {
        return new org.springframework.mock.web.MockMultipartFile("file", name, "application/pdf",
            ("%PDF-1.4\n" + body).getBytes(java.nio.charset.StandardCharsets.UTF_8));
    }

    @Test
    void theTradeLicenceIsAPdfThatGatesTheSubmitAndFreezesWithTheDraft() throws Exception {
        var draft = draftBrand("Eclipse Cool");
        UUID id = UUID.fromString((String) draft.get("id"));
        String k = key();
        var first = ok(documentService.upload(NOVA, id, k, pdf("licence.pdf", "one"), null), 201);
        assertEquals("trade_licence", first.get("documentKind"));
        assertEquals("pending_local_verification", first.get("verificationStatus"));
        @SuppressWarnings("unchecked") Map<String, Object> latest = (Map<String, Object>) first.get("latestVersion");
        assertEquals(1, latest.get("versionNumber"));
        assertEquals("Trade licence", latest.get("label"));
        assertEquals(64, ((String) latest.get("contentSha256")).length());

        var replay = documentService.upload(NOVA, id, k, pdf("licence.pdf", "one"), null);
        assertEquals("true", replay.getHeaders().getFirst("Idempotency-Replayed"));
        refused(documentService.upload(NOVA, id, k, pdf("licence.pdf", "different"), null), 409, "idempotency_key_conflict");

        // A second upload is version 2 of the same document; the first is kept.
        var second = ok(documentService.upload(NOVA, id, key(), pdf("renewed.pdf", "two"), "Renewed licence"), 201);
        @SuppressWarnings("unchecked") List<Map<String, Object>> versions = (List<Map<String, Object>>) second.get("versions");
        assertEquals(2, versions.size());
        assertEquals(1, owner.queryForObject("SELECT count(*) FROM registration_document WHERE application_id = ?", Integer.class, id));
        assertEquals(2, owner.queryForObject("SELECT count(*) FROM registration_document_version", Integer.class)
            - owner.queryForObject("SELECT count(*) FROM registration_document_version v JOIN registration_document d ON d.id = v.document_id WHERE d.application_id <> ?",
                Integer.class, id));
        assertTrue((Boolean) ok(service.get(NOVA, id), 200).get("tradeLicenceUploaded"));

        // Only a PDF, only with a file, only by the owner, and not from a stranger or a reviewer.
        refused(documentService.upload(NOVA, id, key(), new org.springframework.mock.web.MockMultipartFile("file", "x.pdf", "application/pdf", "not a pdf".getBytes()), null), 422, "validation_failed");
        refused(documentService.upload(NOVA, id, key(), null, null), 422, "validation_failed");
        refused(documentService.upload(NOVA, id, null, pdf("a.pdf", "k"), null), 422, "idempotency_key_required");
        refused(documentService.upload(PIXEL, id, key(), pdf("a.pdf", "k"), null), 404, "not_found");
        refused(documentService.upload(FINANCE, id, key(), pdf("a.pdf", "k"), null), 403, "no_write_scope");

        // Read: the owner lists and downloads; a stranger does not; Finance may once it is fee due.
        @SuppressWarnings("unchecked") List<Map<String, Object>> items = (List<Map<String, Object>>) ok(documentService.list(NOVA, id), 200).get("items");
        assertEquals(1, items.size());
        refused(documentService.list(PIXEL, id), 404, "not_found");
        refused(documentService.list(FINANCE, id), 404, "not_found");
        UUID docId = UUID.fromString((String) items.get(0).get("id"));
        @SuppressWarnings("unchecked") List<Map<String, Object>> vs = (List<Map<String, Object>>) items.get(0).get("versions");
        UUID versionId = UUID.fromString((String) vs.get(0).get("id"));
        var bytes = documentService.content(NOVA, id, docId, versionId);
        assertEquals(200, bytes.getStatusCode().value());
        assertTrue(new String((byte[]) bytes.getBody(), java.nio.charset.StandardCharsets.UTF_8).startsWith("%PDF-"));
        assertEquals(404, documentService.content(NOVA, id, docId, UUID.randomUUID()).getStatusCode().value());
        assertEquals(404, documentService.content(PIXEL, id, docId, versionId).getStatusCode().value());

        // Submitting freezes the documents with the draft.
        ok(service.submit(NOVA, id, key(), json("{\"version\":0,\"expectedFee\":{\"amountInr\":\"5000.00\",\"feeRuleKey\":\"REG:brand_registration\",\"feeRuleVersion\":1}}")), 200);
        refused(documentService.upload(NOVA, id, key(), pdf("late.pdf", "late"), null), 403, "not_editable");
        assertEquals(200, documentService.list(FINANCE, id).getStatusCode().value());
    }

    @Test
    void financeConfirmsTheRegistrationFeeUnderTheModelFeeRules() {
        var draft = draftBrand("Fathom Cool");
        UUID id = UUID.fromString((String) draft.get("id"));
        addLicence(id);
        ok(service.submit(NOVA, id, key(), json("{\"version\":0,\"expectedFee\":{\"amountInr\":\"5000.00\",\"feeRuleKey\":\"REG:brand_registration\",\"feeRuleVersion\":1}}")), 200);
        String body = "{\"version\":1,\"receiptReference\":\"RCPT-2026-001\",\"receivedOn\":\"" + TODAY + "\",\"amountInr\":\"5000.00\"}";

        refused(feeService.confirm(NOVA, id, key(), json(body)), 403, "role_not_permitted");
        refused(feeService.confirm(PROGRAMME, id, key(), json(body)), 403, "role_not_permitted");
        refused(feeService.confirm(FINANCE, id, null, json(body)), 422, "idempotency_key_required");
        // The payer's own organisation and the person who submitted cannot confirm, whatever role they hold.
        var payerFinance = new Caller(FINANCE_USER, "bee.finance", List.of(new RoleGrant("finance", "all")), Set.of(NOVA_ORG));
        refused(feeService.confirm(payerFinance, id, key(), json(body)), 403, "segregation_refused");
        var submitterFinance = new Caller(NOVA_USER, "nova.applicant", List.of(new RoleGrant("finance", "all")), Set.of(BEE_ORG));
        refused(feeService.confirm(submitterFinance, id, key(), json(body)), 403, "segregation_refused");

        refused(feeService.confirm(FINANCE, id, key(), json(body.replace("5000.00", "4999.00"))), 422, "amount_mismatch");
        refused(feeService.confirm(FINANCE, id, key(), json(body.replace(TODAY.toString(), TODAY.plusDays(1).toString()))), 422, "validation_failed");
        refused(feeService.confirm(FINANCE, id, key(), json(body.replace("RCPT-2026-001", "bad<receipt"))), 422, "validation_failed");
        refused(feeService.confirm(FINANCE, id, key(), json(body.replace("\"version\":1", "\"version\":0"))), 409, "version_conflict");
        refused(feeService.confirm(FINANCE, UUID.randomUUID(), key(), json(body)), 404, "not_found");

        String k = key();
        var receipt = ok(feeService.confirm(FINANCE, id, k, json(body)), 200);
        assertEquals("programme_review", receipt.get("toState"));
        assertEquals(2, receipt.get("version"));
        assertEquals("RCPT-2026-001", receipt.get("receiptReference"));
        assertEquals("programme_review", ok(service.get(PROGRAMME, id), 200).get("state"));
        refused(service.get(FINANCE, id), 404, "not_found");
        assertEquals(1, owner.queryForObject("SELECT count(*) FROM registration_fee_confirmation WHERE application_id = ?", Integer.class, id));
        assertEquals(1, owner.queryForObject("SELECT count(*) FROM registration_transition_event WHERE application_id = ? AND action = 'confirm_fee'", Integer.class, id));

        var replay = feeService.confirm(FINANCE, id, k, json(body));
        assertEquals("true", replay.getHeaders().getFirst("Idempotency-Replayed"));
        refused(feeService.confirm(FINANCE, id, k, json(body.replace("5000.00", "5000.01"))), 409, "idempotency_key_conflict");
        refused(feeService.confirm(FINANCE, id, key(), json(body.replace("\"version\":1", "\"version\":2"))), 404, "not_found");
        assertThrows(DataAccessException.class, () -> db.update("UPDATE registration_fee_confirmation SET amount_inr = 1 WHERE application_id = ?", id));
    }

    @Test
    void aReplayedCreateIsRefusedOnceTheCallerCanNoLongerFile() {
        String k = key();
        var created = ok(service.create(NOVA, k, json("{\"brandName\":\"Gale Cool\"}")), 201);
        assertEquals("Gale Cool", created.get("brandName"));
        assertEquals("true", service.create(NOVA, k, json("{\"brandName\":\"Gale Cool\"}")).getHeaders().getFirst("Idempotency-Replayed"));
        var lostRole = new Caller(NOVA_USER, "nova.applicant", List.of(), Set.of(NOVA_ORG));
        refused(service.create(lostRole, k, json("{\"brandName\":\"Gale Cool\"}")), 403, "no_write_scope");
    }

    @Test
    void textFieldsMustBeText() {
        refused(service.create(NOVA, key(), json("{\"brandName\":12345}")), 422, "validation_failed");
        refused(service.create(NOVA, key(), json("{\"brandName\":[\"x\"]}")), 422, "validation_failed");
        refused(service.create(PIXEL, key(), json("{\"brandId\":12345}")), 422, "validation_failed");
        refused(service.create(PIXEL, key(), json("{\"brandId\":\"" + NOVA_COOL + "\",\"validFrom\":20261201}")), 422, "validation_failed");
    }

    @Test
    void twoFilingsOfOneNameAtOnceGiveOneCreatedAndOneConflict() throws Exception {
        var tx = new org.springframework.transaction.support.TransactionTemplate(
            new org.springframework.jdbc.datasource.DataSourceTransactionManager(db.getDataSource()));
        var barrier = new java.util.concurrent.CyclicBarrier(2);
        var pool = java.util.concurrent.Executors.newFixedThreadPool(2);
        try {
            java.util.concurrent.Callable<Integer> filing = () -> {
                barrier.await();
                return tx.execute(st -> service.create(NOVA, key(), json("{\"brandName\":\"Squall Cool\"}")).getStatusCode().value());
            };
            var a = pool.submit(filing);
            var b = pool.submit(filing);
            var codes = new java.util.TreeSet<>(List.of(a.get(30, java.util.concurrent.TimeUnit.SECONDS), b.get(30, java.util.concurrent.TimeUnit.SECONDS)));
            assertEquals(new java.util.TreeSet<>(List.of(201, 409)), codes);
        } finally {
            pool.shutdownNow();
        }
    }
}
