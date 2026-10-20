package gov.bee.api.demo.manufacturers;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.math.BigDecimal;
import java.sql.Timestamp;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/** Reads the manufacturer profile from the database (read only): the runtime login has SELECT on these tables. */
@Repository
public class ManufacturerDirectoryRepository {

    private static final ZoneId IST = ZoneId.of("Asia/Kolkata");
    private static final DateTimeFormatter DAY = DateTimeFormatter.ofPattern("dd MMM yyyy", Locale.ENGLISH);
    private static final ObjectMapper JSON = new ObjectMapper();

    private final ObjectProvider<JdbcTemplate> provider;

    public ManufacturerDirectoryRepository(ObjectProvider<JdbcTemplate> provider) {
        this.provider = provider;
    }

    private static String day(Object ts) {
        if (ts == null) {
            return null;
        }
        if (ts instanceof Timestamp t) {
            return t.toInstant().atZone(IST).toLocalDate().format(DAY);
        }
        if (ts instanceof java.sql.Date d) {
            return d.toLocalDate().format(DAY);
        }
        return ts.toString();
    }

    private static String text(JsonNode n, String field) {
        JsonNode v = n == null ? null : n.get(field);
        return v == null || v.isNull() || v.asText().isBlank() ? null : v.asText();
    }

    private static Map<String, Object> map(Object... kv) {
        Map<String, Object> m = new LinkedHashMap<>();
        for (int i = 0; i < kv.length; i += 2) {
            m.put((String) kv[i], kv[i + 1]);
        }
        return m;
    }

    private <T> Map<UUID, List<T>> grouped(String sql, String key, Function<Map<String, Object>, T> row, Object... args) {
        Map<UUID, List<T>> out = new LinkedHashMap<>();
        for (Map<String, Object> r : provider.getObject().queryForList(sql, args)) {
            out.computeIfAbsent((UUID) r.get(key), k -> new ArrayList<>()).add(row.apply(r));
        }
        return out;
    }

