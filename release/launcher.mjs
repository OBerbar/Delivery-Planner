import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { appendFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { startPlanner } from "../server/start.ts";
import {
  acquireRuntime,
  dataDirectory,
  releaseRuntime,
  saveInstance,
} from "../server/local-runtime.ts";

const directory = dataDirectory();
const resources = dirname(fileURLToPath(import.meta.url));
const quiet = process.env.DELIVERY_STUDIO_NO_UI === "1";
function openBrowser(port) {
  if (quiet) return;
  const url = `http://127.0.0.1:${port}/?desktop=1`;
  const child =
    process.platform === "win32"
      ? spawn(
          process.env.ComSpec ?? "C:\\Windows\\System32\\cmd.exe",
          ["/d", "/c", "start", "", url],
          { windowsHide: true, stdio: "ignore" },
        )
      : spawn("/usr/bin/open", [url], { stdio: "ignore" });
  child.on("error", (error) =>
    log(`Browser could not open: ${error.message}. Open ${url} manually.`),
  );
  child.unref();
}
function log(message) {
  try {
    appendFileSync(
      join(directory, "delivery-studio.log"),
      `${new Date().toISOString()} ${message}\n`,
      { mode: 0o600 },
    );
  } catch {
    console.error(message);
  }
}
function showError(message) {
  console.error(message);
  log(message);
  if (quiet) return;
  if (process.platform === "darwin") {
    const safe = JSON.stringify(message.replace(/\n/g, " "));
    spawn(
      "/usr/bin/osascript",
      ["-e", `display alert "Delivery Studio could not start" message ${safe}`],
      { stdio: "ignore" },
    )
      .on("error", (error) =>
        log(`Startup dialog could not open: ${error.message}`),
      )
      .unref();
  } else if (process.platform === "win32") {
    const powershell = join(
      process.env.SystemRoot ?? "C:\\Windows",
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    );
    spawn(
      powershell,
      [
        "-NoProfile",
        "-Command",
        "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show($env:DELIVERY_STUDIO_ERROR, 'Delivery Studio')",
      ],
      {
        windowsHide: true,
        stdio: "ignore",
        env: { ...process.env, DELIVERY_STUDIO_ERROR: message },
      },
    )
      .on("error", (error) =>
        log(`Startup dialog could not open: ${error.message}`),
      )
      .unref();
  }
}
let instanceId;
let planner;
let shutdownPromise;
const shutdown = () =>
  (shutdownPromise ??= (async () => {
    await planner?.stop();
    if (instanceId) releaseRuntime(directory, instanceId);
    log("Stopped; saved workspace retained.");
  })());
try {
  const requestedAt = Number(
    process.env.DELIVERY_STUDIO_LAUNCHED_AT ?? Date.now(),
  );
  if (
    !Number.isFinite(requestedAt) ||
    requestedAt < 0 ||
    requestedAt > Date.now() + 60000
  )
    throw new Error("The launch timestamp is invalid.");
  const lease = await acquireRuntime(directory, requestedAt);
  if (lease.cancelled) process.exit(0);
  if (lease.existing) {
    openBrowser(lease.existing.port);
    process.exit(0);
  }
  instanceId = lease.instanceId;
  const port = Number(process.env.DELIVERY_STUDIO_PORT ?? 0);
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new Error("The configured local port must be between 0 and 65535.");
  planner = await startPlanner({
    dataDirectory: directory,
    webDirectory: join(resources, "dist"),
    port,
    runtime: {
      instanceId,
      quitToken: randomUUID(),
      onQuit: async () => {
        await shutdown();
        process.exit(0);
      },
    },
  });
  saveInstance(directory, {
    instanceId,
    port: planner.port,
    pid: process.pid,
    resourceDirectory: resources,
  });
  log(`Ready at http://127.0.0.1:${planner.port}; data stored in ${directory}`);
  openBrowser(planner.port);
  const stop = () => {
    void shutdown().then(() => process.exit(0));
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
} catch (error) {
  await shutdown();
  showError(
    `Unable to start Delivery Studio: ${error.message}. Your saved workspace was not replaced. Log: ${join(directory, "delivery-studio.log")}`,
  );
  process.exitCode = 1;
}
