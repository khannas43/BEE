package gov.bee.api.application;

import gov.bee.api.policy.SlicePolicy.ReadScope;
import java.math.BigDecimal;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/**
 * Reads model applications with the caller's {@link ReadScope} applied in SQL, so rows
 * outside the scope never leave the database.
 */
@Repository
public class ModelApplicationRepository {

    public record Row(UUID id, String reference, UUID organisationId, String organisationCode, String brandName,
                      String category, String modelNumber, String state, int version, Set<String> assignedStagesForCaller,
                      UUID principalOrganisationId, UUID brandId, String principalOrganisationCode,
                      String laboratoryCode, LocalDate testedOn, BigDecimal declaredIseer) {
        /** A row without the WP05.1d evidence fields (legacy rows and tests that predate them). */
        public Row(UUID id, String reference, UUID organisationId, String organisationCode, String brandName, String category,
                   String modelNumber, String state, int version, Set<String> assignedStagesForCaller, UUID principalOrganisationId,
                   UUID brandId, String principalOrganisationCode) {
            this(id, reference, organisationId, organisationCode, brandName, category, modelNumber, state, version,
                assignedStagesForCaller, principalOrganisationId, brandId, principalOrganisationCode, null, null, null);
        }
    }

    /** Which evidence fields a draft write sets; a field that is not present keeps its stored value. */
    public record EvidenceUpdate(boolean setLaboratory, String laboratoryCode, boolean setTestedOn, LocalDate testedOn,
                                 boolean setIseer, BigDecimal declaredIseer) {
        public static final EvidenceUpdate NONE = new EvidenceUpdate(false, null, false, null, false, null);

        public boolean isEmpty() {
            return !setLaboratory && !setTestedOn && !setIseer;
        }
    }

    /** A laboratory that has at least one accreditation record for a category (the form's choice list). */
    public record LaboratoryChoice(String code, String name) {
    }

    private static final String SELECT = """
        SELECT a.id, a.reference, a.organisation_id, o.code, a.brand_name, a.category, a.model_number, a.state, a.version,
               a.principal_organisation_id, a.brand_id, po.code AS principal_code,
               a.laboratory_code, a.tested_on, a.declared_iseer,
               COALESCE((SELECT string_agg(s.stage, ',') FROM assignment s
                          WHERE s.subject_type = 'model_application' AND s.subject_id = a.id AND s.user_id = ? AND s.active AND s.stage = a.state), '') AS stages
        FROM model_application a JOIN organisation o ON o.id = a.organisation_id
        LEFT JOIN organisation po ON po.id = a.principal_organisation_id
        """;

    private final JdbcTemplate jdbc;

    public ModelApplicationRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public List<Row> list(ReadScope scope, UUID callerId) {
        List<Object> args = new ArrayList<>();
        args.add(callerId);
        String where = scopePredicate(scope, callerId, args);
        return jdbc.query(SELECT + " WHERE " + where + " ORDER BY a.reference", this::row, args.toArray());
    }

    public Optional<Row> find(UUID id, ReadScope scope, UUID callerId) {
        List<Object> args = new ArrayList<>();
        args.add(callerId);
        args.add(id);
        String where = "a.id = ? AND (" + scopePredicate(scope, callerId, args) + ")";
        return jdbc.query(SELECT + " WHERE " + where, this::row, args.toArray()).stream().findFirst();
    }

    public Optional<Row> findOwned(UUID id, UUID filingOrganisationId) {
        List<Object> args = new ArrayList<>();
        args.add(UUID.randomUUID());
        args.add(id);
        args.add(filingOrganisationId);
        return jdbc.query(SELECT + " WHERE a.id = ? AND a.organisation_id = ?", this::row, args.toArray()).stream().findFirst();
    }

    public String organisationCode(UUID organisationId) {
        return jdbc.queryForObject("SELECT code FROM organisation WHERE id = ?", String.class, organisationId);
    }

    /** Allocates the next LOCAL-MA sequence under row lock (V8 allocator). */
    public String nextReference() {
        Integer n = jdbc.queryForObject(
            "UPDATE model_application_reference_allocator SET next_value = next_value + 1 WHERE scope = 'LOCAL-MA' RETURNING next_value",
            Integer.class);
        if (n == null) {
            throw new IllegalStateException("model_application_reference_allocator missing LOCAL-MA row");
        }
        return "LOCAL-MA-" + String.format("%04d", n);
    }

    public Row insertDraft(UUID id, String reference, UUID filingOrganisationId, UUID principalOrganisationId, UUID brandId,
                           String brandName, String category, String modelNumber) {
        jdbc.update(
            "INSERT INTO model_application (id, reference, organisation_id, principal_organisation_id, brand_id, brand_name, category, model_number, state, version) "
                + "VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', 0)",
            id, reference, filingOrganisationId, principalOrganisationId, brandId, brandName, category, modelNumber);
        return findOwned(id, filingOrganisationId).orElseThrow();
    }

    public Optional<Row> updateDraft(UUID id, UUID filingOrganisationId, int expectedVersion, String modelNumber, String category,
                                     UUID brandId, UUID principalOrganisationId, String brandName) {
        int n = jdbc.update(
            "UPDATE model_application SET model_number = ?, category = ?, brand_id = ?, principal_organisation_id = ?, brand_name = ?, version = version + 1 "
                + "WHERE id = ? AND organisation_id = ? AND state = 'draft' AND version = ?",
            modelNumber, category, brandId, principalOrganisationId, brandName, id, filingOrganisationId, expectedVersion);
        return n == 1 ? findOwned(id, filingOrganisationId) : Optional.empty();
    }

