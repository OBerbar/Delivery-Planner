import { personDayLabel, dayLength } from "./working-days";
import { getDay, parseISO } from "date-fns";
import type { Feature, Leave, PlannerState } from "./model";
import { capacity, days, plus, type Schedule } from "./planning";
import { featureWork } from "./feature-work";
import { holidayApplies } from "./availability";
import { workIsDone } from "./date-status";

export interface FeatureLeavePerson {
  personId: string;
  name: string;
  dailyHours: number;
  remainingHours: number;
  lostHours: number;
  leaves: Leave[];
  calendarReason: string;
}
export interface FeatureLeaveDay {
  date: string;
  coverage: "partial" | "full";
  people: FeatureLeavePerson[];
}
export interface FeatureLeaveRange extends FeatureLeaveDay {
  end: string;
}

/** Display-only calendar context: never modifies effort, forecasts or commitments. */
export function featureLeaveDays(
  state: PlannerState,
  feature: Feature,
  forecast: Schedule,
  start: string,
  end: string,
): FeatureLeaveDay[] {
  if (feature.ignoreLeave || forecast.features[feature.id]?.done) return [];
  const work = featureWork(state, feature).filter(
    (t) => !workIsDone(feature, t, forecast) && t.hours > 0,
  );
  const withoutLeave = { ...state, leaves: [] };
  const app = state.apps.find((a) => a.id === feature.appId);
  if (!app || !work.length) return [];
  const result: FeatureLeaveDay[] = [];
  for (const date of days(start, end)) {
    const activeIds = [
      ...new Set(
        work
          .filter((t) => {
            const window = forecast.tasks[t.id];
            return (
              window?.start &&
              window.end &&
              window.start <= date &&
              window.end >= date
            );
          })
          .map((t) => t.personId),
      ),
    ];
    if (
      !activeIds.some((id) =>
        state.leaves.some(
          (l) => l.personId === id && l.start <= date && l.end >= date,
        ),
      )
    )
      continue;
    const people = activeIds.map((personId) => {
      const remainingHours = capacity(state, feature.appId, personId, date);
      const before = capacity(withoutLeave, feature.appId, personId, date);
      const leaves = state.leaves.filter(
        (l) => l.personId === personId && l.start <= date && l.end >= date,
      );
      const member = state.members.find(
        (m) => m.appId === feature.appId && m.personId === personId,
      );
      const holidays = state.holidays.filter((h) =>
        holidayApplies(h, feature.appId, personId, date),
      );
      const calendarReason = (member?.weekends ?? app.weekends).includes(
        getDay(parseISO(date)),
      )
        ? "Weekend"
        : holidays.length
          ? `Holiday: ${holidays.map((h) => h.name).join(", ")}`
          : before === 0
            ? "No app allocation"
            : "";
      return {
        personId,
        name:
          state.people.find((p) => p.id === personId)?.name ?? "Unknown person",
        dailyHours: dayLength(state, personId),
        remainingHours,
        lostHours: Math.max(0, before - remainingHours),
        leaves,
        calendarReason,
      };
    });
    result.push({
      date,
      coverage: people.every((p) => p.remainingHours <= 0.000001)
        ? "full"
        : "partial",
      people,
    });
  }
  return result;
}

export function featureLeaveRanges(
  values: FeatureLeaveDay[],
): FeatureLeaveRange[] {
  const result: FeatureLeaveRange[] = [];
  for (const day of values) {
    const last = result.at(-1);
    if (
      last &&
      plus(last.end, 1) === day.date &&
      last.coverage === day.coverage &&
      JSON.stringify(last.people) === JSON.stringify(day.people)
    )
      last.end = day.date;
    else result.push({ ...day, end: day.date });
  }
  return result;
}
export function featureLeaveSummary(day: FeatureLeaveDay): string {
  return `${day.coverage === "full" ? "All unavailable" : "Partial leave impact"}: ${day.people.map((p) => `${p.name}: ${[...p.leaves.map((l) => `Leave: ${l.note.trim() || "Personal leave"} (${l.hours === null ? "Full day off" : `${personDayLabel(l.hours, p.dailyHours)} off per day`}; ${l.start} – ${l.end})`), p.calendarReason].filter(Boolean).join(", ") || "Available"}; ${personDayLabel(p.remainingHours, p.dailyHours)} calendar capacity remaining`).join(" · ")}`;
}
