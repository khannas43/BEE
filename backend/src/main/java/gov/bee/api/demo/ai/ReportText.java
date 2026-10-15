package gov.bee.api.demo.ai;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.zip.Inflater;

/**
 * Reads plain text out of a simple PDF (uncompressed or Flate text streams, literal strings) and finds the declared fields of a test report
 * with regular expressions. No PDF library is on the classpath; scanned or exotic PDFs give no text and the caller says so.
 */
final class ReportText {

    private ReportText() {
    }

    record Found(String value, double confidence) {
    }

    record Fields(Found laboratory, Found testDate, Found efficiency) {
    }

    private static final Pattern STREAM = Pattern.compile("stream\\r?\\n");
    private static final Pattern SHOW = Pattern.compile("\\(((?:\\\\.|[^\\\\)])*)\\)\\s*(?:Tj|')|\\[((?:\\((?:\\\\.|[^\\\\)])*\\)|[^\\]()])*)\\]\\s*TJ");
    private static final Pattern PART = Pattern.compile("\\(((?:\\\\.|[^\\\\)])*)\\)|(-?[0-9.]+)");

    /** Text of the PDF, lines separated by newlines; empty when none could be read. */
    static String extract(byte[] pdf) {
        if (pdf == null || pdf.length < 8 || !new String(pdf, 0, 5, StandardCharsets.ISO_8859_1).startsWith("%PDF")) {
            return "";
        }
        String raw = new String(pdf, StandardCharsets.ISO_8859_1);
        StringBuilder out = new StringBuilder();
        Matcher m = STREAM.matcher(raw);
        int from = 0;
        while (m.find(from)) {
            int start = m.end();
            int end = raw.indexOf("endstream", start);
            if (end < 0) {
                break;
            }
            int dictStart = Math.max(0, raw.lastIndexOf("obj", m.start()));
            boolean flate = raw.substring(dictStart, m.start()).contains("FlateDecode");
            byte[] body = java.util.Arrays.copyOfRange(pdf, start, end);
            String content = flate ? inflate(body) : new String(body, StandardCharsets.ISO_8859_1);
            if (content != null) {
                text(content, out);
            }
            from = end + 9;
        }
        return out.toString().trim();
    }

    private static String inflate(byte[] body) {
        Inflater inf = new Inflater();
        try {
            inf.setInput(body);
            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            byte[] buf = new byte[4096];
            while (!inf.finished()) {
                int n = inf.inflate(buf);
                if (n == 0 && (inf.needsInput() || inf.needsDictionary())) {
                    break;
                }
                bos.write(buf, 0, n);
                if (bos.size() > 4_000_000) {
                    break;
                }
            }
            return bos.toString(StandardCharsets.ISO_8859_1);
        } catch (Exception e) {
            return null;
        } finally {
            inf.end();
        }
    }

    private static void text(String content, StringBuilder out) {
        Matcher m = SHOW.matcher(content);
        while (m.find()) {
            if (m.group(1) != null) {
                out.append(unescape(m.group(1)));
            } else {
                Matcher p = PART.matcher(m.group(2));
                while (p.find()) {
                    if (p.group(1) != null) {
                        out.append(unescape(p.group(1)));
                    } else if (parse(p.group(2)) < -200) {
                        out.append(' ');
                    }
                }
            }
            out.append('\n');
        }
    }

    private static double parse(String s) {
        try {
            return Double.parseDouble(s);
        } catch (NumberFormatException e) {
            return 0;
        }
    }

    private static String unescape(String s) {
        StringBuilder b = new StringBuilder();
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c == '\\' && i + 1 < s.length()) {
                char n = s.charAt(++i);
                switch (n) {
                    case 'n' -> b.append('\n');
                    case 'r' -> b.append('\r');
                    case 't' -> b.append('\t');
                    default -> b.append(n);
                }
            } else {
                b.append(c);
            }
        }
        return b.toString();
    }

    // ---- fields ----------------------------------------------------------------------------------------------------------------

    private static final Pattern LAB = Pattern.compile("(?im)^\\s*(?:test(?:ing)?\\s+)?laborator(?:y|ies)(?:\\s+name)?\\s*[:\\-]\\s*(.+?)\\s*$");
    private static final Pattern LAB_LOOSE = Pattern.compile("(?im)(?:tested at|issued by)\\s*[:\\-]?\\s*(.+?)\\s*$");
    private static final Pattern DATE_LABELLED = Pattern.compile(
        "(?im)(?:date of test|test date|tested on|date tested)\\s*[:\\-]\\s*(\\d{4}-\\d{2}-\\d{2}|\\d{1,2}[/.-]\\d{1,2}[/.-]\\d{4}|\\d{1,2} [A-Za-z]{3,9} \\d{4})");
    private static final Pattern DATE_ANY = Pattern.compile("(\\d{4}-\\d{2}-\\d{2}|\\d{1,2}[/.-]\\d{1,2}[/.-]\\d{4})");
    private static final Pattern EFF = Pattern.compile("(?im)(?:iseer|efficiency|isec)\\b[^0-9\\n]{0,30}(\\d{1,2}(?:\\.\\d{1,2})?)");
    private static final Pattern EFF_LOOSE = Pattern.compile("(?i)(\\d{1,2}\\.\\d{1,2})\\s*(?:iseer|w/w)");

    static Fields fields(String text) {
        Found lab = first(LAB, text, 0.92);
        if (lab == null) {
            lab = first(LAB_LOOSE, text, 0.6);
        }
        Found date = null;
        Matcher d = DATE_LABELLED.matcher(text);
        if (d.find() && iso(d.group(1)) != null) {
            date = new Found(iso(d.group(1)), 0.93);
        } else {
            Matcher a = DATE_ANY.matcher(text);
            if (a.find() && iso(a.group(1)) != null) {
                date = new Found(iso(a.group(1)), 0.55);
            }
        }
        Found eff = first(EFF, text, 0.92);
        if (eff == null) {
            eff = first(EFF_LOOSE, text, 0.55);
        }
        return new Fields(lab, date, eff);
    }

    private static Found first(Pattern p, String text, double confidence) {
        Matcher m = p.matcher(text);
        return m.find() ? new Found(m.group(1).trim(), confidence) : null;
    }

    private static final DateTimeFormatter[] FORMATS = {
        DateTimeFormatter.ISO_LOCAL_DATE, DateTimeFormatter.ofPattern("d/M/uuuu"), DateTimeFormatter.ofPattern("d.M.uuuu"),
        DateTimeFormatter.ofPattern("d-M-uuuu"), DateTimeFormatter.ofPattern("d MMMM uuuu", Locale.ENGLISH),
        DateTimeFormatter.ofPattern("d MMM uuuu", Locale.ENGLISH)};

    static String iso(String s) {
        for (DateTimeFormatter f : FORMATS) {
            try {
                return LocalDate.parse(s.trim(), f).toString();
            } catch (Exception ignored) {
                // try the next format
            }
        }
        return null;
    }
}
