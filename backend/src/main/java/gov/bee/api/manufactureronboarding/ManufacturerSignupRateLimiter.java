package gov.bee.api.manufactureronboarding;

import java.util.OptionalInt;
import java.util.function.LongSupplier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/** Backstop on the public manufacturer signup route: whole-service window, same pattern as public verification. */
@Component
public class ManufacturerSignupRateLimiter {

    static final long WINDOW_MS = 60_000L;

    private int limit;
    private LongSupplier nowMillis = System::currentTimeMillis;
    private long windowStart = Long.MIN_VALUE;
    private int count;

    public ManufacturerSignupRateLimiter(@Value("${bee.public-signup.limit-per-minute:30}") int limit) {
        this.limit = limit;
    }

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

    public synchronized void resetForTest(int newLimit, LongSupplier clock) {
        this.limit = newLimit;
        this.nowMillis = clock;
        this.windowStart = Long.MIN_VALUE;
        this.count = 0;
    }
}
