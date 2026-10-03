package gov.bee.api.web;

import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.multipart.MaxUploadSizeExceededException;
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
