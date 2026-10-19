package gov.bee.api.registration;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import gov.bee.api.administration.AdminDemonstrationAccess;
import gov.bee.api.application.DraftRequestSupport;
import gov.bee.api.application.IdempotencyRepository;
import gov.bee.api.application.ModelDraftPolicy;
import gov.bee.api.identity.Caller;
import gov.bee.api.masters.MasterDataRepository;
import gov.bee.api.masters.Masters.FeeRule;
import gov.bee.api.masters.MasterVersion;
import gov.bee.api.web.ApiErrors;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.regex.Pattern;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP04.2b-1: file, edit and submit a brand or agency registration request, up to fee due. Provisional local rules, not BEE rules
 * (docs/wp04/WP04.2b_PLAN.md). Review, approval and the write into brand / agency_authorisation are WP04.2b-2.
 */
@Service
public class RegistrationService {

    static final String ROUTE_CREATE = "/api/registrations";
    static final String ROUTE_PATCH = "/api/registrations/{id}";
    static final String ROUTE_SUBMIT = "/api/registrations/{id}/submit";
    static final String FEE_CATEGORY = "REG";
    private static final UUID NIL = IdempotencyRepository.CREATE_TARGET;
    private static final Pattern BRAND_NAME = Pattern.compile("^[\\p{L}\\p{N}][\\p{L}\\p{N} .&'()/_-]{0,119}$");
    private static final String NOTE = "Provisional local rule, not a BEE rule: one trade-licence PDF and a fee from the registration fee rule.";

    private final RegistrationRepository registrations;
    private final MasterDataRepository masters;
    private final IdempotencyRepository idempotency;
    private final ObjectMapper json;

    public RegistrationService(RegistrationRepository registrations, MasterDataRepository masters, IdempotencyRepository idempotency,
                               ObjectMapper json) {
        this.registrations = registrations;
        this.masters = masters;
        this.idempotency = idempotency;
        this.json = json;
    }

    // ---- reads

    public ResponseEntity<Map<String, Object>> list(Caller caller) {
        var scope = RegistrationPolicy.readScope(caller);
        if (scope.isEmpty()) {
            return error(HttpStatus.FORBIDDEN, "no_read_scope");
        }
        List<Map<String, Object>> items = new ArrayList<>();
        for (var r : registrations.list(scope.organisations(), scope.stages(), scope.allRecords())) {
            if (scope.canRead(r)) {
                items.add(view(r, registrations.feeSnapshot(r.id()).orElse(null), registrations.documentCount(r.id())));
            }
        }
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("items", items);
        body.put("count", items.size());
        body.put("authority", "spring-database");
        return ResponseEntity.ok(body);
    }

    public ResponseEntity<Map<String, Object>> get(Caller caller, UUID id) {
        var scope = RegistrationPolicy.readScope(caller);
        Optional<RegistrationRepository.Row> row = scope.isEmpty() ? Optional.empty() : registrations.find(id).filter(scope::canRead);
        if (row.isEmpty()) {
            return error(scope.isEmpty() ? HttpStatus.FORBIDDEN : HttpStatus.NOT_FOUND, scope.isEmpty() ? "no_read_scope" : "not_found");
        }
        Map<String, Object> view = view(row.get(), registrations.feeSnapshot(id).orElse(null), registrations.documentCount(id));
        registrations.registerEntry(id).ifPresent(e -> {
            if (e.brandId() != null) {
                view.put("registeredBrandId", e.brandId().toString());
            }
            if (e.authorisationId() != null) {
                view.put("registeredAuthorisationId", e.authorisationId().toString());
            }
        });
        // The applicant reads what was decided and why; the recommendation and the fee step are for the reviewers.
        boolean applicantOnly = caller.organisationIds().contains(row.get().organisationId());
        List<Map<String, Object>> trail = new ArrayList<>();
        for (var t : registrations.trail(id)) {
            if (applicantOnly && !java.util.Set.of("return", "reject", "approve", "resubmit").contains(t.action())) {
                continue;
            }
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("action", t.action());
            m.put("actorRole", t.actorRole());
            m.put("fromState", t.fromState());
            m.put("toState", t.toState());
            if (t.note() != null) {
                m.put("note", t.note());
            }
            m.put("at", t.at().toString());
            trail.add(m);
        }
        view.put("trail", trail);
        return ResponseEntity.ok(view);
    }

