package gov.bee.api.manufactureronboarding;

import java.math.BigDecimal;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class ManufacturerOnboardingRepository {

    public record Row(UUID id, String reference, UUID organisationId, String legalName, String state, int version, String permitteeNumber,
                      LocalDate observationEndsOn, Instant createdAt) {
    }

    public record OrchestratorResult(String outState, Integer outVersion, UUID paymentId, String permitteeNumber) {
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

    public Row create(UUID organisationId, String legalName, int year) {
        UUID id = UUID.randomUUID();
        String reference = jdbc.queryForObject("SELECT manufacturer_onboarding_next_reference(?)", String.class, year);
        jdbc.update("INSERT INTO manufacturer_onboarding_application (id, reference, organisation_id, legal_name) VALUES (?, ?, ?, ?)",
            id, reference, organisationId, legalName);
        return find(id).orElseThrow();
    }

    public Optional<Row> patchDraft(UUID id, UUID organisationId, int expectedVersion, String legalName) {
        int n = jdbc.update("UPDATE manufacturer_onboarding_application SET legal_name = ?, version = version + 1 "
            + "WHERE id = ? AND organisation_id = ? AND state = 'draft' AND version = ?", legalName, id, organisationId, expectedVersion);
        return n == 1 ? findOwned(id, organisationId) : Optional.empty();
    }

    public int documentCount(UUID applicationId) {
        Integer n = jdbc.queryForObject("SELECT count(*) FROM manufacturer_onboarding_document_version v "
            + "JOIN manufacturer_onboarding_document d ON d.id = v.document_id WHERE d.application_id = ?", Integer.class, applicationId);
        return n == null ? 0 : n;
    }

    public Optional<OrchestratorResult> orchestrateSubmit(UUID applicationId, UUID actor, String role, int version, BigDecimal amountInr,
                                                            String feeRuleKey, int feeRuleVersion, String verificationStatus, String sourceReference,
                                                            String note, UUID commandId, String payloadHash, boolean forceCheckFail) {
        return jdbc.query("SELECT out_state, out_version, out_payment_id FROM manufacturer_onboarding_orchestrate_submit("
            + "?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?::char(64), ?)", (rs, i) -> new OrchestratorResult(rs.getString(1),
            rs.getObject(2, Integer.class), rs.getObject(3, UUID.class), null),
            applicationId, actor, role, version, amountInr, feeRuleKey, feeRuleVersion, verificationStatus, sourceReference, note, commandId,
            payloadHash, forceCheckFail).stream().findFirst();
    }

    public Optional<OrchestratorResult> orchestrateDirectorDecision(UUID applicationId, UUID actor, int version, String decision, String note,
                                                                    UUID commandId, String payloadHash) {
        return jdbc.query("SELECT out_state, out_version, out_permittee_number FROM manufacturer_onboarding_orchestrate_director_decision("
            + "?, ?, ?, ?, ?, ?, ?::char(64))", (rs, i) -> new OrchestratorResult(rs.getString(1), rs.getObject(2, Integer.class), null, rs.getString(3)),
            applicationId, actor, version, decision, note, commandId, payloadHash).stream().findFirst();
    }

    public Optional<OrchestratorResult> orchestrateRaiseAnomaly(UUID applicationId, UUID actor, String actorRole, int version, String reason,
                                                                UUID commandId, String payloadHash) {
        return jdbc.query("SELECT out_state, out_version FROM manufacturer_onboarding_orchestrate_raise_anomaly("
            + "?, ?, ?, ?, ?, ?, ?::char(64))", (rs, i) -> new OrchestratorResult(rs.getString(1), rs.getObject(2, Integer.class), null, null),
            applicationId, actor, actorRole, version, reason, commandId, payloadHash).stream().findFirst();
    }

    public Optional<OrchestratorResult> orchestrateResolveAnomaly(UUID applicationId, UUID actor, int version, String resolution, String note,
                                                                  UUID commandId, String payloadHash) {
        return jdbc.query("SELECT out_state, out_version FROM manufacturer_onboarding_orchestrate_resolve_anomaly("
            + "?, ?, ?, ?, ?, ?, ?::char(64))", (rs, i) -> new OrchestratorResult(rs.getString(1), rs.getObject(2, Integer.class), null, null),
            applicationId, actor, version, resolution, note, commandId, payloadHash).stream().findFirst();
    }

    public Optional<OrchestratorResult> orchestrateObservationClose(UUID applicationId, UUID actor, String role, int version, UUID commandId,
                                                                    String payloadHash, LocalDate asOf) {
        return jdbc.query("SELECT out_state, out_version, out_permittee_number FROM manufacturer_onboarding_orchestrate_observation_close("
            + "?, ?, ?, ?, ?, ?::char(64), ?)", (rs, i) -> new OrchestratorResult(rs.getString(1), rs.getObject(2, Integer.class), null, rs.getString(3)),
            applicationId, actor, role, version, commandId, payloadHash, asOf).stream().findFirst();
    }
}
