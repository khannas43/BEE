package gov.bee.api.demo.producttesting;

import gov.bee.api.application.ModelDraftPolicy;
import gov.bee.api.demo.DemoModule;
import gov.bee.api.demo.DemoResult;
import gov.bee.api.demo.ai.AiEngines;
import gov.bee.api.identity.Caller;
import java.sql.Date;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Random;
import java.util.Set;
import java.util.UUID;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * Random testing of products by BEE (demonstration). BEE buys units from the market and tests them at its own cost; the manufacturer does not
 * take part. Products are chosen from the compliance risk of the manufacturer and the grievances received from end customers, or by a
 * risk-weighted random draw. Routes (all {@code /api/demo/product-testing/...}):
 * BEE Officer: {@code GET overview|grievances|selection|cases}, {@code POST cases} (add a product), {@code POST draw} (risk-weighted random),
 * {@code POST {caseId}/advance} (move a case one stage: selected, procured, at_lab, result_in, closed). Manufacturer: {@code GET mine}: its own
 * products with BEE's test results and the grievance count and category per product, with no complainant, source or text.
 * A failed test leads only to a recommendation (none, review or hold); a hold is decided elsewhere. Local demonstration, not BEE rules.
 */
@Component
public class ProductTestingModule implements DemoModule {

    private static final List<String> STAGES = List.of("selected", "procured", "at_lab", "result_in", "closed");
    private static final Set<String> RESULTS = Set.of("pass", "fail", "retest");
    private static final Set<String> RECOMMENDATIONS = Set.of("none", "review", "hold");

    private final ObjectProvider<JdbcTemplate> jdbcProvider;
    private final ObjectProvider<AiEngines> enginesProvider;

    @Autowired
    public ProductTestingModule(ObjectProvider<JdbcTemplate> jdbcProvider, ObjectProvider<AiEngines> enginesProvider) {
        this.jdbcProvider = jdbcProvider;
        this.enginesProvider = enginesProvider;
    }

    private JdbcTemplate jdbc() {
        return jdbcProvider.getObject();
    }

    @Override
    public String name() {
        return "product-testing";
    }

    @Override
    public DemoResult handle(Caller caller, String method, String id, String action, Map<String, String> query, Map<String, Object> body) {
        boolean officer = caller.holds("officer", "all");
        Optional<UUID> own = ModelDraftPolicy.filingOrganisation(caller);
        if ("GET".equals(method) && "mine".equals(id) && own.isPresent() && !officer) {
            return mine(own.get());
        }
        if (!officer) {
            return DemoResult.denied();
        }
        if ("GET".equals(method) && action == null) {
            return switch (id == null ? "" : id) {
                case "overview" -> overview();
                case "grievances" -> grievances();
                case "selection" -> selection();
                case "cases" -> cases();
                case "product" -> product(query.get("reg"));
                default -> DemoResult.notFound();
            };
        }
        if ("POST".equals(method) && action == null && "cases".equals(id)) {
            return createCase(caller, body);
        }
        if ("POST".equals(method) && action == null && "draw".equals(id)) {
            return draw(caller, body);
        }
        if ("POST".equals(method) && "advance".equals(action)) {
            return advance(caller, id, body);
        }
        if ("POST".equals(method) && "decide".equals(action)) {
            return decide(caller, id, body);
        }
        return DemoResult.notFound();
    }

    // ---- risk ------------------------------------------------------------------------------------------------------------------

