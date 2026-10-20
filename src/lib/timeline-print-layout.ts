import { dayLabel, taskDayTotals } from "./working-days";
import { addMonths, format, getDay, parseISO } from "date-fns";
import type { PlannerState } from "./model";
import { days, plus, type Schedule } from "./planning";
import { featureWork } from "./feature-work";
import { holidayApplies } from "./availability";
import { FEATURE_BLOCKED_COLOR } from "./date-status";
import { peopleTimelineRows, type TimelineDisplayRow } from "./timeline-people";

export const PRINT_BODY_HEIGHT = 440;
export const PRINT_LABEL_WIDTH = 180;
export const PRINT_GRID_WIDTH = 820;
export const PRINT_LANE_HEIGHT = 28;
export type TimelinePrintScope = "all" | "features" | "compact-features";
export interface PrintRow extends TimelineDisplayRow {
  personIds: string[];
  labelLines: string[];
  subLines: string[];
  continued?: boolean;
}
export interface TimelinePrintPage {
  view: "features" | "people";
  compact?: boolean;
  start: string;
  end: string;
  dates: string[];
  rows: PrintRow[];
}

export function wrapPrintText(text: string, limit = 30): string[] {
  // Conservative Arial-bold widths keep even wide letters and unbroken names
  // inside the label column. The character cap keeps ordinary lines readable.
  const width = (value: string) =>
    Array.from(value).reduce(
      (sum, char) =>
        sum +
        (/[MWmw@#%]/.test(char)
          ? 11
          : /[ilI1.,'!:;| ]/.test(char)
            ? 4
            : /[A-Z]/.test(char)
              ? 9
              : /[a-z0-9-]/.test(char)
                ? 7
                : 11),
      0,
    );
  const fits = (value: string) =>
    Array.from(value).length <= limit && width(value) <= PRINT_LABEL_WIDTH - 24;
  const words: string[] = [];
  for (const word of text.trim().split(/\s+/)) {
    let chunk = "";
    for (const char of Array.from(word)) {
      if (chunk && !fits(chunk + char)) {
        words.push(chunk);
        chunk = "";
      }
      chunk += char;
    }
    if (chunk) words.push(chunk);
  }
  const lines: string[] = [];
  for (const word of words) {
    if (lines.length && fits(`${lines.at(-1)} ${word}`))
      lines[lines.length - 1] += ` ${word}`;
    else lines.push(word);
  }
  return lines.length ? lines : [""];
}

/** Display/export only. Reuse the same forecasts; never accept dates or save records. */
export function timelinePrintPages(
  state: PlannerState,
  appId: string,
  forecast: Schedule,
  start: string,
  end: string,
  scope: TimelinePrintScope = "all",
): TimelinePrintPage[] {
  const app = state.apps.find((a) => a.id === appId);
  if (
    !app ||
    !/^\d{4}-\d{2}-\d{2}$/.test(start) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(end) ||
    start > end
  )
    throw new Error("Choose a valid timeline date range.");
  const features = state.features
    .filter((f) => f.appId === appId)
    .sort((a, b) => a.priority - b.priority);
  const windows: { start: string; end: string }[] = [];
  for (let cursor = start; cursor <= end;) {
    const boundary = format(addMonths(parseISO(cursor), 2), "yyyy-MM-dd");
    const finish = plus(boundary, -1) < end ? plus(boundary, -1) : end;
    windows.push({ start: cursor, end: finish });
    cursor = plus(finish, 1);
  }
  const pages: TimelinePrintPage[] = [];
  const compact = scope === "compact-features";
  const views =
    scope !== "all"
      ? (["features"] as const)
      : (["features", "people"] as const);
  for (const view of views)
    for (const window of windows) {
      const dates = days(window.start, window.end);
      const cell = PRINT_GRID_WIDTH / dates.length;
      const source: TimelineDisplayRow[] =
        view === "people"
          ? peopleTimelineRows(
              state,
              appId,
              forecast,
              window.start,
              window.end,
              cell,
            )
          : features.map((f) => ({
              id: f.id,
              title: f.title,
              feature: f,
              height: 44,
              top: 0,
              sub: `${forecast.features[f.id]?.start ?? "Not scheduled"} - ${forecast.features[f.id]?.end ?? "Not scheduled"}`,
              bars: [
                {
                  id: f.id,
                  feature: f,
                  title: f.title,
                  forecast: {
                    start: forecast.features[f.id]?.start,
                    end: forecast.features[f.id]?.end,
                    days: [],
                    reason: forecast.features[f.id]?.warning,
                  },
                  color: f.blocked
                    ? FEATURE_BLOCKED_COLOR
                    : forecast.features[f.id]?.done
                      ? "#34886e"
                      : app.color,
                  taskIds: featureWork(state, f).map((t) => t.id),
                  lane: 0,
                },
              ],
            }));
      const rows: PrintRow[] = [];
      for (const row of source) {
        const labelLines = wrapPrintText(row.title);
        const workForecasts = [
          ...new Set(row.bars.flatMap((b) => b.taskIds)),
        ].map((id) => forecast.tasks[id]);
        const removed = workForecasts
          .flatMap((t) => t?.capacityReassigned ?? [])
          .reduce((n, d) => n + d.hours, 0);
        const sub = [
          row.sub,
          row.feature?.doesntAffectOtherWork ? "Parallel work" : "",
          removed > 1e-7
            ? `${dayLabel(
                taskDayTotals(
                  state,
                  forecast,
                  row.bars.flatMap((b) => b.taskIds),
                ),
              )} allocated; ${dayLabel(
                taskDayTotals(
                  state,
                  forecast,
                  row.bars.flatMap((b) => b.taskIds),
                  true,
                ),
              )} reassigned`
            : "",
        ]
          .filter(Boolean)
          .join("; ");
        const subLines = compact ? [] : wrapPrintText(sub);
        const labelHeight =
          labelLines.length * 12 + subLines.length * 11 + (compact ? 10 : 12);
        const maxLanes = Math.max(
          1,
          Math.floor((PRINT_BODY_HEIGHT - 16) / PRINT_LANE_HEIGHT),
        );
        const lanes = Math.max(1, ...row.bars.map((b) => b.lane + 1));
        for (let lane = 0; lane < lanes; lane += maxLanes) {
          const bars = row.bars
            .filter((b) => b.lane >= lane && b.lane < lane + maxLanes)
            .map((b) => ({ ...b, lane: b.lane - lane }));
          const height = compact
            ? Math.max(28, labelHeight)
            : Math.max(
                44,
                Math.min(PRINT_BODY_HEIGHT, labelHeight + (lane > 0 ? 11 : 0)),
                Math.min(maxLanes, lanes - lane) * PRINT_LANE_HEIGHT + 16,
              );
          rows.push({
            ...row,
            labelLines,
            subLines,
            personIds: row.personId
              ? [row.personId]
              : [
                  ...new Set(
                    featureWork(state, row.feature!).map((t) => t.personId),
                  ),
                ],
            bars,
            height,
            top: 0,
            continued: lane > 0,
          });
        }
      }
      let batch: PrintRow[] = [],
        used = 0;
      const flush = () => {
        pages.push({ view, compact, ...window, dates, rows: batch });
        batch = [];
        used = 0;
      };
      for (const row of rows) {
        if (batch.length && used + row.height > PRINT_BODY_HEIGHT) flush();
        batch.push({ ...row, top: used });
        used += row.height;
      }
      if (batch.length || !rows.length) flush();
    }
  return pages;
}

export function printDayKind(
  state: PlannerState,
  appId: string,
  row: PrintRow,
  date: string,
): "holiday" | "leave" | "weekend" | "working" {
  const app = state.apps.find((a) => a.id === appId)!;
  if (
    state.holidays.some(
      (h) =>
        h.appId === appId &&
        h.date === date &&
        (h.personIds === undefined ||
          row.personIds.some((id) => holidayApplies(h, appId, id, date))),
    )
  )
    return "holiday";
  if (
    state.leaves.some(
      (l) =>
        row.personIds.includes(l.personId) && l.start <= date && l.end >= date,
    )
  )
    return "leave";
  const member = state.members.find(
    (m) => m.appId === appId && m.personId === row.personId,
  );
  return (member?.weekends ?? app.weekends).includes(getDay(parseISO(date)))
    ? "weekend"
    : "working";
}
