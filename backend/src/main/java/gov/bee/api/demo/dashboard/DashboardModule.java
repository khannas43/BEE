package gov.bee.api.demo.dashboard;

import gov.bee.api.demo.DemoAccess;
import gov.bee.api.demo.DemoModule;
import gov.bee.api.demo.DemoResult;
import gov.bee.api.demo.ledger.LedgerRepository;
import gov.bee.api.demo.ledger.LedgerStatus;
import gov.bee.api.identity.Caller;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * The Director's and the Auditor's dashboards of the demonstration (read only). Each is a set of tiles (a figure and the first few rows) that
 * drill down to the full list behind the figure. Everything is computed from the live tables on every call; nothing here writes.
 * {@code GET dashboard}, {@code GET dashboard/{director|auditor}}, {@code GET dashboard/{view}/{tile}}.
 * Director: director, secretary, programme and admin, each held for all records. Auditor: auditor and admin, held for all records.
 * Local demonstration on provisional rules, not a BEE report.
 */
@Component
public class DashboardModule implements DemoModule {

    static final Set<String> DIRECTOR = Set.of("director", "secretary", "programme", "admin");
    static final Set<String> AUDITOR = Set.of("auditor", "admin");
    static final int PREVIEW = 5;
    static final int DRILL = 200;
    static final String NOTE = "Local demonstration: computed from the live demo tables on every call; not a BEE report.";

    private final ObjectProvider<JdbcTemplate> jdbcProvider;
    private final ObjectProvider<gov.bee.api.demo.ai.AiEngines> enginesProvider;
    private gov.bee.api.demo.ai.AiEngines fixedEngines;
    private JdbcTemplate fixed;
    private LedgerRepository ledgerRepo;

    /** Resolved on first use so the web-layer tests (no database) can start the context without a JdbcTemplate. */
    @Autowired
    public DashboardModule(ObjectProvider<JdbcTemplate> jdbcProvider, ObjectProvider<gov.bee.api.demo.ai.AiEngines> enginesProvider) {
        this.jdbcProvider = jdbcProvider;
        this.enginesProvider = enginesProvider;
    }

    DashboardModule(JdbcTemplate jdbc, gov.bee.api.demo.ai.AiEngines engines) {
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

    @Override
    public String name() {
        return "dashboard";
    }

    /** One tile: its figure, a short hint, a tone for the colour, the columns of its list, and where the rows come from. */
    private record Tile(String key, String label, String unit, String hint, String tone, List<String> columns, String href) {
    }

    private static final List<Tile> DIRECTOR_TILES = List.of(
        new Tile("awaiting_approval", "Awaiting approval", "applications", "In director review or waiting for the Secretary's final approval.", "attention",
            List.of("Reference", "Model", "Manufacturer", "Stage", "Since (IST)"), "/app/approvals"),
        new Tile("certificates", "Certificates issued", "certificates", "Every certificate with its state on the simulated ledger.", "good",
            List.of("Registration ID", "Model", "Manufacturer", "Valid to", "Ledger"), "/app/demo/ledger"),
        new Tile("ledger_attention", "Ledger needs a look", "certificates", "Revoked, waiting for a second signature, or failed on the simulated ledger.", "attention",
            List.of("Registration ID", "Model", "Ledger", "Last change (IST)"), "/app/demo/ledger"),
        new Tile("production_review", "Production with BEE", "submissions", "Quarterly figures sent and not yet accepted, or returned with a query.", "attention",
            List.of("Manufacturer", "Quarter", "State", "Units", "Since (IST)"), "/app/demo/production"),
        new Tile("fees_unconfirmed", "Paid, fee not confirmed", "payments", "Payments the simulated gateway took that Finance has not confirmed yet.", "attention",
            List.of("Application", "Manufacturer", "Amount INR", "Paid (IST)", "Gateway reference"), "/app/demo/payments"),
        new Tile("ai_risk", "Highest compliance risk", "organisations", "Organisations in the high band of the compliance risk model, worked out now. Open the AI screen for the evidence and to record a decision.", "neutral",
            List.of("Manufacturer", "Score", "Band", "Applications"), "/app/demo/ai"));

    private static final List<Tile> AUDITOR_TILES = List.of(
        new Tile("ledger_integrity", "Ledger chains", "certificates", "Every hash recomputed. MISMATCH means a record no longer matches its chain.", "attention",
            List.of("Registration ID", "Chain", "First bad transaction", "Transactions", "Manufacturer"), "/app/demo/ledger"),
        new Tile("two_person_proof", "Two-person commits", "commits", "Who sent and who committed each ledger change. Nobody commits their own.", "good",
            List.of("Registration ID", "Kind", "Sent by", "Committed by", "Block", "Committed (IST)"), "/app/demo/ledger"),
        new Tile("overrides", "AI overrides and rejections", "decisions", "Where a person set aside what an advisory model said, with the reason given.", "attention",
            List.of("When (IST)", "Model", "Person", "Decision", "Their value", "Reason"), "/app/demo/ai"),
        new Tile("payment_trail", "Payment trail", "events", "Every step of every simulated payment, with the person and role.", "neutral",
            List.of("When (IST)", "Application", "Gateway reference", "Event", "Person", "Role"), "/app/demo/payments"),
        new Tile("production_reviews", "Production reviews", "events", "Submissions, queries, acceptances and corrections of quarterly production figures.", "neutral",
            List.of("When (IST)", "Manufacturer", "Quarter", "Action", "Person", "Note"), "/app/demo/production"),
        new Tile("activity", "All recorded activity", "events", "Payments, ledger, production and AI steps together, newest first.", "neutral",
            List.of("When (IST)", "Area", "Action", "Person", "Record"), null));

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
        List<Tile> tiles = isDirector ? DIRECTOR_TILES : AUDITOR_TILES;
        if (action == null) {
            return DemoResult.ok(overview(id, tiles));
        }
        Tile tile = tiles.stream().filter(t -> t.key().equals(action)).findFirst().orElse(null);
        if (tile == null) {
            return DemoResult.notFound();
        }
        return DemoResult.ok(drill(id, tile, DRILL));
    }