    private List<Map<String, Object>> scoreProducts() {
        Map<String, Double> orgScore = new LinkedHashMap<>();
        try {
            AiEngines engines = enginesProvider.getIfAvailable();
            if (engines != null) {
                Object entities = engines.complianceRisk().output().get("entities");
                if (entities instanceof List<?> list) {
                    for (Object o : list) {
                        if (o instanceof Map<?, ?> m && m.get("key") != null && m.get("score") instanceof Number n) {
                            orgScore.put(String.valueOf(m.get("key")), n.doubleValue());
                        }
                    }
                }
            }
        } catch (RuntimeException e) {
            // the organisation score is one of four factors; without it the others still rank the products
        }
        Map<String, Map<String, Integer>> byCat = new LinkedHashMap<>();
        for (Map<String, Object> r : jdbc().queryForList("SELECT registration_id, category, count(*) AS n FROM grievance WHERE received_at > now() - interval '90 days' GROUP BY 1, 2")) {
            byCat.computeIfAbsent(String.valueOf(r.get("registration_id")), k -> new LinkedHashMap<>()).put(String.valueOf(r.get("category")), num(r.get("n")));
        }
        Map<String, String> latest = new LinkedHashMap<>();
        for (Map<String, Object> r : jdbc().queryForList("SELECT DISTINCT ON (registration_id) registration_id, result FROM quarterly_test_result ORDER BY registration_id, quarter DESC")) {
            latest.put(String.valueOf(r.get("registration_id")), String.valueOf(r.get("result")));
        }
        Map<String, String> open = new LinkedHashMap<>();
        for (Map<String, Object> r : jdbc().queryForList("SELECT registration_id, reference FROM test_case WHERE stage NOT IN ('closed', 'not_approved')")) {
            open.put(String.valueOf(r.get("registration_id")), String.valueOf(r.get("reference")));
        }
        List<Map<String, Object>> out = new ArrayList<>();
        for (Map<String, Object> c : jdbc().queryForList("SELECT c.registration_id, c.model_number, c.brand_name, c.stars, c.verified_iseer, c.valid_to, a.organisation_id, o.legal_name "
            + "FROM certificate c JOIN model_application a ON a.id = c.application_id JOIN organisation o ON o.id = a.organisation_id WHERE c.valid_to >= current_date")) {
            String reg = String.valueOf(c.get("registration_id"));
            Map<String, Integer> cats = byCat.getOrDefault(reg, Map.of());
            int n = cats.values().stream().mapToInt(Integer::intValue).sum();
            int top = cats.values().stream().mapToInt(Integer::intValue).max().orElse(0);
            double org = orgScore.getOrDefault(String.valueOf(c.get("organisation_id")), 0.0);
            String last = latest.get(reg);
            List<Map<String, Object>> factors = new ArrayList<>();
            int orgPts = (int) Math.round(org * 0.3);
            int grievPts = Math.min(40, n * 5);
            int repeatPts = top >= 3 ? 10 : 0;
            int testPts = last == null ? 10 : "fail".equals(last) ? 25 : "retest".equals(last) ? 15 : 0;
            factors.add(factor("Manufacturer's compliance risk score " + Math.round(org) + " of 100 (30% of it)", orgPts));
            factors.add(factor(n + " customer grievance" + (n == 1 ? "" : "s") + " in the last 90 days (5 points each, at most 40)", grievPts));
            factors.add(factor(top >= 3 ? "The same complaint raised " + top + " times (repeat)" : "No repeated complaint", repeatPts));
            factors.add(factor(last == null ? "Never tested by BEE" : "Latest BEE test: " + last, testPts));
            int score = Math.min(100, orgPts + grievPts + repeatPts + testPts);
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("registrationId", reg);
            m.put("model", c.get("model_number"));
            m.put("brand", c.get("brand_name"));
            m.put("manufacturer", clean(String.valueOf(c.get("legal_name"))));
            m.put("organisationId", String.valueOf(c.get("organisation_id")));
            m.put("stars", c.get("stars"));
            m.put("ratedIseer", String.valueOf(c.get("verified_iseer")));
            m.put("grievances", n);
            m.put("score", score);
            m.put("band", score >= 60 ? "high" : score >= 30 ? "medium" : "low");
            m.put("factors", factors);
            m.put("openCase", open.get(reg));
            out.add(m);
        }
        out.sort((a, b) -> Integer.compare(num(b.get("score")), num(a.get("score"))));
        return out;
    }

    private static Map<String, Object> factor(String label, int points) {
        Map<String, Object> f = new LinkedHashMap<>();
        f.put("label", label);
        f.put("points", points);
        return f;
    }

    private DemoResult selection() {
        List<Map<String, Object>> all = scoreProducts();
        Map<String, Object> res = new LinkedHashMap<>();
        res.put("products", all.size() > 60 ? all.subList(0, 60) : all);
        res.put("total", all.size());
        res.put("note", "Review priority only, not a finding. The points and their weights are shown so every rank can be explained.");
        return DemoResult.ok(res);
    }

