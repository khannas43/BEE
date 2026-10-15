package gov.bee.api.demo.mis;

import java.math.BigDecimal;
import java.sql.ResultSetMetaData;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/**
 * Read-only queries behind the MIS demonstration panels. Every figure is a SQL aggregate over the live tables; nothing is stored or
 * cached. Tables owned by other demo areas (payment, production_*, ledger_tx, qr_*) are read only when they exist, the runtime login may
 * read them and they have the columns used, so the panels work before and after those areas land. Demonstration, not a BEE report.
 */
@Repository
class MisRepository {

    private static final String TZ = "'Asia/Kolkata'";
    private static final String STATE_ORDER = "array_position(ARRAY['draft','fee_due','iame_scrutiny','bee_scrutiny','rating','director_review',"
        + "'secretary_approval','approved','returned','rejected']::text[], %s)";
    /** The month rows of the chosen range, as month key and nothing else. Takes the from and to dates. */
    private static final String MONTHS = "SELECT to_char(g, 'YYYY-MM') AS month FROM generate_series("
        + "date_trunc('month', CAST(? AS date)::timestamp), date_trunc('month', CAST(? AS date)::timestamp), interval '1 month') g";
    private static final String APPROVED_AT = "SELECT application_id, min(occurred_at) AS at FROM model_application_transition_event "
        + "WHERE to_state = 'approved' GROUP BY application_id";

    private final org.springframework.beans.factory.ObjectProvider<JdbcTemplate> jdbcProvider;
    private final JdbcTemplate fixed;

    /** Lazy, so a web slice test that scans the demo modules without a database still starts. */
    @org.springframework.beans.factory.annotation.Autowired
    MisRepository(org.springframework.beans.factory.ObjectProvider<JdbcTemplate> jdbc) {
        this.jdbcProvider = jdbc;
        this.fixed = null;
    }

    MisRepository(JdbcTemplate jdbc) {
        this.jdbcProvider = null;
        this.fixed = jdbc;
    }

    private JdbcTemplate jdbc() {
        return fixed != null ? fixed : jdbcProvider.getObject();
    }

    private static String mon(String col) {
        return "to_char(" + col + " AT TIME ZONE " + TZ + ", 'YYYY-MM')";
    }

    // ---------------------------------------------------------------- helpers

    private List<List<Object>> rows(String sql, Object... args) {
        return jdbc().query(sql, (rs, i) -> {
            ResultSetMetaData md = rs.getMetaData();
            List<Object> row = new ArrayList<>();
            for (int c = 1; c <= md.getColumnCount(); c++) {
                Object v = rs.getObject(c);
                if (v instanceof java.sql.Timestamp ts) {
                    v = ts.toInstant().toString();
                } else if (v instanceof java.sql.Date d) {
                    v = d.toString();
                } else if (v instanceof BigDecimal b) {
                    v = b.stripTrailingZeros().scale() < 0 ? b.setScale(0) : b;
                } else if (v != null && !(v instanceof Number) && !(v instanceof Boolean)) {
                    v = v.toString();
                }
                row.add(v);
            }
            return row;
        }, args);
    }

    private Object one(String sql, Object... args) {
        List<List<Object>> r = rows(sql, args);
        return r.isEmpty() ? null : r.get(0).get(0);
    }

    private long count(String table) {
        Long n = jdbc().queryForObject("SELECT count(*) FROM " + table, Long.class);
        return n == null ? 0 : n;
    }

    private void use(MisPanel p, String... tables) {
        for (String t : tables) {
            p.source(t, count(t));
        }
    }

    /** The table exists, the runtime login may read it, and it has every column used. */
    private boolean available(String table, String... columns) {
        Boolean there = jdbc().queryForObject("SELECT to_regclass(?) IS NOT NULL AND has_table_privilege(to_regclass(?), 'SELECT')", Boolean.class,
            table, table);
        if (!Boolean.TRUE.equals(there)) {
            return false;
        }
        for (String c : columns) {
            Boolean has = jdbc().queryForObject("SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() "
                + "AND table_name = ? AND column_name = ?)", Boolean.class, table, c);
            if (!Boolean.TRUE.equals(has)) {
                return false;
            }
        }
        return true;
    }