    private Map<String, Object> overview(String view, List<Tile> tiles) {
        List<Map<String, Object>> out = new ArrayList<>();
        for (Tile t : tiles) {
            Rows r = rows(view, t.key(), PREVIEW);
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("key", t.key());
            m.put("label", t.label());
            m.put("value", r.total());
            m.put("unit", t.unit());
            m.put("hint", t.hint());
            m.put("tone", t.tone());
            m.put("columns", t.columns());
            m.put("rows", r.rows());
            m.put("note", r.note());
            m.put("href", t.href());
            out.add(m);
        }
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("view", view);
        body.put("title", "director".equals(view) ? "Director's dashboard" : "Auditor's dashboard");
        body.put("asOf", Instant.now().toString());
        body.put("tiles", out);
        body.put("note", NOTE);
        return body;
    }

    private Map<String, Object> drill(String view, Tile t, int limit) {
        Rows r = rows(view, t.key(), limit);
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("view", view);
        m.put("key", t.key());
        m.put("label", t.label());
        m.put("hint", t.hint());
        m.put("columns", t.columns());
        m.put("rows", r.rows());
        m.put("total", r.total());
        m.put("shown", r.rows().size());
        m.put("note", r.note());
        m.put("href", t.href());
        m.put("asOf", Instant.now().toString());
        return m;
    }

    private record Rows(int total, List<List<Object>> rows, String note) {
    }

