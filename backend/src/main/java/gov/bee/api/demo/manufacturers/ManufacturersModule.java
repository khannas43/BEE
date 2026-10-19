package gov.bee.api.demo.manufacturers;

import gov.bee.api.application.ModelDraftPolicy;
import gov.bee.api.demo.DemoModule;
import gov.bee.api.demo.DemoResult;
import gov.bee.api.identity.Caller;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.stereotype.Component;

/**
 * Manufacturer 360 (demonstration). One read of every manufacturer the caller may see, assembled from the database: company registration
 * and activation, brands with the reason for a suspension or revocation, models and certificates, fees, QR serials, production,
 * anomalies and the recent history. Staff roles read every manufacturer; a manufacturer reads only its own organisation.
 * Read only. Local demonstration, not a BEE record.
 */
@Component
public class ManufacturersModule implements DemoModule {

    private final ManufacturerDirectoryRepository directory;

    public ManufacturersModule(ManufacturerDirectoryRepository directory) {
        this.directory = directory;
    }

    @Override
    public String name() {
        return "manufacturers";
    }

    @Override
    public DemoResult handle(Caller caller, String method, String id, String action, Map<String, String> query, Map<String, Object> body) {
        if (!"GET".equals(method) || id != null || action != null) {
            return DemoResult.notFound();
        }
        Optional<UUID> only = Optional.empty();
        if (!staff(caller)) {
            only = ModelDraftPolicy.filingOrganisation(caller);
            if (only.isEmpty()) {
                return DemoResult.denied();
            }
        }
        List<Map<String, Object>> manufacturers = directory.manufacturers(only.orElse(null));
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("manufacturers", manufacturers);
        out.put("count", manufacturers.size());
        return DemoResult.ok(out);
    }

    private static boolean staff(Caller caller) {
        for (String role : new String[] {"officer", "director", "admin", "finance", "programme", "auditor", "reviewer"}) {
            if (caller.holds(role, "all")) {
                return true;
            }
        }
        return false;
    }
}
