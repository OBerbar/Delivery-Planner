import { describe, expect, it } from "vitest";
import { featureOverview } from "../src/lib/feature-overview";
import { explainDelay } from "../src/lib/delay-explanation";
import { schedule } from "../src/lib/planning";
import { emptyState, type Task, type PlannerState } from "../src/lib/model";

const now = "2030-01-07";
function fixture(): PlannerState {
  return {
    ...structuredClone(emptyState),
    apps: [
      {
        id: "a",
        name: "Studio",
        color: "#123456",
        weekends: [0, 6],
        planningStart: now,
        cadence: "2w",
        customDays: 14,
        terms: "",
        archived: false,
      },
    ],
    people: [
      { id: "p", name: "Alex", dailyHours: 8 },
      { id: "q", name: "Sam", dailyHours: 4 },
    ],
    members: [
      {
        id: "mp",
        appId: "a",
        personId: "p",
        role: "Backend",
        allocation: 100,
        weekends: null,
      },
      {
        id: "mq",
        appId: "a",
        personId: "q",
        role: "Design",
        allocation: 100,
        weekends: null,
      },
    ],
    features: [
      {
        id: "f",
        appId: "a",
        title: "Delivery",
        description: "",
        completion: "",
        priority: 0,
        tasks: [],
        assigneeIds: ["p", "q"],
        assigneeEstimates: [
          { personId: "p", unit: "days", value: 2 },
          { personId: "q", unit: "days", value: 2 },
        ],
        estimateEffort: [
          { personId: "p", hours: 16 },
          { personId: "q", hours: 8 },
        ],
        planningFrom: now,
        committed: false,
        link: "",
      },
    ],
  };
}
function task(
  id: string,
  personId: string,
  hours: number,
  extra: Partial<Task> = {},
): Task {
  return {
    id,
    title: id,
    personId,
    scope: "Delivery",
    hours,
    status: "todo",
    dependsOn: [],
    ...extra,
  };
}
function overview(state: PlannerState, asOf = now) {
  return featureOverview(state, state.features[0], schedule(state, asOf));
}