    // ---- one product, consolidated -----------------------------------------------------------------------------------------------

    /** Risk score with its points, the production anomaly check for the model, and the grievances against it, in one answer. */
    private DemoResult product(String reg) {
        if (reg == null || reg.isBlank()) {
            return DemoResult.invalid("reg (the certificate registration ID) is required.");
        }
        Optional<Map<String, Object>> found = scoreProducts().stream().filter(p -> reg.equals(p.get("registrationId"))).findFirst();
        if (found.isEmpty()) {
            return DemoResult.notFound();
        }
        Map<String, Object> p = found.get();
        Map<String, Object> anomaly = new LinkedHashMap<>();
        anomaly.put("found", false);
        try {
            AiEngines engines = enginesProvider.getIfAvailable();
            if (engines != null && engines.productionAnomaly().output().get("series") instanceof List<?> list) {
                for (Object o : list) {
                    if (o instanceof Map<?, ?> m && String.valueOf(p.get("model")).equals(String.valueOf(m.get("model")))
                        && String.valueOf(p.get("manufacturer")).equals(clean(String.valueOf(m.get("organisation"))))) {
                        anomaly.put("found", true);
                        anomaly.put("status", m.get("status"));
                        anomaly.put("quarters", m.get("quarters"));
                        anomaly.put("mean", m.get("mean"));
                        anomaly.put("boundSerials", m.get("boundSerials"));
                        anomaly.put("flags", m.get("flags"));
                        break;
                    }
                }
            }
        } catch (RuntimeException e) {
            // the anomaly check is advisory; the other two panels still answer
        }
        List<Map<String, Object>> list = new ArrayList<>();
        Map<String, Integer> byCategory = new LinkedHashMap<>();
        Map<String, Integer> bySource = new LinkedHashMap<>();
        for (Map<String, Object> r : jdbc().queryForList("SELECT reference, source, category, summary, complainant_name, received_at, status FROM grievance WHERE registration_id = ? ORDER BY received_at DESC", reg)) {
            byCategory.merge(String.valueOf(r.get("category")), 1, Integer::sum);
            bySource.merge(String.valueOf(r.get("source")), 1, Integer::sum);
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("reference", r.get("reference"));
            m.put("source", r.get("source"));
            m.put("category", r.get("category"));
            m.put("summary", r.get("summary"));
            m.put("complainant", r.get("complainant_name"));
            m.put("receivedAt", String.valueOf(r.get("received_at")));
            m.put("status", r.get("status"));
            list.add(m);
        }
        Map<String, Object> grievances = new LinkedHashMap<>();
        grievances.put("total", list.size());
        grievances.put("last90", p.get("grievances"));
        grievances.put("byCategory", byCategory);
        grievances.put("bySource", bySource);
        grievances.put("latest", list.size() > 5 ? list.subList(0, 5) : list);
        Map<String, Object> res = new LinkedHashMap<>();
        res.put("product", p);
        res.put("anomaly", anomaly);
        res.put("grievances", grievances);
        res.put("cases", caseList(" WHERE t.registration_id = ?", reg));
        return DemoResult.ok(res);
    }

    // ---- grievances ------------------------------------------------------------------------------------------------------------

