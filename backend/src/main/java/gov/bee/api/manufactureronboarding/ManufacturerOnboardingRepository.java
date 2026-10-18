package gov.bee.api.manufactureronboarding;

import com.fasterxml.jackson.databind.JsonNode;
import java.math.BigDecimal;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import gov.bee.api.workflow.WorkflowFoundationRepository;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

@Repository
public class ManufacturerOnboardingRepository {

    public record Row(UUID id, String reference, UUID organisationId, String legalName, String state, int version, String permitteeNumber,
                      LocalDate observationEndsOn, Instant createdAt) {
    }

    public record OrchestratorResult(String outState, Integer outVersion, UUID paymentId, String permitteeNumber) {
    }

    public record AutomatedCheck(String checkCode, String outcome, String detail, Instant checkedAt) {
    }

    public record LifecycleEvent(String eventKind, String fromState, String toState, String actorRole, String detail, Instant occurredAt) {
    }

    public record DocumentHead(String documentKind, int latestVersion, String status, LocalDate expiresOn) {
    }

    public record AnomalyRow(String raisedByRole, String reason, String resolution, Instant raisedAt, Instant resolvedAt) {
    }

    public record PaymentSummary(UUID paymentId, String amountInr, String receiptNumber, String status, Instant settledAt) {
    }

    public record FeeSnapshotSummary(String amountInr, String feeRuleKey, int feeRuleVersion, String totalInr) {
    }

    public record DirectorDecisionSummary(String decision, String note, Instant decidedAt) {
    }

    public record PermitteeActivationSummary(String permitteeNumber, Instant activatedAt) {
    }

    public record ObservationSummary(LocalDate startedOn, LocalDate endsOn, Instant closedAt) {
    }

    private static Row row(ResultSet rs, int i) throws SQLException {
        var obs = rs.getDate("observation_ends_on");
        return new Row(rs.getObject("id", UUID.class), rs.getString("reference"), rs.getObject("organisation_id", UUID.class),
            rs.getString("legal_name"), rs.getString("state"), rs.getInt("version"), rs.getString("permittee_number"),
            obs == null ? null : obs.toLocalDate(), rs.getTimestamp("created_at").toInstant());
    }

    private final JdbcTemplate jdbc;

    public ManufacturerOnboardingRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public List<Row> list(java.util.Collection<UUID> orgs, java.util.Collection<String> stages) {
        if (orgs.isEmpty() && stages.isEmpty()) {
            return List.of();
        }
        String orgClause = orgs.isEmpty() ? "false" : "organisation_id = ANY (?::uuid[])";
        String stageClause = stages.isEmpty() ? "false" : "state = ANY (?::text[])";
        var args = new java.util.ArrayList<Object>();
        if (!orgs.isEmpty()) {
            args.add(orgs.stream().map(UUID::toString).toArray(String[]::new));
        }
        if (!stages.isEmpty()) {
            args.add(stages.toArray(String[]::new));
        }
        return jdbc.query("SELECT id, reference, organisation_id, legal_name, state, version, permittee_number, observation_ends_on, created_at "
            + "FROM manufacturer_onboarding_application WHERE " + orgClause + " OR " + stageClause + " ORDER BY created_at DESC",
            ManufacturerOnboardingRepository::row, args.toArray());
    }

    public Optional<Row> find(UUID id) {
        return jdbc.query("SELECT id, reference, organisation_id, legal_name, state, version, permittee_number, observation_ends_on, created_at "
            + "FROM manufacturer_onboarding_application WHERE id = ?", ManufacturerOnboardingRepository::row, id).stream().findFirst();
    }

    public Optional<Row> findOwned(UUID id, UUID organisationId) {
        return jdbc.query("SELECT id, reference, organisation_id, legal_name, state, version, permittee_number, observation_ends_on, created_at "
            + "FROM manufacturer_onboarding_application WHERE id = ? AND organisation_id = ?", ManufacturerOnboardingRepository::row, id, organisationId)
            .stream().findFirst();
    }

    public Row create(UUID actorId, UUID organisationId, String legalName, int year, JsonNode draft) {
        String draftJson = draft == null ? "{}" : draft.toString();
        UUID id = jdbc.queryForObject(
            "SELECT manufacturer_onboarding_trusted_create(?, ?, ?, ?, ?::jsonb)", UUID.class, actorId, organisationId, legalName, year, draftJson);
        return find(id).orElseThrow();
    }

