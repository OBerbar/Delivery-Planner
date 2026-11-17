import { featureDays, workingDays, dayLength } from "./working-days";
import { differenceInCalendarDays, parseISO } from "date-fns";
import { stateSchema, type Feature, type PlannerState } from "./model";
import { schedule, type Schedule } from "./planning";
import { featureAssignees, featureWork } from "./feature-work";
export interface Experiment {
  base: PlannerState;
  draft: PlannerState;
  revision: number;
  history: PlannerState[];
}
export function beginExperiment(
  state: PlannerState,
  revision: number,
): Experiment {
  const base = stateSchema.parse(state);
  return { base, draft: structuredClone(base), revision, history: [] };
}
export function changeExperiment(
  session: Experiment,
  next: PlannerState,
): Experiment {
  const parsed = stateSchema.parse(next);
  for (const sprint of session.base.sprints) {
    const candidate = parsed.sprints.find((s) => s.id === sprint.id);
    if (
      sprint.snapshot &&
      (!candidate || candidate.snapshot !== sprint.snapshot)
    )
      throw new Error(
        "Finalized plans cannot be changed inside an experiment. Apply or Discard first.",
      );
  }
  for (const feature of session.base.features) {
    const candidate = parsed.features.find((f) => f.id === feature.id);
    if (
      candidate &&
      (candidate.committed !== feature.committed ||
        JSON.stringify(candidate.commitment) !==
          JSON.stringify(feature.commitment))
    )
      throw new Error(
        "Accepted delivery dates cannot be changed inside an experiment. Apply or Discard first.",
      );
  }
  if (JSON.stringify(parsed) === JSON.stringify(session.draft)) return session;
  return {
    ...session,
    draft: parsed,
    history: [...session.history.slice(-19), session.draft],
  };
}
export function undoExperiment(session: Experiment): Experiment {
  if (!session.history.length) return session;
  return {
    ...session,
    draft: session.history.at(-1)!,
    history: session.history.slice(0, -1),
  };
}
export interface ExperimentFeatureChange {
  id: string;
  title: string;
  app: string;
  people: string[];
  kind: "added" | "removed" | "changed";
  before?: string;
  after?: string;
  days?: number;
  startBefore?: string;
  startAfter?: string;
  reasons: string[];
  allocatedDaysBefore: number;
  allocatedDaysAfter: number;
  allocatedBefore: number;
  allocatedAfter: number;
}
export interface ExperimentComparison {
  features: ExperimentFeatureChange[];
  people: {
    id: string;
    name: string;
    before: number;
    after: number;
    beforeDays: number;
    afterDays: number;
  }[];
}

const tolerance = 1e-7;

/** Priority numbers are rewritten on insertion, even for unaffected features. */
function featureEditReasons(before: Feature, after: Feature): string[] {
  const fields: [string, (keyof Feature)[]][] = [
    ["Placement changed", ["placement"]],
    ["Title changed", ["title"]],
    ["Description changed", ["description"]],
    ["Completion conditions changed", ["completion"]],
    ["Assignees changed", ["assigneeIds"]],
    [
      "Estimate changed",
      ["sprintEstimate", "assigneeEstimates", "estimateEffort"],
    ],
    ["Task breakdown or dependencies changed", ["tasks"]],
    ["Assigned sprint changed", ["sprintId"]],
    ["Start restriction changed", ["notBefore"]],
    ["Planning start changed", ["planningFrom"]],
    ["Scheduling options changed", ["ignoreLeave", "doesntAffectOtherWork"]],
    [
      "Status or actual dates changed",
      ["status", "blocked", "unblockDate", "actualStart", "actualEnd"],
    ],
    ["Target delivery changed", ["target"]],
    ["Reference changed", ["link"]],
    ["App changed", ["appId"]],
    ["Occurrence grouping changed", ["occurrenceGroupId"]],
    ["Accepted delivery changed", ["committed", "commitment"]],
  ];
  return fields
    .filter(([, keys]) =>
      keys.some((key) =>
        key === "placement"
          ? (before.placement ?? "timeline") !== (after.placement ?? "timeline")
          : JSON.stringify(before[key]) !== JSON.stringify(after[key]),
      ),
    )
    .map(([label]) => label);
}

function personBookings(
  state: PlannerState,
  feature: Feature,
  forecast: Schedule,
) {
  const result = new Map<string, Map<string, number>>();
  for (const task of featureWork(state, feature)) {
    const dates = result.get(task.personId) ?? new Map<string, number>();
    for (const day of forecast.tasks[task.id]?.days ?? [])
      dates.set(day.date, (dates.get(day.date) ?? 0) + day.hours);
    result.set(task.personId, dates);
  }
  return result;
}

function changedBookingPeople(
  before: Map<string, Map<string, number>>,
  after: Map<string, Map<string, number>>,
) {
  return [...new Set([...before.keys(), ...after.keys()])].filter((id) => {
    const old = before.get(id),
      next = after.get(id);
    return [...new Set([...(old?.keys() ?? []), ...(next?.keys() ?? [])])].some(
      (date) =>
        Math.abs((old?.get(date) ?? 0) - (next?.get(date) ?? 0)) > tolerance,
    );
  });
}

