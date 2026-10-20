import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { populatedFixture, fixedToday } from "../scripts/maintenance-fixture";
import {
  stateSchema,
  reservationId,
  type PlannerState,
} from "../src/lib/model";
import {
  capacity,
  personCapacity,
  schedule,
  resources,
  generatePlan,
} from "../src/lib/planning";
import { featureWork } from "../src/lib/feature-work";
import { applyFeatureChange } from "../src/lib/changes";
import { timelinePrintPages } from "../src/lib/timeline-print-layout";
import { timelinePrintDocument } from "../src/lib/timeline-print-document";
import { createStore } from "../server/store";
import { createServer } from "../server/app";

function fixture() {
  const state = populatedFixture();
  state.apps[0].weekends = [5, 6];
  state.apps[0].planningStart = fixedToday;
  state.sprints[0].start = fixedToday;
  state.leaves = [];
  state.holidays = [];
  state.features = [
    {
      ...state.features[0],
      id: "original",
      title: "Five-day delivery",
      priority: 1,
      tasks: [],
      sprintEstimate: undefined,
      assigneeIds: ["p"],
      assigneeEstimates: [{ personId: "p", unit: "days", value: 5 }],
      estimateEffort: [{ personId: "p", hours: 40 }],
      sprintId: "s",
      committed: true,
      commitment: { end: "2030-01-10", acceptedAt: fixedToday },
      target: undefined,
      status: "todo",
    },
  ];
  return state;
}
function incoming(
  state: PlannerState,
  hours = 8,
  checked = true,
  id = "parallel",
) {
  return stateSchema.parse({
    ...state,
    features: [
      {
        ...state.features[0],
        id,
        title: id,
        priority: 0,
        committed: false,
        commitment: undefined,
        assigneeEstimates: [{ personId: "p", unit: "days", value: hours / 8 }],
        estimateEffort: [{ personId: "p", hours }],
        doesntAffectOtherWork: checked,
      },
      ...state.features,
    ],
  });
}
const hours = (forecast: ReturnType<typeof schedule>, id: string) =>
  forecast.tasks[reservationId(id, "p")].days.reduce((n, d) => n + d.hours, 0);
function bounded(state: PlannerState, result: ReturnType<typeof schedule>) {
  const people = new Map<string, number>(),
    apps = new Map<string, number>();
  for (const feature of state.features)
    for (const task of featureWork(state, feature))
      for (const d of result.tasks[task.id].days) {
        expect(d.hours).toBeGreaterThan(0);
        const key = task.personId + "|" + d.date,
          ak = feature.appId + "|" + key;
        people.set(key, (people.get(key) ?? 0) + d.hours);
        apps.set(ak, (apps.get(ak) ?? 0) + d.hours);
        expect(people.get(key)!).toBeLessThanOrEqual(
          personCapacity(state, task.personId, d.date) + 1e-7,
        );
        expect(apps.get(ak)!).toBeLessThanOrEqual(
          capacity(state, feature.appId, task.personId, d.date) + 1e-7,
        );
      }
}

