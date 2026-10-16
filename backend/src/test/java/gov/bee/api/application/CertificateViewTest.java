package gov.bee.api.application;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import org.junit.jupiter.api.Test;

/** The status the applicant sees is worked out from the dates when the certificate is read. */
class CertificateViewTest {

    static ModelApplicationSubmitRepository.CertificateRow cert() {
        return new ModelApplicationSubmitRepository.CertificateRow("BEE/RAC/2026/10001", LocalDate.of(2026, 10, 6), LocalDate.of(2029, 10, 5), 4,
            new BigDecimal("4.50"), new BigDecimal("4.62"), "RAC-ISEER-DEMO-1", Instant.parse("2026-10-06T10:00:00Z"), false);
    }

    static ModelApplicationSubmitRepository.CertificateRow revokedCert() {
        var c = cert();
        return new ModelApplicationSubmitRepository.CertificateRow(c.registrationId(), c.validFrom(), c.validTo(), c.stars(), c.declaredIseer(), c.verifiedIseer(), c.schemeKey(), c.issuedAt(), true);
    }

    @Test
    void validOnEveryDayFromTheFirstToTheLast() {
        for (LocalDate d : new LocalDate[] {LocalDate.of(2026, 10, 6), LocalDate.of(2028, 1, 1), LocalDate.of(2029, 10, 5)}) {
            assertEquals("valid", ModelApplicationViewSupport.certificateView(cert(), d).get("status"), d.toString());
        }
    }

    @Test
    void expiredTheDayAfterTheLastDayAndNotYetValidBeforeTheFirst() {
        assertEquals("expired", ModelApplicationViewSupport.certificateView(cert(), LocalDate.of(2029, 10, 6)).get("status"));
        assertEquals("not_yet_valid", ModelApplicationViewSupport.certificateView(cert(), LocalDate.of(2026, 10, 5)).get("status"));
    }

    @Test
    void aCertificateRevokedOnTheSimulatedLedgerIsRevokedForItsApplicantToo() {
        gov.bee.api.demo.DemoSwitch.forceForTest(true);
        try {
            assertEquals("revoked", ModelApplicationViewSupport.certificateView(revokedCert(), LocalDate.of(2027, 1, 1)).get("status"));
            assertEquals("revoked", ModelApplicationViewSupport.certificateView(revokedCert(), LocalDate.of(2031, 1, 1)).get("status"), "revoked wins over expired, like the public answer");
            assertEquals("valid", ModelApplicationViewSupport.certificateView(cert(), LocalDate.of(2027, 1, 1)).get("status"));
            // outside the demonstration deployment the ledger has no say, as for the public answer
            gov.bee.api.demo.DemoSwitch.forceForTest(false);
            assertEquals("valid", ModelApplicationViewSupport.certificateView(revokedCert(), LocalDate.of(2027, 1, 1)).get("status"));
        } finally {
            gov.bee.api.demo.DemoSwitch.forceForTest(null);
        }
    }

    @Test
    void theViewIsAlwaysALocalDemonstrationAndCarriesTheFactsItWasIssuedOn() {
        var v = ModelApplicationViewSupport.certificateView(cert(), LocalDate.of(2026, 10, 6));
        assertEquals(true, v.get("localDemoCertificate"));
        assertEquals("BEE/RAC/2026/10001", v.get("registrationId"));
        assertEquals("4.62", v.get("verifiedIseer"));
        assertEquals(4, v.get("stars"));
    }
}
