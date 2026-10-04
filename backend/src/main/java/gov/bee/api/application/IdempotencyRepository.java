package gov.bee.api.application;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/** Persists idempotency keys in the same database as model applications (x-bee-idempotency). */
@Repository
public class IdempotencyRepository {

    public static final UUID CREATE_TARGET = UUID.fromString("00000000-0000-0000-0000-000000000000");

    public record Stored(boolean inProgress, int responseStatus, String responseBody, int recordVersion) {
    }

    private final JdbcTemplate jdbc;

    public IdempotencyRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public Optional<Stored> find(UUID accountId, String method, String routeTemplate, UUID targetId, String key) {
        return jdbc.query(
            "SELECT in_progress, response_status, response_body::text, record_version FROM idempotency_record "
                + "WHERE account_id = ? AND http_method = ? AND route_template = ? AND target_record_id = ? AND idempotency_key = ?",
            this::map, accountId, method, routeTemplate, targetId, key).stream().findFirst();
    }

    /** Inserts an in-progress row; returns false if the key already exists. */
    public boolean begin(UUID accountId, String method, String routeTemplate, UUID targetId, String key, byte[] bodyHash) {
        int n = jdbc.update(
            "INSERT INTO idempotency_record (account_id, http_method, route_template, target_record_id, idempotency_key, body_hash, in_progress) "
                + "VALUES (?, ?, ?, ?, ?, ?, true) ON CONFLICT DO NOTHING",
            accountId, method, routeTemplate, targetId, key, bodyHash);
        return n == 1;
    }

    public void complete(UUID accountId, String method, String routeTemplate, UUID targetId, String key, int status,
                         String responseJson, int recordVersion) {
        jdbc.update(
            "UPDATE idempotency_record SET in_progress = false, response_status = ?, response_body = ?::jsonb, record_version = ?, completed_at = now() "
                + "WHERE account_id = ? AND http_method = ? AND route_template = ? AND target_record_id = ? AND idempotency_key = ?",
            status, responseJson, recordVersion, accountId, method, routeTemplate, targetId, key);
    }

    public void abandon(UUID accountId, String method, String routeTemplate, UUID targetId, String key) {
        jdbc.update(
            "DELETE FROM idempotency_record WHERE account_id = ? AND http_method = ? AND route_template = ? AND target_record_id = ? AND idempotency_key = ? AND in_progress",
            accountId, method, routeTemplate, targetId, key);
    }

    public Optional<byte[]> bodyHash(UUID accountId, String method, String routeTemplate, UUID targetId, String key) {
        return jdbc.query(
            "SELECT body_hash FROM idempotency_record WHERE account_id = ? AND http_method = ? AND route_template = ? AND target_record_id = ? AND idempotency_key = ?",
            (rs, i) -> rs.getBytes("body_hash"), accountId, method, routeTemplate, targetId, key).stream().findFirst();
    }

    private Stored map(ResultSet rs, int i) throws SQLException {
        String body = rs.getString(3);
        return new Stored(rs.getBoolean("in_progress"), rs.getInt("response_status"), body, rs.getInt("record_version"));
    }
}
