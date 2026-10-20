package gov.bee.api.demo.dashboard;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.YearMonth;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Supplier;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * The one executive dashboard for the Director and the Secretary (demonstration): a strip of headline figures and a grid of charts, all computed
 * from the live demo tables on every read. One date range and one manufacturer choice drive every figure. Read only; local demonstration, not a BEE report.
 */
final class ExecutiveDashboard {

    static final ZoneId IST = ZoneId.of("Asia/Kolkata");
    private static final List<String> OPEN = List.of("iame_scrutiny", "bee_scrutiny", "rating", "director_review", "secretary_approval");
    private static final List<String> PIPELINE = List.of("fee_due", "iame_scrutiny", "bee_scrutiny", "rating", "director_review", "secretary_approval", "approved", "returned", "rejected");
    private static final String MONTH = "to_char(date_trunc('month', %s AT TIME ZONE 'Asia/Kolkata'), 'YYYY-MM')";
    private static final String LEDGER_WORD = "CASE "
        + "WHEN NOT EXISTS (SELECT 1 FROM ledger_tx t WHERE t.certificate_id = c.id) THEN 'Not yet on the ledger' "
        + "WHEN EXISTS (SELECT 1 FROM ledger_tx t WHERE t.certificate_id = c.id AND t.kind = 'revoke' AND t.state = 'committed') THEN 'Revoked' "
        + "WHEN EXISTS (SELECT 1 FROM ledger_tx t WHERE t.certificate_id = c.id AND t.state = 'failed' AND NOT EXISTS (SELECT 1 FROM ledger_tx n WHERE n.certificate_id = c.id AND n.seq = t.seq AND n.attempt > t.attempt)) THEN 'Failed' "
        + "WHEN EXISTS (SELECT 1 FROM ledger_tx t WHERE t.certificate_id = c.id AND t.state = 'pending') THEN 'Waiting for a second signature' "
        + "ELSE 'Active' END";

    private final JdbcTemplate jdbc;
    private final Supplier<List<Map<String, Object>>> riskEntities;

    ExecutiveDashboard(JdbcTemplate jdbc, Supplier<List<Map<String, Object>>> riskEntities) {
        this.jdbc = jdbc;
        this.riskEntities = riskEntities;
    }

    /** The SQL and arguments that narrow one query: the date column's range (IST days) and the manufacturer column. */
    private record Scope(LocalDate from, LocalDate to, UUID org) {
        String sql(String dateCol, String orgCol, List<Object> args) {
            StringBuilder sb = new StringBuilder();
            if (dateCol != null && from != null) {
                sb.append(" AND (").append(dateCol).append(" AT TIME ZONE 'Asia/Kolkata')::date >= ?::date");
                args.add(from.toString());
            }
            if (dateCol != null && to != null) {
                sb.append(" AND (").append(dateCol).append(" AT TIME ZONE 'Asia/Kolkata')::date <= ?::date");
                args.add(to.toString());
            }
            if (orgCol != null && org != null) {
                sb.append(" AND ").append(orgCol).append(" = ?");
                args.add(org);
            }
            return sb.toString();
        }
    }

