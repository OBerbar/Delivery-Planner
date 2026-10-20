// Runs only against temporary synthetic data, never the user's workspace.
import assert from "node:assert/strict";
import { mkdtemp, readFile, cp, rm, access, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
const application = resolve(process.argv[2] ?? "");
if (!process.argv[2])
  throw new Error("Pass the extracted Delivery Studio folder.");
const mac = process.platform === "darwin";
if (!mac && process.platform !== "win32")
  throw new Error("Run on Mac or Windows.");
const temporary = await mkdtemp(join(tmpdir(), "Delivery Studio QA é-"));
const directory = join(temporary, "Saved workspace é");
const env = {
  ...process.env,
  DELIVERY_STUDIO_DATA_DIR: directory,
  DELIVERY_STUDIO_NO_UI: "1",
  PATH: "",
};
const launcher = (folder) =>
  mac
    ? join(folder, "Delivery Studio.app/Contents/MacOS/DeliveryStudio")
    : join(folder, "Delivery Studio.exe");
const resources = mac
  ? join(application, "Delivery Studio.app/Contents/Resources")
  : join(application, "resources");
const node = join(resources, mac ? "runtime/bin/node" : "runtime/node.exe");
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
async function readRecord() {
  try {
    return JSON.parse(await readFile(join(directory, "instance.json"), "utf8"));
  } catch {
    return undefined;
  }
}
async function eventually(check, message) {
  const end = Date.now() + 20000;
  while (Date.now() < end) {
    const result = await check();
    if (result) return result;
    await delay(100);
  }
  throw new Error(message);
}
async function execute(command, args = [], overrides = {}) {
  const child = spawn(command, args, {
    env: { ...env, ...overrides },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (value) => (output += value));
  child.stderr.on("data", (value) => (output += value));
  const timer = setTimeout(() => child.kill(), 25000);
  return new Promise((done, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => {
      clearTimeout(timer);
      done({ code, output });
    });
  });
}
async function ready() {
  return eventually(async () => {
    const record = await readRecord();
    if (!record) return;
    try {
      const health = await (
        await fetch(`http://127.0.0.1:${record.port}/api/health`, {
          signal: AbortSignal.timeout(1000),
        })
      ).json();
      return health.instanceId === record.instanceId &&
        health.application === "delivery-studio"
        ? record
        : undefined;
    } catch {
      return;
    }
  }, "Packaged runtime did not become ready.");
}
async function quit(record) {
  const base = `http://127.0.0.1:${record.port}`;
  const runtime = await (await fetch(base + "/api/runtime")).json();
  assert.equal(
    (
      await fetch(base + "/api/quit", {
        method: "POST",
        headers: { "x-delivery-studio-token": "wrong" },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await fetch(base + "/api/quit", {
        method: "POST",
        headers: {
          origin: "https://example.com",
          "x-delivery-studio-token": runtime.quitToken,
        },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await fetch(base + "/api/quit", {
        method: "POST",
        headers: { origin: base, "x-delivery-studio-token": runtime.quitToken },
      })
    ).status,
    200,
  );
  await eventually(
    async () => !(await readRecord()),
    "Quit did not release the managed instance.",
  );
}
let current;
try {
  assert.equal((await execute(node, ["--version"])).output.trim(), "v24.21.0");
  await access(launcher(application));
  const launches = await Promise.all([
    execute(launcher(application)),
    execute(launcher(application)),
  ]);
  assert.ok(launches.every((result) => result.code === 0));
  current = await ready();
  assert.equal(
    await realpath(current.resourceDirectory),
    await realpath(resources),
  );
  const base = `http://127.0.0.1:${current.port}`;
  assert.match(await (await fetch(base)).text(), /Delivery Studio/);
  const initial = await (await fetch(base + "/api/state")).json();
  assert.equal(initial.state.apps.length, 0);
  const fixture = process.argv[3]
    ? JSON.parse(await readFile(resolve(process.argv[3]), "utf8"))
    : {
        ...initial.state,
        apps: [
          {
            id: "synthetic",
            name: "Delivery QA é",
            color: "#7565db",
            weekends: [0, 6],
            planningStart: "2030-01-07",
            cadence: "2w",
            customDays: 14,
            terms: "Saved update marker",
            archived: false,
          },
        ],
      };
  const save = await fetch(base + "/api/state", {
    method: "PUT",
    headers: { "content-type": "application/json", origin: base },
    body: JSON.stringify({ revision: initial.revision, state: fixture }),
  });
  assert.equal(save.status, 200, await save.text());
  const saved = await (await fetch(base + "/api/state")).json();
  assert.equal(saved.revision, initial.revision + 1);
  assert.deepEqual(saved.state, fixture);
  await execute(launcher(application));
  assert.deepEqual(await ready(), current);
  await quit(current);
  current = undefined;
  const replacement = join(temporary, "Replacement application é");
  await cp(application, replacement, { recursive: true });
  await execute(launcher(replacement));
  current = await ready();
  const replacementResources = mac
    ? join(replacement, "Delivery Studio.app/Contents/Resources")
    : join(replacement, "resources");
  assert.equal(
    await realpath(current.resourceDirectory),
    await realpath(replacementResources),
  );
  assert.deepEqual(
    await (await fetch(`http://127.0.0.1:${current.port}/api/state`)).json(),
    saved,
  );
  await quit(current);
  current = undefined;
  const foreign = createServer((_request, response) => {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ status: "ok", schemaVersion: 5 }));
  });
  await new Promise((done) => foreign.listen(0, "127.0.0.1", done));
  try {
    const conflict = await execute(node, [join(resources, "launcher.mjs")], {
      DELIVERY_STUDIO_PORT: String(foreign.address().port),
    });
    assert.equal(conflict.code, 1);
    assert.equal(await readRecord(), undefined);
    await execute(launcher(application));
    current = await ready();
    assert.deepEqual(
      await (await fetch(`http://127.0.0.1:${current.port}/api/state`)).json(),
      saved,
    );
    await quit(current);
    current = undefined;
  } finally {
    await new Promise((done) => foreign.close(done));
  }
  console.log(
    `PASS ${process.platform}/${process.arch}: bundled runtime, native launch with no Node PATH, simultaneous launches, identity reuse, origin/token checks, save/quit, replacement-folder retention, busy-port recovery.`,
  );
} finally {
  if (!current) current = await readRecord();
  if (current) {
    try {
      console.error(
        await readFile(join(directory, "delivery-studio.log"), "utf8"),
      );
    } catch {}
  }
  if (current) {
    try {
      await quit(current);
    } catch {
      try {
        process.kill(current.pid, "SIGTERM");
      } catch {}
    }
  }
  await rm(temporary, { recursive: true, force: true });
}
