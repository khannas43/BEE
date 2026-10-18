package gov.bee.api.workflow;

import java.sql.Date;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/** Selects the persisted {@code snl_return_response} policy and computes due dates via {@link WorkingDaySla}. */
@Repository
public class SnlReturnResponsePolicyRepository {

    public static final String POLICY_KEY = "snl_return_response";

    public record PolicyVersion(UUID id, String policyKey, int version, String calendarKey, int workingDayLimit, boolean pauseWhileApplicant,
                                LocalDate effectiveFrom, LocalDate effectiveTo) {
    }

    private final JdbcTemplate jdbc;

    public SnlReturnResponsePolicyRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** Anchor instant is interpreted in {@link WorkingDaySla#ZONE} for applicable-version selection. */
    public PolicyVersion requireApplicableVersion(Instant anchorAt) {
        LocalDate anchorDate = anchorAt.atZone(WorkingDaySla.ZONE).toLocalDate();
        List<PolicyVersion> rows = jdbc.query(
            "SELECT id, policy_key, version, calendar_key, working_day_limit, pause_while_applicant, effective_from, effective_to "
                + "FROM workflow_sla_policy_version WHERE policy_key = ? AND ?::date >= effective_from "
                + "AND (effective_to IS NULL OR ?::date < effective_to)",
            (rs, i) -> new PolicyVersion(
                rs.getObject("id", java.util.UUID.class),
                rs.getString("policy_key"),
                rs.getInt("version"),
                rs.getString("calendar_key"),
                rs.getInt("working_day_limit"),
                rs.getBoolean("pause_while_applicant"),
                rs.getDate("effective_from").toLocalDate(),
                rs.getDate("effective_to") == null ? null : rs.getDate("effective_to").toLocalDate()),
            POLICY_KEY, Date.valueOf(anchorDate), Date.valueOf(anchorDate));
        if (rows.isEmpty()) {
            throw new IllegalStateException("snl_return_response_policy_missing");
        }
        if (rows.size() > 1) {
            throw new IllegalStateException("snl_return_response_policy_ambiguous");
        }
        return rows.get(0);
    }

    public Instant dueAtEndOfWorkingDays(Instant anchorAt, PolicyVersion policy) {
        WorkingDaySla.CalendarSpec calendar = loadCalendarSpec(policy.calendarKey())
            .orElseThrow(() -> new IllegalStateException("workflow_calendar_missing"));
        return WorkingDaySla.dueAtEndOfWorkingDay(anchorAt, policy.workingDayLimit(), calendar);
    }

    Optional<WorkingDaySla.CalendarSpec> loadCalendarSpec(String calendarKey) {
        var rows = jdbc.query(
            "SELECT non_working_weekdays FROM workflow_calendar WHERE calendar_key = ?",
            (rs, i) -> {
                Object[] raw = (Object[]) rs.getArray("non_working_weekdays").getArray();
                short[] iso = new short[raw.length];
                for (int j = 0; j < raw.length; j++) {
                    iso[j] = ((Number) raw[j]).shortValue();
                }
                return iso;
            }, calendarKey);
        if (rows.isEmpty()) {
            return Optional.empty();
        }
        List<LocalDate> closures = jdbc.query(
            "SELECT closure_date FROM workflow_calendar_closure WHERE calendar_key = ? ORDER BY closure_date",
            (rs, i) -> rs.getDate("closure_date").toLocalDate(), calendarKey);
        return Optional.of(WorkingDaySla.calendarFromDb(rows.get(0), closures));
    }

    public Optional<PolicyVersion> findSeededVersion() {
        return jdbc.query(
            "SELECT id, policy_key, version, calendar_key, working_day_limit, pause_while_applicant, effective_from, effective_to "
                + "FROM workflow_sla_policy_version WHERE policy_key = ? AND version = 1",
            (rs, i) -> new PolicyVersion(
                rs.getObject("id", java.util.UUID.class),
                rs.getString("policy_key"),
                rs.getInt("version"),
                rs.getString("calendar_key"),
                rs.getInt("working_day_limit"),
                rs.getBoolean("pause_while_applicant"),
                rs.getDate("effective_from").toLocalDate(),
                rs.getDate("effective_to") == null ? null : rs.getDate("effective_to").toLocalDate()),
            POLICY_KEY).stream().findFirst();
    }
}
