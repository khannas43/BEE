package gov.bee.api.workflow;

import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Set;

/**
 * Working-day due dates and elapsed time for SNL WP2. Uses {@link #ZONE} ({@code Asia/Kolkata}) for calendar days.
 * Policy limits and pauses are supplied by callers; this class does not encode 7/12/15/30/60-day manual values.
 */
public final class WorkingDaySla {

    public static final ZoneId ZONE = ZoneId.of("Asia/Kolkata");

    private WorkingDaySla() {
    }

    public record CalendarSpec(Set<DayOfWeek> nonWorkingWeekdays, Set<LocalDate> closureDates) {
    }

    /** Half-open interval [start, end) during which the SLA clock does not count working time (e.g. applicant wait, A17). */
    public record PauseInterval(Instant start, Instant end) {
        public PauseInterval {
            if (!end.isAfter(start)) {
                throw new IllegalArgumentException("pause end must be after start");
            }
        }
    }

    /** Last instant of the Nth working day on or after {@code startInclusive} (end-of-day IST). */
    public static Instant dueAtEndOfWorkingDay(Instant startInclusive, int workingDays, CalendarSpec calendar) {
        if (workingDays < 1) {
            throw new IllegalArgumentException("workingDays must be at least 1");
        }
        LocalDate cursor = startInclusive.atZone(ZONE).toLocalDate();
        int counted = 0;
        while (counted < workingDays) {
            if (isWorkingDay(cursor, calendar)) {
                counted++;
            }
            if (counted < workingDays) {
                cursor = cursor.plusDays(1);
            }
        }
        return cursor.atTime(23, 59, 59, 999_000_000).atZone(ZONE).toInstant();
    }

    public static boolean isWorkingDay(LocalDate day, CalendarSpec calendar) {
        if (calendar.closureDates().contains(day)) {
            return false;
        }
        return !calendar.nonWorkingWeekdays().contains(day.getDayOfWeek());
    }

    /** Whole working days between start and end in IST, excluding time spent in pause intervals. */
    public static long elapsedWorkingMillis(Instant startInclusive, Instant endExclusive, CalendarSpec calendar, List<PauseInterval> pauses) {
        if (!endExclusive.isAfter(startInclusive)) {
            return 0;
        }
        List<PauseInterval> sorted = pauses == null || pauses.isEmpty() ? List.of() : pauses.stream().sorted(Comparator.comparing(PauseInterval::start)).toList();
        long total = 0;
        ZonedDateTime zStart = startInclusive.atZone(ZONE);
        ZonedDateTime zEnd = endExclusive.atZone(ZONE);
        LocalDate day = zStart.toLocalDate();
        LocalDate lastDay = zEnd.toLocalDate();
        while (!day.isAfter(lastDay)) {
            if (isWorkingDay(day, calendar)) {
                Instant dayStart = day.atStartOfDay(ZONE).toInstant();
                Instant dayEnd = day.plusDays(1).atStartOfDay(ZONE).toInstant();
                Instant sliceStart = startInclusive.isAfter(dayStart) ? startInclusive : dayStart;
                Instant sliceEnd = endExclusive.isBefore(dayEnd) ? endExclusive : dayEnd;
                if (sliceEnd.isAfter(sliceStart)) {
                    total += sliceMillisMinusPauses(sliceStart, sliceEnd, sorted);
                }
            }
            day = day.plusDays(1);
        }
        return total;
    }

    static long sliceMillisMinusPauses(Instant sliceStart, Instant sliceEnd, List<PauseInterval> pauses) {
        long millis = sliceEnd.toEpochMilli() - sliceStart.toEpochMilli();
        for (PauseInterval p : pauses) {
            Instant overlapStart = sliceStart.isAfter(p.start()) ? sliceStart : p.start();
            Instant overlapEnd = sliceEnd.isBefore(p.end()) ? sliceEnd : p.end();
            if (overlapEnd.isAfter(overlapStart)) {
                millis -= overlapEnd.toEpochMilli() - overlapStart.toEpochMilli();
            }
        }
        return Math.max(0, millis);
    }

    /** ISO weekday numbers 1=Monday … 7=Sunday, as stored in {@code workflow_calendar.non_working_weekdays}. */
    public static Set<DayOfWeek> weekdaysFromIsoNumbers(short[] isoDays) {
        var out = new java.util.HashSet<DayOfWeek>();
        for (short n : isoDays) {
            out.add(DayOfWeek.of(n));
        }
        return Set.copyOf(out);
    }

    public static CalendarSpec calendarFromDb(short[] nonWorkingIso, List<LocalDate> closures) {
        return new CalendarSpec(weekdaysFromIsoNumbers(nonWorkingIso), closures == null ? Set.of() : Set.copyOf(closures));
    }

    public static List<PauseInterval> applicantPausesFromClockEvents(List<ClockEvent> events) {
        var pauses = new ArrayList<PauseInterval>();
        Instant pauseStart = null;
        for (ClockEvent e : events) {
            switch (e.eventKind()) {
                case "pause" -> {
                    if ("applicant".equals(e.responsibleParty())) {
                        pauseStart = e.occurredAt();
                    }
                }
                case "resume", "stop" -> {
                    if (pauseStart != null && "applicant".equals(e.responsibleParty())) {
                        pauses.add(new PauseInterval(pauseStart, e.occurredAt()));
                        pauseStart = null;
                    }
                }
                default -> { }
            }
        }
        if (pauseStart != null) {
            throw new IllegalStateException("unclosed applicant pause");
        }
        return pauses;
    }

    public record ClockEvent(String eventKind, String responsibleParty, Instant occurredAt) {
    }
}
