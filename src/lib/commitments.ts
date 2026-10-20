import { stateSchema, type PlannerState } from "./model";
import { deliverySprintEnd } from "./delivery-calendar";
import { schedule, type Schedule } from "./planning";

function acceptForecast(
  state: PlannerState,
  ids: Set<string>,
  now: string,
  forecast: Schedule,
): PlannerState {
  for (const id of ids) {
    const feature = state.features.find((f) => f.id === id);
    if (!feature)
      throw new Error("The feature no longer exists. Reload and try again.");
    if (!feature.committed)
      throw new Error(`${feature.title}: mark this feature committed first.`);
    if (!forecast.features[id]?.end || forecast.features[id]?.done)
      throw new Error(
        `${feature.title}: a scheduled, unfinished forecast is required to accept delivery dates.`,
      );
  }
  return {
    ...state,
    features: state.features.map((f) =>
      ids.has(f.id)
        ? {
            ...f,
            commitment: {
              end: deliverySprintEnd(
                state,
                f.appId,
                forecast.features[f.id].end!,
              ),
              acceptedAt: now,
            },
          }
        : f,
    ),
  };
}

export function reconcileCommitments(
  before: PlannerState,
  next: PlannerState,
  now: string,
): PlannerState {
  const parsed = stateSchema.parse(next);
  const ids = new Set(
    parsed.features
      .filter(
        (f) =>
          f.committed &&
          !before.features.find((old) => old.id === f.id)?.committed,
      )
      .map((f) => f.id),
  );
  const cleared = {
    ...parsed,
    features: parsed.features.map((f) =>
      !f.committed && f.commitment ? { ...f, commitment: undefined } : f,
    ),
  };
  return ids.size
    ? acceptForecast(cleared, ids, now, schedule(cleared, now))
    : cleared;
}

/** Explicitly accepting new dates never rewrites saved sprint-plan text. */
export function refreshCommitments(
  state: PlannerState,
  featureIds: string[],
  now: string,
): PlannerState {
  return acceptForecast(state, new Set(featureIds), now, schedule(state, now));
}

/** One-time owner-authorized alignment keeps each original baseline and acceptance timestamp. */
export function alignExistingCommitments(state: PlannerState): PlannerState {
  return {
    ...state,
    features: state.features.map((f) =>
      f.committed && f.commitment
        ? {
            ...f,
            commitment: {
              ...f.commitment,
              end: deliverySprintEnd(state, f.appId, f.commitment.end),
            },
          }
        : f,
    ),
  };
}