describe("parallel work holds delivery windows while reallocating capacity", () => {
  it("keeps five-day estimate and delivery but allocates four days when one day is reassigned", () => {
    const original = fixture(),
      before = schedule(original, fixedToday),
      state = incoming(original),
      saved = structuredClone(state);
    const result = schedule(state, fixedToday);
    expect(result.features.original.end).toBe(before.features.original.end);
    expect(result.features.original.start).toBe(before.features.original.start);
    expect(hours(result, "original")).toBe(32);
    expect(hours(result, "parallel")).toBe(8);
    expect(result.features.original).toMatchObject({
      hours: 40,
      allocatedHours: 32,
      capacityReassignedHours: 8,
      commitmentDelayed: false,
    });
    expect(result.features.parallel.end).toBe(fixedToday);
    expect(state).toEqual(saved);
    expect(state.features[1].commitment).toEqual(
      original.features[0].commitment,
    );
    bounded(state, result);
  });
  it("unchecked work retains normal contention and removing checked work restores original allocation", () => {
    const original = fixture(),
      before = schedule(original, fixedToday),
      checked = incoming(original);
    const unchecked = incoming(original, 8, false);
    expect(schedule(unchecked, fixedToday).features.original.end).toBe(
      "2030-01-13",
    );
    expect(
      schedule(applyFeatureChange(checked, null, "parallel"), fixedToday),
    ).toEqual(before);
  });
  it("respects leave, selected holidays, app allocation and personal weekend overrides", () => {
    const original = fixture();
    original.members[0].weekends = [0, 6];
    original.members[0].allocation = 50;
    original.leaves = [
      {
        id: "l",
        personId: "p",
        start: "2030-01-08",
        end: "2030-01-08",
        hours: 4,
        note: "Appointment",
      },
    ];
    original.holidays = [
      {
        id: "h",
        appId: "a",
        date: "2030-01-09",
        name: "Closed",
        personIds: ["p"],
      },
    ];
    const state = incoming(original, 12),
      before = schedule(original, fixedToday),
      result = schedule(state, fixedToday);
    expect(result.features.original.end).toBe(before.features.original.end);
    expect(result.tasks[reservationId("parallel", "p")].days).toEqual([
      { date: "2030-01-07", hours: 4 },
      { date: "2030-01-08", hours: 4 },
      { date: "2030-01-10", hours: 4 },
    ]);
    expect(hours(result, "original")).toBe(28);
    bounded(state, result);
  });
  it("reassigns only overlapping capacity and restores it when the option is switched off", () => {
    const original = fixture(),
      state = incoming(original);
    state.features[0].notBefore = "2030-02-01";
    const result = schedule(state, fixedToday);
    expect(hours(result, "original")).toBe(40);
    expect(result.features.original.capacityReassignedHours).toBeUndefined();
    delete state.features[0].notBefore;
    state.features[0].doesntAffectOtherWork = false;
    expect(schedule(state, fixedToday).features.original.end).toBe(
      "2030-01-13",
    );
  });
  it("holds windows of multiple checked features and exposes zero remaining allocation honestly", () => {
    const state = incoming(
      incoming(fixture(), 8, true, "older"),
      8,
      true,
      "newer",
    );
    state.features[1].priority = 1;
    state.features[2].priority = 2;
    const result = schedule(state, fixedToday);
    expect(result.features.newer.end).toBe(fixedToday);
    expect(result.features.older.end).toBe(fixedToday);
    expect(hours(result, "newer")).toBe(8);
    expect(hours(result, "older")).toBe(0);
    expect(result.features.older).toMatchObject({
      allocatedHours: 0,
      capacityReassignedHours: 8,
    });
    expect(hours(result, "original")).toBe(32);
    bounded(state, result);
  });
  it("honors per-app allocation for a shared person without changing either app's original dates", () => {
    const original = fixture();
    original.apps.push({ ...original.apps[0], id: "b", name: "Other app" });
    original.members[0].allocation = 50;
    original.members.push({
      ...original.members[0],
      id: "other-member",
      appId: "b",
    });
    original.features[0].estimateEffort = [{ personId: "p", hours: 20 }];
    original.features.push({
      ...original.features[0],
      id: "other",
      appId: "b",
      sprintId: undefined,
      priority: 2,
    });
    const before = schedule(original, fixedToday),
      state = incoming(original, 4),
      result = schedule(state, fixedToday);
    expect(result.features.original.end).toBe(before.features.original.end);
    expect(result.features.other.end).toBe(before.features.other.end);
    expect(hours(result, "original")).toBe(16);
    expect(hours(result, "other")).toBe(20);
    bounded(state, result);
  });
  it("preserves optional-task sequencing and explicit dependencies", () => {
    const state = incoming(fixture(), 16);
    state.features[0].tasks = [
      {
        id: "first",
        title: "First",
        personId: "p",
        scope: "Dev",
        hours: 8,
        status: "todo",
        dependsOn: [],
      },
      {
        id: "second",
        title: "Second",
        personId: "p",
        scope: "Dev",
        hours: 8,
        status: "todo",
        dependsOn: ["first"],
      },
    ];
    state.features.push({
      ...state.features[1],
      id: "dependent",
      priority: 2,
      committed: false,
      commitment: undefined,
      tasks: [
        {
          id: "dependent-task",
          title: "Dependent",
          personId: "q",
          scope: "Design",
          hours: 6,
          status: "todo",
          dependsOn: [],
          dependsOnFeatures: ["parallel"],
        },
      ],
    });
    const result = schedule(state, fixedToday);
    expect(result.tasks.first.end).toBe(fixedToday);
    expect(result.tasks.second.start).toBe("2030-01-07");
    expect(result.tasks["dependent-task"].start).toBe("2030-01-08");
    expect(result.features.original.end).toBe("2030-01-10");
    expect(hours(result, "original")).toBe(24);
    bounded(state, result);
  });
  it("blocked and completed checked work do not borrow future capacity", () => {
    for (const status of ["blocked", "done"] as const) {
      const state = incoming(fixture());
      // Legacy direct-library inputs still honor manual blockers.
      for (const feature of state.features) delete feature.planningFrom;
      Object.assign(state.features[0], {
        status,
        actualStart: status === "done" ? "2030-01-02" : undefined,
        actualEnd: status === "done" ? "2030-01-03" : undefined,
        unblockDate: undefined,
      });
      const result = schedule(state, fixedToday);
      expect(hours(result, "original")).toBe(40);
      expect(result.features.original.end).toBe("2030-01-10");
      if (status === "done")
        expect(result.features.parallel.end).toBe("2030-01-03");
      else expect(result.features.parallel.end).toBeUndefined();
    }
  });
  it("accounts for reassigned capacity in resources, new plans and timeline PDFs without editing snapshots", () => {
    const state = incoming(fixture()),
      result = schedule(state, fixedToday),
      snapshot = state.sprints[0].snapshot;
    expect(resources(state, state.sprints[0], result)[0]).toMatchObject({
      demand: 48,
      scheduled: 40,
      reassigned: 8,
    });
    const text = generatePlan(state, state.sprints[0], result);
    expect(text).toContain("1 working day capacity reassigned");
    expect(text).toContain("Doesn't Effect Other Work");
    const pdf = timelinePrintDocument(
      state,
      "a",
      timelinePrintPages(state, "a", result, fixedToday, "2030-03-05"),
    );
    const printedText = [...pdf.matchAll(/<text\b[^>]*>([^<]*)<\/text>/g)]
      .map((match) => match[1])
      .join(" ");
    expect(printedText.includes("4 working days allocated")).toBe(true);
    expect(printedText.includes("1 working day reassigned")).toBe(true);
    expect(state.sprints[0].snapshot).toBe(snapshot);
  });
  it("rolls back an impossible checked forecast without reducing ordinary allocations", () => {
    const state = incoming(fixture(), 8000);
    state.features[0].estimateEffort![0].hours = 60000;
    const result = schedule(state, fixedToday);
    expect(result.features.parallel.end).toBeUndefined();
    expect(hours(result, "original")).toBe(40);
    expect(result.tasks[reservationId("parallel", "p")].days).toEqual([]);
  });
  it("preserves normal windows and bounded total bookings across generated overlaps", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const original = fixture();
      original.members[0].allocation = 25 * (1 + (seed % 4));
      original.features[0].estimateEffort![0].hours = 8 * (1 + (seed % 8));
      const before = schedule(original, fixedToday),
        state = incoming(
          incoming(original, 2 * (1 + (seed % 7)), true, "one"),
          4 * (1 + (seed % 5)),
          true,
          "two",
        );
      const result = schedule(state, fixedToday);
      expect(result.features.original.end).toBe(before.features.original.end);
      expect(result.features.original.start).toBe(
        before.features.original.start,
      );
      bounded(state, result);
    }
  });
});