    /** Every manufacturer organisation (or just {@code only}) with its profile. */
    public List<Map<String, Object>> manufacturers(UUID only) {
        JdbcTemplate jdbc = provider.getObject();
        String scope = only == null ? "" : " AND o.id = '" + only + "'";
        List<Map<String, Object>> orgs = jdbc.queryForList("SELECT o.id, o.code, o.legal_name FROM organisation o WHERE o.kind = 'manufacturer'" + scope + " ORDER BY o.legal_name");

        Map<UUID, Map<String, Object>> apps = new LinkedHashMap<>();
        for (Map<String, Object> a : jdbc.queryForList(
            "SELECT a.id, a.reference, a.organisation_id, a.legal_name, a.state, a.draft_payload::text AS draft, a.created_at, pa.permittee_number, pa.activated_at, ob.started_on, ob.ends_on "
                + "FROM manufacturer_onboarding_application a LEFT JOIN manufacturer_onboarding_permittee_activation pa ON pa.application_id = a.id "
                + "LEFT JOIN manufacturer_onboarding_observation ob ON ob.application_id = a.id WHERE a.state <> 'draft' ORDER BY a.created_at")) {
            apps.put((UUID) a.get("organisation_id"), a);
        }
        Map<UUID, List<Map<String, Object>>> anomalies = grouped(
            "SELECT application_id, raised_by_role, reason, raised_at, resolved_at, resolution FROM manufacturer_onboarding_anomaly ORDER BY raised_at",
            "application_id", r -> map("date", day(r.get("raised_at")), "raisedBy", r.get("raised_by_role"), "summary", r.get("reason"),
                "status", r.get("resolved_at") == null ? "Open" : "revoked".equals(r.get("resolution")) ? "Revoked" : "Cleared"));
        Map<UUID, List<Map<String, Object>>> documents = grouped(
            "SELECT application_id, document_kind, created_at FROM manufacturer_onboarding_document ORDER BY created_at",
            "application_id", r -> map("name", label((String) r.get("document_kind")), "status", "Verified", "date", day(r.get("created_at"))));
        Map<UUID, List<Map<String, Object>>> events = grouped(
            "SELECT application_id, event_kind, detail, occurred_at, actor_role FROM manufacturer_onboarding_event ORDER BY occurred_at DESC",
            "application_id", r -> map("date", day(r.get("occurred_at")), "title", label((String) r.get("event_kind")),
                "detail", r.get("detail") == null ? "" : r.get("detail")));
        Map<UUID, List<Map<String, Object>>> onboardingPay = grouped(
            "SELECT l.application_id, p.receipt_number, p.amount_inr, p.status, p.settled_at, p.created_at FROM manufacturer_onboarding_payment_link l JOIN payment p ON p.id = l.payment_id",
            "application_id", r -> map("receipt", r.get("receipt_number"), "date", day(r.get("settled_at") != null ? r.get("settled_at") : r.get("created_at")),
                "purpose", "Company registration fee", "amount", r.get("amount_inr"), "status", "paid".equals(r.get("status")) ? "Verified" : "failed".equals(r.get("status")) ? "Failed" : "Pending"));

        Map<UUID, List<Map<String, Object>>> brands = grouped(
            "SELECT b.id, b.owner_organisation_id AS org, b.name, b.status, b.note, "
                + "(SELECT e.reason FROM register_status_event e WHERE e.brand_id = b.id AND e.to_status = b.status ORDER BY e.occurred_at DESC LIMIT 1) AS event_reason, "
                + "(SELECT e.occurred_at FROM register_status_event e WHERE e.brand_id = b.id AND e.to_status = b.status ORDER BY e.occurred_at DESC LIMIT 1) AS event_at, "
                + "b.recorded_at, (SELECT count(*) FROM agency_authorisation a WHERE a.brand_id = b.id) AS authorisations FROM brand b ORDER BY b.name",
            "org", r -> {
                String status = (String) r.get("status");
                boolean held = "suspended".equals(status) || "revoked".equals(status);
                Object reason = !held ? null : r.get("event_reason") != null ? r.get("event_reason") : r.get("note");
                return map("id", r.get("id").toString(), "name", r.get("name"), "status", status, "reason", reason, "changedOn", day(r.get("event_at")), "registeredOn", day(r.get("recorded_at")),
                    "authorisations", ((Number) r.get("authorisations")).intValue());
            });
        Map<UUID, List<Map<String, Object>>> models = grouped(
            "SELECT m.organisation_id AS org, m.reference, m.model_number, m.category, m.state, m.brand_id, m.brand_name, "
                + "COALESCE((SELECT r.stars FROM model_application_rating r WHERE r.application_id = m.id ORDER BY r.rating_version DESC LIMIT 1), c.stars) AS stars, "
                + "c.registration_id AS certificate, c.valid_to FROM model_application m LEFT JOIN certificate c ON c.application_id = m.id "
                + "WHERE m.state <> 'draft' ORDER BY m.created_at DESC",
            "org", r -> map("reference", r.get("reference"), "model", r.get("model_number"), "category", r.get("category"),
                "brandId", r.get("brand_id") == null ? null : r.get("brand_id").toString(), "brandName", r.get("brand_name"),
                "stars", r.get("stars") == null ? 0 : ((Number) r.get("stars")).intValue(), "status", modelStatus((String) r.get("state")),
                "certificate", r.get("certificate") == null ? "Not issued" : r.get("certificate"), "validTo", day(r.get("valid_to"))));
        Map<UUID, List<Map<String, Object>>> payments = grouped(
            "SELECT p.organisation_id AS org, p.receipt_number, p.amount_inr, p.status, p.created_at, p.settled_at, m.reference FROM payment p "
                + "LEFT JOIN model_application m ON m.id = p.application_id ORDER BY p.created_at DESC",
            "org", r -> map("receipt", r.get("receipt_number") == null ? "-" : r.get("receipt_number"), "date", day(r.get("settled_at") != null ? r.get("settled_at") : r.get("created_at")),
                "purpose", r.get("reference") == null ? "Fee" : "Model application fee " + r.get("reference"), "amount", r.get("amount_inr"),
                "status", "paid".equals(r.get("status")) ? "Verified" : "failed".equals(r.get("status")) ? "Failed" : "Pending"));
        Map<UUID, Map<String, Object>> qr = new LinkedHashMap<>();
        for (Map<String, Object> r : jdbc.queryForList(
            "SELECT b.organisation_id AS org, count(s.serial) AS issued, count(*) FILTER (WHERE s.state = 'bound') AS bound, count(*) FILTER (WHERE s.state = 'allocated') AS unused "
                + "FROM qr_batch b JOIN qr_serial s ON s.batch_id = b.id GROUP BY b.organisation_id")) {
            qr.put((UUID) r.get("org"), map("issued", r.get("issued"), "bound", r.get("bound"), "unused", r.get("unused")));
        }
        Map<UUID, List<Map<String, Object>>> production = grouped(
            "SELECT s.organisation_id AS org, s.quarter, s.state, coalesce(sum(r.units), 0) AS units FROM production_submission s "
                + "LEFT JOIN production_row r ON r.submission_id = s.id GROUP BY s.organisation_id, s.quarter, s.state ORDER BY s.quarter",
            "org", r -> map("period", r.get("quarter"), "declared", ((Number) r.get("units")).longValue(), "state", r.get("state")));

        List<Map<String, Object>> out = new ArrayList<>();
        for (Map<String, Object> o : orgs) {
            UUID id = (UUID) o.get("id");
            Map<String, Object> app = apps.get(id);
            JsonNode draft = null;
            try {
                draft = app == null || app.get("draft") == null ? null : JSON.readTree((String) app.get("draft"));
            } catch (Exception ignored) {
                // an unreadable draft leaves the company fields empty
            }
            List<Map<String, Object>> myBrands = brands.getOrDefault(id, List.of());
            List<Map<String, Object>> myModels = models.getOrDefault(id, List.of());
            UUID appId = app == null ? null : (UUID) app.get("id");
            String name = app != null && app.get("legal_name") != null ? (String) app.get("legal_name") : plainName((String) o.get("legal_name"));
            String status = status(app, myBrands);

            JsonNode addr = draft == null ? null : draft.get("registeredAddress");
            JsonNode sig = draft == null ? null : draft.get("authorisedSignatory");
            List<Map<String, Object>> facilities = new ArrayList<>();
            if (draft != null && draft.get("facilities") != null) {
                for (JsonNode f : draft.get("facilities")) {
                    facilities.add(map("name", text(f, "name") == null ? "Facility" : text(f, "name"),
                        "location", String.join(", ", java.util.stream.Stream.of(text(f, "city"), text(f, "state")).filter(java.util.Objects::nonNull).toList()),
                        "capacity", "-"));
                }
            }
            List<Map<String, Object>> pays = new ArrayList<>(appId == null ? List.of() : onboardingPay.getOrDefault(appId, List.of()));
            pays.addAll(payments.getOrDefault(id, List.of()));
            BigDecimal paid = BigDecimal.ZERO;
            BigDecimal outstanding = BigDecimal.ZERO;
            for (Map<String, Object> p : pays) {
                BigDecimal amount = p.get("amount") == null ? BigDecimal.ZERO : (BigDecimal) p.get("amount");
                if ("Verified".equals(p.get("status"))) {
                    paid = paid.add(amount);
                } else if ("Pending".equals(p.get("status"))) {
                    outstanding = outstanding.add(amount); // a failed attempt is not a fee due
                }
            }
            Object obsStart = app == null ? null : app.get("started_on");
            Object obsEnd = app == null ? null : app.get("ends_on");
            Map<String, Object> observation = null;
            if (obsStart != null && obsEnd != null) {
                LocalDate end = ((java.sql.Date) obsEnd).toLocalDate();
                observation = map("start", day(obsStart), "end", day(obsEnd), "daysLeft", Math.max(0, ChronoUnit.DAYS.between(LocalDate.now(IST), end)));
            }
            List<String> categories = myModels.stream().map(m -> (String) m.get("category")).distinct().collect(Collectors.toList());
            if (categories.isEmpty()) {
                categories = List.of("RAC"); // the programme covers room air conditioners (RAC); a manufacturer with no model yet is listed under it
            }
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", id.toString());
            m.put("code", o.get("code"));
            m.put("name", name);
            m.put("status", status);
            m.put("state", addr == null ? null : text(addr, "state"));
            m.put("city", addr == null ? null : text(addr, "city"));
            m.put("categories", categories);
            m.put("since", app == null || app.get("activated_at") == null ? null : day(app.get("activated_at")));
            m.put("permitteeNumber", app == null ? null : app.get("permittee_number"));
            m.put("applicationId", appId == null ? null : appId.toString());
            m.put("applicationReference", app == null ? null : app.get("reference"));
            m.put("applicationState", app == null ? null : app.get("state"));
            m.put("cin", draft == null ? null : text(draft, "cin"));
            m.put("gstin", draft == null ? null : text(draft, "gstin"));
            m.put("address", addr == null ? null : String.join(", ", java.util.stream.Stream.of(text(addr, "line1"), text(addr, "line2"), text(addr, "city"), text(addr, "state"), text(addr, "pincode")).filter(java.util.Objects::nonNull).toList()));
            m.put("signatory", map("name", text(sig, "name"), "designation", text(sig, "designation"), "email", text(sig, "email"), "phone", text(sig, "phone")));
            m.put("facilities", facilities);
            m.put("brands", myBrands);
            m.put("models", myModels);
            m.put("fees", map("paid", paid, "outstanding", outstanding, "payments", pays));
            m.put("qr", qr.getOrDefault(id, map("issued", 0, "bound", 0, "unused", 0)));
            m.put("production", production.getOrDefault(id, List.of()));
            m.put("documents", appId == null ? List.of() : documents.getOrDefault(appId, List.of()));
            m.put("observation", observation);
            m.put("anomalies", appId == null ? List.of() : anomalies.getOrDefault(appId, List.of()));
            m.put("flags", flags(myBrands, appId == null ? List.of() : anomalies.getOrDefault(appId, List.of()), qr.get(id)));
            m.put("timeline", timeline(appId == null ? List.of() : events.getOrDefault(appId, List.of()), myBrands));
            out.add(m);
        }
        out.sort(Comparator.comparing((Map<String, Object> x) -> (String) x.get("name"), String.CASE_INSENSITIVE_ORDER));
        return out;
    }

