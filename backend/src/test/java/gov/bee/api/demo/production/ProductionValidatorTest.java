package gov.bee.api.demo.production;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import gov.bee.api.demo.production.ProductionValidator.CertInfo;
import java.time.LocalDate;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class ProductionValidatorTest {

    static final UUID ORG = UUID.randomUUID();
    static final UUID MODEL = UUID.randomUUID();

    static CertInfo lookup(String reg) {
        return switch (reg) {
            case "BEE/RAC/2026/10101" -> new CertInfo(MODEL, ORG, true);
            case "BEE/RAC/2026/10199" -> new CertInfo(UUID.randomUUID(), UUID.randomUUID(), true);
            case "BEE/RAC/2026/10198" -> new CertInfo(UUID.randomUUID(), ORG, false);
            default -> null;
        };
    }

    @Test
    void quarterRange() {
        assertEquals(LocalDate.of(2026, 9, 30), ProductionValidator.quarterRange("2026-Q3")[1]);
        assertEquals(LocalDate.of(2026, 1, 1), ProductionValidator.quarterRange("2026-Q1")[0]);
        assertNull(ProductionValidator.quarterRange("2026-Q5"));
    }

    @Test
    void headerAndCells() {
        assertNotNull(ProductionValidator.parseCsv("a,b").error());
        assertNotNull(ProductionValidator.parseCsv("registration_id,units,period_start,period_end\n").error());
        var p = ProductionValidator.parseCsv("Registration_ID, units ,period_start,period_end\r\n\r\nBEE/RAC/2026/10101,\"5\",2026-07-01,2026-07-31\n");
        assertNull(p.error());
        assertEquals(1, p.rows().size());
        assertEquals(3, p.rows().get(0).line());
        assertEquals("5", p.rows().get(0).units());
    }

    @Test
    void everyRowRule() {
        String csv = String.join("\n", "registration_id,units,period_start,period_end",
            "BEE/RAC/2026/10101,100,2026-07-01,2026-07-31",
            "BEE/RAC/2026/10101,100,2026-07-01,2026-07-31",
            "BEE/RAC/2026/10101,0,2026-08-01,2026-08-31",
            "BEE/RAC/2026/10101,10000001,2026-08-01,2026-08-31",
            "BEE/RAC/2026/10101,12.5,2026-08-01,2026-08-31",
            "BEE/RAC/2026/10101,10,2026-09-01,2026-10-01",
            "BEE/RAC/2026/10101,10,2026-09-31,2026-09-30",
            "BEE/RAC/2026/10199,10,2026-08-01,2026-08-31",
            "BEE/RAC/2026/10198,10,2026-08-01,2026-08-31",
            "BEE/NOPE/1,10,2026-08-01,2026-08-31",
            "BEE/RAC/2026/10101,10,2026-08-01",
            "BEE/RAC/2026/10101,10000000,2026-09-01,2026-09-30");
        var results = ProductionValidator.validate(ProductionValidator.parseCsv(csv).rows(), "2026-Q3", ORG, ProductionValidatorTest::lookup, Set.of());
        List<Boolean> ok = results.stream().map(r -> r.ok()).toList();
        assertEquals(List.of(true, false, false, false, false, false, false, false, false, false, false, true), ok);
        assertTrue(results.get(1).message().startsWith("Duplicate"));
        assertEquals(3, results.get(0).line() + 1);
        assertFalse(results.get(7).ok());
        assertTrue(results.get(7).message().contains("another organisation"));
        assertTrue(results.get(8).message().contains("not approved"));
    }

    @Test
    void duplicateAgainstStoredRows() {
        var rows = ProductionValidator.parseCsv("registration_id,units,period_start,period_end\nBEE/RAC/2026/10101,5,2026-07-01,2026-07-31").rows();
        var existing = Set.of(ProductionValidator.key(MODEL, LocalDate.of(2026, 7, 1), LocalDate.of(2026, 7, 31)));
        assertFalse(ProductionValidator.validate(rows, "2026-Q3", ORG, ProductionValidatorTest::lookup, existing).get(0).ok());
    }
}
