import type { Feature, PlannerState, Sprint } from "./model";
import type { Schedule } from "./planning";

const overlaps = (sprint: Sprint, window?: { start?: string; end?: string }) =>
  !!window?.start &&
  window.start <= sprint.end &&
  (!window.end || window.end >= sprint.start);

function scopeHeading(scope: string) {
  switch (scope.trim().toLowerCase()) {
    case "fe":
    case "frontend":
    case "front end":
    case "front-end":
    case "web frontend":
    case "web frontend & full stack":
      return "Web Frontend & Full stack";
    case "be":
    case "backend":
    case "back end":
    case "back-end":
      return "Backend";
    case "mobile":
      return "Mobile";
    default:
      return scope.trim();
  }
}

/** Document content follows forecast windows; sprint assignment is a start bound. */
export function sprintPlanContent(
  state: PlannerState,
  sprint: Sprint,
  forecast: Schedule,
) {
  const features = state.features
    .filter(
      (f) =>
        f.appId === sprint.appId &&
        (f.sprintId === sprint.id || overlaps(sprint, forecast.features[f.id])),
    )
    .sort((a, b) => a.priority - b.priority);
  const goals = features.flatMap((feature) => {
    const window = forecast.features[feature.id];
    if (!window?.start)
      return feature.sprintId === sprint.id
        ? [`${feature.title} (not scheduled)`]
        : [];
    if (!overlaps(sprint, window)) return [];
    if (window.end && window.end <= sprint.end) return [feature.title];
    return [
      `${window.start >= sprint.start ? "Start" : "Proceed with"} ${feature.title}`,
    ];
  });
  const sections = new Map<string, { feature: Feature; title: string }[]>([
    ["Web Frontend & Full stack", []],
    ["Backend", []],
    ["Mobile", []],
  ]);
  for (const feature of features) {
    // Estimates create internal reservations, not user-entered scope objectives.
    for (const task of feature.tasks) {
      const window = forecast.tasks[task.id];
      if (
        !overlaps(sprint, window) &&
        !(feature.sprintId === sprint.id && !window?.start)
      )
        continue;
      const scope = scopeHeading(task.scope);
      const items = sections.get(scope) ?? [];
      if (
        !items.some(
          (item) => item.feature.id === feature.id && item.title === task.title,
        )
      )
        items.push({ feature, title: task.title });
      sections.set(scope, items);
    }
  }
  return { features, goals, sections };
}
