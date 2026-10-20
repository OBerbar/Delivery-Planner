import { describe, expect, it } from "vitest";
import { emptyState, stateSchema, type Feature } from "../src/lib/model";
import { generatePlan, resources, schedule } from "../src/lib/planning";
import { applyFeatureChange } from "../src/lib/changes";
import { reservationId } from "../src/lib/model";

function fixture() {
  const state = stateSchema.parse({
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
      { id: "q", name: "Sam", dailyHours: 6 },
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
        allocation: 100,
        weekends: null,
      },
    ],
  });
  // Raw feature expresses the requested new behavior, before schema support exists.
  state.features = [
    {
      id: "checkout",
      appId: "a",
      title: "Checkout - Phase 1",
      description: "",
      completion: "Reviewed",
      committed: false,
      link: "",
      priority: 0,
      tasks: [],
      sprintEstimate: 5,
      assigneeIds: ["p", "q"],
      estimateEffort: [
        { personId: "p", hours: 400 },
        { personId: "q", hours: 300 },
      ],
      status: "todo",
    } as Feature,
  ];
  return state;
}
describe("feature-level sprint planning", () => {
  it("a feature-delivery dependency includes assignees added after the dependency was set", () => {
    const state = fixture();
    const source = {
      ...state.features[0],
      assigneeIds: ["p"],
      estimateEffort: [{ personId: "p", hours: 400 }],
    };
    state.features = [
      source,
      {
        id: "dependent",
        appId: "a",
        title: "Follow-up",
        priority: 1,
        description: "",
        completion: "",
        committed: false,
        link: "",
        tasks: [
          {
            id: "next-task",
            title: "Next",
            personId: "p",
            scope: "Web",
            hours: 8,
            status: "todo",
            dependsOn: [],
            dependsOnFeatures: ["checkout"],
          },
        ],
      },
    ];
    const next = applyFeatureChange(state, {
      ...source,
      assigneeIds: ["p", "q"],
      estimateEffort: [
        { personId: "p", hours: 400 },
        { personId: "q", hours: 300 },
      ],
    });
    next.leaves.push({
      id: "away",
      personId: "q",
      start: "2026-10-04",
      end: "2026-11-01",
      hours: null,
      note: "Away",
    });
    const result = schedule(next, "2026-10-04");
    expect(
      result.features.dependent.start! > result.features.checkout.end!,
    ).toBe(true);
    expect(
      stateSchema.parse(next).features[1].tasks[0].dependsOnFeatures,
    ).toEqual(["checkout"]);
    const deleted = applyFeatureChange(next, null, "checkout");
    expect(deleted.features[0].tasks[0].dependsOnFeatures).toEqual([]);
  });
  it("cleans dependencies when a feature reservation is removed", () => {
    const state = fixture();
    const source = reservationId("checkout", "p");
    state.features.push({
      id: "dependent",
      appId: "a",
      title: "Follow-up",
      priority: 1,
      description: "",
      completion: "",
      committed: false,
      link: "",
      tasks: [
        {
          id: "next-task",
          title: "Next",
          personId: "q",
          scope: "Design",
          hours: 8,
          status: "todo",
          dependsOn: [source],
        },
      ],
    });
    expect(stateSchema.safeParse(state).success).toBe(true);
    const next = applyFeatureChange(state, null, "checkout");
    expect(next.features[0].tasks[0].dependsOn).toEqual([]);
    expect(stateSchema.safeParse(next).success).toBe(true);
  });
  it("accepts a feature without tasks when it has an estimate and main assignees", () => {
    const parsed = stateSchema.safeParse(fixture());
    expect(parsed.success).toBe(true);
    if (parsed.success)
      expect(parsed.data.features[0]).toMatchObject({
        sprintEstimate: 5,
        assigneeIds: ["p", "q"],
        tasks: [],
      });
  });
  it("does not accept an empty feature without planning effort", () => {
    const state = fixture();
    state.features[0] = {
      ...state.features[0],
      sprintEstimate: undefined,
      assigneeIds: [],
      estimateEffort: [],
    } as Feature;
    expect(stateSchema.safeParse(state).success).toBe(false);
  });
  it("reserves five sprints for each selected team member without requiring tasks", () => {
    const result = schedule(fixture(), "2026-10-04");
    expect(result.features.checkout).toMatchObject({
      start: "2026-10-04",
      end: "2026-12-10",
      hours: 700,
      done: false,
    });
  });
  it("supports half-sprint estimates", () => {
    const state = fixture();
    Object.assign(state.features[0], {
      sprintEstimate: 0.5,
      estimateEffort: [
        { personId: "p", hours: 40 },
        { personId: "q", hours: 30 },
      ],
    });
    expect(schedule(state, "2026-10-04").features.checkout.end).toBe(
      "2026-10-08",
    );
  });
  it("new work takes priority and delays only the shared assignee's unfinished work", () => {
    const state = fixture();
    const urgent = {
      ...state.features[0],
      id: "urgent",
      title: "Urgent feature",
      sprintEstimate: 0.5,
      assigneeIds: ["p"],
      estimateEffort: [{ personId: "p", hours: 40 }],
    } as Feature;
    const next = applyFeatureChange(state, urgent);
    const result = schedule(next, "2026-10-04");
    expect(result.features.urgent.end).toBe("2026-10-08");
    expect(result.features.checkout.end).toBe("2026-12-17");
    expect(
      next.features.find((f) => f.id === "checkout")!.priority,
    ).toBeGreaterThan(next.features.find((f) => f.id === "urgent")!.priority);
    const unaffected = Object.values(result.tasks).find(
      (t) => t.days.reduce((sum, d) => sum + d.hours, 0) === 300,
    );
    expect(unaffected?.end).toBe("2026-12-10");
  });
  it("leave moves the delivery date without reducing saved effort", () => {
    const state = fixture();
    state.leaves = [
      {
        id: "l",
        personId: "p",
        start: "2026-10-04",
        end: "2026-10-08",
        hours: null,
        note: "Away",
      },
    ];
    const result = schedule(state, "2026-10-04");
    expect(result.features.checkout.end).toBe("2026-12-17");
    expect(result.features.checkout.hours).toBe(700);
  });
  it("exports main assignees, estimates and scope without invented task titles", () => {
    const state = fixture();
    const sprint = {
      id: "s",
      appId: "a",
      number: 1,
      start: "2026-10-04",
      end: "2026-10-17",
      goal: "Deliver",
      notes: "",
      snapshot: null,
    };
    state.sprints.push(sprint);
    state.features[0].sprintId = "s";
    const result = schedule(state, "2026-10-04");
    expect(
      resources(state, sprint, result).map((r) => [
        r.person.name,
        r.demand,
        r.scheduled,
      ]),
    ).toEqual([
      ["Alex", 400, 80],
      ["Sam", 300, 60],
    ]);
    const plan = generatePlan(state, sprint, result);
    expect(plan).toContain("Resources Allocated:** Alex, Sam");
    expect(plan).toContain("5 sprints");
    expect(plan).not.toContain("**Design**");
    expect(plan).toContain("**Backend**\n\n**Mobile**\n\n");
  });
  it("rejects main assignees outside the app and duplicate or missing effort", () => {
    const state = fixture();
    Object.assign(state.features[0], { assigneeIds: ["missing"] });
    expect(stateSchema.safeParse(state).success).toBe(false);
    Object.assign(state.features[0], { assigneeIds: ["p", "p"] });
    expect(stateSchema.safeParse(state).success).toBe(false);
    Object.assign(state.features[0], {
      assigneeIds: ["p", "q"],
      estimateEffort: [{ personId: "p", hours: 400 }],
    });
    expect(stateSchema.safeParse(state).success).toBe(false);
  });
  it("preserves actual dates for completed features without tasks", () => {
    const state = fixture();
    Object.assign(state.features[0], {
      status: "done",
      actualStart: "2026-08-01",
      actualEnd: "2026-09-30",
    });
    expect(schedule(state, "2026-10-04").features.checkout).toMatchObject({
      start: "2026-08-01",
      end: "2026-09-30",
      done: true,
      hours: 0,
    });
  });
  it("task hours replace the estimate's reservations rather than double booking", () => {
    const state = fixture();
    state.features[0].tasks = [
      {
        id: "task",
        title: "Implement",
        personId: "p",
        scope: "Web",
        hours: 8,
        status: "todo",
        dependsOn: [],
      },
    ];
    expect(schedule(state, "2026-10-04").features.checkout).toMatchObject({
      end: "2026-10-04",
      hours: 8,
    });
  });
});
