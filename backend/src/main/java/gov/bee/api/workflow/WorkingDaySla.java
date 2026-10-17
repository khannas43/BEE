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

    /** Half-open interval [start, end) during which the SLA clock does not count working time (applicant wait, A17). */
    public record PauseInterval(Instant start, Instant end) {
        public PauseInterval {
            if (!end.isAfter(start)) {
                throw new IllegalArgumentException("pause end must be after start");
            }
        }
    }

    public record ClockEvent(String eventKind, String responsibleParty, Instant occurredAt) {
    }

    /**
     * {@code responsible_party}: {@code bureau} — BEE-side processing time counts toward SLA;
     * {@code applicant} — used on {@code pause}/{@code resume} pairs while the applicant must act (clock paused).
     */
    public static void validateClockSequence(List<ClockEvent> prior, ClockEvent next) {
        if (prior != null) {
            for (ClockEvent e : prior) {
                if (!next.occurredAt().isAfter(e.occurredAt())) {
                    throw new IllegalArgumentException("workflow_clock_not_monotonic");
                }
            }
        }
        List<ClockEvent> all = new ArrayList<>(prior == null ? List.of() : prior);
        all.add(next);
        boolean started = false;
        boolean paused = false;
        boolean stopped = false;
        for (ClockEvent e : all) {
            if (stopped) {
                throw new IllegalArgumentException("workflow_clock_after_stop");
            }
            switch (e.eventKind()) {
                case "start" -> {
                    if (started) {
                        throw new IllegalArgumentException("workflow_clock_duplicate_start");
                    }
                    if (!"bureau".equals(e.responsibleParty())) {
                        throw new IllegalArgumentException("workflow_clock_start_party");
                    }
                    started = true;
                }
                case "pause" -> {
                    if (!started || paused) {
                        throw new IllegalArgumentException("workflow_clock_pause_invalid");
                    }
                    if (!"applicant".equals(e.responsibleParty())) {
                        throw new IllegalArgumentException("workflow_clock_pause_party");
                    }
                    paused = true;
                }
                case "resume" -> {
                    if (!paused) {
                        throw new IllegalArgumentException("workflow_clock_resume_invalid");
                    }
                    if (!"applicant".equals(e.responsibleParty())) {
                        throw new IllegalArgumentException("workflow_clock_resume_party");
                    }
                    paused = false;
                }
                case "stop" -> {
                    if (!started || paused) {
                        throw new IllegalArgumentException("workflow_clock_stop_invalid");
                    }
                    if (!"bureau".equals(e.responsibleParty())) {
                        throw new IllegalArgumentException("workflow_clock_stop_party");
                    }
                    stopped = true;
                }
                default -> throw new IllegalArgumentException("workflow_clock_unknown_kind");
            }
        }
    }

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

    public static long elapsedWorkingMillis(Instant startInclusive, Instant endExclusive, CalendarSpec calendar, List<PauseInterval> pauses) {
        if (!endExclusive.isAfter(startInclusive)) {
            return 0;
        }
        List<PauseInterval> sorted = normalizePauses(pauses);
        long total = 0;
        LocalDate day = startInclusive.atZone(ZONE).toLocalDate();
        LocalDate lastDay = endExclusive.atZone(ZONE).toLocalDate();
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

    static List<PauseInterval> normalizePauses(List<PauseInterval> pauses) {
        if (pauses == null || pauses.isEmpty()) {
            return List.of();
        }
        var sorted = pauses.stream().sorted(Comparator.comparing(PauseInterval::start)).toList();
        for (int i = 1; i < sorted.size(); i++) {
            if (sorted.get(i).start().isBefore(sorted.get(i - 1).end())) {
                throw new IllegalArgumentException("workflow_pause_overlap");
            }
        }
        return sorted;
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
        return applicantPausesFromClockEvents(events, Instant.now());
    }

    public static List<PauseInterval> applicantPausesFromClockEvents(List<ClockEvent> events, Instant asOf) {
        var prior = new ArrayList<ClockEvent>();
        for (ClockEvent e : events) {
            validateClockSequence(prior, e);
            prior.add(e);
        }
        var pauses = new ArrayList<PauseInterval>();
        Instant pauseStart = null;
        for (ClockEvent e : events) {
            switch (e.eventKind()) {
                case "pause" -> {
                    if ("applicant".equals(e.responsibleParty())) {
                        if (pauseStart != null) {
                            throw new IllegalStateException("workflow_clock_nested_pause");
                        }
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
            if (!asOf.isAfter(pauseStart)) {
                throw new IllegalArgumentException("workflow_pause_asof_before_start");
            }
            pauses.add(new PauseInterval(pauseStart, asOf));
        }
        return normalizePauses(pauses);
    }
}
