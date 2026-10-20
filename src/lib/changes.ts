import type { PlannerState, Feature } from "./model";
import { differenceInCalendarDays, parseISO } from "date-fns";
import { featureAssignees, featureWork } from "./feature-work";
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
  const features = feature
    ? old
      ? state.features.map((f) => (f.id === id ? feature : f))
      : [
          { ...feature, priority: 0 },
          ...state.features.map((f) => ({ ...f, priority: f.priority + 1 })),
        ]
    : state.features.filter((f) => f.id !== id);
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
