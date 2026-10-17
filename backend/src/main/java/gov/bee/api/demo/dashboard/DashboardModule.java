package gov.bee.api.demo.dashboard;

import gov.bee.api.demo.DemoAccess;
import gov.bee.api.demo.DemoModule;
import gov.bee.api.demo.DemoResult;
import gov.bee.api.demo.ai.AiEngines;
import gov.bee.api.demo.ledger.LedgerRepository;
import gov.bee.api.demo.ledger.LedgerStatus;
import gov.bee.api.identity.Caller;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.time.YearMonth;
import java.time.ZoneId;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.UUID;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * The Director's and the Auditor's dashboards of the demonstration (read only). Each is a set of tiles: a figure, small charts and the first
 * few rows; a tile drills down to the full list behind the figure. Every tile, chart and list follows an optional date range
 * ({@code from}, {@code to}, yyyy-mm-dd, India time). Everything is computed from the live tables on every call; nothing here writes.
 * {@code GET dashboard}, {@code GET dashboard/{director|auditor}}, {@code GET dashboard/{view}/{tile}}, each with {@code ?from=&to=}.
 * Director: director, secretary, programme and admin, each held for all records. Auditor: auditor and admin, held for all records.
 * Local demonstration on provisional rules, not a BEE report.
 */
@Component
public class DashboardModule implements DemoModule {

    static final Set<String> DIRECTOR = Set.of("director", "secretary", "programme", "admin");
    static final Set<String> AUDITOR = Set.of("auditor", "admin");
    static final int PREVIEW = 5;
    static final int DRILL = 200;
    static final ZoneId IST = ZoneId.of("Asia/Kolkata");
    static final String NOTE = "Local demonstration: computed from the live demo tables on every call; not a BEE report.";

    private final ObjectProvider<JdbcTemplate> jdbcProvider;
    private final ObjectProvider<AiEngines> enginesProvider;
    private AiEngines fixedEngines;
    private JdbcTemplate fixed;
    private LedgerRepository ledgerRepo;

    /** Resolved on first use so the web-layer tests (no database) can start the context without a JdbcTemplate. */
    @Autowired
    public DashboardModule(ObjectProvider<JdbcTemplate> jdbcProvider, ObjectProvider<AiEngines> enginesProvider) {
        this.jdbcProvider = jdbcProvider;
        this.enginesProvider = enginesProvider;
    }

    DashboardModule(JdbcTemplate jdbc, AiEngines engines) {
        this.jdbcProvider = null;
        this.enginesProvider = null;
        this.fixed = jdbc;
        this.fixedEngines = engines;
    }

    private JdbcTemplate jdbc() {
        return fixed != null ? fixed : jdbcProvider.getObject();
    }

    private LedgerRepository ledger() {
        if (ledgerRepo == null) {
            ledgerRepo = new LedgerRepository(jdbc());
        }
        return ledgerRepo;
    }

    private AiEngines engines() {
        return fixedEngines != null ? fixedEngines : enginesProvider.getObject();
    }

    @Override
    public String name() {
        return "dashboard";
    }

    /** The date range of one request; either end may be missing. */
    record Range(LocalDate from, LocalDate to) {
        boolean set() {
            return from != null || to != null;
        }
    }

    /**
     * One tile. The list is {@code SELECT sel FROM from WHERE where [range on dcol] ORDER BY dcol DESC}; the charts group the same rows:
     * a donut by {@code donutExpr}, bars by {@code barExpr}, and a monthly trend of {@code trendValue} over the date range (the last twelve
     * months when none is set).
     */
    private record Spec(String key, String label, String unit, String hint, String tone, String icon, List<String> columns, String href,
                        String sel, String from, String where, String dcol, String donutExpr, String donutTitle, String barExpr, String barTitle,
                        String trendValue, String trendTitle) {
    }

