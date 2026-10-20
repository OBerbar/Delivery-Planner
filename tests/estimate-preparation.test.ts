import { expect, it } from "vitest";
import {
  emptyState,
  stateSchema,
  reservationId,
  type Feature,
} from "../src/lib/model";
import { prepareSprintEstimate } from "../src/lib/estimation";
import {
  describeDeliveryChanges,
  applyFeatureChange,
} from "../src/lib/changes";
import { schedule, resources, generatePlan } from "../src/lib/planning";
import { featureEstimateLabel } from "../src/lib/feature-work";

const fixture = () =>
  stateSchema.parse({
    ...emptyState,
    apps: [
      {
        id: "a",
        name: "App",
        color: "#7565db",
        weekends: [5, 6],
        planningStart: "2026-10-04",
        cadence: "2w",
        customDays: 14,
        terms: "",
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
        role: "Web",
        allocation: 100,
        weekends: null,
      },
      {
        id: "n",
        appId: "a",
        personId: "q",
        role: "Design",
        allocation: 50,
        weekends: [0, 6],
      },
    ],
  });
const draft = (): Feature => ({
  id: "checkout",
  appId: "a",
  title: "Checkout - Phase 1",
  priority: 0,
  description: "",
  completion: "",
  link: "",
  committed: false,
  tasks: [],
  sprintEstimate: 5,
  assigneeIds: ["p", "q"],
});

it("derives saved effort from ten working days per sprint and each member's allocation", () => {
  const feature = prepareSprintEstimate(fixture(), draft(), "2026-10-04");
  expect(feature.estimateEffort).toEqual([
    { personId: "p", hours: 400 },
    { personId: "q", hours: 200 },
  ]);
  expect(
    stateSchema.safeParse({ ...fixture(), features: [feature] }).success,
  ).toBe(true);
});
it("caps a half sprint at five working days despite an extended sprint period", () => {
  const state = fixture();
  state.sprints.push({
    id: "s",
    appId: "a",
    number: 1,
    start: "2026-10-04",
    end: "2026-10-24",
    goal: "",
    notes: "",
    snapshot: null,
  });
  const feature = prepareSprintEstimate(
    state,
    { ...draft(), sprintEstimate: 0.5, sprintId: "s" },
    "2026-10-04",
  );
  expect(feature.estimateEffort).toEqual([
    { personId: "p", hours: 40 },
    { personId: "q", hours: 20 },
  ]);
});
it("keeps one estimated sprint at ten working days even with monthly cadence", () => {
  const state = fixture();
  state.apps[0].cadence = "month";
  const feature = prepareSprintEstimate(
    state,
    { ...draft(), sprintEstimate: 2, assigneeIds: ["p"] },
    "2026-10-04",
  );
  expect(feature.estimateEffort).toEqual([{ personId: "p", hours: 160 }]);
});

it("supports different sprint/day amounts for each assignee and validates their saved model", () => {
  const state = fixture();
  const feature = prepareSprintEstimate(
    state,
    {
      ...draft(),
      sprintEstimate: undefined,
      assigneeEstimates: [
        { personId: "p", unit: "sprints", value: 1 },
        { personId: "q", unit: "days", value: 3 },
      ],
    },
    "2026-10-04",
  );
  expect(feature.estimateEffort).toEqual([
    { personId: "p", hours: 80 },
    { personId: "q", hours: 12 },
  ]);
  const parsed = stateSchema.parse({ ...state, features: [feature] });
  expect(parsed.features[0].assigneeEstimates).toEqual(
    feature.assigneeEstimates,
  );
  parsed.sprints = [
    {
      id: "s",
      appId: "a",
      number: 1,
      start: "2026-10-04",
      end: "2026-10-16",
      goal: "Mixed delivery",
      notes: "",
      snapshot: null,
    },
  ];
  parsed.features[0].sprintId = "s";
  const forecast = schedule(parsed, "2026-10-04");
  expect(forecast.tasks[reservationId("checkout", "p")].end).toBe("2026-10-15");
  expect(forecast.tasks[reservationId("checkout", "q")].end).toBe("2026-10-07");
  expect(
    resources(parsed, parsed.sprints[0], forecast).map((r) => [
      r.person.id,
      r.demand,
    ]),
  ).toEqual([
    ["p", 80],
    ["q", 12],
  ]);
  const text = generatePlan(parsed, parsed.sprints[0], forecast);
  expect(text).toContain("Alex: 1 sprint; Sam: 3 working days");
  expect(text).not.toContain("undefined sprint");
  expect(featureEstimateLabel(parsed.features[0])).toBe("Estimates by person");
  expect(featureEstimateLabel(parsed.features[0], "q")).toBe("3 working days");
});

