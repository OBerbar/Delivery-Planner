import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

export const requiredAreas = [
  "setup",
  "timeline",
  "features",
  "estimates",
  "tasks-dependencies",
  "team",
  "leave",
  "holidays",
  "templates",
  "sprints",
  "commitments",
  "plans",
  "settings",
  "backup-undo",
  "scheduling",
  "maintenance",
];
const rootDefault = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(path, "utf8");
function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? files(resolve(dir, entry.name))
      : [resolve(dir, entry.name)],
  );
}
function anchors(text) {
  return [...text.matchAll(/<a\s+id=["']([^"']+)["'][^>]*>/g)].map((m) => m[1]);
}
export function checkDocs(root = rootDefault) {
  const errors = [];
  const mapPath = resolve(root, "docs/feature-coverage.json");
  const manualPath = resolve(root, "docs/user-manual.md");
  for (const path of [mapPath, manualPath])
    if (!existsSync(path)) errors.push(`Missing ${relative(root, path)}`);
  if (errors.length) return errors;
  let map;
  try {
    map = JSON.parse(read(mapPath));
  } catch {
    return ["feature-coverage.json is invalid JSON"];
  }
  if (map.version !== 1 || !Array.isArray(map.features))
    return ["Coverage map must contain version: 1 and features: []"];
  const manual = read(manualPath);
  const manualIds = anchors(manual);
  const duplicate = (items, label) => {
    const seen = new Set();
    for (const item of items) {
      if (seen.has(item)) errors.push(`Duplicate ${label}: ${item}`);
      seen.add(item);
    }
  };
  duplicate(manualIds, "manual anchor");
  duplicate(
    map.features.map((f) => f.id),
    "feature ID",
  );
  for (const area of requiredAreas)
    if (!map.features.some((f) => f.id === area))
      errors.push(`Missing required area: ${area}`);
  const source = files(resolve(root, "src"))
    .filter((f) => /\.(tsx?|css)$/.test(f))
    .map(read)
    .join("\n");
  const normalize = (value) => value.replace(/\s+/g, " ").trim();
  const sourceText = normalize(source);
  const templateLabels = [
    ...source.matchAll(/(?:label|ariaLabel|aria-label)=\{`([^`]+)`\}/g),
  ].map((match) => {
    const parts = match[1].split(/\$\{[^}]+\}/);
    return new RegExp(
      "^" +
        parts
          .map((part) => normalize(part).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
          .join(".*") +
        "$",
    );
  });
  for (const feature of map.features) {
    if (
      !feature.id ||
      typeof feature.title !== "string" ||
      !feature.title.trim()
    )
      errors.push("Every feature needs an ID and title");
    if (!manualIds.includes(feature.manualAnchor))
      errors.push(`Missing manual anchor: ${feature.manualAnchor}`);
    if (
      !Array.isArray(feature.fields) ||
      !feature.fields.length ||
      feature.fields.some((f) => typeof f !== "string" || !f.trim())
    )
      errors.push(`${feature.id}: fields must be nonempty strings`);
    else
      for (const field of feature.fields) {
        if (
          !sourceText.includes(normalize(field)) &&
          !templateLabels.some((pattern) => pattern.test(normalize(field)))
        )
          errors.push(`${feature.id}: unknown source field ${field}`);
        if (!manual.includes(field))
          errors.push(`${feature.id}: manual does not explain field ${field}`);
      }
    if (!Array.isArray(feature.tests) || !feature.tests.length)
      errors.push(`${feature.id}: at least one test reference is required`);
    else
      for (const test of feature.tests) {
        if (typeof test !== "string") {
          errors.push(`${feature.id}: invalid test reference`);
          continue;
        }
        const [path, title] = test.split("#");
        const target = resolve(root, path);
        if (
          !target.startsWith(resolve(root, "tests") + "/") ||
          !/\.(test|spec|smoke)\.ts$/.test(path) ||
          !existsSync(target)
        )
          errors.push(`${feature.id}: missing test ${test}`);
        else if (title && !read(target).includes(title))
          errors.push(`${feature.id}: missing test title ${test}`);
      }
  }
  for (const path of [
    resolve(root, "README.md"),
    ...files(resolve(root, "docs")).filter((f) => f.endsWith(".md")),
  ]) {
    const text = read(path);
    for (const match of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      let href = match[1].replace(/^<|>$/g, "").split(/\s+["']/)[0];
      if (/^(?:[a-z][a-z0-9+.-]*:|\/)/i.test(href)) continue;
      const [link, fragment] = href.split("#");
      let target;
      try {
        target = resolve(dirname(path), decodeURIComponent(link || ""));
      } catch {
        errors.push(`Invalid link in ${relative(root, path)}: ${href}`);
        continue;
      }
      if (!link) target = path;
      if (!existsSync(target))
        errors.push(`Broken link in ${relative(root, path)}: ${href}`);
      else if (fragment && target.endsWith(".md")) {
        const body = read(target);
        const headingIds = [...body.matchAll(/^#{1,6}\s+(.+)$/gm)].map((m) =>
          m[1]
            .toLowerCase()
            .replace(/[^\w\s-]/g, "")
            .trim()
            .replace(/\s+/g, "-"),
        );
        if (![...anchors(body), ...headingIds].includes(fragment))
          errors.push(`Broken anchor in ${relative(root, path)}: ${href}`);
      }
    }
  }
  return errors;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const errors = checkDocs(
    process.argv[2] ? resolve(process.argv[2]) : rootDefault,
  );
  if (errors.length) {
    console.error(errors.join("\n"));
    process.exitCode = 1;
  } else
    console.log(
      "Documentation coverage, anchors, fields, test references and local links passed.",
    );
}