    Map<String, Object> build(LocalDate from, LocalDate to, UUID org) {
        Scope sc = new Scope(from, to, org);
        List<String> months = months(from, to);

        long received = count("SELECT count(*) FROM model_application a WHERE a.state <> 'draft'", "a.created_at", "a.organisation_id", sc);
        long inProgress = count("SELECT count(*) FROM model_application a WHERE a.state IN (" + inList(OPEN) + ")", null, "a.organisation_id", sc);
        long issued = count("SELECT count(*) FROM certificate c JOIN model_application a ON a.id = c.application_id WHERE true", "c.issued_at", "a.organisation_id", sc);
        Map<String, Long> decisions = groupCount("SELECT e.to_state, count(*) FROM model_application_transition_event e JOIN model_application a ON a.id = e.application_id "
            + "WHERE e.to_state IN ('approved', 'rejected', 'returned')", "e.occurred_at", "a.organisation_id", sc, "e.to_state");
        long approved = decisions.getOrDefault("approved", 0L);
        long rejected = decisions.getOrDefault("rejected", 0L);
        Double approvalRate = approved + rejected == 0 ? null : 100.0 * approved / (approved + rejected);
        Double avgDays = avgDaysToApproval(sc);
        BigDecimal fees = decimal("SELECT COALESCE(sum(f.amount_inr), 0) FROM model_application_fee_confirmation f JOIN model_application a ON a.id = f.application_id WHERE true",
            "f.confirmed_at", "a.organisation_id", sc);

        Map<String, Long> ledger = groupCount("SELECT " + LEDGER_WORD + " AS k, count(*) FROM certificate c JOIN model_application a ON a.id = c.application_id WHERE true",
            "c.issued_at", "a.organisation_id", sc, "k");
        long ledgerAttention = ledger.getOrDefault("Revoked", 0L) + ledger.getOrDefault("Waiting for a second signature", 0L) + ledger.getOrDefault("Failed", 0L);

        List<Map<String, Object>> risk = risk(org);
        long high = risk.stream().filter(e -> "high".equals(e.get("band"))).count();

        List<Map<String, Object>> kpis = new ArrayList<>();
        kpis.add(kpi("received", "Applications received", received, "", "In the chosen period, drafts not counted.", "neutral", "inbox"));
        kpis.add(kpi("in_progress", "In progress now", inProgress, "", "Being scrutinised, rated or waiting for approval.", "attention", "pending_actions"));
        kpis.add(kpi("issued", "Certificates issued", issued, "", "In the chosen period.", "good", "verified"));
        kpis.add(kpi("approval_rate", "Approval rate", approvalRate == null ? null : Math.round(approvalRate * 10) / 10.0, "%",
            approved + " approved, " + rejected + " rejected in the period.", "good", "thumb_up"));
        kpis.add(kpi("avg_days", "Days to approval", avgDays == null ? null : Math.round(avgDays * 10) / 10.0, "days", "Average from first action to approval, for approvals in the period.", "neutral", "schedule"));
        kpis.add(kpi("fees", "Fees confirmed", fees.doubleValue(), "INR", "Confirmed by Finance in the period.", "good", "payments"));
        kpis.add(kpi("ledger_attention", "Ledger needs a look", ledgerAttention, "", "Revoked, waiting for a second signature or failed.", ledgerAttention > 0 ? "attention" : "good", "link_off"));
        kpis.add(kpi("high_risk", "High compliance risk", high, "", "Manufacturers in the high band of the risk model.", high > 0 ? "danger" : "good", "warning"));

        List<Map<String, Object>> charts = new ArrayList<>();
        charts.add(multi("flow", "Applications received and certificates issued, by month", months,
            monthly("SELECT " + MONTH.formatted("a.created_at") + " AS m, count(*) FROM model_application a WHERE a.state <> 'draft'", "a.created_at", "a.organisation_id", sc, "m"),
            "Received",
            monthly("SELECT " + MONTH.formatted("c.issued_at") + " AS m, count(*) FROM certificate c JOIN model_application a ON a.id = c.application_id WHERE true", "c.issued_at", "a.organisation_id", sc, "m"),
            "Issued"));
        charts.add(chart("pipeline", "bars", "Where the applications are now", ordered(groupCount("SELECT a.state, count(*) FROM model_application a WHERE a.state <> 'draft'", null, "a.organisation_id", sc, "a.state"), PIPELINE)));
        charts.add(chart("decisions", "donut", "Decisions in the period", ordered(decisions, List.of("approved", "returned", "rejected"))));
        charts.add(chart("stars", "bars", "Star ratings of certificates issued", stars(sc)));
        charts.add(chart("fees", "trend", "Fees confirmed by month (INR)", series(months,
            monthlyDecimal("SELECT " + MONTH.formatted("f.confirmed_at") + " AS m, COALESCE(sum(f.amount_inr), 0) FROM model_application_fee_confirmation f JOIN model_application a ON a.id = f.application_id WHERE true",
                "f.confirmed_at", "a.organisation_id", sc, "m"))));
        charts.add(chart("manufacturers", "bars", "Certificates by manufacturer",
            top(groupCount("SELECT c.organisation_name, count(*) FROM certificate c JOIN model_application a ON a.id = c.application_id WHERE true", "c.issued_at", "a.organisation_id", sc, "c.organisation_name"), 8)));
        charts.add(chart("ledger", "donut", "Certificates on the ledger", ordered(ledger, List.of("Active", "Waiting for a second signature", "Failed", "Revoked", "Not yet on the ledger"))));
        charts.add(chart("waiting", "bars", "How long open applications have waited", waiting(sc)));
        charts.add(chart("production", "bars", "Accepted production by quarter (units)", production(sc)));
        charts.add(chart("payments", "donut", "Payments in the period",
            ordered(groupCount("SELECT p.status, count(*) FROM payment p WHERE true", "p.created_at", "p.organisation_id", sc, "p.status"), List.of("paid", "initiated", "failed"))));

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("asOf", java.time.Instant.now().toString());
        out.put("range", Map.of("from", from == null ? "" : from.toString(), "to", to == null ? "" : to.toString()));
        out.put("organisations", jdbc.query("SELECT o.id::text AS id, o.legal_name AS name FROM organisation o WHERE EXISTS (SELECT 1 FROM model_application a WHERE a.organisation_id = o.id) ORDER BY o.legal_name",
            (rs, i) -> Map.of("id", rs.getString("id"), "name", rs.getString("name"))));
        out.put("organisation", org == null ? null : org.toString());
        out.put("kpis", kpis);
        out.put("charts", charts);
        out.put("waitingList", waitingList(sc));
        out.put("riskList", risk.stream().limit(6).map(e -> {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("name", e.get("name"));
            m.put("score", e.get("score"));
            m.put("band", e.get("band"));
            m.put("applications", e.get("applications"));
            return m;
        }).toList());
        out.put("note", DashboardModule.NOTE);
        return out;
    }