    private static String plainName(String legal) {
        return legal == null ? "" : legal.replaceAll("\\s*\\((synthetic[^)]*|not yet permittee)\\)\\s*$", "").trim();
    }

    private static String status(Map<String, Object> app, List<Map<String, Object>> brands) {
        String state = app == null ? null : (String) app.get("state");
        if (state != null) {
            switch (state) {
                case "on_hold": return "On hold";
                case "revoked": return "Revoked";
                case "active_observation": return "Under observation";
                case "director_review": case "submitted": case "automatic_checks_failed": case "returned": return "Registration pending";
                default: break;
            }
        }
        long suspended = brands.stream().filter(b -> "suspended".equals(b.get("status"))).count();
        long revoked = brands.stream().filter(b -> "revoked".equals(b.get("status"))).count();
        if (!brands.isEmpty() && revoked == brands.size()) {
            return "Revoked";
        }
        if (suspended > 0) {
            return "Suspended";
        }
        return "Compliant";
    }

    private static String modelStatus(String state) {
        return switch (state) {
            case "approved" -> "Approved";
            case "rejected" -> "Rejected";
            case "returned" -> "Returned";
            default -> "Under review";
        };
    }

    private static String label(String code) {
        if (code == null) {
            return "";
        }
        String s = code.replace('_', ' ');
        return s.substring(0, 1).toUpperCase(Locale.ENGLISH) + s.substring(1);
    }

