package gov.bee.api.application;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import gov.bee.api.identity.Caller;
import gov.bee.api.identity.IdentityRepository;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/** Re-validates filing scope before returning a stored idempotent response (WP05.1c review). */
final class IdempotencyReplayGuard {

    private IdempotencyReplayGuard() {
    }

    static Optional<String> denialBeforeReplay(Caller caller, ModelApplicationRepository applications, IdentityRepository identity,
                                               ObjectMapper json, UUID targetId, String storedBody) {
        if (!ModelDraftPolicy.canWrite(caller)) {
            return Optional.of("no_write_scope");
        }
        Optional<UUID> filing = ModelDraftPolicy.filingOrganisation(caller);
        if (filing.isEmpty()) {
            return Optional.of("no_write_scope");
        }
        if (IdempotencyRepository.CREATE_TARGET.equals(targetId)) {
            return createReplayAllowed(caller, identity, json, storedBody);
        }
        if (applications.findOwned(targetId, filing.get()).isEmpty()) {
            return Optional.of("not_found");
        }
        return Optional.empty();
    }

    private static Optional<String> createReplayAllowed(Caller caller, IdentityRepository identity, ObjectMapper json, String storedBody) {
        try {
            @SuppressWarnings("unchecked")
            Map<String, Object> body = json.readValue(storedBody, Map.class);
            Object org = body.get("organisation");
            if (!(org instanceof String orgCode) || orgCode.isBlank()) {
                return Optional.of("no_write_scope");
            }
            var memberships = identity.activeMemberships(caller.accountId());
            if (memberships.size() != 1 || !orgCode.equals(memberships.get(0).code())) {
                return Optional.of("no_write_scope");
            }
            return Optional.empty();
        } catch (Exception e) {
            return Optional.of("internal_error");
        }
    }


}
