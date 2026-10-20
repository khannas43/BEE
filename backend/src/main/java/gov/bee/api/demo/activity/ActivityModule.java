package gov.bee.api.demo.activity;

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
 * Sign-in and action trail (demonstration). {@code POST activity} records a sign-in or an action for the caller (the portal server sends it
 * with the address the person came from); {@code GET activity} lists it: a manufacturer sees the people of its own organisation, the BEE
 * oversight roles see everyone (the consolidated view), with optional filters. Local demonstration, not BEE rules.
 */
@Component
public class ActivityModule implements DemoModule {

    private static final Set<String> OVERSIGHT = Set.of("officer", "director", "secretary", "admin", "auditor", "programme");
    private static final Set<String> KINDS = Set.of("login", "action");
    private static final int MAX_ROWS = 500;

    private final ObjectProvider<JdbcTemplate> jdbcProvider;

    @Autowired
    public ActivityModule(ObjectProvider<JdbcTemplate> jdbcProvider) {
        this.jdbcProvider = jdbcProvider;
    }

    private JdbcTemplate jdbc() {
        return jdbcProvider.getObject();
    }

    @Override
    public String name() {
        return "activity";
    }

    @Override
    public DemoResult handle(Caller caller, String method, String id, String action, Map<String, String> query, Map<String, Object> body) {
        if (id != null) {
            return DemoResult.notFound();
        }
        if ("POST".equals(method)) {
            return record(caller, body);
        }
        boolean oversight = false;
        for (String r : OVERSIGHT) {
            oversight = oversight || caller.holds(r, "all");
        }
        Optional<UUID> own = ModelDraftPolicy.filingOrganisation(caller);
        if (!oversight && own.isEmpty()) {
            return DemoResult.denied();
        }
        return list(oversight ? null : own.get(), query);
    }

    private DemoResult record(Caller caller, Map<String, Object> body) {
        String kind = text(body.get("kind"));
        String what = text(body.get("action"));
        if (kind == null || !KINDS.contains(kind) || what == null) {
            return DemoResult.invalid("kind must be login or action, and action is required.");
        }
        String ip = text(body.get("ip"));
        if (ip == null || !ip.matches("[0-9A-Za-z:.%\\- ()]{1,64}")) {
            ip = "unknown";
        }
        String target = text(body.get("target"));
        List<Map<String, Object>> who = jdbc().queryForList("SELECT username, display_name FROM user_account WHERE id = ?", caller.accountId());
        if (who.isEmpty()) {
            return DemoResult.denied();
        }
        UUID orgId = caller.organisationIds().stream().sorted().findFirst().orElse(null);
        String orgCode = null;
        String orgName = null;
        if (orgId != null) {
            List<Map<String, Object>> o = jdbc().queryForList("SELECT code, legal_name FROM organisation WHERE id = ?", orgId);
            if (!o.isEmpty()) {
                orgCode = String.valueOf(o.get(0).get("code"));
                orgName = String.valueOf(o.get(0).get("legal_name")).replaceAll("\\s*\\(synthetic[^)]*\\)\\s*$", "");
            }
        }
        String role = caller.ownRoles().isEmpty() ? "none" : caller.ownRoles().get(0).role();
        jdbc().update("INSERT INTO access_activity (user_id, username, display_name, role, organisation_id, organisation_code, organisation_name, ip, kind, action, target) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            caller.accountId(), who.get(0).get("username"), who.get(0).get("display_name"), role, orgId, orgCode, orgName, ip, kind,
            cut(what, 200), target == null ? null : cut(target, 200));
        return DemoResult.created(Map.of("recorded", true));
    }

    private DemoResult list(UUID org, Map<String, String> query) {
        StringBuilder where = new StringBuilder(" WHERE 1=1");
        List<Object> args = new ArrayList<>();
        if (org != null) {
            where.append(" AND organisation_id = ?");
            args.add(org);
        } else if (text(query.get("organisation")) != null) {
            where.append(" AND organisation_code = ?");
            args.add(text(query.get("organisation")));
        }
        if (text(query.get("kind")) != null && KINDS.contains(text(query.get("kind")))) {
            where.append(" AND kind = ?");
            args.add(text(query.get("kind")));
        }
        if (text(query.get("username")) != null) {
            where.append(" AND username = ?");
            args.add(text(query.get("username")));
        }
        List<Map<String, Object>> rows = jdbc().queryForList("SELECT at, username, display_name, role, organisation_code, organisation_name, ip, kind, action, target FROM access_activity"
            + where + " ORDER BY at DESC LIMIT " + MAX_ROWS, args.toArray());
        List<Map<String, Object>> events = new ArrayList<>();
        for (Map<String, Object> r : rows) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("at", String.valueOf(r.get("at")));
            m.put("username", r.get("username"));
            m.put("name", r.get("display_name"));
            m.put("role", r.get("role"));
            m.put("organisationCode", r.get("organisation_code"));
            m.put("organisation", r.get("organisation_name"));
            m.put("ip", r.get("ip"));
            m.put("kind", r.get("kind"));
            m.put("action", r.get("action"));
            m.put("target", r.get("target"));
            events.add(m);
        }
        // One line per person over the whole trail in scope (not only the rows returned): sign-ins, actions, last seen and last address.
        String orgFilter = org != null ? " WHERE organisation_id = ?" : "";
        List<Map<String, Object>> people = org != null
            ? jdbc().queryForList(PEOPLE.replace("%W", orgFilter), org)
            : jdbc().queryForList(PEOPLE.replace("%W", ""));
        List<Map<String, Object>> peopleOut = new ArrayList<>();
        for (Map<String, Object> r : people) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("username", r.get("username"));
            m.put("name", r.get("name"));
            m.put("role", r.get("role"));
            m.put("organisation", r.get("organisation"));
            m.put("logins", r.get("logins"));
            m.put("actions", r.get("actions"));
            m.put("lastSeen", String.valueOf(r.get("last_seen")));
            m.put("lastIp", r.get("last_ip"));
            m.put("addresses", r.get("addresses"));
            peopleOut.add(m);
        }
        List<Map<String, Object>> orgs = org != null ? List.of() : jdbc().queryForList("SELECT DISTINCT organisation_code AS code, organisation_name AS name FROM access_activity WHERE organisation_code IS NOT NULL ORDER BY 2");
        Map<String, Object> res = new LinkedHashMap<>();
        res.put("events", events);
        res.put("people", peopleOut);
        res.put("organisations", orgs);
        res.put("scope", org == null ? "all" : "own");
        res.put("limit", MAX_ROWS);
        res.put("note", "Local demonstration: sign-ins and actions are recorded here with the address they came from; nothing is sent outside.");
        return DemoResult.ok(res);
    }

    private static final String PEOPLE = "SELECT username, max(display_name) AS name, max(role) AS role, max(organisation_name) AS organisation, "
        + "count(*) FILTER (WHERE kind = 'login') AS logins, count(*) FILTER (WHERE kind = 'action') AS actions, max(at) AS last_seen, "
        + "(array_agg(ip ORDER BY at DESC))[1] AS last_ip, count(DISTINCT ip) AS addresses FROM access_activity%W GROUP BY username ORDER BY max(at) DESC";

    private static String cut(String s, int n) {
        return s.length() <= n ? s : s.substring(0, n);
    }

    private static String text(Object o) {
        return o == null || String.valueOf(o).isBlank() ? null : String.valueOf(o).trim();
    }
}
