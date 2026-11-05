import { maintenanceFixture } from "../scripts/maintenance-fixture";

export function occurrencesFixture() {
  const state = maintenanceFixture();
  const feature = state.features[0];
  feature.title = "Retest checkout";
  feature.description = "Repeat verification after each delivery.";
  feature.assigneeEstimates = [{ personId: "p", unit: "days", value: 2 }];
  feature.estimateEffort = [{ personId: "p", hours: 16 }];
  feature.sprintEstimate = undefined;
  feature.committed = false;
  feature.commitment = undefined;
  state.features = [feature];
  state.sprints.push(
    {
      ...state.sprints[0],
      id: "s2",
      number: 2,
      start: "2030-01-21",
      end: "2030-02-01",
      snapshot: null,
      draft: undefined,
    },
    {
      ...state.sprints[0],
      id: "s3",
      number: 3,
      start: "2030-02-04",
      end: "2030-02-15",
      snapshot: null,
      draft: undefined,
    },
  );
  return state;
}

export function repeatedOccurrencesFixture() {
  const state = occurrencesFixture();
  const first = { ...state.features[0], occurrenceGroupId: "retest" };
  state.features = [
    first,
    {
      ...structuredClone(first),
      id: "second",
      sprintId: "s2",
      assigneeEstimates: [{ personId: "p", unit: "days", value: 1 }],
      estimateEffort: [{ personId: "p", hours: 8 }],
      priority: 1,
    },
    {
      ...structuredClone(first),
      id: "third",
      sprintId: "s3",
      assigneeEstimates: [{ personId: "p", unit: "days", value: 3 }],
      estimateEffort: [{ personId: "p", hours: 24 }],
      priority: 2,
    },
  ];
  return state;
}