    public Optional<Row> patchDraft(UUID actorId, UUID id, UUID organisationId, int expectedVersion, String legalName, JsonNode draft) {
        String draftJson = draft == null ? null : draft.toString();
        Integer next = jdbc.query("""
            SELECT manufacturer_onboarding_trusted_patch_draft(?, ?, ?, ?, ?, ?::jsonb)
            """, (rs, i) -> rs.getObject(1, Integer.class), actorId, id, organisationId, expectedVersion, legalName, draftJson)
            .stream().findFirst().orElse(null);
        return next == null ? Optional.empty() : findOwned(id, organisationId);
    }

    public boolean hasTradeLicenceDocument(UUID applicationId) {
        Integer n = jdbc.queryForObject("""
            SELECT count(*) FROM manufacturer_onboarding_document_version v
              JOIN manufacturer_onboarding_document d ON d.id = v.document_id
             WHERE d.application_id = ? AND d.document_kind = 'trade_licence'
            """, Integer.class, applicationId);
        return n != null && n > 0;
    }

    public Optional<String> draftPayloadJson(UUID id) {
        return jdbc.query("SELECT draft_payload::text FROM manufacturer_onboarding_application WHERE id = ?", (rs, i) -> rs.getString(1), id)
            .stream().findFirst();
    }

    public Optional<PaymentSummary> paymentSummary(UUID applicationId) {
        return jdbc.query("""
            SELECT p.id, p.amount_inr::text, p.receipt_number, p.status, p.settled_at
              FROM manufacturer_onboarding_payment_link l
              JOIN payment p ON p.id = l.payment_id
             WHERE l.application_id = ?
            """, (rs, i) -> new PaymentSummary(rs.getObject(1, UUID.class), rs.getString(2), rs.getString(3), rs.getString(4),
            rs.getTimestamp(5) == null ? null : rs.getTimestamp(5).toInstant()), applicationId).stream().findFirst();
    }

    public Optional<FeeSnapshotSummary> feeSnapshot(UUID applicationId) {
        return jdbc.query("""
            SELECT amount_inr::text, fee_rule_key, fee_rule_version, total_inr::text
              FROM manufacturer_onboarding_fee_snapshot WHERE application_id = ?
            """, (rs, i) -> new FeeSnapshotSummary(rs.getString(1), rs.getString(2), rs.getInt(3), rs.getString(4)), applicationId)
            .stream().findFirst();
    }

    public Optional<DirectorDecisionSummary> directorDecision(UUID applicationId) {
        return jdbc.query("""
            SELECT decision, note, decided_at FROM manufacturer_onboarding_director_decision
             WHERE application_id = ? ORDER BY decided_at DESC LIMIT 1
            """, (rs, i) -> new DirectorDecisionSummary(rs.getString(1), rs.getString(2), rs.getTimestamp(3).toInstant()), applicationId)
            .stream().findFirst();
    }

    public Optional<PermitteeActivationSummary> permitteeActivation(UUID applicationId) {
        return jdbc.query("""
            SELECT permittee_number, activated_at FROM manufacturer_onboarding_permittee_activation WHERE application_id = ?
            """, (rs, i) -> new PermitteeActivationSummary(rs.getString(1), rs.getTimestamp(2).toInstant()), applicationId)
            .stream().findFirst();
    }

    public Optional<ObservationSummary> observation(UUID applicationId) {
        return jdbc.query("""
            SELECT started_on, ends_on, closed_at FROM manufacturer_onboarding_observation WHERE application_id = ?
            """, (rs, i) -> {
            var closed = rs.getTimestamp(3);
            return new ObservationSummary(rs.getDate(1).toLocalDate(), rs.getDate(2).toLocalDate(),
                closed == null ? null : closed.toInstant());
        }, applicationId).stream().findFirst();
    }

    public List<AutomatedCheck> latestChecks(UUID applicationId) {
        return jdbc.query("""
            SELECT DISTINCT ON (check_code) check_code, outcome, detail, checked_at
              FROM manufacturer_onboarding_automated_check
             WHERE application_id = ?
             ORDER BY check_code, checked_at DESC
            """, (rs, i) -> new AutomatedCheck(rs.getString(1), rs.getString(2), rs.getString(3),
            rs.getTimestamp(4).toInstant()), applicationId);
    }

