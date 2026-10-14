package gov.bee.api.registration;

import java.math.BigDecimal;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.LocalDate;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/** WP04.2b-1: persistence for brand and agency registration requests (draft to fee due). */
@Repository
public class RegistrationRepository {

    public record Row(UUID id, String reference, String kind, UUID organisationId, String organisationCode, UUID principalOrganisationId,
                      UUID brandId, String brandName, LocalDate validFrom, LocalDate validTo, String state, int version) {
    }

    public record FeeRow(UUID id, BigDecimal amountInr, BigDecimal taxRatePercent, BigDecimal taxInr, BigDecimal totalInr, String feeRuleKey,
                         int feeRuleVersion, String verificationStatus, String sourceReference) {
    }

    public record SubmissionResult(Row application, UUID eventId, FeeRow fee) {
    }

    public record BrandChoice(UUID id, String name, UUID ownerOrganisationId, String ownerCode) {
    }

    private static final String SELECT = "SELECT r.id, r.reference, r.kind, r.organisation_id, o.code AS organisation_code, r.principal_organisation_id, "
        + "r.brand_id, r.brand_name, r.valid_from, r.valid_to, r.state, r.version "
        + "FROM registration_application r JOIN organisation o ON o.id = r.organisation_id ";

    private final JdbcTemplate jdbc;

    public RegistrationRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    private static Row row(ResultSet rs, int i) throws SQLException {
        return new Row(rs.getObject("id", UUID.class), rs.getString("reference"), rs.getString("kind"),
            rs.getObject("organisation_id", UUID.class), rs.getString("organisation_code"),
            rs.getObject("principal_organisation_id", UUID.class), rs.getObject("brand_id", UUID.class), rs.getString("brand_name"),
            rs.getObject("valid_from", LocalDate.class), rs.getObject("valid_to", LocalDate.class), rs.getString("state"), rs.getInt("version"));
    }

    private static FeeRow fee(ResultSet rs, int i) throws SQLException {
        return new FeeRow(rs.getObject("id", UUID.class), rs.getBigDecimal("amount_inr"), rs.getBigDecimal("tax_rate_percent"),
            rs.getBigDecimal("tax_inr"), rs.getBigDecimal("total_inr"), rs.getString("fee_rule_key"), rs.getInt("fee_rule_version"),
            rs.getString("verification_status"), rs.getString("source_reference"));
    }

    public String nextReference(int year) {
        return jdbc.queryForObject("SELECT registration_next_reference(?)", String.class, year);
    }

