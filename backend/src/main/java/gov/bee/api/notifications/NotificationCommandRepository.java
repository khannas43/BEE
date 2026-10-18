package gov.bee.api.notifications;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;

/** Replay-safe delivery of in-portal notifications via {@code notification_foundation_deliver} (V70). Internal; not wired to HTTP yet. */
public class NotificationCommandRepository {

    public record DeliverCommand(String subjectKind, UUID subjectId, String kind, String messageSuffix) {
    }

    public record DeliverResult(int recipientCount) {
    }

    private final JdbcTemplate jdbc;

    public NotificationCommandRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public static String payloadHash(DeliverCommand command) {
        String canonical = command.subjectKind() + "|" + command.subjectId() + "|" + command.kind() + "|" + command.messageSuffix();
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(canonical.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    public DeliverResult deliver(DeliverCommand command, UUID commandId, UUID actorAccountId) {
        String hash = payloadHash(command);
        Integer count = jdbc.queryForObject(
            "SELECT notification_foundation_deliver(?, ?, ?, ?, ?, ?, ?)",
            Integer.class,
            commandId,
            hash,
            command.subjectKind(),
            command.subjectId(),
            command.kind(),
            command.messageSuffix(),
            actorAccountId);
        return new DeliverResult(count == null ? 0 : count);
    }
}
