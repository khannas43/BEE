package gov.bee.api.demo.mis;

import gov.bee.api.demo.DemoModule;
import gov.bee.api.demo.DemoResult;
import gov.bee.api.identity.Caller;
import gov.bee.api.identity.IdentityRepository;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeParseException;
import java.time.temporal.ChronoUnit;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.stereotype.Component;

/**
 * The MIS dashboard of the demonstration: read-only (GET), figures computed from SQL on the live tables on every call. Programme, director,
 * secretary, admin and auditor see every panel; finance sees only the finance panel. Everyone else is refused. Local demonstration on
 * provisional rules, not a BEE report; the panels say which parts are not available yet when another demo area has not landed.
 */
@Component
public class MisModule implements DemoModule {

    static final Set<String> FULL_ROLES = Set.of("programme", "officer", "director", "admin", "auditor");
    static final List<String> PANELS = List.of("summary", "applications", "finance", "production", "certificates");
    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");

    private final MisRepository repo;

    public MisModule(MisRepository repo) {
        this.repo = repo;
    }

    @Override
    public String name() {
        return "mis";
    }

    @Override
    public DemoResult handle(Caller caller, String method, String id, String action, Map<String, String> query, Map<String, Object> body) {
        boolean full = gov.bee.api.demo.DemoAccess.holdsAll(caller, FULL_ROLES);
        boolean finance = gov.bee.api.demo.DemoAccess.holdsAll(caller, Set.of("finance"));
        if (!full && !finance) {
            return DemoResult.denied();
        }
        if (!"GET".equals(method)) {
            return DemoResult.invalid("The MIS dashboard is read-only.");
        }
        if (id == null) {
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("panels", full ? PANELS : List.of("finance"));
            return DemoResult.ok(out);
        }
        LocalDate to;
        LocalDate from;
        try {
            to = query.get("to") == null || query.get("to").isBlank() ? LocalDate.now(IST) : LocalDate.parse(query.get("to"));
            from = query.get("from") == null || query.get("from").isBlank() ? to.withDayOfMonth(1).minusMonths(11) : LocalDate.parse(query.get("from"));
        } catch (DateTimeParseException e) {
            return DemoResult.invalid("Dates are written as yyyy-mm-dd.");
        }
        if (from.isAfter(to)) {
            return DemoResult.invalid("The start date is after the end date.");
        }
        if (ChronoUnit.MONTHS.between(from.withDayOfMonth(1), to.withDayOfMonth(1)) > 35) {
            return DemoResult.invalid("The range can cover at most 36 months.");
        }
        String panel = id;
        boolean exporting = "export".equals(id);
        if (exporting) {
            panel = query.get("panel");
            if (panel == null || !PANELS.contains(panel)) {
                return DemoResult.invalid("Name a panel: " + String.join(", ", PANELS) + ".");
            }
        } else if (!PANELS.contains(id)) {
            return DemoResult.notFound();
        }
        if (!full && !"finance".equals(panel)) {
            return DemoResult.denied();
        }
        MisPanel built = switch (panel) {
            case "summary" -> repo.summary();
            case "applications" -> repo.applications(from, to);
            case "finance" -> repo.finance(from, to);
            case "production" -> repo.production(from, to);
            default -> repo.certificates(from, to);
        };
        Map<String, Object> out = built.toBody(from.toString(), to.toString());
        if (exporting) {
            Map<String, Object> csv = new LinkedHashMap<>();
            csv.put("panel", panel);
            csv.put("asOf", out.get("asOf"));
            csv.put("dataVersion", out.get("dataVersion"));
            csv.put("sources", out.get("sources"));
            csv.put("filename", "mis-" + panel + "-" + LocalDate.now(IST) + ".csv");
            csv.put("csv", built.toCsv(from.toString(), to.toString()));
            return DemoResult.ok(csv);
        }
        return DemoResult.ok(out);
    }
}