    private static Object pct(Object part, Object whole) {
        long p = ((Number) part).longValue();
        long w = ((Number) whole).longValue();
        return w == 0 ? null : BigDecimal.valueOf(p * 100.0 / w).setScale(1, java.math.RoundingMode.HALF_UP);
    }

    // ---------------------------------------------------------------- panels

    MisPanel summary() {
        MisPanel p = new MisPanel("summary");
        use(p, "model_application", "model_application_submission_event", "model_application_transition_event", "model_application_return",
            "certificate", "model_application_fee_confirmation", "registration_application", "registration_fee_confirmation", "delegation");
        Object submitted = one("SELECT count(*) FROM model_application_submission_event");
        Object approved = one("SELECT count(*) FROM model_application WHERE state = 'approved'");
        Object rejected = one("SELECT count(*) FROM model_application WHERE state = 'rejected'");
        Object everReturned = one("SELECT count(DISTINCT application_id) FROM model_application_return");
        Object avgDays = one("SELECT round(avg(extract(epoch FROM (ap.at - s.occurred_at)) / 86400.0)::numeric, 1) "
            + "FROM model_application_submission_event s JOIN (" + APPROVED_AT + ") ap ON ap.application_id = s.application_id");
        Object fees = one("SELECT (SELECT coalesce(sum(amount_inr), 0) FROM model_application_fee_confirmation) "
            + "+ (SELECT coalesce(sum(amount_inr), 0) FROM registration_fee_confirmation)");
        p.card("submitted", "Applications submitted", submitted, null, "Model applications that left draft");
        p.card("approved", "Applications approved", approved, null, "Current state is approved");
        p.card("avgDays", "Average days, submission to approval", avgDays, "days", "Over approved applications only");
        p.card("returnedRate", "Returned at least once", pct(everReturned, submitted), "%", "Of submitted applications");
        p.card("rejectedRate", "Rejected", pct(rejected, submitted), "%", "Of submitted applications");
        p.card("certificates", "Certificates issued", one("SELECT count(*) FROM certificate"), null, "Local demonstration certificates");
        p.card("fees", "Fees collected (confirmed receipts)", fees, "INR", "Model and registration receipts, before any reversal");
        p.card("delegations", "Open delegations", one("SELECT count(*) FROM delegation WHERE state = 'pending' OR (state = 'approved' AND valid_to >= current_date)"),
            null, "Pending, or approved and not yet expired");
        p.table("applications_by_state", "Model applications by state", "bar", List.of("State", "Applications"),
            rows("SELECT state, count(*) FROM model_application GROUP BY state ORDER BY " + String.format(STATE_ORDER, "state")));
        p.table("registrations_by_state", "Registrations by state", "bar", List.of("State", "Brand", "Agency"),
            rows("SELECT state, count(*) FILTER (WHERE kind = 'brand'), count(*) FILTER (WHERE kind = 'agency') FROM registration_application "
                + "GROUP BY state ORDER BY array_position(ARRAY['draft','fee_due','programme_review','director_approval','approved','returned','rejected']::text[], state)"));
        return p;
    }

