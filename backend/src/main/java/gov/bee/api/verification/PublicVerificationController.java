package gov.bee.api.verification;

import gov.bee.api.web.ApiErrors;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.regex.Pattern;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Public verification of a certificate (the owner's assumption D8, not a BEE decision): anyone may ask whether a registration ID is
 * valid. There is no sign-in, so this is the one route that must be careful about what it says. It reads only the
 * {@code public_certificate} view (the registration ID, brand, model, category, stars, efficiency figure, validity dates and the
 * manufacturer's legal name), and a registration that does not exist and a malformed ID get exactly the same answer, so the route
 * cannot be used to tell the two apart. Status is valid or expired, worked out from the dates; revoked is not built.
 */
@RestController
public class PublicVerificationController {

    private static final Pattern REGISTRATION_ID = Pattern.compile("^BEE/[A-Z]{2,10}/[0-9]{4}/[0-9]{5,}$");
    private static final ZoneId INDIA = ZoneId.of("Asia/Kolkata");

    private final PublicVerificationRepository repository;

    public PublicVerificationController(PublicVerificationRepository repository) {
        this.repository = repository;
    }

    @GetMapping("/api/public/verification")
    public ResponseEntity<Map<String, Object>> verify(@RequestParam(name = "reg", required = false) String reg) {
        if (reg == null || reg.isBlank()) {
            return ApiErrors.response(HttpStatus.UNPROCESSABLE_ENTITY, "validation_failed");
        }
        String id = reg.trim();
        if (!REGISTRATION_ID.matcher(id).matches()) {
            return ApiErrors.response(HttpStatus.NOT_FOUND, "not_found");
        }
        return repository.find(id).map(c -> ResponseEntity.ok(view(c, LocalDate.now(INDIA)))).orElseGet(() -> ApiErrors.response(HttpStatus.NOT_FOUND, "not_found"));
    }

    static Map<String, Object> view(PublicVerificationRepository.PublicCertificate c, LocalDate today) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("registrationId", c.registrationId());
        m.put("manufacturer", c.manufacturer());
        m.put("brandName", c.brandName());
        m.put("modelNumber", c.modelNumber());
        m.put("category", c.category());
        m.put("stars", c.stars());
        m.put("verifiedIseer", c.verifiedIseer().toPlainString());
        m.put("validFrom", c.validFrom().toString());
        m.put("validTo", c.validTo().toString());
        m.put("status", today.isAfter(c.validTo()) ? "expired" : today.isBefore(c.validFrom()) ? "not_yet_valid" : "valid");
        m.put("localDemoCertificate", true);
        return m;
    }
}
