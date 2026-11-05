import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { maintenanceFixture, fixedToday } from "../scripts/maintenance-fixture";
import { stateSchema, type Feature, type PlannerState } from "../src/lib/model";
import { applyFeatureChange } from "../src/lib/changes";
import { STORAGE_SCHEMA_VERSION } from "../src/lib/runtime-version";

function fixture() {
  const state = structuredClone(maintenanceFixture());
  state.features = [state.features[0]];
  state.features[0].title = "Quarterly review";
  state.features[0].assigneeEstimates = [
    { personId: "p", unit: "days", value: 2 },
  ];
  state.features[0].estimateEffort = [{ personId: "p", hours: 16 }];
  return state;
}
function grouped(source: Feature, id: string, group = source.id): Feature {
  return {
    ...structuredClone(source),
    id,
    occurrenceGroupId: group,
  } as Feature;
}

describe("occurrence metadata compatibility", () => {
  it("keeps legacy workspaces unchanged and round-trips optional group metadata", () => {
    const state = fixture();
    expect(stateSchema.parse(JSON.parse(JSON.stringify(state)))).toEqual(state);
    state.features = [
      grouped(state.features[0], "long"),
      grouped(state.features[0], "repeat"),
    ];
    expect(stateSchema.parse(JSON.parse(JSON.stringify(state)))).toEqual(state);
    expect(STORAGE_SCHEMA_VERSION).toBe(7);
  });
  it.each(["", " ", "x".repeat(101), 42, null])(
    "rejects invalid group id %j",
    (value) => {
      const state = fixture();
      Object.assign(state.features[0], { occurrenceGroupId: value });
      expect(stateSchema.safeParse(state).success).toBe(false);
    },
  );
  it("rejects mismatched titles including collisions with an ungrouped legacy id", () => {
    const state = fixture();
    state.features.push({
      ...grouped(state.features[0], "repeat"),
      title: "Different task",
    });
    expect(stateSchema.safeParse(state).success).toBe(false);
  });
  it("rejects a shared group across apps", () => {
    const state = fixture();
    state.apps.push({ ...state.apps[0], id: "other" });
    state.members.push({
      ...state.members[0],
      id: "other-member",
      appId: "other",
    });
    state.features.push({
      ...grouped(state.features[0], "repeat"),
      appId: "other",
      sprintId: undefined,
    });
    expect(stateSchema.safeParse(state).success).toBe(false);
  });
  it("accepts 100 occurrences and rejects 101 including an ungrouped original", () => {
    const state = fixture(),
      source = state.features[0];
    state.features.push(
      ...Array.from({ length: 99 }, (_, i) => grouped(source, `repeat-${i}`)),
    );
    expect(stateSchema.safeParse(state).success).toBe(true);
    state.features.push(grouped(source, "overflow"));
    expect(stateSchema.safeParse(state).success).toBe(false);
  });
});

describe("occurrence changes", () => {
  it("adds beside the last sibling while preserving original scope, history, ids and priorities", () => {
    const state = fixture(),
      source = structuredClone(state.features[0]);
    const unrelated = {
      ...structuredClone(source),
      id: "other",
      title: "Other",
      priority: 1,
    };
    state.features.push(unrelated);
    const next = applyFeatureChange(state, grouped(source, "repeat"));
    expect(next.features.map((f) => f.id)).toEqual(["long", "repeat", "other"]);
    expect(next.features[0]).toEqual({ ...source, occurrenceGroupId: "long" });
    expect(next.features[2]).toEqual(unrelated);
    expect(state.features[0]).toEqual(source);
    const third = applyFeatureChange(next, grouped(source, "third"));
    expect(third.features.map((f) => f.id)).toEqual([
      "long",
      "repeat",
      "third",
      "other",
    ]);
    expect(third.features.map((f) => f.priority)).toEqual([0, 0, 0, 1]);
    expect(stateSchema.safeParse(third).success).toBe(true);
  });
  it("shares only the title on edit and retains grouping when the original is deleted", () => {
    let state = fixture();
    const original = {
      ...state.features[0],
      occurrenceGroupId: "long",
    } as Feature;
    const repeat = grouped(original, "repeat");
    repeat.priority = 4;
    state.features = [original, repeat];
    state = applyFeatureChange(state, {
      ...repeat,
      title: "Renamed",
      description: "Later scope",
      estimateEffort: [{ personId: "p", hours: 8 }],
      commitment: undefined,
    });
    expect(state.features[0]).toEqual({ ...original, title: "Renamed" });
    expect(state.features[1].description).toBe("Later scope");
    state = applyFeatureChange(state, null, "long");
    expect(state.features).toEqual([
      {
        ...repeat,
        title: "Renamed",
        description: "Later scope",
        estimateEffort: [{ personId: "p", hours: 8 }],
        commitment: undefined,
      },
    ]);
    const third = grouped(state.features[0], "third", "long");
    state = applyFeatureChange(state, third);
    expect(state.features.map((f) => f.id)).toEqual(["repeat", "third"]);
    expect(stateSchema.safeParse(state).success).toBe(true);
  });
});

