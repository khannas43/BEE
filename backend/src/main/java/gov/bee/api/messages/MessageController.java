package gov.bee.api.messages;

import gov.bee.api.identity.CallerResolver;
import gov.bee.api.web.ApiErrors;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * A person's own simulated email and SMS messages (the owner's assumptions, not BEE's decisions; nothing is ever sent). Anyone with an
 * effective role reads only their own, newest first, and marks them read. Marking read is naturally repeatable (a read mark never goes
 * back), so the two writes take no Idempotency-Key. Someone else's id and an unknown id get the same 404.
 */
@RestController
public class MessageController {

    private final CallerResolver callers;
    private final MessageRepository repository;

    public MessageController(CallerResolver callers, MessageRepository repository) {
        this.callers = callers;
        this.repository = repository;
    }

    @GetMapping("/api/messages")
    @Transactional(readOnly = true)
    public ResponseEntity<Map<String, Object>> list(@AuthenticationPrincipal Jwt jwt) {
        var resolved = callers.resolve(jwt);
        if (resolved.caller() == null) {
            return ApiErrors.response(HttpStatus.FORBIDDEN, resolved.denial());
        }
        UUID account = resolved.caller().accountId();
        List<Map<String, Object>> items = new ArrayList<>();
        for (var m : repository.newest(account)) {
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("id", m.id().toString());
            item.put("channel", m.channel());
            item.put("address", m.address());
            item.put("kind", m.kind());
            item.put("reference", m.reference());
            item.put("subject", m.subject());
            item.put("body", m.body());
            item.put("createdAt", m.createdAt().toString());
            item.put("read", m.read());
            items.add(item);
        }
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("unread", repository.unread(account));
        body.put("items", items);
        return ResponseEntity.ok(body);
    }

    @PostMapping("/api/messages/{id}/read")
    @Transactional
    public ResponseEntity<Map<String, Object>> read(@AuthenticationPrincipal Jwt jwt, @PathVariable("id") String id) {
        var resolved = callers.resolve(jwt);
        if (resolved.caller() == null) {
            return ApiErrors.response(HttpStatus.FORBIDDEN, resolved.denial());
        }
        UUID account = resolved.caller().accountId();
        UUID message;
        try {
            message = UUID.fromString(id);
        } catch (IllegalArgumentException e) {
            return ApiErrors.response(HttpStatus.NOT_FOUND, "not_found");
        }
        if (!repository.owns(account, message)) {
            return ApiErrors.response(HttpStatus.NOT_FOUND, "not_found");
        }
        repository.markRead(account, message);
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("id", message.toString());
        body.put("unread", repository.unread(account));
        return ResponseEntity.ok(body);
    }

    @PostMapping("/api/messages/read-all")
    @Transactional
    public ResponseEntity<Map<String, Object>> readAll(@AuthenticationPrincipal Jwt jwt) {
        var resolved = callers.resolve(jwt);
        if (resolved.caller() == null) {
            return ApiErrors.response(HttpStatus.FORBIDDEN, resolved.denial());
        }
        UUID account = resolved.caller().accountId();
        int marked = repository.markAllRead(account);
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("marked", marked);
        body.put("unread", repository.unread(account));
        return ResponseEntity.ok(body);
    }
}
