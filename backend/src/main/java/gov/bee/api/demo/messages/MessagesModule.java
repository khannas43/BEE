package gov.bee.api.demo.messages;

import gov.bee.api.demo.DemoModule;
import gov.bee.api.demo.DemoResult;
import gov.bee.api.identity.Caller;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * A person's own simulated email and SMS messages (demonstration). The rows are written by database triggers on the payment, ledger and
 * production audit records (V66); nothing is ever sent anywhere. Everyone with an effective role reads only their own, newest first, and
 * marks them read. {@code GET /api/demo/messages[?channel=email|sms]}, {@code POST /api/demo/messages/{id}/read}, {@code POST /api/demo/messages/read-all}.
 */
@Component
public class MessagesModule implements DemoModule {

    static final int PAGE = 100;
    static final String NOTE = "Simulated email and SMS: nothing is sent. Local demonstration, not a BEE system.";

    private final ObjectProvider<JdbcTemplate> jdbcProvider;
    private JdbcTemplate fixed;

    /** Resolved on first use so the web-layer tests (no database) can start the context without a JdbcTemplate. */
    @Autowired
    public MessagesModule(ObjectProvider<JdbcTemplate> jdbcProvider) {
        this.jdbcProvider = jdbcProvider;
    }

    MessagesModule(JdbcTemplate jdbc) {
        this.jdbcProvider = null;
        this.fixed = jdbc;
    }

    private JdbcTemplate jdbc() {
        return fixed != null ? fixed : jdbcProvider.getObject();
    }

    @Override
    public String name() {
        return "messages";
    }

    @Override
    public DemoResult handle(Caller caller, String method, String id, String action, Map<String, String> query, Map<String, Object> body) {
        boolean get = "GET".equals(method);
        if (get && id == null && action == null) {
            return list(caller, query.get("channel"));
        }
        if (!get && "read-all".equals(id) && action == null) {
            Integer n = jdbc().queryForObject("SELECT demo_message_mark_all_read(?)", Integer.class, caller.accountId());
            return DemoResult.ok(Map.of("marked", n == null ? 0 : n, "note", NOTE));
        }
        if (!get && id != null && "read".equals(action)) {
            UUID message;
            try {
                message = UUID.fromString(id);
            } catch (IllegalArgumentException e) {
                return DemoResult.notFound();
            }
            Integer owned = jdbc().queryForObject("SELECT count(*) FROM demo_message WHERE id = ? AND recipient_account_id = ?", Integer.class, message, caller.accountId());
            if (owned == null || owned == 0) {
                return DemoResult.notFound();
            }
            Integer n = jdbc().queryForObject("SELECT demo_message_mark_read(?, ?)", Integer.class, caller.accountId(), message);
            return DemoResult.ok(Map.of("marked", n == null ? 0 : n, "note", NOTE));
        }
        return DemoResult.notFound();
    }

    private DemoResult list(Caller caller, String channel) {
        if (channel != null && !"email".equals(channel) && !"sms".equals(channel)) {
            return DemoResult.invalid("channel must be email or sms.");
        }
        String where = channel == null ? "" : " AND channel = '" + channel + "'";
        List<Map<String, Object>> items = new ArrayList<>();
        jdbc().query("SELECT id, channel, address, event_kind, reference, subject, body, created_at, read_at IS NOT NULL AS is_read "
            + "FROM demo_message WHERE recipient_account_id = ?" + where + " ORDER BY created_at DESC, id LIMIT " + PAGE, rs -> {
                Map<String, Object> m = new LinkedHashMap<>();
                m.put("id", rs.getObject("id", UUID.class).toString());
                m.put("channel", rs.getString("channel"));
                m.put("address", rs.getString("address"));
                m.put("kind", rs.getString("event_kind"));
                m.put("reference", rs.getString("reference"));
                m.put("subject", rs.getString("subject"));
                m.put("body", rs.getString("body"));
                m.put("createdAt", rs.getTimestamp("created_at").toInstant().toString());
                m.put("read", rs.getBoolean("is_read"));
                items.add(m);
            }, caller.accountId());
        Integer unread = jdbc().queryForObject("SELECT count(*) FROM demo_message WHERE recipient_account_id = ? AND read_at IS NULL", Integer.class, caller.accountId());
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("unread", unread == null ? 0 : unread);
        out.put("items", items);
        out.put("note", NOTE);
        return DemoResult.ok(out);
    }
}
