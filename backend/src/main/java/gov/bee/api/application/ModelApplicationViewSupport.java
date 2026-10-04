package gov.bee.api.application;

import gov.bee.api.policy.SlicePolicy.ReadScope;
import java.util.Map;
import java.util.Optional;

/** Shared read views including stored submission fee (WP05.1c review). */
final class ModelApplicationViewSupport {

    private ModelApplicationViewSupport() {
    }

    static Map<String, Object> readView(ModelApplicationRepository.Row row, ReadScope scope,
                                       Optional<ModelApplicationSubmitRepository.FeeSnapshotRow> fee) {
        Map<String, Object> m = ModelApplicationDraftService.view(row, scope);
        fee.ifPresent(s -> m.put("submissionFee", ModelApplicationSubmitService.feeViewFromSnapshot(s)));
        return m;
    }

    /** The detail read: the view plus the latest rating once there is one (PROVISIONAL LOCAL DEMONSTRATION, never a BEE rating). */
    static Map<String, Object> detailView(ModelApplicationRepository.Row row, ReadScope scope,
                                          Optional<ModelApplicationSubmitRepository.FeeSnapshotRow> fee,
                                          Optional<ModelApplicationSubmitRepository.RatingRow> rating,
                                          Optional<ModelApplicationSubmitRepository.ReturnRow> openReturn,
                                          Optional<ModelApplicationSubmitRepository.RejectionRow> rejection) {
        Map<String, Object> m = readView(row, scope, fee);
        rejection.ifPresent(r -> {
            Map<String, Object> v = new java.util.LinkedHashMap<>();
            v.put("fromState", r.fromState());
            v.put("reason", r.reason());
            v.put("rejectedAt", r.rejectedAt().toString());
            m.put("rejection", v);
        });
        openReturn.ifPresent(r -> {
            Map<String, Object> v = new java.util.LinkedHashMap<>();
            v.put("fromState", r.fromState());
            v.put("reason", r.reason());
            v.put("returnedAt", r.returnedAt().toString());
            m.put("returnNote", v);
        });
        rating.ifPresent(r -> {
            Map<String, Object> v = new java.util.LinkedHashMap<>();
            v.put("ratingVersion", r.ratingVersion());
            v.put("schemeKey", r.schemeKey());
            v.put("declaredIseer", r.declaredIseer().toPlainString());
            v.put("verifiedIseer", r.verifiedIseer().toPlainString());
            v.put("stars", r.stars());
            v.put("localDemoRating", true);
            v.put("computedAt", r.computedAt().toString());
            m.put("rating", v);
        });
        return m;
    }
}