it("supports fractional days while leave and holidays only move the forecast", () => {
  const state = fixture();
  const feature = prepareSprintEstimate(
    state,
    {
      ...draft(),
      sprintEstimate: undefined,
      assigneeIds: ["p"],
      assigneeEstimates: [{ personId: "p", unit: "days", value: 0.5 }],
    },
    "2026-10-04",
  );
  expect(feature.estimateEffort).toEqual([{ personId: "p", hours: 4 }]);
  state.features = [feature];
  expect(schedule(state, "2026-10-04").features.checkout.end).toBe(
    "2026-10-04",
  );
  state.leaves.push({
    id: "l",
    personId: "p",
    start: "2026-10-04",
    end: "2026-10-04",
    hours: null,
    note: "Away",
  });
  state.holidays.push({
    id: "h",
    appId: "a",
    date: "2026-10-05",
    name: "Holiday",
  });
  expect(schedule(state, "2026-10-04").features.checkout).toMatchObject({
    end: "2026-10-06",
    hours: 4,
  });
});

it("preserves each unchanged person's saved effort when another estimate changes", () => {
  const state = fixture();
  const feature = prepareSprintEstimate(
    state,
    {
      ...draft(),
      sprintEstimate: undefined,
      assigneeEstimates: [
        { personId: "p", unit: "sprints", value: 1 },
        { personId: "q", unit: "days", value: 3 },
      ],
    },
    "2026-10-04",
  );
  state.people[0].dailyHours = 4;
  const next = prepareSprintEstimate(
    state,
    {
      ...feature,
      assigneeEstimates: [
        { personId: "p", unit: "sprints", value: 1 },
        { personId: "q", unit: "days", value: 4 },
      ],
    },
    "2026-10-04",
    feature,
  );
  expect(next.estimateEffort).toEqual([
    { personId: "p", hours: 80 },
    { personId: "q", hours: 16 },
  ]);
});

it("preserves saved scope when switching between equivalent sprint and day units", () => {
  const state = fixture();
  const feature = prepareSprintEstimate(
    state,
    { ...draft(), sprintEstimate: 1, assigneeIds: ["p"] },
    "2026-10-04",
  );
  state.people[0].dailyHours = 4;
  state.members[0].allocation = 50;
  const days = prepareSprintEstimate(
    state,
    {
      ...feature,
      sprintEstimate: undefined,
      assigneeEstimates: [{ personId: "p", unit: "days", value: 10 }],
    },
    "2026-10-04",
    feature,
  );
  expect(days.estimateEffort).toEqual([{ personId: "p", hours: 80 }]);
  expect(
    prepareSprintEstimate(state, { ...feature }, "2026-10-04", days)
      .estimateEffort,
  ).toEqual(days.estimateEffort);
  expect(
    prepareSprintEstimate(
      state,
      {
        ...days,
        assigneeEstimates: [{ personId: "p", unit: "days", value: 9 }],
      },
      "2026-10-04",
      days,
    ).estimateEffort,
  ).toEqual([{ personId: "p", hours: 18 }]);
});

it("preserves fractional working-day scope through rounded unit conversion", () => {
  const state = fixture();
  const days = prepareSprintEstimate(
    state,
    {
      ...draft(),
      sprintEstimate: undefined,
      assigneeIds: ["p"],
      assigneeEstimates: [{ personId: "p", unit: "days", value: 6.66666667 }],
    },
    "2026-10-04",
  );
  state.people[0].dailyHours = 4;
  const sprints = prepareSprintEstimate(
    state,
    {
      ...days,
      assigneeEstimates: [
        { personId: "p", unit: "sprints", value: 0.66666667 },
      ],
    },
    "2026-10-04",
    days,
  );
  expect(sprints.estimateEffort).toEqual(days.estimateEffort);
  expect(
    prepareSprintEstimate(state, { ...days }, "2026-10-04", sprints)
      .estimateEffort,
  ).toEqual(days.estimateEffort);
});