    public Row insertDraft(UUID id, String reference, String kind, UUID organisationId, UUID principalOrganisationId, UUID brandId,
                           String brandName, LocalDate validFrom, LocalDate validTo) {
        jdbc.update("INSERT INTO registration_application (id, reference, kind, organisation_id, principal_organisation_id, brand_id, brand_name, "
            + "valid_from, valid_to) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            id, reference, kind, organisationId, principalOrganisationId, brandId, brandName, validFrom, validTo);
        return findOwned(id, organisationId).orElseThrow();
    }

    public Optional<Row> findOwned(UUID id, UUID organisationId) {
        return jdbc.query(SELECT + "WHERE r.id = ? AND r.organisation_id = ?", RegistrationRepository::row, id, organisationId).stream().findFirst();
    }

    public Optional<Row> find(UUID id) {
        return jdbc.query(SELECT + "WHERE r.id = ?", RegistrationRepository::row, id).stream().findFirst();
    }

    /** Requests of the given organisations, plus every request in one of the given states. */
    public List<Row> list(Collection<UUID> organisations, Collection<String> states) {
        if (organisations.isEmpty() && states.isEmpty()) {
            return List.of();
        }
        String orgs = organisations.isEmpty() ? "false" : "r.organisation_id = ANY (?::uuid[])";
        String sts = states.isEmpty() ? "false" : "r.state = ANY (?::text[])";
        var args = new java.util.ArrayList<Object>();
        if (!organisations.isEmpty()) {
            args.add(organisations.stream().map(UUID::toString).toArray(String[]::new));
        }
        if (!states.isEmpty()) {
            args.add(states.toArray(String[]::new));
        }
        return jdbc.query(SELECT + "WHERE " + orgs + " OR " + sts + " ORDER BY r.reference DESC", RegistrationRepository::row, args.toArray());
    }

    /** An edit of a draft; the version must match and moves on. */
    public Optional<Row> updateDraft(UUID id, UUID organisationId, int version, UUID principalOrganisationId, UUID brandId, String brandName,
                                     LocalDate validFrom, LocalDate validTo) {
        int n = jdbc.update("UPDATE registration_application SET principal_organisation_id = ?, brand_id = ?, brand_name = ?, valid_from = ?, "
            + "valid_to = ?, version = version + 1 WHERE id = ? AND organisation_id = ? AND state = 'draft' AND version = ?",
            principalOrganisationId, brandId, brandName, validFrom, validTo, id, organisationId, version);
        return n == 1 ? findOwned(id, organisationId) : Optional.empty();
    }

    /** draft to fee_due with the submission event and the fee snapshot, in the caller's transaction. */
    public Optional<SubmissionResult> submit(UUID id, UUID organisationId, int version, UUID actorAccountId, String actorRole, BigDecimal amountInr,
                                             BigDecimal taxRatePercent, String feeRuleKey, int feeRuleVersion, String verificationStatus,
                                             String sourceReference, String note) {
        int n = jdbc.update("UPDATE registration_application SET state = 'fee_due', version = version + 1 "
            + "WHERE id = ? AND organisation_id = ? AND state = 'draft' AND version = ?", id, organisationId, version);
        if (n != 1) {
            return Optional.empty();
        }
        UUID eventId = UUID.randomUUID();
        jdbc.update("INSERT INTO registration_submission_event (id, application_id, from_state, to_state, actor_account_id, actor_role, "
            + "filing_organisation_id) VALUES (?, ?, 'draft', 'fee_due', ?, ?, ?)", eventId, id, actorAccountId, actorRole, organisationId);
        jdbc.update("INSERT INTO registration_fee_snapshot (id, application_id, submission_event_id, amount_inr, tax_rate_percent, fee_rule_key, "
            + "fee_rule_version, verification_status, source_reference, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            UUID.randomUUID(), id, eventId, amountInr, taxRatePercent, feeRuleKey, feeRuleVersion, verificationStatus, sourceReference, note);
        return Optional.of(new SubmissionResult(findOwned(id, organisationId).orElseThrow(), eventId, feeSnapshot(id).orElseThrow()));
    }

    public Optional<FeeRow> feeSnapshot(UUID applicationId) {
        return jdbc.query("SELECT id, amount_inr, tax_rate_percent, tax_inr, total_inr, fee_rule_key, fee_rule_version, verification_status, source_reference "
            + "FROM registration_fee_snapshot WHERE application_id = ?", RegistrationRepository::fee, applicationId).stream().findFirst();
    }

    public int documentCount(UUID applicationId) {
        Integer n = jdbc.queryForObject("SELECT count(*) FROM registration_document WHERE application_id = ?", Integer.class, applicationId);
        return n == null ? 0 : n;
    }

    /** Active brands an agency may ask to represent. */
    public List<BrandChoice> activeBrands() {
        return jdbc.query("SELECT b.id, b.name, b.owner_organisation_id, o.code FROM brand b JOIN organisation o ON o.id = b.owner_organisation_id "
            + "WHERE b.status = 'active' ORDER BY b.name", (rs, i) -> new BrandChoice(rs.getObject("id", UUID.class), rs.getString("name"),
                rs.getObject("owner_organisation_id", UUID.class), rs.getString("code")));
    }

    public Optional<BrandChoice> activeBrand(UUID brandId) {
        return activeBrands().stream().filter(b -> b.id().equals(brandId)).findFirst();
    }

    /** A brand of this name (any owner) is already on the register. */
    public boolean brandNameTaken(String name) {
        Boolean b = jdbc.queryForObject("SELECT EXISTS (SELECT 1 FROM brand WHERE lower(btrim(name)) = lower(btrim(?)) AND status <> 'revoked')",
            Boolean.class, name);
        return Boolean.TRUE.equals(b);
    }

    /** A live (not rejected) brand request of this name from this manufacturer, other than the one being edited. */
    public boolean liveBrandRequest(UUID organisationId, String brandName, UUID except) {
        Boolean b = jdbc.queryForObject("SELECT EXISTS (SELECT 1 FROM registration_application WHERE kind = 'brand' AND organisation_id = ? "
            + "AND lower(btrim(brand_name)) = lower(btrim(?)) AND state <> 'rejected' AND (?::uuid IS NULL OR id <> ?::uuid))",
            Boolean.class, organisationId, brandName, except, except);
        return Boolean.TRUE.equals(b);
    }

    /** A live (not rejected) request from this agency for this brand, other than the one being edited. */
    public boolean liveAgencyRequest(UUID organisationId, UUID brandId, UUID except) {
        Boolean b = jdbc.queryForObject("SELECT EXISTS (SELECT 1 FROM registration_application WHERE kind = 'agency' AND organisation_id = ? "
            + "AND brand_id = ? AND state <> 'rejected' AND (?::uuid IS NULL OR id <> ?::uuid))", Boolean.class, organisationId, brandId, except, except);
        return Boolean.TRUE.equals(b);
    }

    public record Confirmed(int versionAfter, java.time.Instant confirmedAt) {
    }

    /** The account that submitted the request. */
    public Optional<UUID> submitter(UUID applicationId) {
        return jdbc.queryForList("SELECT actor_account_id FROM registration_submission_event WHERE application_id = ?", UUID.class, applicationId)
            .stream().findFirst();
    }

    public Optional<UUID> feeSnapshotId(UUID applicationId) {
        return jdbc.queryForList("SELECT id FROM registration_fee_snapshot WHERE application_id = ?", UUID.class, applicationId).stream().findFirst();
    }

    /** fee_due to programme_review with the transition event and the confirmation record; empty if the state or version has moved. */
    public Optional<Confirmed> confirmFee(UUID applicationId, int expectedVersion, UUID actorAccountId, UUID feeSnapshotId, BigDecimal amountInr,
                                          String receiptReference, LocalDate receivedOn) {
        int n = jdbc.update("UPDATE registration_application SET state = 'programme_review', version = version + 1 "
            + "WHERE id = ? AND state = 'fee_due' AND version = ?", applicationId, expectedVersion);
        if (n != 1) {
            return Optional.empty();
        }
        int after = expectedVersion + 1;
        UUID eventId = UUID.randomUUID();
        java.sql.Timestamp at = jdbc.queryForObject("INSERT INTO registration_transition_event (id, application_id, action, from_state, to_state, "
            + "actor_account_id, actor_role, version_after) VALUES (?, ?, 'confirm_fee', 'fee_due', 'programme_review', ?, 'finance', ?) RETURNING occurred_at",
            java.sql.Timestamp.class, eventId, applicationId, actorAccountId, after);
        jdbc.update("INSERT INTO registration_fee_confirmation (id, application_id, transition_event_id, fee_snapshot_id, amount_inr, receipt_reference, "
            + "received_on, confirmed_by_account_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", UUID.randomUUID(), applicationId, eventId, feeSnapshotId,
            amountInr, receiptReference, java.sql.Date.valueOf(receivedOn), actorAccountId);
        return Optional.of(new Confirmed(after, at.toInstant()));
    }
}
