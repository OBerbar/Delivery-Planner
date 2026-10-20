import type { Feature, PlannerState, Task } from "./model";
import type { Schedule } from "./planning";

export type DateStatus = "todo" | "doing" | "done";
export type FeatureStatus = DateStatus | "blocked";
export const FEATURE_BLOCKED_COLOR = "#ad3045";
export const statusLabels: Record<FeatureStatus, string> = {
  todo: "Planned",
  doing: "In progress",
  blocked: "Blocked",
  done: "Done",
};

/** Scheduled start and end are inclusive. Missing windows remain planned. */
export function dateStatus(
  range: { start?: string; end?: string; reason?: string },
  now: string,
): DateStatus {
  if (range.reason || !range.start || !range.end || range.end < range.start)
    return "todo";
  return now < range.start ? "todo" : now > range.end ? "done" : "doing";
}

/** Explicit feature metadata overrides display only; scheduling stays automatic. */
export function featureStatus(
  feature: Feature,
  range: Parameters<typeof dateStatus>[0],
  now: string,
): FeatureStatus {
  return feature.blocked ? "blocked" : dateStatus(range, now);
}

/** Add scheduling anchors without changing legacy flags, effort or plan text. */
export function enableAutomaticPlanning(
  state: PlannerState,
  now: string,
): PlannerState {
  return {
    ...state,
    features: state.features.map((feature) =>
      feature.planningFrom ? feature : { ...feature, planningFrom: now },
    ),
  };
}

export function workIsDone(
  feature: Feature,
  task: Task,
  forecast: Schedule,
): boolean {
  return feature.planningFrom && forecast.asOf
    ? dateStatus(forecast.tasks[task.id] ?? {}, forecast.asOf) === "done"
    : task.status === "done";
}

/** Retain all bookings for stable dates, counting only unelapsed demand. */
export function remainingWorkHours(
  feature: Feature,
  task: Task,
  forecast: Schedule,
): number {
  if (workIsDone(feature, task, forecast)) return 0;
  if (!feature.planningFrom || !forecast.asOf)
    return task.status === "done" ? 0 : task.hours;
  const booking = forecast.tasks[task.id];
  if (!booking?.end) return task.hours;
  const elapsed = [...booking.days, ...(booking.capacityReassigned ?? [])]
    .filter((day) => day.date < forecast.asOf!)
    .reduce((sum, day) => sum + day.hours, 0);
  return Math.max(0, task.hours - elapsed);
}
