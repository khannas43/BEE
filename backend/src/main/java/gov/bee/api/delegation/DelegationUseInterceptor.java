package gov.bee.api.delegation;

import gov.bee.api.identity.Caller;
import gov.bee.api.identity.CallerResolver;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.util.Set;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;
import org.springframework.web.servlet.HandlerMapping;

/**
 * WP02.4c: records every successful write that passed a role check only because of a delegation. The caller notes a delegation as used when it
 * was needed (Caller#holds); this writes one row per delegation for a 2xx POST or PATCH. A failure to record is logged, never changes the answer.
 */
@Component
public class DelegationUseInterceptor implements HandlerInterceptor {

    private static final Logger LOG = LoggerFactory.getLogger(DelegationUseInterceptor.class);
    private static final Set<String> WRITES = Set.of("POST", "PATCH", "PUT", "DELETE");

    private final DelegationRepository delegations;

    public DelegationUseInterceptor(DelegationRepository delegations) {
        this.delegations = delegations;
    }

    @Override
    public void afterCompletion(HttpServletRequest request, HttpServletResponse response, Object handler, Exception ex) {
        Object attr = request.getAttribute(CallerResolver.CALLER_ATTRIBUTE);
        if (!(attr instanceof Caller caller) || !caller.usesDelegation() || !WRITES.contains(request.getMethod()) || response.getStatus() < 200
            || response.getStatus() >= 300) {
            return;
        }
        Object pattern = request.getAttribute(HandlerMapping.BEST_MATCHING_PATTERN_ATTRIBUTE);
        String route = pattern == null ? request.getRequestURI() : pattern.toString();
        String correlation = request.getHeader("X-Correlation-Id");
        for (Caller.Delegated d : caller.usedDelegations()) {
            try {
                delegations.recordUse(d.delegationId(), caller.accountId(), d.delegatorId(), d.role(), request.getMethod(), route, response.getStatus(), correlation);
            } catch (RuntimeException e) {
                LOG.warn("could not record the use of delegation {}: {}", d.delegationId(), e.getMessage());
            }
        }
    }
}
