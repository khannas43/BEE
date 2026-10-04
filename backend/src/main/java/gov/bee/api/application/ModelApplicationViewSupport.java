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
}
