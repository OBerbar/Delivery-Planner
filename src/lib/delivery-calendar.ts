import type { PlannerState } from "./model";
import { commonWeekends, nextSprintPeriod } from "./sprint-calendar";
/** Explicit sprint periods win. Beyond them, project cadence without creating records. */
export function deliverySprintEnd(
  state: PlannerState,
  appId: string,
  finish: string,
): string {
  const app = state.apps.find((a) => a.id === appId);
  if (!app) throw new Error("Delivery app is missing.");
  const saved = state.sprints
    .filter((s) => s.appId === appId)
    .sort(
      (a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end),
    );
  const containing = saved.find((s) => s.start <= finish && s.end >= finish);
  if (containing) return containing.end;
  const weekends = commonWeekends(
    app.weekends,
    state.members.filter((m) => m.appId === appId).map((m) => m.weekends),
  );
  let prior: { start: string; end: string } | undefined;
  for (const next of saved) {
    if (next.end < finish) {
      prior = next;
      continue;
    }
    // A date in an override gap belongs to the next delivery opportunity.
    return next.end;
  }
  for (let i = 0; i < 4000; i++) {
    const period = nextSprintPeriod(app, weekends, prior);
    if (period.end >= finish) return period.end;
    prior = period;
  }
  throw new Error("Delivery is outside the supported sprint calendar.");
}
