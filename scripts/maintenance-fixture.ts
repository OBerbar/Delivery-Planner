import { emptyState, type PlannerState } from "../src/lib/model";

export const fixedToday = "2030-01-06";
export function maintenanceFixture(): PlannerState {
  return {
    ...emptyState,
    apps: [
      {
        id: "a",
        name: "Maintenance Studio",
        color: "#7565db",
        weekends: [0, 6],
        planningStart: "2030-01-07",
        cadence: "2w",
        customDays: 14,
        terms: "Confirm changes before accepting a new delivery date.",
        archived: false,
      },
    ],
    people: [
      { id: "p", name: "Alex", dailyHours: 8 },
      { id: "q", name: "Sam", dailyHours: 8 },
    ],
    members: [
      {
        id: "m",
        appId: "a",
        personId: "p",
        role: "Backend",
        allocation: 100,
        weekends: null,
      },
      {
        id: "n",
        appId: "a",
        personId: "q",
        role: "Design",
        allocation: 100,
        weekends: null,
      },
    ],
    sprints: [
      {
        id: "s",
        appId: "a",
        number: 1,
        start: "2030-01-07",
        end: "2030-01-18",
        goal: "Protect long delivery commitments",
        notes: "",
        snapshot: "# Accepted original plan\nKeep the approved wording.",
        draft: "# Saved draft\nRetain these edits.",
      },
    ],
    features: [
      {
        planningFrom: fixedToday,
        id: "long",
        appId: "a",
        title: "Five sprint delivery",
        description: "Long delivery with saved scope.",
        completion: "All work accepted.",
        priority: 0,
        tasks: [],
        sprintEstimate: 5,
        assigneeIds: ["p"],
        estimateEffort: [{ personId: "p", hours: 400 }],
        status: "todo",
        committed: true,
        commitment: { end: "2030-03-15", acceptedAt: fixedToday },
        sprintId: "s",
        link: "",
      },
      {
        planningFrom: fixedToday,
        id: "mixed",
        appId: "a",
        title: "Mixed person estimates",
        description: "Mixed units remain independent.",
        completion: "",
        priority: 1,
        tasks: [],
        assigneeIds: ["p", "q"],
        assigneeEstimates: [
          { personId: "p", unit: "sprints", value: 1 },
          { personId: "q", unit: "days", value: 3 },
        ],
        estimateEffort: [
          { personId: "p", hours: 80 },
          { personId: "q", hours: 24 },
        ],
        status: "todo",
        committed: false,
        link: "",
      },
    ],
    calendarTemplates: [
      {
        id: "template",
        name: "Winter calendar",
        entries: [
          {
            id: "entry",
            name: "Appointment",
            kind: "leave",
            start: "2030-01-09",
            end: "2030-01-09",
            hours: 2,
          },
        ],
      },
    ],
  };
}

export function populatedFixture(): PlannerState {
  const state = maintenanceFixture();
  state.features[0].commitment = {
    end: "2030-03-08",
    acceptedAt: "2030-01-05",
  };
  state.leaves = [
    {
      id: "leave",
      personId: "q",
      start: "2030-01-09",
      end: "2030-01-10",
      hours: 2,
      note: "Appointment",
      templateId: "template",
      templateEntryId: "entry",
    },
  ];
  state.holidays = [
    {
      id: "holiday",
      appId: "a",
      date: "2030-01-14",
      name: "Winter break",
      personIds: ["q"],
    },
  ];
  return state;
}

export function largeFixture(): PlannerState {
  const state = populatedFixture();
  state.people = Array.from({ length: 15 }, (_, i) => ({
    id: `person-${i}`,
    name: `Planner ${String(i + 1).padStart(2, "0")}`,
    dailyHours: 8,
  }));
  state.members = state.people.map((person, i) => ({
    id: `member-${i}`,
    appId: "a",
    personId: person.id,
    role: i % 2 ? "Design" : "Backend",
    allocation: 100,
    weekends: null,
  }));
  state.features = Array.from({ length: 100 }, (_, i) => ({
    planningFrom: fixedToday,
    id: `feature-${i}`,
    appId: "a",
    title: `Delivery ${String(i + 1).padStart(3, "0")}`,
    description: "",
    completion: "",
    priority: i,
    tasks: [],
    sprintEstimate: 0.5,
    assigneeIds: [state.people[i % 15].id],
    estimateEffort: [{ personId: state.people[i % 15].id, hours: 40 }],
    status: "todo",
    committed: false,
    link: "",
  }));
  state.leaves = [];
  state.holidays = [];
  return state;
}
