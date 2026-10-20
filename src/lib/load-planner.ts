import { stateSchema, today, type PlannerState } from "./model";
import { enableAutomaticPlanning } from "./date-status";
import { RevisionConflictError, verifiedSave } from "./verified-save";

/** Persist the first scheduling anchor once, before showing calculated dates. */
export async function loadPlanner(
  now = today(),
  fetcher: (url: string, init?: RequestInit) => Promise<Response> = fetch,
  readError = "Could not open your local database",
): Promise<{ state: PlannerState; revision: number }> {
  for (let attempt = 0; ; attempt++) {
    const response = await fetcher("/api/state");
    if (!response.ok) throw new Error(readError);
    const data = await response.json();
    const state = stateSchema.parse(data.state);
    if (!state.features.some((feature) => !feature.planningFrom))
      return { state, revision: data.revision };
    try {
      return await verifiedSave(
        enableAutomaticPlanning(state, now),
        data.revision,
        fetcher,
      );
    } catch (error) {
      // Another tab may have saved work or supplied an anchor already. Refetch
      // its winning state; never resubmit the stale state over newer changes.
      if (!(error instanceof RevisionConflictError) || attempt >= 2)
        throw error;
    }
  }
}
