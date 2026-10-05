package gov.bee.api.ratingschemes;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import gov.bee.api.application.DraftRequestSupport;
import gov.bee.api.application.IdempotencyRepository;
import gov.bee.api.identity.Caller;
import gov.bee.api.ratingschemes.RatingSchemeRepository.Decided;
import gov.bee.api.ratingschemes.RatingSchemeRepository.NewProposal;
import gov.bee.api.ratingschemes.RatingSchemeRepository.Proposal;
import gov.bee.api.ratingschemes.RatingSchemeRepository.Scheme;
import gov.bee.api.web.ApiErrors;
import java.math.BigDecimal;
import java.security.MessageDigest;
import java.time.LocalDate;
import java.time.ZoneId;
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
 * Star-rating scheme administration (the owner's assumption A2, not a BEE decision). A person who holds the rating_scheme_manage
 * permission (the Administrator today) proposes a scheme (the lowest efficiency figure that earns each of 1 to 5 stars) from a date
 * that is not in the past; a DIFFERENT holder approves or rejects; the proposer may withdraw. Approval adds the scheme; the rating
 * step uses the scheme with the latest start on or before the day it computes. A scheme entered here is still a local demonstration,
 * not a BEE-approved formula, and every rating computed from it says so.
 */
@Service
public class RatingSchemeService {

    static final String PROPOSE_ROUTE = "/api/rating-schemes/proposals";
    static final String DECIDE_ROUTE = "/api/rating-schemes/proposals/{id}/decision";
    static final ZoneId INDIA = ZoneId.of("Asia/Kolkata");
    private static final Pattern CATEGORY = Pattern.compile("^[A-Z]{2,10}$");
    private static final Pattern FIGURE = Pattern.compile("^\\d{1,2}(\\.\\d{1,2})?$");
    private static final Pattern DATE = Pattern.compile("^\\d{4}-\\d{2}-\\d{2}$");
    private static final Pattern TEXT_300 = Pattern.compile("^[^\\p{Cntrl}]{1,300}$");
    private static final Pattern TEXT_500 = Pattern.compile("^[^\\p{Cntrl}]{1,500}$");

    private final RatingSchemeRepository repository;
    private final IdempotencyRepository idempotency;
    private final ObjectMapper json;

    public RatingSchemeService(RatingSchemeRepository repository, IdempotencyRepository idempotency, ObjectMapper json) {
        this.repository = repository;
        this.idempotency = idempotency;
        this.json = json;
    }

    private boolean mayManage(Caller caller) {
        var roles = repository.rolesHolding(RatingSchemeRepository.CAPABILITY);
        return caller.roles().stream().anyMatch(g -> roles.contains(g.role()));
    }

    public ResponseEntity<Map<String, Object>> read(Caller caller) {
        if (!mayManage(caller)) {
            return error(HttpStatus.FORBIDDEN, "role_not_permitted");
        }
        LocalDate today = LocalDate.now(INDIA);
        List<Scheme> all = repository.schemes();
        // The scheme in force for a category is the one with the latest start on or before today.
        Map<String, LocalDate> inForceStart = new LinkedHashMap<>();
        for (Scheme s : all) {
            if (!s.effectiveFrom().isAfter(today)) {
                inForceStart.merge(s.categoryCode(), s.effectiveFrom(), (a, b) -> a.isAfter(b) ? a : b);
            }
        }
        List<Map<String, Object>> schemes = new ArrayList<>();
        for (Scheme s : all) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("schemeKey", s.schemeKey());
            m.put("categoryCode", s.categoryCode());
            m.put("effectiveFrom", s.effectiveFrom().toString());
            m.put("bands", s.bands().stream().map(b -> Map.<String, Object>of("stars", b.stars(), "minIseer", b.minIseer().setScale(2).toPlainString())).toList());
            m.put("source", s.source());
            m.put("inForce", s.effectiveFrom().equals(inForceStart.get(s.categoryCode())));
            schemes.add(m);
        }
        List<Map<String, Object>> pending = new ArrayList<>();
        repository.pending().forEach(p -> pending.add(proposalView(p, caller)));
        List<Map<String, Object>> decided = new ArrayList<>();
        repository.recentDecided(20).forEach(p -> decided.add(proposalView(p, caller)));
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("today", today.toString());
        out.put("categories", repository.categoriesOn(today).stream().map(c -> Map.of("code", c.code(), "name", c.name())).toList());
        out.put("schemes", schemes);
        out.put("pending", pending);
        out.put("decided", decided);
        return ResponseEntity.ok(out);
    }

    @Transactional
    public ResponseEntity<Map<String, Object>> propose(Caller caller, String idempotencyKey, JsonNode body) {
        Optional<ResponseEntity<Map<String, Object>>> replay = replayOrRequireKey(caller, PROPOSE_ROUTE, IdempotencyRepository.CREATE_TARGET, idempotencyKey, body);
        if (replay.isPresent()) {
            return replay.get();
        }
        if (!mayManage(caller)) {
            return error(HttpStatus.FORBIDDEN, "role_not_permitted");
        }
        Optional<NewProposal> input = parsePropose(body, LocalDate.now(INDIA));
        if (input.isEmpty() || !repository.categoryAppliesOn(input.get().categoryCode(), input.get().effectiveFrom())) {
            return error(HttpStatus.UNPROCESSABLE_ENTITY, "validation_failed");
        }
        if (!idempotency.begin(caller.accountId(), "POST", PROPOSE_ROUTE, IdempotencyRepository.CREATE_TARGET, idempotencyKey, DraftRequestSupport.bodyHash(body))) {
            return error(HttpStatus.CONFLICT, "idempotency_in_progress");
        }
        Proposal saved = repository.insert(caller.accountId(), input.get());
        Map<String, Object> view = proposalView(saved, caller);
        idempotency.complete(caller.accountId(), "POST", PROPOSE_ROUTE, IdempotencyRepository.CREATE_TARGET, idempotencyKey, 201, writeJson(view), 0);
        return ResponseEntity.status(HttpStatus.CREATED).body(view);
    }

    @Transactional
    public ResponseEntity<Map<String, Object>> decide(Caller caller, UUID proposalId, String idempotencyKey, JsonNode body) {
        Optional<ResponseEntity<Map<String, Object>>> replay = replayOrRequireKey(caller, DECIDE_ROUTE, proposalId, idempotencyKey, body);
        if (replay.isPresent()) {
            return replay.get();
        }
        if (!mayManage(caller)) {
            return error(HttpStatus.FORBIDDEN, "role_not_permitted");
        }
        if (repository.proposal(proposalId).isEmpty()) {
            return error(HttpStatus.NOT_FOUND, "not_found");
        }
        if (body == null || !body.isObject() || !body.hasNonNull("decision") || !body.get("decision").isTextual()
            || !List.of("approve", "reject", "withdraw").contains(body.get("decision").asText())) {
            return error(HttpStatus.UNPROCESSABLE_ENTITY, "validation_failed");
        }
        String note = null;
        if (body.hasNonNull("note")) {
            if (!body.get("note").isTextual() || !TEXT_500.matcher(body.get("note").asText().trim()).matches()) {
                return error(HttpStatus.UNPROCESSABLE_ENTITY, "validation_failed");
            }
            note = body.get("note").asText().trim();
        }
        if (!idempotency.begin(caller.accountId(), "POST", DECIDE_ROUTE, proposalId, idempotencyKey, DraftRequestSupport.bodyHash(body))) {
            return error(HttpStatus.CONFLICT, "idempotency_in_progress");
        }
        Decided done = repository.decide(proposalId, caller.accountId(), body.get("decision").asText(), note);
        if (done.outcome() != RatingSchemeRepository.Outcome.DONE) {
            idempotency.abandon(caller.accountId(), "POST", DECIDE_ROUTE, proposalId, idempotencyKey);
            return switch (done.outcome()) {
                case NOT_FOUND -> error(HttpStatus.NOT_FOUND, "not_found");
                case NOT_PENDING -> error(HttpStatus.CONFLICT, "proposal_not_pending");
                case SAME_PERSON -> error(HttpStatus.FORBIDDEN, "segregation_refused");
                case DATE_PASSED -> error(HttpStatus.CONFLICT, "effective_date_passed");
                case RULE_CONFLICT -> error(HttpStatus.CONFLICT, "rule_conflict");
                default -> error(HttpStatus.FORBIDDEN, "role_not_permitted");
            };
        }
        Map<String, Object> view = proposalView(repository.proposal(proposalId).orElseThrow(), caller);
        idempotency.complete(caller.accountId(), "POST", DECIDE_ROUTE, proposalId, idempotencyKey, 200, writeJson(view), 0);
        return ResponseEntity.ok(view);
    }

    /** categoryCode, effectiveFrom (not before today), minIseer: exactly five figures, each above the one before (1 to 99.99, two decimals). */
    private static Optional<NewProposal> parsePropose(JsonNode b, LocalDate today) {
        if (b == null || !b.isObject() || !text(b, "categoryCode") || !text(b, "effectiveFrom") || !text(b, "sourceReference") || !text(b, "reason")
            || !b.hasNonNull("minIseer") || !b.get("minIseer").isArray() || b.get("minIseer").size() != 5) {
            return Optional.empty();
        }
        List<BigDecimal> figures = new ArrayList<>();
        for (JsonNode n : b.get("minIseer")) {
            if (!n.isTextual() || !FIGURE.matcher(n.asText().trim()).matches()) {
                return Optional.empty();
            }
            figures.add(new BigDecimal(n.asText().trim()));
        }
        for (int i = 0; i < 5; i++) {
            if (figures.get(i).signum() <= 0 || (i > 0 && figures.get(i).compareTo(figures.get(i - 1)) <= 0)) {
                return Optional.empty();
            }
        }
        String category = b.get("categoryCode").asText().trim();
        String date = b.get("effectiveFrom").asText().trim();
        String source = b.get("sourceReference").asText().trim();
        String reason = b.get("reason").asText().trim();
        if (!CATEGORY.matcher(category).matches() || !DATE.matcher(date).matches() || !TEXT_300.matcher(source).matches() || !TEXT_500.matcher(reason).matches()) {
            return Optional.empty();
        }
        LocalDate from;
        try {
            from = LocalDate.parse(date);
        } catch (Exception e) {
            return Optional.empty();
        }
        if (from.isBefore(today)) {
            return Optional.empty();
        }
        return Optional.of(new NewProposal(category, from, figures, source, reason));
    }

    private static boolean text(JsonNode b, String field) {
        return b.hasNonNull(field) && b.get(field).isTextual();
    }

    private static Map<String, Object> proposalView(Proposal p, Caller caller) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", p.id().toString());
        m.put("categoryCode", p.categoryCode());
        m.put("effectiveFrom", p.effectiveFrom().toString());
        m.put("minIseer", p.minIseer().stream().map(v -> v.setScale(2).toPlainString()).toList());
        m.put("sourceReference", p.sourceReference());
        m.put("reason", p.reason());
        m.put("state", p.state());
        m.put("proposedBy", p.proposedBy());
        m.put("proposedByYou", p.proposedById().equals(caller.accountId()));
        m.put("proposedAt", p.proposedAt().toString());
        m.put("decidedBy", p.decidedBy());
        m.put("decidedAt", p.decidedAt() == null ? null : p.decidedAt().toString());
        m.put("decisionNote", p.decisionNote());
        m.put("appliedScheme", p.appliedScheme());
        return m;
    }

    private Optional<ResponseEntity<Map<String, Object>>> replayOrRequireKey(Caller caller, String route, UUID target, String key, JsonNode body) {
        if (key == null || !DraftRequestSupport.IDEMPOTENCY_KEY.matcher(key).matches()) {
            return Optional.of(error(HttpStatus.UNPROCESSABLE_ENTITY, "idempotency_key_required"));
        }
        var stored = idempotency.find(caller.accountId(), "POST", route, target, key);
        if (stored.isEmpty()) {
            return Optional.empty();
        }
        var s = stored.get();
        if (s.inProgress()) {
            return Optional.of(error(HttpStatus.CONFLICT, "idempotency_in_progress"));
        }
        Optional<byte[]> priorHash = idempotency.bodyHash(caller.accountId(), "POST", route, target, key);
        if (priorHash.isEmpty() || !MessageDigest.isEqual(priorHash.get(), DraftRequestSupport.bodyHash(body))) {
            return Optional.of(error(HttpStatus.CONFLICT, "idempotency_key_conflict"));
        }
        if (!mayManage(caller)) {
            return Optional.of(error(HttpStatus.FORBIDDEN, "role_not_permitted"));
        }
        try {
            @SuppressWarnings("unchecked")
            Map<String, Object> replayBody = json.readValue(s.responseBody(), Map.class);
            return Optional.of(ResponseEntity.status(s.responseStatus()).header("Idempotency-Replayed", "true").body(replayBody));
        } catch (Exception e) {
            return Optional.of(error(HttpStatus.INTERNAL_SERVER_ERROR, "internal_error"));
        }
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
}
