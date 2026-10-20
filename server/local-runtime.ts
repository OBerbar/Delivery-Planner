import { homedir } from "node:os";
import { join, resolve, win32 } from "node:path";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  unlinkSync,
  rmdirSync,
  statSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { STORAGE_SCHEMA_VERSION } from "../src/lib/runtime-version";

export interface InstanceRecord {
  port: number;
  instanceId: string;
  pid: number;
  resourceDirectory?: string;
}
interface LockOwner {
  instanceId: string;
  pid: number;
}
export function dataDirectory(
  platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  home = homedir(),
) {
  if (env.DELIVERY_STUDIO_DATA_DIR)
    return resolve(env.DELIVERY_STUDIO_DATA_DIR);
  if (platform === "win32")
    return win32.join(
      env.LOCALAPPDATA ?? win32.join(home, "AppData", "Local"),
      "DeliveryStudio",
    );
  if (platform === "darwin")
    return join(home, "Library", "Application Support", "DeliveryStudio");
  return join(
    env.XDG_DATA_HOME ?? join(home, ".local", "share"),
    "DeliveryStudio",
  );
}
export function validInstance(value: unknown): value is InstanceRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as InstanceRecord;
  return (
    Number.isInteger(record.port) &&
    record.port > 0 &&
    record.port <= 65535 &&
    typeof record.instanceId === "string" &&
    record.instanceId.length > 0 &&
    Number.isInteger(record.pid) &&
    record.pid > 0
  );
}
export function sameInstance(record: InstanceRecord, value: unknown) {
  if (!value || typeof value !== "object") return false;
  const health = value as Record<string, unknown>;
  return (
    health.status === "ok" &&
    health.application === "delivery-studio" &&
    health.instanceId === record.instanceId &&
    health.schemaVersion === STORAGE_SCHEMA_VERSION
  );
}
function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
}
export function readInstance(directory: string) {
  const value = readJson(join(directory, "instance.json"));
  return validInstance(value) ? value : undefined;
}
export async function probeInstance(record: InstanceRecord) {
  try {
    const response = await fetch(`http://127.0.0.1:${record.port}/api/health`, {
      signal: AbortSignal.timeout(1000),
    });
    return response.ok && sameInstance(record, await response.json());
  } catch {
    return false;
  }
}
function readOwner(directory: string): LockOwner | undefined {
  const value = readJson(join(directory, "runtime.lock", "owner.json")) as
    LockOwner | undefined;
  return value &&
    Number.isInteger(value.pid) &&
    value.pid > 0 &&
    typeof value.instanceId === "string"
    ? value
    : undefined;
}
function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}
export function removeOwnedLock(directory: string, instanceId: string) {
  if (readOwner(directory)?.instanceId !== instanceId) return;
  unlinkSync(join(directory, "runtime.lock", "owner.json"));
  try {
    rmdirSync(join(directory, "runtime.lock"));
  } catch {
    /* Preserve any unexpected files. */
  }
}
export async function acquireRuntime(
  directory: string,
  requestedAt = Date.now(),
) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const lock = join(directory, "runtime.lock");
  let waitedForOwner = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    const lastStop = readJson(join(directory, "last-stop.json")) as
      { stoppedAt?: number } | undefined;
    if (
      typeof lastStop?.stoppedAt === "number" &&
      lastStop.stoppedAt > requestedAt
    )
      return { cancelled: true };
    const record = readInstance(directory);
    if (record && (await probeInstance(record))) return { existing: record };
    // A pending second launch must not start a new server after Quit.
    if (waitedForOwner && !readOwner(directory)) return { cancelled: true };
    const instanceId = randomUUID();
    try {
      mkdirSync(lock, { mode: 0o700 });
      writeFileSync(
        join(lock, "owner.json"),
        JSON.stringify({ instanceId, pid: process.pid }),
        { mode: 0o600 },
      );
      return { instanceId };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const owner = readOwner(directory);
    if (owner && alive(owner.pid)) waitedForOwner = true;
    if (owner && !alive(owner.pid))
      removeOwnedLock(directory, owner.instanceId);
    else if (!owner) {
      try {
        if (Date.now() - statSync(lock).mtimeMs > 30000) rmdirSync(lock);
      } catch {
        /* Another launch owns or is creating it. */
      }
    }
    await new Promise((done) => setTimeout(done, 250));
  }
  throw new Error(
    "Delivery Studio is already starting or stopping. Try again in a moment. If it remains stuck, restart your computer; your saved plans are retained.",
  );
}
export function saveInstance(directory: string, record: InstanceRecord) {
  const temp = join(directory, `instance.${record.instanceId}.tmp`);
  writeFileSync(temp, JSON.stringify(record), { mode: 0o600 });
  renameSync(temp, join(directory, "instance.json"));
}
export function releaseRuntime(directory: string, instanceId: string) {
  if (readInstance(directory)?.instanceId === instanceId) {
    writeFileSync(
      join(directory, "last-stop.json"),
      JSON.stringify({ stoppedAt: Date.now() }),
      { mode: 0o600 },
    );
    unlinkSync(join(directory, "instance.json"));
  }
  removeOwnedLock(directory, instanceId);
}
