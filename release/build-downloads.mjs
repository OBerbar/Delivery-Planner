import {
  cpSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
  chmodSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { build } from "esbuild";
import yazl from "yazl";
import { releaseMetadata } from "./version.mjs";
import { copyRuntimeDependencies } from "./runtime-dependencies.mjs";
import { validateRuntimeImports } from "./validate-runtime-imports.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pinned = JSON.parse(
  readFileSync(join(root, "release/runtime-artifacts.json"), "utf8"),
);
const cache = join(root, "output/download-cache");
const destination = resolve(process.argv[2] ?? join(root, "output/downloads"));
const targets = process.argv.slice(3).length
  ? process.argv.slice(3)
  : ["darwin-arm64", "darwin-x64", "win32-x64"];
const { version: appVersion, macVersion } = releaseMetadata(
  JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version,
  process.env.GITHUB_REF_TYPE === "tag"
    ? process.env.GITHUB_REF_NAME
    : undefined,
);
if (existsSync(destination))
  throw new Error(
    "Choose a new output folder; existing downloads are never overwritten.",
  );
if (!existsSync(join(root, "dist/index.html")))
  throw new Error("Run npm run build before packaging.");
for (const artifact of pinned.artifacts) {
  const file = join(cache, artifact.name);
  if (!existsSync(file))
    throw new Error(`Download the pinned artifact first: ${artifact.url}`);
  if (
    createHash("sha256").update(readFileSync(file)).digest("hex") !==
    artifact.sha256
  )
    throw new Error(`Checksum mismatch: ${artifact.name}`);
}
mkdirSync(join(root, "output/package-build"), { recursive: true });
const work = mkdtempSync(join(root, "output/package-build/build-"));
const goRoot = join(work, "go-toolchain");
mkdirSync(goRoot);
execFileSync("tar", [
  "-xzf",
  join(cache, "go1.27.2.darwin-arm64.tar.gz"),
  "-C",
  goRoot,
]);
const go = join(goRoot, "go/bin/go");
const packages = [];

async function zipFolder(directory, output) {
  const archive = new yazl.ZipFile();
  const prefix = "Delivery Studio";
  const add = (folder) => {
    for (const item of readdirSync(folder).sort()) {
      const file = join(folder, item);
      if (statSync(file).isDirectory()) add(file);
      else
        archive.addFile(
          file,
          `${prefix}/${relative(directory, file).split("\\").join("/")}`,
          { mtime: new Date("2026-10-14T00:00:00Z") },
        );
    }
  };
  add(directory);
  await new Promise((done, reject) => {
    const stream = createWriteStream(output, { flags: "wx" });
    archive.on("error", reject);
    stream.on("error", reject);
    stream.on("close", done);
    archive.outputStream.pipe(stream);
    archive.end();
  });
}