    private DemoResult grievances() {
        Map<String, String> open = new LinkedHashMap<>();
        for (Map<String, Object> r : jdbc().queryForList("SELECT registration_id, reference FROM test_case WHERE stage NOT IN ('closed', 'not_approved')")) {
            open.put(String.valueOf(r.get("registration_id")), String.valueOf(r.get("reference")));
        }
        List<Map<String, Object>> out = new ArrayList<>();
        for (Map<String, Object> r : jdbc().queryForList("SELECT g.reference, g.source, g.category, g.registration_id, g.model_number, g.brand_name, o.legal_name, g.summary, g.complainant_name, g.complainant_contact, g.received_at, g.status "
            + "FROM grievance g JOIN organisation o ON o.id = g.organisation_id ORDER BY g.received_at DESC LIMIT 500")) {
            Map<String, Object> m = new LinkedHashMap<>();
            String reg = String.valueOf(r.get("registration_id"));
            m.put("reference", r.get("reference"));
            m.put("source", r.get("source"));
            m.put("category", r.get("category"));
            m.put("registrationId", reg);
            m.put("model", r.get("model_number"));
            m.put("brand", r.get("brand_name"));
            m.put("manufacturer", clean(String.valueOf(r.get("legal_name"))));
            m.put("summary", r.get("summary"));
            m.put("complainant", r.get("complainant_name"));
            m.put("contact", r.get("complainant_contact"));
            m.put("receivedAt", String.valueOf(r.get("received_at")));
            m.put("status", "closed".equals(r.get("status")) ? "closed" : open.containsKey(reg) ? "in_testing" : "open");
            out.add(m);
        }
        Map<String, Object> res = new LinkedHashMap<>();
        res.put("grievances", out);
        res.put("note", "Local demonstration: sample complaints from several channels; names and contacts are made up.");
        return DemoResult.ok(res);
    }

    // ---- cases -----------------------------------------------------------------------------------------------------------------

