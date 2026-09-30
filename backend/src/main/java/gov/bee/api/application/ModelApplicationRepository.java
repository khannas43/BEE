package gov.bee.api.application;

import gov.bee.api.policy.SlicePolicy.ReadScope;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/**
 * Reads model applications with the caller's {@link ReadScope} applied in SQL, so rows
 * outside the scope never leave the database.
 */
@Repository
public class ModelApplicationRepository {

    public record Row(UUID id, String reference, UUID organisationId, String organisationCode, String brandName,
                      String category, String modelNumber, String state, int version, Set<String> assignedStagesForCaller) {
    }

    private static final String SELECT = """
        SELECT a.id, a.reference, a.organisation_id, o.code, a.brand_name, a.category, a.model_number, a.state, a.version,
               COALESCE((SELECT string_agg(s.stage, ',') FROM assignment s
                          WHERE s.subject_type = 'model_application' AND s.subject_id = a.id AND s.user_id = ? AND s.active), '') AS stages
        FROM model_application a JOIN organisation o ON o.id = a.organisation_id
        """;

    private final JdbcTemplate jdbc;

    public ModelApplicationRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public List<Row> list(ReadScope scope, UUID callerId) {
        List<Object> args = new ArrayList<>();
        args.add(callerId);
        String where = scopePredicate(scope, callerId, args);
        return jdbc.query(SELECT + " WHERE " + where + " ORDER BY a.reference", this::row, args.toArray());
    }

    public Optional<Row> find(UUID id, ReadScope scope, UUID callerId) {
        List<Object> args = new ArrayList<>();
        args.add(callerId);
        args.add(id);
        String where = "a.id = ? AND (" + scopePredicate(scope, callerId, args) + ")";
        return jdbc.query(SELECT + " WHERE " + where, this::row, args.toArray()).stream().findFirst();
    }

    private static String scopePredicate(ReadScope scope, UUID callerId, List<Object> args) {
        List<String> any = new ArrayList<>();
        if (!scope.organisations().isEmpty()) {
            any.add("a.organisation_id IN (" + placeholders(scope.organisations().size()) + ")");
            args.addAll(scope.organisations());
        }
        if (scope.assigned()) {
            any.add("EXISTS (SELECT 1 FROM assignment s WHERE s.subject_type = 'model_application' AND s.subject_id = a.id AND s.user_id = ? AND s.active)");
            args.add(callerId);
        }
        if (!scope.stages().isEmpty()) {
            any.add("a.state IN (" + placeholders(scope.stages().size()) + ")");
            args.addAll(scope.stages());
        }
        return any.isEmpty() ? "FALSE" : String.join(" OR ", any);
    }

    private static String placeholders(int n) {
        return String.join(", ", Collections.nCopies(n, "?"));
    }

    private Row row(ResultSet rs, int i) throws SQLException {
        String stages = rs.getString("stages");
        return new Row(rs.getObject("id", UUID.class), rs.getString("reference"), rs.getObject("organisation_id", UUID.class),
            rs.getString("code"), rs.getString("brand_name"), rs.getString("category"), rs.getString("model_number"),
            rs.getString("state"), rs.getInt("version"),
            stages.isEmpty() ? Set.of() : Set.copyOf(Arrays.asList(stages.split(","))));
    }
}
