package gov.bee.api.demo.payments;

import java.math.BigDecimal;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/** Data access of the simulated payment gateway (demonstration slice S1). The runtime login can insert, read and update only status columns. */
@Repository
public class PaymentRepository {

    static final ZoneId IST = ZoneId.of("Asia/Kolkata");

    public record Payment(UUID id, UUID applicationId, UUID organisationId, BigDecimal amountInr, String status, String gatewayRef,
                          UUID startedBy, String receiptNumber, Instant createdAt, Instant settledAt) {
    }

    public record ApplicationFee(UUID id, String reference, UUID organisationId, String state, String brandName, String modelNumber,
                                 BigDecimal amountInr, BigDecimal taxRatePercent, BigDecimal taxInr, BigDecimal totalInr) {
    }

    private static final String PAYMENT_COLUMNS =
        "p.id, p.application_id, p.organisation_id, p.amount_inr, p.status, p.gateway_ref, p.started_by_account_id, p.receipt_number, p.created_at, p.settled_at";

    private final java.util.function.Supplier<JdbcTemplate> source;

    /** Spring wiring: the JdbcTemplate is looked up on first use, so a context without a database (the contract test) still starts. */
    @org.springframework.beans.factory.annotation.Autowired
    public PaymentRepository(org.springframework.beans.factory.ObjectProvider<JdbcTemplate> provider) {
        this.source = provider::getObject;
    }

    public PaymentRepository(JdbcTemplate jdbc) {
        this.source = () -> jdbc;
    }

    private JdbcTemplate jdbc() {
        return source.get();
    }

    private static Payment payment(java.sql.ResultSet rs, int i) throws java.sql.SQLException {
        Timestamp settled = rs.getTimestamp("settled_at");
        return new Payment(rs.getObject("id", UUID.class), rs.getObject("application_id", UUID.class), rs.getObject("organisation_id", UUID.class),
            rs.getBigDecimal("amount_inr"), rs.getString("status"), rs.getString("gateway_ref"), rs.getObject("started_by_account_id", UUID.class),
            rs.getString("receipt_number"), rs.getTimestamp("created_at").toInstant(), settled == null ? null : settled.toInstant());
    }

    private static ApplicationFee fee(java.sql.ResultSet rs, int i) throws java.sql.SQLException {
        return new ApplicationFee(rs.getObject("id", UUID.class), rs.getString("reference"), rs.getObject("organisation_id", UUID.class), rs.getString("state"),
            rs.getString("brand_name"), rs.getString("model_number"), rs.getBigDecimal("amount_inr"), rs.getBigDecimal("tax_rate_percent"),
            rs.getBigDecimal("tax_inr"), rs.getBigDecimal("total_inr"));
    }

    private static final String FEE_SELECT =
        "SELECT a.id, a.reference, a.organisation_id, a.state, a.brand_name, a.model_number, f.amount_inr, f.tax_rate_percent, f.tax_inr, f.total_inr "
            + "FROM model_application a JOIN model_application_fee_snapshot f ON f.application_id = a.id ";

    /** An application of the organisation with its fee snapshot, in any state; empty when it is not the organisation's or has no snapshot. */
    public Optional<ApplicationFee> applicationOf(UUID applicationId, UUID organisationId) {
        return jdbc().query(FEE_SELECT + "WHERE a.id = ? AND a.organisation_id = ?", PaymentRepository::fee, applicationId, organisationId).stream().findFirst();
    }

    /** The organisation's applications awaiting the fee, with the fee snapshot. */
    public List<ApplicationFee> feeDue(UUID organisationId) {
        return jdbc().query(FEE_SELECT + "WHERE a.organisation_id = ? AND a.state = 'fee_due' ORDER BY a.reference", PaymentRepository::fee, organisationId);
    }

    public Optional<Payment> find(UUID id) {
        return jdbc().query("SELECT " + PAYMENT_COLUMNS + " FROM payment p WHERE p.id = ?", PaymentRepository::payment, id).stream().findFirst();
    }

    /** Locks the row until the transaction ends, so two callbacks for one payment are handled one after the other. */
    public Optional<Payment> findForUpdate(UUID id) {
        return jdbc().query("SELECT " + PAYMENT_COLUMNS + " FROM payment p WHERE p.id = ? FOR UPDATE", PaymentRepository::payment, id).stream().findFirst();
    }

    public boolean hasLivePayment(UUID applicationId) {
        Integer n = jdbc().queryForObject("SELECT count(*) FROM payment WHERE application_id = ? AND status IN ('initiated', 'paid')", Integer.class, applicationId);
        return n != null && n > 0;
    }

