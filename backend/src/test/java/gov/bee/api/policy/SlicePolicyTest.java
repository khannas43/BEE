package gov.bee.api.policy;

import static org.assertj.core.api.Assertions.assertThat;

import gov.bee.api.identity.Caller;
import gov.bee.api.identity.IdentityRepository.RoleGrant;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.junit.jupiter.params.provider.ValueSource;

class SlicePolicyTest {

    static final UUID NOVA = UUID.fromString("00000000-0000-4000-b000-000000000001");
    static final UUID PIXEL = UUID.fromString("00000000-0000-4000-b000-000000000002");
    static final UUID APP = UUID.fromString("00000000-0000-4000-c000-000000000009");

    static Caller caller(String role, String scope, UUID... orgs) {
        return new Caller(UUID.randomUUID(), role + ".user", List.of(new RoleGrant(role, scope)), Set.of(orgs));
    }

    static ApplicationFacts app(UUID org, String state, String... assignedStages) {
        return new ApplicationFacts(APP, org, state, Set.of(assignedStages), Set.of(), true);
    }

    /* ---------- read rules ---------- */

    @Test
    void partnerReadsOnlyItsActiveOrganisations() {
        var scope = SlicePolicy.readScope(caller("manufacturer", "own-org", NOVA));
        assertThat(SlicePolicy.canRead(scope, app(NOVA, "draft"))).isTrue();
        assertThat(SlicePolicy.canRead(scope, app(PIXEL, "fee_due"))).isFalse();
        var pixel = SlicePolicy.readScope(caller("agency", "own-org", PIXEL));
        assertThat(SlicePolicy.canRead(pixel, app(NOVA, "fee_due"))).isFalse();
        assertThat(SlicePolicy.canRead(pixel, app(PIXEL, "iame_scrutiny"))).isTrue();
    }

    @Test
    void partnerWithoutActiveMembershipReadsNothing() {
        assertThat(SlicePolicy.readScope(caller("manufacturer", "own-org")).isEmpty()).isTrue();
    }

    @Test
    void assignedOfficerReadsOnlyAssignedApplications() {
        var iame = SlicePolicy.readScope(caller("iame", "assigned", UUID.randomUUID()));
        assertThat(SlicePolicy.canRead(iame, app(PIXEL, "iame_scrutiny", "iame_scrutiny"))).isTrue();
        assertThat(SlicePolicy.canRead(iame, app(PIXEL, "iame_scrutiny"))).isFalse();
        assertThat(SlicePolicy.canRead(iame, app(PIXEL, "bee_scrutiny", "iame_scrutiny"))).as("old-stage assignment cannot grant read after handoff").isFalse();
        var reviewer = SlicePolicy.readScope(caller("reviewer", "assigned"));
        assertThat(SlicePolicy.canRead(reviewer, app(NOVA, "bee_scrutiny"))).as("stage alone does not grant a reviewer").isFalse();
    }

    @Test
    void internalStageRolesReadOnlyTheirStage() {
        var finance = SlicePolicy.readScope(caller("finance", "all"));
        assertThat(SlicePolicy.canRead(finance, app(NOVA, "fee_due"))).isTrue();
        assertThat(SlicePolicy.canRead(finance, app(NOVA, "draft"))).isFalse();
        assertThat(SlicePolicy.canRead(finance, app(NOVA, "director_review"))).isFalse();
        assertThat(SlicePolicy.readScope(caller("programme", "all")).stages()).containsExactly("rating");
        assertThat(SlicePolicy.readScope(caller("director", "all")).stages()).containsExactly("director_review");
        assertThat(SlicePolicy.readScope(caller("secretary", "all")).stages()).containsExactly("secretary_approval");
    }

    @ParameterizedTest
    @ValueSource(strings = {"admin", "helpdesk", "auditor", "sda", "laboratory"})
    void nonSliceRolesReadNothing(String role) {
        assertThat(SlicePolicy.readScope(caller(role, "all")).isEmpty()).isTrue();
        assertThat(SlicePolicy.readScope(caller(role, "assigned")).isEmpty()).isTrue();
    }

    @Test
    void grantWithAScopeOtherThanTheRuleIsNotHonoured() {
        assertThat(SlicePolicy.readScope(caller("reviewer", "all")).isEmpty()).as("reviewer/all would widen").isTrue();
        assertThat(SlicePolicy.readScope(caller("iame", "own-org", PIXEL)).isEmpty()).isTrue();
        assertThat(SlicePolicy.readScope(caller("finance", "own-org", NOVA)).isEmpty()).isTrue();
        assertThat(SlicePolicy.readScope(caller("manufacturer", "assigned", NOVA)).isEmpty()).isTrue();
    }

    /* ---------- action checks for the seven steps ---------- */

    @Test
    void eachStepIsAllowedOnlyForItsActorAtItsStage() {
        var nova = caller("manufacturer", "own-org", NOVA);
        assertThat(SlicePolicy.check(SliceAction.SUBMIT, nova, app(NOVA, "draft")).allowed()).isTrue();
        assertThat(SlicePolicy.check(SliceAction.SUBMIT, nova, app(NOVA, "returned")).allowed()).isTrue();
        assertThat(SlicePolicy.check(SliceAction.CONFIRM_FEE, caller("finance", "all"), app(NOVA, "fee_due")).allowed()).isTrue();
        assertThat(SlicePolicy.check(SliceAction.IAME_RECOMMEND, caller("iame", "assigned"), app(NOVA, "iame_scrutiny", "iame_scrutiny")).allowed()).isTrue();
        assertThat(SlicePolicy.check(SliceAction.REVIEWER_FORWARD, caller("reviewer", "assigned"), app(NOVA, "bee_scrutiny", "bee_scrutiny")).allowed()).isTrue();
        assertThat(SlicePolicy.check(SliceAction.COMPUTE_RATING, caller("programme", "all"), app(NOVA, "rating")).allowed()).isTrue();
        assertThat(SlicePolicy.check(SliceAction.DIRECTOR_RECOMMEND, caller("director", "all"), app(NOVA, "director_review")).allowed()).isTrue();
        assertThat(SlicePolicy.check(SliceAction.SECRETARY_APPROVE, caller("secretary", "all"), app(NOVA, "secretary_approval")).allowed()).isTrue();
    }

