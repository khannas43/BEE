package gov.bee.api.demo.ai;

import gov.bee.api.demo.DemoModule;
import gov.bee.api.demo.DemoResult;
import gov.bee.api.identity.Caller;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Component;

/**
 * Demo slice S6: five advisory AI use cases with evidence and human control. Local demonstration on synthetic and seeded data, not a BEE
 * system. Nothing here changes an application, certificate, fee or decision record: a run stores advice, a person records a disposition
 * beside it, and the model's output is never changed.
 *
 * <p>Routes inside /api/demo/ai: GET models; GET {useCase}/runs; POST {useCase}/runs; GET {runId}; POST {runId}/disposition. (The dispatcher
 * allows three path segments, so the run id stands where the brief wrote runs/{id}.)</p>
 *
 * <p>Roles. Read: the roles that may run the use case plus the oversight roles. Run and disposition: the staff who would act on the advice.
 * The auditor only reads. Manufacturer, agency, finance, IAME and other roles are denied. No segregation rule: the advice is not a decision,
 * so a person may disposition their own run, and several people may each add a disposition.</p>
 */
@Component
public class AiDemoModule implements DemoModule {

    static final Map<String, Set<String>> RUN = Map.of(
        "compliance-risk", Set.of("programme", "reviewer", "admin", "officer", "director"),
        "production-anomaly", Set.of("programme", "reviewer", "admin", "officer", "director"),
        "rating-trends", Set.of("programme", "officer", "director", "admin"),
        "helpdesk-assist", Set.of("helpdesk", "programme", "reviewer", "admin", "officer", "director"),
        "document-extraction", Set.of("reviewer", "programme", "admin", "officer", "director"));
    static final Map<String, Set<String>> READ_EXTRA = Map.of(
        "compliance-risk", Set.of("officer", "director", "auditor"),
        "production-anomaly", Set.of("officer", "auditor"),
        "rating-trends", Set.of("reviewer", "auditor"),
        "helpdesk-assist", Set.of("auditor"),
        "document-extraction", Set.of("officer", "auditor"));
    static final String ADVISORY = "advisory: a person decides";

    private final AiStore store;
    private final AiEngines engines;

    public AiDemoModule(AiStore store, AiEngines engines) {
        this.store = store;
        this.engines = engines;
    }

    @Override
    public String name() {
        return "ai";
    }

    /** The Reviewer's scope is "assigned", so the Reviewer is handled apart (BL-231); every other role in the sets counts only when held for all records. */
    private static boolean has(Caller c, Set<String> roles) {
        return gov.bee.api.demo.DemoAccess.holdsAll(c, roles);
    }

    /** What an assigned-scope Reviewer may run: the questions that need no organisation data, and the document check of an application assigned to them. */
    static final Set<String> REVIEWER_RUNS = Set.of("helpdesk-assist", "document-extraction");

    private static boolean isReviewer(Caller c) {
        return gov.bee.api.demo.DemoAccess.holdsRole(c, Set.of("reviewer"));
    }

    private static String roleUsed(Caller c, Set<String> roles) {
        return c.roles().stream().map(g -> g.role()).filter(roles::contains).sorted().findFirst().orElse("unknown");
    }

    static boolean canRun(Caller c, String useCase) {
        return has(c, RUN.get(useCase)) || (isReviewer(c) && REVIEWER_RUNS.contains(useCase));
    }

    static boolean canRead(Caller c, String useCase) {
        return canRun(c, useCase) || has(c, READ_EXTRA.get(useCase)) || (isReviewer(c) && "rating-trends".equals(useCase));
    }

    @Override
    public DemoResult handle(Caller caller, String method, String id, String action, Map<String, String> query, Map<String, Object> body) {
        if (id == null) {
            return DemoResult.notFound();
        }
        boolean get = "GET".equals(method);
        if ("models".equals(id) && action == null && get) {
            return models(caller);
        }
        if (RUN.containsKey(id)) {
            if (!"runs".equals(action)) {
                return DemoResult.notFound();
            }
            return get ? list(caller, id) : create(caller, id, body);
        }
        UUID run = parse(id);
        if (run == null) {
            return DemoResult.notFound();
        }
        if (get && action == null) {
            return detail(caller, run);
        }
        if (!get && "disposition".equals(action)) {
            return disposition(caller, run, body);
        }
        return DemoResult.notFound();
    }

    private static UUID parse(String s) {
        try {
            return UUID.fromString(s);
        } catch (IllegalArgumentException e) {
            return null;
        }
    }

    private DemoResult models(Caller caller) {
        boolean any = RUN.keySet().stream().anyMatch(u -> canRead(caller, u));
        if (!any) {
            return DemoResult.denied();
        }
        List<Map<String, Object>> list = new ArrayList<>();
        for (Map<String, Object> m : store.models()) {
            String uc = (String) m.get("useCase");
            Map<String, Object> copy = new LinkedHashMap<>(m);
            copy.put("canRead", canRead(caller, uc));
            copy.put("canRun", canRun(caller, uc));
            list.add(copy);
        }
        return DemoResult.ok(Map.of("models", list, "advisory", ADVISORY));
    }