// These helpers operate on the existing scheduling records; groups add no parent booking.
import {
  createOccurrence,
  featureOccurrences,
  groupOccurrences,
  occurrenceGroupId,
  occurrenceLabel,
} from "../src/lib/occurrences";
import { schedule } from "../src/lib/planning";
import { reservationId } from "../src/lib/model";
import { createStore } from "../server/store";

const temporaryFolders: string[] = [];
afterEach(() => {
  for (const folder of temporaryFolders.splice(0))
    rmSync(folder, { recursive: true, force: true });
});

describe("occurrence helpers", () => {
  it("groups records in their saved order and labels using that order rather than priority or dates", () => {
    const state = fixture(),
      source = state.features[0];
    const later = { ...grouped(source, "second"), priority: 0, sprintId: "s3" };
    const other = { ...structuredClone(source), id: "other", title: "Other" };
    state.sprints.push({
      ...state.sprints[0],
      id: "s3",
      number: 3,
      start: "2030-02-04",
      end: "2030-02-15",
    });
    state.features = [{ ...source, priority: 9 }, other, later];
    expect(occurrenceGroupId(source)).toBe("long");
    expect(occurrenceGroupId(later)).toBe("long");
    expect(featureOccurrences(state.features, later)).toEqual([
      state.features[0],
      later,
    ]);
    expect(
      featureOccurrences(
        [...state.features, { ...later, id: "outside", appId: "outside" }],
        later,
      ),
    ).toHaveLength(2);
    expect(groupOccurrences(state.features)).toEqual([
      [state.features[0], later],
      [other],
    ]);
    expect(occurrenceLabel(state, later)).toBe("Occurrence 2 · Sprint 3");
    expect(occurrenceLabel(state, { ...later, sprintId: undefined })).toBe(
      "Occurrence 2",
    );
    expect(state.features[0].priority).toBe(9);
  });
  it("creates an independent editable estimate draft without changing saved scope or accepted dates", () => {
    const state = fixture(),
      source = state.features[0];
    Object.assign(source, {
      status: "done",
      blocked: true,
      unblockDate: "2030-02-01",
      actualStart: "2030-01-01",
      actualEnd: "2030-01-02",
      target: "2030-03-01",
      notBefore: "2030-02-01",
      doesntAffectOtherWork: true,
      ignoreLeave: true,
    });
    const before = structuredClone(state);
    const draft = createOccurrence(state, source, "2030-01-20", "repeat");
    expect(draft).toMatchObject({
      id: "repeat",
      occurrenceGroupId: "long",
      title: source.title,
      status: "todo",
      blocked: false,
      committed: false,
      planningFrom: "2030-01-20",
      doesntAffectOtherWork: true,
      ignoreLeave: true,
    });
    for (const field of [
      "sprintId",
      "target",
      "notBefore",
      "commitment",
      "unblockDate",
      "actualStart",
      "actualEnd",
    ] as const)
      expect(draft[field]).toBeUndefined();
    expect(draft.estimateEffort).toEqual(source.estimateEffort);
    expect(draft.assigneeEstimates).toEqual(source.assigneeEstimates);
    draft.estimateEffort![0].hours = 8;
    draft.assigneeEstimates![0].value = 1;
    draft.assigneeIds!.push("q");
    expect(state).toEqual(before);
    expect(createOccurrence(state, source, fixedToday).id).not.toBe(source.id);
  });
  it("clones breakdown ids, remaps internal dependencies and clears external prerequisites and progress", () => {
    const state = fixture(),
      source = state.features[0];
    source.tasks = [
      {
        id: "first-task",
        title: "Prepare",
        personId: "p",
        scope: "Backend",
        hours: 8,
        status: "done",
        dependsOn: [],
        actualStart: "2030-01-01",
        actualEnd: "2030-01-02",
      },
      {
        id: "next-task",
        title: "Review",
        personId: "p",
        scope: "Backend",
        hours: 4,
        status: "blocked",
        dependsOn: ["first-task", "external-task"],
        dependsOnFeatures: ["external-feature"],
        unblockDate: "2030-01-20",
      },
    ];
    const before = structuredClone(source);
    const first = createOccurrence(state, source, fixedToday, "repeat");
    const second = createOccurrence(state, source, fixedToday, "repeat-again");
    const taskIds = [...source.tasks, ...first.tasks, ...second.tasks].map(
      (t) => t.id,
    );
    expect(new Set(taskIds).size).toBe(6);
    expect(first.tasks[1].dependsOn).toEqual([first.tasks[0].id]);
    expect(first.tasks[1].dependsOnFeatures ?? []).toEqual([]);
    first.tasks.forEach((task) => {
      expect(task.status).toBe("todo");
      expect(task.actualStart).toBeUndefined();
      expect(task.actualEnd).toBeUndefined();
      expect(task.unblockDate).toBeUndefined();
    });
    first.tasks[0].title = "Edited draft";
    expect(source).toEqual(before);
  });
});

