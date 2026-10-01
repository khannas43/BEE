package gov.bee.api.masters;

import gov.bee.api.masters.Masters.FeeRule;
import gov.bee.api.masters.Masters.LabAccreditation;
import gov.bee.api.masters.Masters.RatingFormula;
import gov.bee.api.masters.Masters.Standard;
import java.time.LocalDate;
import java.util.Optional;
import org.springframework.stereotype.Service;

/**
 * Resolves effective-dated masters for a supplied calendar date (India Standard Time; the
 * caller converts any instant). Internal only: no controller, permission or write uses it
 * yet. WP05.1 (submission: category, standard, accreditation, fee) and WP05.2 (rating
 * formula) consume it when their actions are built.
 */
@Service
public class MasterDataService {

    /** Why a laboratory is or is not accredited for a category at a date. */
    public enum AccreditationOutcome { ACCREDITED, SUSPENDED, WITHDRAWN, NO_RECORD }

    public record Accreditation(AccreditationOutcome outcome, Optional<LabAccreditation> record) {
        public boolean accredited() {
            return outcome == AccreditationOutcome.ACCREDITED;
        }
    }

    private final MasterDataRepository repository;

    public MasterDataService(MasterDataRepository repository) {
        this.repository = repository;
    }

    /** True if the category master has a version on that date. */
    public boolean categoryApplies(String category, LocalDate at) {
        return repository.category(category, at).isPresent();
    }

    /** The standard for a category and purpose on that date; empty before the first version and in a gap. */
    public Optional<Standard> applicableStandard(String category, String purpose, LocalDate at) {
        return categoryApplies(category, at) ? repository.standard(category, purpose, at) : Optional.empty();
    }

    /** A record in force with a suspended or withdrawn status is not an accreditation. */
    public Accreditation accreditation(String laboratoryCode, String category, LocalDate at) {
        Optional<LabAccreditation> record = repository.labAccreditation(laboratoryCode, category, at);
        AccreditationOutcome outcome = record.map(r -> switch (r.status()) {
            case "active" -> AccreditationOutcome.ACCREDITED;
            case "suspended" -> AccreditationOutcome.SUSPENDED;
            default -> AccreditationOutcome.WITHDRAWN;
        }).orElse(AccreditationOutcome.NO_RECORD);
        return new Accreditation(outcome, record);
    }

    /** The fee rule on that date, with its provenance; empty if none applies. Never BEE-approved today. */
    public Optional<FeeRule> feeRule(String category, String applicationType, LocalDate at) {
        return categoryApplies(category, at) ? repository.feeRule(category, applicationType, at) : Optional.empty();
    }

    /** Rating-formula metadata on that date. Nothing here computes a rating. */
    public Optional<RatingFormula> ratingFormula(String category, LocalDate at) {
        return categoryApplies(category, at) ? repository.ratingFormula(category, at) : Optional.empty();
    }
}
