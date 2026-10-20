import { expect, it } from "vitest";
import { maintenanceFixture, fixedToday } from "../scripts/maintenance-fixture";
import { generatePlan, schedule } from "../src/lib/planning";

function fixture() {
  const state = maintenanceFixture();
  state.features = [state.features[0]];
  state.features[0].title = "Checkout — Phase 1";
  state.features[0].estimateEffort = [{ personId: "p", hours: 200 }];
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
  return state;
}
const section = (text: string, heading: string, next: string) => {
  expect(text).toContain(`**${heading}**\n`);
  return text.split(`**${heading}**\n`)[1].split(`**${next}**`)[0].trim();
};

it("uses feature names with start and proceed only before the finishing sprint, including carryover", () => {
  const state = fixture();
  const before = structuredClone(state);
  const forecast = schedule(state, fixedToday);
  const goals = state.sprints.map((s) =>
    section(
      generatePlan(state, s, forecast),
      "Sprint Goal",
      "Delivery Commitment Boundary",
    ),
  );
  expect(goals).toEqual([
    "___\n- Start Checkout — Phase 1",
    "___\n- Proceed with Checkout — Phase 1",
    "___\n- Checkout — Phase 1",
  ]);
  expect(state).toEqual(before);
});

it("lists a feature finishing in its first sprint normally and excludes future and other-app work", () => {
  const state = fixture();
  state.features[0].estimateEffort![0].hours = 8;
  state.features.push({
    ...state.features[0],
    id: "future",
    title: "Future work",
    sprintId: "s3",
  });
  state.apps.push({ ...state.apps[0], id: "b", name: "Other app" });
  state.members.push({ ...state.members[1], id: "other", appId: "b" });
  state.features.push({
    ...state.features[0],
    id: "other",
    appId: "b",
    sprintId: undefined,
    title: "Other app work",
    assigneeIds: ["q"],
    estimateEffort: [{ personId: "q", hours: 8 }],
  });
  const text = generatePlan(
    state,
    state.sprints[0],
    schedule(state, fixedToday),
  );
  expect(section(text, "Sprint Goal", "Delivery Commitment Boundary")).toBe(
    "___\n- Checkout — Phase 1",
  );
  expect(text).not.toContain("Other app work");
  expect(text).not.toContain("Future work");
});

it("leaves standard scope headings blank for estimates without inventing work from team roles", () => {
  const state = fixture();
  const text = generatePlan(
    state,
    state.sprints[0],
    schedule(state, fixedToday),
  );
  expect(section(text, "Web Frontend & Full stack", "Backend")).toBe("");
  expect(section(text, "Backend", "Mobile")).toBe("");
  expect(section(text, "Mobile", "Completion Conditions")).toBe("");
  expect(text).not.toContain("**Design**");
});

it("groups only explicit subtasks into their scopes and includes each only in its scheduled sprints", () => {
  const state = fixture();
  state.features[0].tasks = [
    {
      id: "api",
      title: "API implementation",
      personId: "p",
      scope: "BE",
      hours: 200,
      status: "todo",
      dependsOn: [],
    },
    {
      id: "mobile",
      title: "Mobile screen",
      personId: "q",
      scope: "Mobile",
      hours: 8,
      status: "todo",
      dependsOn: [],
    },
  ];
  const forecast = schedule(state, fixedToday);
  const first = generatePlan(state, state.sprints[0], forecast);
  const second = generatePlan(state, state.sprints[1], forecast);
  expect(section(first, "Backend", "Mobile")).toContain(
    "- Checkout — Phase 1 — API implementation",
  );
  expect(section(first, "Mobile", "Completion Conditions")).toContain(
    "- Checkout — Phase 1 — Mobile screen",
  );
  expect(section(second, "Backend", "Mobile")).toContain("API implementation");
  expect(section(second, "Mobile", "Completion Conditions")).toBe("");
});

it("does not present blocked or unknown finishes as normal delivery goals", () => {
  const state = fixture();
  delete state.features[0].planningFrom;
  state.features[0].status = "blocked";
  const text = generatePlan(
    state,
    state.sprints[0],
    schedule(state, fixedToday),
  );
  expect(section(text, "Sprint Goal", "Delivery Commitment Boundary")).toBe(
    "___\n- Checkout — Phase 1 (not scheduled)",
  );
  expect(text).toMatch(/blocked/i);
});

it("includes scheduled backlog work and keeps an empty sprint goal blank", () => {
  const state = fixture();
  state.features[0].sprintId = undefined;
  const forecast = schedule(state, fixedToday);
  expect(
    section(
      generatePlan(state, state.sprints[1], forecast),
      "Sprint Goal",
      "Delivery Commitment Boundary",
    ),
  ).toBe("___\n- Proceed with Checkout — Phase 1");
  state.features = [];
  expect(
    section(
      generatePlan(state, state.sprints[0], schedule(state, fixedToday)),
      "Sprint Goal",
      "Delivery Commitment Boundary",
    ),
  ).toBe("___");
});

it("normalizes FE and BE task scopes while retaining explicit Design and QA objectives", () => {
  const state = fixture();
  state.features[0].tasks = ["FE", "BE", "Design", "QA"].map((scope, i) => ({
    id: `task-${i}`,
    title: `${scope} task`,
    personId: "p",
    scope,
    hours: 8,
    status: "todo" as const,
    dependsOn: [],
  }));
  const text = generatePlan(
    state,
    state.sprints[0],
    schedule(state, fixedToday),
  );
  expect(section(text, "Web Frontend & Full stack", "Backend")).toContain(
    "FE task",
  );
  expect(section(text, "Backend", "Mobile")).toContain("BE task");
  expect(text).toContain("**Design**\n- Checkout — Phase 1 — Design task");
  expect(text).toContain("**QA**\n- Checkout — Phase 1 — QA task");
});

it("recalculates goal stage after leave delays a finish and never promises a partially blocked feature", () => {
  const state = fixture();
  delete state.features[0].planningFrom;
  state.features[0].estimateEffort![0].hours = 80;
  const goal = () =>
    section(
      generatePlan(state, state.sprints[0], schedule(state, fixedToday)),
      "Sprint Goal",
      "Delivery Commitment Boundary",
    );
  expect(goal()).toBe("___\n- Checkout — Phase 1");
  state.leaves.push({
    id: "l",
    personId: "p",
    start: "2030-01-18",
    end: "2030-01-18",
    hours: null,
    note: "Leave",
  });
  expect(goal()).toBe("___\n- Start Checkout — Phase 1");
  state.features[0].tasks = [
    {
      id: "active",
      title: "Active task",
      personId: "p",
      scope: "BE",
      hours: 8,
      status: "todo",
      dependsOn: [],
    },
    {
      id: "blocked",
      title: "Blocked task",
      personId: "q",
      scope: "FE",
      hours: 8,
      status: "blocked",
      dependsOn: [],
    },
  ];
  expect(goal()).toBe("___\n- Start Checkout — Phase 1");
});
