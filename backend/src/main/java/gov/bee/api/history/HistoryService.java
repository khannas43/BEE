package gov.bee.api.history;

import gov.bee.api.application.ModelApplicationRepository;
import gov.bee.api.identity.Caller;
import gov.bee.api.policy.ApplicationFacts;
import gov.bee.api.policy.SlicePolicy;
import gov.bee.api.web.ApiErrors;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The history read (FIRST_SLICE.md section 4 and acceptance check 6): every transition from submission on, in order, with
 * who took it, in which role and organisation, when, and the note or reason. Provisional local rules, not BEE rules.
 *
 * <p>Who may read it is exactly who may read the application: the same scope, the same stage, the same 404 for anything
 * else. What each reader sees of it is the provisional rule below (decision B13, unanswered by BEE):
 * <ul>
 *   <li>An <b>officer</b> sees every note, finding and fact, and the name of whoever took each step.</li>
 *   <li>The <b>applicant</b> (a reader from the application's own organisation) sees the whole timeline, but only the notes
 *       addressed to them: the payment confirmation, a return or rejection reason, and their own resubmission. The officers'
 *       internal notes, findings and the rating figures are withheld and the entry says so; no personal names are shown.</li>
 * </ul>
 */
@Service
public class HistoryService {

    private static final Set<String> INTERNAL = Set.of("iame_recommend", "reviewer_forward", "compute_rating", "director_recommend", "secretary_approve");

    private final ModelApplicationRepository applications;
    private final HistoryRepository repository;

    public HistoryService(ModelApplicationRepository applications, HistoryRepository repository) {
        this.applications = applications;
        this.repository = repository;
    }

    @Transactional(readOnly = true)
    public ResponseEntity<Map<String, Object>> read(Caller caller, UUID appId) {
        var scope = SlicePolicy.readScope(caller);
        if (scope.isEmpty()) {
            return error(HttpStatus.FORBIDDEN, "no_read_scope");
        }
        Optional<ModelApplicationRepository.Row> found = applications.find(appId, scope, caller.accountId())
            .filter(r -> SlicePolicy.canRead(scope, new ApplicationFacts(r.id(), r.organisationId(), r.state(), r.assignedStagesForCaller(), Set.of(), false)));
        if (found.isEmpty()) {
            return error(HttpStatus.NOT_FOUND, "not_found");
        }
        ModelApplicationRepository.Row row = found.get();
        // A reader from the application's own organisation is the applicant; the stricter view applies to them.
        boolean applicant = scope.organisations().contains(row.organisationId());
        List<Map<String, Object>> items = new ArrayList<>();
        int sequence = 0;
        for (HistoryRepository.Row e : repository.events(appId)) {
            items.add(item(++sequence, e, applicant));
        }
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("applicationId", appId.toString());
        body.put("reference", row.reference());
        body.put("viewedAs", applicant ? "applicant" : "officer");
        body.put("items", items);
        body.put("count", items.size());
        return ResponseEntity.ok(body);
    }

    private static Map<String, Object> item(int sequence, HistoryRepository.Row e, boolean applicant) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("sequence", sequence);
        m.put("at", e.at().toString());
        m.put("action", e.action());
        m.put("fromState", e.fromState());
        m.put("toState", e.toState());
        m.put("actorRole", e.actorRole());
        if (!applicant) {
            m.put("actorName", e.actorName());
        }
        m.put("actorOrganisation", e.actorOrganisation() == null ? "—" : e.actorOrganisation());
        boolean withheld = applicant && INTERNAL.contains(e.action());
        List<Map<String, String>> facts = new ArrayList<>();
        String note = null;
        if (!withheld) {
            note = switch (e.action()) {
                case "iame_recommend" -> e.iameNote();
                case "reviewer_forward" -> e.reviewerNote();
                case "director_recommend" -> e.directorNote();
                case "secretary_approve" -> e.secretaryNote();
                case "return" -> e.returnReason();
                case "resubmit" -> e.resubmitNote();
                case "reject" -> e.rejectReason();
                default -> null;
            };
            switch (e.action()) {
                case "confirm_fee" -> {
                    facts.add(fact("Receipt reference", e.receiptReference()));
                    facts.add(fact("Amount received", "₹" + plain(e.feeAmount())));
                    facts.add(fact("Received on", String.valueOf(e.receivedOn())));
                    // A correction never rewrites the confirmation; it is shown beside it. The applicant sees the right values, not who approved.
                    if (e.correctedReceiptReference() != null) {
                        facts.add(fact("Corrected receipt reference", e.correctedReceiptReference()));
                        facts.add(fact("Corrected received on", String.valueOf(e.correctedReceivedOn())));
                        if (!applicant) {
                            facts.add(fact("Correction approved by", e.correctionApprovedBy()));
                        }
                    }
                }
                case "iame_recommend" -> facts.add(fact("Finding on the test report", "verified".equals(e.iameVerification()) ? "Verified" : "Not verified"));
                case "compute_rating" -> {
                    facts.add(fact("Stars", e.stars() + " (local demonstration, not a BEE rating)"));
                    facts.add(fact("Declared efficiency", plain(e.declaredIseer())));
                    facts.add(fact("Verified efficiency", plain(e.verifiedIseer())));
                    facts.add(fact("Rating version", String.valueOf(e.ratingVersion())));
                }
                case "director_recommend" -> facts.add(fact("Final for this category", Boolean.TRUE.equals(e.directorFinal()) ? "Yes" : "No"));
                case "resubmit" -> {
                    if (Boolean.TRUE.equals(e.ratingSuperseded())) {
                        facts.add(fact("Earlier rating", "Replaced; the application goes through rating again"));
                    }
                }
                default -> {
                }
            }
        }
        if (note != null && !note.isBlank()) {
            m.put("note", note);
        }
        m.put("facts", facts);
        m.put("withheld", withheld);
        return m;
    }

    private static Map<String, String> fact(String label, String value) {
        Map<String, String> f = new LinkedHashMap<>();
        f.put("label", label);
        f.put("value", value == null ? "—" : value);
        return f;
    }

    private static String plain(BigDecimal v) {
        return v == null ? "—" : v.toPlainString();
    }

    private static ResponseEntity<Map<String, Object>> error(HttpStatus status, String code) {
        return ApiErrors.response(status, code);
    }
}