    public List<LifecycleEvent> lifecycle(UUID applicationId) {
        return jdbc.query("""
            SELECT event_kind, from_state, to_state, actor_role, detail, occurred_at
              FROM manufacturer_onboarding_event WHERE application_id = ? ORDER BY occurred_at
            """, (rs, i) -> new LifecycleEvent(rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4), rs.getString(5),
            rs.getTimestamp(6).toInstant()), applicationId);
    }

    public List<DocumentHead> documents(UUID applicationId) {
        return jdbc.query("""
            SELECT d.document_kind,
                   coalesce(max(v.version_number), 0) AS latest_version,
                   CASE WHEN count(v.id) = 0 THEN 'missing'
                        WHEN max(v.expires_on) IS NOT NULL AND max(v.expires_on) < (now() AT TIME ZONE 'Asia/Kolkata')::date THEN 'expired'
                        ELSE 'uploaded' END AS status,
                   max(v.expires_on) AS expires_on
              FROM manufacturer_onboarding_document d
              LEFT JOIN manufacturer_onboarding_document_version v ON v.document_id = d.id
             WHERE d.application_id = ?
             GROUP BY d.document_kind
            """, (rs, i) -> {
            var exp = rs.getDate(4);
            return new DocumentHead(rs.getString(1), rs.getInt(2), rs.getString(3), exp == null ? null : exp.toLocalDate());
        }, applicationId);
    }

    public List<AnomalyRow> anomalies(UUID applicationId) {
        return jdbc.query("""
            SELECT raised_by_role, reason, resolution, raised_at, resolved_at
              FROM manufacturer_onboarding_anomaly WHERE application_id = ? ORDER BY raised_at
            """, (rs, i) -> new AnomalyRow(rs.getString(1), rs.getString(2), rs.getString(3),
            rs.getTimestamp(4).toInstant(), rs.getTimestamp(5) == null ? null : rs.getTimestamp(5).toInstant()), applicationId);
    }

    public Optional<OrchestratorResult> orchestrateSubmit(UUID applicationId, UUID actor, String role, int version, BigDecimal amountInr,
                                                            String feeRuleKey, int feeRuleVersion, String verificationStatus, String sourceReference,
                                                            String note, UUID commandId, String payloadHash) {
        return queryOrchestrator("SELECT out_state, out_version, out_payment_id FROM manufacturer_onboarding_orchestrate_submit("
            + "?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?::char(64))", (rs, i) -> new OrchestratorResult(rs.getString(1),
            rs.getObject(2, Integer.class), rs.getObject(3, UUID.class), null),
            applicationId, actor, role, version, amountInr, feeRuleKey, feeRuleVersion, verificationStatus, sourceReference, note, commandId,
            payloadHash);
    }

    public Optional<OrchestratorResult> orchestrateDirectorDecision(UUID applicationId, UUID actor, int version, String decision, String note,
                                                                    UUID commandId, String payloadHash) {
        return queryOrchestrator("SELECT out_state, out_version, out_permittee_number FROM manufacturer_onboarding_orchestrate_director_decision("
            + "?, ?, ?, ?, ?, ?, ?::char(64))", (rs, i) -> new OrchestratorResult(rs.getString(1), rs.getObject(2, Integer.class), null, rs.getString(3)),
            applicationId, actor, version, decision, note, commandId, payloadHash);
    }

    public Optional<OrchestratorResult> orchestrateRaiseAnomaly(UUID applicationId, UUID actor, String actorRole, int version, String reason,
                                                                UUID commandId, String payloadHash) {
        return queryOrchestrator("SELECT out_state, out_version FROM manufacturer_onboarding_orchestrate_raise_anomaly("
            + "?, ?, ?, ?, ?, ?, ?::char(64))", (rs, i) -> new OrchestratorResult(rs.getString(1), rs.getObject(2, Integer.class), null, null),
            applicationId, actor, actorRole, version, reason, commandId, payloadHash);
    }

    public Optional<OrchestratorResult> orchestrateResolveAnomaly(UUID applicationId, UUID actor, int version, String resolution, String note,
                                                                  UUID commandId, String payloadHash) {
        return queryOrchestrator("SELECT out_state, out_version FROM manufacturer_onboarding_orchestrate_resolve_anomaly("
            + "?, ?, ?, ?, ?, ?, ?::char(64))", (rs, i) -> new OrchestratorResult(rs.getString(1), rs.getObject(2, Integer.class), null, null),
            applicationId, actor, version, resolution, note, commandId, payloadHash);
    }

    /** Close observation windows whose 15-calendar-day deadline has passed. */
    public int closeExpiredObservations() {
        Integer closed = jdbc.queryForObject(
            "SELECT manufacturer_onboarding_system_close_expired_observations()", Integer.class);
        return closed == null ? 0 : closed;
    }

    private Optional<OrchestratorResult> queryOrchestrator(String sql, RowMapper<OrchestratorResult> mapper, Object... args) {
        try {
            return jdbc.query(sql, mapper, args).stream().findFirst();
        } catch (DataAccessException ex) {
            if (WorkflowFoundationRepository.isSqlMessage(ex, "idempotency_key_conflict")) {
                return Optional.of(new OrchestratorResult("idempotency_key_conflict", null, null, null));
            }
            throw ex;
        }
    }
}
