import {
  addDays,
  addMonths,
  differenceInCalendarDays,
  format,
  getDay,
  parseISO,
} from "date-fns";
import type { PlannerState, AppConfig, Feature, Sprint } from "./model";
import { calendarEvents } from "./calendar-display";
import { dayLabel, personDayLabel, featureDays } from "./working-days";
import { holidayApplies } from "./availability";
import { sprintPlanContent } from "./sprint-plan-content";
import { dateStatus, remainingWorkHours } from "./date-status";
import {
  featureWork,
  featureEstimates,
  estimateLabel,
  sprintLabel,
} from "./feature-work";
export const plus = (date: string, n: number) =>
  format(addDays(parseISO(date), n), "yyyy-MM-dd");
export const displayDate = (date?: string | null) =>
  date ? format(parseISO(date), "MMM d, yyyy") : "Not scheduled";
export const days = (start: string, end: string) =>
  Array.from(
    {
      length: Math.max(
        0,
        Math.min(
          3700,
          differenceInCalendarDays(parseISO(end), parseISO(start)) + 1,
        ),
      ),
    },
    (_, i) => plus(start, i),
  );
export function sprintEnd(
  start: string,
  cadence: AppConfig["cadence"],
  customDays: number,
) {
  return cadence === "month"
    ? format(addDays(addMonths(parseISO(start), 1), -1), "yyyy-MM-dd")
    : plus(
        start,
        (cadence === "2w" ? 14 : cadence === "3w" ? 21 : customDays) - 1,
      );
}
export function personCapacity(
  state: PlannerState,
  personId: string,
  date: string,
  ignoreLeave = false,
) {
  const person = state.people.find((p) => p.id === personId);
  if (!person) return 0;
  if (ignoreLeave) return person.dailyHours;
  const leave = state.leaves.filter(
    (l) => l.personId === personId && l.start <= date && l.end >= date,
  );
  const deduction = leave.some((l) => l.hours === null)
    ? person.dailyHours
    : leave.reduce((n, l) => n + (l.hours ?? 0), 0);
  return Math.max(0, person.dailyHours - deduction);
}
export function capacity(
  state: PlannerState,
  appId: string,
  personId: string,
  date: string,
  ignoreLeave = false,
) {
  const app = state.apps.find((a) => a.id === appId),
    member = state.members.find(
      (m) => m.appId === appId && m.personId === personId,
    ),
    person = state.people.find((p) => p.id === personId);
  if (!app || !member || !person || app.archived) return 0;
  if (
    (member.weekends ?? app.weekends).includes(getDay(parseISO(date))) ||
    state.holidays.some((h) => holidayApplies(h, appId, personId, date))
  )
    return 0;
  return Math.min(
    (person.dailyHours * member.allocation) / 100,
    personCapacity(state, personId, date, ignoreLeave),
  );
}
export interface TaskForecast {
  start?: string;
  end?: string;
  days: { date: string; hours: number }[];
  reason?: string;
  capacityReassigned?: { date: string; hours: number }[];
}
export interface FeatureForecast {
  start?: string;
  end?: string;
  warning?: string;
  hours: number;
  done: boolean;
  commitmentDelayed?: boolean;
  delayDays?: number;
  allocatedHours?: number;
  capacityReassignedHours?: number;
}
export interface Schedule {
  asOf?: string;
  tasks: Record<string, TaskForecast>;
  features: Record<string, FeatureForecast>;
}
interface CapacityBooking {
  taskId: string;
  featureId: string;
  appId: string;
  hours: number;
}
interface TaskSchedulingDiagnostics {
  earliest: string;
  lastExamined?: string;
  contention: {
    date: string;
    lostHours: number;
    bookings: CapacityBooking[];
  }[];
}
export type SchedulingDiagnostics = Map<string, TaskSchedulingDiagnostics>;
export function schedule(
  state: PlannerState,
  now: string,
  diagnostics?: SchedulingDiagnostics,
): Schedule {
  diagnostics?.clear();
  const result: Schedule = {
    asOf: now,
    tasks: Object.create(null),
    features: Object.create(null),
  };
  const shared = {
    person: new Map<string, number>(),
    app: new Map<string, number>(),
    bookings: new Map<string, CapacityBooking[]>(),
  };
  const parallel = new Map<string, typeof shared>();
  const rows = state.features
    .filter((f) => !state.apps.find((a) => a.id === f.appId)?.archived)
    .sort(
      (a, b) =>
        a.priority - b.priority ||
        state.apps.findIndex((v) => v.id === a.appId) -
          state.apps.findIndex((v) => v.id === b.appId),
    )
    .flatMap((f) => featureWork(state, f).map((t) => ({ f, t })));
  let pending = rows.slice();
  for (const f of state.features)
    for (const t of featureWork(state, f)) {
      if (t.status === "done")
        result.tasks[t.id] = {
          start: t.actualStart,
          end: t.actualEnd,
          days: [],
        };
      else if (state.apps.find((a) => a.id === f.appId)?.archived)
        result.tasks[t.id] = {
          days: [],
          reason: "App is archived — restore it to schedule this work",
        };
    }
  while (pending.length) {
    let advanced = false;
    const deferred: typeof pending = [];
    for (const { f, t } of pending) {
      if (result.tasks[t.id]) {
        advanced = true;
        continue;
      }
      if (t.dependsOn.some((d) => !result.tasks[d])) {
        deferred.push({ f, t });
        continue;
      }
      advanced = true;
      const bad = t.dependsOn.find((d) => !result.tasks[d].end);
      if (bad) {
        result.tasks[t.id] = {
          days: [],
          reason: "Waiting for an unscheduled or blocked dependency",
        };
        continue;
      }
      if (t.status === "blocked" && !t.unblockDate) {
        result.tasks[t.id] = {
          days: [],
          reason: "Blocked — add an expected unblock date",
        };
        continue;
      }
      const app = state.apps.find((a) => a.id === f.appId);
      const sprint = state.sprints.find((s) => s.id === f.sprintId);
      const planningFrom = f.planningFrom ?? now;
      let cursor = [
        planningFrom,
        app?.planningStart ?? planningFrom,
        f.notBefore ?? planningFrom,
        sprint?.start ?? planningFrom,
        (t.status === "blocked" ? t.unblockDate : undefined) ?? planningFrom,
        ...t.dependsOn.map((d) => plus(result.tasks[d].end!, 1)),
      ]
        .sort()
        .at(-1)!;
      // Checked work gets a calendar-constrained window without moving shared work.
      // Tasks within that feature still share its ledger and honor dependencies.
      if (f.doesntAffectOtherWork && !parallel.has(f.id))
        parallel.set(f.id, {
          person: new Map(),
          app: new Map(),
          bookings: new Map(),
        });
      const ledger = f.doesntAffectOtherWork ? parallel.get(f.id)! : shared;
      const personUsed = ledger.person,
        appUsed = ledger.app;
      let remaining = t.hours;
      const detail: TaskSchedulingDiagnostics = {
        earliest: cursor,
        contention: [],
      };
      diagnostics?.set(t.id, detail);
      const booked: { date: string; hours: number }[] = [];
      for (
        let i = 0;
        i < 1827 && remaining > 1e-7;
        i++, cursor = plus(cursor, 1)
      ) {
        const key = t.personId + "|" + cursor,
          appKey = f.appId + "|" + key;
        const available = Math.min(
          capacity(state, f.appId, t.personId, cursor, f.ignoreLeave) -
            (appUsed.get(appKey) ?? 0),
          personCapacity(state, t.personId, cursor, f.ignoreLeave) -
            (personUsed.get(key) ?? 0),
        );
        if (diagnostics) {
          detail.lastExamined = cursor;
          const base = Math.min(
            capacity(state, f.appId, t.personId, cursor, f.ignoreLeave),
            personCapacity(state, t.personId, cursor, f.ignoreLeave),
          );
          const lostHours =
            Math.min(remaining, base) -
            Math.min(remaining, Math.max(0, available));
          if (lostHours > 1e-7) {
            const bookings = ledger.bookings.get(key) ?? [];
            const contributing = new Set(
              bookings
                .map((b) => b.featureId)
                .filter((id) => {
                  const group = bookings.filter((b) => b.featureId === id);
                  const restored = Math.min(
                    capacity(
                      state,
                      f.appId,
                      t.personId,
                      cursor,
                      f.ignoreLeave,
                    ) -
                      (appUsed.get(appKey) ?? 0) +
                      group
                        .filter((b) => b.appId === f.appId)
                        .reduce((n, b) => n + b.hours, 0),
                    personCapacity(state, t.personId, cursor, f.ignoreLeave) -
                      (personUsed.get(key) ?? 0) +
                      group.reduce((n, b) => n + b.hours, 0),
                  );
                  return (
                    Math.min(remaining, restored) >
                    Math.min(remaining, Math.max(0, available)) + 1e-7
                  );
                }),
            );
            detail.contention.push({
              date: cursor,
              lostHours,
              bookings: bookings.filter((b) => contributing.has(b.featureId)),
            });
          }
        }
        if (available <= 1e-7) continue;
        const hours = Math.min(remaining, available);
        booked.push({ date: cursor, hours });
        remaining -= hours;
        personUsed.set(key, (personUsed.get(key) ?? 0) + hours);
        appUsed.set(appKey, (appUsed.get(appKey) ?? 0) + hours);
      }
      if (remaining > 1e-7) {
        for (const b of booked) {
          const key = t.personId + "|" + b.date,
            ak = f.appId + "|" + key;
          personUsed.set(key, (personUsed.get(key) ?? 0) - b.hours);
          appUsed.set(ak, (appUsed.get(ak) ?? 0) - b.hours);
        }
        result.tasks[t.id] = {
          days: [],
          reason:
            "Insufficient availability within the five-year forecast horizon",
        };
      } else {
        result.tasks[t.id] = {
          start: booked[0]?.date,
          end: booked.at(-1)?.date,
          days: booked,
        };
        if (diagnostics)
          for (const b of booked) {
            const key = t.personId + "|" + b.date;
            ledger.bookings.set(key, [
              ...(ledger.bookings.get(key) ?? []),
              { taskId: t.id, featureId: f.id, appId: f.appId, hours: b.hours },
            ]);
          }
      }
    }
    if (!advanced) {
      for (const { t } of deferred)
        result.tasks[t.id] = {
          days: [],
          reason: "Dependency cycle — review task connections",
        };
      break;
    }
    pending = deferred;
  }
  if (rows.some(({ f }) => f.doesntAffectOtherWork)) {
    // Allocate checked windows first, then clip overlapping ordinary bookings.
    // Keep the forecast windows and original effort; expose the removed capacity.
    const allocatedPerson = new Map<string, number>(),
      allocatedApp = new Map<string, number>();
    const ordered = [
      ...rows.filter(({ f }) => f.doesntAffectOtherWork),
      ...rows.filter(({ f }) => !f.doesntAffectOtherWork),
    ];
    for (const { f, t } of ordered) {
      const task = result.tasks[t.id];
      if (!task?.days.length || t.status === "done") continue;
      const kept: TaskForecast["days"] = [],
        reassigned: TaskForecast["days"] = [];
      for (const day of task.days) {
        const key = `${t.personId}|${day.date}`,
          appKey = `${f.appId}|${key}`;
        const room = Math.max(
          0,
          Math.min(
            personCapacity(state, t.personId, day.date, f.ignoreLeave) -
              (allocatedPerson.get(key) ?? 0),
            capacity(state, f.appId, t.personId, day.date, f.ignoreLeave) -
              (allocatedApp.get(appKey) ?? 0),
          ),
        );
        const hours = Math.min(day.hours, room);
        if (hours > 1e-7) {
          kept.push({ date: day.date, hours });
          allocatedPerson.set(key, (allocatedPerson.get(key) ?? 0) + hours);
          allocatedApp.set(appKey, (allocatedApp.get(appKey) ?? 0) + hours);
        }
        if (day.hours - hours > 1e-7)
          reassigned.push({ date: day.date, hours: day.hours - hours });
      }
      task.days = kept;
      if (reassigned.length) task.capacityReassigned = reassigned;
    }
  }
  for (const f of state.features) {
    const work = featureWork(state, f);
    const forecasts = work.map((t) => result.tasks[t.id]);
    const starts = forecasts.flatMap((v) => (v?.start ? [v.start] : [])).sort();
    const ends = forecasts.flatMap((v) => (v?.end ? [v.end] : [])).sort();
    const unscheduled = forecasts.find((v) => !v?.end);
    const end = unscheduled ? undefined : ends.at(-1);
    const done = f.planningFrom
      ? dateStatus({ start: starts[0], end }, now) === "done"
      : work.length > 0 && work.every((t) => t.status === "done");
    const commitmentDelayed = !!(
      f.committed &&
      f.commitment &&
      !done &&
      (!end || end > f.commitment.end)
    );
    const delayDays =
      commitmentDelayed && end
        ? differenceInCalendarDays(parseISO(end), parseISO(f.commitment!.end))
        : undefined;
    let warning =
      unscheduled?.reason ?? (unscheduled ? "App is archived" : undefined);
    if (end && f.target && end > f.target)
      warning = "Forecast exceeds the target date";
    if (commitmentDelayed && end)
      warning = `Forecast exceeds the accepted commitment by ${delayDays} calendar day${delayDays === 1 ? "" : "s"}`;
    const capacityReassignedHours = forecasts
      .flatMap((t) => t?.capacityReassigned ?? [])
      .reduce((n, d) => n + d.hours, 0);
    result.features[f.id] = {
      ...(capacityReassignedHours > 1e-7
        ? {
            capacityReassignedHours,
            allocatedHours: forecasts
              .flatMap((t) => t?.days ?? [])
              .reduce((n, d) => n + d.hours, 0),
          }
        : {}),
      start: starts[0],
      end,
      warning,
      hours: work.reduce((n, t) => n + remainingWorkHours(f, t, result), 0),
      done,
      commitmentDelayed,
      delayDays,
    };
  }
  return result;
}
export function resources(
  state: PlannerState,
  sprint: Sprint,
  forecast: Schedule,
) {
  const features = state.features.filter((f) => f.sprintId === sprint.id);
  return [
    ...new Set(
      features.flatMap((f) => featureWork(state, f).map((t) => t.personId)),
    ),
  ].map((personId) => {
    const person = state.people.find((p) => p.id === personId)!;
    const available = days(sprint.start, sprint.end).reduce(
      (n, date) => n + capacity(state, sprint.appId, personId, date),
      0,
    );
    const demand = features
      .flatMap((f) => featureWork(state, f).map((t) => ({ f, t })))
      .filter(({ t }) => t.personId === personId)
      .reduce((n, { f, t }) => n + remainingWorkHours(f, t, forecast), 0);
    const scheduled = features
      .flatMap((f) => featureWork(state, f))
      .filter((t) => t.personId === personId)
      .flatMap((t) => forecast.tasks[t.id]?.days ?? [])
      .filter((d) => d.date >= sprint.start && d.date <= sprint.end)
      .reduce((n, d) => n + d.hours, 0);
    const other = state.features
      .filter((f) => f.appId !== sprint.appId)
      .flatMap((f) => featureWork(state, f))
      .filter((t) => t.personId === personId)
      .flatMap((t) => forecast.tasks[t.id]?.days ?? [])
      .filter((d) => d.date >= sprint.start && d.date <= sprint.end)
      .reduce((n, d) => n + d.hours, 0);
    const reassigned = features
      .flatMap((f) => featureWork(state, f))
      .filter((t) => t.personId === personId)
      .flatMap((t) => forecast.tasks[t.id]?.capacityReassigned ?? [])
      .filter((d) => d.date >= sprint.start && d.date <= sprint.end)
      .reduce((n, d) => n + d.hours, 0);
    return { person, available, demand, scheduled, other, reassigned };
  });
}
const safe = (text: string) =>
  text.replace(/[\r\n]+/g, " ").replace(/([\\`*_{}\[\]<>|])/g, "\\$1");
export function generatePlan(
  state: PlannerState,
  sprint: Sprint,
  forecast: Schedule,
) {
  const app = state.apps.find((a) => a.id === sprint.appId)!;
  const { features, goals, sections } = sprintPlanContent(
    state,
    sprint,
    forecast,
  );
  const team = state.members
    .filter((m) => m.appId === sprint.appId)
    .map((m) => state.people.find((p) => p.id === m.personId)!)
    .filter(Boolean);
  const lines = [
    `**${safe(app.name)} - Sprint Plan Number ${sprint.number}**`,
    "",
    `**Sprint Period:** ${displayDate(sprint.start)} – ${displayDate(sprint.end)}`,
    "",
    `**Resources Allocated:** ${team.map((person) => safe(person.name)).join(", ") || "No resources assigned."}`,
    "",
    "**Capacity and Availability**",
    "___",
    ...state.leaves
      .filter(
        (l) =>
          team.some((p) => p.id === l.personId) &&
          l.start <= sprint.end &&
          l.end >= sprint.start,
      )
      .map(
        (l) =>
          `- ${safe(state.people.find((p) => p.id === l.personId)!.name)} is on leave ${l.start === l.end ? "on" : "from"} ${displayDate(l.start < sprint.start ? sprint.start : l.start)}${l.start === l.end ? "" : ` – ${displayDate(l.end > sprint.end ? sprint.end : l.end)}`}: ${l.hours === null ? "full-day leave" : `${personDayLabel(l.hours, state.people.find((p) => p.id === l.personId)!.dailyHours)} off per day`}${l.note ? ` (${safe(l.note)})` : ""}.`,
      ),
    ...calendarEvents(state, sprint.appId, sprint.start, sprint.end)
      .filter((e) => e.kind === "holiday")
      .map(
        (e) =>
          `- ${safe(e.name)}: ${displayDate(e.start < sprint.start ? sprint.start : e.start)}${e.end !== e.start ? ` – ${displayDate(e.end > sprint.end ? sprint.end : e.end)}` : ""} (${e.personIds.length === team.length ? "whole app" : e.personNames.map(safe).join(", ")}) — holiday.`,
      ),
    "",
    "**Sprint Goal**",
    "___",
    ...goals.map((goal) => `- ${safe(goal)}`),
    "",
    "**Delivery Commitment Boundary**",
    "___",
    ...features.map(
      (f) =>
        `- **${safe(f.title)}** — ${f.committed ? "Committed" : "Non-committed / discovery"}.${
          f.tasks.length
            ? ""
            : f.assigneeEstimates?.length
              ? ` Estimates: ${featureEstimates(f)
                  .map(
                    (e) =>
                      `${safe(state.people.find((p) => p.id === e.personId)?.name ?? "Assignee")}: ${estimateLabel(e)}`,
                  )
                  .join("; ")}.`
              : f.sprintEstimate
                ? ` Estimate: ${sprintLabel(f.sprintEstimate)}.`
                : ""
        }${f.committed ? (f.commitment ? ` Accepted delivery: ${displayDate(f.commitment.end)} (accepted ${displayDate(f.commitment.acceptedAt)}).` : " Delivery dates have not yet been accepted.") : ""}${f.ignoreLeave ? " Ignores personal leave." : ""}${f.doesntAffectOtherWork ? " Doesn't Effect Other Work: uses parallel capacity while holding other delivery windows." : ""}${forecast.features[f.id]?.capacityReassignedHours ? ` ${dayLabel(featureDays(state, f, forecast))} allocated; ${dayLabel(featureDays(state, f, forecast, true))} capacity reassigned, original estimate retained.` : ""} Forecast: ${displayDate(forecast.features[f.id]?.end)}.${forecast.features[f.id]?.warning ? ` ${forecast.features[f.id].warning}.` : ""}`,
    ),
    "",
    "**Objectives by Scope**",
    "___",
  ];
  for (const [scope, items] of sections) {
    lines.push(
      `**${safe(scope)}**`,
      ...items.map(
        ({ feature: f, title }) =>
          `- ${safe(f.title)}${f.tasks.length ? ` — ${safe(title)}` : ""}${f.committed ? "" : " (non-committed)"}`,
      ),
      "",
    );
  }
  lines.push(
    "**Completion Conditions**",
    "___",
    ...features.map(
      (f) =>
        `- ${safe(f.title)}: ${f.completion || "Completion conditions not entered."}`,
    ),
  );
  if (sprint.notes) lines.push("", "**Planning Notes**", "___", sprint.notes);
  lines.push(
    "",
    "**General Terms**",
    "___",
    app.terms || "No general terms configured.",
    "",
  );
  return lines.join("\n");
}