    MisPanel applications(LocalDate from, LocalDate to) {
        MisPanel p = new MisPanel("applications");
        use(p, "model_application", "model_application_submission_event", "model_application_transition_event", "model_application_rating",
            "organisation");
        p.table("by_state", "Model applications by state", "bar", List.of("State", "Applications"),
            rows("SELECT state, count(*) FROM model_application GROUP BY state ORDER BY " + String.format(STATE_ORDER, "state")));
        p.table("by_stage", "Model applications by stage", "bar", List.of("Stage", "Applications"), rows(
            "SELECT stage, count(*) FROM (SELECT " + stageCase("state") + " AS stage, state FROM model_application) x GROUP BY stage "
                + "ORDER BY min(" + String.format(STATE_ORDER, "state") + ")"));
        p.table("monthly", "Submissions and approvals per month", "line", List.of("Month", "Submitted", "Approved"), rows(
            "WITH m AS (" + MONTHS + ") SELECT m.month, "
                + "(SELECT count(*) FROM model_application_submission_event s WHERE " + mon("s.occurred_at") + " = m.month), "
                + "(SELECT count(*) FROM (" + APPROVED_AT + ") a WHERE " + mon("a.at") + " = m.month) FROM m ORDER BY m.month", from, to));
        p.table("by_category", "Applications by category", "bar", List.of("Category", "Applications", "Approved"),
            rows("SELECT category, count(*), count(*) FILTER (WHERE state = 'approved') FROM model_application GROUP BY category ORDER BY category"));
        p.table("by_stars", "Star rating distribution (latest rating of each rated application)", "bar", List.of("Stars", "Applications"), rows(
            "SELECT s.n::text, count(r.application_id) FROM generate_series(1, 5) s(n) LEFT JOIN (SELECT DISTINCT ON (application_id) application_id, stars "
                + "FROM model_application_rating ORDER BY application_id, rating_version DESC) r ON r.stars = s.n GROUP BY s.n ORDER BY s.n"));
        p.table("by_organisation", "Applications by organisation", "bar", List.of("Organisation", "Applications", "Approved", "Rejected"), rows(
            "SELECT o.legal_name, count(*), count(*) FILTER (WHERE a.state = 'approved'), count(*) FILTER (WHERE a.state = 'rejected') "
                + "FROM model_application a JOIN organisation o ON o.id = a.organisation_id GROUP BY o.legal_name ORDER BY count(*) DESC, o.legal_name LIMIT 15"));
        p.table("ageing", "Items waiting, by stage (days since the item reached the stage)", "bar",
            List.of("Stage", "Waiting", "Median days", "Oldest days"), rows(
                "SELECT stage, count(*), round(percentile_cont(0.5) WITHIN GROUP (ORDER BY age)::numeric, 1), round(max(age)::numeric, 1) FROM ("
                    + "SELECT " + stageCase("a.state") + " AS stage, a.state, extract(epoch FROM (now() - coalesce("
                    + "(SELECT max(t.occurred_at) FROM model_application_transition_event t WHERE t.application_id = a.id AND t.to_state = a.state), "
                    + "(SELECT s.occurred_at FROM model_application_submission_event s WHERE s.application_id = a.id), a.created_at))) / 86400.0 AS age "
                    + "FROM model_application a WHERE a.state NOT IN ('draft', 'approved', 'rejected')) w GROUP BY stage "
                    + "ORDER BY min(" + String.format(STATE_ORDER, "state") + ")"));
        return p;
    }

    private static String stageCase(String col) {
        return "CASE " + col + " WHEN 'draft' THEN 'Applicant (draft)' WHEN 'fee_due' THEN 'Finance (fee)' WHEN 'iame_scrutiny' THEN 'IAME' "
            + "WHEN 'bee_scrutiny' THEN 'Reviewer' WHEN 'rating' THEN 'Rating' WHEN 'director_review' THEN 'Director' "
            + "WHEN 'secretary_approval' THEN 'Secretary' WHEN 'returned' THEN 'Returned to applicant' ELSE 'Closed (' || " + col + " || ')' END";
    }

