import type { Feature, PlannerState } from "./model";
import { featureWork } from "./feature-work";
import type { Schedule } from "./planning";
import { remainingWorkHours } from "./date-status";
export const workingDays = (hours: number, dailyHours: number) =>
  hours / dailyHours;
export const dayLabel = (value: number) =>
  `${+value.toFixed(3)} working day${value > 0 && value <= 1 ? "" : "s"}`;
export const personDayLabel = (hours: number, dailyHours: number) =>
  dayLabel(workingDays(hours, dailyHours));
export const dayLength = (state: PlannerState, id: string) =>
  state.people.find((p) => p.id === id)?.dailyHours ?? 8;
export function remainingFeatureDays(
  state: PlannerState,
  feature: Feature,
  forecast: Schedule,
) {
  return featureWork(state, feature).reduce(
    (sum, task) =>
      sum +
      workingDays(
        remainingWorkHours(feature, task, forecast),
        dayLength(state, task.personId),
      ),
    0,
  );
}
export function featureDays(
  state: PlannerState,
  feature: Feature,
  forecast?: Schedule,
  reassigned = false,
) {
  return featureWork(state, feature).reduce(
    (sum, t) =>
      sum +
      workingDays(
        forecast
          ? (
              forecast.tasks[t.id]?.[
                reassigned ? "capacityReassigned" : "days"
              ] ?? []
            ).reduce((n, d) => n + d.hours, 0)
          : t.status === "done"
            ? 0
            : t.hours,
        dayLength(state, t.personId),
      ),
    0,
  );
}
export function taskDayTotals(
  state: PlannerState,
  forecast: Schedule,
  ids: string[],
  reassigned = false,
) {
  const owners = new Map(
    state.features
      .flatMap((f) => featureWork(state, f))
      .map((t) => [t.id, t.personId]),
  );
  return [...new Set(ids)].reduce(
    (sum, id) =>
      sum +
      workingDays(
        (
          forecast.tasks[id]?.[reassigned ? "capacityReassigned" : "days"] ?? []
        ).reduce((n, d) => n + d.hours, 0),
        dayLength(state, owners.get(id) ?? ""),
      ),
    0,
  );
}