    public Payment start(ApplicationFee app, UUID actor, String actorRole) {
        String ref = "SIMGW-" + UUID.randomUUID().toString().replace("-", "").substring(0, 8).toUpperCase();
        UUID id = UUID.randomUUID();
        jdbc().update("INSERT INTO payment (id, application_id, organisation_id, amount_inr, gateway_ref, started_by_account_id) VALUES (?, ?, ?, ?, ?, ?)",
            id, app.id(), app.organisationId(), app.totalInr(), ref, actor);
        event(id, "started", actor, actorRole, "Fee " + app.totalInr().toPlainString() + " INR at the simulated gateway");
        return find(id).orElseThrow();
    }

    /** The first callback stored for this payload hash, if any. */
    public Optional<String> callbackOutcome(String sha256) {
        return jdbc().query("SELECT outcome FROM payment_callback WHERE payload_sha256 = ?", (rs, i) -> rs.getString("outcome"), sha256).stream().findFirst();
    }

    /** Records the callback and settles the payment (initiated to paid or failed) in the caller's transaction. */
    public Payment settle(Payment p, String outcome, String sha256, UUID actor, String actorRole) {
        jdbc().update("INSERT INTO payment_callback (payment_id, gateway_ref, outcome, payload_sha256) VALUES (?, ?, ?, ?)", p.id(), p.gatewayRef(), outcome, sha256);
        String receipt = "paid".equals(outcome) ? nextReceiptNumber() : null;
        int n = jdbc().update("UPDATE payment SET status = ?, receipt_number = ?, settled_at = now() WHERE id = ? AND status = 'initiated'", outcome, receipt, p.id());
        if (n != 1) {
            throw new IllegalStateException("payment not settled");
        }
        event(p.id(), outcome, actor, actorRole, "Simulated gateway callback " + outcome + ", payload " + sha256.substring(0, 12));
        return find(p.id()).orElseThrow();
    }

    private String nextReceiptNumber() {
        LocalDate today = LocalDate.now(IST);
        Integer n = jdbc().queryForObject(
            "INSERT INTO payment_receipt_counter (receipt_day, last_value) VALUES (?, 1) "
                + "ON CONFLICT (receipt_day) DO UPDATE SET last_value = payment_receipt_counter.last_value + 1 RETURNING last_value",
            Integer.class, java.sql.Date.valueOf(today));
        return String.format("SIMRCPT-%s-%04d", today.toString().replace("-", ""), n);
    }

    private void event(UUID paymentId, String event, UUID actor, String role, String detail) {
        jdbc().update("INSERT INTO payment_event (payment_id, event, actor_account_id, actor_role, detail) VALUES (?, ?, ?, ?, ?)", paymentId, event, actor, role, detail);
    }

    /** A row for the screen: the payment with its application reference, fee lines and, for Finance, who started it. */
    public List<Map<String, Object>> rows(UUID organisationOrNull) {
        String sql = "SELECT " + PAYMENT_COLUMNS + ", a.reference, a.brand_name, a.model_number, o.code AS organisation_code, "
            + "f.amount_inr AS fee_amount, f.tax_rate_percent, f.tax_inr, f.total_inr, "
            + "(SELECT c.receipt_reference FROM model_application_fee_confirmation c WHERE c.application_id = p.application_id ORDER BY c.confirmed_at DESC LIMIT 1) AS confirmed_reference "
            + "FROM payment p JOIN model_application a ON a.id = p.application_id JOIN organisation o ON o.id = p.organisation_id "
            + "LEFT JOIN model_application_fee_snapshot f ON f.application_id = p.application_id "
            + (organisationOrNull == null ? "" : "WHERE p.organisation_id = ? ") + "ORDER BY p.created_at DESC, p.id LIMIT 200";
        Object[] args = organisationOrNull == null ? new Object[0] : new Object[] {organisationOrNull};
        return jdbc().query(sql, (rs, i) -> {
            Payment p = payment(rs, i);
            Map<String, Object> m = new LinkedHashMap<>(view(p));
            m.put("applicationReference", rs.getString("reference"));
            m.put("brandName", rs.getString("brand_name"));
            m.put("modelNumber", rs.getString("model_number"));
            m.put("organisationCode", rs.getString("organisation_code"));
            m.put("feeConfirmed", rs.getString("confirmed_reference") != null);
            m.put("feeConfirmationReference", rs.getString("confirmed_reference"));
            if ("paid".equals(p.status())) {
                m.put("receipt", receipt(p, rs.getString("reference"), rs.getBigDecimal("fee_amount"), rs.getBigDecimal("tax_rate_percent"),
                    rs.getBigDecimal("tax_inr"), rs.getBigDecimal("total_inr")));
            }
            return m;
        }, args);
    }

