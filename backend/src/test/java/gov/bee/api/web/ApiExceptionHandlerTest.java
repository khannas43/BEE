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
    void serverSideSpoolFailuresAreUnavailableNotACallerError() {
        var noSpace = new MultipartException("Failed to parse multipart servlet request",
            new java.io.IOException("spool", new java.nio.file.FileSystemException("/tmp/upload", null, "No space left on device")));
        assertEquals(HttpStatus.SERVICE_UNAVAILABLE, handler.missingPart(noSpace).getStatusCode());
        var noTemp = new MultipartException("Failed to parse multipart servlet request", new java.io.FileNotFoundException("/tmp/x"));
        assertEquals(HttpStatus.SERVICE_UNAVAILABLE, handler.missingPart(noTemp).getStatusCode());
        // A parse failure with a plain IOException cause (stream ended unexpectedly) stays the caller's.
        var truncated = new MultipartException("Failed to parse multipart servlet request", new java.io.IOException("Stream ended unexpectedly"));
        assertEquals(HttpStatus.UNPROCESSABLE_ENTITY, handler.missingPart(truncated).getStatusCode());
    }

    @Test
    void aFullDiskReportedAsAPlainIoExceptionIsUnavailable() {
        var diskFull = new MultipartException("Failed to parse multipart servlet request",
            new java.io.IOException("No space left on device"));
        assertEquals(HttpStatus.SERVICE_UNAVAILABLE, handler.missingPart(diskFull).getStatusCode());
        var quota = new MultipartException("x", new java.io.IOException("spool", new java.io.IOException("Disk quota exceeded")));
        assertEquals(HttpStatus.SERVICE_UNAVAILABLE, handler.missingPart(quota).getStatusCode());
    }

    @Test
    void aCyclicCauseChainTerminates() {
        var a = new java.io.IOException("a");
        var b = new java.io.IOException("b");
        a.initCause(b);
        b.initCause(a);
        var res = org.junit.jupiter.api.Assertions.assertTimeoutPreemptively(java.time.Duration.ofSeconds(5),
            () -> handler.missingPart(new MultipartException("x", a)));
        assertEquals(HttpStatus.UNPROCESSABLE_ENTITY, res.getStatusCode());
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
