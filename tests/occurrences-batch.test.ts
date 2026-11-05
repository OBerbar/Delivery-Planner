import { expect, it } from "vitest";
import { repeatedOccurrencesFixture } from "./occurrences-fixture";
import { applyFeatureChanges } from "../src/lib/changes";
import { stateSchema, reservationId, type Feature } from "../src/lib/model";

it.each([false, true])(
  "cleans removed subtask links after all occurrence drafts are applied (reverse=%s)",
  (reverse) => {
    const state = repeatedOccurrencesFixture();
    state.features[0].tasks = [
      {
        id: "a-task",
        title: "Verify",
        personId: "p",
        scope: "Backend",
        hours: 16,
        status: "todo",
        dependsOn: [],
      },
    ];
    state.features[1].tasks = [
      {
        id: "b-task",
        title: "Verify again",
        personId: "p",
        scope: "Backend",
        hours: 8,
        status: "todo",
        dependsOn: ["a-task"],
      },
    ];
    expect(stateSchema.safeParse(state).success).toBe(true);
    const changed: Feature[] = [
      { ...structuredClone(state.features[0]), tasks: [] },
      structuredClone(state.features[1]),
    ];
    if (reverse) changed.reverse();
    const next = applyFeatureChanges(state, changed);
    expect(next.features[1].tasks[0].dependsOn).toEqual([]);
    expect(stateSchema.safeParse(next).success).toBe(true);
  },
);
it("cleans stale generated estimate links when another occurrence draft is saved", () => {
  const state = repeatedOccurrencesFixture();
  const original = state.features[0];
  original.assigneeIds = ["p", "q"];
  original.assigneeEstimates!.push({ personId: "q", unit: "days", value: 2 });
  original.estimateEffort!.push({ personId: "q", hours: 16 });
  state.features[1].tasks = [
    {
      id: "b-task",
      title: "Dependent",
      personId: "p",
      scope: "Backend",
      hours: 8,
      status: "todo",
      dependsOn: [reservationId(original.id, "q")],
    },
  ];
  expect(stateSchema.safeParse(state).success).toBe(true);
  const changed = [
    {
      ...structuredClone(original),
      assigneeIds: ["p"],
      assigneeEstimates: original.assigneeEstimates!.slice(0, 1),
      estimateEffort: original.estimateEffort!.slice(0, 1),
    },
    structuredClone(state.features[1]),
  ];
  const next = applyFeatureChanges(state, changed);
  expect(next.features[1].tasks[0].dependsOn).toEqual([]);
  expect(stateSchema.safeParse(next).success).toBe(true);
});
