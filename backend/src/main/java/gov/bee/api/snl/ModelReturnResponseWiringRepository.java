package gov.bee.api.snl;

import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class ModelReturnResponseWiringRepository {

    public record CycleRow(UUID id, UUID applicationId, String reviewStage, UUID taskId, UUID discrepancyId, String lastResumedStage) {
    }

    private final JdbcTemplate jdbc;

    public ModelReturnResponseWiringRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public Optional<CycleRow> findCycle(UUID applicationId) {
        return jdbc.query(
            "SELECT id, application_id, review_stage, task_id, discrepancy_id, last_resumed_stage FROM model_return_response_cycle WHERE application_id = ?",
            (rs, i) -> new CycleRow(
                rs.getObject("id", UUID.class),
                rs.getObject("application_id", UUID.class),
                rs.getString("review_stage"),
                rs.getObject("task_id", UUID.class),
                rs.getObject("discrepancy_id", UUID.class),
                rs.getString("last_resumed_stage")),
            applicationId).stream().findFirst();
    }

    public void insertCycle(UUID applicationId, String reviewStage, UUID taskId, UUID discrepancyId) {
        jdbc.update(
            "INSERT INTO model_return_response_cycle (application_id, review_stage, task_id, discrepancy_id) VALUES (?, ?, ?, ?)",
            applicationId, reviewStage, taskId, discrepancyId);
    }

    public void updateLastResumedStage(UUID applicationId, String resumedStage) {
        jdbc.update("UPDATE model_return_response_cycle SET last_resumed_stage = ? WHERE application_id = ?", resumedStage, applicationId);
    }

    public Optional<String> wiringEvidenceHash(UUID commandId) {
        return jdbc.query(
            "SELECT payload_hash FROM model_return_response_wiring_evidence WHERE command_id = ?",
            (rs, i) -> rs.getString("payload_hash"),
            commandId).stream().findFirst();
    }

    public void recordWiringEvidence(UUID commandId, UUID applicationId, String purpose, String payloadHash) {
        jdbc.update(
            "INSERT INTO model_return_response_wiring_evidence (command_id, application_id, purpose, payload_hash) VALUES (?, ?, ?, ?)",
            commandId, applicationId, purpose, payloadHash);
    }

    public int countDiscrepancyResponses(UUID discrepancyId) {
        Integer n = jdbc.queryForObject("SELECT count(*)::int FROM workflow_discrepancy_response WHERE discrepancy_id = ?", Integer.class, discrepancyId);
        return n == null ? 0 : n;
    }

    public int nextResponseSeq(UUID discrepancyId) {
        Integer n = jdbc.queryForObject("SELECT coalesce(max(response_seq), 0) + 1 FROM workflow_discrepancy_response WHERE discrepancy_id = ?", Integer.class, discrepancyId);
        return n == null ? 1 : n;
    }

    public Optional<Integer> latestUndisposedResponseSeq(UUID discrepancyId) {
        return jdbc.query(
            "SELECT r.response_seq FROM workflow_discrepancy_response r "
                + "LEFT JOIN workflow_discrepancy_disposition d ON d.discrepancy_id = r.discrepancy_id AND d.response_seq = r.response_seq "
                + "WHERE r.discrepancy_id = ? AND d.id IS NULL ORDER BY r.response_seq DESC LIMIT 1",
            (rs, i) -> rs.getInt("response_seq"),
            discrepancyId).stream().findFirst();
    }

    public String discrepancyStatus(UUID discrepancyId) {
        return jdbc.queryForObject("SELECT status FROM workflow_discrepancy WHERE id = ?", String.class, discrepancyId);
    }

    public UUID returnedByAccount(UUID returnId) {
        return jdbc.queryForObject("SELECT returned_by_account_id FROM model_application_return WHERE id = ?", UUID.class, returnId);
    }

    public Optional<UUID> soleActiveAssignee(UUID applicationId, String stage) {
        var ids = jdbc.queryForList(
            "SELECT user_id FROM assignment WHERE subject_type = 'model_application' AND subject_id = ? AND stage = ? AND active",
            UUID.class, applicationId, stage);
        if (ids.size() != 1) {
            return Optional.empty();
        }
        return Optional.of(ids.get(0));
    }
}
