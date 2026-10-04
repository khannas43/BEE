package gov.bee.api.application;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.LocalDate;
import java.util.Iterator;
import java.util.Map;
import java.util.Optional;
import java.util.TreeMap;
import java.util.regex.Pattern;

/** Canonical request bodies and idempotency-key validation for draft writes. */
public final class DraftRequestSupport {

    public static final Pattern IDEMPOTENCY_KEY = Pattern.compile("^[A-Za-z0-9-]{16,64}$");
    private static final ObjectMapper CANONICAL = new ObjectMapper().configure(SerializationFeature.ORDER_MAP_ENTRIES_BY_KEYS, true);

    private DraftRequestSupport() {
    }

    public static byte[] bodyHash(JsonNode body) {
        try {
            TreeMap<String, JsonNode> sorted = new TreeMap<>();
            Iterator<Map.Entry<String, JsonNode>> it = body.fields();
            while (it.hasNext()) {
                var e = it.next();
                sorted.put(e.getKey(), e.getValue());
            }
            return MessageDigest.getInstance("SHA-256").digest(CANONICAL.writeValueAsBytes(sorted));
        } catch (Exception e) {
            throw new IllegalArgumentException("invalid body", e);
        }
    }

    public static String trim(String value) {
        return value == null ? "" : value.trim();
    }

    public static boolean validCategory(String category) {
        return "RAC".equals(category);
    }

    private static final Pattern LABORATORY_CODE = Pattern.compile("^[A-Z0-9_-]{1,32}$");
    private static final Pattern ISO_DATE = Pattern.compile("^\\d{4}-\\d{2}-\\d{2}$");
    private static final BigDecimal MAX_ISEER = new BigDecimal("99.99");

    /**
     * The optional WP05.1d evidence fields of a draft write. A field that is absent keeps its stored value, an explicit
     * null clears it, and a present value must be well formed: a laboratory code, an ISO test date not after today
     * (India date), and a positive efficiency figure with at most two decimals. Whether the laboratory exists and is
     * accredited is checked by the service and at submit. Empty means the body carried a malformed value.
     */
    public static Optional<ModelApplicationRepository.EvidenceUpdate> evidence(JsonNode body, LocalDate today) {
        boolean setLab = body.has("laboratoryCode");
        String lab = null;
        if (setLab && !body.get("laboratoryCode").isNull()) {
            JsonNode n = body.get("laboratoryCode");
            if (!n.isTextual() || !LABORATORY_CODE.matcher(n.asText()).matches()) {
                return Optional.empty();
            }
            lab = n.asText();
        }
        boolean setDate = body.has("testedOn");
        LocalDate testedOn = null;
        if (setDate && !body.get("testedOn").isNull()) {
            JsonNode n = body.get("testedOn");
            if (!n.isTextual() || !ISO_DATE.matcher(n.asText()).matches()) {
                return Optional.empty();
            }
            try {
                testedOn = LocalDate.parse(n.asText());
            } catch (java.time.DateTimeException e) {
                return Optional.empty();
            }
            if (testedOn.isAfter(today)) {
                return Optional.empty();
            }
        }
        boolean setIseer = body.has("declaredIseer");
        BigDecimal iseer = null;
        if (setIseer && !body.get("declaredIseer").isNull()) {
            JsonNode n = body.get("declaredIseer");
            if (!n.isNumber()) {
                return Optional.empty();
            }
            iseer = n.decimalValue();
            if (iseer.signum() <= 0 || iseer.stripTrailingZeros().scale() > 2 || iseer.compareTo(MAX_ISEER) > 0) {
                return Optional.empty();
            }
        }
        return Optional.of(new ModelApplicationRepository.EvidenceUpdate(setLab, lab, setDate, testedOn, setIseer, iseer));
    }

    public static boolean validModelNumber(String modelNumber) {
        String t = trim(modelNumber);
        return !t.isEmpty() && t.length() <= 64;
    }
}
