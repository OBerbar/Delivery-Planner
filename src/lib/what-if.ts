import { featureDays, workingDays, dayLength } from "./working-days";
import { differenceInCalendarDays, parseISO } from "date-fns";
import { stateSchema, type PlannerState } from "./model";
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
    if (
      old &&
      current &&
      JSON.stringify(old) === JSON.stringify(current) &&
      JSON.stringify(before) === JSON.stringify(after) &&
      Math.abs(
        featureDays(session.base, old, previous) -
          featureDays(session.draft, current, next),
      ) < 1e-7
    )
      continue;
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
      allocatedDaysBefore: old ? featureDays(session.base, old, previous) : 0,
      allocatedDaysAfter: current
        ? featureDays(session.draft, current, next)
        : 0,
      allocatedBefore: old
        ? featureWork(session.base, old).reduce(
            (sum, task) =>
              sum +
              (previous.tasks[task.id]?.days ?? []).reduce(
                (n, d) => n + d.hours,
                0,
              ),
            0,
          )
        : 0,
      allocatedAfter: current
        ? featureWork(session.draft, current).reduce(
            (sum, task) =>
              sum +
              (next.tasks[task.id]?.days ?? []).reduce(
                (n, d) => n + d.hours,
                0,
              ),
            0,
          )
        : 0,
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