function threeOccurrences(): PlannerState {
  let state = fixture();
  const original = state.features[0];
  state.sprints.push(
    {
      ...state.sprints[0],
      id: "s2",
      number: 2,
      start: "2030-01-21",
      end: "2030-02-01",
    },
    {
      ...state.sprints[0],
      id: "s3",
      number: 3,
      start: "2030-02-04",
      end: "2030-02-15",
    },
  );
  state = applyFeatureChange(state, {
    ...createOccurrence(state, original, fixedToday, "second"),
    sprintId: "s2",
    assigneeEstimates: [{ personId: "p", unit: "days", value: 1 }],
    estimateEffort: [{ personId: "p", hours: 8 }],
  });
  state = applyFeatureChange(state, {
    ...createOccurrence(state, state.features[1], fixedToday, "third"),
    sprintId: "s3",
    assigneeEstimates: [{ personId: "p", unit: "days", value: 3 }],
    estimateEffort: [{ personId: "p", hours: 24 }],
  });
  return stateSchema.parse(state);
}

it("books two, one and three days independently in different sprints with capacity counted once", () => {
  const state = threeOccurrences();
  const forecast = schedule(state, fixedToday);
  expect(state.features).toHaveLength(3);
  expect(Object.keys(forecast.tasks)).toHaveLength(3);
  expect(state.features.map((f) => forecast.features[f.id].hours)).toEqual([
    16, 8, 24,
  ]);
  expect(
    state.features.map((f) => [
      forecast.features[f.id].start,
      forecast.features[f.id].end,
    ]),
  ).toEqual([
    ["2030-01-07", "2030-01-08"],
    ["2030-01-21", "2030-01-21"],
    ["2030-02-04", "2030-02-06"],
  ]);
  const bookings = Object.values(forecast.tasks).flatMap((t) => t.days);
  expect(bookings.reduce((sum, day) => sum + day.hours, 0)).toBe(48);
  for (const date of new Set(bookings.map((day) => day.date)))
    expect(
      bookings
        .filter((day) => day.date === date)
        .reduce((sum, day) => sum + day.hours, 0),
    ).toBeLessThanOrEqual(8);
});

it("cleans deleted occurrence dependencies while retaining sibling links and saved values", () => {
  let state = threeOccurrences();
  const first = structuredClone(state.features[0]);
  const later = state.features[2];
  state = applyFeatureChange(state, {
    ...later,
    estimateEffort: [{ personId: "p", hours: 32 }],
    commitment: { end: "2030-02-15", acceptedAt: "2030-02-01" },
  });
  expect(state.features[0]).toEqual(first);
  const task = {
    id: "dependent-task",
    title: "Dependent",
    personId: "p",
    scope: "Backend",
    hours: 8,
    status: "todo" as const,
    dependsOn: [reservationId("long", "p"), reservationId("second", "p")],
    dependsOnFeatures: ["long", "second"],
  };
  state.features.push({
    ...structuredClone(first),
    id: "dependent",
    occurrenceGroupId: undefined,
    title: "Dependent",
    tasks: [task],
  });
  state = applyFeatureChange(state, null, "long");
  expect(state.features[2].tasks[0].dependsOn).toEqual([
    reservationId("second", "p"),
  ]);
  expect(state.features[2].tasks[0].dependsOnFeatures).toEqual(["second"]);
  expect(stateSchema.safeParse(state).success).toBe(true);
});

it("persists occurrence metadata, independent scope and original deletion through isolated SQLite reopen", () => {
  const folder = mkdtempSync(join(tmpdir(), "delivery-occurrences-"));
  temporaryFolders.push(folder);
  const path = join(folder, "planner.sqlite"),
    state = threeOccurrences();
  let store = createStore(path);
  try {
    expect(store.save(state, 0)).toEqual({ state, revision: 1 });
  } finally {
    store.close();
  }
  store = createStore(path);
  let updated: PlannerState;
  try {
    expect(store.read()).toEqual({ state, revision: 1 });
    updated = applyFeatureChange(store.read().state, null, "long");
    expect(store.save(updated, 1).revision).toBe(2);
  } finally {
    store.close();
  }
  store = createStore(path);
  try {
    expect(store.read()).toEqual({
      state: stateSchema.parse(updated!),
      revision: 2,
    });
    expect(groupOccurrences(store.read().state.features)).toHaveLength(1);
    expect(
      store.read().state.features.map((f) => f.estimateEffort![0].hours),
    ).toEqual([8, 24]);
  } finally {
    store.close();
  }
});
