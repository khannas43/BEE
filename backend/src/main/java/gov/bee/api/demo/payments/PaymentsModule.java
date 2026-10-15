package gov.bee.api.demo.payments;

import gov.bee.api.application.ModelDraftPolicy;
import gov.bee.api.demo.DemoModule;
import gov.bee.api.demo.DemoResult;
import gov.bee.api.identity.Caller;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.regex.Pattern;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

/**
 * Simulated payment gateway (demonstration slice S1). Local demonstration on provisional rules, not BEE rules, not a real gateway.
 * The applicant's organisation starts a payment of exactly the fee due on its snapshot; the simulated gateway's callback settles it,
 * once. This module never changes the application's state: Finance still confirms the fee in the existing screen, so the payer
 * cannot confirm their own fee.
 */
@Component
public class PaymentsModule implements DemoModule {

    private static final Pattern NONCE = Pattern.compile("^[A-Za-z0-9._-]{8,64}$");
    private static final Pattern GATEWAY_REF = Pattern.compile("^SIMGW-[0-9A-F]{8}$");

    private final PaymentRepository payments;

    public PaymentsModule(PaymentRepository payments) {
        this.payments = payments;
    }

    @Override
    public String name() {
        return "payments";
    }

    @Override
    public DemoResult handle(Caller caller, String method, String id, String action, Map<String, String> query, Map<String, Object> body) {
        boolean get = "GET".equals(method);
        if (get && id == null) {
            return list(caller);
        }
        if (get && "reconciliation".equals(id) && action == null) {
            return reconciliation(caller);
        }
        if (!get && id == null) {
            return start(caller, body);
        }
        if (!get && action == null && "reconciliation".equals(id)) {
            return DemoResult.notFound();
        }
        if (!get && "callback".equals(action)) {
            return callback(caller, id, body);
        }
        return DemoResult.notFound();
    }

    private static boolean isFinanceView(Caller caller) {
        return caller.holds("finance", "all") || caller.holds("admin", "all");
    }

    private static String actorRole(Caller caller) {
        return caller.holdsOwn("manufacturer", "own-org") ? "manufacturer" : "agency";
    }

    private DemoResult list(Caller caller) {
        Map<String, Object> out = new LinkedHashMap<>();
        if (isFinanceView(caller)) {
            out.put("view", "finance");
            out.put("payments", payments.rows(null));
            return DemoResult.ok(out);
        }
        Optional<UUID> org = ModelDraftPolicy.filingOrganisation(caller);
        if (org.isEmpty()) {
            return DemoResult.denied();
        }
        out.put("view", "applicant");
        out.put("payments", payments.rows(org.get()));
        out.put("feeDue", payments.feeDue(org.get()).stream().map(a -> {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("applicationId", a.id().toString());
            m.put("reference", a.reference());
            m.put("brandName", a.brandName());
            m.put("modelNumber", a.modelNumber());
            m.put("feeInr", a.amountInr().toPlainString());
            m.put("taxRatePercent", a.taxRatePercent().toPlainString());
            m.put("taxInr", a.taxInr().toPlainString());
            m.put("totalInr", a.totalInr().toPlainString());
            return m;
        }).toList());
        return DemoResult.ok(out);
    }

    private DemoResult reconciliation(Caller caller) {
        if (!(isFinanceView(caller) || caller.holds("auditor", "all"))) {
            return DemoResult.denied();
        }
        return DemoResult.ok(payments.reconciliation());
    }

    private DemoResult start(Caller caller, Map<String, Object> body) {
        Optional<UUID> org = ModelDraftPolicy.filingOrganisation(caller);
        if (org.isEmpty()) {
            return DemoResult.denied();
        }
        UUID appId = uuid(body.get("applicationId"));
        if (appId == null) {
            return DemoResult.invalid("applicationId is required");
        }
        var app = payments.applicationOf(appId, org.get());
        if (app.isEmpty()) {
            return DemoResult.notFound();
        }
        if (!"fee_due".equals(app.get().state())) {
            return DemoResult.invalid("The application is not awaiting its fee");
        }
        if (payments.hasLivePayment(appId)) {
            return DemoResult.error(HttpStatus.CONFLICT, "version_conflict", "A payment for this application is already open or paid");
        }
        var p = payments.start(app.get(), caller.accountId(), actorRole(caller));
        Map<String, Object> out = new LinkedHashMap<>(PaymentRepository.view(p));
        out.put("applicationReference", app.get().reference());
        return DemoResult.created(out);
    }

    private DemoResult callback(Caller caller, String id, Map<String, Object> body) {
        if (ModelDraftPolicy.filingOrganisation(caller).isEmpty()) {
            return DemoResult.denied();
        }
        UUID paymentId = uuid(id);
        if (paymentId == null) {
            return DemoResult.notFound();
        }
        var found = payments.findForUpdate(paymentId);
        // Out of scope and unknown are one answer: only the person who started the payment may use its simulated gateway.
        if (found.isEmpty() || !found.get().startedBy().equals(caller.accountId())) {
            return DemoResult.notFound();
        }
        var p = found.get();
        Object ref = body.get("gatewayRef");
        Object outcome = body.get("outcome");
        Object nonce = body.get("nonce");
        if (!(ref instanceof String r) || !GATEWAY_REF.matcher(r).matches() || !(outcome instanceof String o) || !(o.equals("paid") || o.equals("failed"))
            || !(nonce instanceof String n) || !NONCE.matcher(n).matches()) {
            return DemoResult.invalid("gatewayRef, outcome (paid or failed) and nonce (8 to 64 letters, digits, . _ -) are required");
        }
        if (!r.equals(p.gatewayRef())) {
            return DemoResult.invalid("The gateway reference does not belong to this payment");
        }
        // The amount is never read from the callback: it was fixed from the fee snapshot when the payment started.
        String hash = sha256("gatewayRef=" + r + "\noutcome=" + o + "\nnonce=" + n);
        Optional<String> first = payments.callbackOutcome(hash);
        if (first.isPresent()) {
            Map<String, Object> out = new LinkedHashMap<>(PaymentRepository.view(p));
            out.put("replayed", true);
            out.put("payloadSha256", hash);
            return DemoResult.ok(out);
        }
        if (!"initiated".equals(p.status())) {
            return DemoResult.error(HttpStatus.CONFLICT, "version_conflict", "This payment is already " + p.status() + "; a different callback is refused");
        }
        var settled = payments.settle(p, o, hash, caller.accountId(), actorRole(caller));
        Map<String, Object> out = new LinkedHashMap<>(PaymentRepository.view(settled));
        out.put("replayed", false);
        out.put("payloadSha256", hash);
        return DemoResult.ok(out);
    }

    static String sha256(String canonical) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(canonical.getBytes(StandardCharsets.UTF_8)));
        } catch (java.security.NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    private static UUID uuid(Object v) {
        if (!(v instanceof String s)) {
            return null;
        }
        try {
            return UUID.fromString(s);
        } catch (IllegalArgumentException e) {
            return null;
        }
    }
}
