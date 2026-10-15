package gov.bee.api.demo;

import gov.bee.api.identity.Caller;
import java.util.Map;

/**
 * One demonstration area behind {@code /api/demo/{module}[/{id}[/{action}]]} (payments, qr, ledger, production, mis, ai). Each demo slice
 * adds one bean of this type and touches no shared registry. The module decides who may act (role, scope, state) and writes its audit
 * rows in the same transaction; the controller only resolves the caller and dispatches. Demonstration code on the owner's assumptions,
 * not BEE rules; every response says it is simulated or local.
 */
public interface DemoModule {

    /** The path segment, for example {@code payments}. */
    String name();

    /**
     * @param method {@code GET} or {@code POST}
     * @param id     the second path segment, or null
     * @param action the third path segment, or null
     * @param query  the query parameters, first value each
     * @param body   the JSON body of a POST, empty when none
     */
    DemoResult handle(Caller caller, String method, String id, String action, Map<String, String> query, Map<String, Object> body);
}
