import { describe, expect, it } from "vitest";
import {
  commonWeekends,
  nextSprintPeriod,
  sprintPeriod,
} from "../src/lib/sprint-calendar";
import type { AppConfig } from "../src/lib/model";

const app: AppConfig = {
  id: "a",
  name: "Any app",
  color: "#7565db",
  weekends: [5, 6],
  planningStart: "2026-10-03",
  cadence: "2w",
  customDays: 14,
  terms: "",
  archived: false,
};
describe("shared weekend sprint boundaries", () => {
  it("intersects effective member calendars, falling back to the app only when no members exist", () => {
    expect(commonWeekends([5, 6], [null, [0, 6]])).toEqual([6]);
    expect(commonWeekends([5, 6], [[0], null])).toEqual([]);
    expect(commonWeekends([5, 6], [])).toEqual([5, 6]);
    expect(commonWeekends([5, 6], [[]])).toEqual([]);
    expect(commonWeekends([], [[6], [6]])).toEqual([6]);
  });
  it("aligns the first Saturday to Sunday and trims the last Saturday to Friday", () => {
    expect(sprintPeriod("2026-10-10", app, [6])).toEqual({
      start: "2026-10-11",
      end: "2026-10-23",
    });
  });
  it("retains Sunday–Friday across year boundaries", () => {
    expect(
      nextSprintPeriod(app, [6], { start: "2027-01-03", end: "2027-01-15" }),
    ).toEqual({ start: "2027-01-17", end: "2027-01-29" });
  });
  it("uses each app's shared weekdays rather than hard-coding Saturday", () => {
    expect(sprintPeriod("2026-10-10", app, [0, 6])).toEqual({
      start: "2026-10-12",
      end: "2026-10-23",
    });
    expect(sprintPeriod("2026-10-10", app, [])).toEqual({
      start: "2026-10-10",
      end: "2026-10-23",
    });
    expect(sprintPeriod("2026-10-11", app, [5, 6])).toEqual({
      start: "2026-10-11",
      end: "2026-10-22",
    });
  });
  it("keeps a three-week rhythm", () => {
    const threeWeeks = { ...app, cadence: "3w" as const };
    expect(sprintPeriod("2026-10-11", threeWeeks, [6])).toEqual({
      start: "2026-10-11",
      end: "2026-10-30",
    });
    expect(
      nextSprintPeriod(threeWeeks, [6], {
        start: "2026-10-11",
        end: "2026-10-30",
      }),
    ).toEqual({ start: "2026-11-01", end: "2026-11-20" });
  });
  it("keeps the monthly boundary when a trimmed end precedes a working day", () => {
    const monthly = { ...app, cadence: "month" as const };
    expect(sprintPeriod("2026-10-01", monthly, [6])).toEqual({
      start: "2026-10-01",
      end: "2026-10-30",
    });
    expect(
      nextSprintPeriod(monthly, [6], {
        start: "2026-10-01",
        end: "2026-10-30",
      }),
    ).toEqual({ start: "2026-11-01", end: "2026-11-30" });
  });
  it("honors a manually overridden previous end before suggesting a new sprint", () => {
    expect(
      nextSprintPeriod(app, [6], { start: "2026-10-11", end: "2026-10-21" }),
    ).toEqual({ start: "2026-10-22", end: "2026-11-04" });
  });
  it("uses the planning start if there is no prior sprint", () => {
    expect(nextSprintPeriod(app, [6])).toEqual({
      start: "2026-10-04",
      end: "2026-10-16",
    });
  });
  it("supports one-day and custom periods without ending before the start", () => {
    expect(
      sprintPeriod(
        "2026-10-10",
        { ...app, cadence: "custom", customDays: 1 },
        [6],
      ),
    ).toEqual({ start: "2026-10-11", end: "2026-10-11" });
    expect(
      sprintPeriod(
        "2026-10-11",
        { ...app, cadence: "custom", customDays: 7 },
        [6],
      ),
    ).toEqual({ start: "2026-10-11", end: "2026-10-16" });
  });
});