    public static Map<String, Object> view(Payment p) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", p.id().toString());
        m.put("applicationId", p.applicationId().toString());
        m.put("amountInr", p.amountInr().toPlainString());
        m.put("status", p.status());
        m.put("gatewayRef", p.gatewayRef());
        m.put("receiptNumber", p.receiptNumber());
        m.put("createdAt", p.createdAt().toString());
        m.put("settledAt", p.settledAt() == null ? null : p.settledAt().toString());
        return m;
    }

    static Map<String, Object> receipt(Payment p, String reference, BigDecimal feeAmount, BigDecimal ratePercent, BigDecimal taxInr, BigDecimal totalInr) {
        Map<String, Object> r = new LinkedHashMap<>();
        r.put("receiptNumber", p.receiptNumber());
        r.put("applicationReference", reference);
        r.put("gatewayRef", p.gatewayRef());
        r.put("paidAt", p.settledAt() == null ? null : p.settledAt().toString());
        r.put("feeInr", feeAmount == null ? null : feeAmount.toPlainString());
        r.put("taxRatePercent", ratePercent == null ? null : ratePercent.toPlainString());
        r.put("taxInr", taxInr == null ? null : taxInr.toPlainString());
        r.put("amountInr", p.amountInr().toPlainString());
        r.put("note", "Simulated receipt from a local demonstration, not a BEE document");
        return r;
    }

    /** Totals by status, the paid total, the confirmed receipts total, and the differences between them. */
    public Map<String, Object> reconciliation() {
        List<Map<String, Object>> byStatus = jdbc().query("SELECT status, count(*) AS n, COALESCE(sum(amount_inr), 0) AS total FROM payment GROUP BY status ORDER BY status",
            (rs, i) -> {
                Map<String, Object> m = new LinkedHashMap<>();
                m.put("status", rs.getString("status"));
                m.put("count", rs.getInt("n"));
                m.put("totalInr", rs.getBigDecimal("total").setScale(2).toPlainString());
                return m;
            });
        BigDecimal paid = jdbc().queryForObject("SELECT COALESCE(sum(amount_inr), 0) FROM payment WHERE status = 'paid'", BigDecimal.class);
        BigDecimal confirmed = jdbc().queryForObject("SELECT COALESCE(sum(amount_inr), 0) FROM model_application_fee_confirmation", BigDecimal.class);
        Integer confirmedCount = jdbc().queryForObject("SELECT count(*) FROM model_application_fee_confirmation", Integer.class);
        Integer legacy = jdbc().queryForObject(
            "SELECT count(*) FROM model_application_fee_confirmation c WHERE NOT EXISTS (SELECT 1 FROM payment p WHERE p.application_id = c.application_id AND p.status = 'paid')", Integer.class);
        BigDecimal legacyTotal = jdbc().queryForObject(
            "SELECT COALESCE(sum(c.amount_inr), 0) FROM model_application_fee_confirmation c WHERE NOT EXISTS (SELECT 1 FROM payment p WHERE p.application_id = c.application_id AND p.status = 'paid')",
            BigDecimal.class);
        List<Map<String, Object>> differences = new ArrayList<>(jdbc().query(
            "SELECT p.id, p.gateway_ref, p.amount_inr, a.reference, c.amount_inr AS confirmed_amount FROM payment p JOIN model_application a ON a.id = p.application_id "
                + "LEFT JOIN model_application_fee_confirmation c ON c.application_id = p.application_id "
                + "WHERE p.status = 'paid' AND (c.id IS NULL OR c.amount_inr <> p.amount_inr) ORDER BY p.created_at, p.id",
            (rs, i) -> {
                Map<String, Object> m = new LinkedHashMap<>();
                BigDecimal confirmedAmount = rs.getBigDecimal("confirmed_amount");
                m.put("kind", confirmedAmount == null ? "paid_not_yet_confirmed" : "amount_differs");
                m.put("paymentId", rs.getString("id"));
                m.put("applicationReference", rs.getString("reference"));
                m.put("gatewayRef", rs.getString("gateway_ref"));
                m.put("paidInr", rs.getBigDecimal("amount_inr").toPlainString());
                m.put("confirmedInr", confirmedAmount == null ? null : confirmedAmount.toPlainString());
                return m;
            }));
        List<Map<String, Object>> receipts = new ArrayList<>(rows(null).stream().filter(r -> r.containsKey("receipt"))
            .map(r -> {
                @SuppressWarnings("unchecked")
                Map<String, Object> receipt = (Map<String, Object>) r.get("receipt");
                return receipt;
            }).toList());
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("byStatus", byStatus);
        out.put("paidTotalInr", paid.setScale(2).toPlainString());
        out.put("confirmedReceiptsTotalInr", confirmed.setScale(2).toPlainString());
        out.put("confirmedReceiptsCount", confirmedCount == null ? 0 : confirmedCount);
        out.put("confirmedWithoutSimulatedPayment", legacy == null ? 0 : legacy);
        out.put("confirmedWithoutSimulatedPaymentInr", legacyTotal.setScale(2).toPlainString());
        out.put("differences", differences);
        out.put("receipts", receipts);
        out.put("note", "Confirmed receipts without a simulated payment are normal for applications confirmed before this demonstration.");
        return out;
    }
}