for (const target of targets) {
  if (!["darwin-arm64", "darwin-x64", "win32-x64"].includes(target))
    throw new Error(`Unsupported package target: ${target}`);
  const isMac = target.startsWith("darwin");
  const nodeTarget = target.replace("win32", "win");
  const folder = join(work, target);
  const resources = isMac
    ? join(folder, "Delivery Studio.app/Contents/Resources")
    : join(folder, "resources");
  mkdirSync(resources, { recursive: true });
  const dependencies = copyRuntimeDependencies(root, resources);
  cpSync(join(root, "dist"), join(resources, "dist"), { recursive: true });
  const bundle = await build({
    entryPoints: [join(root, "release/launcher.mjs")],
    outfile: join(resources, "launcher.mjs"),
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
    packages: "external",
    sourcemap: false,
    metafile: true,
  });
  const runtimeImports = [
    ...new Set(
      Object.values(bundle.metafile.outputs)
        .flatMap((output) => output.imports)
        .filter((item) => item.external)
        .map((item) => item.path),
    ),
  ];
  validateRuntimeImports(resources, runtimeImports);
  const extracted = join(work, `node-${target}`);
  mkdirSync(extracted);
  if (isMac)
    execFileSync("tar", [
      "-xzf",
      join(cache, `node-v${pinned.nodeVersion}-${nodeTarget}.tar.gz`),
      "-C",
      extracted,
    ]);
  else
    execFileSync("tar", [
      "-xf",
      join(cache, `node-v${pinned.nodeVersion}-${nodeTarget}.zip`),
      "-C",
      extracted,
    ]);
  const distribution = join(
    extracted,
    `node-v${pinned.nodeVersion}-${nodeTarget}`,
  );
  const runtime = join(resources, "runtime");
  mkdirSync(join(runtime, "bin"), { recursive: true });
  cpSync(
    join(distribution, isMac ? "bin/node" : "node.exe"),
    join(runtime, isMac ? "bin/node" : "node.exe"),
  );
  if (isMac) chmodSync(join(runtime, "bin/node"), 0o755);
  const native = join(resources, "node_modules/better-sqlite3");
  execFileSync("tar", [
    "-xzf",
    join(
      cache,
      `better-sqlite3-v${pinned.sqliteVersion}-node-v${pinned.nodeAbi}-${target}.tar.gz`,
    ),
    "-C",
    native,
  ]);
  const nodeNotice = readFileSync(join(distribution, "LICENSE"), "utf8");
  writeFileSync(join(resources, "NODE-LICENSE.txt"), nodeNotice);
  const packageInfo = {
    application: "Delivery Studio",
    version: appVersion,
    target,
    node: pinned.nodeVersion,
    sqlite: pinned.sqliteVersion,
    signing: "unsigned beta; publisher identity not verified",
    dependencies,
    runtimeImports,
  };
  writeFileSync(
    join(resources, "PACKAGE.json"),
    JSON.stringify(packageInfo, null, 2) + "\n",
  );
  if (isMac) {
    const contents = join(folder, "Delivery Studio.app/Contents");
    mkdirSync(join(contents, "MacOS"));
    execFileSync("cc", [
      "-arch",
      "arm64",
      "-arch",
      "x86_64",
      "-mmacosx-version-min=13.5",
      join(root, "release/mac-launcher.c"),
      "-o",
      join(contents, "MacOS/DeliveryStudio"),
    ]);
    writeFileSync(
      join(contents, "Info.plist"),
      `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleName</key><string>Delivery Studio</string><key>CFBundleDisplayName</key><string>Delivery Studio</string><key>CFBundleIdentifier</key><string>io.github.delivery-studio.local</string><key>CFBundleExecutable</key><string>DeliveryStudio</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleVersion</key><string>1</string><key>CFBundleShortVersionString</key><string>${macVersion}</string><key>LSUIElement</key><true/><key>LSMinimumSystemVersion</key><string>13.5</string></dict></plist>`,
    );
    execFileSync("codesign", [
      "--force",
      "--sign",
      "-",
      join(contents, "MacOS/DeliveryStudio"),
    ]);
  } else {
    execFileSync(
      go,
      [
        "build",
        "-trimpath",
        "-ldflags=-s -w -H windowsgui",
        "-o",
        join(folder, "Delivery Studio.exe"),
        join(root, "release/windows-launcher.go"),
      ],
      {
        env: {
          ...process.env,
          GOCACHE: join(work, "go-cache"),
          GOOS: "windows",
          GOARCH: "amd64",
          CGO_ENABLED: "0",
        },
        timeout: 180000,
      },
    );
    cpSync(join(goRoot, "go/LICENSE"), join(resources, "GO-LICENSE.txt"));
    cpSync(join(goRoot, "go/PATENTS"), join(resources, "GO-PATENTS.txt"));
  }
  writeFileSync(
    join(folder, "START HERE.txt"),
    `Delivery Studio ${appVersion}\n\nExtract the entire ZIP first. Open ${isMac ? "Delivery Studio.app" : "Delivery Studio.exe"}. Your browser opens the local planner. No Node installation or terminal is needed.\n\nQuit using Quit Delivery Studio in the browser. Closing a browser tab does not stop the app. Save or cancel forms before quitting.\n\nData stays outside this download in ${isMac ? "~/Library/Application Support/DeliveryStudio" : "%LOCALAPPDATA%\\DeliveryStudio"}. Quit before replacing the application folder; reopening uses the same saved workspace. Source-edition users can transfer their workspace through Export full backup / Restore backup.\n\nThis is an unsigned beta. Mac downloads are not notarized; Windows may show an unrecognized-publisher warning. Use only a download you trust; do not disable system protection.\n\nThis ${target} package ${isMac ? "requires macOS 13.5 or later and a Mac with the matching processor" : "is intended for Windows 10/11 x64; native execution still requires Windows testing"}.\n\nThird-party license notices are in the application resources.\n`,
  );
  mkdirSync(destination, { recursive: true });
  const name = `Delivery-Studio-${appVersion}-${isMac ? "mac" : "windows"}-${target.split("-")[1]}.zip`;
  const archive = join(destination, name);
  await zipFolder(folder, archive);
  const sha256 = createHash("sha256")
    .update(readFileSync(archive))
    .digest("hex");
  packages.push({
    filename: name,
    sha256,
    bytes: statSync(archive).size,
    target,
    unpackedDirectory: folder,
  });
  console.log(
    `Built ${name} (${Math.round(statSync(archive).size / 1024 / 1024)} MB)`,
  );
}
writeFileSync(
  join(destination, "SHA256SUMS.txt"),
  packages.map((item) => `${item.sha256}  ${item.filename}`).join("\n") + "\n",
);
writeFileSync(
  join(work, "build-record.json"),
  JSON.stringify({ version: appVersion, packages }, null, 2) + "\n",
);
console.log(`Downloads: ${destination}`);
console.log(`Internal build record: ${join(work, "build-record.json")}`);
