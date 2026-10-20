import { addDays, format, parseISO } from "date-fns";
import { emptyState, stateSchema, type PlannerState } from "./model";
import { RevisionConflictError } from "./verified-save";

export function isSampleWorkspace() {
  return new URLSearchParams(window.location.search).get("sample") === "1";
}

/** Fictional records only; dates are fixed for a visit and refreshed on reset. */
export function createSampleState(start: string): PlannerState {
  const date = (offset: number) =>
    format(addDays(parseISO(start), offset), "yyyy-MM-dd");
  const app = {
    id: "sample-northstar",
    name: "Northstar",
    color: "#7565db",
    weekends: [0, 6],
    planningStart: start,
    cadence: "2w" as const,
    customDays: 14,
    terms:
      "Fictional planning example. Forecasts depend on the inputs you enter.",
    archived: false,
  };
  const feature = (
    id: string,
    appId: string,
    title: string,
    priority: number,
    estimates: [string, number][],
  ) => ({
    id,
    appId,
    title,
    priority,
    tasks: [],
    planningFrom: start,
    assigneeIds: estimates.map(([personId]) => personId),
    assigneeEstimates: estimates.map(([personId, value]) => ({
      personId,
      unit: "days" as const,
      value,
    })),
    estimateEffort: estimates.map(([personId, value]) => ({
      personId,
      hours: value * 8,
    })),
  });
  return stateSchema.parse({
    ...emptyState,
    apps: [
      app,
      { ...app, id: "sample-compass", name: "Compass", color: "#328eaa" },
    ],
    people: [
      { id: "sample-alex", name: "Alex Morgan", dailyHours: 8 },
      { id: "sample-sam", name: "Sam Rivera", dailyHours: 8 },
      { id: "sample-jamie", name: "Jamie Parker", dailyHours: 8 },
    ],
    members: [
      {
        id: "sample-member-alex",
        appId: app.id,
        personId: "sample-alex",
        role: "Frontend",
        allocation: 100,
        weekends: null,
      },
      {
        id: "sample-member-sam",
        appId: app.id,
        personId: "sample-sam",
        role: "Backend",
        allocation: 100,
        weekends: null,
      },
      {
        id: "sample-member-jamie",
        appId: app.id,
        personId: "sample-jamie",
        role: "Design",
        allocation: 100,
        weekends: null,
      },
      {
        id: "sample-member-shared",
        appId: "sample-compass",
        personId: "sample-jamie",
        role: "Design",
        allocation: 100,
        weekends: null,
      },
    ],
    features: [
      feature("sample-checkout", app.id, "Checkout", 0, [
        ["sample-alex", 3],
        ["sample-sam", 7],
      ]),
      feature("sample-account", app.id, "Account setup", 1, [
        ["sample-jamie", 2],
      ]),
      feature("sample-reporting", "sample-compass", "Reporting design", 2, [
        ["sample-jamie", 3],
      ]),
    ],
    calendarTemplates: [
      {
        id: "sample-calendar",
        name: "Example time off",
        entries: [
          {
            id: "sample-calendar-entry",
            name: "Planned leave",
            kind: "leave",
            start: date(2),
            end: date(3),
            hours: null,
          },
        ],
      },
    ],
  });
}

/** Deliberately has no fetch, database or browser-storage dependency. */
export function createSampleWorkspace(start: string) {
  let state = createSampleState(start);
  let revision = 0;
  const load = async () => ({ state: structuredClone(state), revision });
  const save = async (next: PlannerState, expectedRevision: number) => {
    if (expectedRevision !== revision)
      throw new RevisionConflictError(
        "The sample changed. Reload before trying again.",
      );
    state = stateSchema.parse(next);
    revision++;
    return load();
  };
  return { load, save };
}
