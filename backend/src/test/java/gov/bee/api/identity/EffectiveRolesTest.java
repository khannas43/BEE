package gov.bee.api.identity;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.Test;

class EffectiveRolesTest {

    private static final IdentityRepository.RoleGrant FINANCE = new IdentityRepository.RoleGrant("finance", "all");
    private static final IdentityRepository.RoleGrant AUDITOR = new IdentityRepository.RoleGrant("auditor", "all");

    @Test
    void roleNeedsBothDatabaseGrantAndTokenRole() {
        assertThat(EffectiveRoles.compute(List.of(FINANCE, AUDITOR), Set.of("finance"))).containsExactly(FINANCE);
    }

    @Test
    void tokenRoleAloneGrantsNothing() {
        assertThat(EffectiveRoles.compute(List.of(), Set.of("admin", "finance"))).isEmpty();
    }

    @Test
    void databaseRoleAloneGrantsNothing() {
        assertThat(EffectiveRoles.compute(List.of(AUDITOR), Set.of())).isEmpty();
    }
}
