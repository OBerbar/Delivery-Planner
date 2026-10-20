import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const runtimeRoots = [
  "fastify",
  "@fastify/static",
  "better-sqlite3",
  "drizzle-orm",
  "zod",
  "date-fns",
];
function locate(name, start) {
  let directory = start;
  while (true) {
    const candidate = join(directory, "node_modules", name);
    if (existsSync(join(candidate, "package.json"))) return candidate;
    const parent = dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}
export function copyRuntimeDependencies(sourceRoot, resources) {
  const visited = new Set();
  const noticed = new Set();
  const notices = [];
  const versions = [];
  function copyPackage(source, ship = true) {
    const visit = `${source}:${ship}`;
    if (visited.has(visit)) return;
    visited.add(visit);
    const info = JSON.parse(readFileSync(join(source, "package.json"), "utf8"));
    const packagePath = relative(join(sourceRoot, "node_modules"), source);
    if (packagePath.startsWith(".."))
      throw new Error("A runtime dependency resolves outside this project.");
    const destination = join(resources, "node_modules", packagePath);
    if (ship)
      cpSync(source, destination, {
        recursive: true,
        filter: (path) => {
          const child = relative(source, path).split(/[\\/]/);
          if (child.includes("node_modules") || child.includes(".git"))
            return false;
          if (
            info.name === "better-sqlite3" &&
            ["build", "deps", "src"].includes(child[0])
          )
            return false;
          return true;
        },
      });
    if (!noticed.has(source)) {
      noticed.add(source);
      versions.push({
        name: info.name,
        version: info.version,
        license: info.license ?? "see package notices",
      });
      for (const name of readdirSync(source)) {
        if (
          /^(LICENSE|LICENCE|COPYING|NOTICE)/i.test(name) &&
          statSync(join(source, name)).isFile()
        ) {
          notices.push(
            `\n===== ${info.name}@${info.version}: ${name} =====\n${readFileSync(join(source, name), "utf8")}\n`,
          );
        }
      }
    }
    for (const [name] of Object.entries(info.dependencies ?? {})) {
      const dependency = locate(name, source);
      if (!dependency)
        throw new Error(`Missing runtime dependency ${info.name} → ${name}`);
      copyPackage(dependency, ship);
    }
    for (const [name] of Object.entries(info.optionalDependencies ?? {})) {
      const dependency = locate(name, source);
      if (dependency) copyPackage(dependency, ship);
    }
  }
  mkdirSync(resources, { recursive: true });
  for (const name of runtimeRoots) {
    const source = locate(name, resolve(sourceRoot));
    if (!source)
      throw new Error(`Install source dependencies before packaging: ${name}`);
    copyPackage(source);
  }
  const application = JSON.parse(
    readFileSync(join(sourceRoot, "package.json"), "utf8"),
  );
  for (const name of Object.keys(application.dependencies)) {
    const source = locate(name, resolve(sourceRoot));
    if (!source)
      throw new Error(`Missing application dependency for notices: ${name}`);
    copyPackage(source, false);
  }
  cpSync(join(sourceRoot, "LICENSE"), join(resources, "APP-LICENSE.txt"));
  writeFileSync(join(resources, "THIRD-PARTY-NOTICES.txt"), notices.join("\n"));
  return versions.sort((a, b) => a.name.localeCompare(b.name));
}