export function compareExperiment(
  session: Experiment,
  now: string,
): ExperimentComparison {
  const previous = schedule(session.base, now),
    next = schedule(session.draft, now);
  const features: ExperimentFeatureChange[] = [];
  const ids = new Set([
    ...session.base.features.map((f) => f.id),
    ...session.draft.features.map((f) => f.id),
  ]);
  for (const id of ids) {
    const old = session.base.features.find((f) => f.id === id),
      current = session.draft.features.find((f) => f.id === id);
    const before = previous.features[id],
      after = next.features[id];
    const allocatedDaysBefore = old
      ? featureDays(session.base, old, previous)
      : 0;
    const allocatedDaysAfter = current
      ? featureDays(session.draft, current, next)
      : 0;
    const oldBookings = old
      ? personBookings(session.base, old, previous)
      : new Map<string, Map<string, number>>();
    const newBookings = current
      ? personBookings(session.draft, current, next)
      : new Map<string, Map<string, number>>();
    const total = (bookings: Map<string, Map<string, number>>) =>
      [...bookings.values()].reduce(
        (sum, dates) =>
          sum + [...dates.values()].reduce((n, hours) => n + hours, 0),
        0,
      );
    const allocatedBefore = total(oldBookings),
      allocatedAfter = total(newBookings);
    const reasons: string[] = [];
    if (old && current) {
      reasons.push(...featureEditReasons(old, current));
      if (before?.end !== after?.end) reasons.push("Forecast delivery changed");
      if (before?.start !== after?.start)
        reasons.push("Scheduled start changed");
      if (Math.abs(allocatedDaysBefore - allocatedDaysAfter) > tolerance)
        reasons.push("Allocated working days changed");
      else if (Math.abs(allocatedBefore - allocatedAfter) > tolerance)
        reasons.push("Allocated capacity changed");
      if (before?.warning !== after?.warning)
        reasons.push(
          after?.warning
            ? `Scheduling warning: ${after.warning}`
            : "Scheduling warning cleared",
        );
      if (before?.done !== after?.done)
        reasons.push("Scheduled status changed");
      if (
        Math.abs(
          (before?.capacityReassignedHours ?? 0) -
            (after?.capacityReassignedHours ?? 0),
        ) > tolerance
      )
        reasons.push("Parallel allocation changed");
      if (
        before?.commitmentDelayed !== after?.commitmentDelayed ||
        before?.delayDays !== after?.delayDays
      )
        reasons.push("Commitment risk changed");
      if (
        before?.start === after?.start &&
        before?.end === after?.end &&
        Math.abs(allocatedBefore - allocatedAfter) < tolerance &&
        Math.abs(allocatedDaysBefore - allocatedDaysAfter) < tolerance
      ) {
        for (const personId of changedBookingPeople(oldBookings, newBookings)) {
          const name =
            session.draft.people.find((p) => p.id === personId)?.name ??
            session.base.people.find((p) => p.id === personId)?.name ??
            "Person";
          reasons.push(`Work bookings changed for ${name}`);
        }
      }
      if (!reasons.length) continue;
    }
    const feature = current ?? old!;
    const state = current ? session.draft : session.base;
    const owners = new Set([
      ...(old ? featureAssignees(old) : []),
      ...(current ? featureAssignees(current) : []),
    ]);
    features.push({
      id,
      title: feature.title,
      app: state.apps.find((a) => a.id === feature.appId)?.name ?? "App",
      people: [...owners].map(
        (p) =>
          state.people.find((v) => v.id === p)?.name ??
          session.base.people.find((v) => v.id === p)?.name ??
          "Person",
      ),
      kind: !old ? "added" : !current ? "removed" : "changed",
      before: before?.end,
      after: after?.end,
      days:
        before?.end && after?.end
          ? differenceInCalendarDays(parseISO(after.end), parseISO(before.end))
          : undefined,
      startBefore: before?.start,
      startAfter: after?.start,
      reasons,
      allocatedDaysBefore,
      allocatedDaysAfter,
      allocatedBefore,
      allocatedAfter,
    });
  }
  const totals = (state: PlannerState, forecast: Schedule) => {
    const result = new Map<string, number>();
    for (const f of state.features)
      for (const task of featureWork(state, f)) {
        const hours = (forecast.tasks[task.id]?.days ?? []).reduce(
          (n, d) => n + d.hours,
          0,
        );
        result.set(task.personId, (result.get(task.personId) ?? 0) + hours);
      }
    return result;
  };
  const oldTotals = totals(session.base, previous),
    newTotals = totals(session.draft, next);
  const people = [...new Set([...oldTotals.keys(), ...newTotals.keys()])]
    .filter(
      (id) =>
        oldTotals.get(id) !== newTotals.get(id) ||
        Math.abs(
          workingDays(oldTotals.get(id) ?? 0, dayLength(session.base, id)) -
            workingDays(newTotals.get(id) ?? 0, dayLength(session.draft, id)),
        ) > 1e-7,
    )
    .map((id) => ({
      id,
      name:
        session.draft.people.find((p) => p.id === id)?.name ??
        session.base.people.find((p) => p.id === id)?.name ??
        "Person",
      beforeDays: workingDays(
        oldTotals.get(id) ?? 0,
        dayLength(session.base, id),
      ),
      afterDays: workingDays(
        newTotals.get(id) ?? 0,
        dayLength(session.draft, id),
      ),
      before: oldTotals.get(id) ?? 0,
      after: newTotals.get(id) ?? 0,
    }));
  return { features, people };
}
