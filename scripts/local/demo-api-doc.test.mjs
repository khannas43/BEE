// BL-220: the demonstration API is outside the OpenAPI contract on purpose, but docs/demo/API.md must say what the Spring modules do.
// Run: npm run web:test
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const DEMO = path.join(ROOT, "backend/src/main/java/gov/bee/api/demo");
const doc = fs.readFileSync(path.join(ROOT, "docs/demo/API.md"), "utf8");

const modules = [];
for (const f of fs.readdirSync(DEMO, { recursive: true })) {
  if (!String(f).endsWith("Module.java")) continue;
  const src = fs.readFileSync(path.join(DEMO, String(f)), "utf8");
  const name = src.match(/public String name\(\) \{\s*return "([a-z]+)";/)?.[1];
  if (name) modules.push({ file: String(f), name, src });
}

test("every demonstration module has a section in the reference", () => {
  assert.ok(modules.length >= 7, `expected the seven demo modules, found ${modules.map((m) => m.name)}`);
  for (const m of modules) assert.match(doc, new RegExp("^### `" + m.name + "`", "m"), `${m.name} (${m.file}) has no section in docs/demo/API.md`);
});

test("every action a module switches on is named in its section", () => {
  for (const m of modules) {
    const start = doc.search(new RegExp("^### `" + m.name + "`", "m"));
    const next = doc.slice(start + 5).search(/^### /m);
    const section = doc.slice(start, next === -1 ? undefined : start + 5 + next);
    // the cases of every switch (action), and the names compared with id or action by hand
    const cases = [...m.src.matchAll(/switch \(action\) \{([\s\S]{0,900}?)\n\s*\};?\n/g)].flatMap((x) => [...x[1].matchAll(/case "([a-z][a-z-]*)" ->/g)].map((y) => y[1]));
    const compared = [...m.src.matchAll(/(?:"([a-z][a-z-]*)"\.equals\((?:id|action)\)|(?:id|action)\.equals\("([a-z][a-z-]*)"\))/g)].map((x) => x[1] ?? x[2]);
    const actions = [...cases, ...compared];
    for (const a of new Set(actions)) {
      if (["compliance-risk", "production-anomaly", "rating-trends", "helpdesk-assist", "document-extraction"].includes(a)) continue; // AI engine dispatch, listed in the use-case row
      assert.ok(section.includes(a), `the ${m.name} action "${a}" is not described in docs/demo/API.md`);
    }
  }
});

test("the reference says it is outside the contract and names the follow-up", () => {
  assert.match(doc, /outside the OpenAPI contract/);
  assert.match(doc, /BL-229/);
});
