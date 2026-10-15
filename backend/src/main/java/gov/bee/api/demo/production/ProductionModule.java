package gov.bee.api.demo.production;

import gov.bee.api.demo.DemoModule;
import gov.bee.api.demo.DemoResult;
import gov.bee.api.demo.production.ProductionValidator.CertInfo;
import gov.bee.api.demo.production.ProductionValidator.RowInput;
import gov.bee.api.demo.production.ProductionValidator.RowResult;
import gov.bee.api.identity.Caller;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.sql.Date;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * Demonstration: quarterly production submission, bulk row validation, CA evidence, review and reconciliation against QR serials.
 * Local demonstration on provisional rules, not BEE rules. CA evidence is recorded, not verified. Nothing here decides automatically:
 * a reconciliation flag is a prompt for a person.
 */
@Component
public class ProductionModule implements DemoModule {

    static final int MAX_EVIDENCE = 1024 * 1024;
    static final String EVIDENCE_LABEL = "CA evidence: recorded, not verified (local demonstration)";
    static final String NOTE = "Local demonstration: simulated, not a BEE system. Provisional rules.";
    private static final List<String> READ_ALL = List.of("programme", "admin", "auditor", "director");

    private final ObjectProvider<JdbcTemplate> jdbcProvider;
    private JdbcTemplate fixed;

    /** Resolved on first use so the web-layer tests (no database) can start the context without a JdbcTemplate. */
    @Autowired
    public ProductionModule(ObjectProvider<JdbcTemplate> jdbcProvider) {
        this.jdbcProvider = jdbcProvider;
    }

    ProductionModule(JdbcTemplate jdbc) {
        this.jdbcProvider = null;
        this.fixed = jdbc;
    }

    private JdbcTemplate jdbc() {
        return fixed != null ? fixed : jdbcProvider.getObject();
    }

    @Override
    public String name() {
        return "production";
    }

    @Override
    public DemoResult handle(Caller caller, String method, String id, String action, Map<String, String> query, Map<String, Object> body) {
        boolean get = "GET".equals(method);
        if (id == null) {
            return get ? list(caller) : create(caller, body);
        }
        UUID sid = uuid(id);
        if (sid == null) {
            return DemoResult.notFound();
        }
        Map<String, Object> sub = load(sid);
        if (sub == null || !canRead(caller, (UUID) sub.get("organisation_id"))) {
            return DemoResult.notFound();
        }
        if (get) {
            if (action == null) {
                return detail(sub);
            }
            return switch (action) {
                case "reconciliation" -> reconciliation(sub, query);
                case "evidence" -> evidence(sub, "1".equals(query.get("content")));
                default -> DemoResult.notFound();
            };
        }
        if (action == null) {
            return DemoResult.notFound();
        }
        return switch (action) {
            case "rows" -> rows(caller, sub, body);
            case "evidence" -> addEvidence(caller, sub, body);
            case "submit" -> submit(caller, sub);
            case "review" -> review(caller, sub, body);
            default -> DemoResult.notFound();
        };
    }

    // ---------------------------------------------------------------- who

    private static boolean seesAll(Caller c) {
        return READ_ALL.stream().anyMatch(r -> c.holds(r, "all"));
    }

    private static boolean canRead(Caller c, UUID org) {
        return seesAll(c) || c.organisationIds().contains(org);
    }

    private static boolean submitter(Caller c) {
        return c.holds("manufacturer", "own-org") || c.holds("agency", "own-org");
    }

    private static String submitterRole(Caller c) {
        return c.holds("manufacturer", "own-org") ? "manufacturer" : "agency";
    }

    private static boolean reviewer(Caller c) {
        return c.holds("programme", "all") || c.holds("admin", "all");
    }

    private static boolean canEdit(Caller c, Map<String, Object> sub) {
        return submitter(c) && c.organisationIds().contains((UUID) sub.get("organisation_id"));
    }

    private static UUID uuid(String s) {
        try {
            return UUID.fromString(s);
        } catch (IllegalArgumentException e) {
            return null;
        }
    }

    // ---------------------------------------------------------------- reads

    private Map<String, Object> load(UUID id) {
        try {
            return jdbc().queryForMap("SELECT * FROM production_submission WHERE id = ?", id);
        } catch (EmptyResultDataAccessException e) {
            return null;
        }
    }

