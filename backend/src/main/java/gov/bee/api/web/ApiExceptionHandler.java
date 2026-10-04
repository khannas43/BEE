package gov.bee.api.web;

import java.io.FileNotFoundException;
import java.io.IOException;
import java.nio.file.FileSystemException;
import java.util.Locale;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.multipart.MaxUploadSizeExceededException;
import org.springframework.web.multipart.MultipartException;
import org.springframework.web.multipart.support.MissingServletRequestPartException;
import org.springframework.web.servlet.resource.NoResourceFoundException;

/**
 * Failures inside an allowed request get the contract's error body instead of falling
 * through to /error (which default-deny would turn into 401/403). The client sees only
 * the code; the exception class is logged with the correlation ID, never returned.
 */
@RestControllerAdvice
public class ApiExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(ApiExceptionHandler.class);

    /** An unmatched path under an allowed prefix looks like any other unavailable record. */
    @ExceptionHandler(NoResourceFoundException.class)
    ResponseEntity<Map<String, Object>> noRoute(NoResourceFoundException e) {
        return ApiErrors.response(HttpStatus.NOT_FOUND, "not_found");
    }

    @ExceptionHandler(MaxUploadSizeExceededException.class)
    ResponseEntity<Map<String, Object>> uploadTooLarge(MaxUploadSizeExceededException e) {
        log.warn("request failed: {}", e.getClass().getSimpleName());
        return ApiErrors.response(HttpStatus.UNPROCESSABLE_ENTITY, "validation_failed");
    }

    /**
     * A malformed or truncated multipart body, or a missing required part, is the caller's validation error.
     * The same exception also wraps server-side failures while spooling the body (full or unwritable temp
     * directory), which are reported as unavailable so retries and monitoring treat them as such.
     */
    @ExceptionHandler({MultipartException.class, MissingServletRequestPartException.class})
    ResponseEntity<Map<String, Object>> missingPart(Exception e) {
        if (serverSide(e)) {
            log.error("request failed: {} caused by {} (server-side)", e.getClass().getSimpleName(),
                rootCause(e).getClass().getName());
            return ApiErrors.response(HttpStatus.SERVICE_UNAVAILABLE, "service_unavailable");
        }
        log.warn("request failed: {}", e.getClass().getSimpleName());
        return ApiErrors.response(HttpStatus.UNPROCESSABLE_ENTITY, "validation_failed");
    }

    private static final int MAX_CAUSE_DEPTH = 10;

    /**
     * File-system causes (access denied, missing temp directory) and a full disk, which Tomcat's spooling reports
     * as a plain IOException, are never the caller's doing. The walk is depth-bounded so a cyclic cause chain
     * cannot hang the failure path.
     */
    static boolean serverSide(Throwable e) {
        Throwable t = e;
        for (int depth = 0; t != null && depth < MAX_CAUSE_DEPTH; depth++, t = t.getCause() == t ? null : t.getCause()) {
            if (t instanceof FileSystemException || t instanceof FileNotFoundException) {
                return true;
            }
            String message = t.getMessage();
            if (t instanceof IOException && message != null) {
                String m = message.toLowerCase(Locale.ROOT);
                if (m.contains("no space left") || m.contains("disk quota")) {
                    return true;
                }
            }
        }
        return false;
    }

    private static Throwable rootCause(Throwable e) {
        Throwable t = e;
        for (int depth = 0; t.getCause() != null && t.getCause() != t && depth < MAX_CAUSE_DEPTH; depth++) {
            t = t.getCause();
        }
        return t;
    }

    @ExceptionHandler(DataAccessException.class)
    ResponseEntity<Map<String, Object>> database(DataAccessException e) {
        log.warn("request failed: {}", e.getClass().getSimpleName());
        return ApiErrors.response(HttpStatus.SERVICE_UNAVAILABLE, "service_unavailable");
    }

    @ExceptionHandler(Exception.class)
    ResponseEntity<Map<String, Object>> unexpected(Exception e) {
        log.error("request failed: {}", e.getClass().getSimpleName());
        return ApiErrors.response(HttpStatus.INTERNAL_SERVER_ERROR, "internal_error");
    }
}
