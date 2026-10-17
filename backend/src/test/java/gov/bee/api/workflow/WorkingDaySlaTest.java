package gov.bee.api.workflow;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.Test;

class WorkingDaySlaTest {

    static final WorkingDaySla.CalendarSpec WEEKENDS_OFF = new WorkingDaySla.CalendarSpec(
        Set.of(DayOfWeek.SATURDAY, DayOfWeek.SUNDAY), Set.of());

    @Test
    void dueDateSkipsWeekendsAndUsesAsiaKolkataEndOfDay() {
        Instant fri = LocalDate.of(2026, 1, 9).atTime(10, 0).atZone(WorkingDaySla.ZONE).toInstant();
        Instant due = WorkingDaySla.dueAtEndOfWorkingDay(fri, 2, WEEKENDS_OFF);
        LocalDate dueDate = due.atZone(WorkingDaySla.ZONE).toLocalDate();
        assertEquals(LocalDate.of(2026, 1, 12), dueDate);
        assertEquals(23, due.atZone(WorkingDaySla.ZONE).getHour());
    }

    @Test
    void dueDateSkipsConfiguredClosuresAndYearBoundary() {
        var cal = new WorkingDaySla.CalendarSpec(Set.of(DayOfWeek.SATURDAY, DayOfWeek.SUNDAY), Set.of(LocalDate.of(2025, 12, 31)));
        Instant start = LocalDate.of(2025, 12, 30).atStartOfDay(WorkingDaySla.ZONE).toInstant();
        Instant due = WorkingDaySla.dueAtEndOfWorkingDay(start, 2, cal);
        assertEquals(LocalDate.of(2026, 1, 1), due.atZone(WorkingDaySla.ZONE).toLocalDate());
    }

    @Test
    void elapsedWorkingTimeMatchesExactMillisWithAndWithoutPause() {
        Instant start = LocalDate.of(2026, 3, 2).atTime(9, 0).atZone(ZoneId.of("Asia/Kolkata")).toInstant();
        Instant end = LocalDate.of(2026, 3, 4).atTime(9, 0).atZone(ZoneId.of("Asia/Kolkata")).toInstant();
        long full = WorkingDaySla.elapsedWorkingMillis(start, end, WEEKENDS_OFF, List.of());
        assertEquals(48L * 60 * 60 * 1000, full);
        var pause = new WorkingDaySla.PauseInterval(
            LocalDate.of(2026, 3, 3).atTime(0, 0).atZone(ZoneId.of("Asia/Kolkata")).toInstant(),
            LocalDate.of(2026, 3, 4).atTime(0, 0).atZone(ZoneId.of("Asia/Kolkata")).toInstant());
        long paused = WorkingDaySla.elapsedWorkingMillis(start, end, WEEKENDS_OFF, List.of(pause));
        assertEquals(24L * 60 * 60 * 1000, paused);
    }

    @Test
    void openApplicantPauseUsesAsOfEndInstant() {
        Instant t0 = Instant.parse("2026-04-01T04:00:00Z");
        Instant pauseAt = t0.plusSeconds(3600);
        Instant asOf = t0.plusSeconds(7200);
        var pauses = WorkingDaySla.applicantPausesFromClockEvents(List.of(
            new WorkingDaySla.ClockEvent("start", "bureau", t0),
            new WorkingDaySla.ClockEvent("pause", "applicant", pauseAt)), asOf);
        assertEquals(1, pauses.size());
        assertEquals(pauseAt, pauses.get(0).start());
        assertEquals(asOf, pauses.get(0).end());
    }

    @Test
    void clockSequenceRejectsInvalidTransitions() {
        Instant t = Instant.parse("2026-05-01T10:00:00Z");
        assertThrows(IllegalArgumentException.class, () -> WorkingDaySla.validateClockSequence(List.of(), new WorkingDaySla.ClockEvent("pause", "applicant", t)));
        var paused = List.of(
            new WorkingDaySla.ClockEvent("start", "bureau", t),
            new WorkingDaySla.ClockEvent("pause", "applicant", t.plusSeconds(10)));
        assertThrows(IllegalArgumentException.class, () -> WorkingDaySla.validateClockSequence(paused, new WorkingDaySla.ClockEvent("stop", "bureau", t.plusSeconds(20))));
    }

    @Test
    void overlappingPauseIntervalsAreRejected() {
        Instant t = Instant.parse("2026-06-01T00:00:00Z");
        var a = new WorkingDaySla.PauseInterval(t, t.plusSeconds(100));
        var b = new WorkingDaySla.PauseInterval(t.plusSeconds(50), t.plusSeconds(150));
        assertThrows(IllegalArgumentException.class, () -> WorkingDaySla.elapsedWorkingMillis(t, t.plusSeconds(200), WEEKENDS_OFF, List.of(a, b)));
    }

    @Test
    void sameCalendarDayBoundaryIsWorkingOrNotConsistently() {
        LocalDate mon = LocalDate.of(2026, 6, 1);
        assertTrue(WorkingDaySla.isWorkingDay(mon, WEEKENDS_OFF));
        assertFalse(WorkingDaySla.isWorkingDay(mon.plusDays(5), WEEKENDS_OFF));
    }
}