    /** The brands an agency can ask to represent. A manufacturer has none to choose: it names a new brand. */
    public ResponseEntity<Map<String, Object>> eligibleBrands(Caller caller) {
        if (RegistrationPolicy.kindFor(caller).isEmpty()) {
            return error(HttpStatus.FORBIDDEN, "no_write_scope");
        }
        List<Map<String, Object>> items = new ArrayList<>();
        if (RegistrationPolicy.AGENCY.equals(RegistrationPolicy.kindFor(caller).get())) {
            for (var b : registrations.activeBrands()) {
                Map<String, Object> m = new LinkedHashMap<>();
                m.put("brandId", b.id().toString());
                m.put("brandName", b.name());
                m.put("principalOrganisation", b.ownerCode());
                items.add(m);
            }
        }
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("items", items);
        body.put("count", items.size());
        body.put("authority", "spring-database");
        return ResponseEntity.ok(body);
    }

    public ResponseEntity<Map<String, Object>> preview(Caller caller, UUID id) {
        Optional<UUID> filing = RegistrationPolicy.filingOrganisation(caller);
        if (filing.isEmpty()) {
            return error(HttpStatus.FORBIDDEN, "no_write_scope");
        }
        var row = registrations.findOwned(id, filing.get());
        if (row.isEmpty()) {
            return error(HttpStatus.NOT_FOUND, "not_found");
        }
        if (!"draft".equals(row.get().state())) {
            return error(HttpStatus.FORBIDDEN, "not_submittable");
        }
        LocalDate today = LocalDate.now(ModelDraftPolicy.IST);
        Optional<FeeRule> fee = feeFor(row.get(), today);
        Map<String, Object> m = new LinkedHashMap<>();
        List<Map<String, Object>> gates = gates(row.get(), today);
        boolean met = gates.stream().allMatch(g -> Boolean.TRUE.equals(g.get("met")));
        m.put("ready", met && fee.isPresent());
        m.put("version", row.get().version());
        m.put("intakeNote", NOTE);
        m.put("gates", gates);
        fee.ifPresent(f -> m.put("submissionFee", feeView(f)));
        return ResponseEntity.ok(m);
    }

    // ---- writes

    @Transactional
    public ResponseEntity<Map<String, Object>> create(Caller caller, String key, JsonNode body) {
        if (AdminDemonstrationAccess.deniesOperationalMutation(caller)) {
            return error(HttpStatus.FORBIDDEN, "role_not_permitted");
        }
        Optional<ResponseEntity<Map<String, Object>>> replay = replayOrRequireKey(caller, "POST", ROUTE_CREATE, NIL, key, body);
        if (replay.isPresent()) {
            return replay.get();
        }
        Optional<String> kind = RegistrationPolicy.kindFor(caller);
        if (kind.isEmpty()) {
            return error(HttpStatus.FORBIDDEN, "no_write_scope");
        }
        if (!idempotency.begin(caller.accountId(), "POST", ROUTE_CREATE, NIL, key, DraftRequestSupport.bodyHash(body))) {
            return error(HttpStatus.CONFLICT, "idempotency_in_progress");
        }
        Optional<Fields> f = parse(kind.get(), body);
        if (f.isEmpty()) {
            return fail(caller, "POST", ROUTE_CREATE, NIL, key, HttpStatus.UNPROCESSABLE_ENTITY, "validation_failed");
        }
        UUID filing = RegistrationPolicy.filingOrganisation(caller).orElseThrow();
        Optional<ResponseEntity<Map<String, Object>>> refused = refuse(kind.get(), f.get(), filing, null);
        if (refused.isPresent()) {
            return fail(caller, "POST", ROUTE_CREATE, NIL, key, refused.get());
        }
        UUID id = UUID.randomUUID();
        String reference = registrations.nextReference(LocalDate.now(ModelDraftPolicy.IST).getYear());
        var row = registrations.insertDraft(id, reference, kind.get(), filing, f.get().principal(), f.get().brandId(), f.get().brandName(),
            f.get().validFrom(), f.get().validTo());
        Map<String, Object> view = view(row, null, 0);
        idempotency.complete(caller.accountId(), "POST", ROUTE_CREATE, NIL, key, 201, write(view), row.version());
        return ResponseEntity.status(201).body(view);
    }

