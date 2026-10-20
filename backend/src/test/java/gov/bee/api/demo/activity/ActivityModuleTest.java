package gov.bee.api.demo.activity;

import static org.junit.jupiter.api.Assertions.assertEquals;

import gov.bee.api.demo.DemoResult;
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

/** A caller with no oversight role and no organisation cannot read the trail, and a malformed record is refused. No database is touched (refusals come first). */
class ActivityModuleTest {

    private static final ActivityModule MODULE = new ActivityModule(new StaticListableBeanFactory().getBeanProvider(JdbcTemplate.class));
    private static final Caller NOBODY = new Caller(UUID.randomUUID(), "nobody", List.of(new RoleGrant("finance", "own-org")), Set.of());

    @Test
    void callersWithoutOversightOrOrganisationAreDeniedAndBadRecordsRefused() {
        assertEquals(HttpStatus.FORBIDDEN, MODULE.handle(NOBODY, "GET", null, null, Map.of(), Map.of()).status());
        assertEquals(HttpStatus.BAD_REQUEST, MODULE.handle(NOBODY, "POST", null, null, Map.of(), Map.of("kind", "wander", "action", "x")).status());
        assertEquals(HttpStatus.BAD_REQUEST, MODULE.handle(NOBODY, "POST", null, null, Map.of(), Map.of("kind", "login")).status());
        assertEquals(HttpStatus.NOT_FOUND, MODULE.handle(NOBODY, "GET", "x", null, Map.of(), Map.of()).status());
    }
}
