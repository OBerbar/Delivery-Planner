import { describe, expect, it } from "vitest";
import { peopleTimelineRows } from "../src/lib/timeline-people";
import { maintenanceFixture } from "../scripts/maintenance-fixture";
import { featureWork } from "../src/lib/feature-work";
import { schedule, type Schedule } from "../src/lib/planning";

describe("person timeline layout", () => {
  it("keeps an aggregate planned color when one task has past dates and another is unscheduled", () => {
    const state = maintenanceFixture();
    state.features = [
      {
        ...state.features[0],
        tasks: [
          {
            id: "dated",
            title: "Dated",
            personId: "p",
            scope: "Backend",
            hours: 8,
            status: "todo",
            dependsOn: [],
          },
          {
            id: "cycle",
            title: "Cycle",
            personId: "p",
            scope: "Backend",
            hours: 8,
            status: "todo",
            dependsOn: ["cycle"],
          },
        ],
      },
    ];
    const forecast = schedule(state, "2030-01-09");
    const bar = peopleTimelineRows(
      state,
      "a",
      forecast,
      "2030-01-06",
      "2030-02-06",
      12,
    )[0].bars[0];
    expect(bar.forecast).toMatchObject({
      start: "2030-01-07",
      end: "2030-01-07",
    });
    expect(bar.forecast.reason).toBeTruthy();
    expect(bar.color).toBe(state.apps[0].color);
  });

  it("groups reservations once per member and retains each person's own dates without changing saved state", () => {
    const state = maintenanceFixture();
    const before = structuredClone(state);
    const forecast = schedule(state, "2030-01-06");
    const rows = peopleTimelineRows(
      state,
      "a",
      forecast,
      "2030-01-06",
      "2030-07-05",
      12,
    );
    expect(rows.map((r) => r.personId)).toEqual(["p", "q"]);
    expect(rows.map((r) => r.bars.length)).toEqual([2, 1]);
    expect(rows[0].bars[1].forecast.start).not.toBe(
      rows[1].bars[0].forecast.start,
    );
    expect(state).toEqual(before);
  });

  it("aggregates multiple tasks on the same person's feature and retains incomplete-work warnings", () => {
    const state = maintenanceFixture();
    state.features = [state.features[0]];
    delete state.features[0].planningFrom;
    state.features[0].tasks = [
      {
        id: "t1",
        title: "First",
        personId: "p",
        scope: "Build",
        hours: 8,
        status: "todo",
        dependsOn: [],
      },
      {
        id: "t2",
        title: "Second",
        personId: "p",
        scope: "Build",
        hours: 8,
        status: "blocked",
        dependsOn: [],
      },
      {
        id: "t3",
        title: "Design",
        personId: "q",
        scope: "Design",
        hours: 8,
        status: "todo",
        dependsOn: [],
      },
    ];
    const forecast = schedule(state, "2030-01-06");
    const rows = peopleTimelineRows(
      state,
      "a",
      forecast,
      "2030-01-06",
      "2030-03-05",
      12,
    );
    expect(rows.map((r) => r.bars.length)).toEqual([1, 1]);
    expect(rows[0].bars[0].taskIds).toEqual(["t1", "t2"]);
    expect(rows[0].bars[0].forecast.reason).toBeTruthy();
    expect(rows[0].bars[0].forecast.start).toBe(forecast.tasks.t1.start);
    expect(rows[1].bars[0].forecast.end).toBe(forecast.tasks.t3.end);
  });

  it("stacks overlapping rendered bars but reuses a lane for later work, keeping subsequent rows aligned", () => {
    const state = maintenanceFixture();
    state.features.push({
      ...state.features[0],
      id: "later",
      title: "Later",
      priority: 2,
    });
    const forecast: Schedule = { features: {}, tasks: {} };
    const spans = [
      ["2030-01-07", "2030-01-10"],
      ["2030-01-09", "2030-01-12"],
      ["2030-01-20", "2030-01-22"],
    ];
    state.features.forEach((f, i) =>
      featureWork(state, f).forEach((t) => {
        forecast.tasks[t.id] = {
          start: spans[i][0],
          end: spans[i][1],
          days: [],
        };
      }),
    );
    const rows = peopleTimelineRows(
      state,
      "a",
      forecast,
      "2030-01-06",
      "2030-03-05",
      12,
    );
    expect(rows[0].bars.map((b) => b.lane)).toEqual([0, 1, 0]);
    expect(rows[0].height).toBe(120);
    expect(rows[1].top).toBe(120);
  });

  it("keeps blocked work separately clickable and avoids adding lanes for work outside the date window", () => {
    const state = maintenanceFixture();
    state.features.push({
      ...state.features[0],
      id: "blocked",
      planningFrom: undefined,
      title: "Blocked",
      priority: 2,
      status: "blocked",
    });
    const rows = peopleTimelineRows(
      state,
      "a",
      schedule(state, "2030-01-06"),
      "2030-01-06",
      "2030-02-05",
      12,
    );
    expect(rows[0].bars.find((b) => b.id === "mixed")!.lane).toBe(0);
    expect(rows[0].bars.find((b) => b.id === "blocked")!.lane).not.toBe(
      rows[0].bars.find((b) => b.id === "long")!.lane,
    );
    expect(rows[0].height).toBe(120);
  });

  it("shows idle members when there are no features and excludes people who do not belong to this app", () => {
    const state = maintenanceFixture();
    state.features = [];
    state.people.push({ id: "outside", name: "Other app", dailyHours: 8 });
    const rows = peopleTimelineRows(
      state,
      "a",
      { features: {}, tasks: {} },
      "2030-01-06",
      "2030-03-05",
      12,
    );
    expect(rows.map((r) => r.title)).toEqual(["Alex", "Sam"]);
    expect(
      rows.every((r) => r.sub === "No assigned features" && r.height === 72),
    ).toBe(true);
  });
});
