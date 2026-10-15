package gov.bee.api.demo.mis;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

/**
 * One MIS panel under construction: headline cards, tables (each table is also what a chart draws, so every figure has a table form), the
 * source tables used with their row counts (the data version is a short hash of exactly these counts), and the parts that are not available
 * yet because another demo area has not landed. Demonstration code, not a BEE report.
 */
final class MisPanel {

    /** A table. {@code chart} is a hint for the screen: bar, line or none. The first column is the label, the others are numbers. */
    record Table(String key, String title, String chart, List<String> columns, List<List<Object>> rows) {
        Map<String, Object> toMap() {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("key", key);
            m.put("title", title);
            m.put("chart", chart);
            m.put("columns", columns);
            m.put("rows", rows);
            return m;
        }
    }

    private final String name;
    private final List<Map<String, Object>> cards = new ArrayList<>();
    private final List<Table> tables = new ArrayList<>();
    private final List<Map<String, Object>> unavailable = new ArrayList<>();
    private final Map<String, Long> sourceCounts = new TreeMap<>();

    MisPanel(String name) {
        this.name = name;
    }

    String name() {
        return name;
    }

    void card(String key, String label, Object value, String unit, String note) {
        Map<String, Object> c = new LinkedHashMap<>();
        c.put("key", key);
        c.put("label", label);
        c.put("value", value);
        c.put("unit", unit);
        c.put("note", note);
        cards.add(c);
    }

    void table(String key, String title, String chart, List<String> columns, List<List<Object>> rows) {
        tables.add(new Table(key, title, chart, columns, rows));
    }

    void source(String table, long rowCount) {
        sourceCounts.put(table, rowCount);
    }

    void unavailable(String part, String reason) {
        unavailable.add(Map.of("part", part, "reason", reason));
    }

    List<Table> tables() {
        return tables;
    }

    /** A short hash of the row counts of the source tables: the same data gives the same value. */
    String dataVersion() {
        StringBuilder sb = new StringBuilder();
        sourceCounts.forEach((t, n) -> sb.append(t).append('=').append(n).append(';'));
        try {
            byte[] d = MessageDigest.getInstance("SHA-256").digest(sb.toString().getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(d).substring(0, 12);
        } catch (java.security.NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    Map<String, Object> toBody(String from, String to) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("panel", name);
        m.put("asOf", Instant.now().toString());
        m.put("dataVersion", dataVersion());
        m.put("sources", new ArrayList<>(sourceCounts.keySet()));
        m.put("sourceCounts", new LinkedHashMap<>(sourceCounts));
        m.put("from", from);
        m.put("to", to);
        m.put("cards", cards);
        List<Map<String, Object>> t = new ArrayList<>();
        tables.forEach(x -> t.add(x.toMap()));
        m.put("tables", t);
        m.put("unavailable", unavailable);
        m.put("synthetic", "Figures come from the local database; rows marked synthetic in the demo seed are test data.");
        return m;
    }

    /** CSV text of the cards and tables. Text cells starting with a formula character are prefixed so a spreadsheet does not run them. */
    String toCsv(String from, String to) {
        StringBuilder sb = new StringBuilder();
        sb.append("# Local demonstration MIS panel: ").append(name).append(" (synthetic data present; not a BEE report)\n");
        sb.append("# asOf,").append(Instant.now()).append("\n# dataVersion,").append(dataVersion()).append("\n# range,")
            .append(from).append(",").append(to).append("\n");
        if (!cards.isEmpty()) {
            sb.append("\n# Headline figures\nfigure,value,unit\n");
            for (Map<String, Object> c : cards) {
                sb.append(cell(c.get("label"))).append(',').append(cell(c.get("value"))).append(',').append(cell(c.get("unit"))).append('\n');
            }
        }
        for (Table t : tables) {
            sb.append("\n# ").append(t.title().replace('\n', ' ')).append('\n');
            sb.append(String.join(",", t.columns().stream().map(MisPanel::cell).toList())).append('\n');
            for (List<Object> r : t.rows()) {
                sb.append(String.join(",", r.stream().map(MisPanel::cell).toList())).append('\n');
            }
        }
        for (Map<String, Object> u : unavailable) {
            sb.append("\n# Not available yet: ").append(u.get("part")).append(" - ").append(u.get("reason")).append('\n');
        }
        return sb.toString();
    }

    static String cell(Object o) {
        if (o == null) {
            return "";
        }
        String s = o.toString();
        if (!(o instanceof Number) && !s.isEmpty() && "=+-@\t\r".indexOf(s.charAt(0)) >= 0) {
            s = "'" + s;
        }
        if (s.contains(",") || s.contains("\"") || s.contains("\n")) {
            s = "\"" + s.replace("\"", "\"\"") + "\"";
        }
        return s;
    }
}
