import { differenceInCalendarDays, parseISO } from "date-fns";
import type { Feature, PlannerState } from "./model";
import { featureWork } from "./feature-work";
import { dateStatus, FEATURE_BLOCKED_COLOR } from "./date-status";
import { today } from "./model";
import type { Schedule, TaskForecast } from "./planning";

export interface TimelineWorkBar {
  id: string;
  feature: Feature;
  title: string;
  forecast: TaskForecast;
  color: string;
  taskIds: string[];
  lane: number;
  child?: boolean;
}
export interface TimelineDisplayRow {
  id: string;
  title: string;
  sub?: string;
  personId?: string;
  feature?: Feature;
  child?: boolean;
  bars: TimelineWorkBar[];
  height: number;
  top: number;
}

/** Display layout only: forecasts, effort and saved state are never changed. */
export function peopleTimelineRows(
  state: PlannerState,
  appId: string,
  forecast: Schedule,
  start: string,
  end: string,
  cell: number,
): TimelineDisplayRow[] {
  const app = state.apps.find((a) => a.id === appId)!;
  const offset = (date: string) =>
    differenceInCalendarDays(parseISO(date), parseISO(start));
  const width = (offset(end) + 1) * cell;
  const features = state.features
    .filter((f) => f.appId === appId)
    .sort((a, b) => a.priority - b.priority);
  const byPerson = new Map<string, TimelineWorkBar[]>();
  for (const feature of features) {
    const work = featureWork(state, feature);
    for (const personId of new Set(work.map((task) => task.personId))) {
      const tasks = work.filter((task) => task.personId === personId);
      const forecasts = tasks.map(
        (task) => forecast.tasks[task.id] ?? { days: [] },
      );
      const starts = forecasts
        .flatMap((f) => (f.start ? [f.start] : []))
        .sort();
      const ends = forecasts.flatMap((f) => (f.end ? [f.end] : [])).sort();
      const reasons = [
        ...new Set(
          forecasts.flatMap((f) =>
            f.reason ? [f.reason] : !f.end ? ["Not scheduled"] : [],
          ),
        ),
      ];
      const bar: TimelineWorkBar = {
        id: feature.id,
        feature,
        title: feature.title,
        forecast: {
          start: starts[0],
          end: ends.at(-1),
          days: [],
          reason: reasons.join(" · ") || undefined,
        },
        taskIds: tasks.map((task) => task.id),
        color: feature.blocked
          ? FEATURE_BLOCKED_COLOR
          : dateStatus(
                {
                  start: starts[0],
                  end: ends.at(-1),
                  reason: reasons.join(" · ") || undefined,
                },
                forecast.asOf ?? today(),
              ) === "done"
            ? "#34886e"
            : app.color,
        lane: 0,
      };
      const bars = byPerson.get(personId) ?? [];
      bars.push(bar);
      byPerson.set(personId, bars);
    }
  }
  let top = 0;
  return [
    ...new Set(
      state.members.filter((m) => m.appId === appId).map((m) => m.personId),
    ),
  ].map((personId) => {
    const bars = byPerson.get(personId) ?? [];
    const intervals = bars
      .flatMap((bar) => {
        const f = bar.forecast;
        if (!f.end) return [{ bar, left: 0, right: width }];
        if (!f.start || f.end < start || f.start > end) return [];
        const left = Math.max(0, offset(f.start)) * cell + 4;
        return [
          {
            bar,
            left,
            right:
              left +
              Math.max(
                18,
                (Math.min(offset(end) + 1, offset(f.end) + 1) -
                  Math.max(0, offset(f.start))) *
                  cell -
                  8,
              ),
          },
        ];
      })
      .sort(
        (a, b) =>
          a.left - b.left || a.bar.feature.priority - b.bar.feature.priority,
      );
    const lanes: number[] = [];
    for (const { bar, left, right } of intervals) {
      const available = lanes.findIndex((lastRight) => lastRight + 6 <= left);
      bar.lane = available < 0 ? lanes.length : available;
      lanes[bar.lane] = right;
    }
    const height = Math.max(72, lanes.length * 48 + 24);
    const row: TimelineDisplayRow = {
      id: personId,
      personId,
      title: state.people.find((p) => p.id === personId)!.name,
      sub: bars.length
        ? `${bars.length} assigned feature${bars.length === 1 ? "" : "s"}`
        : "No assigned features",
      bars,
      height,
      top,
    };
    top += height;
    return row;
  });
}
