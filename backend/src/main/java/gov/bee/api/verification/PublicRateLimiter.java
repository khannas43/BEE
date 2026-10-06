package gov.bee.api.verification;

import java.util.OptionalInt;
import java.util.function.LongSupplier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * A backstop on the public verification route (BL-143): at most {@code limit} requests in any one-minute window, counted for the whole
 * service, not per visitor. The portal limits each visitor (or all visitors together, when no trusted proxy tells it who is who) before a
 * request reaches here, so this ceiling only matters if something calls Spring directly. In memory and per instance: several instances would
 * each allow the limit, and a shared store belongs to the production hardening (BL-130).
 */
@Component
public class PublicRateLimiter {

    static final long WINDOW_MS = 60_000L;

    private int limit;
    private LongSupplier nowMillis = System::currentTimeMillis;
    private long windowStart = Long.MIN_VALUE;
    private int count;

    public PublicRateLimiter(@Value("${bee.public-verification.limit-per-minute:600}") int limit) {
        this.limit = limit;
    }

    /** Counts this request. Returns the seconds to wait when the window is already full, otherwise empty. */
    public synchronized OptionalInt tryAcquire() {
        long now = nowMillis.getAsLong();
        if (windowStart == Long.MIN_VALUE || now - windowStart >= WINDOW_MS) {
            windowStart = now;
            count = 0;
        }
        if (count >= limit) {
            return OptionalInt.of((int) Math.max(1, (windowStart + WINDOW_MS - now + 999) / 1000));
        }
        count++;
        return OptionalInt.empty();
    }

    /** For tests only: a different limit and clock, with an empty window. */
    public synchronized void resetForTest(int newLimit, LongSupplier clock) {
        this.limit = newLimit;
        this.nowMillis = clock;
        this.windowStart = Long.MIN_VALUE;
        this.count = 0;
    }
}
