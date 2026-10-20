import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { copyRuntimeDependencies } from "./runtime-dependencies.mjs";
test("download includes frontend and server notices while shipping only server modules", () => {
  const directory = mkdtempSync(join(tmpdir(), "delivery-notices-test-"));
  try {
    copyRuntimeDependencies(resolve("."), directory);
    assert.equal(
      readFileSync(join(directory, "APP-LICENSE.txt"), "utf8"),
      readFileSync(resolve("LICENSE"), "utf8"),
      "Portable downloads must carry the application MIT license",
    );
    const notices = readFileSync(
      join(directory, "THIRD-PARTY-NOTICES.txt"),
      "utf8",
    );
    for (const name of [
      "react",
      "react-dom",
      "@heroui/react",
      "lucide-react",
      "date-fns",
      "react-markdown",
      "fastify",
      "better-sqlite3",
    ])
      assert.ok(notices.includes(`===== ${name}@`), `Missing ${name} license`);
    assert.equal(
      existsSync(join(directory, "node_modules/date-fns/package.json")),
      true,
      "Shared server model imports date-fns",
    );
    assert.equal(existsSync(join(directory, "node_modules/react")), false);
    assert.equal(
      existsSync(join(directory, "node_modules/fastify/package.json")),
      true,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("runtime import validation rejects falling back to development dependencies", async () => {
  const { validateRuntimeImports } =
    await import("./validate-runtime-imports.mjs");
  mkdirSync(resolve("output"), { recursive: true });
  const directory = mkdtempSync(join(resolve("output"), "dependency-guard-"));
  try {
    assert.throws(
      () => validateRuntimeImports(directory, ["date-fns"]),
      /escapes packaged dependencies/,
    );
    assert.doesNotThrow(() => validateRuntimeImports(directory, ["node:fs"]));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("release metadata preserves prerelease versions and rejects a mismatched tag", async () => {
  const { releaseMetadata } = await import("./version.mjs");
  assert.deepEqual(releaseMetadata("1.0.0-beta.1", "v1.0.0-beta.1"), {
    version: "1.0.0-beta.1",
    macVersion: "1.0.0",
    tag: "v1.0.0-beta.1",
  });
  assert.equal(releaseMetadata("1.0.1").version, "1.0.1");
  assert.throws(
    () => releaseMetadata("1.0.0-beta.2", "v1.0.0-beta.1"),
    /does not match/,
  );
  assert.throws(() => releaseMetadata("latest"), /semantic version/);
});
