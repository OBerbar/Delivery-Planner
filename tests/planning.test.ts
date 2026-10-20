import { describe, it, expect } from "vitest";
import {
  schedule,
  capacity,
  sprintEnd,
  generatePlan,
} from "../src/lib/planning";
import { stateSchema } from "../src/lib/model";

function fixture() {
  return stateSchema.parse({
    version: 1,
    apps: [
      {
        id: "a",
        name: "App A",
        color: "#7464dd",
        weekends: [5, 6],
        planningStart: "2026-10-04",
        cadence: "2w",
        customDays: 14,
        terms: "Local terms",
      },
    ],
    people: [{ id: "p", name: "Alex", dailyHours: 8 }],
    members: [
      {
        id: "m",
        appId: "a",
        personId: "p",
        role: "Backend",
        allocation: 100,
        weekends: null,
      },
    ],
    leaves: [],
    holidays: [],
    features: [
      {
        id: "f",
        appId: "a",
        title: "Feature",
        priority: 0,
        description: "Feature description",
        completion: "Test the flow",
        tasks: [
          {
            id: "t",
            title: "API",
            personId: "p",
            scope: "Backend",
            hours: 16,
            status: "todo",
            dependsOn: [],
          },
        ],
      },
    ],
    sprints: [],
  });
}
describe("resource calendar scheduling", () => {
  it("uses app weekends", () => {
    const s = fixture();
    s.apps[0].planningStart = "2026-10-08";
    expect(schedule(s, "2026-10-08").tasks.t.end).toBe("2026-10-11");
  });
  it("honors a member weekend override", () => {
    const s = fixture();
    s.members[0].weekends = [0, 6];
    s.apps[0].planningStart = "2026-10-08";
    expect(schedule(s, "2026-10-08").tasks.t.end).toBe("2026-10-09");
  });
  it("propagates leave through dependencies", () => {
    const s = fixture();
    s.leaves = [
      {
        id: "l",
        personId: "p",
        start: "2026-10-04",
        end: "2026-10-05",
        hours: null,
        note: "Leave",
      },
    ];
    s.features[0].tasks.push({
      id: "u",
      title: "Test",
      scope: "QA",
      personId: "p",
      hours: 8,
      status: "todo",
      dependsOn: ["t"],
    });
    const r = schedule(s, "2026-10-04");
    expect(r.tasks.t.end).toBe("2026-10-07");
    expect(r.tasks.u.start).toBe("2026-10-08");
  });
  it("deducts partial leave and caps overlapping leave", () => {
    const s = fixture();
    s.features[0].tasks[0].hours = 8;
    s.leaves = [
      {
        id: "l",
        personId: "p",
        start: "2026-10-04",
        end: "2026-10-04",
        hours: 4,
        note: "",
      },
    ];
    expect(schedule(s, "2026-10-04").tasks.t.end).toBe("2026-10-05");
    s.leaves.push({ ...s.leaves[0], id: "l2", hours: 8 });
    expect(capacity(s, "a", "p", "2026-10-04")).toBe(0);
  });
  it("reduces capacity for allocation and holidays", () => {
    const s = fixture();
    s.members[0].allocation = 50;
    s.holidays = [{ id: "h", appId: "a", date: "2026-10-05", name: "Holiday" }];
    expect(schedule(s, "2026-10-04").tasks.t.end).toBe("2026-10-08");
  });
  it("prevents a shared person being double booked", () => {
    const s = fixture();
    s.apps.push({ ...s.apps[0], id: "b", name: "App B" });
    s.members.push({ ...s.members[0], id: "n", appId: "b" });
    s.features.push({
      ...s.features[0],
      id: "g",
      appId: "b",
      tasks: [{ ...s.features[0].tasks[0], id: "v", hours: 8 }],
    });
    const r = schedule(s, "2026-10-04");
    expect(r.tasks.v.start).toBe("2026-10-06");
  });
  it("preserves completed actual dates", () => {
    const s = fixture();
    Object.assign(s.features[0].tasks[0], {
      status: "done",
      actualStart: "2026-09-28",
      actualEnd: "2026-09-29",
    });
    expect(schedule(s, "2026-10-04").tasks.t.end).toBe("2026-09-29");
  });
  it("never schedules unfinished work in the past", () => {
    expect(schedule(fixture(), "2026-10-07").tasks.t.start).toBe("2026-10-07");
  });
  it("keeps blocked tasks and successors unscheduled", () => {
    const s = fixture();
    s.features[0].tasks[0].status = "blocked";
    s.features[0].tasks.push({
      id: "u",
      title: "Test",
      scope: "QA",
      personId: "p",
      hours: 8,
      status: "todo",
      dependsOn: ["t"],
    });
    expect(schedule(s, "2026-10-04").tasks.u.reason).toMatch(
      /blocked|dependency/i,
    );
  });
  it("reports dependency cycles rather than inventing dates", () => {
    const s = fixture();
    s.features[0].tasks[0].dependsOn = ["u"];
    s.features[0].tasks.push({
      ...s.features[0].tasks[0],
      id: "u",
      dependsOn: ["t"],
    });
    expect(schedule(s, "2026-10-04").tasks.t.reason).toMatch(/cycle/i);
  });
  it("starts sprint-assigned work no earlier than the sprint", () => {
    const s = fixture();
    s.sprints = [
      {
        id: "s",
        appId: "a",
        number: 1,
        start: "2026-10-18",
        end: "2026-10-31",
        goal: "Deliver",
        notes: "",
        snapshot: null,
      },
    ];
    s.features[0].sprintId = "s";
    expect(schedule(s, "2026-10-04").tasks.t.start).toBe("2026-10-18");
  });
});
describe("sprints and documents", () => {
  it("uses inclusive dates for week and calendar-month cadence", () => {
    expect(sprintEnd("2026-10-04", "2w", 14)).toBe("2026-10-17");
    expect(sprintEnd("2026-10-04", "3w", 14)).toBe("2026-10-24");
    expect(sprintEnd("2026-01-31", "month", 14)).toBe("2026-02-27");
  });
  it("generates the existing sprint-plan structure from actual assignments", () => {
    const s = fixture();
    const sprint = {
      id: "s",
      appId: "a",
      number: 42,
      start: "2026-10-04",
      end: "2026-10-17",
      goal: "Ship the flow",
      notes: "",
      snapshot: null,
    };
    s.sprints.push(sprint);
    s.features[0].sprintId = "s";
    const doc = generatePlan(s, sprint, schedule(s, "2026-10-04"));
    expect(doc).toContain("App A - Sprint Plan Number 42");
    expect(doc).toContain("**Resources Allocated:** Alex");
    for (const section of [
      "Sprint Goal",
      "Objectives by Scope",
      "Backend",
      "Completion Conditions",
      "General Terms",
    ])
      expect(doc).toContain(section);
    expect(doc).toContain("Non-committed");
  });
  it("rejects impossible dates, all-week weekends and reversed leave", () => {
    const s = fixture();
    expect(
      stateSchema.safeParse({
        ...s,
        leaves: [
          {
            id: "l",
            personId: "p",
            start: "2026-10-08",
            end: "2026-10-04",
            hours: null,
            note: "",
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      stateSchema.safeParse({
        ...s,
        apps: [{ ...s.apps[0], weekends: [0, 1, 2, 3, 4, 5, 6] }],
      }).success,
    ).toBe(false);
    expect(
      stateSchema.safeParse({
        ...s,
        apps: [{ ...s.apps[0], planningStart: "2026-02-30" }],
      }).success,
    ).toBe(false);
  });
});