    /** A returned application is edited without touching its identity; the edit only moves the version. */
    public Optional<Row> bumpReturned(UUID id, UUID filingOrganisationId, int expectedVersion) {
        int n = jdbc.update(
            "UPDATE model_application SET version = version + 1 WHERE id = ? AND organisation_id = ? AND state = 'returned' AND version = ?",
            id, filingOrganisationId, expectedVersion);
        return n == 1 ? findOwned(id, filingOrganisationId) : Optional.empty();
    }

    private static String scopePredicate(ReadScope scope, UUID callerId, List<Object> args) {
        List<String> any = new ArrayList<>();
        if (!scope.organisations().isEmpty()) {
            any.add("a.organisation_id IN (" + placeholders(scope.organisations().size()) + ")");
            args.addAll(scope.organisations());
        }
        if (scope.assigned()) {
            any.add("EXISTS (SELECT 1 FROM assignment s WHERE s.subject_type = 'model_application' AND s.subject_id = a.id AND s.user_id = ? AND s.active AND s.stage = a.state)");
            args.add(callerId);
        }
        if (!scope.stages().isEmpty()) {
            any.add("a.state IN (" + placeholders(scope.stages().size()) + ")");
            args.addAll(scope.stages());
        }
        return any.isEmpty() ? "FALSE" : String.join(" OR ", any);
    }

    private static String placeholders(int n) {
        return String.join(", ", Collections.nCopies(n, "?"));
    }

    private Row row(ResultSet rs, int i) throws SQLException {
        String stages = rs.getString("stages");
        return new Row(rs.getObject("id", UUID.class), rs.getString("reference"), rs.getObject("organisation_id", UUID.class),
            rs.getString("code"), rs.getString("brand_name"), rs.getString("category"), rs.getString("model_number"),
            rs.getString("state"), rs.getInt("version"),
            stages.isEmpty() ? Set.of() : Set.copyOf(Arrays.asList(stages.split(","))),
            rs.getObject("principal_organisation_id", UUID.class), rs.getObject("brand_id", UUID.class), rs.getString("principal_code"),
            rs.getString("laboratory_code"), rs.getObject("tested_on", LocalDate.class), rs.getBigDecimal("declared_iseer"));
    }

    /** Sets only the evidence fields the write carried; never touches state or version. */
    public void setEvidence(UUID id, UUID filingOrganisationId, EvidenceUpdate update) {
        if (update.isEmpty()) {
            return;
        }
        jdbc.update(
            "UPDATE model_application SET "
                + "laboratory_code = CASE WHEN ? THEN ? ELSE laboratory_code END, "
                + "tested_on = CASE WHEN ? THEN ? ELSE tested_on END, "
                + "declared_iseer = CASE WHEN ? THEN ? ELSE declared_iseer END "
                + "WHERE id = ? AND organisation_id = ? AND state IN ('draft', 'returned')",
            update.setLaboratory(), update.laboratoryCode(), update.setTestedOn(),
            update.testedOn() == null ? null : java.sql.Date.valueOf(update.testedOn()),
            update.setIseer(), update.declaredIseer(), id, filingOrganisationId);
    }

    /** True if an active laboratory-kind organisation has this code. */
    public boolean laboratoryExists(String code) {
        Integer n = jdbc.queryForObject(
            "SELECT count(*)::int FROM organisation WHERE code = ? AND kind = 'laboratory' AND status = 'active'", Integer.class, code);
        return n != null && n > 0;
    }

    /**
     * Laboratories with any accreditation record for the category; whether one covers a date is decided at submit. Only codes
     * the API contract can carry are offered, so one odd organisation code cannot make the whole form response invalid.
     */
    public List<LaboratoryChoice> laboratoriesFor(String category) {
        return jdbc.query(
            "SELECT DISTINCT o.code, o.legal_name FROM master_lab_accreditation m JOIN organisation o ON o.code = m.laboratory_code "
                + "WHERE m.category_code = ? AND o.kind = 'laboratory' AND o.status = 'active' "
                + "AND o.code ~ '^[A-Z0-9_-]{1,32}$' ORDER BY o.code",
            (rs, i) -> new LaboratoryChoice(rs.getString("code"), rs.getString("legal_name")), category);
    }

    /** Serialises concurrent submits of the same brand and model number until the transaction ends. */
    public void lockModelKey(UUID brandId, String modelNumber) {
        // A bounded wait: a stuck same-model submit fails the waiting request as unavailable (retryable) rather than pinning
        // a connection and an open transaction indefinitely.
        jdbc.execute("SET LOCAL lock_timeout = '10s'");
        jdbc.queryForObject("SELECT pg_advisory_xact_lock(hashtextextended(?, 0))::text", String.class,
            "model:" + brandId + ":" + normalisedModelNumber(modelNumber));
    }

    /** Another application that already holds this brand and model number (not a draft, not rejected). */
    public boolean modelNumberTaken(UUID brandId, String modelNumber, UUID exceptId) {
        Integer n = jdbc.queryForObject(
            "SELECT count(*)::int FROM model_application WHERE brand_id = ? AND upper(btrim(model_number)) = ? AND id <> ? "
                + "AND state NOT IN ('draft', 'rejected')",
            Integer.class, brandId, normalisedModelNumber(modelNumber), exceptId);
        return n != null && n > 0;
    }

    static String normalisedModelNumber(String modelNumber) {
        return modelNumber == null ? "" : modelNumber.trim().toUpperCase(java.util.Locale.ROOT);
    }
}