    /** The ledger's word on a certificate, as a plain phrase (alias {@code c} is the certificate). */
    private static final String LEDGER_WORD = "CASE "
        + "WHEN NOT EXISTS (SELECT 1 FROM ledger_tx t WHERE t.certificate_id = c.id) THEN 'Not submitted' "
        + "WHEN EXISTS (SELECT 1 FROM ledger_tx t WHERE t.certificate_id = c.id AND t.kind = 'revoke' AND t.state = 'committed') THEN 'Revoked' "
        + "WHEN EXISTS (SELECT 1 FROM ledger_tx t WHERE t.certificate_id = c.id AND t.state = 'failed' AND NOT EXISTS (SELECT 1 FROM ledger_tx n WHERE n.certificate_id = c.id AND n.seq = t.seq AND n.attempt > t.attempt)) THEN 'Failed' "
        + "WHEN EXISTS (SELECT 1 FROM ledger_tx t WHERE t.certificate_id = c.id AND t.state = 'pending') THEN 'Waiting for a second signature' "
        + "ELSE 'Active' END";

    private static final List<Spec> DIRECTOR_TILES = List.of(
        new Spec("awaiting_approval", "Awaiting approval", "applications", "In director review or waiting for the Secretary's final approval.", "attention", "pending_actions",
            List.of("Reference", "Model", "Manufacturer", "Stage", "Since (IST)"), "/app/approvals",
            "a.reference, a.brand_name || ' ' || a.model_number, o.legal_name, a.state, t.at",
            "model_application a JOIN organisation o ON o.id = a.organisation_id LEFT JOIN LATERAL (SELECT max(e.occurred_at) AS at FROM model_application_transition_event e WHERE e.application_id = a.id) t ON true",
            "a.state IN ('director_review', 'secretary_approval')", "t.at", "a.state", "By stage", null, null, "count(*)", "Reached approval, by month"),
        new Spec("certificates", "Certificates issued", "certificates", "Every certificate with its state on the simulated ledger.", "good", "verified",
            List.of("Registration ID", "Model", "Manufacturer", "Valid to", "Ledger"), "/app/demo/ledger",
            "c.registration_id, c.brand_name || ' ' || c.model_number, c.organisation_name, c.valid_to, " + LEDGER_WORD,
            "certificate c", "true", "c.issued_at", LEDGER_WORD, "By ledger state", "c.category_code", "By category", "count(*)", "Issued, by month"),
        new Spec("ledger_attention", "Ledger needs a look", "certificates", "Revoked, waiting for a second signature, or failed on the simulated ledger.", "attention", "link_off",
            List.of("Registration ID", "Model", "Ledger", "Last change (IST)"), "/app/demo/ledger",
            "c.registration_id, c.brand_name || ' ' || c.model_number, c.ledger, c.at",
            "(SELECT c0.*, " + LEDGER_WORD.replace(" c.id", " c0.id").replace("n.certificate_id = c.id", "n.certificate_id = c0.id") + " AS ledger, (SELECT max(t.created_at) FROM ledger_tx t WHERE t.certificate_id = c0.id) AS at FROM certificate c0) c",
            "c.ledger IN ('Revoked', 'Waiting for a second signature', 'Failed')", "c.at", "c.ledger", "By ledger state", null, null, "count(*)", "Changed, by month"),
        new Spec("production_review", "Production with BEE", "submissions", "Quarterly figures sent and not yet accepted, or returned with a query.", "attention", "factory",
            List.of("Manufacturer", "Quarter", "State", "Units", "Since (IST)"), "/app/demo/production",
            "o.legal_name, s.quarter, s.state, (SELECT COALESCE(sum(r.units), 0) FROM production_row r WHERE r.submission_id = s.id), s.submitted_at",
            "production_submission s JOIN organisation o ON o.id = s.organisation_id", "s.state IN ('submitted', 'query')", "s.submitted_at",
            "s.state", "By state", "s.quarter", "By quarter", "count(*)", "Sent, by month"),
        new Spec("fees_unconfirmed", "Paid, fee not confirmed", "payments", "Payments the simulated gateway took that Finance has not confirmed yet.", "attention", "payments",
            List.of("Application", "Manufacturer", "Amount INR", "Paid (IST)", "Gateway reference"), "/app/demo/payments",
            "a.reference, o.legal_name, p.amount_inr, p.settled_at, p.gateway_ref",
            "payment p JOIN model_application a ON a.id = p.application_id JOIN organisation o ON o.id = p.organisation_id", "p.status = 'paid' AND a.state = 'fee_due'", "p.settled_at",
            null, null, "o.legal_name", "By manufacturer", "COALESCE(sum(p.amount_inr), 0)", "INR taken, by month"));

