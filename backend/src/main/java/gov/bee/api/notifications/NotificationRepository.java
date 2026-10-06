package gov.bee.api.notifications;

import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/**
 * Reads a person's own notifications and marks them read. Writing a notification is not done here: a trigger on each of the four
 * events does it in the same transaction (V39). Marking read goes through two functions, because the runtime login cannot update the table.
 */
@Repository
public class NotificationRepository {

    /** How many of a person's newest notifications one read returns. */
    public static final int PAGE = 50;

    public record Item(UUID id, String kind, String message, UUID applicationId, String reference, Instant createdAt, boolean read) {
    }

    private final JdbcTemplate jdbc;

    public NotificationRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public List<Item> newest(UUID account) {
        return jdbc.query(
            "SELECT n.id, n.kind, n.message, n.application_id, a.reference, n.created_at, n.read_at IS NOT NULL AS is_read "
                + "FROM notification n JOIN model_application a ON a.id = n.application_id "
                + "WHERE n.recipient_account_id = ? ORDER BY n.created_at DESC, n.id LIMIT " + PAGE,
            (rs, i) -> new Item(rs.getObject("id", UUID.class), rs.getString("kind"), rs.getString("message"), rs.getObject("application_id", UUID.class),
                rs.getString("reference"), rs.getTimestamp("created_at").toInstant(), rs.getBoolean("is_read")),
            account);
    }

    public int unread(UUID account) {
        Integer n = jdbc.queryForObject("SELECT count(*) FROM notification WHERE recipient_account_id = ? AND read_at IS NULL", Integer.class, account);
        return n == null ? 0 : n;
    }

    /** True when the notification is the person's own, whether or not it was already read. */
    public boolean owns(UUID account, UUID id) {
        Integer n = jdbc.queryForObject("SELECT count(*) FROM notification WHERE id = ? AND recipient_account_id = ?", Integer.class, id, account);
        return n != null && n > 0;
    }

    public int markRead(UUID account, UUID id) {
        Integer n = jdbc.queryForObject("SELECT notification_mark_read(?, ?)", Integer.class, account, id);
        return n == null ? 0 : n;
    }

    public int markAllRead(UUID account) {
        Integer n = jdbc.queryForObject("SELECT notification_mark_all_read(?)", Integer.class, account);
        return n == null ? 0 : n;
    }
}