    private DemoResult list(Caller caller, String useCase) {
        if (!canRead(caller, useCase)) {
            return DemoResult.denied();
        }
        return DemoResult.ok(Map.of("useCase", useCase, "runs", store.runs(useCase, 30), "advisory", ADVISORY));
    }

    private static String text(Map<String, Object> body, String key) {
        Object v = body.get(key);
        return v instanceof String s ? s : null;
    }

    private DemoResult create(Caller caller, String useCase, Map<String, Object> body) {
        if (!canRun(caller, useCase)) {
            return DemoResult.denied();
        }
        String modelVersion = store.modelVersion(useCase).orElse(null);
        if (modelVersion == null) {
            return DemoResult.notFound();
        }
        String inputRef = text(body, "inputRef");
        if (inputRef != null && inputRef.length() > 300) {
            return DemoResult.invalid("inputRef is at most 300 characters.");
        }
        if ("document-extraction".equals(useCase) && !has(caller, RUN.get(useCase))) {
            // an assigned-scope Reviewer may check only an application assigned to them; anything else is the same answer as an unknown one
            String ref = text(body, "applicationRef") != null ? text(body, "applicationRef") : inputRef;
            if (ref == null || !store.assignedTo(caller.accountId(), ref.trim())) {
                return DemoResult.notFound();
            }
        }
        AiEngines.Computed result;
        try {
            result = switch (useCase) {
                case "compliance-risk" -> engines.complianceRisk();
                case "production-anomaly" -> engines.productionAnomaly();
                case "rating-trends" -> engines.ratingTrends(text(body, "category") != null ? text(body, "category") : inputRef);
                case "helpdesk-assist" -> engines.helpdesk(text(body, "question") != null ? text(body, "question") : inputRef);
                default -> engines.extraction(text(body, "applicationRef") != null ? text(body, "applicationRef") : inputRef);
            };
        } catch (AiEngines.BadInput e) {
            return DemoResult.invalid(e.getMessage());
        } catch (AiEngines.Missing e) {
            return DemoResult.notFound();
        }
        UUID id = store.insertRun(useCase, modelVersion, result.dataVersion(), result.inputRef(), result.output(), result.confidence(),
            caller.accountId(), roleUsed(caller, RUN.get(useCase)));
        return DemoResult.created(runBody(id));
    }

    private Map<String, Object> runBody(UUID id) {
        Map<String, Object> run = new LinkedHashMap<>(store.run(id).orElseThrow());
        run.put("dispositions", store.dispositions(id));
        run.put("audit", store.audit(id));
        run.put("advisory", ADVISORY);
        return run;
    }

    private DemoResult detail(Caller caller, UUID id) {
        var run = store.run(id);
        // Unknown id and a use case the caller may not read give the same answer.
        if (run.isEmpty() || !canRead(caller, (String) run.get().get("useCase"))) {
            return DemoResult.notFound();
        }
        return DemoResult.ok(runBody(id));
    }

    private DemoResult disposition(Caller caller, UUID id, Map<String, Object> body) {
        var run = store.run(id);
        if (run.isEmpty() || !canRead(caller, (String) run.get().get("useCase"))) {
            return DemoResult.notFound();
        }
        String useCase = (String) run.get().get("useCase");
        if (!canRun(caller, useCase)) {
            return DemoResult.denied();
        }
        String decision = text(body, "decision");
        if (decision == null || !Set.of("accept", "override", "reject").contains(decision)) {
            return DemoResult.invalid("Decision must be accept, override or reject.");
        }
        String reason = text(body, "reason") == null ? null : text(body, "reason").trim();
        String override = text(body, "overrideValue") == null ? null : text(body, "overrideValue").trim();
        Map<String, Object> fields = null;
        if (body.get("fieldDecisions") instanceof Map<?, ?> raw) {
            if (raw.size() > 50) {
                return DemoResult.invalid("At most 50 field decisions.");
            }
            fields = new LinkedHashMap<>();
            for (Map.Entry<?, ?> e : raw.entrySet()) {
                if (String.valueOf(e.getKey()).length() > 100 || String.valueOf(e.getValue()).length() > 200) {
                    return DemoResult.invalid("A field decision is at most 100 characters for the field and 200 for the decision.");
                }
                fields.put(String.valueOf(e.getKey()), String.valueOf(e.getValue()));
            }
        }
        if (!"accept".equals(decision) && (reason == null || reason.isEmpty())) {
            return DemoResult.invalid("A reason is required to override or reject.");
        }
        if (reason != null && reason.length() > 500) {
            return DemoResult.invalid("Reason is at most 500 characters.");
        }
        if ("accept".equals(decision)) {
            override = null;
            if (reason != null && reason.isEmpty()) {
                reason = null;
            }
        }
        if ("override".equals(decision) && (override == null || override.isEmpty()) && (fields == null || fields.isEmpty())) {
            return DemoResult.invalid("An override needs your own value.");
        }
        if (override != null && override.length() > 2000) {
            return DemoResult.invalid("Override value is at most 2000 characters.");
        }
        store.insertDisposition(id, caller.accountId(), roleUsed(caller, RUN.get(useCase)), decision, reason,
            override == null || override.isEmpty() ? null : override, fields);
        return DemoResult.created(runBody(id));
    }
}