    private static final List<Spec> AUDITOR_TILES = List.of(
        new Spec("two_person_proof", "Two-person commits", "commits", "Who sent and who committed each ledger change. Nobody commits their own.", "good", "group",
            List.of("Registration ID", "Kind", "Sent by", "Committed by", "Block", "Committed (IST)"), "/app/demo/ledger",
            "c.registration_id, t.kind, COALESCE(s.username, '?'), COALESCE(d.username, '?'), t.block_no, t.committed_at",
            "ledger_tx t JOIN certificate c ON c.id = t.certificate_id LEFT JOIN user_account s ON s.id = t.submitted_by LEFT JOIN user_account d ON d.id = t.decided_by",
            "t.state = 'committed'", "t.committed_at", "t.kind", "By kind", "COALESCE(d.username, '?')", "By committer", "count(*)", "Committed, by month"),
        new Spec("overrides", "AI overrides and rejections", "decisions", "Where a person set aside what an advisory model said, with the reason given.", "attention", "rule",
            List.of("When (IST)", "Model", "Person", "Decision", "Their value", "Reason"), "/app/demo/ai",
            "d.at, r.use_case, COALESCE(u.username, '?'), d.decision, d.override_value, d.reason",
            "ai_disposition d JOIN ai_run r ON r.id = d.run_id LEFT JOIN user_account u ON u.id = d.actor_account_id", "d.decision IN ('override', 'reject')", "d.at",
            "d.decision", "By decision", "r.use_case", "By model", "count(*)", "Decided, by month"),
        new Spec("payment_trail", "Payment trail", "events", "Every step of every simulated payment, with the person and role.", "neutral", "receipt_long",
            List.of("When (IST)", "Application", "Gateway reference", "Event", "Person", "Role"), "/app/demo/payments",
            "e.occurred_at, a.reference, p.gateway_ref, e.event, COALESCE(u.username, '?'), e.actor_role",
            "payment_event e JOIN payment p ON p.id = e.payment_id JOIN model_application a ON a.id = p.application_id LEFT JOIN user_account u ON u.id = e.actor_account_id",
            "true", "e.occurred_at", "e.event", "By event", "e.actor_role", "By role", "count(*)", "Events, by month"),
        new Spec("production_reviews", "Production reviews", "events", "Submissions, queries, acceptances and corrections of quarterly production figures.", "neutral", "fact_check",
            List.of("When (IST)", "Manufacturer", "Quarter", "Action", "Person", "Note"), "/app/demo/production",
            "e.occurred_at, o.legal_name, s.quarter, e.action, COALESCE(u.username, '?'), left(COALESCE(e.note, ''), 120)",
            "production_event e JOIN production_submission s ON s.id = e.submission_id JOIN organisation o ON o.id = s.organisation_id LEFT JOIN user_account u ON u.id = e.actor_account_id",
            "e.action IN ('submitted', 'review_accepted', 'review_query', 'rows_replaced')", "e.occurred_at", "e.action", "By action", "s.quarter", "By quarter", "count(*)", "Events, by month"),
        new Spec("activity", "All recorded activity", "events", "Payments, ledger, production and AI steps together, newest first.", "neutral", "timeline",
            List.of("When (IST)", "Area", "Action", "Person", "Record"), null,
            "x.at, x.area, x.action, COALESCE(u.username, '?'), x.record",
            "(SELECT e.occurred_at AS at, 'Payments' AS area, e.event AS action, e.actor_account_id AS actor, a.reference AS record FROM payment_event e JOIN payment p ON p.id = e.payment_id JOIN model_application a ON a.id = p.application_id "
                + "UNION ALL SELECT e.occurred_at, 'Ledger', e.action, e.actor_account_id, c.registration_id FROM ledger_event e JOIN certificate c ON c.id = e.certificate_id "
                + "UNION ALL SELECT e.occurred_at, 'Production', e.action, e.actor_account_id, o.legal_name || ' ' || s.quarter FROM production_event e JOIN production_submission s ON s.id = e.submission_id JOIN organisation o ON o.id = s.organisation_id "
                + "UNION ALL SELECT e.at, 'AI', e.action, e.actor_account_id, r.use_case FROM ai_audit_event e JOIN ai_run r ON r.id = e.run_id) x LEFT JOIN user_account u ON u.id = x.actor",
            "true", "x.at", "x.area", "By area", "COALESCE(u.username, '?')", "By person", "count(*)", "Recorded, by month"));

