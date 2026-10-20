package gov.bee.api.demo.productiondetails;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;

import gov.bee.api.demo.qr.QrRepository;
import gov.bee.api.identity.Caller;
import gov.bee.api.identity.IdentityRepository.RoleGrant;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.support.StaticListableBeanFactory;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;

/** The financial year runs April to March, and a caller with neither a staff role nor an organisation is refused before any database access. */
class ProductionDetailsModuleTest {

    @Test
    void financialYearQuartersRunAprilToMarch() {
        assertArrayEquals(new int[] {2026, 1}, ProductionDetailsModule.fyOf("2026-Q2"));
        assertArrayEquals(new int[] {2026, 3}, ProductionDetailsModule.fyOf("2026-Q4"));
        assertArrayEquals(new int[] {2025, 4}, ProductionDetailsModule.fyOf("2026-Q1"));
        assertEquals("2026-27", ProductionDetailsModule.fyName(2026));
        assertEquals("1999-00", ProductionDetailsModule.fyName(1999));
        assertEquals("2026-Q2", ProductionDetailsModule.calendarQuarterOf(2026, 1));
        assertEquals("2027-Q1", ProductionDetailsModule.calendarQuarterOf(2026, 4));
    }

    @Test
    void callersWithoutStaffRoleOrOrganisationAreDenied() {
        var module = new ProductionDetailsModule(new StaticListableBeanFactory().getBeanProvider(JdbcTemplate.class), new QrRepository(new StaticListableBeanFactory().getBeanProvider(JdbcTemplate.class)));
        Caller nobody = new Caller(UUID.randomUUID(), "nobody", List.of(new RoleGrant("helpdesk", "own-org")), Set.of());
        assertEquals(HttpStatus.FORBIDDEN, module.handle(nobody, "GET", null, null, Map.of(), Map.of()).status());
        assertEquals(HttpStatus.FORBIDDEN, module.handle(nobody, "POST", "pay", null, Map.of(), Map.of("fy", "2026-27", "quarters", List.of(1))).status());
    }
}
