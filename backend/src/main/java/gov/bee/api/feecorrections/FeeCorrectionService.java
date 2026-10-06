package gov.bee.api.feecorrections;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import gov.bee.api.application.DraftRequestSupport;
import gov.bee.api.application.IdempotencyRepository;
import gov.bee.api.feecorrections.FeeCorrectionRepository.Confirmation;
import gov.bee.api.feecorrections.FeeCorrectionRepository.Decided;
import gov.bee.api.feecorrections.FeeCorrectionRepository.NewProposal;
import gov.bee.api.feecorrections.FeeCorrectionRepository.Proposal;
import gov.bee.api.identity.Caller;
import gov.bee.api.web.ApiErrors;
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
 * Corrections to a fee confirmation (the owner's assumption B11, not a BEE decision). A person who holds the
 * fee_confirmation_correct permission (Finance today) proposes the right receipt reference and date received, with a reason; a
 * DIFFERENT holder approves or rejects; the proposer may withdraw. Neither may belong to the paying organisation or have acted at
 * another stage of the application. The confirmation is never edited: the values in effect are the latest approved correction.
 */
@Service
public class FeeCorrectionService {

    static final String PROPOSE_ROUTE = "/api/fee-corrections/proposals";
    static final String DECIDE_ROUTE = "/api/fee-corrections/proposals/{id}/decision";
    static final String REVERSE_ROUTE = "/api/fee-corrections/reversals";
    static final String REVERSE_DECIDE_ROUTE = "/api/fee-corrections/reversals/{id}/decision";
    static final ZoneId INDIA = ZoneId.of("Asia/Kolkata");
    /** The same receipt-reference rule as the confirmation itself. */
    private static final Pattern RECEIPT = Pattern.compile("^[A-Za-z0-9][A-Za-z0-9 ./_-]{0,63}$");
    private static final Pattern DATE = Pattern.compile("^\\d{4}-\\d{2}-\\d{2}$");
    private static final Pattern TEXT_500 = Pattern.compile("^[^\\p{Cntrl}]{1,500}$");
    private static final Pattern UUID_TEXT = Pattern.compile("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$");

    private final FeeCorrectionRepository repository;
    private final IdempotencyRepository idempotency;
    private final ObjectMapper json;

    public FeeCorrectionService(FeeCorrectionRepository repository, IdempotencyRepository idempotency, ObjectMapper json) {
        this.repository = repository;
        this.idempotency = idempotency;
        this.json = json;
    }

    private boolean mayCorrect(Caller caller) {
        var roles = repository.rolesHolding(FeeCorrectionRepository.CAPABILITY);
        return caller.roles().stream().anyMatch(g -> roles.contains(g.role()));
    }

    public ResponseEntity<Map<String, Object>> read(Caller caller) {
        if (!mayCorrect(caller)) {
            return error(HttpStatus.FORBIDDEN, "role_not_permitted");
        }
        List<Map<String, Object>> confirmations = new ArrayList<>();
        repository.recentConfirmations(50).forEach(c -> confirmations.add(confirmationView(c)));
        List<Map<String, Object>> pending = new ArrayList<>();
        repository.pending().forEach(p -> pending.add(proposalView(p, caller)));
        List<Map<String, Object>> decided = new ArrayList<>();
        repository.recentDecided(20).forEach(p -> decided.add(proposalView(p, caller)));
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("today", LocalDate.now(INDIA).toString());
        out.put("confirmations", confirmations);
        out.put("pending", pending);
        out.put("decided", decided);
        List<Map<String, Object>> reversalsPending = new ArrayList<>();
        repository.pendingReversals().forEach(r -> reversalsPending.add(reversalView(r, caller)));
        List<Map<String, Object>> reversalsDecided = new ArrayList<>();
        repository.recentDecidedReversals(20).forEach(r -> reversalsDecided.add(reversalView(r, caller)));
        out.put("reversalsPending", reversalsPending);
        out.put("reversalsDecided", reversalsDecided);
        return ResponseEntity.ok(out);
    }

    @Transactional
    public ResponseEntity<Map<String, Object>> propose(Caller caller, String idempotencyKey, JsonNode body) {
        Optional<ResponseEntity<Map<String, Object>>> replay = replayOrRequireKey(caller, PROPOSE_ROUTE, IdempotencyRepository.CREATE_TARGET, idempotencyKey, body);
        if (replay.isPresent()) {
            return replay.get();
        }
        if (!mayCorrect(caller)) {
            return error(HttpStatus.FORBIDDEN, "role_not_permitted");
        }
        Optional<Input> input = parsePropose(body, LocalDate.now(INDIA));
        if (input.isEmpty()) {
            return error(HttpStatus.UNPROCESSABLE_ENTITY, "validation_failed");
        }
        Optional<Confirmation> found = repository.confirmationOf(input.get().applicationId());
        if (found.isEmpty()) {
            return error(HttpStatus.NOT_FOUND, "not_found");
        }
        Confirmation c = found.get();
        if (repository.segregated(c.applicationId(), caller.accountId())) {
            return error(HttpStatus.FORBIDDEN, "segregation_refused");
        }
        if (input.get().receiptReference().equals(c.effectiveReceiptReference()) && input.get().receivedOn().equals(c.effectiveReceivedOn())) {
            return error(HttpStatus.UNPROCESSABLE_ENTITY, "validation_failed");
        }
        if (c.pendingProposalId() != null) {
            return error(HttpStatus.CONFLICT, "correction_already_pending");
        }
        if (c.pendingReversalId() != null) {
            return error(HttpStatus.CONFLICT, "reversal_already_pending");
        }
        if (!idempotency.begin(caller.accountId(), "POST", PROPOSE_ROUTE, IdempotencyRepository.CREATE_TARGET, idempotencyKey, DraftRequestSupport.bodyHash(body))) {
            return error(HttpStatus.CONFLICT, "idempotency_in_progress");
        }
        Proposal saved = repository.insert(caller.accountId(), new NewProposal(c.applicationId(), c.confirmationId(), c.effectiveReceiptReference(), c.effectiveReceivedOn(),
            input.get().receiptReference(), input.get().receivedOn(), input.get().reason()));
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
        if (!mayCorrect(caller)) {
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
        if (done.outcome() != FeeCorrectionRepository.Outcome.DONE) {
            idempotency.abandon(caller.accountId(), "POST", DECIDE_ROUTE, proposalId, idempotencyKey);
            return switch (done.outcome()) {
                case NOT_FOUND -> error(HttpStatus.NOT_FOUND, "not_found");
                case NOT_PENDING -> error(HttpStatus.CONFLICT, "proposal_not_pending");
                case SAME_PERSON, SEGREGATED -> error(HttpStatus.FORBIDDEN, "segregation_refused");
                default -> error(HttpStatus.FORBIDDEN, "role_not_permitted");
            };
        }
        Map<String, Object> view = proposalView(repository.proposal(proposalId).orElseThrow(), caller);
        idempotency.complete(caller.accountId(), "POST", DECIDE_ROUTE, proposalId, idempotencyKey, 200, writeJson(view), 0);
        return ResponseEntity.ok(view);
    }

    /** Propose reversing the confirmation in effect for an application (BL-142; the owner's assumption B17). */
    @Transactional
    public ResponseEntity<Map<String, Object>> proposeReversal(Caller caller, String idempotencyKey, JsonNode body) {
        Optional<ResponseEntity<Map<String, Object>>> replay = replayOrRequireKey(caller, REVERSE_ROUTE, IdempotencyRepository.CREATE_TARGET, idempotencyKey, body);
        if (replay.isPresent()) {
            return replay.get();
        }
        if (!mayCorrect(caller)) {
            return error(HttpStatus.FORBIDDEN, "role_not_permitted");
        }
        if (body == null || !body.isObject() || !text(body, "applicationId") || !text(body, "reason")) {
            return error(HttpStatus.UNPROCESSABLE_ENTITY, "validation_failed");
        }
        String id = body.get("applicationId").asText().trim();
        String reason = body.get("reason").asText().trim();
        if (!UUID_TEXT.matcher(id).matches() || !TEXT_500.matcher(reason).matches()) {
            return error(HttpStatus.UNPROCESSABLE_ENTITY, "validation_failed");
        }
        Optional<Confirmation> found = repository.confirmationOf(UUID.fromString(id));
        if (found.isEmpty()) {
            return error(HttpStatus.NOT_FOUND, "not_found");
        }
        Confirmation c = found.get();
        if (repository.segregated(c.applicationId(), caller.accountId())) {
            return error(HttpStatus.FORBIDDEN, "segregation_refused");
        }
        if (c.pendingProposalId() != null) {
            return error(HttpStatus.CONFLICT, "correction_already_pending");
        }
        if (c.pendingReversalId() != null) {
            return error(HttpStatus.CONFLICT, "reversal_already_pending");
        }
        if (!repository.reversalPossible(c.applicationId(), c.confirmationId())) {
            return error(HttpStatus.CONFLICT, "reversal_not_possible");
        }
        if (!idempotency.begin(caller.accountId(), "POST", REVERSE_ROUTE, IdempotencyRepository.CREATE_TARGET, idempotencyKey, DraftRequestSupport.bodyHash(body))) {
            return error(HttpStatus.CONFLICT, "idempotency_in_progress");
        }
        FeeCorrectionRepository.Reversal saved = repository.insertReversal(caller.accountId(), c.applicationId(), c.confirmationId(), reason);
        Map<String, Object> view = reversalView(saved, caller);
        idempotency.complete(caller.accountId(), "POST", REVERSE_ROUTE, IdempotencyRepository.CREATE_TARGET, idempotencyKey, 201, writeJson(view), 0);
        return ResponseEntity.status(HttpStatus.CREATED).body(view);
    }

    /** Approve, reject or withdraw a reversal. Approving moves the application back to fee due, in the same transaction (V40). */
    @Transactional
    public ResponseEntity<Map<String, Object>> decideReversal(Caller caller, UUID proposalId, String idempotencyKey, JsonNode body) {
        Optional<ResponseEntity<Map<String, Object>>> replay = replayOrRequireKey(caller, REVERSE_DECIDE_ROUTE, proposalId, idempotencyKey, body);
        if (replay.isPresent()) {
            return replay.get();
        }
        if (!mayCorrect(caller)) {
            return error(HttpStatus.FORBIDDEN, "role_not_permitted");
        }
        if (repository.reversal(proposalId).isEmpty()) {
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
        if (!idempotency.begin(caller.accountId(), "POST", REVERSE_DECIDE_ROUTE, proposalId, idempotencyKey, DraftRequestSupport.bodyHash(body))) {
            return error(HttpStatus.CONFLICT, "idempotency_in_progress");
        }
        var done = repository.decideReversal(proposalId, caller.accountId(), body.get("decision").asText(), note);
        if (done.outcome() != FeeCorrectionRepository.ReversalOutcome.DONE) {
            idempotency.abandon(caller.accountId(), "POST", REVERSE_DECIDE_ROUTE, proposalId, idempotencyKey);
            return switch (done.outcome()) {
                case NOT_FOUND -> error(HttpStatus.NOT_FOUND, "not_found");
                case NOT_PENDING -> error(HttpStatus.CONFLICT, "proposal_not_pending");
                case NOT_POSSIBLE -> error(HttpStatus.CONFLICT, "reversal_not_possible");
                case SAME_PERSON, SEGREGATED -> error(HttpStatus.FORBIDDEN, "segregation_refused");
                default -> error(HttpStatus.FORBIDDEN, "role_not_permitted");
            };
        }
        Map<String, Object> view = reversalView(repository.reversal(proposalId).orElseThrow(), caller);
        idempotency.complete(caller.accountId(), "POST", REVERSE_DECIDE_ROUTE, proposalId, idempotencyKey, 200, writeJson(view), 0);
        return ResponseEntity.ok(view);
    }

    private static Map<String, Object> reversalView(FeeCorrectionRepository.Reversal r, Caller caller) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", r.id().toString());
        m.put("applicationId", r.applicationId().toString());
        m.put("reference", r.reference());
        m.put("reason", r.reason());
        m.put("state", r.state());
        m.put("proposedBy", r.proposedBy());
        m.put("proposedByYou", r.proposedById().equals(caller.accountId()));
        m.put("proposedAt", r.proposedAt().toString());
        m.put("decidedBy", r.decidedBy());
        m.put("decidedAt", r.decidedAt() == null ? null : r.decidedAt().toString());
        m.put("decisionNote", r.decisionNote());
        return m;
    }

    private record Input(UUID applicationId, String receiptReference, LocalDate receivedOn, String reason) {
    }

    /** applicationId, receiptReference (the confirmation's rule), receivedOn (a date not after today), reason (1 to 500 characters). */
    private static Optional<Input> parsePropose(JsonNode b, LocalDate today) {
        if (b == null || !b.isObject() || !text(b, "applicationId") || !text(b, "receiptReference") || !text(b, "receivedOn") || !text(b, "reason")) {
            return Optional.empty();
        }
        String id = b.get("applicationId").asText().trim();
        String receipt = b.get("receiptReference").asText().trim();
        String date = b.get("receivedOn").asText().trim();
        String reason = b.get("reason").asText().trim();
        if (!UUID_TEXT.matcher(id).matches() || !RECEIPT.matcher(receipt).matches() || !DATE.matcher(date).matches() || !TEXT_500.matcher(reason).matches()) {
            return Optional.empty();
        }
        LocalDate on;
        try {
            on = LocalDate.parse(date);
        } catch (Exception e) {
            return Optional.empty();
        }
        if (on.isAfter(today)) {
            return Optional.empty();
        }
        return Optional.of(new Input(UUID.fromString(id), receipt, on, reason));
    }

    private static boolean text(JsonNode b, String field) {
        return b.hasNonNull(field) && b.get(field).isTextual();
    }

    private static Map<String, Object> confirmationView(Confirmation c) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("applicationId", c.applicationId().toString());
        m.put("reference", c.reference());
        m.put("brandName", c.brand());
        m.put("modelNumber", c.modelNumber());
        m.put("state", c.state());
        m.put("receiptReference", c.receiptReference());
        m.put("receivedOn", c.receivedOn().toString());
        m.put("amountInr", c.amountInr().setScale(2).toPlainString());
        m.put("confirmedBy", c.confirmedBy());
        m.put("confirmedAt", c.confirmedAt().toString());
        if (c.correctedReceiptReference() == null) {
            m.put("correction", null);
        } else {
            Map<String, Object> k = new LinkedHashMap<>();
            k.put("receiptReference", c.correctedReceiptReference());
            k.put("receivedOn", c.correctedReceivedOn().toString());
            k.put("approvedBy", c.correctionApprovedBy());
            k.put("approvedAt", c.correctionApprovedAt().toString());
            m.put("correction", k);
        }
        m.put("pendingProposalId", c.pendingProposalId() == null ? null : c.pendingProposalId().toString());
        if (c.reversed()) {
            Map<String, Object> k = new LinkedHashMap<>();
            k.put("reversedBy", c.reversedBy());
            k.put("reversedAt", c.reversedAt().toString());
            m.put("reversal", k);
        } else {
            m.put("reversal", null);
        }
        m.put("pendingReversalId", c.pendingReversalId() == null ? null : c.pendingReversalId().toString());
        return m;
    }

    private static Map<String, Object> proposalView(Proposal p, Caller caller) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", p.id().toString());
        m.put("applicationId", p.applicationId().toString());
        m.put("reference", p.reference());
        m.put("previousReceiptReference", p.previousReceiptReference());
        m.put("previousReceivedOn", p.previousReceivedOn().toString());
        m.put("receiptReference", p.receiptReference());
        m.put("receivedOn", p.receivedOn().toString());
        m.put("reason", p.reason());
        m.put("state", p.state());
        m.put("proposedBy", p.proposedBy());
        m.put("proposedByYou", p.proposedById().equals(caller.accountId()));
        m.put("proposedAt", p.proposedAt().toString());
        m.put("decidedBy", p.decidedBy());
        m.put("decidedAt", p.decidedAt() == null ? null : p.decidedAt().toString());
        m.put("decisionNote", p.decisionNote());
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
        if (!mayCorrect(caller)) {
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