    // ------------------------------------------------------------------ helpers

    private static List<String> months(LocalDate from, LocalDate to) {
        YearMonth end = YearMonth.from(to != null ? to : LocalDate.now(IST));
        YearMonth start = from != null ? YearMonth.from(from) : end.minusMonths(11);
        if (start.isBefore(end.minusMonths(23))) {
            start = end.minusMonths(23);
        }
        List<String> out = new ArrayList<>();
        for (YearMonth m = start; !m.isAfter(end); m = m.plusMonths(1)) {
            out.add(m.toString());
        }
        return out;
    }

    private static String inList(List<String> values) {
        return values.stream().map(v -> "'" + v + "'").collect(java.util.stream.Collectors.joining(", "));
    }

    private long count(String base, String dateCol, String orgCol, Scope sc) {
        List<Object> args = new ArrayList<>();
        Long n = jdbc.queryForObject(base + sc.sql(dateCol, orgCol, args), Long.class, args.toArray());
        return n == null ? 0 : n;
    }

    private BigDecimal decimal(String base, String dateCol, String orgCol, Scope sc) {
        List<Object> args = new ArrayList<>();
        BigDecimal v = jdbc.queryForObject(base + sc.sql(dateCol, orgCol, args), BigDecimal.class, args.toArray());
        return v == null ? BigDecimal.ZERO : v;
    }

