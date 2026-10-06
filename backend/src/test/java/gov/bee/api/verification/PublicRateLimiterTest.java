package gov.bee.api.verification;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.Test;

/** The service-wide backstop on the public verification route (BL-143): a window allows its limit, refuses with the seconds left, then opens again. */
class PublicRateLimiterTest {

    @Test
    void aWindowAllowsItsLimitThenRefusesWithTheSecondsLeftThenOpensAgain() {
        var clock = new AtomicLong(1_000_000);
        var limiter = new PublicRateLimiter(3);
        limiter.resetForTest(3, clock::get);
        for (int i = 0; i < 3; i++) {
            assertTrue(limiter.tryAcquire().isEmpty(), "request " + (i + 1));
        }
        clock.addAndGet(20_000);
        var refused = limiter.tryAcquire();
        assertTrue(refused.isPresent());
        assertEquals(41, refused.getAsInt());
        clock.addAndGet(39_999);
        assertEquals(1, limiter.tryAcquire().getAsInt(), "never below one second");
        clock.addAndGet(1);
        assertTrue(limiter.tryAcquire().isEmpty(), "a new window starts after a minute");
    }

    @Test
    void everyRequestCountsWhateverItAsks() {
        var limiter = new PublicRateLimiter(1);
        assertTrue(limiter.tryAcquire().isEmpty());
        assertTrue(limiter.tryAcquire().isPresent());
    }
}
