package gov.bee.api.demo.ai;

import gov.bee.api.document.LocalSha256FileStore;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.TreeMap;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * The five advisory computations. They only READ (portal tables, the demonstration source tables, the local document store) and return a
 * result; nothing here writes to any application, certificate, fee or decision record. Every output carries an evidence list.
 */
@Component
public class AiEngines {

    public record Computed(Map<String, Object> output, double confidence, String dataVersion, String inputRef) {
    }

    /** The input was unusable; the detail is shown to the person. */
    public static final class BadInput extends RuntimeException {
        public BadInput(String message) {
            super(message);
        }
    }

    /** The record asked for does not exist. */
    public static final class Missing extends RuntimeException {
        public Missing() {
            super("not found");
        }
    }

    public static final double ESCALATE_BELOW = 0.45;
    static final String SAMPLE_REPORT = "TEST REPORT (built-in sample text)\nLaboratory: Synthetic Test Laboratory\nDate of test: 2026-08-01\nMeasured ISEER: 4.20\n";

    private final JdbcTemplate jdbc;
    private final LocalSha256FileStore store;

    public AiEngines(JdbcTemplate jdbc, LocalSha256FileStore store) {
        this.jdbc = jdbc;
        this.store = store;
    }

    // ---- helpers ---------------------------------------------------------------------------------------------------------------