    /** {@code base} selects {@code (key, count)} and ends in a WHERE clause; the scope is appended and the rows grouped by {@code groupBy}. */
    private Map<String, Long> groupCount(String base, String dateCol, String orgCol, Scope sc, String groupBy) {
        List<Object> args = new ArrayList<>();
        Map<String, Long> out = new LinkedHashMap<>();
        jdbc.query(base + sc.sql(dateCol, orgCol, args) + " GROUP BY " + groupBy + " ORDER BY 2 DESC, 1", rs -> {
            out.put(rs.getString(1), rs.getLong(2));
        }, args.toArray());
        return out;
    }

    private Map<String, Long> monthly(String base, String dateCol, String orgCol, Scope sc, String groupBy) {
        List<Object> args = new ArrayList<>();
        Map<String, Long> out = new LinkedHashMap<>();
        jdbc.query(base + sc.sql(dateCol, orgCol, args) + " GROUP BY " + groupBy, rs -> {
            out.put(rs.getString(1), rs.getLong(2));
        }, args.toArray());
        return out;
    }

    private Map<String, Double> monthlyDecimal(String base, String dateCol, String orgCol, Scope sc, String groupBy) {
        List<Object> args = new ArrayList<>();
        Map<String, Double> out = new LinkedHashMap<>();
        jdbc.query(base + sc.sql(dateCol, orgCol, args) + " GROUP BY " + groupBy, rs -> {
            out.put(rs.getString(1), rs.getBigDecimal(2).doubleValue());
        }, args.toArray());
        return out;
    }

    private Double avgDaysToApproval(Scope sc) {
        List<Object> args = new ArrayList<>();
        String sql = "SELECT avg(extract(epoch FROM (e.occurred_at - f.first_at)) / 86400.0) FROM model_application_transition_event e JOIN model_application a ON a.id = e.application_id "
            + "JOIN LATERAL (SELECT min(x.occurred_at) AS first_at FROM model_application_transition_event x WHERE x.application_id = a.id) f ON true "
            + "WHERE e.to_state = 'approved' AND e.occurred_at >= f.first_at" + sc.sql("e.occurred_at", "a.organisation_id", args);
        return jdbc.queryForObject(sql, Double.class, args.toArray());
    }

    private List<Map<String, Object>> stars(Scope sc) {
        List<Object> args = new ArrayList<>();
        Map<Integer, Long> counts = new LinkedHashMap<>();
        jdbc.query("SELECT c.stars, count(*) FROM certificate c JOIN model_application a ON a.id = c.application_id WHERE true" + sc.sql("c.issued_at", "a.organisation_id", args) + " GROUP BY c.stars",
            rs -> {
                counts.put(rs.getInt(1), rs.getLong(2));
            }, args.toArray());
        List<Map<String, Object>> out = new ArrayList<>();
        for (int s = 1; s <= 5; s++) {
            out.add(point(s + (s == 1 ? " star" : " stars"), counts.getOrDefault(s, 0L)));
        }
        return out;
    }

    private List<Map<String, Object>> production(Scope sc) {
        List<Object> args = new ArrayList<>();
        List<Map<String, Object>> out = new ArrayList<>();
        jdbc.query("SELECT s.quarter, COALESCE(sum(r.units), 0) FROM production_submission s JOIN production_row r ON r.submission_id = s.id WHERE s.state = 'accepted'"
            + sc.sql("s.submitted_at", "s.organisation_id", args) + " GROUP BY s.quarter ORDER BY s.quarter DESC LIMIT 8", rs -> {
                out.add(point(rs.getString(1), rs.getLong(2)));
            }, args.toArray());
        java.util.Collections.reverse(out);
        return out;
    }

    /** Open applications by how long they have been in their present stage. */
    private List<Map<String, Object>> waiting(Scope sc) {
        List<Object> args = new ArrayList<>();
        long[] b = new long[4];
        jdbc.query("SELECT extract(epoch FROM (now() - COALESCE((SELECT max(e.occurred_at) FROM model_application_transition_event e WHERE e.application_id = a.id), a.created_at))) / 86400.0 "
            + "FROM model_application a WHERE a.state IN (" + inList(OPEN) + ")" + sc.sql(null, "a.organisation_id", args), rs -> {
                double d = rs.getDouble(1);
                b[d <= 7 ? 0 : d <= 14 ? 1 : d <= 30 ? 2 : 3]++;
            }, args.toArray());
        return List.of(point("Up to 7 days", b[0]), point("8 to 14 days", b[1]), point("15 to 30 days", b[2]), point("Over 30 days", b[3]));
    }

