package gov.bee.api.demo.modeltechnical;

import gov.bee.api.application.ModelDraftPolicy;
import gov.bee.api.demo.DemoModule;
import gov.bee.api.demo.DemoResult;
import gov.bee.api.identity.Caller;
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
 * Product details of a model application (demonstration): air-conditioner type, rated cooling capacity and power input, compressor,
 * refrigerant, rated voltage and test report number. {@code GET model-technical/{applicationId}} reads them; {@code POST} saves them.
 * The filing manufacturer may save while the application is a draft or returned; staff roles read every application, a manufacturer
 * reads its own. Outside the contract-listed model application routes, so those records do not change. Local demonstration, not BEE rules.
 */
@Component
public class ModelTechnicalModule implements DemoModule {

    private static final Set<String> TYPES = Set.of("split", "window", "cassette", "portable");
    private static final Set<String> COMPRESSORS = Set.of("fixed", "inverter");
    private static final Set<String> REFRIGERANTS = Set.of("R32", "R410A", "R290", "R22");

    private final ObjectProvider<JdbcTemplate> jdbcProvider;

    @Autowired
    public ModelTechnicalModule(ObjectProvider<JdbcTemplate> jdbcProvider) {
        this.jdbcProvider = jdbcProvider;
    }

    private JdbcTemplate jdbc() {
        return jdbcProvider.getObject();
    }

    @Override
    public String name() {
        return "model-technical";
    }

    @Override
    public DemoResult handle(Caller caller, String method, String id, String action, Map<String, String> query, Map<String, Object> body) {
        UUID app = uuid(id);
        if (app == null || action != null) {
            return DemoResult.notFound();
        }
        List<Map<String, Object>> found = jdbc().queryForList("SELECT organisation_id, state FROM model_application WHERE id = ?", app);
        if (found.isEmpty()) {
            return DemoResult.notFound();
        }
        UUID org = (UUID) found.get(0).get("organisation_id");
        String state = (String) found.get(0).get("state");
        boolean own = caller.organisationIds().contains(org);
        if (!staff(caller) && !own) {
            return DemoResult.notFound();
        }
        boolean canEdit = own && ModelDraftPolicy.filingOrganisation(caller).filter(org::equals).isPresent() && ("draft".equals(state) || "returned".equals(state));
        if ("GET".equals(method)) {
            return DemoResult.ok(view(app, canEdit));
        }
        if (!"POST".equals(method)) {
            return DemoResult.notFound();
        }
        if (!canEdit) {
            return DemoResult.denied();
        }
        return save(caller, app, body, canEdit);
    }

    private DemoResult save(Caller caller, UUID app, Map<String, Object> body, boolean canEdit) {
        String type = choice(body.get("acType"), TYPES);
        String compressor = choice(body.get("compressorType"), COMPRESSORS);
        String refrigerant = choice(body.get("refrigerant"), REFRIGERANTS);
        Integer capacity = integer(body.get("coolingCapacityW"), 500, 30000);
        Integer power = integer(body.get("powerInputW"), 100, 15000);
        Integer voltage = integer(body.get("ratedVoltage"), 180, 260);
        String report = text(body.get("testReportNumber"));
        if (present(body.get("acType")) && type == null) {
            return DemoResult.invalid("acType must be split, window, cassette or portable.");
        }
        if (present(body.get("compressorType")) && compressor == null) {
            return DemoResult.invalid("compressorType must be fixed or inverter.");
        }
        if (present(body.get("refrigerant")) && refrigerant == null) {
            return DemoResult.invalid("refrigerant must be R32, R410A, R290 or R22.");
        }
        if (present(body.get("coolingCapacityW")) && capacity == null) {
            return DemoResult.invalid("coolingCapacityW must be a whole number from 500 to 30000.");
        }
        if (present(body.get("powerInputW")) && power == null) {
            return DemoResult.invalid("powerInputW must be a whole number from 100 to 15000.");
        }
        if (present(body.get("ratedVoltage")) && voltage == null) {
            return DemoResult.invalid("ratedVoltage must be a whole number from 180 to 260.");
        }
        if (report != null && (report.length() < 3 || report.length() > 60)) {
            return DemoResult.invalid("testReportNumber must be 3 to 60 characters.");
        }
        jdbc().update("INSERT INTO model_technical_detail (application_id, ac_type, cooling_capacity_w, power_input_w, compressor_type, refrigerant, rated_voltage, test_report_number, updated_by) "
            + "VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT (application_id) DO UPDATE SET ac_type = EXCLUDED.ac_type, cooling_capacity_w = EXCLUDED.cooling_capacity_w, "
            + "power_input_w = EXCLUDED.power_input_w, compressor_type = EXCLUDED.compressor_type, refrigerant = EXCLUDED.refrigerant, rated_voltage = EXCLUDED.rated_voltage, "
            + "test_report_number = EXCLUDED.test_report_number, updated_by = EXCLUDED.updated_by, updated_at = now()",
            app, type, capacity, power, compressor, refrigerant, voltage, report, caller.accountId());
        return DemoResult.ok(view(app, canEdit));
    }

    private Map<String, Object> view(UUID app, boolean canEdit) {
        List<Map<String, Object>> rows = jdbc().queryForList("SELECT ac_type, cooling_capacity_w, power_input_w, compressor_type, refrigerant, rated_voltage, test_report_number, updated_at FROM model_technical_detail WHERE application_id = ?", app);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("applicationId", app.toString());
        out.put("canEdit", canEdit);
        Map<String, Object> r = rows.isEmpty() ? Map.of() : rows.get(0);
        out.put("acType", r.get("ac_type"));
        out.put("coolingCapacityW", r.get("cooling_capacity_w"));
        out.put("powerInputW", r.get("power_input_w"));
        out.put("compressorType", r.get("compressor_type"));
        out.put("refrigerant", r.get("refrigerant"));
        out.put("ratedVoltage", r.get("rated_voltage"));
        out.put("testReportNumber", r.get("test_report_number"));
        Object cap = r.get("cooling_capacity_w");
        Object pow = r.get("power_input_w");
        out.put("eer", cap instanceof Number c && pow instanceof Number p && p.doubleValue() > 0 ? Math.round(c.doubleValue() / p.doubleValue() * 100.0) / 100.0 : null);
        out.put("saved", !rows.isEmpty());
        out.put("note", "Local demonstration: product details are recorded with the application and are not checked against a BEE standard.");
        return out;
    }

    private static boolean staff(Caller caller) {
        for (String role : new String[] {"officer", "director", "admin", "finance", "programme", "auditor", "reviewer", "iame"}) {
            if (caller.holds(role, "all")) {
                return true;
            }
        }
        return false;
    }

    private static boolean present(Object o) {
        return o != null && !String.valueOf(o).isBlank();
    }

    private static String text(Object o) {
        return present(o) ? String.valueOf(o).trim() : null;
    }

    private static String choice(Object o, Set<String> allowed) {
        String t = text(o);
        return t != null && allowed.contains(t) ? t : null;
    }

    private static Integer integer(Object o, int min, int max) {
        if (!present(o)) {
            return null;
        }
        try {
            double d = o instanceof Number n ? n.doubleValue() : Double.parseDouble(String.valueOf(o).trim());
            if (d != Math.rint(d) || d < min || d > max) {
                return null;
            }
            return (int) d;
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private static UUID uuid(String s) {
        try {
            return s == null ? null : UUID.fromString(s);
        } catch (IllegalArgumentException e) {
            return null;
        }
    }
}
