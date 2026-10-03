package gov.bee.api.web;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.web.multipart.MaxUploadSizeExceededException;
import org.springframework.web.multipart.MultipartException;
import org.springframework.web.multipart.support.MissingServletRequestPartException;

/** WP06.1a: caller-caused multipart failures are the contract's 422, never a 500. */
class ApiExceptionHandlerTest {

    private final ApiExceptionHandler handler = new ApiExceptionHandler();

    @Test
    void malformedOrTruncatedMultipartIsValidationFailed() {
        var res = handler.missingPart(new MultipartException("Failed to parse multipart servlet request"));
        assertEquals(HttpStatus.UNPROCESSABLE_ENTITY, res.getStatusCode());
        assertEquals("validation_failed", res.getBody().get("error"));
    }

    @Test
    void missingRequiredPartIsValidationFailed() {
        var res = handler.missingPart(new MissingServletRequestPartException("file"));
        assertEquals(HttpStatus.UNPROCESSABLE_ENTITY, res.getStatusCode());
    }

    @Test
    void oversizedUploadKeepsItsDedicatedHandler() {
        // MaxUploadSizeExceededException is a MultipartException; the more specific handler still applies.
        var res = handler.uploadTooLarge(new MaxUploadSizeExceededException(1));
        assertEquals(HttpStatus.UNPROCESSABLE_ENTITY, res.getStatusCode());
    }

    @Test
    void unrelatedFailuresStillFallThroughToTheCatchAll() {
        assertEquals(HttpStatus.INTERNAL_SERVER_ERROR, handler.unexpected(new IllegalStateException("x")).getStatusCode());
    }
}
