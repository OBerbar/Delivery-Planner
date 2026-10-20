import { createRequire, isBuiltin } from "node:module";
import { join, relative } from "node:path";
export function validateRuntimeImports(resources, imports) {
  const require = createRequire(join(resources, "launcher.mjs"));
  for (const specifier of new Set(imports)) {
    if (isBuiltin(specifier)) continue;
    const resolved = require.resolve(specifier);
    const local = relative(join(resources, "node_modules"), resolved);
    if (local.startsWith(".."))
      throw new Error(
        `Runtime import escapes packaged dependencies: ${specifier}`,
      );
  }
}