    private Rows rows(String view, String key, int limit) {
        return switch (view + "/" + key) {
            case "director/awaiting_approval" -> query(
                "SELECT a.reference, a.brand_name || ' ' || a.model_number, o.legal_name, a.state, "
                    + "(SELECT max(e.occurred_at) FROM model_application_transition_event e WHERE e.application_id = a.id) AS since "
                    + "FROM model_application a JOIN organisation o ON o.id = a.organisation_id WHERE a.state IN ('director_review', 'secretary_approval') ORDER BY since NULLS LAST, a.reference", limit);
            case "director/certificates" -> query(
                "SELECT c.registration_id, c.brand_name || ' ' || c.model_number, c.organisation_name, c.valid_to, " + LEDGER_WORD + " FROM certificate c ORDER BY c.registration_id", limit);
            case "director/ledger_attention" -> query(
                "SELECT registration_id, model, ledger, at FROM (SELECT c.registration_id, c.brand_name || ' ' || c.model_number AS model, " + LEDGER_WORD + " AS ledger, "
                    + "(SELECT max(t.created_at) FROM ledger_tx t WHERE t.certificate_id = c.id) AS at FROM certificate c) x WHERE ledger IN ('Revoked', 'Waiting for a second signature', 'Failed') ORDER BY at DESC", limit);
            case "director/production_review" -> query(
                "SELECT o.legal_name, s.quarter, s.state, (SELECT COALESCE(sum(r.units), 0) FROM production_row r WHERE r.submission_id = s.id), s.submitted_at "
                    + "FROM production_submission s JOIN organisation o ON o.id = s.organisation_id WHERE s.state IN ('submitted', 'query') ORDER BY s.submitted_at DESC NULLS LAST", limit);
            case "director/fees_unconfirmed" -> query(
                "SELECT a.reference, o.legal_name, p.amount_inr, p.settled_at, p.gateway_ref FROM payment p JOIN model_application a ON a.id = p.application_id "
                    + "JOIN organisation o ON o.id = p.organisation_id WHERE p.status = 'paid' AND a.state = 'fee_due' ORDER BY p.settled_at DESC", limit);
            case "director/ai_risk" -> aiRisk(limit);
            case "auditor/ledger_integrity" -> ledgerIntegrity(limit);
            case "auditor/two_person_proof" -> query(
                "SELECT c.registration_id, t.kind, COALESCE(s.username, '?'), COALESCE(d.username, '?'), t.block_no, t.committed_at FROM ledger_tx t JOIN certificate c ON c.id = t.certificate_id "
                    + "LEFT JOIN user_account s ON s.id = t.submitted_by LEFT JOIN user_account d ON d.id = t.decided_by WHERE t.state = 'committed' ORDER BY t.block_no DESC", limit,
                "Committed by the same person who sent it: " + jdbc().queryForObject("SELECT count(*) FROM ledger_tx WHERE state = 'committed' AND submitted_by = decided_by", Integer.class));
            case "auditor/overrides" -> query(
                "SELECT d.at, r.use_case, COALESCE(u.username, '?'), d.decision, d.override_value, d.reason FROM ai_disposition d JOIN ai_run r ON r.id = d.run_id "
                    + "LEFT JOIN user_account u ON u.id = d.actor_account_id WHERE d.decision IN ('override', 'reject') ORDER BY d.at DESC", limit);
            case "auditor/payment_trail" -> query(
                "SELECT e.occurred_at, a.reference, p.gateway_ref, e.event, COALESCE(u.username, '?'), e.actor_role FROM payment_event e JOIN payment p ON p.id = e.payment_id "
                    + "JOIN model_application a ON a.id = p.application_id LEFT JOIN user_account u ON u.id = e.actor_account_id ORDER BY e.occurred_at DESC", limit);
            case "auditor/production_reviews" -> query(
                "SELECT e.occurred_at, o.legal_name, s.quarter, e.action, COALESCE(u.username, '?'), left(COALESCE(e.note, ''), 120) FROM production_event e JOIN production_submission s ON s.id = e.submission_id "
                    + "JOIN organisation o ON o.id = s.organisation_id LEFT JOIN user_account u ON u.id = e.actor_account_id "
                    + "WHERE e.action IN ('submitted', 'review_accepted', 'review_query', 'rows_replaced') ORDER BY e.occurred_at DESC", limit);
            case "auditor/activity" -> query(
                "SELECT at, area, action, who, record FROM ("
                    + "SELECT e.occurred_at AS at, 'Payments' AS area, e.event AS action, e.actor_account_id AS actor, a.reference AS record FROM payment_event e JOIN payment p ON p.id = e.payment_id JOIN model_application a ON a.id = p.application_id "
                    + "UNION ALL SELECT e.occurred_at, 'Ledger', e.action, e.actor_account_id, c.registration_id FROM ledger_event e JOIN certificate c ON c.id = e.certificate_id "
                    + "UNION ALL SELECT e.occurred_at, 'Production', e.action, e.actor_account_id, o.legal_name || ' ' || s.quarter FROM production_event e JOIN production_submission s ON s.id = e.submission_id JOIN organisation o ON o.id = s.organisation_id "
                    + "UNION ALL SELECT e.at, 'AI', e.action, e.actor_account_id, r.use_case FROM ai_audit_event e JOIN ai_run r ON r.id = e.run_id) x "
                    + "LEFT JOIN LATERAL (SELECT username AS who FROM user_account WHERE id = x.actor) u ON true ORDER BY at DESC", limit);
            default -> new Rows(0, List.of(), null);
        };
    }