    static String hash(String canonical) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(canonical.getBytes(StandardCharsets.UTF_8))).substring(0, 12);
        } catch (java.security.NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    private boolean readable(String table, String... columns) {
        Boolean ok = jdbc.queryForObject("SELECT coalesce(has_table_privilege(to_regclass(?), 'SELECT'), false)", Boolean.class, table);
        if (!Boolean.TRUE.equals(ok)) {
            return false;
        }
        Integer n = jdbc.queryForObject("SELECT count(*) FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ? "
            + "AND column_name = ANY (?)", Integer.class, table, columns);
        return n != null && n == columns.length;
    }

    private static Map<String, Object> ev(String source, String field, Object value) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("source", source);
        m.put("field", field);
        m.put("value", value);
        return m;
    }

    private static double clamp01(double v) {
        return Math.max(0, Math.min(1, v));
    }

    // ---- 1. compliance risk ----------------------------------------------------------------------------------------------------

    private static final class Entity {
        String key;
        String name;
        boolean synthetic;
        int apps;
        int returned;
        int rejected;
        int resub;
        double gapPct;
        double delayDays;
        Double prodRatio;
        String returnedRefs = "";
        String rejectedRefs = "";
        String resubRefs = "";
        String gapRefs = "";
        String delayRefs = "";
    }

    public Computed complianceRisk() {
        Map<String, Entity> by = new TreeMap<>();
        jdbc.query("SELECT o.id::text AS k, o.legal_name AS n, count(*) AS c FROM model_application a JOIN organisation o ON o.id = a.organisation_id "
            + "WHERE a.state <> 'draft' GROUP BY o.id, o.legal_name", rs -> {
                Entity e = new Entity();
                e.key = rs.getString("k");
                e.name = rs.getString("n");
                e.apps = rs.getInt("c");
                by.put(e.key, e);
            });
        feature(by, "model_application_return", "returned", (e, c, refs) -> {
            e.returned = c;
            e.returnedRefs = refs;
        });
        feature(by, "model_application_rejection", "rejected", (e, c, refs) -> {
            e.rejected = c;
            e.rejectedRefs = refs;
        });
        feature(by, "model_application_resubmission", "resubmitted", (e, c, refs) -> {
            e.resub = c;
            e.resubRefs = refs;
        });
        jdbc.query("SELECT a.organisation_id::text AS k, avg(greatest(0, 100.0 * (r.declared_iseer - r.verified_iseer) / r.declared_iseer)) AS gap, "
            + "string_agg(a.reference, ', ' ORDER BY a.reference) AS refs FROM model_application_rating r JOIN model_application a ON a.id = r.application_id "
            + "WHERE r.rating_version = (SELECT max(r2.rating_version) FROM model_application_rating r2 WHERE r2.application_id = r.application_id) "
            + "GROUP BY a.organisation_id", rs -> {
                Entity e = by.get(rs.getString("k"));
                if (e != null) {
                    e.gapPct = AiMath.round(rs.getDouble("gap"), 2);
                    e.gapRefs = rs.getString("refs");
                }
            });
        jdbc.query("SELECT a.organisation_id::text AS k, avg(extract(epoch FROM (fc.confirmed_at - se.occurred_at)) / 86400.0) AS days, "
            + "string_agg(DISTINCT a.reference, ', ') AS refs FROM model_application_fee_confirmation fc "
            + "JOIN model_application_submission_event se ON se.application_id = fc.application_id "
            + "JOIN model_application a ON a.id = fc.application_id GROUP BY a.organisation_id", rs -> {
                Entity e = by.get(rs.getString("k"));
                if (e != null) {
                    e.delayDays = AiMath.round(Math.max(0, rs.getDouble("days")), 1);
                    e.delayRefs = rs.getString("refs");
                }
            });
        boolean productionLive = readable("production_submission", "id", "organisation_id", "quarter") && readable("production_row", "submission_id", "units");
        if (productionLive) {
            Map<String, List<Double>> totals = new HashMap<>();
            jdbc.query("SELECT s.organisation_id::text AS k, sum(r.units) AS u FROM production_submission s JOIN production_row r ON r.submission_id = s.id "
                + "GROUP BY s.organisation_id, s.quarter ORDER BY s.organisation_id, s.quarter", rs ->
                    { totals.computeIfAbsent(rs.getString("k"), x -> new ArrayList<>()).add(rs.getDouble("u")); });
            totals.forEach((k, v) -> {
                Entity e = by.get(k);
                if (e != null && v.size() >= 3) {
                    double[] prior = v.subList(0, v.size() - 1).stream().mapToDouble(Double::doubleValue).toArray();
                    double mean = AiMath.mean(prior);
                    e.prodRatio = mean > 0 ? AiMath.round(v.get(v.size() - 1) / mean, 2) : null;
                }
            });
        }
        jdbc.query("SELECT entity_key, name, applications, returned, rejected, resubmissions, efficiency_gap_pct, fee_delay_days, production_ratio "
            + "FROM ai_demo_entity", rs -> {
                Entity e = new Entity();
                e.key = rs.getString("entity_key");
                e.name = rs.getString("name");
                e.synthetic = true;
                e.apps = rs.getInt("applications");
                e.returned = rs.getInt("returned");
                e.rejected = rs.getInt("rejected");
                e.resub = rs.getInt("resubmissions");
                e.gapPct = rs.getDouble("efficiency_gap_pct");
                e.delayDays = rs.getDouble("fee_delay_days");
                double pr = rs.getDouble("production_ratio");
                e.prodRatio = rs.wasNull() ? null : pr;
                by.put(e.key, e);
            });

        List<Map<String, Object>> scored = new ArrayList<>();
        List<Map<String, Object>> evidence = new ArrayList<>();
        StringBuilder canonical = new StringBuilder();
        double confSum = 0;
        for (Entity e : by.values()) {
            double apps = Math.max(1, e.apps);
            double[][] f = {
                {e.returned / apps, 20, 0.5}, {e.rejected / apps, 25, 0.34}, {e.gapPct, 25, 10}, {e.delayDays, 10, 14}, {e.resub, 10, 3},
                {e.prodRatio == null ? 0 : Math.max(0, e.prodRatio - 1), 10, 2}};
            String[] names = {"Returned share of applications", "Rejected share of applications", "Declared minus verified efficiency (percent)",
                "Fee confirmation delay (days)", "Resubmissions", "Latest quarter production vs earlier mean (excess ratio)"};
            String[] srcs = {"model_application_return", "model_application_rejection", "model_application_rating (declared_iseer, verified_iseer)",
                "model_application_fee_confirmation.confirmed_at minus model_application_submission_event.occurred_at",
                "model_application_resubmission", "production_row.units by production_submission.quarter"};
            String[] refs = {e.returnedRefs, e.rejectedRefs, e.gapRefs, e.delayRefs, e.resubRefs, ""};
            List<Map<String, Object>> features = new ArrayList<>();
            double score = 0;
            for (int i = 0; i < f.length; i++) {
                double contribution = AiMath.round(f[i][1] * clamp01(f[i][0] / f[i][2]), 1);
                score += contribution;
                Map<String, Object> feature = new LinkedHashMap<>();
                feature.put("feature", names[i]);
                feature.put("value", AiMath.round(f[i][0], 2));
                feature.put("weight", (int) f[i][1]);
                feature.put("fullAt", f[i][2]);
                feature.put("contribution", contribution);
                features.add(feature);
                if (contribution > 0) {
                    String src = e.synthetic ? "ai_demo_entity (synthetic)" : srcs[i];
                    Map<String, Object> row = ev(src, e.name + ": " + names[i], AiMath.round(f[i][0], 2));
                    if (!refs[i].isEmpty() && !e.synthetic) {
                        row.put("rows", refs[i]);
                    }
                    evidence.add(row);
                }
            }
            score = AiMath.round(score, 1);
            double conf = e.apps > 0 ? Math.min(0.95, 0.3 + 0.12 * e.apps) : 0.3;
            confSum += conf;
            Map<String, Object> entity = new LinkedHashMap<>();
            entity.put("key", e.key);
            entity.put("name", e.name);
            entity.put("synthetic", e.synthetic);
            entity.put("applications", e.apps);
            entity.put("score", score);
            entity.put("band", score >= 60 ? "high" : score >= 30 ? "medium" : "low");
            entity.put("confidence", AiMath.round(conf, 2));
            entity.put("features", features);
            scored.add(entity);
            canonical.append(e.key).append('|').append(e.apps).append('|').append(e.returned).append('|').append(e.rejected).append('|').append(e.resub)
                .append('|').append(e.gapPct).append('|').append(e.delayDays).append('|').append(e.prodRatio).append('|').append(e.returnedRefs)
                .append('|').append(e.rejectedRefs).append('|').append(e.gapRefs).append('\n');
        }
        scored.sort((a, b) -> {
            int c = Double.compare((double) b.get("score"), (double) a.get("score"));
            return c != 0 ? c : ((String) a.get("name")).compareTo((String) b.get("name"));
        });
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("summary", scored.isEmpty() ? "No organisations to score." : "Highest review priority: " + scored.get(0).get("name") + " (score "
            + scored.get(0).get("score") + " of 100, " + scored.get(0).get("band") + "). Review priority only; not a finding.");
        out.put("entities", scored);
        out.put("productionSource", productionLive ? "production_row (live)" : "no live production table: production spike feature uses synthetic ratios only");
        out.put("evidence", evidence);
        out.put("note", "Transparent weighted rules (weights sum to 100). Rows marked synthetic come from ai_demo_entity. Advisory: a person decides.");
        return new Computed(out, scored.isEmpty() ? 0.3 : confSum / scored.size(), hash(canonical.toString()), "all-organisations");
    }

    private interface Setter {
        void set(Entity e, int count, String refs);
    }

    private void feature(Map<String, Entity> by, String table, String label, Setter setter) {
        jdbc.query("SELECT a.organisation_id::text AS k, count(*) AS c, string_agg(a.reference, ', ' ORDER BY a.reference) AS refs FROM " + table
            + " x JOIN model_application a ON a.id = x.application_id GROUP BY a.organisation_id", rs -> {
                Entity e = by.get(rs.getString("k"));
                if (e != null) {
                    setter.set(e, rs.getInt("c"), rs.getString("refs"));
                }
            });
    }

    // ---- 2. production anomaly -------------------------------------------------------------------------------------------------

    private record Point(String quarter, double units) {
    }

    private static final class Series {
        String key;
        String org;
        String model;
        List<Point> points = new ArrayList<>();
        Integer bound;
    }

    public Computed productionAnomaly() {
        Map<String, Series> series = new TreeMap<>();
        boolean live = readable("production_submission", "id", "organisation_id", "quarter") && readable("production_row", "submission_id", "model_application_id", "units");
        if (live) {
            boolean qr = readable("qr_serial", "batch_id", "state") && readable("qr_batch", "id", "model_application_id");
            jdbc.query("SELECT o.legal_name AS org, a.model_number AS model, a.id AS app, s.quarter AS q, sum(r.units) AS u"
                + (qr ? ", (SELECT count(*) FROM qr_serial z JOIN qr_batch b ON b.id = z.batch_id WHERE b.model_application_id = a.id AND z.state = 'bound') AS bound" : ", NULL AS bound")
                + " FROM production_row r JOIN production_submission s ON s.id = r.submission_id JOIN organisation o ON o.id = s.organisation_id "
                + "JOIN model_application a ON a.id = r.model_application_id GROUP BY o.legal_name, a.model_number, a.id, s.quarter ORDER BY o.legal_name, a.model_number, s.quarter", rs -> {
                    Series s = series.computeIfAbsent(rs.getString("org") + " / " + rs.getString("model"), k -> new Series());
                    s.key = rs.getString("org") + " / " + rs.getString("model");
                    s.org = rs.getString("org");
                    s.model = rs.getString("model");
                    s.points.add(new Point(rs.getString("q"), rs.getDouble("u")));
                    int b = rs.getInt("bound");
                    s.bound = rs.wasNull() ? null : b;
                });
            if (series.isEmpty()) {
                live = false;
            }
        }
        if (!live) {
            jdbc.query("SELECT series_key, organisation, model_label, quarter, units, serials_bound FROM ai_demo_production ORDER BY series_key, quarter", rs -> {
                Series s = series.computeIfAbsent(rs.getString("series_key"), k -> new Series());
                s.key = rs.getString("organisation") + " / " + rs.getString("model_label");
                s.org = rs.getString("organisation");
                s.model = rs.getString("model_label");
                s.points.add(new Point(rs.getString("quarter"), rs.getDouble("units")));
                int b = rs.getInt("serials_bound");
                if (!rs.wasNull()) {
                    s.bound = b;
                }
            });
        }
        String src = live ? "production_row" : "ai_demo_production (synthetic)";
        List<Map<String, Object>> out = new ArrayList<>();
        List<Map<String, Object>> evidence = new ArrayList<>();
        StringBuilder canonical = new StringBuilder();
        int flagged = 0;
        double confSum = 0;
        int counted = 0;
        for (Series s : series.values()) {
            double[] u = s.points.stream().mapToDouble(Point::units).toArray();
            List<Map<String, Object>> flags = new ArrayList<>();
            List<Map<String, Object>> quarters = new ArrayList<>();
            double[] fences = AiMath.fences(u);
            for (int i = 0; i < u.length; i++) {
                double[] others = new double[u.length - 1];
                for (int j = 0, k = 0; j < u.length; j++) {
                    if (j != i) {
                        others[k++] = u[j];
                    }
                }
                Map<String, Object> q = new LinkedHashMap<>();
                q.put("quarter", s.points.get(i).quarter());
                q.put("units", (long) u[i]);
                q.put("zVsOthers", AiMath.round(AiMath.z(u[i], others), 2));
                quarters.add(q);
                canonical.append(s.key).append('|').append(s.points.get(i).quarter()).append('|').append((long) u[i]).append('\n');
                if (u.length >= 4 && (u[i] > fences[1] || u[i] < fences[0])) {
                    Map<String, Object> flag = new LinkedHashMap<>();
                    flag.put("type", "iqr_fence");
                    flag.put("quarter", s.points.get(i).quarter());
                    flag.put("detail", (long) u[i] + " units is outside the Tukey fences " + AiMath.round(fences[0], 0) + " to " + AiMath.round(fences[1], 0));
                    flags.add(flag);
                }
            }
            if (u.length >= 4) {
                double[] prior = java.util.Arrays.copyOf(u, u.length - 1);
                double zLatest = AiMath.z(u[u.length - 1], prior);
                if (Math.abs(zLatest) >= 3) {
                    Map<String, Object> flag = new LinkedHashMap<>();
                    flag.put("type", "z_score_vs_own_history");
                    flag.put("quarter", s.points.get(u.length - 1).quarter());
                    flag.put("detail", "latest quarter z = " + AiMath.round(zLatest, 1) + " against " + prior.length + " earlier quarters (mean "
                        + AiMath.round(AiMath.mean(prior), 0) + ")");
                    flags.add(flag);
                }
            }
            double total = java.util.Arrays.stream(u).sum();
            if (s.bound != null) {
                canonical.append(s.key).append("|bound|").append(s.bound).append('\n');
                if (total > s.bound * 1.10) {
                    Map<String, Object> flag = new LinkedHashMap<>();
                    flag.put("type", "units_exceed_bound_serials");
                    flag.put("quarter", "all");
                    flag.put("detail", (long) total + " units reported against " + s.bound + " QR serials bound (more than 10 percent over)");
                    flags.add(flag);
                }
            }
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("series", s.key);
            row.put("organisation", s.org);
            row.put("model", s.model);
            row.put("quarters", quarters);
            row.put("mean", AiMath.round(AiMath.mean(u), 1));
            row.put("sd", AiMath.round(AiMath.sd(u), 1));
            row.put("fences", List.of(AiMath.round(fences[0], 1), AiMath.round(fences[1], 1)));
            row.put("boundSerials", s.bound);
            row.put("flags", flags);
            row.put("status", flags.isEmpty() ? "normal" : "flagged");
            out.add(row);
            if (!flags.isEmpty()) {
                flagged++;
            }
            for (Map<String, Object> f : flags) {
                evidence.add(ev(src, s.key + " " + f.get("quarter") + " " + f.get("type"), f.get("detail")));
            }
            confSum += Math.min(0.9, 0.3 + 0.1 * u.length);
            counted++;
        }
        Map<String, Object> o = new LinkedHashMap<>();
        o.put("source", src);
        o.put("synthetic", !live);
        o.put("summary", flagged + " of " + out.size() + " series flagged for a person to look at"
            + (live ? "." : ". Synthetic rows are used because the production tables are absent or empty."));
        o.put("series", out);
        o.put("evidence", evidence);
        o.put("note", "z-score against the series' own earlier quarters (flag at 3 or more), Tukey fences across the series, and units versus QR serials bound where known. A spike may be genuine growth. Advisory.");
        return new Computed(o, counted == 0 ? 0.3 : confSum / counted, hash(canonical.toString()), live ? "production-live" : "production-synthetic");
    }

    // ---- 3. rating trends ------------------------------------------------------------------------------------------------------

    public Computed ratingTrends(String category) {
        record Row(String source, String month, String category, int stars, double iseer) {
        }
        List<Row> rows = new ArrayList<>();
        jdbc.query("SELECT a.category AS c, to_char(r.computed_at, 'YYYY-MM') AS m, r.stars AS s, r.verified_iseer AS v FROM model_application_rating r "
            + "JOIN model_application a ON a.id = r.application_id WHERE r.rating_version = (SELECT max(r2.rating_version) FROM model_application_rating r2 "
            + "WHERE r2.application_id = r.application_id)", rs -> {
                rows.add(new Row("real", rs.getString("m"), rs.getString("c"), rs.getInt("s"), rs.getDouble("v")));
            });
        jdbc.query("SELECT month, category, stars, iseer FROM ai_demo_rating", rs -> {
            rows.add(new Row("synthetic", rs.getString("month"), rs.getString("category"), rs.getInt("stars"), rs.getDouble("iseer")));
        });
        String filter = category == null || category.isBlank() ? null : category.trim().toUpperCase();
        List<Row> used = rows.stream().filter(r -> filter == null || r.category().equals(filter)).toList();
        if (used.isEmpty()) {
            throw new BadInput("no ratings for that category");
        }
        long real = used.stream().filter(r -> r.source().equals("real")).count();
        Map<String, List<Row>> byCat = new TreeMap<>();
        used.forEach(r -> byCat.computeIfAbsent(r.category(), k -> new ArrayList<>()).add(r));
        List<Map<String, Object>> cats = new ArrayList<>();
        List<Map<String, Object>> evidence = new ArrayList<>();
        List<String> sentences = new ArrayList<>();
        double confSum = 0;
        for (Map.Entry<String, List<Row>> en : byCat.entrySet()) {
            List<Row> list = en.getValue();
            int[] dist = new int[5];
            Map<String, List<Double>> perMonth = new TreeMap<>();
            for (Row r : list) {
                dist[r.stars() - 1]++;
                perMonth.computeIfAbsent(r.month(), k -> new ArrayList<>()).add(r.iseer());
            }
            int n = list.size();
            int m = perMonth.size();
            double[] x = new double[m];
            double[] y = new double[m];
            List<Map<String, Object>> months = new ArrayList<>();
            int i = 0;
            for (Map.Entry<String, List<Double>> pm : perMonth.entrySet()) {
                x[i] = i;
                y[i] = AiMath.mean(pm.getValue().stream().mapToDouble(Double::doubleValue).toArray());
                Map<String, Object> mo = new LinkedHashMap<>();
                mo.put("month", pm.getKey());
                mo.put("meanIseer", AiMath.round(y[i], 3));
                mo.put("count", pm.getValue().size());
                months.add(mo);
                i++;
            }
            double[] fit = AiMath.ols(x, y);
            double ssTot = 0;
            double my = AiMath.mean(y);
            for (double v : y) {
                ssTot += (v - my) * (v - my);
            }
            double r2 = ssTot == 0 || m < 3 ? 0 : clamp01(1 - (fit[2] * fit[2] * (m - 2)) / ssTot);
            Map<String, Object> forecast = null;
            if (m >= 3) {
                double x0 = m;
                double pred = fit[0] + fit[1] * x0;
                double half = 1.96 * fit[2] * Math.sqrt(1 + 1.0 / m + (x0 - fit[4]) * (x0 - fit[4]) / (fit[5] == 0 ? 1 : fit[5]));
                forecast = new LinkedHashMap<>();
                forecast.put("nextMonthMeanIseer", AiMath.round(pred, 3));
                forecast.put("low95", AiMath.round(pred - half, 3));
                forecast.put("high95", AiMath.round(pred + half, 3));
            }
            int high = dist[3] + dist[4];
            double conf = clamp01(0.6 * r2 + 0.4 * Math.min(m, 8) / 8.0);
            confSum += conf;
            Map<String, Object> c = new LinkedHashMap<>();
            c.put("category", en.getKey());
            c.put("ratings", n);
            c.put("starDistribution", List.of(dist[0], dist[1], dist[2], dist[3], dist[4]));
            c.put("months", months);
            c.put("slopePerMonth", AiMath.round(fit[1], 4));
            c.put("rSquared", AiMath.round(r2, 3));
            c.put("forecast", forecast);
            cats.add(c);
            String dir = Math.abs(fit[1]) < 0.005 ? "was flat" : fit[1] > 0 ? "rose" : "fell";
            sentences.add(en.getKey() + ": mean verified efficiency " + dir + (Math.abs(fit[1]) < 0.005 ? "" : " by about " + AiMath.round(Math.abs(fit[1]), 3) + " per month")
                + " (" + AiMath.round(y[0], 2) + " to " + AiMath.round(y[m - 1], 2) + " across " + m + " months); "
                + Math.round(100.0 * high / n) + " percent of " + n + " ratings are 4 or 5 stars.");
            evidence.add(ev("model_application_rating.verified_iseer + ai_demo_rating.iseer", en.getKey() + " monthly means (" + m + " months, " + n + " ratings)",
                "slope " + AiMath.round(fit[1], 4) + " per month, R2 " + AiMath.round(r2, 3)));
            evidence.add(ev("model_application_rating.stars + ai_demo_rating.stars", en.getKey() + " star counts 1 to 5", List.of(dist[0], dist[1], dist[2], dist[3], dist[4])));
        }
        StringBuilder canonical = new StringBuilder();
        used.stream().map(r -> r.source() + "|" + r.month() + "|" + r.category() + "|" + r.stars() + "|" + r.iseer()).sorted()
            .forEach(l -> canonical.append(l).append('\n'));
        Map<String, Object> o = new LinkedHashMap<>();
        o.put("summary", String.join(" ", sentences) + " (" + real + " real ratings, " + (used.size() - real) + " synthetic.)");
        o.put("categories", cats);
        o.put("realRatings", real);
        o.put("syntheticRatings", used.size() - real);
        o.put("evidence", evidence);
        o.put("note", "Summary text is filled from the numbers by a template. Ordinary least squares on monthly means; the 95 percent band is for the next month. Few months mean a wide band. Advisory.");
        return new Computed(o, confSum / cats.size(), hash(canonical.toString()), filter == null ? "all-categories" : filter);
    }

    // ---- 4. helpdesk assist ----------------------------------------------------------------------------------------------------

    public Computed helpdesk(String question) {
        if (question == null || question.trim().length() < 3 || question.length() > 500) {
            throw new BadInput("Write a question of 3 to 500 characters.");
        }
        record Article(int id, String category, String title, String body) {
        }
        List<Article> kb = jdbc.query("SELECT id, category, title, body FROM ai_kb ORDER BY id",
            (rs, i) -> new Article(rs.getInt("id"), rs.getString("category"), rs.getString("title"), rs.getString("body")));
        if (kb.isEmpty()) {
            throw new BadInput("The knowledge base is empty (seed local/seed/demo/s6_ai.sql).");
        }
        if (AiMath.tokens(question).isEmpty()) {
            throw new BadInput("Write a question with some real words.");
        }
        double[] scores = AiMath.tfidfCosine(question, kb.stream().map(a -> a.title() + " " + a.title() + " " + a.body()).toList());
        Integer[] order = new Integer[kb.size()];
        for (int i = 0; i < order.length; i++) {
            order[i] = i;
        }
        java.util.Arrays.sort(order, (a, b) -> {
            int c = Double.compare(scores[b], scores[a]);
            return c != 0 ? c : Integer.compare(kb.get(a).id(), kb.get(b).id());
        });
        List<Map<String, Object>> top = new ArrayList<>();
        List<Map<String, Object>> evidence = new ArrayList<>();
        for (int i = 0; i < Math.min(3, order.length); i++) {
            Article a = kb.get(order[i]);
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("articleId", a.id());
            m.put("title", a.title());
            m.put("category", a.category());
            m.put("score", AiMath.round(scores[order[i]], 3));
            m.put("body", a.body());
            top.add(m);
            evidence.add(ev("ai_kb.id " + a.id(), a.title(), AiMath.round(scores[order[i]], 3)));
        }
        double best = scores[order[0]];
        double confidence = Math.min(0.95, 2 * best);
        boolean escalate = confidence < ESCALATE_BELOW;
        Article lead = kb.get(order[0]);
        Map<String, Object> o = new LinkedHashMap<>();
        o.put("question", question.trim());
        o.put("topAnswers", top);
        o.put("suggestedCategory", escalate ? "needs a person to categorise" : lead.category());
        o.put("escalateToHuman", escalate);
        o.put("escalateThreshold", ESCALATE_BELOW);
        o.put("draftReply", escalate
            ? "Thank you for writing. This needs a helpdesk officer to look at it; we have passed it on and will reply once it has been checked."
            : "Thank you for your question. " + lead.body() + " If this does not answer your question, a helpdesk officer will follow up. "
                + "(Draft for an officer to review. This system never sends it.)");
        o.put("evidence", evidence);
        o.put("note", "Keyword retrieval (TF-IDF cosine) over " + kb.size() + " synthetic FAQ articles. Confidence = min(0.95, 2 x best cosine); below "
            + ESCALATE_BELOW + " it asks for a person. Not a language model. Advisory.");
        String canonical = kb.stream().map(a -> a.id() + "|" + a.category() + "|" + a.title() + "|" + a.body()).reduce("", (x, y) -> x + y + "\n");
        return new Computed(o, confidence, hash(canonical), question.trim().length() > 80 ? question.trim().substring(0, 80) : question.trim());
    }

    // ---- 5. document extraction ------------------------------------------------------------------------------------------------

    private static String norm(String s) {
        return s == null ? "" : s.toLowerCase().replaceAll("[^a-z0-9]+", "");
    }

    public Computed extraction(String applicationRef) {
        if (applicationRef == null || applicationRef.isBlank()) {
            throw new BadInput("Give the application reference (for example LOCAL-MA-0004).");
        }
        UUID asUuid = null;
        try {
            asUuid = UUID.fromString(applicationRef.trim());
        } catch (IllegalArgumentException ignored) {
            // a reference, not an id
        }
        List<Map<String, Object>> apps = jdbc.query("SELECT a.id, a.reference, a.laboratory_code, a.tested_on, a.declared_iseer, "
            + "(SELECT legal_name FROM organisation WHERE code = a.laboratory_code) AS lab_name FROM model_application a WHERE a.reference = ? OR a.id = ?",
            (rs, i) -> {
                Map<String, Object> m = new HashMap<>();
                m.put("id", rs.getObject("id", UUID.class));
                m.put("reference", rs.getString("reference"));
                m.put("labCode", rs.getString("laboratory_code"));
                m.put("labName", rs.getString("lab_name"));
                m.put("testedOn", rs.getDate("tested_on") == null ? null : rs.getDate("tested_on").toString());
                m.put("iseer", rs.getBigDecimal("declared_iseer"));
                return m;
            }, applicationRef.trim(), asUuid);
        if (apps.isEmpty()) {
            throw new Missing();
        }
        Map<String, Object> app = apps.get(0);
        String reference = (String) app.get("reference");
        Optional<Map<String, Object>> version = jdbc.query("SELECT v.content_sha256, v.version_number, v.original_filename, v.laboratory_name, v.tested_on "
            + "FROM model_application_document d JOIN model_application_document_version v ON v.document_id = d.id WHERE d.application_id = ? "
            + "ORDER BY v.version_number DESC LIMIT 1", (rs, i) -> {
                Map<String, Object> m = new HashMap<>();
                m.put("sha", rs.getString("content_sha256"));
                m.put("n", rs.getInt("version_number"));
                m.put("file", rs.getString("original_filename"));
                m.put("lab", rs.getString("laboratory_name"));
                m.put("date", rs.getDate("tested_on") == null ? null : rs.getDate("tested_on").toString());
                return m;
            }, app.get("id")).stream().findFirst();
        String text = "";
        String textSource = "";
        if (version.isPresent()) {
            try {
                Optional<byte[]> bytes = store.read((String) version.get().get("sha"));
                text = bytes.map(ReportText::extract).orElse("");
            } catch (java.io.IOException | RuntimeException e) {
                text = "";
            }
            if (!text.isBlank()) {
                textSource = "uploaded PDF " + version.get().get("file") + " (version " + version.get().get("n") + ")";
            }
        }
        if (text.isBlank()) {
            List<String> seeded = jdbc.queryForList("SELECT report_text FROM ai_demo_report_text WHERE application_reference = ?", String.class, reference);
            if (!seeded.isEmpty()) {
                text = seeded.get(0);
                textSource = "seeded sample report text (synthetic), because no readable text was found in the stored PDF";
            } else {
                text = SAMPLE_REPORT;
                textSource = "built-in sample report text (synthetic), because no readable PDF text and no seeded text exist for this application";
            }
        }
        ReportText.Fields found = ReportText.fields(text);
        String declaredLab = version.map(v -> (String) v.get("lab")).filter(s -> s != null && !s.isBlank()).orElse((String) app.get("labName"));
        String declaredDate = (String) app.get("testedOn") != null ? (String) app.get("testedOn") : version.map(v -> (String) v.get("date")).orElse(null);
        java.math.BigDecimal declaredIseer = (java.math.BigDecimal) app.get("iseer");

        List<Map<String, Object>> fields = new ArrayList<>();
        List<Map<String, Object>> evidence = new ArrayList<>();
        double minConf = 1;
        int hits = 0;
        String[] names = {"laboratory", "testDate", "efficiency"};
        ReportText.Found[] fs = {found.laboratory(), found.testDate(), found.efficiency()};
        String[] declared = {declaredLab, declaredDate, declaredIseer == null ? null : declaredIseer.toPlainString()};
        String[] declaredSrc = {"model_application_document_version.laboratory_name / organisation.legal_name", "model_application.tested_on",
            "model_application.declared_iseer"};
        for (int i = 0; i < 3; i++) {
            String status;
            if (fs[i] == null) {
                status = "not_found_in_report";
            } else if (declared[i] == null) {
                status = "not_declared";
            } else if (matches(i, fs[i].value(), declared[i])) {
                status = "match";
            } else {
                status = "differs";
            }
            if (fs[i] != null) {
                hits++;
                minConf = Math.min(minConf, fs[i].confidence());
            }
            Map<String, Object> f = new LinkedHashMap<>();
            f.put("field", names[i]);
            f.put("extracted", fs[i] == null ? null : fs[i].value());
            f.put("declared", declared[i]);
            f.put("status", status);
            f.put("confidence", fs[i] == null ? 0 : fs[i].confidence());
            fields.add(f);
            evidence.add(ev("report text: " + names[i], "extracted", fs[i] == null ? "(not found)" : fs[i].value()));
            evidence.add(ev(declaredSrc[i], "declared", declared[i] == null ? "(not declared)" : declared[i]));
        }
        Map<String, Object> o = new LinkedHashMap<>();
        long differ = fields.stream().filter(f -> f.get("status").equals("differs")).count();
        o.put("applicationReference", reference);
        o.put("textSource", textSource);
        o.put("fields", fields);
        o.put("summary", differ == 0 ? "No differences found between the report and the declared values (a person confirms each field)."
            : differ + " field(s) differ between the report and what the application declares (a person checks them).");
        o.put("evidence", evidence);
        o.put("note", "Pattern matching over PDF text; no OCR. The application is not changed. A person confirms each field. Advisory.");
        String canonical = reference + "|" + text + "|" + declaredLab + "|" + declaredDate + "|" + declaredIseer;
        return new Computed(o, hits == 0 ? 0.1 : minConf * hits / 3.0, hash(canonical), reference);
    }

    private static boolean matches(int field, String extracted, String declared) {
        if (field == 0) {
            String a = norm(extracted);
            String b = norm(declared);
            return !a.isEmpty() && !b.isEmpty() && (a.contains(b) || b.contains(a));
        }
        if (field == 1) {
            return extracted.equals(declared);
        }
        try {
            return Math.abs(Double.parseDouble(extracted) - Double.parseDouble(declared)) <= 0.005;
        } catch (NumberFormatException e) {
            return false;
        }
    }
}
