import { maintenanceFixture, fixedToday } from "./maintenance-fixture";
export { fixedToday };
export function delayFixture() {
  const state = maintenanceFixture();
  state.apps[0].planningStart = fixedToday;
  state.apps[0].weekends = [5, 6];
  state.sprints[0].start = fixedToday;
  const original = {
    ...state.features[0],
    id: "delivery",
    title: "Five-day delivery",
    priority: 1,
    sprintEstimate: undefined,
    assigneeIds: ["p", "q"],
    assigneeEstimates: [
      { personId: "p", unit: "days" as const, value: 5 },
      { personId: "q", unit: "days" as const, value: 1 },
    ],
    estimateEffort: [
      { personId: "p", hours: 40 },
      { personId: "q", hours: 8 },
    ],
    commitment: { end: "2030-01-10", acceptedAt: fixedToday },
  };
  state.features = [
    {
      ...original,
      id: "blocker",
      title: "Urgent fix",
      priority: 0,
      committed: false,
      commitment: undefined,
      assigneeIds: ["p"],
      assigneeEstimates: [{ personId: "p", unit: "days", value: 1 }],
      estimateEffort: [{ personId: "p", hours: 8 }],
    },
    original,
  ];
  return state;
}
