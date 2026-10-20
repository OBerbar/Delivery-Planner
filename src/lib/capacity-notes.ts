import type { PlannerState } from "./model";
import { dayLabel, taskDayTotals } from "./working-days";
import type { Schedule } from "./planning";

/** Actual allocated capacity can shrink while forecast windows/estimates stay fixed. */
export function workCapacityNote(
  state: PlannerState,
  forecast: Schedule,
  taskIds: string[],
): string {
  const tasks = [...new Set(taskIds)].map((id) => forecast.tasks[id]);
  const removed = tasks
    .flatMap((t) => t?.capacityReassigned ?? [])
    .reduce((n, d) => n + d.hours, 0);
  if (removed <= 1e-7) return "";
  return `${dayLabel(taskDayTotals(state, forecast, taskIds))} allocated; ${dayLabel(taskDayTotals(state, forecast, taskIds, true))} capacity reassigned. Delivery window held; original estimate retained.`;
}
