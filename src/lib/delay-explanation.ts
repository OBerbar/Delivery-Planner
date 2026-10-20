import { getDay, parseISO } from "date-fns";
import { today, type Feature, type PlannerState, type Task } from "./model";
import { featureWork } from "./feature-work";
import { holidayApplies } from "./availability";
import { workIsDone } from "./date-status";
import {
  days,
  plus,
  schedule,
  capacity,
  type Schedule,
  type SchedulingDiagnostics,
} from "./planning";

export interface StartConstraint {
  kind: string;
  label: string;
  date?: string;
  featureId?: string;
  featureTitle?: string;
  personId?: string;
  personName?: string;
}
export interface PersonDelay {
  personId: string;
  dailyHours: number;
  name: string;
  end?: string;
  reason?: string;
  capacityLostHours: number;
  reassignedHours: number;
  competingWork: {
    featureId: string;
    title: string;
    appId: string;
    appName: string;
    hours: number;
    dates: string[];
    internal: boolean;
  }[];
  calendar: { kind: string; label: string; dates: string[]; hours: number }[];
  startConstraints: StartConstraint[];
}
export interface DelayExplanation {
  accepted: string;
  end?: string;
  delayDays?: number;
  people: PersonDelay[];
}

/** Replay with optional booking evidence; never rewrite forecasts or saved state. */
export function explainDelay(
  state: PlannerState,
  featureId: string,
  forecast: Schedule,
  now: string,
): DelayExplanation | null {
  const feature = state.features.find((f) => f.id === featureId),
    result = forecast.features[featureId];
  if (!feature?.commitment || !result?.commitmentDelayed || result.done)
    return null;
  const affected = featureWork(state, feature).filter(
    (t) =>
      !workIsDone(feature, t, forecast) &&
      (!forecast.tasks[t.id]?.end ||
        forecast.tasks[t.id].end! > feature.commitment!.end),
  );
  return {
    accepted: feature.commitment.end,
    end: result.end,
    delayDays: result.delayDays,
    people: constraintsForWork(state, feature, forecast, now, affected),
  };
}

/** Current scheduling context for every unfinished contribution, accepted or not. */
export function featureConstraints(
  state: PlannerState,
  feature: Feature,
  forecast: Schedule,
): PersonDelay[] {
  return constraintsForWork(
    state,
    feature,
    forecast,
    forecast.asOf ?? today(),
    featureWork(state, feature).filter(
      (t) => !workIsDone(feature, t, forecast),
    ),
  );
}

