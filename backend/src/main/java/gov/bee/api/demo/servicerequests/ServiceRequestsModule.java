package gov.bee.api.demo.servicerequests;

import gov.bee.api.application.ModelDraftPolicy;
import gov.bee.api.demo.DemoModule;
import gov.bee.api.demo.DemoResult;
import gov.bee.api.identity.Caller;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * Service requests (demonstration): a manufacturer asks for a renewal or a withdrawal of a certificate, or for help; BEE staff answer.
 * {@code GET service-requests} lists what the caller may see (a manufacturer its own, staff all); {@code POST service-requests} raises one
 * (manufacturer); {@code POST service-requests/{id}/respond} answers it (staff): acknowledged, resolved or declined, with a note.
 * Local demonstration, not BEE rules.
 */
@Component
public class ServiceRequestsModule implements DemoModule {

    private static final Set<String> KINDS = Set.of("renewal", "withdrawal", "helpdesk");
    private static final Set<String> STATUSES = Set.of("acknowledged", "resolved", "declined");
    private static final Set<String> STAFF = Set.of("officer", "director", "admin", "finance", "programme", "helpdesk", "reviewer", "auditor");
    private static final Set<String> RESPONDERS = Set.of("officer", "director", "programme", "helpdesk"); // the Admin demonstration profile is read only

    private final ObjectProvider<JdbcTemplate> jdbcProvider;

    @Autowired
    public ServiceRequestsModule(ObjectProvider<JdbcTemplate> jdbcProvider) {
        this.jdbcProvider = jdbcProvider;
    }

    private JdbcTemplate jdbc() {
        return jdbcProvider.getObject();
    }

    @Override
    public String name() {
        return "service-requests";
    }

    @Override
    public DemoResult handle(Caller caller, String method, String id, String action, Map<String, String> query, Map<String, Object> body) {
        boolean staff = anyAll(caller, STAFF);
        Optional<UUID> own = ModelDraftPolicy.filingOrganisation(caller);
        if (!staff && own.isEmpty()) {
            return DemoResult.denied();
        }
        if ("GET".equals(method) && id == null) {
            return list(staff ? null : own.get(), staff, anyAll(caller, RESPONDERS));
        }
        if ("POST".equals(method) && id == null) {
            return own.isPresent() && !staff ? create(caller, own.get(), body) : DemoResult.denied();
        }
        if ("POST".equals(method) && "respond".equals(action)) {
            return anyAll(caller, RESPONDERS) ? respond(caller, id, body) : DemoResult.denied();
        }
        return DemoResult.notFound();
    }

    private DemoResult list(UUID org, boolean staff, boolean canRespond) {
        String sql = "SELECT s.id, s.reference, s.kind, s.organisation_id, o.legal_name, s.subject_ref, s.subject, s.message, s.category, s.status, s.created_at, cu.display_name AS created_by, "
            + "s.response_note, s.responded_at, ru.display_name AS responded_by FROM service_request s JOIN organisation o ON o.id = s.organisation_id "
            + "LEFT JOIN user_account cu ON cu.id = s.created_by LEFT JOIN user_account ru ON ru.id = s.responded_by" + (org == null ? "" : " WHERE s.organisation_id = ?") + " ORDER BY s.created_at DESC";
        List<Map<String, Object>> rows = org == null ? jdbc().queryForList(sql) : jdbc().queryForList(sql, org);
        List<Map<String, Object>> out = new ArrayList<>();
        for (Map<String, Object> r : rows) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", String.valueOf(r.get("id")));
            m.put("reference", r.get("reference"));
            m.put("kind", r.get("kind"));
            m.put("organisation", r.get("legal_name"));
            m.put("subjectRef", r.get("subject_ref"));
            m.put("subject", r.get("subject"));
            m.put("message", r.get("message"));
            m.put("category", r.get("category"));
            m.put("status", r.get("status"));
            m.put("createdAt", String.valueOf(r.get("created_at")));
            m.put("createdBy", r.get("created_by"));
            m.put("responseNote", r.get("response_note"));
            m.put("respondedAt", r.get("responded_at") == null ? null : String.valueOf(r.get("responded_at")));
            m.put("respondedBy", r.get("responded_by"));
            out.add(m);
        }
        Map<String, Object> res = new LinkedHashMap<>();
        res.put("requests", out);
        res.put("staff", staff);
        res.put("canRespond", canRespond);
        res.put("canCreate", !staff);
        res.put("note", "Local demonstration: requests are recorded and answered here; nothing is sent outside.");
        return DemoResult.ok(res);
    }

    private DemoResult create(Caller caller, UUID org, Map<String, Object> body) {
        String kind = text(body.get("kind"));
        String subject = text(body.get("subject"));
        String message = text(body.get("message"));
        if (kind == null || !KINDS.contains(kind)) {
            return DemoResult.invalid("kind must be renewal, withdrawal or helpdesk.");
        }
        if (subject == null || subject.length() < 3 || subject.length() > 160) {
            return DemoResult.invalid("subject must be 3 to 160 characters.");
        }
        if (message != null && message.length() > 1000) {
            return DemoResult.invalid("message can be at most 1000 characters.");
        }
        if (!"renewal".equals(kind) && message == null) {
            return DemoResult.invalid("Please say why (a withdrawal needs a reason; a help request needs a message).");
        }
        UUID id = UUID.randomUUID();
        String reference = ("renewal".equals(kind) ? "RN-" : "withdrawal".equals(kind) ? "WD-" : "HD-") + id.toString().substring(0, 6).toUpperCase();
        jdbc().update("INSERT INTO service_request (id, reference, kind, organisation_id, subject_ref, subject, message, category, created_by) VALUES (?,?,?,?,?,?,?,?,?)",
            id, reference, kind, org, text(body.get("subjectRef")), subject, message, text(body.get("category")), caller.accountId());
        return DemoResult.created(Map.of("id", id.toString(), "reference", reference));
    }

    private DemoResult respond(Caller caller, String id, Map<String, Object> body) {
        UUID uid;
        try {
            uid = UUID.fromString(id);
        } catch (Exception e) {
            return DemoResult.notFound();
        }
        String status = text(body.get("status"));
        String note = text(body.get("note"));
        if (status == null || !STATUSES.contains(status)) {
            return DemoResult.invalid("status must be acknowledged, resolved or declined.");
        }
        if (note != null && note.length() > 500) {
            return DemoResult.invalid("note can be at most 500 characters.");
        }
        if ("declined".equals(status) && note == null) {
            return DemoResult.invalid("A declined request needs a reason in the note.");
        }
        int n = jdbc().update("UPDATE service_request SET status = ?, response_note = ?, responded_by = ?, responded_at = now() WHERE id = ?", status, note, caller.accountId(), uid);
        return n == 0 ? DemoResult.notFound() : DemoResult.ok(Map.of("id", id, "status", status));
    }

    private static boolean anyAll(Caller c, Set<String> roles) {
        for (String r : roles) {
            if (c.holds(r, "all")) {
                return true;
            }
        }
        return false;
    }

    private static String text(Object o) {
        return o == null || String.valueOf(o).isBlank() ? null : String.valueOf(o).trim();
    }
}
