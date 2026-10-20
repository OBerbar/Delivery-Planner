import { describe, expect, it } from "vitest";
import { maintenanceFixture } from "../scripts/maintenance-fixture";
import { dateStatus, enableAutomaticPlanning } from "../src/lib/date-status";

describe("status from inclusive scheduled dates", () => {
  it.each([
    ["2030-01-06", "todo"],
    ["2030-01-07", "doing"],
    ["2030-01-08", "doing"],
    ["2030-01-09", "doing"],
    ["2030-01-10", "done"],
  ])("on %s returns %s", (now, status) => {
    expect(dateStatus({ start: "2030-01-07", end: "2030-01-09" }, now)).toBe(
      status,
    );
  });
  it("keeps incomplete and unscheduled intervals planned", () => {
    for (const range of [
      {},
      { start: "2030-01-07" },
      { end: "2030-01-09" },
      { start: "2030-01-09", end: "2030-01-07" },
    ])
      expect(dateStatus(range, "2030-01-10")).toBe("todo");
  });
  it("keeps incomplete aggregate windows planned even when their known work has ended", () => {
    expect(
      dateStatus(
        { start: "2030-01-07", end: "2030-01-07", reason: "Not scheduled" },
        "2030-01-08",
      ),
    ).toBe("todo");
  });
  it("keeps single-day work in progress through its entire scheduled day", () => {
    const range = { start: "2030-01-07", end: "2030-01-07" };
    expect(dateStatus(range, "2030-01-06")).toBe("todo");
    expect(dateStatus(range, "2030-01-07")).toBe("doing");
    expect(dateStatus(range, "2030-01-08")).toBe("done");
  });
  it("uses each task's interval independently of the feature interval", () => {
    expect(
      dateStatus({ start: "2030-01-07", end: "2030-01-07" }, "2030-01-08"),
    ).toBe("done");
    expect(
      dateStatus({ start: "2030-01-09", end: "2030-01-09" }, "2030-01-08"),
    ).toBe("todo");
    expect(
      dateStatus({ start: "2030-01-07", end: "2030-01-09" }, "2030-01-08"),
    ).toBe("doing");
  });
});

describe("compatibility migration adds only missing anchors", () => {
  it("preserves all original fields and historical flags without mutating input", () => {
    const original = maintenanceFixture();
    delete original.features[0].planningFrom;
    original.features[1].planningFrom = "2030-01-02";
    Object.assign(original.features[0], {
      status: "blocked",
      unblockDate: "2030-02-01",
    });
    const before = structuredClone(original);
    const migrated = enableAutomaticPlanning(original, "2030-01-07");
    expect(original).toEqual(before);
    expect(migrated).toEqual({
      ...before,
      features: before.features.map((f) => ({
        ...f,
        planningFrom: f.planningFrom ?? "2030-01-07",
      })),
    });
    expect(enableAutomaticPlanning(migrated, "2030-02-01")).toEqual(migrated);
  });
});
