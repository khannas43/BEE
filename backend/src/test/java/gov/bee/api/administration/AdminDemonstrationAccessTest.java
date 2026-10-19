package gov.bee.api.administration;

import static org.assertj.core.api.Assertions.assertThat;

import gov.bee.api.identity.Caller;
import gov.bee.api.identity.IdentityRepository.RoleGrant;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class AdminDemonstrationAccessTest {

    private static Caller caller(String... roles) {
        List<RoleGrant> grants = java.util.Arrays.stream(roles).map(r -> new RoleGrant(r, "all")).toList();
        return new Caller(UUID.randomUUID(), "demo", grants, Set.of());
    }

    @Test
    void umbrellaAdminWithoutOperationalRoleIsReadOnly() {
        Caller admin = caller("admin");
        assertThat(AdminDemonstrationAccess.readOnlyUmbrella(admin)).isTrue();
        assertThat(AdminDemonstrationAccess.mayReadAllOperationalRecords(admin)).isTrue();
        assertThat(AdminDemonstrationAccess.deniesOperationalMutation(admin)).isTrue();
    }

    @Test
    void adminWithDirectorKeepsOperationalAuthority() {
        Caller both = caller("admin", "director");
        assertThat(AdminDemonstrationAccess.readOnlyUmbrella(both)).isFalse();
        assertThat(AdminDemonstrationAccess.deniesOperationalMutation(both)).isFalse();
    }

    @Test
    void manufacturerIsNotUmbrellaReadOnly() {
        Caller mfr = caller("manufacturer");
        assertThat(AdminDemonstrationAccess.readOnlyUmbrella(mfr)).isFalse();
        assertThat(AdminDemonstrationAccess.mayReadAllOperationalRecords(mfr)).isFalse();
    }
}
