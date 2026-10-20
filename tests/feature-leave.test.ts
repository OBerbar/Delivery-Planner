import { describe, expect, it } from "vitest";
import { maintenanceFixture } from "../scripts/maintenance-fixture";
import {
  featureLeaveDays,
  featureLeaveRanges,
  featureLeaveSummary,
} from "../src/lib/feature-leave";
import { schedule } from "../src/lib/planning";

function fixture() {
  const state = structuredClone(maintenanceFixture());
  const feature = state.features[1];
  state.features = [feature];
  feature.estimateEffort = [
    { personId: "p", hours: 80 },
    { personId: "q", hours: 80 },
  ];
  state.leaves = [
    {
      id: "p-leave",
      personId: "p",
      start: "2030-01-08",
      end: "2030-01-10",
      hours: null,
      note: "Vacation",
    },
    {
      id: "q-leave",
      personId: "q",
      start: "2030-01-10",
      end: "2030-01-10",
      hours: null,
      note: "Personal day",
    },
    {
      id: "partial",
      personId: "p",
      start: "2030-01-11",
      end: "2030-01-11",
      hours: 2,
      note: "Appointment",
    },
  ];
  return { state, feature };
}
describe("feature leave display", () => {
  it("shows a continuous leave period across different weekends and a selected-person holiday without changing capacity", () => {
    const { state, feature } = fixture();
    state.apps[0].weekends = [5, 6];
    state.members[0].weekends = [0, 6];
    state.leaves = [
      {
        id: "continuous",
        personId: "p",
        start: "2030-01-11",
        end: "2030-01-15",
        hours: null,
        note: "Vacation",
      },
    ];
    state.holidays = [
      {
        id: "selected",
        appId: "a",
        date: "2030-01-14",
        name: "Personal holiday",
        personIds: ["p"],
      },
    ];
    const before = structuredClone(state);
    const forecast = schedule(state, "2030-01-06");
    const originalForecast = structuredClone(forecast);
    const values = featureLeaveDays(
      state,
      feature,
      forecast,
      "2030-01-10",
      "2030-01-16",
    );
    expect(values.map((day) => [day.date, day.coverage])).toEqual([
      ["2030-01-11", "full"],
      ["2030-01-12", "full"],
      ["2030-01-13", "partial"],
      ["2030-01-14", "partial"],
      ["2030-01-15", "partial"],
    ]);
    for (const date of ["2030-01-12", "2030-01-13", "2030-01-14"]) {
      const day = values.find((value) => value.date === date)!;
      expect(day.people[0].remainingHours).toBe(0);
      expect(day.people[0].lostHours).toBe(0);
      expect(featureLeaveSummary(day)).toContain("Leave: Vacation");
      expect(featureLeaveSummary(day)).toContain(
        date === "2030-01-14" ? "Holiday: Personal holiday" : "Weekend",
      );
    }
    expect(state).toEqual(before);
    expect(forecast).toEqual(originalForecast);
  });
  it("distinguishes partial team absence, total unavailability and partial-day leave without changing records", () => {
    const { state, feature } = fixture();
    const before = structuredClone(state);
    const forecast = schedule(state, "2030-01-06");
    const originalForecast = structuredClone(forecast);
    const days = featureLeaveDays(
      state,
      feature,
      forecast,
      "2030-01-06",
      "2030-02-06",
    );
    expect(days.map((d) => [d.date, d.coverage])).toEqual([
      ["2030-01-08", "partial"],
      ["2030-01-09", "partial"],
      ["2030-01-10", "full"],
      ["2030-01-11", "partial"],
    ]);
    expect(days[0].people.map((p) => [p.name, p.remainingHours])).toEqual([
      ["Alex", 0],
      ["Sam", 8],
    ]);
    expect(days[3].people[0].remainingHours).toBe(6);
    expect(days[3].people[0].leaves[0].hours).toBe(2);
    expect(state).toEqual(before);
    expect(forecast).toEqual(originalForecast);
  });
  it("clips to the visible window and ignores unrelated leave and unapplied templates", () => {
    const { state, feature } = fixture();
    state.leaves.push({
      id: "other",
      personId: "other",
      start: "2030-01-07",
      end: "2030-02-07",
      hours: null,
      note: "Unrelated",
    });
    state.holidays.push({
      id: "holiday",
      appId: "a",
      date: "2030-01-09",
      name: "Holiday",
    });
    const forecast = schedule(state, "2030-01-06");
    expect(
      featureLeaveDays(
        state,
        feature,
        forecast,
        "2030-01-09",
        "2030-01-10",
      ).map((d) => d.date),
    ).toEqual(["2030-01-09", "2030-01-10"]);
    expect(
      featureLeaveDays(state, feature, forecast, "2030-02-01", "2030-02-28"),
    ).toEqual([]);
  });
  it("shows partial leave without claiming capacity loss when the app allocation is unchanged", () => {
    const { state, feature } = fixture();
    state.members[0].allocation = 50;
    state.leaves = [
      {
        id: "partial",
        personId: "p",
        start: "2030-01-08",
        end: "2030-01-08",
        hours: 2,
        note: "Appointment",
      },
    ];
    const values = featureLeaveDays(
      state,
      feature,
      schedule(state, "2030-01-06"),
      "2030-01-07",
      "2030-01-20",
    );
    expect(values.map((day) => [day.date, day.coverage])).toEqual([
      ["2030-01-08", "partial"],
    ]);
    expect(values[0].people[0].remainingHours).toBe(4);
    expect(values[0].people[0].lostHours).toBe(0);
  });
  it("deduplicates assignees from optional tasks and ignores completed work and finished assignees", () => {
    const { state, feature } = fixture();
    feature.assigneeIds = undefined;
    feature.tasks = [
      {
        id: "a",
        title: "A",
        personId: "p",
        scope: "Backend",
        hours: 80,
        status: "todo",
        dependsOn: [],
      },
      {
        id: "b",
        title: "B",
        personId: "p",
        scope: "Backend",
        hours: 8,
        status: "todo",
        dependsOn: [],
      },
      {
        id: "c",
        title: "C",
        personId: "q",
        scope: "Design",
        hours: 8,
        status: "todo",
        dependsOn: [],
      },
    ];
    let forecast = schedule(state, "2030-01-06");
    const days = featureLeaveDays(
      state,
      feature,
      forecast,
      "2030-01-07",
      "2030-01-20",
    );
    expect(days[0].coverage).toBe("full");
    expect(days[0].people.map((p) => p.name)).toEqual(["Alex"]);
    feature.tasks.forEach((t) => {
      t.status = "done";
      t.actualStart = "2030-01-07";
      t.actualEnd = "2030-01-07";
    });
    forecast = schedule(state, "2030-01-06");
    expect(
      featureLeaveDays(state, feature, forecast, "2030-01-07", "2030-01-20"),
    ).toEqual([]);
  });
  it("caps overlapping leave and accounts for another active assignee's weekend", () => {
    const { state, feature } = fixture();
    state.members[1].weekends = [2, 6];
    state.leaves.push({
      id: "overlap",
      personId: "p",
      start: "2030-01-08",
      end: "2030-01-08",
      hours: 4,
      note: "Overlap",
    });
    const days = featureLeaveDays(
      state,
      feature,
      schedule(state, "2030-01-06"),
      "2030-01-07",
      "2030-01-20",
    );
    expect(days[0].coverage).toBe("full");
    expect(days[0].people[0].remainingHours).toBe(0);
    expect(days[0].people[0].leaves).toHaveLength(2);
    expect(days[0].people[1].calendarReason).toContain("Weekend");
  });
  it("groups only consecutive days with identical people and leave details", () => {
    const { state, feature } = fixture();
    const values = featureLeaveDays(
      state,
      feature,
      schedule(state, "2030-01-06"),
      "2030-01-07",
      "2030-01-20",
    );
    expect(
      featureLeaveRanges(values).map((r) => [r.date, r.end, r.coverage]),
    ).toEqual([
      ["2030-01-08", "2030-01-09", "partial"],
      ["2030-01-10", "2030-01-10", "full"],
      ["2030-01-11", "2030-01-11", "partial"],
    ]);
    expect(featureLeaveRanges(values)[0].people[0].leaves[0].end).toBe(
      "2030-01-10",
    );
  });
});