    @Override
    public DemoResult handle(Caller caller, String method, String id, String action, Map<String, String> query, Map<String, Object> body) {
        if (!"GET".equals(method)) {
            return DemoResult.invalid("The dashboards are read-only.");
        }
        boolean director = DemoAccess.holdsAll(caller, DIRECTOR);
        boolean auditor = DemoAccess.holdsAll(caller, AUDITOR);
        if (!director && !auditor) {
            return DemoResult.denied();
        }
        if (id == null) {
            List<String> views = new ArrayList<>();
            if (director) views.add("director");
            if (auditor) views.add("auditor");
            return DemoResult.ok(Map.of("views", views, "note", NOTE));
        }
        boolean isDirector = "director".equals(id);
        if (!isDirector && !"auditor".equals(id)) {
            return DemoResult.notFound();
        }
        if (isDirector ? !director : !auditor) {
            return DemoResult.denied();
        }
        Range range;
        try {
            range = new Range(date(query.get("from")), date(query.get("to")));
        } catch (DateTimeParseException e) {
            return DemoResult.invalid("Dates are written as yyyy-mm-dd.");
        }
        if (range.from() != null && range.to() != null && range.from().isAfter(range.to())) {
            return DemoResult.invalid("The start date is after the end date.");
        }
        if (action == null) {
            return DemoResult.ok(overview(id, range));
        }
        boolean known = ("director".equals(id) ? "ai_risk" : "ledger_integrity").equals(action)
            || (isDirector ? DIRECTOR_TILES : AUDITOR_TILES).stream().anyMatch(t -> t.key().equals(action));
        if (!known) {
            return DemoResult.notFound();
        }
        return DemoResult.ok(tileBody(id, action, range, DRILL, true));
    }

    private static LocalDate date(String s) {
        return s == null || s.isBlank() ? null : LocalDate.parse(s.trim());
    }

    // ------------------------------------------------------------------ the tiles

    private record Head(String key, String label, String unit, String hint, String tone, String icon, List<String> columns, String href) {
    }

