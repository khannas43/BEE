package gov.bee.api.messages;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import gov.bee.api.demo.payments.PaymentRepository;
import gov.bee.api.demo.payments.PaymentsModule;
import gov.bee.api.identity.Caller;
import gov.bee.api.identity.IdentityRepository.RoleGrant;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ThreadLocalRandom;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.transaction.support.TransactionTemplate;

/** The simulated email and SMS outbox (V66) against throwaway PostgreSQL with the real migrations: triggers, seeding switch, own-only reads. */
@Tag("db")
class MessagesDatabaseTest {

    static final String MAIN = "demo_msg_test_" + HexFormat.of().toHexDigits(ThreadLocalRandom.current().nextInt());
    static final UUID NOVA_ORG = UUID.fromString("00000000-0000-4000-b000-000000000001");
    static final UUID PIXEL_ORG = UUID.fromString("00000000-0000-4000-b000-000000000002");
    static final UUID BEE_ORG = UUID.fromString("00000000-0000-4000-b000-000000000003");
    static final String APP_A = "00000000-0000-4000-c000-000000000a01";
    static final Caller NOVA = new Caller(UUID.fromString("00000000-0000-4000-a000-000000000001"), "nova.applicant", List.of(new RoleGrant("manufacturer", "own-org")), Set.of(NOVA_ORG));
    static final Caller PIXEL = new Caller(UUID.fromString("00000000-0000-4000-a000-000000000002"), "pixel.applicant", List.of(new RoleGrant("agency", "own-org")), Set.of(PIXEL_ORG));
    static final Caller FINANCE = new Caller(UUID.fromString("00000000-0000-4000-a000-000000000003"), "bee.finance", List.of(new RoleGrant("finance", "all")), Set.of(BEE_ORG));

    static JdbcTemplate admin;
    static JdbcTemplate owner;
    static JdbcTemplate db;
    static TransactionTemplate tx;
    static PaymentsModule payments;
    static MessageRepository messages;
    static int appModelCountBefore;

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
    static void migrateAndSeed() throws Exception {
        admin = new JdbcTemplate(migrateSource(null));
        appModelCountBefore = admin.queryForObject("SELECT count(*) FROM app.model_application", Integer.class);
        admin.execute("DROP SCHEMA IF EXISTS " + MAIN + " CASCADE");
        admin.execute("CREATE SCHEMA " + MAIN);
        Flyway.configure().dataSource(migrateSource(MAIN)).schemas(MAIN).defaultSchema(MAIN).createSchemas(false).locations("classpath:db/migration").load().migrate();
        owner = new JdbcTemplate(migrateSource(MAIN));
        owner.execute(Files.readString(Path.of("..", "local", "seed", "seed.sql")));
        // A seed runs with the switch on: its payment events must not fill anyone's outbox.
        owner.execute("SET bee.demo_seeding = 'on';\n" + Files.readString(Path.of("..", "local", "seed", "demo", "s1_payments.sql")));
        var runtime = sourceAs(MAIN, env("BEE_RUNTIME_DB_USER", "bee_runtime"), env("BEE_RUNTIME_DB_PASSWORD", "bee-local-runtime"));
        db = new JdbcTemplate(runtime);
        tx = new TransactionTemplate(new DataSourceTransactionManager(runtime));
        payments = new PaymentsModule(new PaymentRepository(db));
        messages = new MessageRepository(db);
    }

    @AfterAll
    static void dropAndAssertAppUntouched() {
        if (admin != null) {
            admin.execute("DROP SCHEMA IF EXISTS " + MAIN + " CASCADE");
            assertEquals(appModelCountBefore, admin.queryForObject("SELECT count(*) FROM app.model_application", Integer.class));
        }
    }

    static List<MessageRepository.Item> inbox(Caller c, String channel) {
        return tx.execute(st -> messages.newest(c.accountId()).stream().filter(m -> channel == null || m.channel().equals(channel)).toList());
    }

    @Test
    void aPaymentWritesMessagesToThePayerAndFinanceOnlyAndReadsAreOwnOnly() {
        assertEquals(0, inbox(NOVA, null).size(), "the seed switch kept the seeded payments out of the outbox");
        var started = tx.execute(s -> payments.handle(NOVA, "POST", null, null, Map.of(), Map.of("applicationId", APP_A)));
        assertEquals(0, inbox(NOVA, null).size(), "starting a payment sends nothing");
        String id = (String) started.body().get("id");
        String ref = (String) started.body().get("gatewayRef");
        var paid = tx.execute(s -> payments.handle(NOVA, "POST", id, "callback", Map.of(), Map.of("gatewayRef", ref, "outcome", "paid", "nonce", "nonce-msg-0001")));
        assertEquals(200, paid.status().value());

        var novaMail = inbox(NOVA, "email");
        var novaSms = inbox(NOVA, "sms");
        assertEquals(1, novaMail.size());
        assertEquals(1, novaSms.size());
        assertEquals("nova.applicant@bee-demo.invalid", novaMail.get(0).address());
        assertTrue(novaMail.get(0).subject().contains("DEMO-PAY-0001"));
        assertNull(novaSms.get(0).subject(), "an SMS has no subject");
        assertTrue(novaSms.get(0).body().length() <= 160);
        assertTrue(novaSms.get(0).address().contains("synthetic"));
        var finance = inbox(FINANCE, null);
        assertEquals(1, finance.size(), "Finance gets the 'to confirm' email, no SMS");
        assertEquals("payment_to_confirm", finance.get(0).kind());
        assertEquals(0, inbox(PIXEL, null).size(), "another organisation sees nothing");

        // A replayed callback has no second effect, so no second message.
        tx.execute(s -> payments.handle(NOVA, "POST", id, "callback", Map.of(), Map.of("gatewayRef", ref, "outcome", "paid", "nonce", "nonce-msg-0001")));
        assertEquals(1, inbox(NOVA, "email").size());
        assertEquals(2, messages.unread(NOVA.accountId()));

        // Marking read: own only, once; someone else's id is not theirs.
        UUID messageId = novaMail.get(0).id();
        assertTrue(messages.owns(NOVA.accountId(), messageId));
        assertEquals(false, messages.owns(PIXEL.accountId(), messageId));
        assertEquals(false, messages.owns(FINANCE.accountId(), messageId));
        assertEquals(1, (int) tx.execute(s -> messages.markRead(NOVA.accountId(), messageId)));
        assertEquals(0, (int) tx.execute(s -> messages.markRead(NOVA.accountId(), messageId)), "a read mark never repeats");
        assertEquals(0, (int) tx.execute(s -> messages.markRead(PIXEL.accountId(), messageId)), "another person's mark changes nothing");
        assertEquals(1, (int) tx.execute(s -> messages.markAllRead(NOVA.accountId())), "the SMS was still unread");
        assertEquals(0, messages.unread(NOVA.accountId()));
    }

    @Test
    void theRuntimeLoginCannotWriteChangeOrDeleteMessages() {
        assertThrows(DataAccessException.class, () -> db.update("INSERT INTO demo_message (recipient_account_id, channel, address, event_kind, subject, body) VALUES (?::uuid, 'email', 'x', 'test_kind', 's', 'b')", NOVA.accountId().toString()));
        assertThrows(DataAccessException.class, () -> db.update("UPDATE demo_message SET body = 'changed'"));
        assertThrows(DataAccessException.class, () -> db.update("DELETE FROM demo_message"));
        assertThrows(DataAccessException.class, () -> db.execute("TRUNCATE demo_message"));
    }
}
