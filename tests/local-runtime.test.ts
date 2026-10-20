import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { STORAGE_SCHEMA_VERSION } from "../src/lib/runtime-version";
import {
  acquireRuntime,
  removeOwnedLock,
  releaseRuntime,
  saveInstance,
  dataDirectory,
  validInstance,
  sameInstance,
} from "../server/local-runtime";

describe("portable runtime paths and identity", () => {
  it("keeps data outside the application folder for each platform", () => {
    expect(dataDirectory("darwin", {}, "/Users/example")).toBe(
      "/Users/example/Library/Application Support/DeliveryStudio",
    );
    expect(
      dataDirectory(
        "win32",
        { LOCALAPPDATA: "C:\\Users\\Example\\AppData\\Local" },
        "C:\\Users\\Example",
      ),
    ).toBe("C:\\Users\\Example\\AppData\\Local\\DeliveryStudio");
    expect(dataDirectory("win32", {}, "C:\\Users\\Example")).toBe(
      "C:\\Users\\Example\\AppData\\Local\\DeliveryStudio",
    );
  });
  it("preserves explicit isolated data locations containing spaces and Unicode", () => {
    expect(
      dataDirectory(
        "darwin",
        { DELIVERY_STUDIO_DATA_DIR: "/tmp/My café workspace" },
        "/ignored",
      ),
    ).toBe("/tmp/My café workspace");
  });
  it("rejects malformed record ports and never identifies an unrelated service as this workspace", () => {
    expect(validInstance({ port: 0, instanceId: "a", pid: 12 })).toBe(false);
    expect(validInstance({ port: 4311, instanceId: "a", pid: 12 })).toBe(true);
    expect(
      sameInstance(
        { port: 4311, instanceId: "a", pid: 12 },
        { status: "ok", schemaVersion: STORAGE_SCHEMA_VERSION },
      ),
    ).toBe(false);
    expect(
      sameInstance(
        { port: 4311, instanceId: "a", pid: 12 },
        {
          status: "ok",
          application: "delivery-studio",
          instanceId: "b",
          schemaVersion: STORAGE_SCHEMA_VERSION,
        },
      ),
    ).toBe(false);
    expect(
      sameInstance(
        { port: 4311, instanceId: "a", pid: 12 },
        {
          status: "ok",
          application: "delivery-studio",
          instanceId: "a",
          schemaVersion: STORAGE_SCHEMA_VERSION,
        },
      ),
    ).toBe(true);
  });
});

it("a launch waiting for an active owner does not resurrect it after the owner quits", async () => {
  const directory = mkdtempSync(join(tmpdir(), "delivery-owner-test-"));
  try {
    mkdirSync(join(directory, "runtime.lock"));
    writeFileSync(
      join(directory, "runtime.lock/owner.json"),
      JSON.stringify({ pid: process.pid, instanceId: "quitting-owner" }),
    );
    const pending = acquireRuntime(directory);
    await new Promise((done) => setTimeout(done, 50));
    removeOwnedLock(directory, "quitting-owner");
    expect(await pending).toEqual({ cancelled: true });
    expect(existsSync(join(directory, "runtime.lock"))).toBe(false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

it("a helper requested before Quit cannot reopen the server after slow module startup", async () => {
  const directory = mkdtempSync(join(tmpdir(), "delivery-delayed-launch-"));
  try {
    saveInstance(directory, {
      pid: process.pid,
      port: 4311,
      instanceId: "old-instance",
    });
    const requestedAt = Date.now() - 100;
    releaseRuntime(directory, "old-instance");
    expect(await acquireRuntime(directory, requestedAt)).toEqual({
      cancelled: true,
    });
    expect(existsSync(join(directory, "runtime.lock"))).toBe(false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
