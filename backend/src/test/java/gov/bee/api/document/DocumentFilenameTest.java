package gov.bee.api.document;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

/** WP06.1a: the stored display name is sanitised, never a reason to reject a PDF. */
class DocumentFilenameTest {

    @Test
    void commonRealWorldNamesAreKept() {
        assertEquals("Test Report (1).pdf", DocumentService.sanitizeFilename("Test Report (1).pdf"));
        assertEquals("report_v2 [final].pdf", DocumentService.sanitizeFilename("report_v2 [final].pdf"));
        assertEquals("प्रतिवेदन.pdf", DocumentService.sanitizeFilename("प्रतिवेदन.pdf"));
        assertEquals("Café Lab.pdf", DocumentService.sanitizeFilename("Café Lab.pdf"));
    }

    @Test
    void pathsAndUnsafeCharactersAreRemoved() {
        assertEquals("evil.pdf", DocumentService.sanitizeFilename("../../etc/evil.pdf"));
        assertEquals("evil.pdf", DocumentService.sanitizeFilename("C:\\temp\\evil.pdf"));
        assertEquals("a_b__c.pdf", DocumentService.sanitizeFilename("a\"b\r\nc.pdf"));
        assertEquals("report.pdf", DocumentService.sanitizeFilename("..."));
    }

    @Test
    void alwaysEndsInPdfAndFitsTheColumn() {
        assertEquals("report.pdf", DocumentService.sanitizeFilename(null));
        assertEquals("report.pdf", DocumentService.sanitizeFilename(""));
        assertEquals("notes.pdf", DocumentService.sanitizeFilename("notes"));
        assertEquals("notes.txt.pdf", DocumentService.sanitizeFilename("notes.txt"));
        assertEquals("UPPER.pdf", DocumentService.sanitizeFilename("UPPER.PDF"));
        String longName = DocumentService.sanitizeFilename("x".repeat(500) + ".pdf");
        assertEquals(180, longName.length());
        assertTrue(longName.endsWith(".pdf"));
        // Never splits a surrogate pair at the cut.
        String astral = DocumentService.sanitizeFilename("𠀀".repeat(200));
        assertTrue(astral.length() <= 180 && astral.endsWith(".pdf"));
        assertTrue(Character.isValidCodePoint(astral.codePointAt(astral.length() - 5)));
    }

    @Test
    void headerNameIsAsciiOnly() {
        String hindi = DocumentService.asciiHeaderFilename("प्रतिवेदन.pdf");
        assertTrue(hindi.matches("^[A-Za-z0-9._ -]+$") && hindi.endsWith(".pdf"), hindi);
        assertEquals("Test Report _1_.pdf", DocumentService.asciiHeaderFilename("Test Report (1).pdf"));
        assertEquals("a_b.pdf", DocumentService.asciiHeaderFilename("a\"b.pdf"));
    }
}
