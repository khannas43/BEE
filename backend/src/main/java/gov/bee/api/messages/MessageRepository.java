package gov.bee.api.messages;

import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/**
 * Reads a person's own simulated email and SMS messages and marks them read. Writing a message is not done here: triggers on the payment,
 * ledger and production audit records do it in the same transaction (V66). Marking read goes through two functions, because the runtime
 * login cannot update the table.
 */
@Repository
public class MessageRepository {

    /** How many of a person's newest messages one read returns. */
    public static final int PAGE = 50;

    public record Item(UUID id, String channel, String address, String kind, String reference, String subject, String body, Instant createdAt, boolean read) {
    }

    private final JdbcTemplate jdbc;

    public MessageRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public List<Item> newest(UUID account) {
        return jdbc.query(
            "SELECT id, channel, address, event_kind, reference, subject, body, created_at, read_at IS NOT NULL AS is_read "
                + "FROM demo_message WHERE recipient_account_id = ? ORDER BY created_at DESC, id LIMIT " + PAGE,
            (rs, i) -> new Item(rs.getObject("id", UUID.class), rs.getString("channel"), rs.getString("address"), rs.getString("event_kind"),
                rs.getString("reference"), rs.getString("subject"), rs.getString("body"), rs.getTimestamp("created_at").toInstant(), rs.getBoolean("is_read")),
            account);
    }

    public int unread(UUID account) {
        Integer n = jdbc.queryForObject("SELECT count(*) FROM demo_message WHERE recipient_account_id = ? AND read_at IS NULL", Integer.class, account);
        return n == null ? 0 : n;
    }

    /** True when the message is the person's own, whether or not it was already read. */
    public boolean owns(UUID account, UUID id) {
        Integer n = jdbc.queryForObject("SELECT count(*) FROM demo_message WHERE id = ? AND recipient_account_id = ?", Integer.class, id, account);
        return n != null && n > 0;
    }

    public int markRead(UUID account, UUID id) {
        Integer n = jdbc.queryForObject("SELECT demo_message_mark_read(?, ?)", Integer.class, account, id);
        return n == null ? 0 : n;
    }

    public int markAllRead(UUID account) {
        Integer n = jdbc.queryForObject("SELECT demo_message_mark_all_read(?)", Integer.class, account);
        return n == null ? 0 : n;
    }
}