    /** The tiles in screen order, the computed one (risk or chains) in its place. */
    private List<Head> heads(String view) {
        List<Head> out = new ArrayList<>();
        if ("director".equals(view)) {
            DIRECTOR_TILES.forEach(s -> out.add(head(s)));
            out.add(new Head("ai_risk", "Highest compliance risk", "organisations", "Organisations in the high band of the compliance risk model, worked out now.", "danger", "warning",
                List.of("Manufacturer", "Score", "Risk band", "Why it is high", "Applications"), "/app/demo/ai"));
        } else {
            out.add(new Head("ledger_integrity", "Ledger chains", "certificates", "Every hash recomputed. MISMATCH means a record no longer matches its chain.", "danger", "shield",
                List.of("Registration ID", "Chain", "First bad transaction", "Transactions", "Manufacturer"), "/app/demo/ledger"));
            AUDITOR_TILES.forEach(s -> out.add(head(s)));
        }
        return out;
    }

    private static Head head(Spec s) {
        return new Head(s.key(), s.label(), s.unit(), s.hint(), s.tone(), s.icon(), s.columns(), s.href());
    }

    private Map<String, Object> overview(String view, Range range) {
        List<Map<String, Object>> tiles = new ArrayList<>();
        for (Head h : heads(view)) {
            tiles.add(tileBody(view, h.key(), range, PREVIEW, false));
        }
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("view", view);
        body.put("title", "director".equals(view) ? "Director's dashboard" : "Auditor's dashboard");
        body.put("asOf", Instant.now().toString());
        body.put("range", rangeBody(range));
        body.put("tiles", tiles);
        body.put("note", NOTE);
        return body;
    }

