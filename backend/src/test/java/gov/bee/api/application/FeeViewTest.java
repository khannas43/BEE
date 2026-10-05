package gov.bee.api.application;

import static org.junit.jupiter.api.Assertions.assertEquals;

import gov.bee.api.masters.MasterVersion;
import gov.bee.api.masters.Masters.FeeRule;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** The fee as the applicant and Finance see it: the amount, the separate tax line and the whole fee due. */
class FeeViewTest {

    static MasterVersion version() {
        return new MasterVersion(UUID.randomUUID(), "RAC:new_model", 3, LocalDate.of(2026, 10, 1), null, "ref",
            MasterVersion.Verification.PROVISIONAL, "note", null, null);
    }

    @Test
    void aRuleWithATaxRateShowsTheTaxAndTheWholeFeeDue() {
        var view = ModelApplicationSubmitService.feeView(new FeeRule(version(), "RAC", "new_model", new BigDecimal("24000.00"), new BigDecimal("18.00")));
        assertEquals("24000.00", view.get("amountInr"));
        assertEquals("18.00", view.get("taxRatePercent"));
        assertEquals("4320.00", view.get("taxInr"));
        assertEquals("28320.00", view.get("totalInr"));
    }

    @Test
    void aRuleWithoutATaxRateIsUnchangedForTheApplicant() {
        var view = ModelApplicationSubmitService.feeView(new FeeRule(version(), "RAC", "new_model", new BigDecimal("24000.00")));
        assertEquals("0.00", view.get("taxRatePercent"));
        assertEquals("0.00", view.get("taxInr"));
        assertEquals("24000.00", view.get("totalInr"));
    }

    @Test
    void theFeeKeptAtSubmitShowsTheSameLines() {
        var snap = new ModelApplicationSubmitRepository.FeeSnapshotRow(UUID.randomUUID(), new BigDecimal("24999.99"), "INR", "RAC:new_model", 3, "provisional", "ref", "note",
            Instant.now(), new BigDecimal("5.50"), new BigDecimal("1375.00"), new BigDecimal("26374.99"));
        var view = ModelApplicationSubmitService.feeViewFromSnapshot(snap);
        assertEquals("5.50", view.get("taxRatePercent"));
        assertEquals("1375.00", view.get("taxInr"));
        assertEquals("26374.99", view.get("totalInr"));
    }
}
