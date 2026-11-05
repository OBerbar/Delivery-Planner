import { differenceInCalendarDays, parseISO } from "date-fns";
import type { Feature, PlannerState } from "./model";
import type { Schedule } from "./planning";
import type { TimelineDisplayRow, TimelineWorkBar } from "./timeline-people";
import { featureWork, featureEstimateLabel } from "./feature-work";
import {
  dayLabel,
  personDayLabel,
  dayLength,
  remainingFeatureDays,
} from "./working-days";
import { dateStatus, FEATURE_BLOCKED_COLOR } from "./date-status";
import { groupOccurrences, occurrenceLabel } from "./occurrences";

/** Fit overlapping bars into lanes within their shared task row. */
export function layoutOccurrenceBars(
  bars: TimelineWorkBar[],
  start: string,
  end: string,
  cell: number,
): number {
  const offset = (date: string) =>
    differenceInCalendarDays(parseISO(date), parseISO(start));
  const width = (offset(end) + 1) * cell;
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
    const available = lanes.findIndex((last) => last + 6 <= left);
    bar.lane = available < 0 ? lanes.length : available;
    lanes[bar.lane] = right;
  }
  return Math.max(1, lanes.length);
}

/** Display only. Each saved occurrence retains its own scheduler result. */
export function featureTimelineRows(
  state: PlannerState,
  features: Feature[],
  forecast: Schedule,
  start: string,
  end: string,
  cell: number,
  expanded: string[] = [],
  person = "all",
): TimelineDisplayRow[] {
  const rows: TimelineDisplayRow[] = [];
  let top = 0;
  const append = (row: Omit<TimelineDisplayRow, "top">) => {
    rows.push({ ...row, top });
    top += row.height;
  };
  for (const occurrences of groupOccurrences(features)) {
    const first = occurrences[0];
    const app = state.apps.find((a) => a.id === first.appId)!;
    const bars: TimelineWorkBar[] = occurrences.map((feature) => {
      const result = forecast.features[feature.id];
      return {
        id: feature.id,
        feature,
        title:
          occurrences.length > 1 || feature.occurrenceGroupId
            ? `${feature.title} · ${occurrenceLabel(state, feature)}`
            : feature.title,
        forecast: {
          start: result?.start,
          end: result?.end,
          days: [],
          reason: result?.warning,
        },
        color: feature.blocked
          ? FEATURE_BLOCKED_COLOR
          : result?.done
            ? "#34886e"
            : app.color,
        child: false,
        lane: 0,
        taskIds: featureWork(state, feature).map((t) => t.id),
      };
    });
    const lanes = layoutOccurrenceBars(bars, start, end, cell);
    append({
      id: first.id,
      feature: first,
      title: first.title,
      sub:
        occurrences.length > 1
          ? `${occurrences.length} occurrences · ${dayLabel(occurrences.reduce((sum, f) => sum + remainingFeatureDays(state, f, forecast), 0))} remaining`
          : first.tasks.length
            ? `${first.tasks.length} tasks · ${dayLabel(remainingFeatureDays(state, first, forecast))} remaining`
            : `${featureEstimateLabel(first)} · ${first.assigneeIds?.length ?? 0} assignee${first.assigneeIds?.length === 1 ? "" : "s"}`,
      bars,
      height: Math.max(72, lanes * 48 + 24),
    });
    if (!expanded.includes(first.id)) continue;
    for (const feature of occurrences)
      for (const task of featureWork(state, feature).filter(
        (t) => person === "all" || t.personId === person,
      )) {
        const name =
          state.people.find((p) => p.id === task.personId)?.name ??
          "Unknown person";
        const title = feature.tasks.length ? task.title : name;
        const result = forecast.tasks[task.id] ?? { days: [] };
        append({
          id: task.id,
          feature,
          personId: task.personId,
          child: true,
          title,
          sub: `${occurrences.length > 1 ? `${occurrenceLabel(state, feature)} · ` : ""}${name} · ${personDayLabel(task.hours, dayLength(state, task.personId))} · ${task.scope}`,
          height: 72,
          bars: [
            {
              id: task.id,
              feature,
              title,
              forecast: result,
              color:
                dateStatus(result, forecast.asOf ?? start) === "done"
                  ? "#34886e"
                  : app.color,
              taskIds: [task.id],
              lane: 0,
              child: true,
            },
          ],
        });
      }
  }
  return rows;
}
