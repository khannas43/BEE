package gov.bee.api.demo.producttesting;

import static org.junit.jupiter.api.Assertions.assertEquals;

import gov.bee.api.demo.ai.AiEngines;
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

/** Only the BEE Officer works product testing for now: the Administrator demonstration profile and a caller without an organisation are refused, before any database access. */
class ProductTestingModuleTest {

    private static final ProductTestingModule MODULE = new ProductTestingModule(
        new StaticListableBeanFactory().getBeanProvider(JdbcTemplate.class), new StaticListableBeanFactory().getBeanProvider(AiEngines.class));
    private static final Caller ADMIN = new Caller(UUID.randomUUID(), "bee.admin", List.of(new RoleGrant("admin", "all")), Set.of());

    @Test
    void onlyTheBeeOfficerCanReadOrWork() {
        for (String part : List.of("overview", "grievances", "selection", "cases", "mine")) {
            assertEquals(HttpStatus.FORBIDDEN, MODULE.handle(ADMIN, "GET", part, null, Map.of(), Map.of()).status(), part);
        }
        assertEquals(HttpStatus.FORBIDDEN, MODULE.handle(ADMIN, "POST", "cases", null, Map.of(), Map.of("registrationId", "BEE/RAC/2026/10101")).status());
        assertEquals(HttpStatus.FORBIDDEN, MODULE.handle(ADMIN, "POST", "draw", null, Map.of(), Map.of("size", 3)).status());
        assertEquals(HttpStatus.FORBIDDEN, MODULE.handle(ADMIN, "POST", UUID.randomUUID().toString(), "advance", Map.of(), Map.of()).status());
    }
}