    private List<Map<String, Object>> waitingList(Scope sc) {
        List<Object> args = new ArrayList<>();
        return jdbc.query("SELECT a.reference, a.brand_name || ' ' || a.model_number AS model, o.legal_name, a.state, "
            + "round((extract(epoch FROM (now() - COALESCE((SELECT max(e.occurred_at) FROM model_application_transition_event e WHERE e.application_id = a.id), a.created_at))) / 86400.0)::numeric, 0) AS days "
            + "FROM model_application a JOIN organisation o ON o.id = a.organisation_id WHERE a.state IN (" + inList(OPEN) + ")" + sc.sql(null, "a.organisation_id", args)
            + " ORDER BY days DESC, a.reference LIMIT 6", (rs, i) -> {
                Map<String, Object> m = new LinkedHashMap<>();
                m.put("reference", rs.getString("reference"));
                m.put("model", rs.getString("model"));
                m.put("manufacturer", rs.getString("legal_name"));
                m.put("stage", rs.getString("state"));
                m.put("days", rs.getLong("days"));
                return m;
            }, args.toArray());
    }

    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> risk(UUID org) {
        List<Map<String, Object>> all = riskEntities.get();
        if (org == null) {
            return all;
        }
        String name = jdbc.queryForObject("SELECT legal_name FROM organisation WHERE id = ?", String.class, org);
        return all.stream().filter(e -> name.equals(String.valueOf(e.get("name")))).toList();
    }

    private static Map<String, Object> point(String label, Number value) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("label", label);
        m.put("value", value);
        return m;
    }

    private static List<Map<String, Object>> ordered(Map<String, Long> counts, List<String> order) {
        List<Map<String, Object>> out = new ArrayList<>();
        for (String k : order) {
            if (counts.containsKey(k)) {
                out.add(point(k, counts.get(k)));
            }
        }
        counts.forEach((k, v) -> {
            if (!order.contains(k)) {
                out.add(point(k, v));
            }
        });
        return out;
    }

    private static List<Map<String, Object>> top(Map<String, Long> counts, int n) {
        return counts.entrySet().stream().limit(n).map(e -> point(e.getKey(), e.getValue())).toList();
    }

    private static List<Map<String, Object>> series(List<String> months, Map<String, Double> values) {
        return months.stream().map(m -> point(m, values.getOrDefault(m, 0.0))).toList();
    }

    private static Map<String, Object> chart(String key, String kind, String title, List<Map<String, Object>> data) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("key", key);
        m.put("kind", kind);
        m.put("title", title);
        m.put("data", data);
        return m;
    }

    private static Map<String, Object> multi(String key, String title, List<String> months, Map<String, Long> a, String aName, Map<String, Long> b, String bName) {
        Map<String, Object> m = chart(key, "multi", title, months.stream().map(mo -> {
            Map<String, Object> p = new LinkedHashMap<>();
            p.put("label", mo);
            p.put("a", a.getOrDefault(mo, 0L));
            p.put("b", b.getOrDefault(mo, 0L));
            return p;
        }).toList());
        m.put("aName", aName);
        m.put("bName", bName);
        return m;
    }

    private static Map<String, Object> kpi(String key, String label, Number value, String unit, String hint, String tone, String icon) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("key", key);
        m.put("label", label);
        m.put("value", value);
        m.put("unit", unit);
        m.put("hint", hint);
        m.put("tone", tone);
        m.put("icon", icon);
        return m;
    }
}
