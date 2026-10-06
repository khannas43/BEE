package gov.bee.api.notifications;

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
 * A person's own in-portal notifications (WP10.1a; the owner's assumptions, not BEE's decisions). Anyone with an effective role reads
 * only their own, newest first, and marks them read. Marking read is naturally repeatable (a read mark never goes back), so these two
 * writes take no Idempotency-Key, unlike the commands that change an application. Someone else's id and an unknown id get the same 404.
 */
@RestController
public class NotificationController {

    private final CallerResolver callers;
    private final NotificationRepository repository;

    public NotificationController(CallerResolver callers, NotificationRepository repository) {
        this.callers = callers;
        this.repository = repository;
    }

    @GetMapping("/api/notifications")
    @Transactional(readOnly = true)
    public ResponseEntity<Map<String, Object>> list(@AuthenticationPrincipal Jwt jwt) {
        var resolved = callers.resolve(jwt);
        if (resolved.caller() == null) {
            return ApiErrors.response(HttpStatus.FORBIDDEN, resolved.denial());
        }
        UUID account = resolved.caller().accountId();
        List<Map<String, Object>> items = new ArrayList<>();
        for (var n : repository.newest(account)) {
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("id", n.id().toString());
            item.put("kind", n.kind());
            item.put("message", n.message());
            item.put("applicationId", n.applicationId().toString());
            item.put("reference", n.reference());
            item.put("createdAt", n.createdAt().toString());
            item.put("read", n.read());
            items.add(item);
        }
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("unread", repository.unread(account));
        body.put("items", items);
        return ResponseEntity.ok(body);
    }

    @PostMapping("/api/notifications/{id}/read")
    @Transactional
    public ResponseEntity<Map<String, Object>> read(@AuthenticationPrincipal Jwt jwt, @PathVariable("id") String id) {
        var resolved = callers.resolve(jwt);
        if (resolved.caller() == null) {
            return ApiErrors.response(HttpStatus.FORBIDDEN, resolved.denial());
        }
        UUID account = resolved.caller().accountId();
        UUID notification;
        try {
            notification = UUID.fromString(id);
        } catch (IllegalArgumentException e) {
            return ApiErrors.response(HttpStatus.NOT_FOUND, "not_found");
        }
        if (!repository.owns(account, notification)) {
            return ApiErrors.response(HttpStatus.NOT_FOUND, "not_found");
        }
        repository.markRead(account, notification);
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("id", notification.toString());
        body.put("unread", repository.unread(account));
        return ResponseEntity.ok(body);
    }

    @PostMapping("/api/notifications/read-all")
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