    @Test
    void stepsChainWithoutGapsAndEndAtApproved() {
        var steps = SliceAction.values();
        assertThat(steps).hasSize(7);
        for (int i = 0; i < steps.length; i++) {
            assertThat(steps[i].step()).isEqualTo(i + 1);
            if (i > 0) {
                assertThat(steps[i].fromStates()).contains(steps[i - 1].toState());
            }
        }
        assertThat(steps[6].toState()).isEqualTo("approved");
        assertThat(SliceAction.CONFIRM_FEE.capacity()).as("fee confirmation is X, not A").isEqualTo("X");
    }

    @Test
    void n1CrossOrganisationActionIsDenied() {
        assertThat(SlicePolicy.check(SliceAction.SUBMIT, caller("agency", "own-org", PIXEL), app(NOVA, "draft")).reason()).isEqualTo("outside_scope");
        assertThat(SlicePolicy.check(SliceAction.SUBMIT, caller("manufacturer", "own-org", NOVA), app(PIXEL, "draft")).reason()).isEqualTo("outside_scope");
    }

    @Test
    void n2SubmissionWithoutBrandPermissionIsDenied() {
        var noBrand = new ApplicationFacts(APP, PIXEL, "draft", Set.of(), Set.of(), false);
        assertThat(SlicePolicy.check(SliceAction.SUBMIT, caller("agency", "own-org", PIXEL), noBrand).reason()).isEqualTo("brand_not_permitted");
    }

    @Test
    void n3OnlyFinanceConfirmsTheFee() {
        for (var c : List.of(caller("manufacturer", "own-org", NOVA), caller("iame", "assigned"), caller("director", "all"), caller("secretary", "all"))) {
            assertThat(SlicePolicy.check(SliceAction.CONFIRM_FEE, c, app(NOVA, "fee_due", "fee_due")).reason()).isEqualTo("role_not_permitted");
        }
    }

    @Test
    void n4FinanceHasNoTechnicalAction() {
        var finance = caller("finance", "all");
        for (var a : List.of(SliceAction.IAME_RECOMMEND, SliceAction.REVIEWER_FORWARD, SliceAction.COMPUTE_RATING, SliceAction.DIRECTOR_RECOMMEND, SliceAction.SECRETARY_APPROVE)) {
            assertThat(SlicePolicy.check(a, finance, app(NOVA, a.stage(), a.stage())).reason()).isEqualTo("role_not_permitted");
        }
    }

    @Test
    void n5IameCannotApproveOrActUnassigned() {
        var iame = caller("iame", "assigned");
        assertThat(SlicePolicy.check(SliceAction.IAME_RECOMMEND, iame, app(NOVA, "iame_scrutiny")).reason()).isEqualTo("not_assigned");
        assertThat(SlicePolicy.check(SliceAction.IAME_RECOMMEND, iame, app(NOVA, "iame_scrutiny", "bee_scrutiny")).reason()).isEqualTo("not_assigned");
        assertThat(SlicePolicy.check(SliceAction.SECRETARY_APPROVE, iame, app(NOVA, "secretary_approval", "secretary_approval")).reason()).isEqualTo("role_not_permitted");
    }

    @Test
    void n7DirectorCannotGiveFinalApprovalAndSecretaryCannotActFirst() {
        assertThat(SlicePolicy.check(SliceAction.SECRETARY_APPROVE, caller("director", "all"), app(NOVA, "secretary_approval")).reason()).isEqualTo("role_not_permitted");
        assertThat(SlicePolicy.check(SliceAction.SECRETARY_APPROVE, caller("secretary", "all"), app(NOVA, "director_review")).reason()).isEqualTo("wrong_stage");
    }

    @Test
    void n8SameUserCannotActAtTwoStages() {
        var reviewer = caller("reviewer", "assigned");
        var actedBefore = new ApplicationFacts(APP, NOVA, "bee_scrutiny", Set.of("bee_scrutiny"), Set.of(reviewer.accountId()), true);
        assertThat(SlicePolicy.check(SliceAction.REVIEWER_FORWARD, reviewer, actedBefore).reason()).isEqualTo("same_user_other_stage");
    }

    @ParameterizedTest
    @EnumSource(SliceAction.class)
    void n9ActionOutsideItsStageIsDenied(SliceAction action) {
        var actor = action.actors().get(0);
        var c = caller(actor.role(), actor.scope(), NOVA);
        assertThat(SlicePolicy.check(action, c, app(NOVA, "approved", action.stage())).reason()).isEqualTo("wrong_stage");
        assertThat(SlicePolicy.check(action, c, app(NOVA, "rejected", action.stage())).reason()).isEqualTo("wrong_stage");
    }

    @ParameterizedTest
    @ValueSource(strings = {"admin", "helpdesk", "auditor"})
    void n10NonSliceRolesPerformNoTransition(String role) {
        for (var a : SliceAction.values()) {
            assertThat(SlicePolicy.check(a, caller(role, "all", NOVA), app(NOVA, a.stage(), a.stage())).reason()).isEqualTo("not_a_slice_role");
        }
    }
}
