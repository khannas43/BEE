package gov.bee.api.manufactureronboarding;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import gov.bee.api.administration.AdminDemonstrationAccess;
import gov.bee.api.application.DraftRequestSupport;
import gov.bee.api.application.IdempotencyRepository;
import gov.bee.api.identity.Caller;
import gov.bee.api.masters.MasterDataRepository;
import gov.bee.api.masters.Masters.FeeRule;
import gov.bee.api.masters.MasterVersion;
import gov.bee.api.web.ApiErrors;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ManufacturerOnboardingService {

    static final String ROUTE_SIGNUP = "/api/public/manufacturer-signup";
    static final String ROUTE_CREATE = "/api/manufacturer-onboarding";
    static final String ROUTE_PATCH = "/api/manufacturer-onboarding/{id}";
    static final String ROUTE_SUBMIT = "/api/manufacturer-onboarding/{id}/submit";
    static final String ROUTE_DIRECTOR = "/api/manufacturer-onboarding/{id}/director-decision";
    static final String ROUTE_ANOMALY = "/api/manufacturer-onboarding/{id}/anomalies";
    static final String ROUTE_RESOLVE = "/api/manufacturer-onboarding/{id}/anomaly-resolution";
    private static final UUID NIL = IdempotencyRepository.CREATE_TARGET;
    private static final String FEE_KEY = "REG:manufacturer_onboarding";
    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");

    private final ManufacturerOnboardingRepository repo;
    private final ManufacturerOnboardingDocumentRepository documents;
    private final MasterDataRepository masters;
    private final IdempotencyRepository idempotency;
    private final ObjectMapper json;

    public ManufacturerOnboardingService(ManufacturerOnboardingRepository repo, ManufacturerOnboardingDocumentRepository documents,
                                         MasterDataRepository masters, IdempotencyRepository idempotency, ObjectMapper json) {
        this.repo = repo;
        this.documents = documents;
        this.masters = masters;
        this.idempotency = idempotency;
        this.json = json;
    }

    @Transactional
    public ResponseEntity<Map<String, Object>> publicSignup(String idempotencyKey, JsonNode body) {
        if (idempotencyKey == null || !DraftRequestSupport.IDEMPOTENCY_KEY.matcher(idempotencyKey).matches()) {
            return error(HttpStatus.UNPROCESSABLE_ENTITY, "idempotency_key_required");
        }
        String fullName = text(body, "fullName");
        String email = text(body, "email");
        String mobile = text(body, "mobile");
        UUID keycloakSubject = uuidField(body, "keycloakSubject");
        if (fullName == null || email == null || mobile == null) {
            return error(HttpStatus.UNPROCESSABLE_ENTITY, "validation_failed");
        }
        email = email.toLowerCase();
        String commandHash = ManufacturerOnboardingCommandHash.publicSignup(fullName, email, mobile, keycloakSubject);
        UUID commandId = commandId(idempotencyKey, "public_signup", NIL);
        Optional<ManufacturerOnboardingRepository.SignupResult> result =
            repo.orchestratePublicSignup(fullName, email, mobile, keycloakSubject, commandId, commandHash);
        if (result.isEmpty() || result.get().outState() == null) {
            return error(HttpStatus.CONFLICT, "version_conflict");
        }
        String state = result.get().outState();
        return switch (state) {
            case "validation_failed" -> error(HttpStatus.UNPROCESSABLE_ENTITY, "validation_failed");
            case "registration_not_available" -> error(HttpStatus.CONFLICT, "registration_not_available");
            case "idempotency_key_conflict" -> error(HttpStatus.CONFLICT, "idempotency_key_conflict");
            case "created" -> {
                Map<String, Object> view = new LinkedHashMap<>();
                view.put("username", result.get().username());
                view.put("accountId", result.get().accountId().toString());
                view.put("organisationId", result.get().organisationId().toString());
                view.put("applicationId", result.get().applicationId().toString());
                view.put("emailVerifiedSimulated", true);
                view.put("mobileVerifiedSimulated", true);
                view.put("verification", "simulated");
                yield ResponseEntity.status(HttpStatus.CREATED).body(view);
            }
            default -> error(HttpStatus.CONFLICT, state);
        };
    }

    public ResponseEntity<Map<String, Object>> list(Caller caller) {
        var scope = ManufacturerOnboardingPolicy.readScope(caller);
        if (scope.isEmpty()) {
            return error(HttpStatus.FORBIDDEN, "no_read_scope");
        }
        List<Map<String, Object>> items = new ArrayList<>();
        for (var r : repo.list(scope.organisations(), scope.stages(), scope.allRecords())) {
            if (scope.canRead(r)) {
                items.add(view(r));
            }
        }
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("items", items);
        body.put("count", items.size());
        body.put("authority", "spring-database");
        return ResponseEntity.ok(body);
    }

    public ResponseEntity<Map<String, Object>> get(Caller caller, UUID id) {
        var scope = ManufacturerOnboardingPolicy.readScope(caller);
        Optional<ManufacturerOnboardingRepository.Row> row = scope.isEmpty() ? Optional.empty() : repo.find(id).filter(scope::canRead);
        if (row.isEmpty()) {
            return error(scope.isEmpty() ? HttpStatus.FORBIDDEN : HttpStatus.NOT_FOUND, scope.isEmpty() ? "no_read_scope" : "not_found");
        }
        return ResponseEntity.ok(detailView(row.get()));
    }

    public ResponseEntity<Map<String, Object>> listDocuments(Caller caller, UUID id) {
        var scope = ManufacturerOnboardingPolicy.readScope(caller);
        Optional<ManufacturerOnboardingRepository.Row> row = scope.isEmpty() ? Optional.empty() : repo.find(id).filter(scope::canRead);
        if (row.isEmpty()) {
            return error(scope.isEmpty() ? HttpStatus.FORBIDDEN : HttpStatus.NOT_FOUND, scope.isEmpty() ? "no_read_scope" : "not_found");
        }
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("applicationId", id.toString());
        body.put("documents", documentHeads(id));
        return ResponseEntity.ok(body);
    }

    @Transactional
    public ResponseEntity<Map<String, Object>> create(Caller caller, String idempotencyKey, JsonNode body) {
        if (AdminDemonstrationAccess.deniesOperationalMutation(caller)) {
            return error(HttpStatus.FORBIDDEN, "role_not_permitted");
        }
        Optional<ResponseEntity<Map<String, Object>>> replay = replayOrRequireKey(caller, "POST", ROUTE_CREATE, NIL, idempotencyKey, body);
        if (replay.isPresent()) {
            return replay.get();
        }
        if (ManufacturerOnboardingPolicy.readScope(caller).isEmpty()) {
            return error(HttpStatus.FORBIDDEN, "no_read_scope");
        }
        Optional<UUID> org = ManufacturerOnboardingPolicy.filingOrganisation(caller);
        if (org.isEmpty()) {
            return error(HttpStatus.FORBIDDEN, "no_read_scope");
        }
        String legalName = text(body, "legalName");
        if (legalName == null) {
            return error(HttpStatus.UNPROCESSABLE_ENTITY, "validation_failed");
        }
        byte[] hash = DraftRequestSupport.bodyHash(body);
        if (!idempotency.begin(caller.accountId(), "POST", ROUTE_CREATE, NIL, idempotencyKey, hash)) {
            return error(HttpStatus.CONFLICT, "idempotency_in_progress");
        }
        JsonNode draft = body == null ? null : body.get("draft");
        var row = repo.create(caller.accountId(), org.get(), legalName, LocalDate.now(IST).getYear(), draft);
        Map<String, Object> view = detailView(row);
        idempotency.complete(caller.accountId(), "POST", ROUTE_CREATE, NIL, idempotencyKey, 201, json.valueToTree(view).toString(), row.version());
        return ResponseEntity.status(HttpStatus.CREATED).body(view);
    }

    @Transactional
    public ResponseEntity<Map<String, Object>> patch(Caller caller, UUID id, JsonNode body) {
        if (AdminDemonstrationAccess.deniesOperationalMutation(caller)) {
            return error(HttpStatus.FORBIDDEN, "role_not_permitted");
        }
        if (ManufacturerOnboardingPolicy.readScope(caller).isEmpty()) {
            return error(HttpStatus.FORBIDDEN, "no_read_scope");
        }
        Optional<UUID> org = ManufacturerOnboardingPolicy.filingOrganisation(caller);
        if (org.isEmpty()) {
            return error(HttpStatus.FORBIDDEN, "no_read_scope");
        }
        Optional<Integer> version = intField(body, "version");
        String legalName = body != null && body.has("legalName") ? text(body, "legalName") : null;
        JsonNode draft = body == null ? null : body.get("draft");
        if (version.isEmpty() || (legalName == null && (draft == null || draft.isNull()))) {
            return error(HttpStatus.UNPROCESSABLE_ENTITY, "validation_failed");
        }
        Optional<ManufacturerOnboardingRepository.Row> owned = repo.findOwned(id, org.get());
        if (owned.isEmpty() || !ManufacturerOnboardingPolicy.editable(owned.get().state())) {
            return error(owned.isEmpty() ? HttpStatus.NOT_FOUND : HttpStatus.FORBIDDEN, owned.isEmpty() ? "not_found" : "not_editable");
        }
        Optional<ManufacturerOnboardingRepository.Row> updated = repo.patchDraft(caller.accountId(), id, org.get(), version.get(), legalName, draft);
        if (updated.isEmpty()) {
            return error(HttpStatus.CONFLICT, "version_conflict");
        }
        return ResponseEntity.ok(detailView(updated.get()));
    }

    public ResponseEntity<Map<String, Object>> submitPreview(Caller caller, UUID id) {
        var scope = ManufacturerOnboardingPolicy.readScope(caller);
        if (scope.isEmpty()) {
            return error(HttpStatus.FORBIDDEN, "no_read_scope");
        }
        Optional<ManufacturerOnboardingRepository.Row> row = repo.find(id).filter(scope::canRead);
        if (row.isEmpty()) {
            return error(HttpStatus.NOT_FOUND, "not_found");
        }
        if (!submittable(row.get().state())) {
            return error(HttpStatus.FORBIDDEN, "not_submittable");
        }
        Optional<FeeRule> fee = masters.feeRule("REG", "manufacturer_onboarding", LocalDate.now(IST));
        if (fee.isEmpty()) {
            return error(HttpStatus.UNPROCESSABLE_ENTITY, "rule_not_available");
        }
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("applicationId", id.toString());
        body.put("state", row.get().state());
        body.put("version", row.get().version());
        body.put("tradeLicenceUploaded", repo.hasTradeLicenceDocument(id));
        body.put("expectedFee", feeView(fee.get()));
        return ResponseEntity.ok(body);
    }

    @Transactional
    public ResponseEntity<Map<String, Object>> submit(Caller caller, UUID id, String idempotencyKey, JsonNode body) {
        if (AdminDemonstrationAccess.deniesOperationalMutation(caller)) {
            return error(HttpStatus.FORBIDDEN, "role_not_permitted");
        }
        Optional<ResponseEntity<Map<String, Object>>> replay = replayOrRequireKey(caller, "POST", ROUTE_SUBMIT, id, idempotencyKey, body);
        if (replay.isPresent()) {
            return replay.get();
        }
        Optional<UUID> org = ManufacturerOnboardingPolicy.filingOrganisation(caller);
        if (org.isEmpty()) {
            return error(HttpStatus.FORBIDDEN, "no_write_scope");
        }
        Optional<Integer> version = intField(body, "version");
        if (version.isEmpty()) {
            return error(HttpStatus.UNPROCESSABLE_ENTITY, "validation_failed");
        }
        Optional<ManufacturerOnboardingRepository.Row> row = repo.findOwned(id, org.get());
        if (row.isEmpty()) {
            return error(HttpStatus.NOT_FOUND, "not_found");
        }
        if (!submittable(row.get().state())) {
            return error(HttpStatus.FORBIDDEN, "not_submittable");
        }
        Optional<FeeRule> fee = masters.feeRule("REG", "manufacturer_onboarding", LocalDate.now(IST));
        if (fee.isEmpty()) {
            return error(HttpStatus.UNPROCESSABLE_ENTITY, "rule_not_available");
        }
        byte[] hash = DraftRequestSupport.bodyHash(body);
        if (!idempotency.begin(caller.accountId(), "POST", ROUTE_SUBMIT, id, idempotencyKey, hash)) {
            return error(HttpStatus.CONFLICT, "idempotency_in_progress");
        }
        UUID commandId = commandId(idempotencyKey, "submit", id);
        MasterVersion fv = fee.get().version();
        String verification = fv.verification().name().toLowerCase();
        String commandHash = ManufacturerOnboardingCommandHash.submit(id, caller.accountId(), version.get(), fee.get().amountInr(), fv.ruleKey(),
            fv.version(), verification, fv.sourceReference(), fv.note());
        var result = repo.orchestrateSubmit(id, caller.accountId(), actorRole(caller), version.get(), fee.get().amountInr(), fv.ruleKey(), fv.version(),
            verification, fv.sourceReference(), fv.note(), commandId, commandHash);
        if (result.isEmpty() || result.get().outState() == null) {
            idempotency.abandon(caller.accountId(), "POST", ROUTE_SUBMIT, id, idempotencyKey);
            return error(HttpStatus.CONFLICT, "version_conflict");
        }
        return finishOrchestrator(caller, id, "POST", ROUTE_SUBMIT, idempotencyKey, result.get());
    }

    @Transactional
    public ResponseEntity<Map<String, Object>> directorDecision(Caller caller, UUID id, String idempotencyKey, JsonNode body) {
        return orchestratorAction(caller, id, idempotencyKey, body, ROUTE_DIRECTOR, "director_decision", (commandId, version, node) -> {
            String decision = text(node, "decision");
            String note = text(node, "note");
            if (decision == null) {
                return Optional.of(error(HttpStatus.UNPROCESSABLE_ENTITY, "validation_failed"));
            }
            if (("reject".equals(decision) || "return".equals(decision)) && (note == null || note.length() < 8)) {
                return Optional.of(error(HttpStatus.UNPROCESSABLE_ENTITY, "validation_failed"));
            }
            if (!ManufacturerOnboardingPolicy.canDirectorAct(caller)) {
                return Optional.of(error(HttpStatus.FORBIDDEN, "not_permitted"));
            }
            String commandHash = ManufacturerOnboardingCommandHash.directorDecision(id, caller.accountId(), version, decision, note);
            return repo.orchestrateDirectorDecision(id, caller.accountId(), version, decision, note, commandId, commandHash)
                .map(r -> finishOrchestrator(caller, id, "POST", ROUTE_DIRECTOR, idempotencyKey, r))
                .or(() -> Optional.of(error(HttpStatus.CONFLICT, "version_conflict")));
        });
    }

    @Transactional
    public ResponseEntity<Map<String, Object>> raiseAnomaly(Caller caller, UUID id, String idempotencyKey, JsonNode body) {
        return orchestratorAction(caller, id, idempotencyKey, body, ROUTE_ANOMALY, "raise_anomaly", (commandId, version, node) -> {
            String reason = text(node, "reason");
            if (reason == null) {
                return Optional.of(error(HttpStatus.UNPROCESSABLE_ENTITY, "validation_failed"));
            }
            String role = ManufacturerOnboardingPolicy.anomalyActorRole(caller);
            if (role == null) {
                return Optional.of(error(HttpStatus.FORBIDDEN, "not_permitted"));
            }
            String commandHash = ManufacturerOnboardingCommandHash.raiseAnomaly(id, caller.accountId(), role, version, reason);
            return repo.orchestrateRaiseAnomaly(id, caller.accountId(), role, version, reason, commandId, commandHash)
                .map(r -> finishOrchestrator(caller, id, "POST", ROUTE_ANOMALY, idempotencyKey, r))
                .or(() -> Optional.of(error(HttpStatus.CONFLICT, "version_conflict")));
        });
    }

    @Transactional
    public ResponseEntity<Map<String, Object>> resolveAnomaly(Caller caller, UUID id, String idempotencyKey, JsonNode body) {
        return orchestratorAction(caller, id, idempotencyKey, body, ROUTE_RESOLVE, "resolve_anomaly", (commandId, version, node) -> {
            String resolution = text(node, "resolution");
            String note = text(node, "note");
            if (resolution == null) {
                return Optional.of(error(HttpStatus.UNPROCESSABLE_ENTITY, "validation_failed"));
            }
            if (!ManufacturerOnboardingPolicy.canDirectorAct(caller)) {
                return Optional.of(error(HttpStatus.FORBIDDEN, "not_permitted"));
            }
            String commandHash = ManufacturerOnboardingCommandHash.resolveAnomaly(id, caller.accountId(), version, resolution, note);
            return repo.orchestrateResolveAnomaly(id, caller.accountId(), version, resolution, note, commandId, commandHash)
                .map(r -> finishOrchestrator(caller, id, "POST", ROUTE_RESOLVE, idempotencyKey, r))
                .or(() -> Optional.of(error(HttpStatus.CONFLICT, "version_conflict")));
        });
    }

    private interface OrchestratorStep {
        Optional<ResponseEntity<Map<String, Object>>> run(UUID commandId, int version, JsonNode body);
    }

    private ResponseEntity<Map<String, Object>> orchestratorAction(Caller caller, UUID id, String idempotencyKey, JsonNode body, String route,
                                                                   String purpose, OrchestratorStep step) {
        if (AdminDemonstrationAccess.deniesOperationalMutation(caller)) {
            return error(HttpStatus.FORBIDDEN, "role_not_permitted");
        }
        Optional<ResponseEntity<Map<String, Object>>> replay = replayOrRequireKey(caller, "POST", route, id, idempotencyKey, body);
        if (replay.isPresent()) {
            return replay.get();
        }
        Optional<Integer> version = intField(body, "version");
        if (version.isEmpty()) {
            return error(HttpStatus.UNPROCESSABLE_ENTITY, "validation_failed");
        }
        byte[] hash = DraftRequestSupport.bodyHash(body);
        if (!idempotency.begin(caller.accountId(), "POST", route, id, idempotencyKey, hash)) {
            return error(HttpStatus.CONFLICT, "idempotency_in_progress");
        }
        UUID commandId = commandId(idempotencyKey, purpose, id);
        Optional<ResponseEntity<Map<String, Object>>> out = step.run(commandId, version.get(), body);
        if (out.isEmpty()) {
            idempotency.abandon(caller.accountId(), "POST", route, id, idempotencyKey);
            return error(HttpStatus.CONFLICT, "version_conflict");
        }
        ResponseEntity<Map<String, Object>> response = out.get();
        if (response.getStatusCode().is2xxSuccessful() && response.getBody() != null) {
            int v = (int) response.getBody().get("version");
            idempotency.complete(caller.accountId(), "POST", route, id, idempotencyKey, response.getStatusCode().value(),
                json.valueToTree(response.getBody()).toString(), v);
        } else {
            idempotency.abandon(caller.accountId(), "POST", route, id, idempotencyKey);
        }
        return response;
    }

    private ResponseEntity<Map<String, Object>> finishOrchestrator(Caller caller, UUID id, String method, String route, String idempotencyKey,
                                                                    ManufacturerOnboardingRepository.OrchestratorResult result) {
        String state = result.outState();
        HttpStatus status = switch (state) {
            case "not_found" -> HttpStatus.NOT_FOUND;
            case "not_submittable", "not_permitted", "segregation_refused", "organisation_not_eligible" -> HttpStatus.FORBIDDEN;
            case "validation_failed" -> HttpStatus.UNPROCESSABLE_ENTITY;
            case "observation_not_ended", "anomaly_open", "idempotency_key_conflict" -> HttpStatus.CONFLICT;
            default -> HttpStatus.OK;
        };
        if (!status.is2xxSuccessful()) {
            idempotency.abandon(caller.accountId(), method, route, id, idempotencyKey);
            return error(status, state);
        }
        ManufacturerOnboardingRepository.Row row = repo.find(id).orElseThrow();
        Map<String, Object> view = detailView(row);
        view.put("outcome", state);
        if (result.paymentId() != null) {
            view.put("paymentId", result.paymentId().toString());
        }
        if (result.permitteeNumber() != null) {
            view.put("permitteeNumber", result.permitteeNumber());
        }
        idempotency.complete(caller.accountId(), method, route, id, idempotencyKey, status.value(), json.valueToTree(view).toString(), row.version());
        return ResponseEntity.status(status).body(view);
    }

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
        try {
            @SuppressWarnings("unchecked")
            Map<String, Object> parsed = json.readValue(stored.get().responseBody(), Map.class);
            return Optional.of(ResponseEntity.status(stored.get().responseStatus()).body(parsed));
        } catch (Exception e) {
            return Optional.of(error(HttpStatus.CONFLICT, "idempotency_replay_failed"));
        }
    }

    private Map<String, Object> view(ManufacturerOnboardingRepository.Row r) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", r.id().toString());
        m.put("reference", r.reference());
        m.put("organisationId", r.organisationId().toString());
        m.put("legalName", r.legalName());
        m.put("state", r.state());
        m.put("version", r.version());
        m.put("tradeLicenceUploaded", repo.hasTradeLicenceDocument(r.id()));
        if (r.permitteeNumber() != null) {
            m.put("permitteeNumber", r.permitteeNumber());
        }
        if (r.observationEndsOn() != null) {
            m.put("observationEndsOn", r.observationEndsOn().toString());
        }
        m.put("createdAt", r.createdAt().toString());
        return m;
    }

    private Map<String, Object> detailView(ManufacturerOnboardingRepository.Row r) {
        Map<String, Object> m = view(r);
        repo.draftPayloadJson(r.id()).ifPresent(raw -> {
            try {
                m.put("draft", json.readTree(raw));
            } catch (Exception ignored) {
                m.put("draft", Map.of());
            }
        });
        m.put("documents", documentHeads(r.id()));
        m.put("automatedChecks", repo.latestChecks(r.id()).stream().map(c -> {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("checkCode", c.checkCode());
            row.put("outcome", c.outcome());
            row.put("detail", c.detail());
            row.put("checkedAt", c.checkedAt().toString());
            return row;
        }).toList());
        m.put("lifecycle", repo.lifecycle(r.id()).stream().map(e -> {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("eventKind", e.eventKind());
            row.put("fromState", e.fromState());
            row.put("toState", e.toState());
            row.put("actorRole", e.actorRole());
            row.put("detail", e.detail());
            row.put("occurredAt", e.occurredAt().toString());
            return row;
        }).toList());
        m.put("anomalies", repo.anomalies(r.id()).stream().map(a -> {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("raisedByRole", a.raisedByRole());
            row.put("reason", a.reason());
            if (a.resolution() != null) {
                row.put("resolution", a.resolution());
            }
            row.put("raisedAt", a.raisedAt().toString());
            if (a.resolvedAt() != null) {
                row.put("resolvedAt", a.resolvedAt().toString());
            }
            return row;
        }).toList());
        repo.feeSnapshot(r.id()).ifPresent(f -> {
            Map<String, Object> fee = new LinkedHashMap<>();
            fee.put("amountInr", f.amountInr());
            fee.put("totalInr", f.totalInr());
            fee.put("feeRuleKey", f.feeRuleKey());
            fee.put("feeRuleVersion", f.feeRuleVersion());
            m.put("fee", fee);
        });
        repo.paymentSummary(r.id()).ifPresent(p -> {
            Map<String, Object> pay = new LinkedHashMap<>();
            pay.put("paymentId", p.paymentId().toString());
            pay.put("amountInr", p.amountInr());
            pay.put("receiptNumber", p.receiptNumber());
            pay.put("status", p.status());
            if (p.settledAt() != null) {
                pay.put("settledAt", p.settledAt().toString());
            }
            m.put("payment", pay);
        });
        repo.directorDecision(r.id()).ifPresent(d -> {
            Map<String, Object> dec = new LinkedHashMap<>();
            dec.put("decision", d.decision());
            if (d.note() != null) {
                dec.put("note", d.note());
            }
            dec.put("decidedAt", d.decidedAt().toString());
            m.put("directorDecision", dec);
        });
        repo.permitteeActivation(r.id()).ifPresent(a -> {
            Map<String, Object> act = new LinkedHashMap<>();
            act.put("permitteeNumber", a.permitteeNumber());
            act.put("activatedAt", a.activatedAt().toString());
            m.put("permitteeActivation", act);
        });
        repo.observation(r.id()).ifPresent(o -> {
            Map<String, Object> obs = new LinkedHashMap<>();
            obs.put("startedOn", o.startedOn().toString());
            obs.put("endsOn", o.endsOn().toString());
            if (o.closedAt() != null) {
                obs.put("closedAt", o.closedAt().toString());
            }
            m.put("observation", obs);
        });
        return m;
    }

    private List<Map<String, Object>> documentHeads(UUID applicationId) {
        return documents.list(applicationId).stream().map(d -> {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("documentKind", d.documentKind());
            row.put("latestVersion", d.latestVersion());
            row.put("status", d.status());
            if (d.expiresOn() != null) {
                row.put("expiresOn", d.expiresOn().toString());
            }
            return row;
        }).toList();
    }

    private static boolean submittable(String state) {
        return "draft".equals(state) || "automatic_checks_failed".equals(state) || "returned".equals(state);
    }

    private static Map<String, Object> feeView(FeeRule fee) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("amountInr", fee.amountInr().toPlainString());
        m.put("feeRuleKey", fee.version().ruleKey());
        m.put("feeRuleVersion", fee.version().version());
        return m;
    }

    private static String actorRole(Caller caller) {
        return caller.ownRoles().isEmpty() ? "unknown" : caller.ownRoles().get(0).role();
    }

    private static UUID commandId(String idempotencyKey, String purpose, UUID applicationId) {
        return UUID.nameUUIDFromBytes((idempotencyKey + "|" + purpose + "|" + applicationId).getBytes(StandardCharsets.UTF_8));
    }

    private static String text(JsonNode body, String field) {
        if (body == null || !body.hasNonNull(field)) {
            return null;
        }
        String v = body.get(field).asText().trim();
        return v.isEmpty() ? null : v;
    }

    private static UUID uuidField(JsonNode body, String field) {
        String v = text(body, field);
        if (v == null) {
            return null;
        }
        try {
            return UUID.fromString(v);
        } catch (Exception e) {
            return null;
        }
    }

    private static Optional<Integer> intField(JsonNode body, String field) {
        if (body == null || !body.has(field) || !body.get(field).canConvertToInt()) {
            return Optional.empty();
        }
        return Optional.of(body.get(field).asInt());
    }

    private static ResponseEntity<Map<String, Object>> error(HttpStatus status, String code) {
        return ApiErrors.response(status, code);
    }
}
