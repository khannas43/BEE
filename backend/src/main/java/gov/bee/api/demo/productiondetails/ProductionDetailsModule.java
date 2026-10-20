package gov.bee.api.demo.productiondetails;

import gov.bee.api.application.ModelDraftPolicy;
import gov.bee.api.demo.DemoModule;
import gov.bee.api.demo.DemoResult;
import gov.bee.api.demo.qr.QrRepository;
import gov.bee.api.identity.Caller;
import java.math.BigDecimal;
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
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * Production details (demonstration), after section 1.3 of the SOP for the BEE S&amp;L portal: what a manufacturer produced per model in each quarter
 * of a financial year (April to March), the serial numbers linked to each production line, and the label fee with its payment.
 * {@code GET production-details?fy=2026-27} the grid (units per model and quarter, fee, payment, serials, CA evidence state);
 * {@code GET production-details/line?app=&fy=&fq=} the serial numbers of one line; {@code POST production-details/serials} make serial numbers
 * for a line; {@code POST production-details/pay} an order for the label fee of chosen quarters; {@code POST production-details/{orderId}/complete}
 * the simulated gateway answer. A manufacturer or agency works its own organisation; BEE staff read one organisation (read only).
 * The fee rate is a placeholder (SOP example: 10 units, 300 rupees), not the rate of Schedules A and B. Local demonstration, not BEE rules.
 */
@Component
public class ProductionDetailsModule implements DemoModule {

    static final BigDecimal FEE_PER_UNIT = new BigDecimal("30.00");
    private static final long MAX_PER_CERTIFICATE = 100_000L;
    private static final int MAX_QUANTITY = 5000;
    private static final Set<String> STAFF = Set.of("officer", "director", "finance", "programme", "admin", "auditor");
    private static final Set<String> METHODS = Set.of("billdesk", "razorpay", "direct_transfer");
    private static final String[] QUARTER_LABEL = {"Q1 (April to June)", "Q2 (July to September)", "Q3 (October to December)", "Q4 (January to March)"};

    private final ObjectProvider<JdbcTemplate> jdbcProvider;
    private final QrRepository qr;

    @Autowired
    public ProductionDetailsModule(ObjectProvider<JdbcTemplate> jdbcProvider, QrRepository qr) {
        this.jdbcProvider = jdbcProvider;
        this.qr = qr;
    }

    private JdbcTemplate jdbc() {
        return jdbcProvider.getObject();
    }

    @Override
    public String name() {
        return "production-details";
    }

    // ---- financial-year helpers ------------------------------------------------------------------------------------------------

    /** "2026-Q2" (calendar quarter) to financial year "2026-27" and quarter 1 to 4 (April to June is Q1). */
    static int[] fyOf(String calendarQuarter) {
        int year = Integer.parseInt(calendarQuarter.substring(0, 4));
        int n = Integer.parseInt(calendarQuarter.substring(6));
        return n == 1 ? new int[] {year - 1, 4} : new int[] {year, n - 1};
    }

    static String fyName(int startYear) {
        return startYear + "-" + String.format("%02d", (startYear + 1) % 100);
    }

    static String calendarQuarterOf(int startYear, int fq) {
        return fq == 4 ? (startYear + 1) + "-Q1" : startYear + "-Q" + (fq + 1);
    }

    private static Integer startYearOf(String fy) {
        return fy != null && fy.matches("[0-9]{4}-[0-9]{2}") ? Integer.valueOf(fy.substring(0, 4)) : null;
    }

    private static int currentFyStart() {
        LocalDate d = LocalDate.now();
        return d.getMonthValue() >= 4 ? d.getYear() : d.getYear() - 1;
    }

    // ---- routes ----------------------------------------------------------------------------------------------------------------

    @Override
    public DemoResult handle(Caller caller, String method, String id, String action, Map<String, String> query, Map<String, Object> body) {
        boolean staff = false;
        for (String r : STAFF) {
            staff = staff || caller.holds(r, "all");
        }
        Optional<UUID> own = ModelDraftPolicy.filingOrganisation(caller);
        if (!staff && own.isEmpty()) {
            return DemoResult.denied();
        }
        boolean writer = own.isPresent() && !staff;
        if ("GET".equals(method) && id == null) {
            return grid(staff, own.orElse(null), query);
        }
        if ("GET".equals(method) && "line".equals(id) && action == null) {
            return line(staff, own.orElse(null), query);
        }
        if (!writer) {
            return DemoResult.denied();
        }
        if ("POST".equals(method) && "serials".equals(id) && action == null) {
            return makeSerials(caller, own.get(), body);
        }
        if ("POST".equals(method) && "pay".equals(id) && action == null) {
            return order(caller, own.get(), body);
        }
        if ("POST".equals(method) && "complete".equals(action)) {
            return complete(own.get(), id, body);
        }
        if ("POST".equals(method) && "cancel".equals(action)) {
            return cancel(own.get(), id);
        }
        return DemoResult.notFound();
    }

