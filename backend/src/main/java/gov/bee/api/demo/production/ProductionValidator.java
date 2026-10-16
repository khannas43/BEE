package gov.bee.api.demo.production;

import java.time.LocalDate;
import java.time.Month;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Pure rules of the bulk row validation (demonstration on provisional rules, not BEE rules): the CSV header, the quarter's dates, and the
 * per-row checks. No database access; the certificate lookup is passed in.
 */
public final class ProductionValidator {

    public static final long MAX_UNITS = 10_000_000L;
    public static final int MAX_ROWS = 5000;
    public static final String HEADER = "registration_id,units,period_start,period_end";
    private static final Pattern QUARTER = Pattern.compile("^(\\d{4})-Q([1-4])$");

    private ProductionValidator() {
    }

    /** One input row as typed, with its line number in the file (the header is line 1). */
    public record RowInput(int line, String registrationId, String units, String periodStart, String periodEnd) {
    }

    /** What the certificate table says about a registration ID: the model, its organisation, and whether the model is approved. */
    public record CertInfo(UUID modelId, UUID organisationId, boolean approved) {
    }

    public record RowResult(int line, boolean ok, String message, UUID modelId, long units, LocalDate periodStart, LocalDate periodEnd,
                            String registrationId) {
    }

    public record Parsed(List<RowInput> rows, String error) {
    }

    /** The first and last day of a quarter such as 2026-Q3, or null when the text is not a quarter. */
    public static LocalDate[] quarterRange(String quarter) {
        if (quarter == null) {
            return null;
        }
        Matcher m = QUARTER.matcher(quarter);
        if (!m.matches()) {
            return null;
        }
        int year = Integer.parseInt(m.group(1));
        int q = Integer.parseInt(m.group(2));
        LocalDate first = LocalDate.of(year, Month.of((q - 1) * 3 + 1), 1);
        return new LocalDate[] {first, first.plusMonths(3).minusDays(1)};
    }

    /** Reads CSV text with the header registration_id,units,period_start,period_end. Blank lines are skipped. */
    public static Parsed parseCsv(String csv) {
        if (csv == null || csv.isBlank()) {
            return new Parsed(List.of(), "The CSV is empty.");
        }
        String[] lines = csv.replace("\r\n", "\n").replace('\r', '\n').split("\n", -1);
        int headerAt = -1;
        for (int i = 0; i < lines.length; i++) {
            if (!lines[i].isBlank()) {
                headerAt = i;
                break;
            }
        }
        String header = String.join(",", cells(lines[headerAt])).toLowerCase();
        if (!header.equals(HEADER)) {
            return new Parsed(List.of(), "The first line must be the header " + HEADER + ".");
        }
        List<RowInput> rows = new ArrayList<>();
        for (int i = headerAt + 1; i < lines.length; i++) {
            if (lines[i].isBlank()) {
                continue;
            }
            List<String> c = cells(lines[i]);
            if (rows.size() >= MAX_ROWS) {
                return new Parsed(List.of(), "At most " + MAX_ROWS + " rows can be checked at once.");
            }
            rows.add(new RowInput(i + 1, get(c, 0), get(c, 1), get(c, 2), get(c, 3)));
            if (c.size() != 4) {
                rows.set(rows.size() - 1, new RowInput(i + 1, get(c, 0), c.size() == 4 ? get(c, 1) : "#columns:" + c.size(), get(c, 2), get(c, 3)));
            }
        }
        if (rows.isEmpty()) {
            return new Parsed(List.of(), "The CSV has a header but no rows.");
        }
        return new Parsed(rows, null);
    }

    private static List<String> cells(String line) {
        List<String> out = new ArrayList<>();
        for (String s : line.split(",", -1)) {
            String t = s.trim();
            if (t.length() >= 2 && t.startsWith("\"") && t.endsWith("\"")) {
                t = t.substring(1, t.length() - 1).trim();
            }
            out.add(t);
        }
        return out;
    }

    private static String get(List<String> c, int i) {
        return i < c.size() ? c.get(i) : "";
    }

