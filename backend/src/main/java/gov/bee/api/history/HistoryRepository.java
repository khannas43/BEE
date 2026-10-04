package gov.bee.api.history;

import java.math.BigDecimal;
import java.sql.Date;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/**
 * The history of one application: its submission and every transition after it, in order, each with the stage it left and
 * entered, who took it, in which role and organisation, when, and the note or reason that went with it. Read-only. The
 * note or reason lives in the step's own append-only record, which shares the transition event's id, so one query joins
 * them. The organisation is the actor's active organisation now; the events do not record it (BL-125).
 */
@Repository
public class HistoryRepository {

    /** One row of the history, with every possible note or fact; the service decides what a reader may see. */
    public record Row(Instant at, String action, String fromState, String toState, String actorRole, String actorName, String actorOrganisation,
                      String receiptReference, BigDecimal feeAmount, Date receivedOn,
                      String iameVerification, String iameNote, String reviewerNote,
                      Integer ratingVersion, Integer stars, BigDecimal declaredIseer, BigDecimal verifiedIseer, String schemeKey,
                      String directorNote, Boolean directorFinal, String secretaryNote,
                      String returnReason, String resubmitNote, Boolean ratingSuperseded, String rejectReason) {
    }

    private final JdbcTemplate jdbc;

    public HistoryRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public List<Row> events(UUID applicationId) {
        return jdbc.query(
            "SELECT e.occurred_at, e.action, e.from_state, e.to_state, e.actor_role, u.display_name, "
                + "(SELECT o.code FROM organisation_membership m JOIN organisation o ON o.id = m.organisation_id "
                + "  WHERE m.user_id = e.actor_account_id AND m.active ORDER BY o.code LIMIT 1) AS actor_org, "
                + "fc.receipt_reference, fc.amount_inr, fc.received_on, "
                + "ir.verification, ir.note AS iame_note, rf.note AS reviewer_note, "
                + "rt.rating_version, rt.stars, rt.declared_iseer, rt.verified_iseer, rt.scheme_key, "
                + "dr.note AS director_note, dr.director_final, sa.note AS secretary_note, "
                + "rn.reason AS return_reason, rs.note AS resubmit_note, rs.rating_superseded, rj.reason AS reject_reason "
                + "FROM ("
                + "  SELECT id, occurred_at, 'submit' AS action, from_state, to_state, actor_account_id, actor_role, 0 AS seq "
                + "  FROM model_application_submission_event WHERE application_id = ? "
                + "  UNION ALL "
                + "  SELECT id, occurred_at, action, from_state, to_state, actor_account_id, actor_role, version_after AS seq "
                + "  FROM model_application_transition_event WHERE application_id = ?"
                + ") e "
                + "JOIN user_account u ON u.id = e.actor_account_id "
                + "LEFT JOIN model_application_fee_confirmation fc ON fc.transition_event_id = e.id "
                + "LEFT JOIN model_application_iame_recommendation ir ON ir.transition_event_id = e.id "
                + "LEFT JOIN model_application_reviewer_forward rf ON rf.transition_event_id = e.id "
                + "LEFT JOIN model_application_rating rt ON rt.transition_event_id = e.id "
                + "LEFT JOIN model_application_director_recommendation dr ON dr.transition_event_id = e.id "
                + "LEFT JOIN model_application_secretary_approval sa ON sa.transition_event_id = e.id "
                + "LEFT JOIN model_application_return rn ON rn.transition_event_id = e.id "
                + "LEFT JOIN model_application_resubmission rs ON rs.transition_event_id = e.id "
                + "LEFT JOIN model_application_rejection rj ON rj.transition_event_id = e.id "
                + "ORDER BY e.occurred_at, e.seq",
            (rs, i) -> new Row(rs.getTimestamp("occurred_at").toInstant(), rs.getString("action"), rs.getString("from_state"), rs.getString("to_state"),
                rs.getString("actor_role"), rs.getString("display_name"), rs.getString("actor_org"),
                rs.getString("receipt_reference"), rs.getBigDecimal("amount_inr"), rs.getDate("received_on"),
                rs.getString("verification"), rs.getString("iame_note"), rs.getString("reviewer_note"),
                (Integer) rs.getObject("rating_version"), (Integer) rs.getObject("stars"), rs.getBigDecimal("declared_iseer"), rs.getBigDecimal("verified_iseer"),
                rs.getString("scheme_key"), rs.getString("director_note"), (Boolean) rs.getObject("director_final"), rs.getString("secretary_note"),
                rs.getString("return_reason"), rs.getString("resubmit_note"), (Boolean) rs.getObject("rating_superseded"), rs.getString("reject_reason")),
            applicationId, applicationId);
    }
}
