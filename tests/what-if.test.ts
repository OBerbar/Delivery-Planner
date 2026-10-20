import { it, expect } from "vitest";
import {
  beginExperiment,
  changeExperiment,
  undoExperiment,
  compareExperiment,
} from "../src/lib/what-if";
import { maintenanceFixture, fixedToday } from "../scripts/maintenance-fixture";
it("keeps saved state independent and draft undo restores the preceding experiment", () => {
  const state = maintenanceFixture();
  const original = structuredClone(state);
  const session = beginExperiment(state, 8);
  expect(session.base).not.toBe(state);
  expect(session.draft).not.toBe(session.base);
  const next = structuredClone(session.draft);
  next.leaves.push({
    id: "away",
    personId: "p",
    start: "2030-01-14",
    end: "2030-01-18",
    hours: null,
    note: "Experiment",
  });
  const changed = changeExperiment(session, next);
  expect(changed.draft.leaves).toHaveLength(1);
  expect(changed.revision).toBe(8);
  expect(state).toEqual(original);
  expect(changed.base).toEqual(original);
  expect(undoExperiment(changed).draft).toEqual(original);
  expect(undoExperiment(changed).history).toEqual([]);
});
it("rejects invalid records and historical snapshot/accepted-date changes", () => {
  const session = beginExperiment(maintenanceFixture(), 1);
  const invalid = structuredClone(session.draft);
  invalid.people[0].dailyHours = -1;
  expect(() => changeExperiment(session, invalid)).toThrow();
  const rewritten = structuredClone(session.draft);
  rewritten.sprints[0].snapshot = "changed";
  expect(() => changeExperiment(session, rewritten)).toThrow(/finalized/i);
  const refreshed = structuredClone(session.draft);
  refreshed.features[0].commitment!.end = "2030-03-20";
  expect(() => changeExperiment(session, refreshed)).toThrow(/accepted/i);
  expect(session.history).toEqual([]);
});
it("compares delayed features and affected person hours including added and removed work", () => {
  const session = beginExperiment(maintenanceFixture(), 2);
  const next = structuredClone(session.draft);
  next.leaves.push({
    id: "away",
    personId: "p",
    start: "2030-01-14",
    end: "2030-01-18",
    hours: null,
    note: "Experiment",
  });
  next.features = next.features.filter((f) => f.id !== "mixed");
  const comparison = compareExperiment(
    changeExperiment(session, next),
    fixedToday,
  );
  expect(comparison.features).toContainEqual(
    expect.objectContaining({
      id: "long",
      kind: "changed",
      before: "2030-03-15",
      after: "2030-03-22",
      people: ["Alex"],
    }),
  );
  expect(comparison.features).toContainEqual(
    expect.objectContaining({ id: "mixed", kind: "removed" }),
  );
  expect(comparison.people).toContainEqual(
    expect.objectContaining({ id: "q", before: 24, after: 0 }),
  );
});
it("reports reduced allocation even when parallel work holds the delivery date", () => {
  const session = beginExperiment(maintenanceFixture(), 2);
  const next = structuredClone(session.draft);
  next.features.unshift({
    ...next.features[0],
    id: "parallel",
    title: "Parallel day",
    priority: 0,
    committed: false,
    commitment: undefined,
    doesntAffectOtherWork: true,
    sprintEstimate: undefined,
    assigneeEstimates: [{ personId: "p", unit: "days", value: 1 }],
    estimateEffort: [{ personId: "p", hours: 8 }],
  });
  next.features.slice(1).forEach((f) => f.priority++);
  const result = compareExperiment(changeExperiment(session, next), fixedToday);
  expect(result.features).toContainEqual(
    expect.objectContaining({ id: "parallel", kind: "added" }),
  );
  const original = result.features.find((f) => f.id === "long")!;
  expect(original.before).toBe(original.after);
  expect(original.allocatedAfter).toBe(original.allocatedBefore - 8);
});

it("compares changed working-day equivalents when saved hours and forecast dates stay unchanged", () => {
  const base = maintenanceFixture();
  base.features = [base.features[0]];
  base.features[0].estimateEffort = [{ personId: "p", hours: 4 }];
  const session = beginExperiment(base, 1);
  const next = structuredClone(base);
  next.people[0].dailyHours = 6;
  const result = compareExperiment(changeExperiment(session, next), fixedToday);
  expect(result.features).toContainEqual(
    expect.objectContaining({
      id: "long",
      allocatedDaysBefore: 0.5,
      allocatedDaysAfter: 4 / 6,
    }),
  );
  expect(result.people).toContainEqual(
    expect.objectContaining({ id: "p", beforeDays: 0.5, afterDays: 4 / 6 }),
  );
  expect(result.features[0].before).toBe(result.features[0].after);
});
