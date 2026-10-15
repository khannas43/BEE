package gov.bee.api.demo;

import java.util.Map;
import org.springframework.http.HttpStatus;

/** The answer of a demo module: a body, or an error code from the closed list in ApiErrors plus a short detail the screen can show. */
public record DemoResult(HttpStatus status, Map<String, Object> body, String code, String detail) {

    public static DemoResult ok(Map<String, Object> body) {
        return new DemoResult(HttpStatus.OK, body, null, null);
    }

    public static DemoResult created(Map<String, Object> body) {
        return new DemoResult(HttpStatus.CREATED, body, null, null);
    }

    public static DemoResult error(HttpStatus status, String code, String detail) {
        return new DemoResult(status, null, code, detail);
    }

    public static DemoResult notFound() {
        return error(HttpStatus.NOT_FOUND, "not_found", null);
    }

    public static DemoResult denied() {
        return error(HttpStatus.FORBIDDEN, "role_not_permitted", null);
    }

    public static DemoResult invalid(String detail) {
        return error(HttpStatus.BAD_REQUEST, "validation_failed", detail);
    }
}