    MisPanel finance(LocalDate from, LocalDate to) {
        MisPanel p = new MisPanel("finance");
        use(p, "model_application_fee_confirmation", "registration_fee_confirmation", "fee_correction_proposal", "fee_reversal_proposal");
        Object modelTotal = one("SELECT coalesce(sum(amount_inr), 0) FROM model_application_fee_confirmation");
        Object regTotal = one("SELECT coalesce(sum(amount_inr), 0) FROM registration_fee_confirmation");
        Object reversed = one("SELECT coalesce(sum(c.amount_inr), 0) FROM fee_reversal_proposal r JOIN model_application_fee_confirmation c "
            + "ON c.id = r.fee_confirmation_id WHERE r.state = 'approved'");
        BigDecimal total = ((BigDecimal) modelTotal).add((BigDecimal) regTotal);
        p.card("confirmed", "Fees confirmed (all receipts)", total, "INR", "Model applications plus registrations");
        p.card("modelReceipts", "Model receipts", one("SELECT count(*) FROM model_application_fee_confirmation"), null, null);
        p.card("registrationReceipts", "Registration receipts", one("SELECT count(*) FROM registration_fee_confirmation"), null, null);
        p.card("reversed", "Approved reversals", reversed, "INR", "Confirmations later reversed");
        p.card("net", "Net after reversals", total.subtract((BigDecimal) reversed), "INR", "Confirmed minus reversed");
        p.card("corrections", "Corrections pending", one("SELECT count(*) FROM fee_correction_proposal WHERE state = 'pending'"), null,
            "Receipt reference or date corrections awaiting a second person");
        p.table("fees_by_month", "Fees confirmed per month (INR, by date confirmed)", "line", List.of("Month", "Model applications", "Registrations"), rows(
            "WITH m AS (" + MONTHS + ") SELECT m.month, "
                + "(SELECT coalesce(sum(c.amount_inr), 0) FROM model_application_fee_confirmation c WHERE " + mon("c.confirmed_at") + " = m.month), "
                + "(SELECT coalesce(sum(c.amount_inr), 0) FROM registration_fee_confirmation c WHERE " + mon("c.confirmed_at") + " = m.month) "
                + "FROM m ORDER BY m.month", from, to));
        p.table("corrections_reversals", "Corrections and reversals by state", "bar", List.of("Kind and state", "Count"), rows(
            "SELECT 'Correction: ' || state, count(*) FROM fee_correction_proposal GROUP BY state "
                + "UNION ALL SELECT 'Reversal: ' || state, count(*) FROM fee_reversal_proposal GROUP BY state ORDER BY 1"));
        p.table("recent_receipts", "Latest ten receipts", "none", List.of("Receipt", "Kind", "Amount INR", "Received on"), rows(
            "SELECT receipt_reference, kind, amount_inr, received_on FROM ("
                + "SELECT receipt_reference, 'Model' AS kind, amount_inr, received_on, confirmed_at FROM model_application_fee_confirmation "
                + "UNION ALL SELECT receipt_reference, 'Registration', amount_inr, received_on, confirmed_at FROM registration_fee_confirmation) r "
                + "ORDER BY confirmed_at DESC, receipt_reference LIMIT 10"));
        if (available("payment", "status", "amount_inr", "created_at")) {
            use(p, "payment");
            p.table("payments_by_status", "Simulated gateway payments by status", "bar", List.of("Status", "Payments", "Amount INR"),
                rows("SELECT status, count(*), coalesce(sum(amount_inr), 0) FROM payment GROUP BY status ORDER BY status"));
            p.table("payments_by_month", "Simulated payments per month (paid, INR)", "line", List.of("Month", "Paid INR"), rows(
                "WITH m AS (" + MONTHS + ") SELECT m.month, (SELECT coalesce(sum(y.amount_inr), 0) FROM payment y WHERE y.status = 'paid' AND "
                    + mon("y.created_at") + " = m.month) FROM m ORDER BY m.month", from, to));
        } else {
            p.unavailable("Simulated payments", "Not available yet: the payment table is not in this database.");
        }
        return p;
    }