it("rejects missing, duplicate, foreign and invalid individual estimates", () => {
  const state = fixture();
  for (const assigneeEstimates of [
    [{ personId: "p", unit: "days", value: 2 }],
    [
      { personId: "p", unit: "days", value: 2 },
      { personId: "p", unit: "days", value: 3 },
    ],
    [
      { personId: "p", unit: "days", value: 2 },
      { personId: "outside", unit: "days", value: 3 },
    ],
    [
      { personId: "p", unit: "days", value: 0 },
      { personId: "q", unit: "sprints", value: 1 },
    ],
  ] as const) {
    expect(() =>
      prepareSprintEstimate(
        state,
        { ...draft(), assigneeEstimates: [...assigneeEstimates] },
        "2026-10-04",
      ),
    ).toThrow();
  }
});

it("exports active task effort without advertising retained estimate drafts", () => {
  const state = fixture();
  state.sprints = [
    {
      id: "s",
      appId: "a",
      number: 1,
      start: "2026-10-04",
      end: "2026-10-16",
      goal: "",
      notes: "",
      snapshot: null,
    },
  ];
  const feature = prepareSprintEstimate(
    state,
    {
      ...draft(),
      sprintId: "s",
      assigneeEstimates: [
        { personId: "p", unit: "days", value: 10 },
        { personId: "q", unit: "sprints", value: 1 },
      ],
      tasks: [
        {
          id: "t",
          title: "Implement",
          personId: "p",
          scope: "Web",
          hours: 8,
          status: "todo",
          dependsOn: [],
        },
      ],
    },
    "2026-10-04",
  );
  state.features = [feature];
  const forecast = schedule(state, "2026-10-04");
  expect(forecast.features.checkout.hours).toBe(8);
  expect(feature.assigneeEstimates).toHaveLength(2);
  const plan = generatePlan(state, state.sprints[0], forecast);
  expect(plan).not.toContain("Alex: 10 working days");
  expect(plan).not.toContain("Estimate: 5 sprints");
  expect(plan).toContain("Implement");
  state.features[0] = { ...feature, assigneeEstimates: undefined };
  expect(generatePlan(state, state.sprints[0], forecast)).not.toContain(
    "Estimate: 5 sprints",
  );
});
it("preserves effort across leave, hours and calendar edits when feature scope is unchanged", () => {
  const state = fixture();
  const feature = prepareSprintEstimate(state, draft(), "2026-10-04");
  state.people[0].dailyHours = 4;
  state.leaves.push({
    id: "l",
    personId: "p",
    start: "2026-10-04",
    end: "2026-10-10",
    hours: null,
    note: "",
  });
  state.holidays.push({
    id: "h",
    appId: "a",
    date: "2026-10-11",
    name: "Holiday",
  });
  expect(
    prepareSprintEstimate(
      state,
      { ...feature, title: "Renamed" },
      "2026-10-04",
      feature,
    ).estimateEffort,
  ).toEqual(feature.estimateEffort);
  expect(
    prepareSprintEstimate(
      state,
      { ...feature, sprintEstimate: 1 },
      "2026-10-04",
      feature,
    ).estimateEffort![0].hours,
  ).toBe(40);
});
it("explains a delay using the new feature, shared people and old/new dates", () => {
  const before = fixture();
  before.features = [prepareSprintEstimate(before, draft(), "2026-10-04")];
  const urgent = prepareSprintEstimate(
    before,
    {
      ...draft(),
      id: "urgent",
      title: "Billing setup",
      sprintEstimate: 0.5,
      assigneeIds: ["p"],
    },
    "2026-10-04",
  );
  const after = applyFeatureChange(before, urgent);
  const changes = describeDeliveryChanges(
    before,
    after,
    schedule(before, "2026-10-04"),
    schedule(after, "2026-10-04"),
  );
  expect(changes).toHaveLength(1);
  expect(changes[0]).toMatchObject({
    title: "Checkout - Phase 1",
    before: "2026-12-11",
    after: "2026-12-17",
    days: 6,
  });
  expect(changes[0].reason).toContain("Billing setup");
  expect(changes[0].reason).toContain("Alex");
  expect(changes[0].reason).not.toContain("Sam");
});
