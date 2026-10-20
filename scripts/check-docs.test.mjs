import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  appendFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { checkDocs, requiredAreas } from "./check-docs.mjs";
function fixture(fn) {
  const root = mkdtempSync(resolve(tmpdir(), "planner-docs-"));
  for (const dir of ["docs", "src", "tests"]) mkdirSync(resolve(root, dir));
  const map = {
    version: 1,
    features: requiredAreas.map((id) => ({
      id,
      title: id,
      manualAnchor: id,
      fields: ["dailyHours"],
      tests: ["tests/example.test.ts#example"],
    })),
  };
  writeFileSync(
    resolve(root, "README.md"),
    "[Manual](docs/user-manual.md#setup)",
  );
  writeFileSync(resolve(root, "src/model.ts"), "const dailyHours = 8;");
  writeFileSync(
    resolve(root, "tests/example.test.ts"),
    'test("example", () => {});',
  );
  writeFileSync(
    resolve(root, "docs/user-manual.md"),
    requiredAreas
      .map((id) => `<a id="${id}"></a>\n${id} dailyHours`)
      .join("\n"),
  );
  const save = () =>
    writeFileSync(
      resolve(root, "docs/feature-coverage.json"),
      JSON.stringify(map),
    );
  save();
  try {
    fn(root, map, save);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
test("valid complete map and links pass", () =>
  fixture((root) => assert.deepEqual(checkDocs(root), [])));
test("human-readable static and dynamic field labels pass", () =>
  fixture((root, map, save) => {
    appendFileSync(
      resolve(root, "src/model.ts"),
      '\nconst input = <Field label="Full-day leave" />; const task = <Field label={`Task ${index + 1} title`} />;',
    );
    appendFileSync(
      resolve(root, "docs/user-manual.md"),
      "\nFull-day leave and Task N title",
    );
    map.features[0].fields = ["Full-day leave", "Task N title"];
    save();
    assert.deepEqual(checkDocs(root), []);
  }));
test("missing required area fails", () =>
  fixture((root, map, save) => {
    map.features.pop();
    save();
    assert.match(
      checkDocs(root).join("\n"),
      /Missing required area: maintenance/,
    );
  }));
test("duplicate feature and manual IDs fail", () =>
  fixture((root, map, save) => {
    map.features.push(map.features[0]);
    save();
    writeFileSync(
      resolve(root, "docs/user-manual.md"),
      '<a id="setup"></a><a id="setup"></a> dailyHours',
    );
    assert.match(checkDocs(root).join("\n"), /Duplicate feature ID/);
    assert.match(checkDocs(root).join("\n"), /Duplicate manual anchor/);
  }));
test("unknown source field and missing test title fail", () =>
  fixture((root, map, save) => {
    map.features[0].fields = ["inventedField"];
    map.features[0].tests = ["tests/example.test.ts#unknown title"];
    save();
    assert.match(
      checkDocs(root).join("\n"),
      /unknown source field inventedField/,
    );
    assert.match(checkDocs(root).join("\n"), /missing test title/);
  }));
test("missing file, path outside tests and broken manual link fail", () =>
  fixture((root, map, save) => {
    map.features[0].tests = ["src/model.ts", "tests/missing.test.ts"];
    save();
    writeFileSync(
      resolve(root, "README.md"),
      "[Broken](docs/missing.md) [Anchor](docs/user-manual.md#missing)",
    );
    const errors = checkDocs(root).join("\n");
    assert.match(errors, /missing test src/);
    assert.match(errors, /missing test tests\/missing/);
    assert.match(errors, /Broken link/);
    assert.match(errors, /Broken anchor/);
  }));
test("invalid JSON and missing documents fail clearly", () =>
  fixture((root) => {
    writeFileSync(resolve(root, "docs/feature-coverage.json"), "{");
    assert.match(checkDocs(root).join("\n"), /invalid JSON/);
    rmSync(resolve(root, "docs/user-manual.md"));
    assert.match(checkDocs(root).join("\n"), /Missing docs\/user-manual/);
  }));