    private static Map<String, Object> rangeBody(Range r) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("from", r.from() == null ? null : r.from().toString());
        m.put("to", r.to() == null ? null : r.to().toString());
        return m;
    }

    /** One tile as the overview shows it (a few rows) or as its drill-down (up to 200, with the true total). */
    private Map<String, Object> tileBody(String view, String key, Range range, int limit, boolean drill) {
        Head h = heads(view).stream().filter(x -> x.key().equals(key)).findFirst().orElseThrow();
        Result r;
        List<Map<String, Object>> charts = new ArrayList<>();
        if ("ai_risk".equals(key)) {
            r = aiRisk(range, limit, charts);
        } else if ("ledger_integrity".equals(key)) {
            r = ledgerIntegrity(range, limit, charts);
        } else {
            Spec s = (director(view) ? DIRECTOR_TILES : AUDITOR_TILES).stream().filter(x -> x.key().equals(key)).findFirst().orElseThrow();
            r = specResult(s, range, limit, charts);
        }
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("key", h.key());
        m.put("label", h.label());
        m.put("unit", h.unit());
        m.put("hint", h.hint());
        m.put("tone", h.tone());
        m.put("icon", h.icon());
        m.put("columns", h.columns());
        m.put("rows", r.rows());
        m.put("value", r.total());
        m.put("total", r.total());
        m.put("shown", r.rows().size());
        m.put("note", r.note());
        m.put("href", h.href());
        m.put("charts", charts);
        if (r.details() != null) {
            m.put("details", r.details());
        }
        m.put("range", rangeBody(range));
        m.put("asOf", Instant.now().toString());
        return m;
    }

    private static boolean director(String view) {
        return "director".equals(view);
    }

    private record Result(int total, List<List<Object>> rows, String note, List<List<Map<String, Object>>> details) {
    }

    // ------------------------------------------------------------------ SQL tiles

    /** The range predicate on a date expression, in India time, and its arguments. */
    private static String clause(String dcol, Range r, List<Object> args) {
        StringBuilder sb = new StringBuilder();
        if (r.from() != null) {
            sb.append(" AND (").append(dcol).append(" AT TIME ZONE 'Asia/Kolkata')::date >= ?::date");
            args.add(r.from().toString());
        }
        if (r.to() != null) {
            sb.append(" AND (").append(dcol).append(" AT TIME ZONE 'Asia/Kolkata')::date <= ?::date");
            args.add(r.to().toString());
        }
        return sb.toString();
    }

    private Result specResult(Spec s, Range range, int limit, List<Map<String, Object>> charts) {
        List<Object> args = new ArrayList<>();
        String filter = " FROM " + s.from() + " WHERE (" + s.where() + ")" + clause(s.dcol(), range, args);
        Integer total = jdbc().queryForObject("SELECT count(*)" + filter, Integer.class, args.toArray());
        List<List<Object>> rows = jdbc().query("SELECT " + s.sel() + filter + " ORDER BY " + s.dcol() + " DESC NULLS LAST LIMIT " + limit, (rs, i) -> cells(rs), args.toArray());
        if (s.donutExpr() != null) {
            charts.add(chart("donut", s.donutTitle(), grouped(s.donutExpr(), "count(*)", filter, args)));
        }
        if (s.barExpr() != null) {
            charts.add(chart("bars", s.barTitle(), grouped(s.barExpr(), s.trendValue().startsWith("count") ? "count(*)" : s.trendValue(), filter, args)));
        }
        charts.add(chart("trend", s.trendTitle(), trend(s, range)));
        String note = null;
        if ("two_person_proof".equals(s.key())) {
            Integer same = jdbc().queryForObject("SELECT count(*)" + filter + " AND t.submitted_by = t.decided_by", Integer.class, args.toArray());
            note = "Committed by the same person who sent it: " + (same == null ? 0 : same);
        }
        return new Result(total == null ? 0 : total, rows, note, null);
    }

    private List<Map<String, Object>> grouped(String expr, String value, String filter, List<Object> args) {
        return jdbc().query("SELECT " + expr + " AS label, " + value + " AS v" + filter + " GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 8",
            (rs, i) -> point(String.valueOf(rs.getObject(1)), rs.getBigDecimal(2).doubleValue()), args.toArray());
    }

    /** Monthly figures over the range, or the last twelve months, with empty months filled in. */
    private List<Map<String, Object>> trend(Spec s, Range range) {
        YearMonth end = range.to() != null ? YearMonth.from(range.to()) : YearMonth.now(IST);
        YearMonth start = range.from() != null ? YearMonth.from(range.from()) : end.minusMonths(11);
        if (start.isAfter(end)) {
            start = end;
        }
        if (start.plusMonths(35).isBefore(end)) {
            start = end.minusMonths(35);
        }
        List<Object> args = new ArrayList<>();
        Range window = new Range(start.atDay(1), end.atEndOfMonth());
        String sql = "SELECT to_char(" + s.dcol() + " AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM') AS m, " + s.trendValue() + " AS v FROM " + s.from() + " WHERE (" + s.where() + ")"
            + clause(s.dcol(), window, args) + " GROUP BY 1";
        Map<String, Double> found = new HashMap<>();
        jdbc().query(sql, rs -> {
            found.put(rs.getString(1), rs.getBigDecimal(2).doubleValue());
        }, args.toArray());
        List<Map<String, Object>> out = new ArrayList<>();
        for (YearMonth m = start; !m.isAfter(end); m = m.plusMonths(1)) {
            out.add(point(m.toString(), found.getOrDefault(m.toString(), 0.0)));
        }
        return out;
    }

    private static Map<String, Object> point(String label, double value) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("label", label);
        m.put("value", value == Math.rint(value) ? (Object) (long) value : (Object) value);
        return m;
    }

    private static Map<String, Object> chart(String kind, String title, List<Map<String, Object>> data) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("kind", kind);
        m.put("title", title);
        m.put("data", data);
        return m;
    }

    private static List<Object> cells(java.sql.ResultSet rs) throws java.sql.SQLException {
        int n = rs.getMetaData().getColumnCount();
        List<Object> cells = new ArrayList<>();
        for (int c = 1; c <= n; c++) {
            Object v = rs.getObject(c);
            cells.add(v instanceof Timestamp ts ? ts.toInstant().toString() : v instanceof java.sql.Date d ? d.toString() : v instanceof java.math.BigDecimal bd ? bd.toPlainString()
                : v instanceof UUID u ? u.toString() : v);
        }
        return cells;
    }

    // ------------------------------------------------------------------ the compliance risk tile

    private static String trim(double d) {
        return d == Math.rint(d) ? String.valueOf((long) d) : String.valueOf(Math.round(d * 10) / 10.0);
    }

    @SuppressWarnings("unchecked")
    private Result aiRisk(Range range, int limit, List<Map<String, Object>> charts) {
        Map<String, Object> out = engines().complianceRisk().output();
        List<Map<String, Object>> entities = (List<Map<String, Object>>) out.get("entities");
        // A date range lists the organisations that had application activity in that period; the scores themselves use each organisation's whole history.
        Set<String> active = null;
        if (range.set()) {
            active = new java.util.HashSet<>();
            List<Object> args = new ArrayList<>();
            String sql = "SELECT DISTINCT o.id::text FROM model_application a JOIN organisation o ON o.id = a.organisation_id WHERE a.state <> 'draft'"
                + clause("COALESCE((SELECT max(e.occurred_at) FROM model_application_transition_event e WHERE e.application_id = a.id), a.created_at)", range, args);
            active.addAll(jdbc().queryForList(sql, String.class, args.toArray()));
        }
        Map<String, Integer> bands = new TreeMap<>();
        List<List<Object>> rows = new ArrayList<>();
        List<List<Map<String, Object>>> details = new ArrayList<>();
        int high = 0;
        for (Map<String, Object> e : entities) {
            // synthetic demonstration organisations have no dates: they count as current, so a range that includes today keeps them
            boolean in = active == null || (Boolean.TRUE.equals(e.get("synthetic")) ? includesToday(range) : active.contains(String.valueOf(e.get("key"))));
            if (!in) {
                continue;
            }
            String band = String.valueOf(e.get("band"));
            bands.merge(band, 1, Integer::sum);
            if (!"high".equals(band)) {
                continue;
            }
            high++;
            if (rows.size() < limit) {
                List<Map<String, Object>> why = new ArrayList<>();
                for (Map<String, Object> f : (List<Map<String, Object>>) e.get("features")) {
                    double c = ((Number) f.get("contribution")).doubleValue();
                    if (c > 0) {
                        Map<String, Object> w = new LinkedHashMap<>();
                        w.put("factor", f.get("feature"));
                        w.put("points", c);
                        w.put("weight", f.get("weight"));
                        w.put("reason", reasonOf(f));
                        why.add(w);
                    }
                }
                why.sort((a, b) -> Double.compare(((Number) b.get("points")).doubleValue(), ((Number) a.get("points")).doubleValue()));
                String top = why.stream().limit(2).map(w -> String.valueOf(w.get("reason"))).reduce((a, b) -> a + "; " + b).orElse("No single factor stands out");
                rows.add(List.of(String.valueOf(e.get("name")), e.get("score"), "High", top, e.get("applications")));
                details.add(why);
            }
        }
        List<Map<String, Object>> donut = new ArrayList<>();
        for (String b : List.of("high", "medium", "low")) {
            donut.add(point(b.substring(0, 1).toUpperCase() + b.substring(1), bands.getOrDefault(b, 0)));
        }
        charts.add(chart("donut", "Organisations by risk band", donut));
        List<Map<String, Object>> top = new ArrayList<>();
        for (int i = 0; i < Math.min(5, rows.size()); i++) {
            top.add(point(String.valueOf(rows.get(i).get(0)), ((Number) rows.get(i).get(1)).doubleValue()));
        }
        charts.add(chart("bars", "Highest scores (out of 100)", top));
        int total = bands.values().stream().mapToInt(Integer::intValue).sum();
        return new Result(high, rows, "High band: " + high + " of " + total + " organisations" + (range.set() ? " active in this period" : "") + ". A priority for a person to look at, not a finding."
            + (range.set() ? " Scores use the whole history of each organisation; demonstration organisations without dates count as current." : ""), details);
    }

    private static boolean includesToday(Range r) {
        LocalDate today = LocalDate.now(IST);
        return (r.from() == null || !r.from().isAfter(today)) && (r.to() == null || !r.to().isBefore(today));
    }

    /** What one feature means in words, with the point at which it carries its full weight. */
    static String reasonOf(Map<String, Object> f) {
        String name = String.valueOf(f.get("feature"));
        double v = ((Number) f.get("value")).doubleValue();
        double full = ((Number) f.get("fullAt")).doubleValue();
        if (name.startsWith("Returned share")) {
            return trim(v * 100) + "% of its applications were sent back (full weight at " + trim(full * 100) + "%)";
        }
        if (name.startsWith("Rejected share")) {
            return trim(v * 100) + "% of its applications were rejected (full weight at " + trim(full * 100) + "%)";
        }
        if (name.startsWith("Declared minus verified")) {
            return "declared efficiency is " + trim(v) + "% above what the tests verified (full weight at " + trim(full) + "%)";
        }
        if (name.startsWith("Fee confirmation delay")) {
            return "fees take " + trim(v) + " days to be confirmed (full weight at " + trim(full) + " days)";
        }
        if (name.startsWith("Resubmissions")) {
            return trim(v) + " applications were resubmitted (full weight at " + trim(full) + ")";
        }
        if (name.startsWith("Latest quarter production")) {
            return "latest quarter's production is " + trim(1 + v) + " times its earlier average (full weight at " + trim(1 + full) + " times)";
        }
        return name + ": " + trim(v);
    }

    // ------------------------------------------------------------------ the ledger chain tile

    private Result ledgerIntegrity(Range range, int limit, List<Map<String, Object>> charts) {
        List<LedgerRepository.Cert> certs = ledger().certificates(null);
        Map<UUID, java.time.LocalDate> last = new HashMap<>();
        jdbc().query("SELECT certificate_id, (max(created_at) AT TIME ZONE 'Asia/Kolkata')::date FROM ledger_tx GROUP BY certificate_id", rs -> {
            last.put(rs.getObject(1, UUID.class), rs.getDate(2).toLocalDate());
        });
        List<List<Object>> good = new ArrayList<>();
        List<List<Object>> bad = new ArrayList<>();
        for (LedgerRepository.Cert c : certs) {
            var chain = ledger().chain(c.id());
            if (chain.isEmpty()) {
                continue;
            }
            LocalDate at = last.get(c.id());
            if (range.from() != null && (at == null || at.isBefore(range.from()))) {
                continue;
            }
            if (range.to() != null && (at == null || at.isAfter(range.to()))) {
                continue;
            }
            var check = LedgerStatus.verify(chain);
            List<Object> row = List.of(c.registrationId(), check.match() ? "MATCH" : "MISMATCH", check.firstBadSeq() == null ? "" : check.firstBadSeq(), chain.size(), c.manufacturer());
            (check.match() ? good : bad).add(row);
        }
        List<List<Object>> ordered = new ArrayList<>(bad);
        ordered.addAll(good);
        charts.add(chart("donut", "Chain check", List.of(point("MATCH", good.size()), point("MISMATCH", bad.size()))));
        Map<String, Integer> by = new TreeMap<>();
        ordered.forEach(r -> by.merge(String.valueOf(r.get(4)), 1, Integer::sum));
        List<Map<String, Object>> bars = new ArrayList<>();
        by.entrySet().stream().sorted((a, b) -> b.getValue() - a.getValue()).limit(6).forEach(e -> bars.add(point(e.getKey(), e.getValue())));
        charts.add(chart("bars", "Certificates on the ledger, by manufacturer", bars));
        return new Result(bad.size(), ordered.size() > limit ? ordered.subList(0, limit) : ordered,
            bad.size() + " of " + ordered.size() + " certificates on the simulated ledger do not match their chain.", null);
    }
}
