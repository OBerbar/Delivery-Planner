import { describe, expect, it } from "vitest";
import { maintenanceFixture } from "../scripts/maintenance-fixture";
import { schedule, resources } from "../src/lib/planning";
import { reservationId, stateSchema } from "../src/lib/model";
import { remainingFeatureDays } from "../src/lib/working-days";

function fixture() {
  const state = maintenanceFixture();
  state.features = [
    {
      ...state.features[0],
      planningFrom: "2030-01-07",
      sprintEstimate: 0.5,
      estimateEffort: [{ personId: "p", hours: 16 }],
    },
  ];
  return state;
}

describe("automatic scheduling uses stable planning dates", () => {
  it("keeps booking dates across today changes and JSON reloads", () => {
    const state = fixture();
    const first = schedule(state, "2030-01-07");
    const later = schedule(
      stateSchema.parse(JSON.parse(JSON.stringify(state))),
      "2030-01-10",
    );
    expect(later.tasks).toEqual(first.tasks);
    expect(later.features.long).toMatchObject({
      start: "2030-01-07",
      end: "2030-01-08",
      done: true,
      hours: 0,
    });
    expect(first.features.long.done).toBe(false);
  });

  it.each(["blocked", "doing"] as const)(
    "ignores a legacy %s flag and unblock date for anchored work",
    (status) => {
      const state = fixture();
      Object.assign(state.features[0], { status, unblockDate: "2030-02-01" });
      expect(schedule(state, "2030-01-07").features.long).toMatchObject({
        start: "2030-01-07",
        end: "2030-01-08",
        done: false,
      });
    },
  );

  it("keeps earlier bookings so successors retain stable dates, and demand only includes future work", () => {
    const state = fixture();
    state.features.push({ ...state.features[0], id: "next", priority: 1 });
    const forecast = schedule(state, "2030-01-09");
    expect(forecast.features.next).toMatchObject({
      start: "2030-01-09",
      end: "2030-01-10",
      done: false,
      hours: 16,
    });
    expect(forecast.tasks[reservationId("long", "p")].days).toHaveLength(2);
    expect(resources(state, state.sprints[0], forecast)[0]).toMatchObject({
      demand: 16,
      scheduled: 32,
    });
    expect(schedule(state, "2030-01-08").features.long.hours).toBe(8);
    expect(
      remainingFeatureDays(
        state,
        state.features[0],
        schedule(state, "2030-01-08"),
      ),
    ).toBe(1);
  });

  it("derives completion separately for task windows and their containing feature", () => {
    const state = fixture();
    state.features[0].tasks = [
      {
        id: "one",
        title: "First",
        personId: "p",
        scope: "Backend",
        hours: 8,
        status: "blocked",
        dependsOn: [],
      },
      {
        id: "two",
        title: "Second",
        personId: "q",
        scope: "Design",
        hours: 8,
        status: "doing",
        dependsOn: ["one"],
      },
    ];
    const forecast = schedule(state, "2030-01-08");
    expect(forecast.tasks.one).toMatchObject({
      start: "2030-01-07",
      end: "2030-01-07",
    });
    expect(forecast.tasks.two).toMatchObject({
      start: "2030-01-08",
      end: "2030-01-08",
    });
    expect(forecast.features.long).toMatchObject({
      start: "2030-01-07",
      end: "2030-01-08",
      done: false,
      hours: 8,
    });
    expect(schedule(state, "2030-01-09").features.long.done).toBe(true);
  });

  it("preserves historical actual intervals and still applies dependency constraints", () => {
    const state = fixture();
    state.features[0].tasks = [
      {
        id: "history",
        title: "History",
        personId: "p",
        scope: "Backend",
        hours: 8,
        status: "done",
        actualStart: "2030-01-02",
        actualEnd: "2030-01-03",
        dependsOn: [],
      },
      {
        id: "next",
        title: "Follow up",
        personId: "p",
        scope: "Backend",
        hours: 8,
        status: "todo",
        dependsOn: ["history"],
      },
    ];
    const forecast = schedule(state, "2030-01-10");
    expect(forecast.tasks.history).toEqual({
      start: "2030-01-02",
      end: "2030-01-03",
      days: [],
    });
    expect(forecast.tasks.next.start).toBe("2030-01-07");
    expect(forecast.features.long.done).toBe(true);
  });
  it("uses actual interval dates rather than a legacy done flag for automatic completion", () => {
    const state = fixture();
    Object.assign(state.features[0], {
      status: "done",
      actualStart: "2030-01-07",
      actualEnd: "2030-01-08",
    });
    expect(schedule(state, "2030-01-07").features.long).toMatchObject({
      start: "2030-01-07",
      end: "2030-01-08",
      done: false,
      hours: 16,
    });
    expect(schedule(state, "2030-01-09").features.long).toMatchObject({
      start: "2030-01-07",
      end: "2030-01-08",
      done: true,
      hours: 0,
    });
  });

  it("keeps work unscheduled with calendar reasons when no owner capacity exists", () => {
    const state = fixture();
    state.members[0].allocation = 0;
    const forecast = schedule(state, "2030-01-09");
    expect(forecast.features.long).toMatchObject({ done: false, hours: 16 });
    expect(forecast.features.long.end).toBeUndefined();
    expect(forecast.tasks[reservationId("long", "p")].reason).toMatch(
      /availability/,
    );
  });

  it("recalculates anchored dates after calendar and priority changes", () => {
    const state = fixture();
    state.features.push({ ...state.features[0], id: "next", priority: 1 });
    state.holidays.push({
      id: "holiday",
      appId: "a",
      date: "2030-01-07",
      name: "Holiday",
    });
    state.features[1].priority = 0;
    state.features[0].priority = 1;
    const forecast = schedule(state, "2030-01-10");
    expect(forecast.features.next).toMatchObject({
      start: "2030-01-08",
      end: "2030-01-09",
      done: true,
    });
    expect(forecast.features.long).toMatchObject({
      start: "2030-01-10",
      end: "2030-01-11",
      done: false,
    });
  });
  it("honors creation, app, sprint, earliest start and feature delivery constraints", () => {
    const state = fixture();
    state.features[0].planningFrom = "2030-01-09";
    state.apps[0].planningStart = "2030-01-10";
    state.sprints[0].start = "2030-01-11";
    state.features[0].notBefore = "2030-01-14";
    state.features.push({
      ...state.features[0],
      id: "dependent",
      priority: 1,
      tasks: [
        {
          id: "dependent-task",
          title: "Review",
          personId: "q",
          scope: "QA",
          hours: 8,
          status: "todo",
          dependsOn: [],
          dependsOnFeatures: ["long"],
        },
      ],
    });
    const forecast = schedule(state, "2030-01-21");
    expect(forecast.features.long).toMatchObject({
      start: "2030-01-14",
      end: "2030-01-15",
      done: true,
    });
    expect(forecast.tasks["dependent-task"]).toMatchObject({
      start: "2030-01-16",
      end: "2030-01-16",
    });
  });
});