    private List<Map<String, Object>> caseList(String where, Object... args) {
        List<Map<String, Object>> out = new ArrayList<>();
        Map<String, List<Map<String, Object>>> events = new LinkedHashMap<>();
        for (Map<String, Object> e : jdbc().queryForList("SELECT e.case_id, e.stage, e.note, e.at, u.display_name FROM test_case_event e LEFT JOIN user_account u ON u.id = e.by_user ORDER BY e.at")) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("stage", e.get("stage"));
            m.put("note", e.get("note"));
            m.put("at", String.valueOf(e.get("at")));
            m.put("by", e.get("display_name"));
            events.computeIfAbsent(String.valueOf(e.get("case_id")), k -> new ArrayList<>()).add(m);
        }
        for (Map<String, Object> r : jdbc().queryForList("SELECT t.*, o.legal_name FROM test_case t JOIN organisation o ON o.id = t.organisation_id" + where + " ORDER BY t.updated_at DESC", args)) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", String.valueOf(r.get("id")));
            m.put("reference", r.get("reference"));
            m.put("registrationId", r.get("registration_id"));
            m.put("model", r.get("model_number"));
            m.put("brand", r.get("brand_name"));
            m.put("manufacturer", clean(String.valueOf(r.get("legal_name"))));
            m.put("basis", r.get("basis"));
            m.put("reason", r.get("reason"));
            m.put("riskScore", r.get("risk_score"));
            m.put("stage", r.get("stage"));
            m.put("procuredFrom", r.get("procured_from"));
            m.put("laboratory", r.get("laboratory"));
            m.put("result", r.get("result"));
            m.put("measuredIseer", r.get("measured_iseer") == null ? null : r.get("measured_iseer").toString());
            m.put("ratedIseer", r.get("rated_iseer") == null ? null : r.get("rated_iseer").toString());
            m.put("testedOn", r.get("tested_on") == null ? null : String.valueOf(r.get("tested_on")));
            m.put("recommendation", r.get("recommendation"));
            m.put("approvalRemarks", r.get("approval_remarks"));
            m.put("approvedAt", r.get("approved_at") == null ? null : String.valueOf(r.get("approved_at")));
            m.put("selectedAt", String.valueOf(r.get("selected_at")));
            m.put("updatedAt", String.valueOf(r.get("updated_at")));
            m.put("history", events.getOrDefault(String.valueOf(r.get("id")), List.of()));
            out.add(m);
        }
        return out;
    }

    private DemoResult cases() {
        Map<String, Object> res = new LinkedHashMap<>();
        res.put("cases", caseList(""));
        res.put("stages", STAGES);
        res.put("note", "BEE buys each product from the market and tests it at its own cost; the manufacturer takes no part and sees only the result.");
        return DemoResult.ok(res);
    }

    private DemoResult overview() {
        List<Map<String, Object>> products = scoreProducts();
        Map<String, Integer> sources = new LinkedHashMap<>();
        Map<String, Integer> categories = new LinkedHashMap<>();
        for (Map<String, Object> r : jdbc().queryForList("SELECT source AS k, count(*) AS n FROM grievance GROUP BY 1 ORDER BY 2 DESC")) {
            sources.put(String.valueOf(r.get("k")), num(r.get("n")));
        }
        for (Map<String, Object> r : jdbc().queryForList("SELECT category AS k, count(*) AS n FROM grievance GROUP BY 1 ORDER BY 2 DESC")) {
            categories.put(String.valueOf(r.get("k")), num(r.get("n")));
        }
        Map<String, Integer> stages = new LinkedHashMap<>();
        STAGES.forEach(s -> stages.put(s, 0));
        stages.put("shortlisted", 0);
        stages.put("not_approved", 0);
        for (Map<String, Object> r : jdbc().queryForList("SELECT stage AS k, count(*) AS n FROM test_case GROUP BY 1")) {
            stages.put(String.valueOf(r.get("k")), num(r.get("n")));
        }
        Map<String, Object> res = new LinkedHashMap<>();
        res.put("openGrievances", num(jdbc().queryForObject("SELECT count(*) FROM grievance WHERE status = 'open'", Integer.class)));
        res.put("grievancesLast30", num(jdbc().queryForObject("SELECT count(*) FROM grievance WHERE received_at > now() - interval '30 days'", Integer.class)));
        res.put("flagged", products.stream().filter(p -> num(p.get("score")) >= 60).count());
        res.put("resultsThisQuarter", num(jdbc().queryForObject("SELECT count(*) FROM test_case WHERE result IS NOT NULL AND date_trunc('quarter', tested_on) = date_trunc('quarter', current_date)", Integer.class)));
        res.put("stages", stages);
        res.put("sources", sources);
        res.put("categories", categories);
        res.put("top", products.size() > 5 ? products.subList(0, 5) : products);
        return DemoResult.ok(res);
    }

    private DemoResult createCase(Caller caller, Map<String, Object> body) {
        String reg = text(body.get("registrationId"));
        String basis = text(body.get("basis")) == null ? "risk" : text(body.get("basis"));
        if (reg == null || !Set.of("risk", "manual").contains(basis)) {
            return DemoResult.invalid("registrationId is required, and basis must be risk or manual.");
        }
        Optional<Map<String, Object>> product = scoreProducts().stream().filter(p -> reg.equals(p.get("registrationId"))).findFirst();
        if (product.isEmpty()) {
            return DemoResult.invalid("No valid certificate has that registration ID.");
        }
        if (product.get().get("openCase") != null) {
            return DemoResult.error(HttpStatus.CONFLICT, "version_conflict", "This product already has an open test case (" + product.get().get("openCase") + ").");
        }
        String reason = text(body.get("reason"));
        if (reason != null && reason.length() > 300) {
            return DemoResult.invalid("reason can be at most 300 characters.");
        }
        String ref = insertCase(caller, product.get(), basis, reason != null ? reason : "Added to the shortlist from the risk ranking (score " + product.get().get("score") + ").", null);
        return DemoResult.created(Map.of("reference", ref));
    }

    private String insertCase(Caller caller, Map<String, Object> p, String basis, String reason, UUID drawId) {
        UUID id = UUID.randomUUID();
        Integer seq = jdbc().queryForObject("SELECT count(*) + 1 FROM test_case", Integer.class);
        String ref = String.format("TC-%d-%04d", LocalDate.now().getYear(), seq == null ? 1 : seq);
        jdbc().update("INSERT INTO test_case (id, reference, registration_id, model_number, brand_name, organisation_id, basis, reason, risk_score, rated_iseer, selected_by, draw_id, stage) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'shortlisted')",
            id, ref, p.get("registrationId"), p.get("model"), p.get("brand"), UUID.fromString(String.valueOf(p.get("organisationId"))), basis, reason, num(p.get("score")),
            new java.math.BigDecimal(String.valueOf(p.get("ratedIseer"))), caller.accountId(), drawId);
        jdbc().update("INSERT INTO test_case_event (case_id, stage, note, by_user) VALUES (?,?,?,?)", id, "shortlisted", reason, caller.accountId());
        return ref;
    }

    private DemoResult draw(Caller caller, Map<String, Object> body) {
        int size;
        try {
            size = Integer.parseInt(String.valueOf(body.getOrDefault("size", "3")));
        } catch (NumberFormatException e) {
            return DemoResult.invalid("size must be a number from 1 to 10.");
        }
        if (size < 1 || size > 10) {
            return DemoResult.invalid("size must be a number from 1 to 10.");
        }
        List<Map<String, Object>> pool = new ArrayList<>(scoreProducts().stream().filter(p -> p.get("openCase") == null).toList());
        if (pool.isEmpty()) {
            return DemoResult.invalid("No product is available to draw.");
        }
        long seed = new Random().nextLong();
        Random rnd = new Random(seed);
        List<Map<String, Object>> picked = new ArrayList<>();
        StringBuilder picks = new StringBuilder();
        for (int i = 0; i < size && !pool.isEmpty(); i++) {
            double total = pool.stream().mapToDouble(p -> num(p.get("score")) + 5).sum();
            double x = rnd.nextDouble() * total;
            int idx = 0;
            for (; idx < pool.size() - 1; idx++) {
                x -= num(pool.get(idx).get("score")) + 5;
                if (x < 0) {
                    break;
                }
            }
            Map<String, Object> p = pool.remove(idx);
            picked.add(p);
            picks.append(p.get("registrationId")).append(':').append(num(p.get("score")) + 5).append(';');
        }
        UUID drawId = UUID.randomUUID();
        jdbc().update("INSERT INTO selection_draw (id, by_user, seed, size, picks) VALUES (?,?,?,?,?)", drawId, caller.accountId(), seed, size, picks.toString());
        List<String> refs = new ArrayList<>();
        for (Map<String, Object> p : picked) {
            refs.add(insertCase(caller, p, "random", "Drawn at random with weight " + (num(p.get("score")) + 5) + " (risk score plus a base of 5).", drawId));
        }
        Map<String, Object> res = new LinkedHashMap<>();
        res.put("references", refs);
        res.put("seed", seed);
        return DemoResult.created(res);
    }

    /** The Officer's decision on a shortlisted product: approve it for testing or decline, with remarks (required). */
    private DemoResult decide(Caller caller, String id, Map<String, Object> body) {
        UUID uid;
        try {
            uid = UUID.fromString(id);
        } catch (RuntimeException e) {
            return DemoResult.notFound();
        }
        List<Map<String, Object>> found = jdbc().queryForList("SELECT stage FROM test_case WHERE id = ?", uid);
        if (found.isEmpty()) {
            return DemoResult.notFound();
        }
        if (!"shortlisted".equals(found.get(0).get("stage"))) {
            return DemoResult.error(HttpStatus.CONFLICT, "version_conflict", "This product is not waiting for a decision.");
        }
        String decision = text(body.get("decision"));
        String remarks = text(body.get("remarks"));
        if (decision == null || !Set.of("approve", "decline").contains(decision)) {
            return DemoResult.invalid("decision must be approve or decline.");
        }
        if (remarks == null || remarks.length() < 5 || remarks.length() > 500) {
            return DemoResult.invalid("Remarks are required (5 to 500 characters).");
        }
        String next = "approve".equals(decision) ? "selected" : "not_approved";
        jdbc().update("UPDATE test_case SET stage = ?, approval_remarks = ?, approved_by = ?, approved_at = now(), updated_at = now() WHERE id = ?", next, remarks, caller.accountId(), uid);
        jdbc().update("INSERT INTO test_case_event (case_id, stage, note, by_user) VALUES (?,?,?,?)", uid, next, remarks, caller.accountId());
        return DemoResult.ok(Map.of("stage", next));
    }

    private DemoResult advance(Caller caller, String id, Map<String, Object> body) {
        UUID uid;
        try {
            uid = UUID.fromString(id);
        } catch (RuntimeException e) {
            return DemoResult.notFound();
        }
        List<Map<String, Object>> found = jdbc().queryForList("SELECT * FROM test_case WHERE id = ?", uid);
        if (found.isEmpty()) {
            return DemoResult.notFound();
        }
        Map<String, Object> c = found.get(0);
        String stage = String.valueOf(c.get("stage"));
        int at = STAGES.indexOf(stage);
        if (at < 0) {
            return DemoResult.error(HttpStatus.CONFLICT, "version_conflict", "The Officer must approve this shortlisted product for testing first.");
        }
        if (at >= STAGES.size() - 1) {
            return DemoResult.error(HttpStatus.CONFLICT, "version_conflict", "This case is already closed.");
        }
        String next = STAGES.get(at + 1);
        String note = text(body.get("note"));
        if (note != null && note.length() > 500) {
            return DemoResult.invalid("note can be at most 500 characters.");
        }
        switch (next) {
            case "procured" -> {
                String from = text(body.get("procuredFrom"));
                if (from == null || from.length() < 3 || from.length() > 120) {
                    return DemoResult.invalid("Say where the unit was bought (3 to 120 characters).");
                }
                jdbc().update("UPDATE test_case SET stage = ?, procured_from = ?, updated_at = now() WHERE id = ?", next, from, uid);
            }
            case "at_lab" -> {
                String lab = text(body.get("laboratory"));
                if (lab == null || lab.length() < 2 || lab.length() > 120) {
                    return DemoResult.invalid("Name the laboratory (2 to 120 characters).");
                }
                jdbc().update("UPDATE test_case SET stage = ?, laboratory = ?, updated_at = now() WHERE id = ?", next, lab, uid);
            }
            case "result_in" -> {
                String result = text(body.get("result"));
                LocalDate tested;
                java.math.BigDecimal iseer;
                try {
                    tested = LocalDate.parse(text(body.get("testedOn")));
                    iseer = new java.math.BigDecimal(text(body.get("measuredIseer"))).setScale(2, java.math.RoundingMode.HALF_UP);
                } catch (RuntimeException e) {
                    return DemoResult.invalid("testedOn (yyyy-mm-dd) and measuredIseer are required.");
                }
                if (result == null || !RESULTS.contains(result)) {
                    return DemoResult.invalid("result must be pass, fail or retest.");
                }
                if (tested.isAfter(LocalDate.now()) || iseer.signum() <= 0 || iseer.compareTo(new java.math.BigDecimal("99.99")) > 0) {
                    return DemoResult.invalid("testedOn cannot be in the future and measuredIseer must be between 0 and 100.");
                }
                jdbc().update("UPDATE test_case SET stage = ?, result = ?, measured_iseer = ?, tested_on = ?, updated_at = now() WHERE id = ?", next, result, iseer, Date.valueOf(tested), uid);
                String quarter = tested.getYear() + "-Q" + ((tested.getMonthValue() - 1) / 3 + 1);
                jdbc().update("INSERT INTO quarterly_test_result (organisation_id, quarter, registration_id, model_number, result, measured_iseer, tested_on, laboratory_code, remarks, recorded_by) VALUES (?,?,?,?,?,?,?,?,?,?) "
                    + "ON CONFLICT (organisation_id, quarter, registration_id) DO UPDATE SET result = EXCLUDED.result, measured_iseer = EXCLUDED.measured_iseer, tested_on = EXCLUDED.tested_on, "
                    + "laboratory_code = EXCLUDED.laboratory_code, remarks = EXCLUDED.remarks, recorded_by = EXCLUDED.recorded_by, recorded_at = now()",
                    c.get("organisation_id"), quarter, c.get("registration_id"), c.get("model_number"), result, iseer, Date.valueOf(tested), c.get("laboratory"),
                    "BEE market-sample test, case " + c.get("reference"), caller.accountId());
            }
            default -> {
                String rec = text(body.get("recommendation"));
                if (rec == null || !RECOMMENDATIONS.contains(rec)) {
                    return DemoResult.invalid("recommendation must be none, review or hold.");
                }
                if ("pass".equals(c.get("result")) && !"none".equals(rec)) {
                    return DemoResult.invalid("A product that passed can only be closed with no further action.");
                }
                jdbc().update("UPDATE test_case SET stage = ?, recommendation = ?, updated_at = now() WHERE id = ?", next, rec, uid);
                jdbc().update("UPDATE grievance SET status = 'closed' WHERE registration_id = ? AND status = 'open'", c.get("registration_id"));
            }
        }
        jdbc().update("INSERT INTO test_case_event (case_id, stage, note, by_user) VALUES (?,?,?,?)", uid, next, note, caller.accountId());
        return DemoResult.ok(Map.of("reference", String.valueOf(c.get("reference")), "stage", next));
    }

    // ---- manufacturer ----------------------------------------------------------------------------------------------------------

    private DemoResult mine(UUID org) {
        Map<String, Map<String, Integer>> cats = new LinkedHashMap<>();
        Map<String, Integer> last90 = new LinkedHashMap<>();
        for (Map<String, Object> r : jdbc().queryForList("SELECT registration_id, category, count(*) AS n, count(*) FILTER (WHERE received_at > now() - interval '90 days') AS recent FROM grievance WHERE organisation_id = ? GROUP BY 1, 2", org)) {
            String reg = String.valueOf(r.get("registration_id"));
            cats.computeIfAbsent(reg, k -> new LinkedHashMap<>()).put(String.valueOf(r.get("category")), num(r.get("n")));
            last90.merge(reg, num(r.get("recent")), Integer::sum);
        }
        Map<String, List<Map<String, Object>>> tests = new LinkedHashMap<>();
        for (Map<String, Object> r : jdbc().queryForList("SELECT registration_id, reference, result, measured_iseer, rated_iseer, tested_on, laboratory FROM test_case WHERE organisation_id = ? AND stage IN ('result_in', 'closed') ORDER BY tested_on DESC", org)) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("reference", r.get("reference"));
            m.put("result", r.get("result"));
            m.put("measuredIseer", r.get("measured_iseer") == null ? null : r.get("measured_iseer").toString());
            m.put("ratedIseer", r.get("rated_iseer") == null ? null : r.get("rated_iseer").toString());
            m.put("testedOn", r.get("tested_on") == null ? null : String.valueOf(r.get("tested_on")));
            m.put("laboratory", r.get("laboratory"));
            tests.computeIfAbsent(String.valueOf(r.get("registration_id")), k -> new ArrayList<>()).add(m);
        }
        List<Map<String, Object>> products = new ArrayList<>();
        for (Map<String, Object> c : jdbc().queryForList("SELECT c.registration_id, c.model_number, c.brand_name, c.stars, c.verified_iseer, c.valid_to FROM certificate c JOIN model_application a ON a.id = c.application_id WHERE a.organisation_id = ? ORDER BY c.registration_id", org)) {
            String reg = String.valueOf(c.get("registration_id"));
            Map<String, Integer> byCategory = cats.getOrDefault(reg, Map.of());
            Map<String, Object> g = new LinkedHashMap<>();
            g.put("total", byCategory.values().stream().mapToInt(Integer::intValue).sum());
            g.put("last90", last90.getOrDefault(reg, 0));
            g.put("byCategory", byCategory);
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("registrationId", reg);
            m.put("model", c.get("model_number"));
            m.put("brand", c.get("brand_name"));
            m.put("stars", c.get("stars"));
            m.put("ratedIseer", String.valueOf(c.get("verified_iseer")));
            m.put("validTo", String.valueOf(c.get("valid_to")));
            m.put("grievances", g);
            m.put("tests", tests.getOrDefault(reg, List.of()));
            products.add(m);
        }
        Map<String, Object> res = new LinkedHashMap<>();
        res.put("products", products);
        res.put("note", "BEE buys products from the market and tests them at its own cost. You see the result of each test and how many customer complaints a product has, by category. Complainants are never shown.");
        return DemoResult.ok(res);
    }

    // ---- helpers ---------------------------------------------------------------------------------------------------------------

    private static String clean(String name) {
        return name.replaceAll("\\s*\\(synthetic[^)]*\\)\\s*$", "");
    }

    private static int num(Object o) {
        return o instanceof Number n ? n.intValue() : 0;
    }

    private static String text(Object o) {
        return o == null || String.valueOf(o).isBlank() ? null : String.valueOf(o).trim();
    }
}
