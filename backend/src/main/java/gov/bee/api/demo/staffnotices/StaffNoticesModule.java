package gov.bee.api.demo.staffnotices;

import gov.bee.api.demo.DemoModule;
import gov.bee.api.demo.DemoResult;
import gov.bee.api.identity.Caller;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * The caller's company-onboarding notices (demonstration). The documented notifications contract lists only four kinds (returned, rejected,
 * fee due, approved), so the contract route leaves out the notices created by the onboarding flow (a company registration waiting for the
 * Director, a registration decided). This module answers {@code GET staff-notices} with those, in the same shape, for the person's own
 * account only; marking one read uses the contract route, which works for any kind. Local demonstration, not BEE rules.
 */
@Component
public class StaffNoticesModule implements DemoModule {

    private final ObjectProvider<JdbcTemplate> jdbcProvider;

    @Autowired
    public StaffNoticesModule(ObjectProvider<JdbcTemplate> jdbcProvider) {
        this.jdbcProvider = jdbcProvider;
    }

    @Override
    public String name() {
        return "staff-notices";
    }

    @Override
    public DemoResult handle(Caller caller, String method, String id, String action, Map<String, String> query, Map<String, Object> body) {
        if (!"GET".equals(method) || id != null) {
            return DemoResult.notFound();
        }
        JdbcTemplate jdbc = jdbcProvider.getObject();
        List<Map<String, Object>> items = new ArrayList<>();
        int unread = 0;
        for (Map<String, Object> r : jdbc.queryForList("SELECT n.id, n.kind, n.message, n.subject_id, o.reference, n.created_at, n.read_at IS NOT NULL AS is_read "
            + "FROM notification n LEFT JOIN manufacturer_onboarding_application o ON n.subject_kind = 'manufacturer_onboarding_application' AND o.id = n.subject_id "
            + "WHERE n.recipient_account_id = ? AND n.kind NOT IN ('returned', 'rejected', 'fee_due', 'approved') ORDER BY n.created_at DESC, n.id LIMIT 50", caller.accountId())) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", String.valueOf(r.get("id")));
            m.put("kind", r.get("kind"));
            m.put("message", r.get("message"));
            m.put("applicationId", String.valueOf(r.get("subject_id")));
            m.put("reference", r.get("reference") == null ? "" : r.get("reference"));
            m.put("createdAt", ((java.sql.Timestamp) r.get("created_at")).toInstant().toString());
            boolean read = Boolean.TRUE.equals(r.get("is_read"));
            m.put("read", read);
            if (!read) {
                unread++;
            }
            items.add(m);
        }
        Map<String, Object> res = new LinkedHashMap<>();
        res.put("items", items);
        res.put("unread", unread);
        return DemoResult.ok(res);
    }
}
