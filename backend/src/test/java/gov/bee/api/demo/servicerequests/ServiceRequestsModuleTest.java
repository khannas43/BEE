package gov.bee.api.demo.servicerequests;

import static org.junit.jupiter.api.Assertions.assertEquals;

import gov.bee.api.demo.DemoResult;
import gov.bee.api.demo.quarterlytest.QuarterlyTestModule;
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

/** The Admin demonstration profile reads but does not change: it cannot raise or answer a service request or record a quarterly test result. No database is touched (refusals come first). */
class ServiceRequestsModuleTest {

    private static final Caller ADMIN = new Caller(UUID.randomUUID(), "bee.admin", List.of(new RoleGrant("admin", "all")), Set.of());
    private static final ServiceRequestsModule REQUESTS = new ServiceRequestsModule(new StaticListableBeanFactory().getBeanProvider(JdbcTemplate.class));
    private static final QuarterlyTestModule TESTS = new QuarterlyTestModule(new StaticListableBeanFactory().getBeanProvider(JdbcTemplate.class));

    @Test
    void adminDemonstrationCannotRaiseOrAnswerRequests() {
        DemoResult raise = REQUESTS.handle(ADMIN, "POST", null, null, Map.of(), Map.of("kind", "helpdesk", "subject", "Help please", "message", "Test"));
        assertEquals(HttpStatus.FORBIDDEN, raise.status());
        DemoResult answer = REQUESTS.handle(ADMIN, "POST", UUID.randomUUID().toString(), "respond", Map.of(), Map.of("status", "resolved"));
        assertEquals(HttpStatus.FORBIDDEN, answer.status());
    }

    @Test
    void adminDemonstrationCannotRecordATestResult() {
        DemoResult record = TESTS.handle(ADMIN, "POST", null, null, Map.of(), Map.of("quarter", "2026-Q3", "registrationId", "BEE/RAC/2026/10101", "result", "pass", "testedOn", "2026-10-01"));
        assertEquals(HttpStatus.FORBIDDEN, record.status());
    }
}
