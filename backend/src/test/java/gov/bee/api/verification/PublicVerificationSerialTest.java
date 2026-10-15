package gov.bee.api.verification;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.Optional;
import org.junit.jupiter.api.Test;

/** A QR serial is resolved like a registration ID (demo slice S2): same answer shape, and unknown, unbound or malformed all get the same 404. */
class PublicVerificationSerialTest {

    final PublicVerificationRepository repo = mock(PublicVerificationRepository.class);
    final PublicVerificationController controller = new PublicVerificationController(repo, new PublicRateLimiter(1000));
    final PublicVerificationRepository.PublicCertificate cert = new PublicVerificationRepository.PublicCertificate("BEE/RAC/2026/10901", "Nova", "Nova Cool", "NC-1",
        "RAC", 4, new BigDecimal("4.05"), LocalDate.of(2026, 10, 1), LocalDate.of(2029, 9, 30));

    @Test
    void aBoundSerialAnswersWithTheCertificateInTheUsualShape() {
        when(repo.findBySerial("BEEQ-S2D0000001")).thenReturn(Optional.of(cert));
        var r = controller.verify("beeq-s2d0000001");
        assertEquals(200, r.getStatusCode().value());
        assertEquals("BEE/RAC/2026/10901", r.getBody().get("registrationId"));
        assertEquals(PublicVerificationController.view(cert, LocalDate.now()).keySet(), r.getBody().keySet());
    }

    @Test
    void unknownUnboundAndMalformedSerialsAreTheSame404() {
        when(repo.findBySerial(any())).thenReturn(Optional.empty());
        var unknown = controller.verify("BEEQ-S2D0000002");
        var malformed = controller.verify("BEEQ-IIIIIIIIII");
        var plainMalformed = controller.verify("garbage");
        assertEquals(404, unknown.getStatusCode().value());
        assertEquals(unknown.getBody(), malformed.getBody());
        assertEquals(unknown.getBody(), plainMalformed.getBody());
        verify(repo, never()).findBySerial("BEEQ-IIIIIIIIII");
        verify(repo, never()).find("BEEQ-IIIIIIIIII");
    }
}