    /**
     * Checks every row. {@code existingKeys} are model+period keys already stored in the submission (see {@link #key}); rows repeated within
     * the input are also refused. Never throws for bad data: the message says what is wrong.
     */
    public static List<RowResult> validate(List<RowInput> rows, String quarter, UUID organisationId, Function<String, CertInfo> lookup,
                                           Set<String> existingKeys) {
        LocalDate[] range = quarterRange(quarter);
        Set<String> seen = new HashSet<>(existingKeys);
        Map<UUID, List<LocalDate[]>> periods = new HashMap<>();
        for (String k : existingKeys) {
            String[] parts = k.split("\\|");
            if (parts.length == 3) {
                try {
                    periods.computeIfAbsent(UUID.fromString(parts[0]), x -> new ArrayList<>()).add(new LocalDate[] {LocalDate.parse(parts[1]), LocalDate.parse(parts[2])});
                } catch (IllegalArgumentException | java.time.format.DateTimeParseException e) {
                    // a key without a real period (the epoch placeholder is a real date, so this is only a malformed key): nothing to overlap
                }
            }
        }
        List<RowResult> out = new ArrayList<>();
        for (RowInput r : rows) {
            out.add(check(r, range, organisationId, lookup, seen, periods));
        }
        return out;
    }

    public static String key(UUID model, LocalDate start, LocalDate end) {
        return model + "|" + start + "|" + end;
    }

    private static RowResult check(RowInput r, LocalDate[] range, UUID organisationId, Function<String, CertInfo> lookup, Set<String> seen,
                                   Map<UUID, List<LocalDate[]>> periods) {
        if (r.units() != null && r.units().startsWith("#columns:")) {
            return bad(r, "Expected 4 columns (" + HEADER + "), found " + r.units().substring(9) + ".");
        }
        String reg = r.registrationId() == null ? "" : r.registrationId().trim();
        if (reg.isEmpty()) {
            return bad(r, "registration_id is empty.");
        }
        CertInfo cert = lookup.apply(reg);
        if (cert == null) {
            return bad(r, "registration_id " + reg + " is not an issued certificate.");
        }
        if (!cert.organisationId().equals(organisationId)) {
            return bad(r, "registration_id " + reg + " belongs to another organisation.");
        }
        if (!cert.approved()) {
            return bad(r, "The model of " + reg + " is not approved.");
        }
        long units;
        try {
            String u = r.units() == null ? "" : r.units().trim();
            if (!u.matches("\\d{1,9}")) {
                return bad(r, "units must be a whole number, 1 to " + MAX_UNITS + ".");
            }
            units = Long.parseLong(u);
        } catch (NumberFormatException e) {
            return bad(r, "units must be a whole number, 1 to " + MAX_UNITS + ".");
        }
        if (units < 1 || units > MAX_UNITS) {
            return bad(r, "units must be between 1 and " + MAX_UNITS + ".");
        }
        LocalDate start = date(r.periodStart());
        LocalDate end = date(r.periodEnd());
        if (start == null || end == null) {
            return bad(r, "period_start and period_end must be dates as YYYY-MM-DD.");
        }
        if (end.isBefore(start)) {
            return bad(r, "period_end is before period_start.");
        }
        if (range == null || start.isBefore(range[0]) || end.isAfter(range[1])) {
            return bad(r, "The period must lie inside the quarter (" + (range == null ? "?" : range[0] + " to " + range[1]) + ").");
        }
        if (!seen.add(key(cert.modelId(), start, end))) {
            return bad(r, "Duplicate: this model already has a row for the same period.");
        }
        // Two different periods of one model must not overlap: the same units would be counted twice in the totals and the reconciliation.
        List<LocalDate[]> taken = periods.computeIfAbsent(cert.modelId(), x -> new ArrayList<>());
        for (LocalDate[] t : taken) {
            if (!start.isAfter(t[1]) && !end.isBefore(t[0])) {
                return bad(r, "The period overlaps another row of this model (" + t[0] + " to " + t[1] + "); the same units would be counted twice.");
            }
        }
        taken.add(new LocalDate[] {start, end});
        return new RowResult(r.line(), true, "OK", cert.modelId(), units, start, end, reg);
    }

    private static RowResult bad(RowInput r, String message) {
        return new RowResult(r.line(), false, message, null, 0, null, null, r.registrationId());
    }

    private static LocalDate date(String s) {
        try {
            return s == null ? null : LocalDate.parse(s.trim());
        } catch (java.time.format.DateTimeParseException e) {
            return null;
        }
    }
}