    private Map<String, Object> summary(Map<String, Object> s) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", String.valueOf(s.get("id")));
        m.put("organisationId", String.valueOf(s.get("organisation_id")));
        m.put("quarter", s.get("quarter"));
        m.put("state", s.get("state"));
        m.put("version", s.get("version"));
        m.put("reviewNote", s.get("review_note"));
        m.put("submittedAt", ts(s.get("submitted_at")));
        m.put("reviewedAt", ts(s.get("reviewed_at")));
        m.put("createdAt", ts(s.get("created_at")));
        return m;
    }

    private static String ts(Object o) {
        return o == null ? null : ((java.sql.Timestamp) o).toInstant().toString();
    }

    private DemoResult list(Caller caller) {
        if (!seesAll(caller) && !submitter(caller)) {
            return DemoResult.denied();
        }
        String sql = "SELECT s.*, o.legal_name AS org_name, (SELECT count(*) FROM production_row r WHERE r.submission_id = s.id) AS row_count, "
            + "(SELECT coalesce(sum(r.units), 0) FROM production_row r WHERE r.submission_id = s.id) AS total_units, "
            + "(SELECT count(*) FROM production_evidence e WHERE e.submission_id = s.id) AS evidence_count "
            + "FROM production_submission s JOIN organisation o ON o.id = s.organisation_id ";
        List<Map<String, Object>> found = seesAll(caller)
            ? jdbc().queryForList(sql + "ORDER BY s.quarter DESC, o.legal_name")
            : jdbc().query(sql + "WHERE s.organisation_id = ANY (?) ORDER BY s.quarter DESC",
                ps -> ps.setArray(1, ps.getConnection().createArrayOf("uuid", caller.organisationIds().toArray())), (rs, i) -> {
                    Map<String, Object> m = new LinkedHashMap<>();
                    for (String c : List.of("id", "organisation_id", "quarter", "state", "version", "review_note", "submitted_at", "reviewed_at",
                        "created_at", "org_name", "row_count", "total_units", "evidence_count")) {
                        m.put(c, rs.getObject(c));
                    }
                    return m;
                });
        List<Map<String, Object>> items = new ArrayList<>();
        for (Map<String, Object> s : found) {
            Map<String, Object> m = summary(s);
            m.put("organisationName", s.get("org_name"));
            m.put("rowCount", s.get("row_count"));
            m.put("totalUnits", s.get("total_units"));
            m.put("evidenceCount", s.get("evidence_count"));
            items.add(m);
        }
        return DemoResult.ok(Map.of("submissions", items, "canCreate", submitter(caller), "canReview", reviewer(caller), "note", NOTE));
    }

    private DemoResult detail(Map<String, Object> sub) {
        UUID id = (UUID) sub.get("id");
        Map<String, Object> out = summary(sub);
        out.put("organisationName", jdbc().queryForObject("SELECT legal_name FROM organisation WHERE id = ?", String.class, sub.get("organisation_id")));
        out.put("rows", jdbc().queryForList(
            "SELECT r.id::text AS id, r.registration_id AS \"registrationId\", m.model_number AS \"modelNumber\", m.brand_name AS \"brandName\", r.units, "
                + "r.period_start::text AS \"periodStart\", r.period_end::text AS \"periodEnd\" FROM production_row r "
                + "JOIN model_application m ON m.id = r.model_application_id WHERE r.submission_id = ? ORDER BY m.model_number, r.period_start", id));
        out.put("evidence", evidenceList(id, false));
        out.put("events", jdbc().queryForList(
            "SELECT e.action, e.from_state AS \"fromState\", e.to_state AS \"toState\", u.username AS actor, e.actor_role AS \"actorRole\", e.note, "
                + "e.occurred_at::text AS \"occurredAt\" FROM production_event e JOIN user_account u ON u.id = e.actor_account_id "
                + "WHERE e.submission_id = ? ORDER BY e.occurred_at, e.id", id));
        out.put("note", NOTE);
        out.put("evidenceLabel", EVIDENCE_LABEL);
        return DemoResult.ok(out);
    }

    private List<Map<String, Object>> evidenceList(UUID id, boolean withContent) {
        List<Map<String, Object>> list = jdbc().queryForList(
            "SELECT e.id::text AS id, e.file_name AS \"fileName\", e.media_type AS \"mediaType\", e.size_bytes AS \"sizeBytes\", e.sha256, "
                + "e.ca_name AS \"caName\", e.ca_membership_no AS \"caMembershipNo\", e.statement, u.username AS \"uploadedBy\", "
                + "e.uploaded_at::text AS \"uploadedAt\", e.content FROM production_evidence e JOIN user_account u ON u.id = e.uploaded_by "
                + "WHERE e.submission_id = ? ORDER BY e.uploaded_at, e.id", id);
        for (Map<String, Object> m : list) {
            byte[] content = (byte[]) m.remove("content");
            if (withContent) {
                m.put("contentBase64", Base64.getEncoder().encodeToString(content));
            }
            m.put("label", EVIDENCE_LABEL);
        }
        return list;
    }

    private DemoResult evidence(Map<String, Object> sub, boolean withContent) {
        return DemoResult.ok(Map.of("evidence", evidenceList((UUID) sub.get("id"), withContent), "label", EVIDENCE_LABEL));
    }

    private DemoResult reconciliation(Map<String, Object> sub, Map<String, String> query) {
        UUID id = (UUID) sub.get("id");
        double margin = jdbc().query("SELECT value FROM production_setting WHERE key = 'reconciliation_margin_percent'",
            (rs, i) -> rs.getDouble(1)).stream().findFirst().orElse(10.0);
        String m = query.get("margin");
        if (m != null) {
            try {
                double v = Double.parseDouble(m);
                if (v < 0 || v > 1000) {
                    return DemoResult.invalid("margin must be between 0 and 1000 percent.");
                }
                margin = v;
            } catch (NumberFormatException e) {
                return DemoResult.invalid("margin must be a number.");
            }
        }
        boolean qr = Boolean.TRUE.equals(jdbc().queryForObject("SELECT to_regclass('qr_serial') IS NOT NULL AND to_regclass('qr_batch') IS NOT NULL", Boolean.class));
        List<Map<String, Object>> declared = jdbc().queryForList(
            "SELECT r.model_application_id AS mid, m.model_number AS \"modelNumber\", min(r.registration_id) AS \"registrationId\", sum(r.units) AS declared "
                + "FROM production_row r JOIN model_application m ON m.id = r.model_application_id WHERE r.submission_id = ? "
                + "GROUP BY r.model_application_id, m.model_number ORDER BY m.model_number", id);
        Map<UUID, Long> bound = new LinkedHashMap<>();
        if (qr) {
            jdbc().query("SELECT b.model_application_id AS mid, count(*) AS n FROM qr_serial s JOIN qr_batch b ON b.id = s.batch_id "
                + "WHERE s.state = 'bound' GROUP BY b.model_application_id", rs -> {
                    bound.put(rs.getObject("mid", UUID.class), rs.getLong("n"));
                });
        }
        long declaredTotal = 0;
        long boundTotal = 0;
        List<Map<String, Object>> models = new ArrayList<>();
        for (Map<String, Object> d : declared) {
            long units = ((Number) d.get("declared")).longValue();
            declaredTotal += units;
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("modelApplicationId", String.valueOf(d.get("mid")));
            row.put("modelNumber", d.get("modelNumber"));
            row.put("registrationId", d.get("registrationId"));
            row.put("declaredUnits", units);
            if (qr) {
                long b = bound.getOrDefault((UUID) d.get("mid"), 0L);
                boundTotal += b;
                row.put("boundSerials", b);
                row.put("flag", units > b * (1 + margin / 100.0) ? "review" : "ok");
            } else {
                row.put("boundSerials", null);
                row.put("flag", "unavailable");
            }
            models.add(row);
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("quarter", sub.get("quarter"));
        out.put("qrAvailable", qr);
        out.put("marginPercent", margin);
        out.put("declaredTotal", declaredTotal);
        out.put("boundTotal", qr ? boundTotal : null);
        out.put("models", models);
        out.put("message", qr
            ? "A 'review' flag only means declared units exceed bound QR serials by more than " + margin
                + " percent. It is a prompt for a person, not a decision. Serials are counted over all time (simulated QR data)."
            : "QR data not available");
        return DemoResult.ok(out);
    }

    // ---------------------------------------------------------------- writes

    private void event(UUID sub, String action, String from, String to, Caller c, String role, String note) {
        jdbc().update("INSERT INTO production_event (submission_id, action, from_state, to_state, actor_account_id, actor_role, note) VALUES (?,?,?,?,?,?,?)",
            sub, action, from, to, c.accountId(), role, note);
    }

    private DemoResult create(Caller caller, Map<String, Object> body) {
        if (!submitter(caller)) {
            return DemoResult.denied();
        }
        String quarter = text(body.get("quarter"));
        if (ProductionValidator.quarterRange(quarter) == null) {
            return DemoResult.invalid("quarter must look like 2026-Q3.");
        }
        UUID org;
        if (body.get("organisationId") != null) {
            org = uuid(text(body.get("organisationId")));
            if (org == null || !caller.organisationIds().contains(org)) {
                return DemoResult.denied();
            }
        } else if (caller.organisationIds().size() == 1) {
            org = caller.organisationIds().iterator().next();
        } else {
            return DemoResult.invalid("organisationId is required when you belong to more than one organisation.");
        }
        if (Boolean.TRUE.equals(jdbc().queryForObject("SELECT EXISTS (SELECT 1 FROM production_submission WHERE organisation_id = ? AND quarter = ?)",
            Boolean.class, org, quarter))) {
            return DemoResult.error(HttpStatus.CONFLICT, "version_conflict", "There is already a submission for " + quarter + ".");
        }
        UUID id;
        try {
            id = jdbc().queryForObject("INSERT INTO production_submission (organisation_id, quarter, created_by) VALUES (?,?,?) RETURNING id",
                UUID.class, org, quarter, caller.accountId());
        } catch (DuplicateKeyException e) {
            return DemoResult.error(HttpStatus.CONFLICT, "version_conflict", "There is already a submission for " + quarter + ".");
        }
        event(id, "created", null, "draft", caller, submitterRole(caller), null);
        return DemoResult.created(summary(load(id)));
    }

    private static String text(Object o) {
        return o == null ? null : String.valueOf(o).trim();
    }

    private DemoResult denyEdit(Caller caller, Map<String, Object> sub) {
        if (!canEdit(caller, sub)) {
            return DemoResult.denied();
        }
        String s = (String) sub.get("state");
        if (!s.equals("draft") && !s.equals("query")) {
            return DemoResult.error(HttpStatus.CONFLICT, "version_conflict", "This submission is " + s + " and can no longer be edited.");
        }
        return null;
    }

    @SuppressWarnings("unchecked")
    private DemoResult rows(Caller caller, Map<String, Object> sub, Map<String, Object> body) {
        DemoResult denied = denyEdit(caller, sub);
        if (denied != null) {
            return denied;
        }
        List<RowInput> inputs = new ArrayList<>();
        boolean single = false;
        if (body.get("csv") != null) {
            ProductionValidator.Parsed p = ProductionValidator.parseCsv(String.valueOf(body.get("csv")));
            if (p.error() != null) {
                return DemoResult.invalid(p.error());
            }
            inputs.addAll(p.rows());
        } else if (body.get("rows") instanceof List<?> list) {
            int line = 1;
            for (Object o : list) {
                line++;
                if (!(o instanceof Map<?, ?> r)) {
                    return DemoResult.invalid("rows must be a list of objects.");
                }
                inputs.add(rowOf(line, (Map<String, Object>) r));
            }
            if (inputs.size() > ProductionValidator.MAX_ROWS) {
                return DemoResult.invalid("At most " + ProductionValidator.MAX_ROWS + " rows can be checked at once.");
            }
        } else if (body.get("registration_id") != null || body.get("registrationId") != null) {
            inputs.add(rowOf(1, body));
            single = true;
        }
        if (inputs.isEmpty()) {
            return DemoResult.invalid("Send csv, rows, or a single row (registration_id, units, period_start, period_end).");
        }
        boolean commit = body.get("commit") instanceof Boolean b ? b : single;
        UUID sid = (UUID) sub.get("id");
        UUID org = (UUID) sub.get("organisation_id");
        Set<String> existing = new HashSet<>();
        jdbc().query("SELECT model_application_id, period_start, period_end FROM production_row WHERE submission_id = ?", rs -> {
            Date a = rs.getDate(2);
            Date b = rs.getDate(3);
            existing.add(ProductionValidator.key(rs.getObject(1, UUID.class), a == null ? LocalDate.EPOCH : a.toLocalDate(),
                b == null ? LocalDate.EPOCH : b.toLocalDate()));
        }, sid);
        List<RowResult> results = ProductionValidator.validate(inputs, (String) sub.get("quarter"), org, this::cert, existing);
        long bad = results.stream().filter(r -> !r.ok()).count();
        boolean stored = commit && bad == 0;
        if (stored) {
            for (RowResult r : results) {
                jdbc().update("INSERT INTO production_row (submission_id, model_application_id, units, period_start, period_end, registration_id) VALUES (?,?,?,?,?,?)",
                    sid, r.modelId(), r.units(), r.periodStart(), r.periodEnd(), r.registrationId());
            }
            event(sid, "rows_added", null, null, caller, submitterRole(caller), results.size() + " row(s)");
        }
        List<Map<String, Object>> table = new ArrayList<>();
        for (RowResult r : results) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("line", r.line());
            m.put("ok", r.ok());
            m.put("message", r.message());
            m.put("registrationId", r.registrationId());
            table.add(m);
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("mode", commit ? "commit" : "dry_run");
        out.put("committed", stored);
        out.put("stored", stored ? results.size() : 0);
        out.put("rowCount", results.size());
        out.put("errorCount", bad);
        out.put("message", !commit ? (bad == 0 ? "Dry run: every row is valid; nothing was written." : "Dry run: " + bad + " row(s) have errors; nothing was written.")
            : stored ? results.size() + " row(s) stored." : "Nothing stored: " + bad + " row(s) have errors (all or nothing).");
        out.put("results", table);
        return DemoResult.ok(out);
    }

    private static RowInput rowOf(int line, Map<String, Object> r) {
        return new RowInput(line, text(first(r, "registration_id", "registrationId")), text(r.get("units")),
            text(first(r, "period_start", "periodStart")), text(first(r, "period_end", "periodEnd")));
    }

    private static Object first(Map<String, Object> m, String a, String b) {
        return m.get(a) != null ? m.get(a) : m.get(b);
    }

    private CertInfo cert(String registrationId) {
        return jdbc().query("SELECT m.id, m.organisation_id, m.state FROM certificate c JOIN model_application m ON m.id = c.application_id "
            + "WHERE c.registration_id = ?", (rs, i) -> new CertInfo(rs.getObject(1, UUID.class), rs.getObject(2, UUID.class),
            "approved".equals(rs.getString(3))), registrationId).stream().findFirst().orElse(null);
    }

    private DemoResult addEvidence(Caller caller, Map<String, Object> sub, Map<String, Object> body) {
        DemoResult denied = denyEdit(caller, sub);
        if (denied != null) {
            return denied;
        }
        String fileName = text(body.get("fileName"));
        String mediaType = text(body.get("mediaType"));
        String caName = text(body.get("caName"));
        String caNo = text(body.get("caMembershipNo"));
        String statement = text(body.get("statement"));
        if (fileName == null || fileName.isEmpty() || fileName.length() > 200 || fileName.matches(".*[/\\\\\\p{Cntrl}].*")) {
            return DemoResult.invalid("fileName is required (up to 200 characters, no slashes).");
        }
        if (mediaType == null || !mediaType.toLowerCase().matches("^[a-z]+/[a-z0-9.+-]+$") || mediaType.length() > 100) {
            return DemoResult.invalid("mediaType must look like application/pdf.");
        }
        if (caName == null || caName.isEmpty() || caName.length() > 200 || caNo == null || caNo.isEmpty() || caNo.length() > 60
            || statement == null || statement.isEmpty() || statement.length() > 2000) {
            return DemoResult.invalid("caName, caMembershipNo and statement are required.");
        }
        if (!(body.get("contentBase64") instanceof String b64) || b64.isBlank()) {
            return DemoResult.invalid("contentBase64 is required.");
        }
        byte[] content;
        try {
            content = Base64.getMimeDecoder().decode(b64.trim());
        } catch (IllegalArgumentException e) {
            return DemoResult.invalid("contentBase64 is not valid base64.");
        }
        if (content.length == 0 || content.length > MAX_EVIDENCE) {
            return DemoResult.invalid("The file must be between 1 byte and 1 MiB.");
        }
        String sha = sha256(content);
        UUID sid = (UUID) sub.get("id");
        UUID eid = jdbc().queryForObject("INSERT INTO production_evidence (submission_id, file_name, media_type, size_bytes, sha256, content, ca_name, "
            + "ca_membership_no, statement, uploaded_by) VALUES (?,?,?,?,?,?,?,?,?,?) RETURNING id", UUID.class,
            sid, fileName, mediaType.toLowerCase(), content.length, sha, content, caName, caNo, statement, caller.accountId());
        event(sid, "evidence_added", null, null, caller, submitterRole(caller), fileName + " sha256 " + sha);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("id", String.valueOf(eid));
        out.put("fileName", fileName);
        out.put("sizeBytes", content.length);
        out.put("sha256", sha);
        out.put("label", EVIDENCE_LABEL);
        return DemoResult.created(out);
    }

    static String sha256(byte[] content) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(content));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    private int move(UUID sid, String from, String to, Caller c, boolean review, String note) {
        return review
            ? jdbc().update("UPDATE production_submission SET state = ?, version = version + 1, reviewed_by = ?, reviewed_at = now(), review_note = ? WHERE id = ? AND state = ?",
                to, c.accountId(), note, sid, from)
            : jdbc().update("UPDATE production_submission SET state = ?, version = version + 1, submitted_by = ?, submitted_at = now() WHERE id = ? AND state = ?",
                to, c.accountId(), sid, from);
    }

    private DemoResult submit(Caller caller, Map<String, Object> sub) {
        DemoResult denied = denyEdit(caller, sub);
        if (denied != null) {
            return denied;
        }
        UUID sid = (UUID) sub.get("id");
        int rows = jdbc().queryForObject("SELECT count(*) FROM production_row WHERE submission_id = ?", Integer.class, sid);
        int ev = jdbc().queryForObject("SELECT count(*) FROM production_evidence WHERE submission_id = ?", Integer.class, sid);
        if (rows < 1 || ev < 1) {
            return DemoResult.invalid("Add at least one row and the CA evidence before submitting.");
        }
        String from = (String) sub.get("state");
        if (move(sid, from, "submitted", caller, false, null) != 1) {
            return DemoResult.error(HttpStatus.CONFLICT, "version_conflict", "The submission changed; reload it.");
        }
        event(sid, "submitted", from, "submitted", caller, submitterRole(caller), rows + " row(s)");
        return DemoResult.ok(summary(load(sid)));
    }

    private DemoResult review(Caller caller, Map<String, Object> sub, Map<String, Object> body) {
        if (!reviewer(caller)) {
            return DemoResult.denied();
        }
        UUID sid = (UUID) sub.get("id");
        UUID submittedBy = (UUID) sub.get("submitted_by");
        if (caller.organisationIds().contains((UUID) sub.get("organisation_id"))
            || (submittedBy != null && caller.actingIdentities().contains(submittedBy))) {
            return DemoResult.error(HttpStatus.FORBIDDEN, "segregation_refused", "The person who submitted, or their organisation, cannot review.");
        }
        String decision = text(body.get("decision"));
        String note = text(body.get("note"));
        if (!"accepted".equals(decision) && !"query".equals(decision)) {
            return DemoResult.invalid("decision must be accepted or query.");
        }
        if ("query".equals(decision) && (note == null || note.isEmpty())) {
            return DemoResult.invalid("A query needs a note.");
        }
        if (note != null && note.length() > 1000) {
            return DemoResult.invalid("The note is at most 1000 characters.");
        }
        if (!"submitted".equals(sub.get("state"))) {
            return DemoResult.error(HttpStatus.CONFLICT, "version_conflict", "Only a submitted submission can be reviewed.");
        }
        if (move(sid, "submitted", decision, caller, true, note) != 1) {
            return DemoResult.error(HttpStatus.CONFLICT, "version_conflict", "The submission changed; reload it.");
        }
        event(sid, "review_" + decision, "submitted", decision, caller, caller.holds("programme", "all") ? "programme" : "admin", note);
        return DemoResult.ok(summary(load(sid)));
    }
}
