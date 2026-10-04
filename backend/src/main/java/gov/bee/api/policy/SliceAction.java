package gov.bee.api.policy;

import gov.bee.api.identity.IdentityRepository.RoleGrant;
import java.util.List;
import java.util.Set;

/**
 * The seven FIRST_SLICE.md §3 steps: actor role and scope, capacity code, the state the
 * step acts on, and the activity that owns the transition. None is implemented as an
 * endpoint yet; every write route stays denied by default.
 */
public enum SliceAction {
    SUBMIT(1, "S", Set.of("draft", "returned"), "draft", "fee_due", "WP05.1",
        List.of(new RoleGrant("manufacturer", SlicePolicy.OWN_ORG), new RoleGrant("agency", SlicePolicy.OWN_ORG))),
    CONFIRM_FEE(2, "X", Set.of("fee_due"), "fee_due", "iame_scrutiny", "WP07.1",
        List.of(new RoleGrant("finance", SlicePolicy.ALL))),
    IAME_RECOMMEND(3, "R", Set.of("iame_scrutiny"), "iame_scrutiny", "bee_scrutiny", "WP05.2",
        List.of(new RoleGrant("iame", SlicePolicy.ASSIGNED))),
    REVIEWER_FORWARD(4, "R", Set.of("bee_scrutiny"), "bee_scrutiny", "rating", "WP05.2",
        List.of(new RoleGrant("reviewer", SlicePolicy.ASSIGNED))),
    COMPUTE_RATING(5, "X", Set.of("rating"), "rating", "director_review", "WP05.2",
        List.of(new RoleGrant("programme", SlicePolicy.ALL))),
    DIRECTOR_RECOMMEND(6, "A", Set.of("director_review"), "director_review", "secretary_approval", "WP05.2",
        List.of(new RoleGrant("director", SlicePolicy.ALL))),
    SECRETARY_APPROVE(7, "A", Set.of("secretary_approval"), "secretary_approval", "approved", "WP05.2",
        List.of(new RoleGrant("secretary", SlicePolicy.ALL)));

    private final int step;
    private final String capacity;
    private final Set<String> fromStates;
    private final String stage;
    private final String toState;
    private final String owner;
    private final List<RoleGrant> actors;

    SliceAction(int step, String capacity, Set<String> fromStates, String stage, String toState, String owner, List<RoleGrant> actors) {
        this.step = step;
        this.capacity = capacity;
        this.fromStates = fromStates;
        this.stage = stage;
        this.toState = toState;
        this.owner = owner;
        this.actors = actors;
    }

    public int step() {
        return step;
    }

    public String capacity() {
        return capacity;
    }

    public Set<String> fromStates() {
        return fromStates;
    }

    /** The stage an assigned-scope actor must hold an assignment for. */
    public String stage() {
        return stage;
    }

    public String toState() {
        return toState;
    }

    /** The activity that will implement the transition endpoint. */
    public String owner() {
        return owner;
    }

    public List<RoleGrant> actors() {
        return actors;
    }
}