    @Transactional
    public ResponseEntity<Map<String, Object>> patch(Caller caller, UUID id, String key, JsonNode body) {
        if (AdminDemonstrationAccess.deniesOperationalMutation(caller)) {
            return error(HttpStatus.FORBIDDEN, "role_not_permitted");
        }
        Optional<ResponseEntity<Map<String, Object>>> replay = replayOrRequireKey(caller, "PATCH", ROUTE_PATCH, id, key, body);
        if (replay.isPresent()) {
            return replay.get();
        }
        Optional<String> kind = RegistrationPolicy.kindFor(caller);
        if (kind.isEmpty()) {
            return error(HttpStatus.FORBIDDEN, "no_write_scope");
        }
        if (!idempotency.begin(caller.accountId(), "PATCH", ROUTE_PATCH, id, key, DraftRequestSupport.bodyHash(body))) {
            return error(HttpStatus.CONFLICT, "idempotency_in_progress");
        }
        UUID filing = RegistrationPolicy.filingOrganisation(caller).orElseThrow();
        Optional<Fields> f = parse(kind.get(), body);
        Optional<Integer> version = version(body);
        if (f.isEmpty() || version.isEmpty()) {
            return fail(caller, "PATCH", ROUTE_PATCH, id, key, HttpStatus.UNPROCESSABLE_ENTITY, "validation_failed");
        }
        var existing = registrations.findOwned(id, filing);
        if (existing.isEmpty()) {
            return fail(caller, "PATCH", ROUTE_PATCH, id, key, HttpStatus.NOT_FOUND, "not_found");
        }
        if (!RegistrationPolicy.editable(existing.get().state())) {
            return fail(caller, "PATCH", ROUTE_PATCH, id, key, HttpStatus.FORBIDDEN, "not_editable");
        }
        if (existing.get().version() != version.get()) {
            return fail(caller, "PATCH", ROUTE_PATCH, id, key, HttpStatus.CONFLICT, "version_conflict");
        }
        Optional<ResponseEntity<Map<String, Object>>> refused = refuse(kind.get(), f.get(), filing, id);
        if (refused.isPresent()) {
            return fail(caller, "PATCH", ROUTE_PATCH, id, key, refused.get());
        }
        var saved = registrations.updateDraft(id, filing, version.get(), f.get().principal(), f.get().brandId(), f.get().brandName(),
            f.get().validFrom(), f.get().validTo());
        if (saved.isEmpty()) {
            return fail(caller, "PATCH", ROUTE_PATCH, id, key, HttpStatus.CONFLICT, "version_conflict");
        }
        Map<String, Object> view = view(saved.get(), null, registrations.documentCount(id));
        idempotency.complete(caller.accountId(), "PATCH", ROUTE_PATCH, id, key, 200, write(view), saved.get().version());
        return ResponseEntity.ok(view);
    }

    @Transactional
    public ResponseEntity<Map<String, Object>> submit(Caller caller, UUID id, String key, JsonNode body) {
        if (AdminDemonstrationAccess.deniesOperationalMutation(caller)) {
            return error(HttpStatus.FORBIDDEN, "role_not_permitted");
        }
        LocalDate today = LocalDate.now(ModelDraftPolicy.IST);
        Optional<ResponseEntity<Map<String, Object>>> replay = replayOrRequireKey(caller, "POST", ROUTE_SUBMIT, id, key, body);
        if (replay.isPresent()) {
            return replay.get();
        }
        Optional<String> kind = RegistrationPolicy.kindFor(caller);
        if (kind.isEmpty()) {
            return error(HttpStatus.FORBIDDEN, "no_write_scope");
        }
        if (!idempotency.begin(caller.accountId(), "POST", ROUTE_SUBMIT, id, key, DraftRequestSupport.bodyHash(body))) {
            return error(HttpStatus.CONFLICT, "idempotency_in_progress");
        }
        UUID filing = RegistrationPolicy.filingOrganisation(caller).orElseThrow();
        Optional<Integer> version = version(body);
        Optional<ExpectedFee> expected = expectedFee(body);
        if (version.isEmpty() || expected.isEmpty()) {
            return fail(caller, "POST", ROUTE_SUBMIT, id, key, HttpStatus.UNPROCESSABLE_ENTITY, "validation_failed");
        }
        var existing = registrations.findOwned(id, filing);
        if (existing.isEmpty()) {
            return fail(caller, "POST", ROUTE_SUBMIT, id, key, HttpStatus.NOT_FOUND, "not_found");
        }
        var row = existing.get();
        if (!"draft".equals(row.state())) {
            return fail(caller, "POST", ROUTE_SUBMIT, id, key, HttpStatus.FORBIDDEN, "not_submittable");
        }
        if (row.version() != version.get()) {
            return fail(caller, "POST", ROUTE_SUBMIT, id, key, HttpStatus.CONFLICT, "version_conflict");
        }
        Optional<ResponseEntity<Map<String, Object>>> refused = refuseAtSubmit(row, today);
        if (refused.isPresent()) {
            return fail(caller, "POST", ROUTE_SUBMIT, id, key, refused.get());
        }
        Optional<FeeRule> fee = feeFor(row, today);
        if (fee.isEmpty()) {
            return fail(caller, "POST", ROUTE_SUBMIT, id, key, HttpStatus.UNPROCESSABLE_ENTITY, "rule_not_available");
        }
        MasterVersion fv = fee.get().version();
        if (!fee.get().amountInr().toPlainString().equals(expected.get().amountInr()) || !fv.ruleKey().equals(expected.get().feeRuleKey())
            || fv.version() != expected.get().feeRuleVersion()) {
            return fail(caller, "POST", ROUTE_SUBMIT, id, key, HttpStatus.CONFLICT, "fee_preview_conflict");
        }
        var done = registrations.submit(id, filing, version.get(), caller.accountId(), RegistrationPolicy.kindFor(caller).orElseThrow().equals("brand")
            ? "manufacturer" : "agency", fee.get().amountInr(), fee.get().taxRatePercent(), fv.ruleKey(), fv.version(),
            fv.verification().name().toLowerCase(), fv.sourceReference(), fv.note());
        if (done.isEmpty()) {
            return fail(caller, "POST", ROUTE_SUBMIT, id, key, HttpStatus.CONFLICT, "version_conflict");
        }
        Map<String, Object> view = view(done.get().application(), done.get().fee(), registrations.documentCount(id));
        idempotency.complete(caller.accountId(), "POST", ROUTE_SUBMIT, id, key, 200, write(view), done.get().application().version());
        return ResponseEntity.ok(view);
    }

