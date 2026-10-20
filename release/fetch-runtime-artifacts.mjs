import {
  readFileSync,
  existsSync,
  mkdirSync,
  writeFileSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pinned = JSON.parse(
  readFileSync(join(root, "release/runtime-artifacts.json"), "utf8"),
);
const cache = join(root, "output/download-cache");
mkdirSync(cache, { recursive: true });
for (const artifact of pinned.artifacts) {
  const file = join(cache, artifact.name);
  if (existsSync(file)) {
    if (
      createHash("sha256").update(readFileSync(file)).digest("hex") !==
      artifact.sha256
    )
      throw new Error(
        `Cached checksum mismatch: ${artifact.name}; inspect/remove that cached file before retrying.`,
      );
    console.log(`Verified ${artifact.name}`);
    continue;
  }
  const response = await fetch(artifact.url, {
    signal: AbortSignal.timeout(180000),
  });
  if (!response.ok)
    throw new Error(`Download failed (${response.status}): ${artifact.name}`);
  const body = Buffer.from(await response.arrayBuffer());
  if (createHash("sha256").update(body).digest("hex") !== artifact.sha256)
    throw new Error(`Downloaded checksum mismatch: ${artifact.name}`);
  const temp = file + ".download";
  try {
    writeFileSync(temp, body, { flag: "wx" });
    renameSync(temp, file);
  } finally {
    if (existsSync(temp)) unlinkSync(temp);
  }
  console.log(`Downloaded and verified ${artifact.name}`);
}