    private UUID organisationFor(boolean staff, UUID own, String code) {
        if (!staff) {
            return own;
        }
        if (code == null || code.isBlank()) {
            return null;
        }
        List<UUID> found = jdbc().queryForList("SELECT id FROM organisation WHERE code = ?", UUID.class, code.trim());
        return found.isEmpty() ? null : found.get(0);
    }

    private DemoResult grid(boolean staff, UUID own, Map<String, String> query) {
        UUID org = organisationFor(staff, own, query.get("organisation"));
        Map<String, Object> res = new LinkedHashMap<>();
        res.put("staff", staff);
        res.put("feePerUnit", FEE_PER_UNIT.toPlainString());
        res.put("equipment", "Room Air Conditioner (Fixed Speed)");
        if (staff) {
            res.put("organisations", jdbc().queryForList("SELECT o.code, o.legal_name AS name FROM organisation o WHERE EXISTS (SELECT 1 FROM production_submission s WHERE s.organisation_id = o.id) ORDER BY o.legal_name"));
        }
        if (org == null) {
            res.put("lines", List.of());
            res.put("years", List.of());
            return DemoResult.ok(res);
        }
        int cur = currentFyStart();
        Integer asked = startYearOf(query.get("fy"));
        int start = asked != null ? asked : cur;
        List<String> years = new ArrayList<>();
        for (int y = cur; y >= 2013; y--) {
            years.add(fyName(y));
        }
        String fy = fyName(start);
        res.put("organisation", jdbc().queryForObject("SELECT legal_name FROM organisation WHERE id = ?", String.class, org).replaceAll("\\s*\\(synthetic[^)]*\\)\\s*$", ""));
        res.put("organisationCode", jdbc().queryForObject("SELECT code FROM organisation WHERE id = ?", String.class, org));
        res.put("financialYear", fy);
        res.put("years", years);

        // units per model and financial-year quarter, with the submission each quarter came from
        Map<UUID, Map<String, Object>> lines = new LinkedHashMap<>();
        long[] unitsQ = new long[4];
        Map<Integer, Map<String, Object>> subs = new LinkedHashMap<>();
        for (int fq = 1; fq <= 4; fq++) {
            String cq = calendarQuarterOf(start, fq);
            List<Map<String, Object>> s = jdbc().queryForList("SELECT s.id, s.state, (SELECT count(*) FROM production_evidence e WHERE e.submission_id = s.id) AS evidence FROM production_submission s WHERE s.organisation_id = ? AND s.quarter = ?", org, cq);
            if (!s.isEmpty()) {
                Map<String, Object> m = new LinkedHashMap<>();
                m.put("id", String.valueOf(s.get(0).get("id")));
                m.put("state", s.get(0).get("state"));
                m.put("evidence", ((Number) s.get(0).get("evidence")).intValue());
                subs.put(fq, m);
            }
            for (Map<String, Object> r : jdbc().queryForList("SELECT r.model_application_id AS app, sum(r.units) AS u, a.model_number, a.brand_name, a.reference, c.registration_id, c.valid_to, c.id AS cert "
                + "FROM production_submission s JOIN production_row r ON r.submission_id = s.id JOIN model_application a ON a.id = r.model_application_id "
                + "LEFT JOIN certificate c ON c.application_id = a.id WHERE s.organisation_id = ? AND s.quarter = ? GROUP BY r.model_application_id, a.model_number, a.brand_name, a.reference, c.registration_id, c.valid_to, c.id", org, cq)) {
                UUID app = (UUID) r.get("app");
                Map<String, Object> line = lines.computeIfAbsent(app, k -> {
                    Map<String, Object> m = new LinkedHashMap<>();
                    m.put("applicationId", app.toString());
                    m.put("model", r.get("model_number"));
                    m.put("brand", r.get("brand_name"));
                    m.put("reference", r.get("reference"));
                    m.put("registrationId", r.get("registration_id"));
                    String mark = "";
                    if (r.get("valid_to") != null && ((java.sql.Date) r.get("valid_to")).toLocalDate().isBefore(LocalDate.now())) {
                        mark = "expired";
                    }
                    if (r.get("cert") != null && qr.ledgerRevoked((UUID) r.get("cert"))) {
                        mark = "withdrawn";
                    }
                    m.put("mark", mark);
                    List<Map<String, Object>> quarters = new ArrayList<>();
                    for (int q = 1; q <= 4; q++) {
                        Map<String, Object> qm = new LinkedHashMap<>();
                        qm.put("fq", q);
                        qm.put("units", 0L);
                        qm.put("serials", Map.of("total", 0, "bound", 0, "voided", 0));
                        quarters.add(qm);
                    }
                    m.put("quarters", quarters);
                    return m;
                });
                long u = ((Number) r.get("u")).longValue();
                @SuppressWarnings("unchecked")
                Map<String, Object> qm = ((List<Map<String, Object>>) line.get("quarters")).get(fq - 1);
                qm.put("units", u);
                unitsQ[fq - 1] += u;
            }
        }
        // serial numbers linked to each line
        for (Map<String, Object> r : jdbc().queryForList("SELECT b.model_application_id AS app, l.fy_quarter AS fq, count(s.serial) AS total, count(*) FILTER (WHERE s.state = 'bound') AS bound, count(*) FILTER (WHERE s.state = 'void') AS voided "
            + "FROM production_line_batch l JOIN qr_batch b ON b.id = l.batch_id LEFT JOIN qr_serial s ON s.batch_id = b.id WHERE b.organisation_id = ? AND l.financial_year = ? GROUP BY b.model_application_id, l.fy_quarter", org, fy)) {
            Map<String, Object> line = lines.get((UUID) r.get("app"));
            if (line != null) {
                @SuppressWarnings("unchecked")
                Map<String, Object> qm = ((List<Map<String, Object>>) line.get("quarters")).get(((Number) r.get("fq")).intValue() - 1);
                qm.put("serials", Map.of("total", ((Number) r.get("total")).intValue(), "bound", ((Number) r.get("bound")).intValue(), "voided", ((Number) r.get("voided")).intValue()));
            }
        }
        // payments per quarter and recent orders
        Map<Integer, Map<String, Object>> pay = new LinkedHashMap<>();
        for (Map<String, Object> r : jdbc().queryForList("SELECT fy_quarter, status, order_id, method, receipt_number, amount_inr FROM label_fee_payment WHERE organisation_id = ? AND financial_year = ? AND status IN ('initiated', 'paid')", org, fy)) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("status", r.get("status"));
            m.put("orderId", r.get("order_id"));
            m.put("method", r.get("method"));
            m.put("receipt", r.get("receipt_number"));
            pay.put(((Number) r.get("fy_quarter")).intValue(), m);
        }
        List<Map<String, Object>> quarters = new ArrayList<>();
        BigDecimal payable = BigDecimal.ZERO;
        BigDecimal paid = BigDecimal.ZERO;
        for (int fq = 1; fq <= 4; fq++) {
            Map<String, Object> q = new LinkedHashMap<>();
            BigDecimal fee = FEE_PER_UNIT.multiply(BigDecimal.valueOf(unitsQ[fq - 1]));
            Map<String, Object> p = pay.get(fq);
            q.put("fq", fq);
            q.put("label", QUARTER_LABEL[fq - 1]);
            q.put("calendarQuarter", calendarQuarterOf(start, fq));
            q.put("units", unitsQ[fq - 1]);
            q.put("fee", fee.toPlainString());
            q.put("payment", p);
            q.put("submission", subs.get(fq));
            quarters.add(q);
            payable = payable.add(fee);
            if (p != null && "paid".equals(p.get("status"))) {
                paid = paid.add(fee);
            }
        }
        res.put("lines", new ArrayList<>(lines.values()));
        res.put("quarters", quarters);
        res.put("payable", payable.toPlainString());
        res.put("paid", paid.toPlainString());
        res.put("balance", payable.subtract(paid).toPlainString());
        res.put("orders", jdbc().queryForList("SELECT order_id, financial_year, string_agg(fy_quarter::text, ',' ORDER BY fy_quarter) AS quarters, sum(amount_inr) AS amount, max(status) AS status, max(method) AS method, max(receipt_number) AS receipt, max(created_at) AS at "
            + "FROM label_fee_payment WHERE organisation_id = ? AND NOT (status = 'failed' AND method IS NULL) GROUP BY order_id, financial_year ORDER BY max(created_at) DESC LIMIT 20", org).stream().map(o -> {
                Map<String, Object> m = new LinkedHashMap<>();
                m.put("orderId", o.get("order_id"));
                m.put("financialYear", o.get("financial_year"));
                m.put("quarters", o.get("quarters"));
                m.put("amount", String.valueOf(o.get("amount")));
                m.put("status", o.get("status"));
                m.put("method", o.get("method"));
                m.put("receipt", o.get("receipt"));
                m.put("at", String.valueOf(o.get("at")));
                return m;
            }).toList());
        return DemoResult.ok(res);
    }

    // ---- serial numbers --------------------------------------------------------------------------------------------------------

    private DemoResult line(boolean staff, UUID own, Map<String, String> query) {
        UUID org = organisationFor(staff, own, query.get("organisation"));
        UUID app;
        int fq;
        try {
            app = UUID.fromString(query.get("app"));
            fq = Integer.parseInt(query.get("fq"));
        } catch (RuntimeException e) {
            return DemoResult.invalid("app, fy and fq are required.");
        }
        String fy = query.get("fy");
        if (org == null || startYearOf(fy) == null || fq < 1 || fq > 4) {
            return DemoResult.invalid("app, fy and fq are required.");
        }
        List<Map<String, Object>> owned = jdbc().queryForList("SELECT model_number, reference FROM model_application WHERE id = ? AND organisation_id = ?", app, org);
        if (owned.isEmpty()) {
            return DemoResult.notFound();
        }
        int offset = Math.max(0, parse(query.get("offset"), 0));
        int limit = Math.max(1, Math.min(100, parse(query.get("limit"), 25)));
        String state = query.get("state");
        String filter = state != null && Set.of("allocated", "bound", "void").contains(state) ? " AND s.state = '" + state + "'" : "";
        String from = " FROM production_line_batch l JOIN qr_batch b ON b.id = l.batch_id JOIN qr_serial s ON s.batch_id = b.id WHERE b.organisation_id = ? AND b.model_application_id = ? AND l.financial_year = ? AND l.fy_quarter = ?" + filter;
        Integer total = jdbc().queryForObject("SELECT count(*)" + from, Integer.class, org, app, fy, fq);
        List<Map<String, Object>> serials = jdbc().query("SELECT s.serial, s.state, s.allocated_at, s.bound_at, b.id AS batch" + from + " ORDER BY s.allocated_at, s.serial OFFSET ? LIMIT ?", (rs, i) -> {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("serial", rs.getString("serial"));
            m.put("state", rs.getString("state"));
            m.put("allocatedAt", String.valueOf(rs.getTimestamp("allocated_at")));
            m.put("boundAt", rs.getTimestamp("bound_at") == null ? null : String.valueOf(rs.getTimestamp("bound_at")));
            m.put("batch", tail(rs.getObject("batch", UUID.class).toString()));
            return m;
        }, org, app, fy, fq, offset, limit);
        List<Map<String, Object>> batches = jdbc().queryForList("SELECT b.id::text AS id, b.quantity, b.status, b.created_at FROM production_line_batch l JOIN qr_batch b ON b.id = l.batch_id WHERE b.organisation_id = ? AND b.model_application_id = ? AND l.financial_year = ? AND l.fy_quarter = ? ORDER BY b.created_at", org, app, fy, fq);
        Map<String, Object> res = new LinkedHashMap<>();
        res.put("model", owned.get(0).get("model_number"));
        res.put("total", total == null ? 0 : total);
        res.put("offset", offset);
        res.put("limit", limit);
        res.put("serials", serials);
        res.put("batches", batches.stream().map(b -> Map.of("id", tail(String.valueOf(b.get("id"))), "quantity", b.get("quantity"), "status", b.get("status"), "createdAt", String.valueOf(b.get("created_at")))).toList());
        return DemoResult.ok(res);
    }

    private DemoResult makeSerials(Caller caller, UUID org, Map<String, Object> body) {
        UUID app;
        int fq;
        int quantity;
        try {
            app = UUID.fromString(String.valueOf(body.get("applicationId")));
            fq = Integer.parseInt(String.valueOf(body.get("fq")));
            quantity = Integer.parseInt(String.valueOf(body.get("quantity")));
        } catch (RuntimeException e) {
            return DemoResult.invalid("applicationId, fy, fq and quantity are required.");
        }
        String fy = String.valueOf(body.get("fy"));
        Integer start = startYearOf(fy);
        if (start == null || fq < 1 || fq > 4) {
            return DemoResult.invalid("fy must look like 2026-27 and fq must be 1 to 4.");
        }
        if (quantity < 1 || quantity > MAX_QUANTITY) {
            return DemoResult.invalid("Quantity must be a whole number from 1 to " + MAX_QUANTITY + ".");
        }
        var application = qr.application(app);
        if (application.isEmpty() || !org.equals(application.get().organisationId())) {
            return DemoResult.notFound();
        }
        Long units = jdbc().queryForObject("SELECT COALESCE(sum(r.units), 0) FROM production_submission s JOIN production_row r ON r.submission_id = s.id WHERE s.organisation_id = ? AND s.quarter = ? AND r.model_application_id = ?",
            Long.class, org, calendarQuarterOf(start, fq), app);
        if (units == null || units <= 0) {
            return DemoResult.invalid("No production is declared for this model in that quarter, so no serial numbers can be linked to it.");
        }
        Optional<UUID> cert = qr.certificateOf(app);
        if (cert.isEmpty() || !"approved".equals(application.get().state())) {
            return DemoResult.invalid("Serial numbers are made only for an approved model with an issued certificate.");
        }
        if (qr.ledgerRevoked(cert.get())) {
            return DemoResult.error(HttpStatus.CONFLICT, "version_conflict", "This certificate is revoked on the ledger, so no serial numbers can be made for it.");
        }
        if (qr.quantityOfCertificate(cert.get()) + quantity > MAX_PER_CERTIFICATE) {
            return DemoResult.invalid("A certificate can have at most " + MAX_PER_CERTIFICATE + " serials in all its batches (the demonstration cap).");
        }
        UUID batch = qr.createBatch(app, cert.get(), org, quantity, caller.accountId());
        qr.allocate(batch, cert.get(), quantity, caller.accountId());
        qr.close(batch);
        jdbc().update("INSERT INTO production_line_batch (batch_id, financial_year, fy_quarter) VALUES (?, ?, ?)", batch, fy, fq);
        return DemoResult.created(Map.of("batch", tail(batch.toString()), "quantity", quantity));
    }

    // ---- label fee payment -----------------------------------------------------------------------------------------------------

    private DemoResult order(Caller caller, UUID org, Map<String, Object> body) {
        String fy = String.valueOf(body.get("fy"));
        Integer start = startYearOf(fy);
        if (start == null || !(body.get("quarters") instanceof List<?> qs) || qs.isEmpty()) {
            return DemoResult.invalid("fy and the quarters to pay are required.");
        }
        List<Integer> quarters = new ArrayList<>();
        try {
            for (Object q : qs) {
                int n = Integer.parseInt(String.valueOf(q));
                if (n < 1 || n > 4 || quarters.contains(n)) {
                    return DemoResult.invalid("Quarters must be 1 to 4, each once.");
                }
                quarters.add(n);
            }
        } catch (NumberFormatException e) {
            return DemoResult.invalid("Quarters must be 1 to 4.");
        }
        String orderId = "LFO-" + UUID.randomUUID().toString().substring(0, 8).toUpperCase();
        BigDecimal total = BigDecimal.ZERO;
        List<Map<String, Object>> items = new ArrayList<>();
        for (int fq : quarters) {
            Long units = jdbc().queryForObject("SELECT COALESCE(sum(r.units), 0) FROM production_submission s JOIN production_row r ON r.submission_id = s.id WHERE s.organisation_id = ? AND s.quarter = ?", Long.class, org, calendarQuarterOf(start, fq));
            if (units == null || units <= 0) {
                return DemoResult.invalid("Quarter " + fq + " has no declared production, so there is no fee to pay.");
            }
            Integer taken = jdbc().queryForObject("SELECT count(*) FROM label_fee_payment WHERE organisation_id = ? AND financial_year = ? AND fy_quarter = ? AND status IN ('initiated', 'paid')", Integer.class, org, fy, fq);
            if (taken != null && taken > 0) {
                return DemoResult.error(HttpStatus.CONFLICT, "version_conflict", "Quarter " + fq + " already has a paid or pending payment.");
            }
            BigDecimal amount = FEE_PER_UNIT.multiply(BigDecimal.valueOf(units));
            jdbc().update("INSERT INTO label_fee_payment (order_id, organisation_id, financial_year, fy_quarter, units, amount_inr, started_by) VALUES (?,?,?,?,?,?,?)", orderId, org, fy, fq, units, amount, caller.accountId());
            total = total.add(amount);
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("fq", fq);
            item.put("label", QUARTER_LABEL[fq - 1]);
            item.put("units", units);
            item.put("amount", amount.toPlainString());
            items.add(item);
        }
        Map<String, Object> res = new LinkedHashMap<>();
        res.put("orderId", orderId);
        res.put("financialYear", fy);
        res.put("equipment", "Room Air Conditioner (Fixed Speed)");
        res.put("firm", jdbc().queryForObject("SELECT legal_name FROM organisation WHERE id = ?", String.class, org).replaceAll("\\s*\\(synthetic[^)]*\\)\\s*$", ""));
        res.put("items", items);
        res.put("amount", total.toPlainString());
        res.put("currency", "INR");
        res.put("methods", List.of("billdesk", "razorpay", "direct_transfer"));
        return DemoResult.created(res);
    }

    private DemoResult complete(UUID org, String orderId, Map<String, Object> body) {
        String method = String.valueOf(body.get("method"));
        String outcome = String.valueOf(body.getOrDefault("outcome", "paid"));
        if (!METHODS.contains(method) || !Set.of("paid", "failed").contains(outcome)) {
            return DemoResult.invalid("method must be billdesk, razorpay or direct_transfer, and outcome paid or failed.");
        }
        List<Map<String, Object>> rows = jdbc().queryForList("SELECT id, status FROM label_fee_payment WHERE order_id = ? AND organisation_id = ?", orderId, org);
        if (rows.isEmpty()) {
            return DemoResult.notFound();
        }
        if (rows.stream().anyMatch(r -> !"initiated".equals(r.get("status")))) {
            return DemoResult.error(HttpStatus.CONFLICT, "version_conflict", "This order was already settled.");
        }
        String gateway = "SIM" + method.substring(0, 2).toUpperCase() + "-" + UUID.randomUUID().toString().substring(0, 8).toUpperCase();
        Map<String, Object> res = new LinkedHashMap<>();
        res.put("orderId", orderId);
        res.put("method", method);
        res.put("gatewayRef", gateway);
        if ("direct_transfer".equals(method)) {
            jdbc().update("UPDATE label_fee_payment SET method = ?, gateway_ref = ? WHERE order_id = ? AND organisation_id = ?", method, gateway, orderId, org);
            res.put("status", "awaiting_confirmation");
            res.put("note", "Direct transfer: the payment is confirmed when BEE's Finance team sees the transfer. Nothing moves in this demonstration.");
            return DemoResult.ok(res);
        }
        if ("failed".equals(outcome)) {
            jdbc().update("UPDATE label_fee_payment SET status = 'failed', method = ?, gateway_ref = ?, settled_at = now() WHERE order_id = ? AND organisation_id = ?", method, gateway, orderId, org);
            res.put("status", "failed");
            return DemoResult.ok(res);
        }
        String receipt = "LF-" + LocalDate.now().toString().replace("-", "") + "-" + orderId.substring(4);
        jdbc().update("UPDATE label_fee_payment SET status = 'paid', method = ?, gateway_ref = ?, receipt_number = ?, settled_at = now() WHERE order_id = ? AND organisation_id = ?", method, gateway, receipt, orderId, org);
        res.put("status", "paid");
        res.put("receipt", receipt);
        return DemoResult.ok(res);
    }

    /** The person left the payment screen before choosing: the order is released so the quarters can be paid again. A direct transfer already recorded stays. */
    private DemoResult cancel(UUID org, String orderId) {
        int n = jdbc().update("UPDATE label_fee_payment SET status = 'failed', settled_at = now() WHERE order_id = ? AND organisation_id = ? AND status = 'initiated' AND method IS NULL", orderId, org);
        return n == 0 ? DemoResult.error(HttpStatus.CONFLICT, "version_conflict", "This order cannot be cancelled.") : DemoResult.ok(Map.of("orderId", orderId, "status", "cancelled"));
    }

    private static String tail(String id) {
        return id.substring(id.length() - 8);
    }

    private static int parse(String s, int fallback) {
        try {
            return s == null ? fallback : Integer.parseInt(s.trim());
        } catch (NumberFormatException e) {
            return fallback;
        }
    }
}