    // ---- rules

    private record Fields(UUID principal, UUID brandId, String brandName, LocalDate validFrom, LocalDate validTo) {
    }

    private Optional<Fields> parse(String kind, JsonNode body) {
        if (body == null || !body.isObject()) {
            return Optional.empty();
        }
        try {
            if (RegistrationPolicy.BRAND.equals(kind)) {
                if (!body.hasNonNull("brandName") || !body.get("brandName").isTextual() || body.hasNonNull("brandId") || body.hasNonNull("validFrom") || body.hasNonNull("validTo")) {
                    return Optional.empty();
                }
                String name = DraftRequestSupport.trim(body.get("brandName").asText());
                return BRAND_NAME.matcher(name).matches() ? Optional.of(new Fields(null, null, name, null, null)) : Optional.empty();
            }
            if (!body.hasNonNull("brandId") || !body.get("brandId").isTextual() || body.hasNonNull("brandName")) {
                return Optional.empty();
            }
            UUID brandId = UUID.fromString(body.get("brandId").asText());
            var brand = registrations.activeBrand(brandId);
            if (brand.isEmpty()) {
                return Optional.empty();
            }
            LocalDate from = date(body, "validFrom");
            LocalDate to = date(body, "validTo");
            if (to != null && (from == null || !to.isAfter(from))) {
                return Optional.empty();
            }
            return Optional.of(new Fields(brand.get().ownerOrganisationId(), brandId, brand.get().name(), from, to));
        } catch (IllegalArgumentException | DateTimeParseException e) {
            return Optional.empty();
        }
    }

    private static LocalDate date(JsonNode body, String name) {
        if (!body.hasNonNull(name)) {
            return null;
        }
        if (!body.get(name).isTextual()) {
            throw new IllegalArgumentException(name);
        }
        String s = body.get(name).asText();
        if (!s.matches("^\\d{4}-\\d{2}-\\d{2}$")) {
            throw new IllegalArgumentException(name);
        }
        return LocalDate.parse(s);
    }

    private static Optional<Integer> version(JsonNode body) {
        return body != null && body.has("version") && body.get("version").isInt() && body.get("version").asInt() >= 0
            ? Optional.of(body.get("version").asInt()) : Optional.empty();
    }

