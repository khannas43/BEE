package gov.bee.api.contract;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.OffsetDateTime;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * The same strict JSON Schema subset as scripts/local/contract-lib.cjs, for the Spring
 * tests: an unknown keyword is an error, so the artifact cannot drift into something
 * this checker silently ignores. Test-only; no schema library is added.
 */
final class ContractSchema {

    static final Path ROOT = Path.of("..").toAbsolutePath().normalize();
    static final Path ARTIFACT = ROOT.resolve("docs/wp03/bee-local-api.openapi.json");
    static final Path PIN = ROOT.resolve("scripts/local/contract-pin.json");
    static final Path REQUEST_LOG = ROOT.resolve("docs/wp03/request-log.schema.json");
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final Set<String> KNOWN = Set.of("$ref", "type", "enum", "const", "required", "properties", "additionalProperties",
        "items", "minItems", "minimum", "oneOf", "format", "pattern", "description");
    private static final Pattern UUID = Pattern.compile("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$");

    private ContractSchema() {}

    static JsonNode read(Path file) throws IOException {
        return JSON.readTree(Files.readString(file));
    }

    static JsonNode parse(String text) throws IOException {
        return JSON.readTree(text);
    }

    /** Resolves "#/a/b" against the document. */
    static JsonNode resolve(JsonNode doc, String ref) {
        JsonNode n = doc;
        for (String part : ref.replaceFirst("^#/", "").split("/")) n = n.path(part);
        return n;
    }

    static List<String> validate(JsonNode schema, JsonNode value, JsonNode doc) {
        List<String> errs = new ArrayList<>();
        validate(schema, value, doc, "$", errs);
        return errs;
    }

    private static void validate(JsonNode schema, JsonNode value, JsonNode doc, String at, List<String> errs) {
        for (Iterator<String> it = schema.fieldNames(); it.hasNext(); ) {
            String k = it.next();
            if (!KNOWN.contains(k)) errs.add(at + ": schema uses unsupported keyword " + k);
        }
        if (schema.has("$ref")) {
            JsonNode target = resolve(doc, schema.get("$ref").asText());
            if (target.isMissingNode()) errs.add(at + ": unresolved " + schema.get("$ref").asText());
            else validate(target, value, doc, at, errs);
            return;
        }
        if (schema.has("oneOf")) {
            int ok = 0;
            for (JsonNode branch : schema.get("oneOf")) if (validate(branch, value, doc).isEmpty()) ok++;
            if (ok != 1) errs.add(at + ": matches " + ok + " of " + schema.get("oneOf").size() + " oneOf branches");
            return;
        }
        if (schema.has("const") && !schema.get("const").equals(value)) errs.add(at + ": expected " + schema.get("const") + ", got " + value);
        if (schema.has("enum")) {
            boolean found = false;
            for (JsonNode e : schema.get("enum")) found |= e.equals(value);
            if (!found) errs.add(at + ": " + value + " not in enum");
        }
        if (schema.has("type")) {
            List<String> types = new ArrayList<>();
            if (schema.get("type").isArray()) schema.get("type").forEach(t -> types.add(t.asText()));
            else types.add(schema.get("type").asText());
            if (types.stream().noneMatch(t -> typeOk(t, value))) {
                errs.add(at + ": expected " + types + ", got " + typeOf(value));
                return;
            }
        }
        if (value.isTextual()) {
            String s = value.asText();
            if (schema.has("format") && !formatOk(schema.get("format").asText(), s)) errs.add(at + ": not " + schema.get("format").asText());
            if (schema.has("pattern") && !Pattern.compile(schema.get("pattern").asText()).matcher(s).find()) errs.add(at + ": does not match " + schema.get("pattern").asText());
        }
        if (value.isNumber() && schema.has("minimum") && value.asDouble() < schema.get("minimum").asDouble()) errs.add(at + ": below " + schema.get("minimum"));
        if (value.isArray()) {
            if (schema.has("minItems") && value.size() < schema.get("minItems").asInt()) errs.add(at + ": fewer than " + schema.get("minItems") + " items");
            if (schema.has("items")) for (int i = 0; i < value.size(); i++) validate(schema.get("items"), value.get(i), doc, at + "[" + i + "]", errs);
        }
        if (value.isObject()) {
            for (JsonNode r : schema.path("required")) if (!value.has(r.asText())) errs.add(at + ": missing " + r.asText());
            JsonNode props = schema.path("properties");
            JsonNode extra = schema.get("additionalProperties");
            for (Iterator<Map.Entry<String, JsonNode>> it = value.fields(); it.hasNext(); ) {
                var f = it.next();
                if (props.has(f.getKey())) validate(props.get(f.getKey()), f.getValue(), doc, at + "." + f.getKey(), errs);
                else if (extra != null && extra.isBoolean() && !extra.asBoolean()) errs.add(at + ": unexpected property " + f.getKey());
                else if (extra != null && extra.isObject()) validate(extra, f.getValue(), doc, at + "." + f.getKey(), errs);
            }
        }
    }

    private static String typeOf(JsonNode v) {
        if (v.isNull()) return "null";
        if (v.isArray()) return "array";
        if (v.isObject()) return "object";
        if (v.isIntegralNumber()) return "integer";
        if (v.isNumber()) return "number";
        if (v.isBoolean()) return "boolean";
        return v.isTextual() ? "string" : "unknown";
    }

    private static boolean typeOk(String want, JsonNode v) {
        return want.equals(typeOf(v)) || (want.equals("number") && v.isNumber());
    }

    private static boolean formatOk(String format, String s) {
        return switch (format) {
            case "uuid" -> UUID.matcher(s).matches();
            case "date-time" -> {
                try {
                    OffsetDateTime.parse(s);
                    yield true;
                } catch (DateTimeParseException e) {
                    yield false;
                }
            }
            default -> false;
        };
    }
}
