import { featureDays } from "./working-days";
import type { PlannerState } from "./model";
import type { Schedule } from "./planning";
import { featureWork } from "./feature-work";
import { describeDeliveryChanges, type DeliveryChange } from "./changes";
export interface SchedulingChange extends DeliveryChange {
  allocatedDaysBefore: number;
  allocatedDaysAfter: number;
  allocatedBefore: number;
  allocatedAfter: number;
}
export function schedulingReview(
  before: PlannerState,
  after: PlannerState,
  previous: Schedule,
  next: Schedule,
): SchedulingChange[] {
  const dated = new Map(
    describeDeliveryChanges(before, after, previous, next).map((change) => [
      change.id,
      change,
    ]),
  );
  const changes: SchedulingChange[] = [];
  for (const feature of before.features) {
    const current = after.features.find((f) => f.id === feature.id);
    if (!current) continue;
    const booked = (
      state: PlannerState,
      item: typeof feature,
      forecast: Schedule,
    ) =>
      featureWork(state, item).reduce(
        (sum, task) =>
          sum +
          (forecast.tasks[task.id]?.days ?? []).reduce(
            (n, d) => n + d.hours,
            0,
          ),
        0,
      );
    const allocatedBefore = booked(before, feature, previous),
      allocatedAfter = booked(after, current, next);
    if (
      !dated.has(feature.id) &&
      Math.abs(allocatedBefore - allocatedAfter) < 1e-7
    )
      continue;
    changes.push({
      ...dated.get(feature.id),
      id: feature.id,
      title: current.title,
      before: previous.features[feature.id]?.end,
      after: next.features[feature.id]?.end,
      allocatedDaysBefore: featureDays(before, feature, previous),
      allocatedDaysAfter: featureDays(after, current, next),
      allocatedBefore,
      allocatedAfter,
    });
  }
  return changes;
}