    /** Refusals that depend on other records: a name already on the register, or a live request already filed. */
    private Optional<ResponseEntity<Map<String, Object>>> refuse(String kind, Fields f, UUID filing, UUID except) {
        // Two filings of one name or brand by one organisation queue here, so the second sees the first's row and gets the 409
        // instead of a unique-index violation.
        registrations.lockRequestKey(filing + ":" + (RegistrationPolicy.BRAND.equals(kind) ? f.brandName().toLowerCase() : String.valueOf(f.brandId())));
        if (RegistrationPolicy.BRAND.equals(kind)) {
            if (registrations.brandNameTaken(f.brandName())) {
                return Optional.of(error(HttpStatus.CONFLICT, "brand_name_taken"));
            }
            if (registrations.liveBrandRequest(filing, f.brandName(), except)) {
                return Optional.of(error(HttpStatus.CONFLICT, "duplicate_registration"));
            }
        } else if (registrations.liveAgencyRequest(filing, f.brandId(), except)) {
            return Optional.of(error(HttpStatus.CONFLICT, "duplicate_registration"));
        }
        return Optional.empty();
    }

    /** The checks a request must pass to leave draft; the preview lists the same ones. */
    private List<Map<String, Object>> gates(RegistrationRepository.Row r, LocalDate today) {
        List<Map<String, Object>> gates = new ArrayList<>();
        gates.add(gate("trade_licence_uploaded", registrations.documentCount(r.id()) > 0));
        if (RegistrationPolicy.AGENCY.equals(r.kind())) {
            gates.add(gate("start_date_set", r.validFrom() != null && !r.validFrom().isBefore(today)));
            gates.add(gate("brand_active", r.brandId() != null && registrations.activeBrand(r.brandId()).isPresent()));
        } else {
            gates.add(gate("brand_name_free", !registrations.brandNameTaken(r.brandName())));
        }
        return gates;
    }

