package gov.bee.api.demo.ai;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.math.BigDecimal;
import java.sql.ResultSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/** Persistence of models, runs, dispositions and audit rows. Runs and dispositions are only ever inserted. */
@Repository
public class AiStore {

    private static final ObjectMapper JSON = new ObjectMapper();
    private final JdbcTemplate jdbc;

    public AiStore(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    static String toJson(Object o) {
        try {
            return JSON.writeValueAsString(o);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException(e);
        }
    }

    @SuppressWarnings("unchecked")
    static Object fromJson(String s) {
        if (s == null) {
            return null;
        }
        try {
            return JSON.readValue(s, Object.class);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException(e);
        }
    }

    public List<Map<String, Object>> models() {
        return jdbc.query("SELECT id, use_case, name, version, kind, description, limitations, trained_on, status FROM ai_model ORDER BY use_case",
            (rs, i) -> {
                Map<String, Object> m = new LinkedHashMap<>();
                m.put("id", rs.getString("id"));
                m.put("useCase", rs.getString("use_case"));
                m.put("name", rs.getString("name"));
                m.put("version", rs.getString("version"));
                m.put("kind", rs.getString("kind"));
                m.put("description", rs.getString("description"));
                m.put("limitations", rs.getString("limitations"));
                m.put("trainedOn", rs.getString("trained_on"));
                m.put("status", rs.getString("status"));
                return m;
            });
    }

    public Optional<String> modelVersion(String useCase) {
        return jdbc.query("SELECT id || '@' || version FROM ai_model WHERE use_case = ? AND status = 'registered'", (rs, i) -> rs.getString(1), useCase)
            .stream().findFirst();
    }

    public UUID insertRun(String useCase, String modelVersion, String dataVersion, String inputRef, Map<String, Object> output, double confidence,
                          UUID account, String role) {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO ai_run (id, use_case, model_version, data_version, input_ref, output, confidence, created_by) "
                + "VALUES (?, ?, ?, ?, ?, ?::jsonb, ?, ?)",
            id, useCase, modelVersion, dataVersion, inputRef, toJson(output), BigDecimal.valueOf(AiMath.round(confidence, 3)), account);
        audit(id, "run", account, role, "Run computed (" + modelVersion + ", data " + dataVersion + ")");
        return id;
    }

    public void audit(UUID run, String action, UUID account, String role, String detail) {
        jdbc.update("INSERT INTO ai_audit_event (run_id, action, actor_account_id, actor_role, detail) VALUES (?, ?, ?, ?, ?)",
            run, action, account, role, detail);
    }

    public UUID insertDisposition(UUID run, UUID account, String role, String decision, String reason, String overrideValue, Map<String, Object> fields) {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO ai_disposition (id, run_id, actor_account_id, actor_role, decision, reason, override_value, field_decisions) "
                + "VALUES (?, ?, ?, ?, ?, ?, ?, ?::jsonb)",
            id, run, account, role, decision, reason, overrideValue, fields == null || fields.isEmpty() ? null : toJson(fields));
        audit(run, "disposition", account, role, "Disposition " + decision + (reason == null ? "" : ": " + reason));
        return id;
    }

    private static final String RUN_SELECT = "SELECT r.id, r.use_case, r.model_version, r.data_version, r.input_ref, r.output::text AS output, r.confidence, "
        + "r.created_at, u.username, (SELECT count(*) FROM ai_disposition d WHERE d.run_id = r.id) AS dispositions, "
        + "(SELECT d.decision FROM ai_disposition d WHERE d.run_id = r.id ORDER BY d.at DESC, d.id LIMIT 1) AS latest_decision "
        + "FROM ai_run r JOIN user_account u ON u.id = r.created_by ";

    private Map<String, Object> runRow(ResultSet rs, boolean withOutput) throws java.sql.SQLException {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", rs.getObject("id", UUID.class).toString());
        m.put("useCase", rs.getString("use_case"));
        m.put("modelVersion", rs.getString("model_version"));
        m.put("dataVersion", rs.getString("data_version"));
        m.put("inputRef", rs.getString("input_ref"));
        m.put("confidence", rs.getBigDecimal("confidence"));
        m.put("createdAt", rs.getTimestamp("created_at").toInstant().toString());
        m.put("createdBy", rs.getString("username"));
        m.put("dispositionCount", rs.getInt("dispositions"));
        m.put("latestDecision", rs.getString("latest_decision"));
        if (withOutput) {
            m.put("output", fromJson(rs.getString("output")));
        }
        return m;
    }

    public List<Map<String, Object>> runs(String useCase, int limit) {
        return jdbc.query(RUN_SELECT + "WHERE r.use_case = ? ORDER BY r.created_at DESC, r.id LIMIT " + limit, (rs, i) -> runRow(rs, false), useCase);
    }

    public Optional<Map<String, Object>> run(UUID id) {
        return jdbc.query(RUN_SELECT + "WHERE r.id = ?", (rs, i) -> runRow(rs, true), id).stream().findFirst();
    }

    public List<Map<String, Object>> dispositions(UUID run) {
        return jdbc.query("SELECT d.id, u.username, d.actor_role, d.decision, d.reason, d.override_value, d.field_decisions::text AS fields, d.at "
                + "FROM ai_disposition d JOIN user_account u ON u.id = d.actor_account_id WHERE d.run_id = ? ORDER BY d.at, d.id",
            (rs, i) -> {
                Map<String, Object> m = new LinkedHashMap<>();
                m.put("id", rs.getObject("id", UUID.class).toString());
                m.put("actor", rs.getString("username"));
                m.put("role", rs.getString("actor_role"));
                m.put("decision", rs.getString("decision"));
                m.put("reason", rs.getString("reason"));
                m.put("overrideValue", rs.getString("override_value"));
                m.put("fieldDecisions", fromJson(rs.getString("fields")));
                m.put("at", rs.getTimestamp("at").toInstant().toString());
                return m;
            }, run);
    }

    public List<Map<String, Object>> audit(UUID run) {
        return jdbc.query("SELECT a.action, u.username, a.actor_role, a.detail, a.at FROM ai_audit_event a JOIN user_account u ON u.id = a.actor_account_id "
                + "WHERE a.run_id = ? ORDER BY a.at, a.id",
            (rs, i) -> {
                Map<String, Object> m = new LinkedHashMap<>();
                m.put("action", rs.getString("action"));
                m.put("actor", rs.getString("username"));
                m.put("role", rs.getString("actor_role"));
                m.put("detail", rs.getString("detail"));
                m.put("at", rs.getTimestamp("at").toInstant().toString());
                return m;
            }, run);
    }
}
