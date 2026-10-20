import { spawnSync } from "node:child_process";

const checks = [
  "format:check",
  "typecheck",
  "build",
  "test",
  "test:packaging",
  "check:docs",
  "test:ui",
  "test:smoke",
];
for (const check of checks) {
  console.log(`\nVerification: ${check}`);
  const result = spawnSync("npm", ["run", check], {
    stdio: "inherit",
    env: process.env,
  });
  if (result.error) console.error(result.error.message);
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log("\nAll verification checks passed.");
