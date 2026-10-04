package gov.bee.api.policy;

import gov.bee.api.identity.Caller;
import gov.bee.api.identity.IdentityRepository.RoleGrant;
import java.util.List;
import java.util.Optional;

/**
 * Who may reject an application permanently, and from which stage (FIRST_SLICE.md section 4: "any scrutiny, rating or
 * approval stage"). These are the owners of each of those stages: the four who can also return, plus Programme at the
 * rating stage, which can only reject. Finance (fee confirmation) does not reject. The checks are the same as a forward
 * step: the role with its scope, the stage, the officer's own assignment where the scope is assigned, and nobody who acted
 * at another stage. Separate from {@link SliceAction} (exactly the seven forward steps) and {@link StageReturn}.
 */
public enum StageReject {
    IAME("iame_scrutiny", new RoleGrant("iame", SlicePolicy.ASSIGNED)),
    REVIEWER("bee_scrutiny", new RoleGrant("reviewer", SlicePolicy.ASSIGNED)),
    PROGRAMME("rating", new RoleGrant("programme", SlicePolicy.ALL)),
    DIRECTOR("director_review", new RoleGrant("director", SlicePolicy.ALL)),
    SECRETARY("secretary_approval", new RoleGrant("secretary", SlicePolicy.ALL));

    private final String stage;
    private final RoleGrant actor;

    StageReject(String stage, RoleGrant actor) {
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

    public static Optional<StageReject> forState(String state) {
        for (StageReject r : values()) {
            if (r.stage.equals(state)) {
                return Optional.of(r);
            }
        }
        return Optional.empty();
    }

    /** The reviewed check for rejecting from the application's current stage. */
    public static SlicePolicy.Decision check(Caller caller, ApplicationFacts app) {
        Optional<StageReject> rule = forState(app.state());
        if (rule.isEmpty()) {
            return SlicePolicy.decisionDeny("role_not_permitted");
        }
        return SlicePolicy.checkStage(java.util.Set.of(rule.get().stage), rule.get().stage, List.of(rule.get().actor), caller, app);
    }
}
