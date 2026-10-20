package gov.bee.api.demo.quarterlytest;

import gov.bee.api.application.ModelDraftPolicy;
import gov.bee.api.demo.DemoModule;
import gov.bee.api.demo.DemoResult;
import gov.bee.api.identity.Caller;
import java.sql.Date;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * BEE's test of a product in a quarter (demonstration). {@code GET quarterly-test?quarter=2026-Q3} lists the results the caller may see
 * (a manufacturer its own, staff every organisation's); {@code POST quarterly-test} records one (BEE Officer or Programme): the
 * certificate of the product, the quarter, the result (pass, fail or retest), the measured ISEER, the test date, the laboratory and a remark.
 * A new record for the same product and quarter replaces the earlier one. Local demonstration, not BEE rules.
 */
@Component
public class QuarterlyTestModule implements DemoModule {

    private static final Set<String> RECORDERS = Set.of("officer", "programme"); // the Admin demonstration profile is read only
    private static final Set<String> READERS = Set.of("officer", "director", "admin", "finance", "programme", "auditor", "reviewer");
    private static final Set<String> RESULTS = Set.of("pass", "fail", "retest");

    private final ObjectProvider<JdbcTemplate> jdbcProvider;

    @Autowired
    public QuarterlyTestModule(ObjectProvider<JdbcTemplate> jdbcProvider) {
        this.jdbcProvider = jdbcProvider;
    }

    private JdbcTemplate jdbc() {
        return jdbcProvider.getObject();
    }

    @Override
    public String name() {
        return "quarterly-test";
    }

    @Override
    public DemoResult handle(Caller caller, String method, String id, String action, Map<String, String> query, Map<String, Object> body) {
        if (id != null || action != null) {
            return DemoResult.notFound();
        }
        boolean staff = anyAll(caller, READERS);
        Optional<UUID> own = ModelDraftPolicy.filingOrganisation(caller);
        if (!staff && own.isEmpty()) {
            return DemoResult.denied();
        }
        if ("GET".equals(method)) {
            return list(staff ? null : own.get(), query.get("quarter"), anyAll(caller, RECORDERS));
        }
        if ("POST".equals(method)) {
            return anyAll(caller, RECORDERS) ? record(caller, body) : DemoResult.denied();
        }
        return DemoResult.notFound();
    }

    private DemoResult list(UUID org, String quarter, boolean canRecord) {
        StringBuilder sql = new StringBuilder("SELECT q.organisation_id, o.legal_name, q.quarter, q.registration_id, q.model_number, q.result, q.measured_iseer, q.tested_on, q.laboratory_code, q.remarks, u.display_name AS by, q.recorded_at "
            + "FROM quarterly_test_result q JOIN organisation o ON o.id = q.organisation_id LEFT JOIN user_account u ON u.id = q.recorded_by WHERE 1 = 1");
        List<Object> args = new ArrayList<>();
        if (org != null) {
            sql.append(" AND q.organisation_id = ?");
            args.add(org);
        }
        if (quarter != null && quarter.matches("[0-9]{4}-Q[1-4]")) {
            sql.append(" AND q.quarter = ?");
            args.add(quarter);
        }
        sql.append(" ORDER BY q.quarter DESC, q.registration_id");
        List<Map<String, Object>> out = new ArrayList<>();
        for (Map<String, Object> r : jdbc().queryForList(sql.toString(), args.toArray())) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("organisationId", String.valueOf(r.get("organisation_id")));
            m.put("organisation", r.get("legal_name"));
            m.put("quarter", r.get("quarter"));
            m.put("registrationId", r.get("registration_id"));
            m.put("modelNumber", r.get("model_number"));
            m.put("result", r.get("result"));
            m.put("measuredIseer", r.get("measured_iseer") == null ? null : r.get("measured_iseer").toString());
            m.put("testedOn", String.valueOf(r.get("tested_on")));
            m.put("laboratory", r.get("laboratory_code"));
            m.put("remarks", r.get("remarks"));
            m.put("recordedBy", r.get("by"));
            m.put("recordedAt", String.valueOf(r.get("recorded_at")));
            out.add(m);
        }
        Map<String, Object> res = new LinkedHashMap<>();
        res.put("results", out);
        res.put("canRecord", canRecord);
        res.put("note", "Local demonstration: a test result is recorded by BEE for a product and a quarter; it is not a BEE record.");
        return DemoResult.ok(res);
    }

    private DemoResult record(Caller caller, Map<String, Object> body) {
        String quarter = text(body.get("quarter"));
        String reg = text(body.get("registrationId"));
        String result = text(body.get("result"));
        if (quarter == null || !quarter.matches("[0-9]{4}-Q[1-4]")) {
            return DemoResult.invalid("quarter must look like 2026-Q3.");
        }
        if (reg == null || result == null || !RESULTS.contains(result)) {
            return DemoResult.invalid("registrationId and a result (pass, fail or retest) are required.");
        }
        LocalDate tested;
        try {
            tested = LocalDate.parse(text(body.get("testedOn")));
        } catch (Exception e) {
            return DemoResult.invalid("testedOn must be a date (yyyy-mm-dd).");
        }
        if (tested.isAfter(LocalDate.now())) {
            return DemoResult.invalid("testedOn cannot be in the future.");
        }
        java.math.BigDecimal iseer = null;
        if (text(body.get("measuredIseer")) != null) {
            try {
                iseer = new java.math.BigDecimal(text(body.get("measuredIseer"))).setScale(2, java.math.RoundingMode.HALF_UP);
            } catch (NumberFormatException e) {
                return DemoResult.invalid("measuredIseer must be a number.");
            }
            if (iseer.signum() <= 0 || iseer.compareTo(new java.math.BigDecimal("99.99")) > 0) {
                return DemoResult.invalid("measuredIseer must be above 0 and below 100.");
            }
        }
        String remarks = text(body.get("remarks"));
        if (remarks != null && remarks.length() > 500) {
            return DemoResult.invalid("remarks can be at most 500 characters.");
        }
        List<Map<String, Object>> cert = jdbc().queryForList("SELECT a.organisation_id, c.model_number FROM certificate c JOIN model_application a ON a.id = c.application_id WHERE c.registration_id = ?", reg);
        if (cert.isEmpty()) {
            return DemoResult.invalid("No certificate has that registration ID.");
        }
        jdbc().update("INSERT INTO quarterly_test_result (organisation_id, quarter, registration_id, model_number, result, measured_iseer, tested_on, laboratory_code, remarks, recorded_by) VALUES (?,?,?,?,?,?,?,?,?,?) "
            + "ON CONFLICT (organisation_id, quarter, registration_id) DO UPDATE SET result = EXCLUDED.result, measured_iseer = EXCLUDED.measured_iseer, tested_on = EXCLUDED.tested_on, "
            + "laboratory_code = EXCLUDED.laboratory_code, remarks = EXCLUDED.remarks, recorded_by = EXCLUDED.recorded_by, recorded_at = now()",
            cert.get(0).get("organisation_id"), quarter, reg, cert.get(0).get("model_number"), result, iseer, Date.valueOf(tested), text(body.get("laboratoryCode")), remarks, caller.accountId());
        return list((UUID) cert.get(0).get("organisation_id"), quarter, true);
    }

    private static boolean anyAll(Caller c, Set<String> roles) {
        for (String r : roles) {
            if (c.holds(r, "all")) {
                return true;
            }
        }
        return false;
    }

    private static String text(Object o) {
        return o == null || String.valueOf(o).isBlank() ? null : String.valueOf(o).trim();
    }
}