    MisPanel production(LocalDate from, LocalDate to) {
        MisPanel p = new MisPanel("production");
        if (available("production_submission", "organisation_id", "quarter", "state") && available("production_row", "submission_id", "units")) {
            use(p, "production_submission", "production_row", "organisation");
            Object units = one("SELECT coalesce(sum(units), 0) FROM production_row");
            p.card("units", "Units reported (all quarters)", units, "units", "Sum of production rows");
            p.card("submissions", "Quarterly submissions", one("SELECT count(*) FROM production_submission"), null, null);
            p.table("units_by_quarter", "Units per quarter", "bar", List.of("Quarter", "Units"),
                rows("SELECT s.quarter, coalesce(sum(r.units), 0) FROM production_submission s LEFT JOIN production_row r ON r.submission_id = s.id "
                    + "GROUP BY s.quarter ORDER BY s.quarter"));
            p.table("units_by_quarter_org", "Units per quarter per organisation", "none", List.of("Quarter", "Organisation", "Units"),
                rows("SELECT s.quarter, o.legal_name, coalesce(sum(r.units), 0) FROM production_submission s JOIN organisation o ON o.id = s.organisation_id "
                    + "LEFT JOIN production_row r ON r.submission_id = s.id GROUP BY s.quarter, o.legal_name ORDER BY s.quarter, o.legal_name"));
            p.table("submissions_by_state", "Submissions by state", "bar", List.of("State", "Submissions"),
                rows("SELECT state, count(*) FROM production_submission GROUP BY state ORDER BY state"));
        } else {
            p.unavailable("Quarterly production", "Not available yet: the production tables are not in this database.");
        }
        return p;
    }

    MisPanel certificates(LocalDate from, LocalDate to) {
        MisPanel p = new MisPanel("certificates");
        use(p, "certificate");
        p.card("issued", "Certificates issued", one("SELECT count(*) FROM certificate"), null, null);
        p.card("expiring", "Expiring within 90 days", one("SELECT count(*) FROM certificate WHERE valid_to >= current_date AND valid_to < current_date + 90"),
            null, "Valid now and ending soon");
        p.table("issued_by_month", "Certificates issued per month", "line", List.of("Month", "Issued"), rows(
            "WITH m AS (" + MONTHS + ") SELECT m.month, (SELECT count(*) FROM certificate c WHERE " + mon("c.issued_at") + " = m.month) FROM m ORDER BY m.month",
            from, to));
        p.table("by_validity", "Certificates by validity status (from the dates)", "bar", List.of("Status", "Certificates"), rows(
            "SELECT CASE WHEN current_date < valid_from THEN 'Not yet valid' WHEN current_date > valid_to THEN 'Expired' ELSE 'Valid' END AS status, count(*) "
                + "FROM certificate GROUP BY 1 ORDER BY 1"));
        if (available("ledger_tx", "kind", "state")) {
            use(p, "ledger_tx");
            p.table("ledger_status", "Simulated ledger entries by kind and state", "bar", List.of("Kind and state", "Entries"),
                rows("SELECT kind || ' / ' || state, count(*) FROM ledger_tx GROUP BY kind, state ORDER BY kind, state"));
        } else {
            p.unavailable("Simulated ledger", "Not available yet: the ledger table is not in this database.");
        }
        if (available("qr_serial", "state")) {
            use(p, "qr_serial");
            p.table("qr_serials", "QR serials by state", "bar", List.of("State", "Serials"),
                rows("SELECT state, count(*) FROM qr_serial GROUP BY state ORDER BY state"));
            if (available("qr_batch", "quantity", "status")) {
                use(p, "qr_batch");
                p.table("qr_batches", "QR batches by status", "bar", List.of("Status", "Batches", "Quantity"),
                    rows("SELECT status, count(*), coalesce(sum(quantity), 0) FROM qr_batch GROUP BY status ORDER BY status"));
            }
        } else {
            p.unavailable("QR serials", "Not available yet: the QR tables are not in this database.");
        }
        return p;
    }
}