    private static List<Map<String, Object>> flags(List<Map<String, Object>> brands, List<Map<String, Object>> anomalies, Map<String, Object> qr) {
        List<Map<String, Object>> out = new ArrayList<>();
        for (Map<String, Object> b : brands) {
            String st = (String) b.get("status");
            if ("suspended".equals(st) || "revoked".equals(st)) {
                out.add(map("level", "Attention", "label", "Brand " + b.get("name") + " is " + st, "detail", b.get("reason") == null ? "No reason recorded." : b.get("reason")));
            }
        }
        for (Map<String, Object> a : anomalies) {
            if ("Open".equals(a.get("status"))) {
                out.add(map("level", "Attention", "label", "Open anomaly", "detail", a.get("summary")));
            }
        }
        if (qr != null && ((Number) qr.get("issued")).longValue() > 0 && ((Number) qr.get("unused")).longValue() * 3 > ((Number) qr.get("issued")).longValue()) {
            out.add(map("level", "Watch", "label", "Many QR serials unused", "detail", qr.get("unused") + " of " + qr.get("issued") + " serials issued are not yet bound to a product."));
        }
        return out;
    }

    private static List<Map<String, Object>> timeline(List<Map<String, Object>> events, List<Map<String, Object>> brands) {
        List<Map<String, Object>> out = new ArrayList<>(events);
        for (Map<String, Object> b : brands) {
            String st = (String) b.get("status");
            if ("suspended".equals(st) || "revoked".equals(st)) {
                out.add(0, map("date", b.get("changedOn") == null ? "-" : b.get("changedOn"), "title", "Brand " + b.get("name") + " " + st, "detail", b.get("reason") == null ? "" : b.get("reason")));
            }
        }
        return out;
    }
}
