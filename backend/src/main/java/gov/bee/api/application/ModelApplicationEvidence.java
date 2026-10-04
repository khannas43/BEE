package gov.bee.api.application;

import gov.bee.api.document.DocumentRepository;
import gov.bee.api.masters.MasterDataService;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

/**
 * WP05.1d submit-time evidence gates. Provisional local defaults, not BEE rules (docs/wp05/WP05.1d_DECISIONS.md):
 * a test report, the declared efficiency, a test date that is not in the future, a laboratory with an active
 * accreditation for the category on the test date, an applicable standard on that date, and a brand and model
 * number no other live application holds. Every gate is evaluated, so the submit preview can list what is missing;
 * submit refuses on the first unmet gate in the order below.
 */
@Component
public class ModelApplicationEvidence {

    /** Order is the order submit reports them. */
    public enum Gate {
        TEST_REPORT_REQUIRED("test_report_required", HttpStatus.UNPROCESSABLE_ENTITY),
        DECLARED_EFFICIENCY_REQUIRED("declared_efficiency_required", HttpStatus.UNPROCESSABLE_ENTITY),
        TEST_DATE_INVALID("test_date_invalid", HttpStatus.UNPROCESSABLE_ENTITY),
        LABORATORY_NOT_ACCREDITED("laboratory_not_accredited", HttpStatus.UNPROCESSABLE_ENTITY),
        STANDARD_NOT_AVAILABLE("standard_not_available", HttpStatus.UNPROCESSABLE_ENTITY),
        DUPLICATE_MODEL("duplicate_model", HttpStatus.CONFLICT);

        private final String code;
        private final HttpStatus status;

        Gate(String code, HttpStatus status) {
            this.code = code;
            this.status = status;
        }

        public String code() {
            return code;
        }

        public HttpStatus status() {
            return status;
        }
    }

    public record GateResult(Gate gate, boolean met) {
    }

    /** The master versions the checks resolved, kept on the application at submit for traceability. */
    public record Resolved(String accreditationRuleKey, int accreditationVersion, String standardRuleKey, int standardVersion) {
    }

    public record Result(List<GateResult> gates, Optional<Resolved> resolved) {
        public boolean allMet() {
            return gates.stream().allMatch(GateResult::met);
        }

        public Optional<Gate> firstUnmet() {
            return gates.stream().filter(g -> !g.met()).map(GateResult::gate).findFirst();
        }
    }

    static final String KIND_TEST_REPORT = "test_report";
    static final String STANDARD_PURPOSE = "performance_test";

    private final DocumentRepository documents;
    private final MasterDataService masters;
    private final ModelApplicationRepository applications;

    public ModelApplicationEvidence(DocumentRepository documents, MasterDataService masters, ModelApplicationRepository applications) {
        this.documents = documents;
        this.masters = masters;
        this.applications = applications;
    }

    public Result evaluate(ModelApplicationRepository.Row row, LocalDate today) {
        boolean report = documents.findByApplicationAndKind(row.id(), KIND_TEST_REPORT)
            .map(d -> !documents.listVersions(d.id()).isEmpty()).orElse(false);
        boolean iseer = row.declaredIseer() != null;
        boolean date = row.testedOn() != null && !row.testedOn().isAfter(today);

        var accreditation = date && row.laboratoryCode() != null
            ? masters.accreditation(row.laboratoryCode(), row.category(), row.testedOn()) : null;
        // Active in the accreditation master on the test date AND still an active laboratory organisation now.
        boolean accredited = accreditation != null && accreditation.accredited() && applications.laboratoryExists(row.laboratoryCode());
        var standard = date ? masters.applicableStandard(row.category(), STANDARD_PURPOSE, row.testedOn()) : Optional.<gov.bee.api.masters.Masters.Standard>empty();
        boolean standardOk = standard.isPresent();
        // A legacy row without a brand link is outside the uniqueness rule (it cannot be submitted anyway).
        boolean unique = row.brandId() == null || !applications.modelNumberTaken(row.brandId(), row.modelNumber(), row.id());

        List<GateResult> gates = new ArrayList<>();
        gates.add(new GateResult(Gate.TEST_REPORT_REQUIRED, report));
        gates.add(new GateResult(Gate.DECLARED_EFFICIENCY_REQUIRED, iseer));
        gates.add(new GateResult(Gate.TEST_DATE_INVALID, date));
        gates.add(new GateResult(Gate.LABORATORY_NOT_ACCREDITED, accredited));
        gates.add(new GateResult(Gate.STANDARD_NOT_AVAILABLE, standardOk));
        gates.add(new GateResult(Gate.DUPLICATE_MODEL, unique));

        Optional<Resolved> resolved = accredited && standardOk
            ? Optional.of(new Resolved(accreditation.record().get().version().ruleKey(), accreditation.record().get().version().version(),
                standard.get().version().ruleKey(), standard.get().version().version()))
            : Optional.empty();
        return new Result(List.copyOf(gates), resolved);
    }
}