    private static Map<String, Object> gate(String code, boolean met) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("code", code);
        m.put("met", met);
        return m;
    }

    Optional<ResponseEntity<Map<String, Object>>> refuseAtSubmit(RegistrationRepository.Row r, LocalDate today) {
        if (RegistrationPolicy.AGENCY.equals(r.kind()) && (r.brandId() == null || registrations.activeBrand(r.brandId()).isEmpty())) {
            return Optional.of(error(HttpStatus.FORBIDDEN, "brand_not_permitted"));
        }
        if (RegistrationPolicy.BRAND.equals(r.kind()) && registrations.brandNameTaken(r.brandName())) {
            return Optional.of(error(HttpStatus.CONFLICT, "brand_name_taken"));
        }
        if (RegistrationPolicy.AGENCY.equals(r.kind()) && (r.validFrom() == null || r.validFrom().isBefore(today))) {
            return Optional.of(error(HttpStatus.UNPROCESSABLE_ENTITY, "validation_failed"));
        }
        if (registrations.documentCount(r.id()) == 0) {
            return Optional.of(error(HttpStatus.UNPROCESSABLE_ENTITY, "document_required"));
        }
        return Optional.empty();
    }

    private Optional<FeeRule> feeFor(RegistrationRepository.Row r, LocalDate today) {
        return masters.feeRule(FEE_CATEGORY, r.kind() + "_registration", today);
    }

    private record ExpectedFee(String amountInr, String feeRuleKey, int feeRuleVersion) {
    }

    private static Optional<ExpectedFee> expectedFee(JsonNode body) {
        if (body == null || !body.has("expectedFee") || !body.get("expectedFee").isObject()) {
            return Optional.empty();
        }
        JsonNode f = body.get("expectedFee");
        if (!f.hasNonNull("amountInr") || !f.hasNonNull("feeRuleKey") || !f.has("feeRuleVersion") || !f.get("feeRuleVersion").isInt()) {
            return Optional.empty();
        }
        return Optional.of(new ExpectedFee(f.get("amountInr").asText().trim(), f.get("feeRuleKey").asText().trim(), f.get("feeRuleVersion").asInt()));
    }

    // ---- idempotency and views

    private Optional<ResponseEntity<Map<String, Object>>> replayOrRequireKey(Caller caller, String method, String route, UUID target, String key,
                                                                              JsonNode body) {
        if (key == null || !DraftRequestSupport.IDEMPOTENCY_KEY.matcher(key).matches()) {
            return Optional.of(error(HttpStatus.UNPROCESSABLE_ENTITY, "idempotency_key_required"));
        }
        var stored = idempotency.find(caller.accountId(), method, route, target, key);
        if (stored.isEmpty()) {
            return Optional.empty();
        }
        if (stored.get().inProgress()) {
            return Optional.of(error(HttpStatus.CONFLICT, "idempotency_in_progress"));
        }
        Optional<byte[]> prior = idempotency.bodyHash(caller.accountId(), method, route, target, key);
        if (prior.isEmpty() || !java.security.MessageDigest.isEqual(prior.get(), DraftRequestSupport.bodyHash(body))) {
            return Optional.of(error(HttpStatus.CONFLICT, "idempotency_key_conflict"));
        }
        // A replay is shown only to a caller who can still file, and (for a record) still reach the record it was made on.
        if (NIL.equals(target) && RegistrationPolicy.kindFor(caller).isEmpty()) {
            return Optional.of(error(HttpStatus.FORBIDDEN, "no_write_scope"));
        }
        if (!NIL.equals(target)) {
            Optional<UUID> filing = RegistrationPolicy.filingOrganisation(caller);
            if (filing.isEmpty()) {
                return Optional.of(error(HttpStatus.FORBIDDEN, "no_write_scope"));
            }
            if (registrations.findOwned(target, filing.get()).isEmpty()) {
                return Optional.of(error(HttpStatus.NOT_FOUND, "not_found"));
            }
        }
        try {
            @SuppressWarnings("unchecked")
            Map<String, Object> replayBody = json.readValue(stored.get().responseBody(), Map.class);
            return Optional.of(ResponseEntity.status(stored.get().responseStatus()).header("Idempotency-Replayed", "true").body(replayBody));
        } catch (Exception e) {
            return Optional.of(error(HttpStatus.INTERNAL_SERVER_ERROR, "internal_error"));
        }
    }

    private ResponseEntity<Map<String, Object>> fail(Caller caller, String method, String route, UUID target, String key, HttpStatus status, String code) {
        idempotency.abandon(caller.accountId(), method, route, target, key);
        return error(status, code);
    }

    private ResponseEntity<Map<String, Object>> fail(Caller caller, String method, String route, UUID target, String key,
                                                     ResponseEntity<Map<String, Object>> response) {
        idempotency.abandon(caller.accountId(), method, route, target, key);
        return response;
    }

    public static Map<String, Object> view(RegistrationRepository.Row r, RegistrationRepository.FeeRow fee, int documents) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", r.id().toString());
        m.put("reference", r.reference());
        m.put("kind", r.kind());
        m.put("organisation", r.organisationCode());
        m.put("brandName", r.brandName());
        if (r.brandId() != null) {
            m.put("brandId", r.brandId().toString());
        }
        if (r.validFrom() != null) {
            m.put("validFrom", r.validFrom().toString());
        }
        if (r.validTo() != null) {
            m.put("validTo", r.validTo().toString());
        }
        m.put("state", r.state());
        m.put("version", r.version());
        m.put("tradeLicenceUploaded", documents > 0);
        if (fee != null) {
            m.put("submissionFee", snapshotView(fee));
        }
        return m;
    }

    private static Map<String, Object> feeView(FeeRule fee) {
        MasterVersion v = fee.version();
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("amountInr", fee.amountInr().toPlainString());
        m.put("taxRatePercent", fee.taxRatePercent().setScale(2).toPlainString());
        m.put("taxInr", fee.taxInr().toPlainString());
        m.put("totalInr", fee.totalInr().toPlainString());
        putFeeCommon(m, v.ruleKey(), v.version(), v.verification().name().toLowerCase(), !v.beeVerified(), v.sourceReference());
        return m;
    }

    private static Map<String, Object> snapshotView(RegistrationRepository.FeeRow fee) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("amountInr", fee.amountInr().toPlainString());
        m.put("taxRatePercent", fee.taxRatePercent().setScale(2).toPlainString());
        m.put("taxInr", fee.taxInr().toPlainString());
        m.put("totalInr", fee.totalInr().toPlainString());
        putFeeCommon(m, fee.feeRuleKey(), fee.feeRuleVersion(), fee.verificationStatus(), !"verified".equals(fee.verificationStatus()), fee.sourceReference());
        return m;
    }

    /** The fields every fee view shares, in the shape of the contract's SubmissionFee. */
    private static void putFeeCommon(Map<String, Object> m, String key, int version, String verification, boolean localDemo, String source) {
        m.put("currency", "INR");
        m.put("feeRuleKey", key);
        m.put("feeRuleVersion", version);
        m.put("verificationStatus", verification);
        m.put("localDemoFee", localDemo);
        m.put("label", localDemo ? "Local demo fee (not BEE-approved)" : "Fee from BEE-approved rule");
        if (source != null) {
            m.put("sourceReference", source);
        }
    }

    private String write(Map<String, Object> view) {
        try {
            return json.writeValueAsString(view);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private static ResponseEntity<Map<String, Object>> error(HttpStatus status, String code) {
        return ApiErrors.response(status, code);
    }
}