const folders: string[] = [];
afterEach(() => {
  for (const folder of folders.splice(0))
    rmSync(folder, { recursive: true, force: true });
});
it("persists the optional flag through API, SQLite reopen and backup while rejecting invalid values", async () => {
  const folder = mkdtempSync(join(tmpdir(), "planner-parallel-"));
  folders.push(folder);
  const path = join(folder, "planner.sqlite"),
    store = createStore(path),
    app = createServer(store);
  try {
    const state = incoming(fixture());
    const response = await app.inject({
      method: "PUT",
      url: "/api/state",
      payload: { revision: 0, state },
    });
    expect(response.statusCode).toBe(200);
    expect(store.read().state.features[0]).toHaveProperty(
      "doesntAffectOtherWork",
      true,
    );
    const backup = JSON.parse(JSON.stringify(store.read().state));
    expect(stateSchema.parse(backup).features[0]).toHaveProperty(
      "doesntAffectOtherWork",
      true,
    );
    backup.features[0].doesntAffectOtherWork = "true";
    expect(
      (
        await app.inject({
          method: "PUT",
          url: "/api/state",
          payload: { revision: 1, state: backup },
        })
      ).statusCode,
    ).toBe(400);
    expect(store.read().revision).toBe(1);
  } finally {
    await app.close();
    store.close();
  }
  const reopened = createStore(path);
  try {
    expect(reopened.read().state.features[0]).toHaveProperty(
      "doesntAffectOtherWork",
      true,
    );
  } finally {
    reopened.close();
  }
});
it("accepts older backups without enabling parallel work or changing their forecast", () => {
  const state = fixture(),
    restored = stateSchema.parse(JSON.parse(JSON.stringify(state)));
  expect(restored.features[0].doesntAffectOtherWork).toBeFalsy();
  expect(schedule(restored, fixedToday)).toEqual(schedule(state, fixedToday));
});
