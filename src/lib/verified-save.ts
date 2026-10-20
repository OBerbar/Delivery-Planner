import { stateSchema, type PlannerState } from "./model";
import { STORAGE_SCHEMA_VERSION } from "./runtime-version";

export class RevisionConflictError extends Error {}

export async function verifiedSave(
  state: PlannerState,
  revision: number,
  fetcher: (url: string, init?: RequestInit) => Promise<Response> = fetch,
): Promise<{ state: PlannerState; revision: number }> {
  const submitted = stateSchema.parse(state);
  const health = await fetcher("/api/health");
  const runtime = await health.json();
  if (!health.ok || runtime?.schemaVersion !== STORAGE_SCHEMA_VERSION)
    throw new Error(
      "Restart Delivery Studio before saving: the running server is out of date.",
    );
  const response = await fetcher("/api/state", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ state: submitted, revision }),
  });
  const result = await response.json();
  if (!response.ok) {
    if (response.status === 409)
      throw new RevisionConflictError(
        result?.error ??
          "This workspace changed in another tab. Reload before saving.",
      );
    throw new Error(result?.error ?? "Save failed");
  }
  const parsed = stateSchema.safeParse(result?.state);
  if (
    !parsed.success ||
    result?.revision !== revision + 1 ||
    JSON.stringify(parsed.data) !== JSON.stringify(submitted)
  )
    throw new Error(
      "Save could not be verified. Reload the workspace before trying again.",
    );
  return { state: parsed.data, revision: result.revision };
}
