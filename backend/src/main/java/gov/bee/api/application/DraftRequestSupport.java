package gov.bee.api.application;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Iterator;
import java.util.Map;
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

    public static boolean validModelNumber(String modelNumber) {
        String t = trim(modelNumber);
        return !t.isEmpty() && t.length() <= 64;
    }
}