    /** The ledger's word on a certificate, as a plain phrase. */
    private static final String LEDGER_WORD = "CASE "
        + "WHEN NOT EXISTS (SELECT 1 FROM ledger_tx t WHERE t.certificate_id = c.id) THEN 'Not submitted' "
        + "WHEN EXISTS (SELECT 1 FROM ledger_tx t WHERE t.certificate_id = c.id AND t.kind = 'revoke' AND t.state = 'committed') THEN 'Revoked' "
        + "WHEN EXISTS (SELECT 1 FROM ledger_tx t WHERE t.certificate_id = c.id AND t.state = 'failed' AND NOT EXISTS (SELECT 1 FROM ledger_tx n WHERE n.certificate_id = c.id AND n.seq = t.seq AND n.attempt > t.attempt)) THEN 'Failed' "
        + "WHEN EXISTS (SELECT 1 FROM ledger_tx t WHERE t.certificate_id = c.id AND t.state = 'pending') THEN 'Waiting for a second signature' "
        + "ELSE 'Active' END";

    private Rows query(String sql, int limit) {
        return query(sql, limit, null);
    }

    /** Runs the list query and also counts all its rows, so a figure is the true total even when only a few rows are shown. */
    private Rows query(String sql, int limit, String note) {
        Integer total = jdbc().queryForObject("SELECT count(*) FROM (" + sql + ") counted", Integer.class);
        List<List<Object>> rows = jdbc().query("SELECT * FROM (" + sql + ") page LIMIT " + limit, (rs, i) -> {
            int n = rs.getMetaData().getColumnCount();
            List<Object> cells = new ArrayList<>();
            for (int c = 1; c <= n; c++) {
                Object v = rs.getObject(c);
                cells.add(v instanceof Timestamp ts ? ts.toInstant().toString() : v instanceof java.sql.Date d ? d.toString() : v instanceof java.math.BigDecimal bd ? bd.toPlainString()
                    : v instanceof UUID u ? u.toString() : v);
            }
            return cells;
        });
        return new Rows(total == null ? 0 : total, rows, note);
    }

    /** The compliance risk model's ranking, computed now from the live tables (nothing is stored; a stored run is made on the AI screen). */
    @SuppressWarnings("unchecked")
    private Rows aiRisk(int limit) {
        var engines = fixedEngines != null ? fixedEngines : enginesProvider.getObject();
        Map<String, Object> out = engines.complianceRisk().output();
        List<Map<String, Object>> entities = (List<Map<String, Object>>) out.get("entities");
        List<List<Object>> rows = new ArrayList<>();
        int high = 0;
        for (Map<String, Object> e : entities) {
            if ("high".equals(e.get("band"))) {
                high++;
                if (rows.size() < limit) {
                    rows.add(List.of(String.valueOf(e.get("name")), e.get("score"), String.valueOf(e.get("band")), e.get("applications")));
                }
            }
        }
        return new Rows(high, rows, "The high band only: " + high + " of " + entities.size() + " organisations, highest score first, computed now. A priority for a person to look at, not a finding.");
    }

    private Rows ledgerIntegrity(int limit) {
        List<LedgerRepository.Cert> certs = ledger().certificates(null);
        List<List<Object>> rows = new ArrayList<>();
        int mismatches = 0;
        List<List<Object>> bad = new ArrayList<>();
        for (LedgerRepository.Cert c : certs) {
            var chain = ledger().chain(c.id());
            if (chain.isEmpty()) {
                continue;
            }
            var check = LedgerStatus.verify(chain);
            if (!check.match()) {
                mismatches++;
            }
            List<Object> row = List.of(c.registrationId(), check.match() ? "MATCH" : "MISMATCH", check.firstBadSeq() == null ? "" : check.firstBadSeq(), chain.size(), c.manufacturer());
            (check.match() ? rows : bad).add(row);
        }
        // the broken chains come first
        List<List<Object>> ordered = new ArrayList<>(bad);
        ordered.addAll(rows);
        return new Rows(mismatches, ordered.size() > limit ? ordered.subList(0, limit) : ordered,
            mismatches + " of " + ordered.size() + " certificates on the simulated ledger do not match their chain.");
    }
}
