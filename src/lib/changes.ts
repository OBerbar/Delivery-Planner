import type { PlannerState, Feature } from "./model";
import { differenceInCalendarDays, parseISO } from "date-fns";
import { featureAssignees, featureWork } from "./feature-work";
import { occurrenceGroupId, featureOccurrences } from "./occurrences";
import type { Schedule } from "./planning";
export function applyFeatureChange(
  state: PlannerState,
  feature: Feature | null,
  previousId?: string,
): PlannerState {
  const id = feature?.id ?? previousId;
  const old = state.features.find((f) => f.id === id);
  const replacementIds = new Set(
    feature ? featureWork(state, feature).map((t) => t.id) : [],
  );
  const removed = old
    ? featureWork(state, old)
        .filter((t) => !replacementIds.has(t.id))
        .map((t) => t.id)
    : [];
  let features: Feature[];
  if (!feature) features = state.features.filter((f) => f.id !== id);
  else if (old) {
    // Group membership is stable when editing an existing occurrence.
    const replacement = old.occurrenceGroupId
      ? { ...feature, occurrenceGroupId: old.occurrenceGroupId }
      : feature;
    const siblings = new Set(
      featureOccurrences(state.features, old).map((f) => f.id),
    );
    features = state.features.map((f) =>
      f.id === id
        ? replacement
        : siblings.has(f.id)
          ? { ...f, title: feature.title }
          : f,
    );
  } else if (
    feature.occurrenceGroupId &&
    featureOccurrences(state.features, feature).length
  ) {
    const siblings = new Set(
      featureOccurrences(state.features, feature).map((f) => f.id),
    );
    const lastSibling = state.features.reduce(
      (last, f, index) => (siblings.has(f.id) ? index : last),
      -1,
    );
    features = state.features.map((f) =>
      siblings.has(f.id)
        ? {
            ...f,
            occurrenceGroupId: occurrenceGroupId(feature),
            title: feature.title,
          }
        : f,
    );
    features.splice(lastSibling + 1, 0, feature);
  } else
    features = [
      { ...feature, priority: 0 },
      ...state.features.map((f) => ({ ...f, priority: f.priority + 1 })),
    ];
  return {
    ...state,
    features: features.map((f) => ({
      ...f,
      tasks: f.tasks.map((t) => ({
        ...t,
        dependsOn: t.dependsOn.filter((d) => !removed.includes(d)),
        dependsOnFeatures: t.dependsOnFeatures?.filter((d) =>
          features.some((f) => f.id === d),
        ),
      })),
    })),
  };
}

/** Save editor drafts atomically, cleaning deleted links after every draft is present. */
export function applyFeatureChanges(
  state: PlannerState,
  changed: Feature[],
  deletedIds: string[] = [],
): PlannerState {
  let next = changed.reduce(
    (current, feature) => applyFeatureChange(current, feature),
    state,
  );
  for (const id of deletedIds) next = applyFeatureChange(next, null, id);
  const remaining = new Set(
    next.features.flatMap((f) => featureWork(next, f).map((t) => t.id)),
  );
  const removed = new Set(
    state.features
      .flatMap((f) => featureWork(state, f).map((t) => t.id))
      .filter((id) => !remaining.has(id)),
  );
  const featureIds = new Set(next.features.map((f) => f.id));
  return {
    ...next,
    features: next.features.map((f) => ({
      ...f,
      tasks: f.tasks.map((t) => ({
        ...t,
        dependsOn: t.dependsOn.filter((id) => !removed.has(id)),
        dependsOnFeatures: t.dependsOnFeatures?.filter((id) =>
          featureIds.has(id),
        ),
      })),
    })),
  };
}

export interface DeliveryChange {
  id: string;
  title: string;
  before?: string;
  after?: string;
  days?: number;
  reason?: string;
}
export function describeDeliveryChanges(
  before: PlannerState,
  after: PlannerState,
  previous: Schedule,
  next: Schedule,
): DeliveryChange[] {
  const added = after.features.filter(
    (f) => !before.features.some((v) => v.id === f.id),
  );
  return before.features
    .filter(
      (f) =>
        after.features.some((v) => v.id === f.id) &&
        previous.features[f.id]?.end !== next.features[f.id]?.end,
    )
    .map((f) => {
      const oldDate = previous.features[f.id]?.end;
      const newDate = next.features[f.id]?.end;
      const delta =
        oldDate && newDate
          ? differenceInCalendarDays(parseISO(newDate), parseISO(oldDate))
          : undefined;
      const owners = featureAssignees(f);
      const reservations = added
        .map((a) => ({
          feature: a,
          shared: featureAssignees(a).filter((p) => owners.includes(p)),
        }))
        .filter((a) => a.shared.length);
      const reason =
        added.length && (delta === undefined || delta > 0)
          ? reservations.length
            ? reservations
                .map(
                  (a) =>
                    `Adding “${a.feature.title}” reserved ${a.shared.map((p) => after.people.find((v) => v.id === p)?.name ?? "a shared assignee").join(", ")} ahead of this feature.`,
                )
                .join(" ")
            : `Adding “${added.map((a) => a.title).join(", ")}” shifted shared capacity or dependent work.`
          : undefined;
      return {
        id: f.id,
        title: f.title,
        before: oldDate,
        after: newDate,
        days: delta,
        reason,
      };
    });
}
