package gov.bee.api.application;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HexFormat;
import java.util.UUID;
import java.util.concurrent.ThreadLocalRandom;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

/**
 * The model application guard (V51), against throwaway PostgreSQL: the restricted runtime login can make only the moves the stage services make
 * and cannot change the identity of a submitted application; the owner is not restricted.
 */
@Tag("db")
class ModelApplicationGuardDatabaseTest {

    static final String MAIN = "wp05guard_test_" + HexFormat.of().toHexDigits(ThreadLocalRandom.current().nextInt());
    static final Path SEED = Path.of("..", "local", "seed", "seed.sql");
    static final UUID NOVA_ORG = UUID.fromString("00000000-0000-4000-b000-000000000001");
    static JdbcTemplate admin;
    static JdbcTemplate owner;
    static JdbcTemplate db;

    static String env(String k, String d) {
        String v = System.getenv(k);
        return v == null || v.isBlank() ? d : v;
    }

    static DriverManagerDataSource sourceAs(String schema, String user, String password) {
        String url = "jdbc:postgresql://127.0.0.1:" + env("BEE_PG_PORT", "5434") + "/" + env("BEE_APP_DB", "bee_app") + (schema == null ? "" : "?currentSchema=" + schema);
        return new DriverManagerDataSource(url, user, password);
    }

    static DriverManagerDataSource migrateSource(String schema) {
        return sourceAs(schema, env("BEE_FLYWAY_DB_USER", "bee_app"), env("BEE_FLYWAY_DB_PASSWORD", env("BEE_APP_DB_PASSWORD", "bee-local-app")));
    }

    @BeforeAll
    static void migrate() throws Exception {
        admin = new JdbcTemplate(migrateSource(null));
        admin.execute("DROP SCHEMA IF EXISTS " + MAIN + " CASCADE");
        admin.execute("CREATE SCHEMA " + MAIN);
        Flyway.configure().dataSource(migrateSource(MAIN)).schemas(MAIN).defaultSchema(MAIN).createSchemas(false).locations("classpath:db/migration").load().migrate();
        owner = new JdbcTemplate(migrateSource(MAIN));
        owner.execute(Files.readString(SEED));
        db = new JdbcTemplate(sourceAs(MAIN, env("BEE_RUNTIME_DB_USER", "bee_runtime"), env("BEE_RUNTIME_DB_PASSWORD", "bee-local-runtime")));
    }

    @AfterAll
    static void drop() {
        if (admin != null) {
            admin.execute("DROP SCHEMA IF EXISTS " + MAIN + " CASCADE");
        }
    }

    UUID application(String state) {
        UUID id = UUID.randomUUID();
        owner.update("INSERT INTO model_application (id, reference, organisation_id, brand_name, category, model_number, state, version) VALUES (?, ?, ?, 'Nova Cool', 'RAC', ?, ?, 0)",
            id, "LOCAL-MA-G" + id.toString().substring(0, 6), NOVA_ORG, "G-" + id.toString().substring(0, 6), state);
        return id;
    }

    void move(UUID id, String to) {
        db.update("UPDATE model_application SET state = ?, version = version + 1 WHERE id = ?", to, id);
    }

    @Test
    void theRuntimeLoginMakesOnlyTheMovesTheStagesMake() {
        UUID id = application("draft");
        assertThrows(DataAccessException.class, () -> move(id, "approved"));
        assertThrows(DataAccessException.class, () -> move(id, "iame_scrutiny"));
        assertThrows(DataAccessException.class, () -> move(id, "rejected"));
        for (String to : new String[] {"fee_due", "iame_scrutiny", "bee_scrutiny", "rating", "director_review", "secretary_approval", "approved"}) {
            move(id, to);
        }
        assertEquals("approved", owner.queryForObject("SELECT state FROM model_application WHERE id = ?", String.class, id));
        assertThrows(DataAccessException.class, () -> move(id, "draft"), "an approved application never moves");
        assertThrows(DataAccessException.class, () -> move(id, "returned"));

        UUID back = application("bee_scrutiny");
        assertThrows(DataAccessException.class, () -> move(back, "iame_scrutiny"), "no step backwards without a return");
        assertThrows(DataAccessException.class, () -> move(back, "approved"));
        move(back, "returned");
        assertThrows(DataAccessException.class, () -> move(back, "fee_due"));
        assertThrows(DataAccessException.class, () -> move(back, "approved"));
        move(back, "bee_scrutiny");

        UUID rejected = application("rating");
        move(rejected, "rejected");
        assertThrows(DataAccessException.class, () -> move(rejected, "rating"), "a rejected application stays rejected");
        // The owner (a repair or a test) is not limited by the guard.
        owner.update("UPDATE model_application SET state = 'draft' WHERE id = ?", rejected);
        assertEquals("draft", owner.queryForObject("SELECT state FROM model_application WHERE id = ?", String.class, rejected));
    }

    @Test
    void whoWhichBrandAndWhichModelCannotChangeOnceSubmitted() {
        UUID id = application("draft");
        db.update("UPDATE model_application SET model_number = 'G-EDITED', version = version + 1 WHERE id = ?", id);
        move(id, "fee_due");
        assertThrows(DataAccessException.class, () -> db.update("UPDATE model_application SET model_number = 'G-AGAIN' WHERE id = ?", id));
        assertThrows(DataAccessException.class, () -> db.update("UPDATE model_application SET category = 'RAC', brand_name = 'Other' WHERE id = ?", id));
        assertThrows(DataAccessException.class, () -> db.update("UPDATE model_application SET organisation_id = '00000000-0000-4000-b000-000000000002' WHERE id = ?", id));
        // What the stages and the applicant do keep working: the version, the evidence on a returned application.
        db.update("UPDATE model_application SET version = version + 1 WHERE id = ?", id);
        owner.update("UPDATE model_application SET state = 'returned' WHERE id = ?", id);
        db.update("UPDATE model_application SET version = version + 1 WHERE id = ?", id);
    }
}
