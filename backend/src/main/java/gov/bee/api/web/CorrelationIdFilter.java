package gov.bee.api.web;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.time.Instant;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Echoes a safe caller correlation ID, or issues one, on every response including
 * denials, and writes one structured request line per request
 * (docs/wp03/request-log.schema.json) to the bee.access logger. The ID is never an
 * authorization input. The line holds a route template, never the raw path, query,
 * headers, token or body.
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class CorrelationIdFilter extends OncePerRequestFilter {
    public static final String HEADER = "X-Correlation-Id";
    static final Pattern SAFE = Pattern.compile("[A-Za-z0-9-]{1,64}");
    private static final Pattern DETAIL = Pattern.compile("/api/model-applications/[^/]+");
    private static final Pattern HEALTH_GROUP = Pattern.compile("/actuator/health/[^/]+");
    private static final Set<String> METHODS = Set.of("GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS");
    private static final Logger access = LoggerFactory.getLogger("bee.access");

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
        throws ServletException, IOException {
        String id = request.getHeader(HEADER);
        if (id == null || !SAFE.matcher(id).matches()) {
            id = UUID.randomUUID().toString();
        }
        response.setHeader(HEADER, id);
        MDC.put("correlationId", id);
        ApiErrors.clearLastCode();
        long start = System.nanoTime();
        try {
            chain.doFilter(request, response);
        } finally {
            String code = ApiErrors.lastCode();
            access.info(line(Instant.now(), id, request.getMethod(), route(request.getRequestURI()), response.getStatus(),
                code != null ? code : "ok", (System.nanoTime() - start) / 1_000_000));
            ApiErrors.clearLastCode();
            MDC.remove("correlationId");
        }
    }

    /** The documented route template for a request path; anything else is "unmapped". */
    static String route(String path) {
        if (path == null) return "unmapped";
        if (path.equals("/api/me") || path.equals("/api/model-applications") || path.equals("/api/model-applications/eligible-brands")
            || path.equals("/actuator/health")) return path;
        if (path.matches("/api/model-applications/[^/]+/submit")) return "/api/model-applications/{id}/submit";
        if (path.matches("/api/model-applications/[^/]+/documents")) return "/api/model-applications/{id}/documents";
        if (path.matches("/api/model-applications/[^/]+/documents/[^/]+/versions/[^/]+/content")) {
            return "/api/model-applications/{id}/documents/{documentId}/versions/{versionId}/content";
        }
        if (path.matches("/api/model-applications/[^/]+/fee-confirmation")) return "/api/model-applications/{id}/fee-confirmation";
        if (path.matches("/api/model-applications/[^/]+/iame-recommendation")) return "/api/model-applications/{id}/iame-recommendation";
        if (path.matches("/api/model-applications/[^/]+/reviewer-forward")) return "/api/model-applications/{id}/reviewer-forward";
        if (path.endsWith("/history") && path.startsWith("/api/model-applications/")) return "/api/model-applications/{id}/history";
        if (DETAIL.matcher(path).matches()) return "/api/model-applications/{id}";
        if (HEALTH_GROUP.matcher(path).matches()) return "/actuator/health/{group}";
        return "unmapped";
    }

    /** Every value is a safe ID, an enum, a template, a code or a number, so no escaping is needed. */
    static String line(Instant ts, String correlationId, String method, String route, int status, String outcome, long durationMs) {
        String m = method != null && METHODS.contains(method) ? method : "OTHER";
        return "{\"ts\":\"" + ts + "\",\"layer\":\"api\",\"event\":\"request\",\"correlationId\":\"" + correlationId
            + "\",\"method\":\"" + m + "\",\"route\":\"" + route + "\",\"status\":" + status
            + ",\"outcome\":\"" + outcome + "\",\"durationMs\":" + durationMs + "}";
    }
}
