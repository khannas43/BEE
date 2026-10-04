package gov.bee.api.policy;

import gov.bee.api.identity.Caller;
import gov.bee.api.identity.IdentityRepository.RoleGrant;
import java.util.List;
import java.util.Optional;

/**
 * Who may return an application to the applicant, and from which stage (FIRST_SLICE.md section 4): the owner of each
 * scrutiny or approval stage. Finance (fee confirmation) and Programme (the rating computation) do not return; Programme
 * will reject instead. This is separate from {@link SliceAction}, which is exactly the seven forward steps. The checks
 * are the same as a forward step: the role with its scope, the stage, the officer's own assignment where the scope is
 * assigned, and nobody who acted at another stage. A return made at a stage does not count as acting at another stage, so
 * the same officer may act on the application again after it comes back.
 */
public enum StageReturn {
    IAME("iame_scrutiny", new RoleGrant("iame", SlicePolicy.ASSIGNED)),
    REVIEWER("bee_scrutiny", new RoleGrant("reviewer", SlicePolicy.ASSIGNED)),
    DIRECTOR("director_review", new RoleGrant("director", SlicePolicy.ALL)),
    SECRETARY("secretary_approval", new RoleGrant("secretary", SlicePolicy.ALL));

    private final String stage;
    private final RoleGrant actor;

    StageReturn(String stage, RoleGrant actor) {
        this.stage = stage;
        this.actor = actor;
    }

    /** The state the application is in, which is also the stage an assigned officer must hold. */
    public String stage() {
        return stage;
    }

    public RoleGrant actor() {
        return actor;
    }

    public static Optional<StageReturn> forState(String state) {
        for (StageReturn r : values()) {
            if (r.stage.equals(state)) {
                return Optional.of(r);
            }
        }
        return Optional.empty();
    }

    /** The reviewed check for returning from the application's current stage. */
    public static SlicePolicy.Decision check(Caller caller, ApplicationFacts app) {
        Optional<StageReturn> rule = forState(app.state());
        if (rule.isEmpty()) {
            return SlicePolicy.decisionDeny("role_not_permitted");
        }
        return SlicePolicy.checkStage(java.util.Set.of(rule.get().stage), rule.get().stage, List.of(rule.get().actor), caller, app);
    }
}
