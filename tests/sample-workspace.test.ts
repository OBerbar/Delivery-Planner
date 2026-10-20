import { describe, expect, it } from "vitest";
import {
  createSampleState,
  createSampleWorkspace,
} from "../src/lib/sample-workspace";
import { schedule } from "../src/lib/planning";

describe("fictional sample isolation", () => {
  it("shows three/seven-day parallel bookings and shares the designer without duplicating capacity", () => {
    const state = createSampleState("2026-10-19");
    const forecast = schedule(state, "2026-10-19");
    expect(forecast.features["sample-checkout"].end).toBe("2026-10-27");
    expect(forecast.features["sample-account"].end).toBe("2026-10-20");
    expect(forecast.features["sample-reporting"].start).toBe("2026-10-21");
    expect(forecast.features["sample-reporting"].end).toBe("2026-10-23");
    expect(state.sprints).toEqual([]);
    expect(state.leaves).toEqual([]);
  });
  it("keeps saves, restores and returned objects local to one sample visit", async () => {
    const one = createSampleWorkspace("2026-10-19");
    const two = createSampleWorkspace("2027-02-01");
    const initial = await one.load();
    initial.state.apps[0].name = "Changed sample";
    expect((await one.load()).state.apps[0].name).toBe("Northstar");
    await one.save(initial.state, 0);
    expect((await one.load()).state.apps[0].name).toBe("Changed sample");
    expect((await one.load()).revision).toBe(1);
    expect((await two.load()).state.apps[0].name).toBe("Northstar");
    expect((await two.load()).state.apps[0].planningStart).toBe("2027-02-01");
    await expect(one.save(initial.state, 0)).rejects.toThrow("sample changed");
    const invalid = structuredClone(initial.state);
    invalid.apps = [];
    await expect(one.save(invalid, 1)).rejects.toThrow();
    expect((await one.load()).revision).toBe(1);
  });
});
