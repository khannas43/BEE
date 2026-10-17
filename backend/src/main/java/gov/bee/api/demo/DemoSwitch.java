package gov.bee.api.demo;

/**
 * The demonstration deployment switch (BL-232). The demonstration API (`/api/demo/**`) and the simulated ledger's word on the public verification
 * answer exist only when the environment says {@code BEE_DEMO_LOGIN=1}, the same variable that turns on the demo sign-in in the portal. Anywhere
 * else the demo routes answer 404 and the public answer follows the certificate's dates only. Read on every call so a test can force it.
 */
public final class DemoSwitch {

    private static volatile Boolean forced;

    private DemoSwitch() {
    }

    public static boolean enabled() {
        Boolean f = forced;
        return f != null ? f : "1".equals(System.getenv("BEE_DEMO_LOGIN"));
    }

    /** Tests only: null returns to the environment. */
    public static void forceForTest(Boolean value) {
        forced = value;
    }
}
