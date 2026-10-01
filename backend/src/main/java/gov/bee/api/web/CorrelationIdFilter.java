package gov.bee.api.web;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
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
 * denials, and logs one access line per request. The ID is never an authorization
 * input. The log line holds no headers, query string, token or body.
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class CorrelationIdFilter extends OncePerRequestFilter {
    public static final String HEADER = "X-Correlation-Id";
    static final Pattern SAFE = Pattern.compile("[A-Za-z0-9-]{1,64}");
    private static final Pattern UNSAFE_PATH_CHARS = Pattern.compile("[^A-Za-z0-9/._-]");
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
        long start = System.nanoTime();
        try {
            chain.doFilter(request, response);
        } finally {
            String path = request.getRequestURI();
            path = UNSAFE_PATH_CHARS.matcher(path.length() > 120 ? path.substring(0, 120) : path).replaceAll("_");
            access.info("correlationId={} method={} path={} status={} durationMs={}",
                id, request.getMethod(), path, response.getStatus(), (System.nanoTime() - start) / 1_000_000);
            MDC.remove("correlationId");
        }
    }
}
