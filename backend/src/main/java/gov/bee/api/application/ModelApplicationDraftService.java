package gov.bee.api.application;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import gov.bee.api.brand.BrandAuthRepository;
import gov.bee.api.brand.BrandAuthService;
import gov.bee.api.identity.Caller;
import gov.bee.api.identity.IdentityRepository;
import gov.bee.api.policy.ApplicationFacts;
import gov.bee.api.policy.SlicePolicy;
import gov.bee.api.policy.SlicePolicy.ReadScope;
import gov.bee.api.web.ApiErrors;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ModelApplicationDraftService {

    private static final String ROUTE_CREATE = "/api/model-applications";
    private static final String ROUTE_PATCH = "/api/model-applications/{id}";
    private static final UUID NIL = IdempotencyRepository.CREATE_TARGET;

    private final IdentityRepository identity;
    private final ModelApplicationRepository applications;
    private final BrandAuthRepository brands;
    private final BrandAuthService brandService;
    private final IdempotencyRepository idempotency;
    private final ObjectMapper json;

    public ModelApplicationDraftService(IdentityRepository identity, ModelApplicationRepository applications,
                                        BrandAuthRepository brands, BrandAuthService brandService,
                                        IdempotencyRepository idempotency, ObjectMapper json) {
        this.identity = identity;
        this.applications = applications;
        this.brands = brands;
        this.brandService = brandService;
        this.idempotency = idempotency;
        this.json = json;
    }

    public ResponseEntity<Map<String, Object>> eligibleBrands(Caller caller) {
        if (!ModelDraftPolicy.canWrite(caller)) {
            return error(HttpStatus.FORBIDDEN, "no_write_scope");
        }
        var memberships = identity.activeMemberships(caller.accountId());
        UUID filing = ModelDraftPolicy.filingOrganisation(caller).orElseThrow();
        LocalDate today = LocalDate.now(ModelDraftPolicy.IST);
        List<Map<String, Object>> items = new ArrayList<>();
        if (memberships.size() == 1 && "manufacturer".equals(memberships.get(0).kind())) {
            for (var b : brands.listOwnedActiveBrands(filing)) {
                items.add(brandItem(b.id(), b.name(), filing, memberships.get(0).code()));
            }
        } else if (memberships.size() == 1 && "agency".equals(memberships.get(0).kind())) {
            for (var row : brands.listAgencyEligibleBrands(filing, today)) {
                items.add(brandItem(row.brandId(), row.brandName(), row.principalOrganisationId(), row.principalOrganisationCode()));
            }
        }
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("items", items);
        body.put("count", items.size());
        body.put("authority", "spring-database");
        return ResponseEntity.ok(body);
    }

    @Transactional
    public ResponseEntity<Map<String, Object>> create(Caller caller, String idempotencyKey, JsonNode body) {
        Optional<ResponseEntity<Map<String, Object>>> replay = replayOrRequireKey(caller, "POST", ROUTE_CREATE, NIL, idempotencyKey, body);
        if (replay.isPresent()) {
            return replay.get();
        }
        if (!ModelDraftPolicy.canWrite(caller)) {
            return error(HttpStatus.FORBIDDEN, "no_write_scope");
        }
        byte[] hash = DraftRequestSupport.bodyHash(body);
        if (!idempotency.begin(caller.accountId(), "POST", ROUTE_CREATE, NIL, idempotencyKey, hash)) {
            return error(HttpStatus.CONFLICT, "idempotency_in_progress");
        }
        Optional<CreateInput> input = parseCreate(body);
        if (input.isEmpty()) {
            idempotency.abandon(caller.accountId(), "POST", ROUTE_CREATE, NIL, idempotencyKey);
            return error(HttpStatus.UNPROCESSABLE_ENTITY, "validation_failed");
        }
        var memberships = identity.activeMemberships(caller.accountId());
        LocalDate today = LocalDate.now(ModelDraftPolicy.IST);
        var brandDecision = ModelDraftPolicy.brandForFiling(caller, memberships, input.get().brandId(), brands, brandService, today);
        if (!brandDecision.allowed()) {
            idempotency.abandon(caller.accountId(), "POST", ROUTE_CREATE, NIL, idempotencyKey);
            return error(HttpStatus.FORBIDDEN, brandDecision.denial());
        }
        var choice = brandDecision.brand().orElseThrow();
        UUID filing = ModelDraftPolicy.filingOrganisation(caller).orElseThrow();
        UUID id = UUID.randomUUID();
        String reference = applications.nextReference();
        ModelApplicationRepository.Row row = applications.insertDraft(id, reference, filing, choice.principalOrganisationId(),
            choice.brandId(), choice.brandName(), input.get().category(), input.get().modelNumber());
        Map<String, Object> view = view(row, readScope(caller));
        int status = 201;
        idempotency.complete(caller.accountId(), "POST", ROUTE_CREATE, NIL, idempotencyKey, status, writeJson(view), row.version());
        return ResponseEntity.status(status).body(view);
    }

    @Transactional
    public ResponseEntity<Map<String, Object>> patch(Caller caller, UUID appId, String idempotencyKey, JsonNode body) {
        Optional<ResponseEntity<Map<String, Object>>> replay = replayOrRequireKey(caller, "PATCH", ROUTE_PATCH, appId, idempotencyKey, body);
        if (replay.isPresent()) {
            return replay.get();
        }
        if (!ModelDraftPolicy.canWrite(caller)) {
            return error(HttpStatus.FORBIDDEN, "no_write_scope");
        }
        byte[] hash = DraftRequestSupport.bodyHash(body);
        if (!idempotency.begin(caller.accountId(), "PATCH", ROUTE_PATCH, appId, idempotencyKey, hash)) {
            return error(HttpStatus.CONFLICT, "idempotency_in_progress");
        }
        UUID filing = ModelDraftPolicy.filingOrganisation(caller).orElseThrow();
        Optional<PatchInput> input = parsePatch(body);
        if (input.isEmpty()) {
            idempotency.abandon(caller.accountId(), "PATCH", ROUTE_PATCH, appId, idempotencyKey);
            return error(HttpStatus.UNPROCESSABLE_ENTITY, "validation_failed");
        }
        Optional<ModelApplicationRepository.Row> existing = applications.findOwned(appId, filing);
        if (existing.isEmpty()) {
            idempotency.abandon(caller.accountId(), "PATCH", ROUTE_PATCH, appId, idempotencyKey);
            return error(HttpStatus.NOT_FOUND, "not_found");
        }
        ModelApplicationRepository.Row row = existing.get();
        if (!"draft".equals(row.state())) {
            idempotency.abandon(caller.accountId(), "PATCH", ROUTE_PATCH, appId, idempotencyKey);
            return error(HttpStatus.FORBIDDEN, "not_editable");
        }
        if (row.version() != input.get().version()) {
            idempotency.abandon(caller.accountId(), "PATCH", ROUTE_PATCH, appId, idempotencyKey);
            return error(HttpStatus.CONFLICT, "version_conflict");
        }
        var memberships = identity.activeMemberships(caller.accountId());
        LocalDate today = LocalDate.now(ModelDraftPolicy.IST);
        UUID brandId = input.get().brandId().orElse(row.brandId());
        if (brandId == null) {
            brandId = legacyBrandId(filing, memberships, row.brandName(), today).orElse(null);
        }
        if (brandId == null) {
            idempotency.abandon(caller.accountId(), "PATCH", ROUTE_PATCH, appId, idempotencyKey);
            return error(HttpStatus.UNPROCESSABLE_ENTITY, "validation_failed");
        }
        var brandDecision = ModelDraftPolicy.brandForFiling(caller, memberships, brandId, brands, brandService, today);
        if (!brandDecision.allowed()) {
            idempotency.abandon(caller.accountId(), "PATCH", ROUTE_PATCH, appId, idempotencyKey);
            return error(HttpStatus.FORBIDDEN, brandDecision.denial());
        }
        var choice = brandDecision.brand().orElseThrow();
        Optional<ModelApplicationRepository.Row> updated = applications.updateDraft(appId, filing, input.get().version(),
            input.get().modelNumber(), input.get().category(), choice.brandId(), choice.principalOrganisationId(), choice.brandName());
        if (updated.isEmpty()) {
            idempotency.abandon(caller.accountId(), "PATCH", ROUTE_PATCH, appId, idempotencyKey);
            return error(HttpStatus.CONFLICT, "version_conflict");
        }
        Map<String, Object> view = view(updated.get(), readScope(caller));
        idempotency.complete(caller.accountId(), "PATCH", ROUTE_PATCH, appId, idempotencyKey, 200, writeJson(view), updated.get().version());
        return ResponseEntity.ok(view);
    }

    /** Validates the key, returns a replay/conflict response, or empty to continue with a new write. */
    private Optional<ResponseEntity<Map<String, Object>>> replayOrRequireKey(Caller caller, String method, String route, UUID target,
                                                                               String key, JsonNode body) {
        if (key == null || !DraftRequestSupport.IDEMPOTENCY_KEY.matcher(key).matches()) {
            return Optional.of(error(HttpStatus.UNPROCESSABLE_ENTITY, "idempotency_key_required"));
        }
        byte[] hash = DraftRequestSupport.bodyHash(body);
        var stored = idempotency.find(caller.accountId(), method, route, target, key);
        if (stored.isEmpty()) {
            return Optional.empty();
        }
        var s = stored.get();
        if (s.inProgress()) {
            return Optional.of(error(HttpStatus.CONFLICT, "idempotency_in_progress"));
        }
        Optional<byte[]> priorHash = idempotency.bodyHash(caller.accountId(), method, route, target, key);
        if (priorHash.isEmpty() || !MessageDigestEquals.equals(priorHash.get(), hash)) {
            return Optional.of(error(HttpStatus.CONFLICT, "idempotency_key_conflict"));
        }
        Optional<String> scopeDeny = IdempotencyReplayGuard.denialBeforeReplay(caller, applications, identity, json, target, s.responseBody());
        if (scopeDeny.isPresent()) {
            HttpStatus status = "not_found".equals(scopeDeny.get()) ? HttpStatus.NOT_FOUND : HttpStatus.FORBIDDEN;
            if ("internal_error".equals(scopeDeny.get())) {
                status = HttpStatus.INTERNAL_SERVER_ERROR;
            }
            return Optional.of(error(status, scopeDeny.get()));
        }
        try {
            @SuppressWarnings("unchecked")
            Map<String, Object> replayBody = json.readValue(s.responseBody(), Map.class);
            return Optional.of(ResponseEntity.status(s.responseStatus()).header("Idempotency-Replayed", "true").body(replayBody));
        } catch (Exception e) {
            return Optional.of(error(HttpStatus.INTERNAL_SERVER_ERROR, "internal_error"));
        }
    }

    private record CreateInput(UUID brandId, String category, String modelNumber) {
    }

    private record PatchInput(int version, String category, String modelNumber, Optional<UUID> brandId) {
    }

    private Optional<CreateInput> parseCreate(JsonNode body) {
        if (body == null || !body.isObject()) {
            return Optional.empty();
        }
        if (!body.hasNonNull("brandId") || !body.hasNonNull("category") || !body.hasNonNull("modelNumber")) {
            return Optional.empty();
        }
        try {
            UUID brandId = UUID.fromString(body.get("brandId").asText());
            String category = body.get("category").asText();
            String modelNumber = DraftRequestSupport.trim(body.get("modelNumber").asText());
            if (!DraftRequestSupport.validCategory(category) || !DraftRequestSupport.validModelNumber(modelNumber)) {
                return Optional.empty();
            }
            return Optional.of(new CreateInput(brandId, category, modelNumber));
        } catch (IllegalArgumentException e) {
            return Optional.empty();
        }
    }

    /** When legacy rows have brand_name but no brand_id, link only if the name maps to exactly one eligible brand. */
    private Optional<UUID> legacyBrandId(UUID filing, List<gov.bee.api.identity.IdentityRepository.Membership> memberships,
                                         String brandName, LocalDate today) {
        if (brandName == null || brandName.isBlank() || memberships.size() != 1) {
            return Optional.empty();
        }
        String kind = memberships.get(0).kind();
        if ("manufacturer".equals(kind)) {
            var matches = brands.listOwnedActiveBrands(filing).stream().filter(b -> brandName.equals(b.name())).toList();
            return matches.size() == 1 ? Optional.of(matches.get(0).id()) : Optional.empty();
        }
        if ("agency".equals(kind)) {
            var matches = brands.listAgencyEligibleBrands(filing, today).stream().filter(b -> brandName.equals(b.brandName())).toList();
            return matches.size() == 1 ? Optional.of(matches.get(0).brandId()) : Optional.empty();
        }
        return Optional.empty();
    }

    private Optional<PatchInput> parsePatch(JsonNode body) {
        if (body == null || !body.isObject() || !body.has("version") || !body.has("category") || !body.has("modelNumber")) {
            return Optional.empty();
        }
        if (!body.get("version").isInt()) {
            return Optional.empty();
        }
        try {
            int version = body.get("version").asInt();
            String category = body.get("category").asText();
            String modelNumber = DraftRequestSupport.trim(body.get("modelNumber").asText());
            Optional<UUID> brandId = body.hasNonNull("brandId")
                ? Optional.of(UUID.fromString(body.get("brandId").asText()))
                : Optional.empty();
            if (!DraftRequestSupport.validCategory(category) || !DraftRequestSupport.validModelNumber(modelNumber)) {
                return Optional.empty();
            }
            return Optional.of(new PatchInput(version, category, modelNumber, brandId));
        } catch (IllegalArgumentException e) {
            return Optional.empty();
        }
    }

    private static Map<String, Object> brandItem(UUID brandId, String brandName, UUID principalId, String principalCode) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("brandId", brandId.toString());
        m.put("brandName", brandName);
        m.put("principalOrganisation", principalCode);
        m.put("principalOrganisationId", principalId.toString());
        return m;
    }

    static Map<String, Object> view(ModelApplicationRepository.Row r, ReadScope scope) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", r.id().toString());
        m.put("reference", r.reference());
        m.put("organisation", r.organisationCode());
        m.put("brandName", r.brandName());
        m.put("category", r.category());
        m.put("modelNumber", r.modelNumber());
        m.put("state", r.state());
        m.put("version", r.version());
        m.put("readBasis", SlicePolicy.readBasis(scope, facts(r)));
        if (r.brandId() != null) {
            m.put("brandId", r.brandId().toString());
        }
        if (r.principalOrganisationId() != null) {
            m.put("principalOrganisation", applicationsCode(r));
        }
        return m;
    }

    private static String applicationsCode(ModelApplicationRepository.Row r) {
        return r.principalOrganisationCode() == null ? "" : r.principalOrganisationCode();
    }

    private static ApplicationFacts facts(ModelApplicationRepository.Row r) {
        return new ApplicationFacts(r.id(), r.organisationId(), r.state(), r.assignedStagesForCaller(), Set.of(), false);
    }

    private ReadScope readScope(Caller caller) {
        return SlicePolicy.readScope(caller);
    }

    private String writeJson(Map<String, Object> view) {
        try {
            return json.writeValueAsString(view);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private static ResponseEntity<Map<String, Object>> error(HttpStatus status, String code) {
        return ApiErrors.response(status, code);
    }

    /** Constant-time byte comparison for idempotency body hashes. */
    static final class MessageDigestEquals {
        private MessageDigestEquals() {
        }

        static boolean equals(byte[] a, byte[] b) {
            if (a.length != b.length) {
                return false;
            }
            int diff = 0;
            for (int i = 0; i < a.length; i++) {
                diff |= a[i] ^ b[i];
            }
            return diff == 0;
        }
    }
}
