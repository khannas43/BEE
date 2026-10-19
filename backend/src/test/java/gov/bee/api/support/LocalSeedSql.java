package gov.bee.api.support;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

/** Local seed.sql helpers for throwaway schemas (synthetic data only). */
public final class LocalSeedSql {

    static final Path SEED = Path.of("..", "local", "seed", "seed.sql");

    private LocalSeedSql() {}

    public static String current() throws IOException {
        return Files.readString(SEED);
    }

    /** Seed compatible with Flyway schemas stopped before V79 (director/secretary roles, no officer). */
    public static String beforeRoleSuccession() throws IOException {
        return current()
            .replace("'00000000-0000-4000-a000-000000000007', 'bee.officer', 'BEE Officer'",
                "'00000000-0000-4000-a000-000000000007', 'bee.director', 'BEE Director'")
            .replace("'00000000-0000-4000-a000-000000000008', 'bee.director', 'BEE Director'",
                "'00000000-0000-4000-a000-000000000008', 'bee.secretary', 'BEE Secretary'")
            .replace("('00000000-0000-4000-a000-000000000007', 'officer', 'all', true)",
                "('00000000-0000-4000-a000-000000000007', 'director', 'all', true)")
            .replace("('00000000-0000-4000-a000-000000000008', 'director', 'all', true)",
                "('00000000-0000-4000-a000-000000000008', 'secretary', 'all', true)");
    }
}