function constraintsForWork(
  state: PlannerState,
  feature: Feature,
  forecast: Schedule,
  now: string,
  work: Task[],
): PersonDelay[] {
  if (!work.length) return [];
  now = forecast.asOf ?? now;
  const diagnostics: SchedulingDiagnostics = new Map();
  schedule(state, now, diagnostics);
  const app = state.apps.find((a) => a.id === feature.appId)!;
  const owners = state.features.flatMap((f) =>
    featureWork(state, f).map((t) => ({ f, t })),
  );
  return [...new Set(work.map((t) => t.personId))].map((personId) => {
    const person = state.people.find((p) => p.id === personId)!;
    const tasks = work.filter((t) => t.personId === personId);
    const member = state.members.find(
      (m) => m.appId === feature.appId && m.personId === personId,
    );
    const off = member?.weekends ?? app.weekends;
    const nominalHours = (person.dailyHours * (member?.allocation ?? 0)) / 100;
    const lost = new Map<string, number>(),
      bookings = new Map<
        string,
        { date: string; featureId: string; appId: string; hours: number }
      >();
    const relevant = new Set<string>(),
      startConstraints: StartConstraint[] = [];
    for (const task of tasks) {
      const detail = diagnostics.get(task.id),
        tf = forecast.tasks[task.id];
      for (const id of task.dependsOn.filter(
        (id) => !forecast.tasks[id]?.end,
      )) {
        const owner = owners.find((o) => o.t.id === id);
        if (
          owner &&
          !startConstraints.some(
            (c) =>
              c.kind === "blocked-dependency" &&
              c.featureId === owner.f.id &&
              c.label === owner.t.title &&
              c.personId === owner.t.personId,
          )
        )
          startConstraints.push({
            kind: "blocked-dependency",
            label: owner.t.title,
            featureId: owner.f.id,
            featureTitle: owner.f.title,
            personId: owner.t.personId,
            personName:
              state.people.find((p) => p.id === owner.t.personId)?.name ??
              "Unknown person",
          });
      }
      const windowEnd = tf?.end ?? detail?.lastExamined;
      if (!detail || !windowEnd) continue;
      for (const date of days(detail.earliest, windowEnd)) relevant.add(date);
      for (const entry of detail.contention) {
        lost.set(
          entry.date,
          Math.min(
            capacity(
              state,
              feature.appId,
              personId,
              entry.date,
              feature.ignoreLeave,
            ),
            (lost.get(entry.date) ?? 0) + entry.lostHours,
          ),
        );
        for (const b of entry.bookings)
          bookings.set(`${b.taskId}|${entry.date}`, {
            ...b,
            date: entry.date,
          });
      }
      const sprint = state.sprints.find((s) => s.id === feature.sprintId);
      const limits: StartConstraint[] = [
        feature.planningFrom
          ? {
              kind: "planning-from",
              label: "Planning began",
              date: feature.planningFrom,
            }
          : { kind: "today", label: "Planning from today", date: now },
        {
          kind: "app-start",
          label: "App planning starts",
          date: app.planningStart,
        },
        ...(feature.notBefore
          ? [
              {
                kind: "not-before",
                label: "Start no earlier than",
                date: feature.notBefore,
              },
            ]
          : []),
        ...(sprint
          ? [
              {
                kind: "sprint",
                label: `Assigned sprint ${sprint.number} starts`,
                date: sprint.start,
              },
            ]
          : []),
        ...(task.status === "blocked" && task.unblockDate
          ? [
              {
                kind: "unblock",
                label: "Expected unblock date",
                date: task.unblockDate,
              },
            ]
          : []),
        ...task.dependsOn.flatMap((id) => {
          const owner = owners.find((o) => o.t.id === id),
            end = forecast.tasks[id]?.end;
          return owner && end
            ? [
                {
                  kind: "dependency",
                  label: owner.t.title,
                  date: plus(end, 1),
                  featureId: owner.f.id,
                  featureTitle: owner.f.title,
                  personId: owner.t.personId,
                  personName:
                    state.people.find((p) => p.id === owner.t.personId)?.name ??
                    "Unknown person",
                },
              ]
            : [];
        }),
      ];
      for (const limit of limits.filter((l) => l.date === detail.earliest))
        if (
          !startConstraints.some(
            (l) => JSON.stringify(l) === JSON.stringify(limit),
          )
        )
          startConstraints.push(limit);
    }
    const competingWork = [
      ...new Set([...bookings.values()].map((b) => b.featureId)),
    ].map((id) => {
      const source = state.features.find((f) => f.id === id)!;
      const rows = [...bookings.values()].filter((b) => b.featureId === id);
      return {
        featureId: id,
        title: source.title,
        appId: source.appId,
        appName: state.apps.find((a) => a.id === source.appId)!.name,
        hours: rows.reduce((n, b) => n + b.hours, 0),
        dates: [...new Set(rows.map((b) => b.date))].sort(),
        internal: id === feature.id,
      };
    });
    const calendarMap = new Map<
      string,
      { kind: string; label: string; dates: string[]; hours: number }
    >();
    function calendar(
      kind: string,
      label: string,
      date: string,
      hours: number,
    ) {
      const key = kind + "|" + label;
      const item = calendarMap.get(key) ?? {
        kind,
        label,
        dates: [],
        hours: 0,
      };
      item.dates.push(date);
      item.hours += hours;
      calendarMap.set(key, item);
    }
    for (const date of [...relevant].sort()) {
      // Each nonworking date is categorized once; overlapping absences do not add capacity.
      if (off.includes(getDay(parseISO(date)))) {
        if (nominalHours > 1e-7)
          calendar("weekend", "Weekend", date, nominalHours);
        continue;
      }
      const holidays = state.holidays.filter((h) =>
        holidayApplies(h, feature.appId, personId, date),
      );
      if (holidays.length) {
        calendar(
          "holiday",
          [...new Set(holidays.map((h) => h.name))].join(" / "),
          date,
          nominalHours,
        );
        continue;
      }
      const leave = state.leaves.filter(
        (l) => l.personId === personId && l.start <= date && l.end >= date,
      );
      const lostToLeave =
        nominalHours -
        capacity(state, feature.appId, personId, date, feature.ignoreLeave);
      if (!feature.ignoreLeave && leave.length && lostToLeave > 1e-7)
        calendar(
          "leave",
          [...new Set(leave.map((l) => l.note || "Personal leave"))].join(
            " / ",
          ),
          date,
          lostToLeave,
        );
    }
    const ends = tasks
      .flatMap((t) =>
        forecast.tasks[t.id]?.end ? [forecast.tasks[t.id].end!] : [],
      )
      .sort();
    return {
      personId,
      dailyHours: person.dailyHours,
      name: person.name,
      end: tasks.some((t) => !forecast.tasks[t.id]?.end)
        ? undefined
        : ends.at(-1),
      reason: tasks.map((t) => forecast.tasks[t.id]?.reason).find(Boolean),
      capacityLostHours: [...lost.values()].reduce((n, h) => n + h, 0),
      reassignedHours: tasks
        .flatMap((t) => forecast.tasks[t.id]?.capacityReassigned ?? [])
        .reduce((n, d) => n + d.hours, 0),
      competingWork,
      calendar: [...calendarMap.values()],
      startConstraints,
    };
  });
}

export function dateRanges(dates: string[]): { start: string; end: string }[] {
  const sorted = [...new Set(dates)].sort(),
    result: { start: string; end: string }[] = [];
  for (const date of sorted) {
    const last = result.at(-1);
    if (last && plus(last.end, 1) === date) last.end = date;
    else result.push({ start: date, end: date });
  }
  return result;
}
