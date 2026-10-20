import { describe, it, expect } from "vitest";
import { maintenanceFixture, fixedToday } from "../scripts/maintenance-fixture";
import { generatePlan, schedule } from "../src/lib/planning";
import {
  refreshCommitments,
  alignExistingCommitments,
} from "../src/lib/commitments";
import { applyCalendarTemplate } from "../src/lib/availability";
import { stateSchema } from "../src/lib/model";
const fixture = () => structuredClone(maintenanceFixture());
describe("day-based planning and sprint delivery", () => {
  it("exports named leave dates instead of a resource hour ledger and retains all team members", () => {
    const state = fixture();
    state.features = [state.features[0]];
    state.leaves = [
      {
        id: "l",
        personId: "q",
        start: "2030-01-08",
        end: "2030-01-09",
        hours: 4,
        note: "Appointment",
      },
    ];
    const text = generatePlan(
      state,
      state.sprints[0],
      schedule(state, fixedToday),
    );
    expect(text).toContain("**Resources Allocated:** Alex, Sam");
    expect(text).toContain("Sam is on leave");
    expect(text).toContain("Jan 8, 2030 – Jan 9, 2030");
    expect(text).toContain("0.5 working day off per day");
    expect(text).not.toMatch(/\d+(?:\.\d+)?h (available|remaining|forecast)/);
    expect(text).toContain(state.apps[0].terms);
    expect(state.sprints[0].snapshot).toContain("Accepted original plan");
  });
  it("accepts the sprint ending rather than an in-sprint forecast and remains on time within that sprint", () => {
    const state = fixture();
    state.features = [state.features[0]];
    state.features[0].estimateEffort = [{ personId: "p", hours: 24 }];
    const accepted = refreshCommitments(state, ["long"], fixedToday);
    expect(schedule(accepted, fixedToday).features.long.end).toBe("2030-01-09");
    expect(accepted.features[0].commitment?.end).toBe("2030-01-18");
    accepted.leaves = [
      {
        id: "l",
        personId: "p",
        start: "2030-01-08",
        end: "2030-01-09",
        hours: null,
        note: "Leave",
      },
    ];
    expect(schedule(accepted, fixedToday).features.long.commitmentDelayed).toBe(
      false,
    );
  });
  it("respects explicit delivery sprint overrides for multi-sprint features", () => {
    const state = fixture();
    state.features = [state.features[0]];
    state.features[0].estimateEffort = [{ personId: "p", hours: 96 }];
    state.sprints.push({
      ...state.sprints[0],
      id: "s2",
      number: 2,
      start: "2030-01-21",
      end: "2030-02-01",
    });
    const accepted = refreshCommitments(state, ["long"], fixedToday);
    expect(schedule(accepted, fixedToday).features.long.end).toBe("2030-01-22");
    expect(accepted.features[0].commitment?.end).toBe("2030-02-01");
    expect(accepted.sprints).toEqual(state.sprints);
  });
  it("projects future sprint ends when work finishes beyond generated sprints", () => {
    const state = fixture();
    state.features = [state.features[0]];
    state.features[0].estimateEffort = [{ personId: "p", hours: 96 }];
    const accepted = refreshCommitments(state, ["long"], fixedToday);
    expect(accepted.features[0].commitment?.end).toBe("2030-02-01");
    expect(accepted.sprints).toEqual(state.sprints);
  });
  it("applies a half-day template using each person's configured day length without breaking legacy templates", () => {
    const state = fixture();
    state.people[1].dailyHours = 6;
    state.calendarTemplates![0].entries[0] = {
      ...state.calendarTemplates![0].entries[0],
      hours: 4,
      dayFraction: 0.5,
    };
    const parsed = stateSchema.parse(state);
    const applied = applyCalendarTemplate(parsed, "template", "a", ["p", "q"]);
    expect(applied.leaves.map((l) => [l.personId, l.hours])).toEqual([
      ["p", 4],
      ["q", 3],
    ]);
    const legacy = fixture();
    legacy.people[1].dailyHours = 6;
    legacy.calendarTemplates![0].entries[0].hours = 4;
    expect(
      applyCalendarTemplate(legacy, "template", "a", ["q"]).leaves[0].hours,
    ).toBe(4);
  });
});

it("aligns existing dates to their original sprint without accepting forecasts or rewriting history", () => {
  const state = fixture();
  state.features[0].commitment = {
    end: "2030-01-09",
    acceptedAt: "2029-12-20",
  };
  const before = structuredClone(state);
  const aligned = alignExistingCommitments(state);
  expect(aligned.features[0].commitment).toEqual({
    end: "2030-01-18",
    acceptedAt: "2029-12-20",
  });
  expect(schedule(state, fixedToday).features.long.end).toBe("2030-03-15");
  expect(aligned.sprints).toEqual(before.sprints);
  expect(aligned.features[0].estimateEffort).toEqual(
    before.features[0].estimateEffort,
  );
  expect(state).toEqual(before);
  expect(alignExistingCommitments(aligned)).toEqual(aligned);
});

it("converts each owner's full workday before summing mixed-owner effort and allocations", async () => {
  const { featureDays, taskDayTotals, personDayLabel } =
    await import("../src/lib/working-days");
  const state = fixture();
  state.features = [state.features[1]];
  state.people[1].dailyHours = 6;
  state.features[0].estimateEffort = [
    { personId: "p", hours: 8 },
    { personId: "q", hours: 6 },
  ];
  const forecast = schedule(state, fixedToday);
  expect(featureDays(state, state.features[0])).toBe(2);
  expect(taskDayTotals(state, forecast, Object.keys(forecast.tasks))).toBe(2);
  expect(personDayLabel(3, 6)).toBe("0.5 working day");
  expect(stateSchema.parse(JSON.parse(JSON.stringify(state)))).toEqual(
    stateSchema.parse(state),
  );
});

it("uses calendar-month and custom cadence and skips shared weekends in future delivery periods", async () => {
  const { deliverySprintEnd } = await import("../src/lib/delivery-calendar");
  const state = fixture();
  state.sprints = [];
  state.apps[0].planningStart = "2030-01-31";
  state.apps[0].cadence = "month";
  expect(deliverySprintEnd(state, "a", "2030-02-05")).toBe("2030-02-27");
  state.apps[0].planningStart = "2030-01-07";
  state.apps[0].cadence = "custom";
  state.apps[0].customDays = 7;
  expect(deliverySprintEnd(state, "a", "2030-01-12")).toBe("2030-01-18");
});

it("exports clipped leave and named selected-person holiday dates without changing finalized wording", () => {
  const state = fixture();
  state.leaves = [
    {
      id: "l",
      personId: "p",
      start: "2030-01-01",
      end: "2030-01-08",
      hours: null,
      note: "Annual leave",
    },
  ];
  state.holidays = [
    {
      id: "h",
      appId: "a",
      date: "2030-01-09",
      name: "National holiday",
      personIds: ["q"],
    },
  ];
  const text = generatePlan(
    state,
    state.sprints[0],
    schedule(state, fixedToday),
  );
  expect(text).toContain(
    "Alex is on leave from Jan 7, 2030 – Jan 8, 2030: full-day leave (Annual leave)",
  );
  expect(text).toContain("National holiday: Jan 9, 2030 (Sam) — holiday");
  expect(text).not.toContain("Jan 1, 2030");
  expect(state.sprints[0].snapshot).toBe(
    "# Accepted original plan\nKeep the approved wording.",
  );
});