describe("read-only feature overview", () => {
  it("shows saved working days each, inclusive calendar duration and every tied delivery determiner", () => {
    const state = fixture();
    const before = structuredClone(state);
    const result = overview(state);
    expect(result).toMatchObject({
      start: now,
      end: "2030-01-08",
      calendarDays: 2,
      sharedEffortDays: 2,
      allTeam: true,
    });
    expect(result.people).toEqual([
      expect.objectContaining({
        personId: "p",
        name: "Alex",
        role: "Backend",
        allocation: 100,
        estimatedDays: 2,
        remainingDays: 2,
        allocatedDays: 2,
        reassignedDays: 0,
        start: now,
        end: "2030-01-08",
        completed: false,
        determinesDelivery: true,
      }),
      expect.objectContaining({
        personId: "q",
        estimatedDays: 2,
        remainingDays: 2,
        allocatedDays: 2,
        determinesDelivery: true,
      }),
    ]);
    expect(state).toEqual(before);
  });

  it("retains the original days-each estimate when allocations normalize saved effort differently", () => {
    const state = fixture();
    state.members[1].allocation = 50;
    state.features[0].assigneeEstimates = [
      { personId: "p", unit: "days", value: 5 },
      { personId: "q", unit: "days", value: 5 },
    ];
    state.features[0].estimateEffort = [
      { personId: "p", hours: 40 },
      { personId: "q", hours: 10 },
    ];
    const result = overview(state);
    expect(result.sharedInputEstimateDays).toBe(5);
    expect(result.sharedEffortDays).toBeUndefined();
    expect(result.people[0]).toMatchObject({
      inputEstimateDays: 5,
      estimatedDays: 5,
    });
    expect(result.people[1]).toMatchObject({
      inputEstimateDays: 5,
      estimatedDays: 2.5,
    });
    state.people[0].dailyHours = 4;
    const changedDayLength = overview(state);
    expect(changedDayLength.sharedInputEstimateDays).toBe(5);
    expect(changedDayLength.people[0]).toMatchObject({
      inputEstimateDays: 5,
      estimatedDays: 10,
    });
  });

  it("compares input estimates in working days across sprint and day units", () => {
    const state = fixture();
    state.features[0].assigneeEstimates = [
      { personId: "p", unit: "sprints", value: 1 },
      { personId: "q", unit: "days", value: 10 },
    ];
    const result = overview(state);
    expect(result.sharedInputEstimateDays).toBe(10);
    expect(result.people.map((person) => person.inputEstimateDays)).toEqual([
      10, 10,
    ]);
    state.features[0].assigneeEstimates = undefined;
    state.features[0].sprintEstimate = 0.5;
    expect(overview(state).sharedInputEstimateDays).toBe(5);
  });

  it("does not use stale feature inputs as estimates for task-driven work", () => {
    const state = fixture();
    state.features[0].tasks = [task("backend", "p", 8), task("design", "q", 4)];
    const result = overview(state);
    expect(result.sharedEffortDays).toBe(1);
    expect(result.sharedInputEstimateDays).toBeUndefined();
    expect(result.people.map((person) => person.inputEstimateDays)).toEqual([
      undefined,
      undefined,
    ]);
  });

  it("requires a valid matching input estimate from every participant for a shared input summary", () => {
    const state = fixture();
    state.features[0].assigneeEstimates = [
      { personId: "p", unit: "days", value: 2 },
    ];
    expect(overview(state).sharedInputEstimateDays).toBeUndefined();
    state.features[0].assigneeEstimates.push({
      personId: "q",
      unit: "days",
      value: 3,
    });
    expect(overview(state).sharedInputEstimateDays).toBeUndefined();
    state.features[0].assigneeEstimates[1].value = 2 + 1e-8;
    expect(overview(state).sharedInputEstimateDays).toBe(2);
    state.features[0].assigneeEstimates[1].value = NaN;
    expect(overview(state).sharedInputEstimateDays).toBeUndefined();
    expect(overview(state).people[1].inputEstimateDays).toBeUndefined();
  });

  it("explains uncommitted and on-time work while preserving the delayed-only contract", () => {
    const state = fixture();
    state.features[0].notBefore = "2030-01-09";
    for (const accepted of [undefined, "2030-02-01"]) {
      state.features[0].committed = !!accepted;
      state.features[0].commitment = accepted
        ? { end: accepted, acceptedAt: now }
        : undefined;
      const forecast = schedule(state, now);
      expect(
        featureOverview(state, state.features[0], forecast).constraints,
      ).toEqual([
        expect.objectContaining({
          personId: "p",
          startConstraints: [
            {
              kind: "not-before",
              label: "Start no earlier than",
              date: "2030-01-09",
            },
          ],
        }),
        expect.objectContaining({ personId: "q" }),
      ]);
      expect(explainDelay(state, "f", forecast, now)).toBeNull();
    }
  });

  it("uses current day lengths and allocation without replacing saved effort with editor estimates", () => {
    const state = fixture();
    state.people[0].dailyHours = 4;
    state.members[0].allocation = 50;
    state.features[0].assigneeEstimates![0].value = 99;
    state.people.push({ id: "r", name: "Jamie", dailyHours: 8 });
    state.members.push({ ...state.members[0], id: "mr", personId: "r" });
    const result = overview(state);
    expect(result.sharedEffortDays).toBeUndefined();
    expect(result.allTeam).toBe(false);
    expect(result.people[0]).toMatchObject({
      estimatedDays: 4,
      remainingDays: 4,
      allocatedDays: 4,
      allocation: 50,
      end: "2030-01-16",
      determinesDelivery: true,
    });
    expect(result.people[1].determinesDelivery).toBe(false);
    expect(result.calendarDays).toBe(10);
  });

  it("groups several tasks by owner and counts task effort instead of feature reservations", () => {
    const state = fixture();
    state.features[0].tasks = [
      task("first", "p", 8),
      task("next", "p", 16, { dependsOn: ["first"] }),
      task("design", "q", 8),
    ];
    const result = overview(state);
    expect(result.people).toHaveLength(2);
    expect(result.people[0]).toMatchObject({
      estimatedDays: 3,
      remainingDays: 3,
      allocatedDays: 3,
      start: now,
      end: "2030-01-09",
      determinesDelivery: true,
    });
    expect(result.people[1]).toMatchObject({
      estimatedDays: 2,
      end: "2030-01-08",
      determinesDelivery: false,
    });
    expect(result.sharedEffortDays).toBeUndefined();
    expect(result.constraints[0].startConstraints).toContainEqual(
      expect.objectContaining({
        kind: "dependency",
        label: "first",
        date: "2030-01-08",
      }),
    );
  });

  it("reports actual capacity contention from another app for ordinary on-time work", () => {
    const state = fixture();
    state.apps.push({ ...state.apps[0], id: "b", name: "Other studio" });
    state.members.push({ ...state.members[0], id: "mb", appId: "b" });
    state.features.push({
      ...structuredClone(state.features[0]),
      id: "other",
      appId: "b",
      priority: 0,
      assigneeIds: ["p"],
      estimateEffort: [{ personId: "p", hours: 8 }],
    });
    state.features[0].priority = 1;
    const result = overview(state);
    expect(result.people[0].end).toBe("2030-01-09");
    expect(result.constraints[0]).toMatchObject({
      capacityLostHours: 8,
      competingWork: [
        expect.objectContaining({
          featureId: "other",
          appId: "b",
          appName: "Other studio",
          hours: 8,
          dates: [now],
          internal: false,
        }),
      ],
    });
  });

  it("uses the forecast calculation date for remaining work and replayed start constraints", () => {
    const state = fixture();
    const result = overview(state, "2030-01-08");
    expect(result.people[0]).toMatchObject({
      estimatedDays: 2,
      remainingDays: 1,
      start: now,
      end: "2030-01-08",
      completed: false,
    });
    expect(result.constraints[0].startConstraints).toContainEqual({
      kind: "planning-from",
      label: "Planning began",
      date: now,
    });
  });

  it("replays an older unanchored forecast on its original calculation date", () => {
    const state = fixture();
    delete state.features[0].planningFrom;
    state.apps[0].planningStart = "2029-01-01";
    const forecast = schedule(state, now);
    const result = featureOverview(state, state.features[0], forecast);
    expect(result.constraints[0].startConstraints).toEqual([
      { kind: "today", label: "Planning from today", date: now },
    ]);
    expect(result.people[0].start).toBe(now);
  });

  it("recognizes equal saved estimates despite insignificant floating point differences", () => {
    const state = fixture();
    state.features[0].estimateEffort![1].hours += 1e-8;
    expect(overview(state).sharedEffortDays).toBe(2);
    state.features[0].estimateEffort![1].hours += 0.01;
    expect(overview(state).sharedEffortDays).toBeUndefined();
  });

  it("honors personal leave, Ignore leave, holidays and weekend rules", () => {
    const state = fixture();
    state.leaves = [
      {
        id: "leave",
        personId: "p",
        start: now,
        end: now,
        hours: null,
        note: "Away",
      },
    ];
    state.holidays = [
      { id: "holiday", appId: "a", date: "2030-01-08", name: "Holiday" },
    ];
    expect(overview(state).constraints[0].calendar).toEqual([
      { kind: "leave", label: "Away", dates: [now], hours: 8 },
      { kind: "holiday", label: "Holiday", dates: ["2030-01-08"], hours: 8 },
    ]);
    state.features[0].ignoreLeave = true;
    const result = overview(state);
    expect(result.end).toBe("2030-01-09");
    expect(result.constraints[0].calendar).toEqual([
      { kind: "holiday", label: "Holiday", dates: ["2030-01-08"], hours: 8 },
    ]);
  });

  it("keeps historical completed dates and effort without inventing present scheduling causes", () => {
    const state = fixture();
    Object.assign(state.features[0], {
      status: "done",
      actualStart: "2029-12-20",
      actualEnd: "2029-12-21",
    });
    state.leaves = [
      {
        id: "leave",
        personId: "p",
        start: now,
        end: "2030-12-31",
        hours: null,
        note: "Current leave",
      },
    ];
    const result = overview(state);
    expect(result).toMatchObject({
      start: "2029-12-20",
      end: "2029-12-21",
      calendarDays: 2,
      constraints: [],
    });
    expect(result.people[0]).toMatchObject({
      estimatedDays: 2,
      remainingDays: 0,
      allocatedDays: 0,
      completed: true,
      start: "2029-12-20",
      end: "2029-12-21",
    });
  });

  it("treats automatically elapsed work as complete without losing its saved scope or bookings", () => {
    const state = fixture();
    const result = overview(state, "2030-01-09");
    expect(result.constraints).toEqual([]);
    expect(result.people[0]).toMatchObject({
      estimatedDays: 2,
      remainingDays: 0,
      allocatedDays: 2,
      start: now,
      end: "2030-01-08",
      completed: true,
    });
  });

  it("omits completed contributors from current constraints while retaining their historical rows", () => {
    const state = fixture();
    state.features[0].tasks = [
      task("done", "p", 8, {
        status: "done",
        actualStart: "2029-12-20",
        actualEnd: "2029-12-20",
      }),
      task("next", "q", 8),
    ];
    const result = overview(state);
    expect(result.people[0]).toMatchObject({
      completed: true,
      remainingDays: 0,
      start: "2029-12-20",
      end: "2029-12-20",
      determinesDelivery: false,
    });
    expect(result.constraints.map((person) => person.personId)).toEqual(["q"]);
  });

  it("does not turn partial unscheduled work into a complete person finish or delivery determiner", () => {
    const state = fixture();
    state.features[0].tasks = [
      task("fits", "p", 8),
      task("too-large", "p", 60000),
      task("design", "q", 4),
    ];
    const result = overview(state);
    expect(result.start).toBe(now);
    expect(result.end).toBeUndefined();
    expect(result.calendarDays).toBeUndefined();
    expect(result.people[0]).toMatchObject({
      start: now,
      estimatedDays: 7501,
      allocatedDays: 1,
      completed: false,
      reason: expect.stringMatching(/five-year forecast horizon/),
    });
    expect(result.people[0].end).toBeUndefined();
    expect(result.people.every((person) => !person.determinesDelivery)).toBe(
      true,
    );
  });

  it("names unscheduled dependency owners and cycles without inventing dates", () => {
    const state = fixture();
    state.features[0].tasks = [
      task("first", "p", 8, { dependsOn: ["second"] }),
      task("second", "q", 4, { dependsOn: ["first"] }),
    ];
    const result = overview(state);
    expect(result.end).toBeUndefined();
    expect(result.people[0].reason).toMatch(/Dependency cycle/);
    expect(result.constraints[0].startConstraints).toContainEqual({
      kind: "blocked-dependency",
      label: "second",
      featureId: "f",
      featureTitle: "Delivery",
      personId: "q",
      personName: "Sam",
    });
    expect(result.people.some((person) => person.determinesDelivery)).toBe(
      false,
    );
  });

  it("separates allocated and reassigned days while retaining original effort and parallel windows", () => {
    const state = fixture();
    state.features.push({
      ...structuredClone(state.features[0]),
      id: "parallel",
      title: "Surprise",
      priority: 1,
      doesntAffectOtherWork: true,
      assigneeIds: ["p"],
      estimateEffort: [{ personId: "p", hours: 8 }],
    });
    const result = overview(state);
    expect(result.end).toBe("2030-01-08");
    expect(result.people[0]).toMatchObject({
      estimatedDays: 2,
      remainingDays: 2,
      allocatedDays: 1,
      reassignedDays: 1,
    });
    expect(result.constraints[0]).toMatchObject({
      reassignedHours: 8,
      competingWork: [],
      capacityLostHours: 0,
    });
    expect(overview(state, "2030-01-08").people[0].remainingDays).toBe(1);
  });
});
