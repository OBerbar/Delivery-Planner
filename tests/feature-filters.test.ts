import { describe, it, expect } from "vitest";
import {
  emptyFeatureFilters,
  hasFeatureFilters,
  matchesFeatureFilters,
} from "../src/lib/feature-filters";
import { maintenanceFixture, fixedToday } from "../scripts/maintenance-fixture";
import { schedule } from "../src/lib/planning";

describe("shared planning filters", () => {
  it("matches any selected person and sprint, and combines categories", () => {
    const state = maintenanceFixture(),
      forecast = schedule(state, fixedToday);
    const filters = {
      ...emptyFeatureFilters(),
      person: ["q", "unrelated"],
      sprint: ["s", "unassigned"],
    };
    expect(
      state.features
        .filter((feature) =>
          matchesFeatureFilters(feature, filters, forecast, fixedToday),
        )
        .map((feature) => feature.id),
    ).toEqual(["mixed"]);
    expect(
      matchesFeatureFilters(
        state.features[0],
        { ...filters, person: ["p", "q"] },
        forecast,
        fixedToday,
      ),
    ).toBe(true);
    expect(
      matchesFeatureFilters(
        state.features[1],
        { ...filters, sprint: ["s"] },
        forecast,
        fixedToday,
      ),
    ).toBe(false);
  });
  it("combines automatic statuses with the saved Blocked override", () => {
    const state = maintenanceFixture(),
      forecast = schedule(state, fixedToday);
    state.features[0].blocked = true;
    const filters = { ...emptyFeatureFilters(), status: ["todo", "blocked"] };
    expect(
      state.features.every((feature) =>
        matchesFeatureFilters(feature, filters, forecast, fixedToday),
      ),
    ).toBe(true);
    expect(
      matchesFeatureFilters(
        state.features[0],
        { ...filters, status: ["todo"] },
        forecast,
        fixedToday,
      ),
    ).toBe(false);
  });
  it("supports multiple risk states without inventing an accepted date for legacy commitments", () => {
    const state = maintenanceFixture(),
      forecast = schedule(state, fixedToday);
    forecast.features.long.commitmentDelayed = true;
    const filters = {
      ...emptyFeatureFilters(),
      risk: ["at-risk", "unaccepted"],
    };
    expect(
      state.features.every((feature) =>
        matchesFeatureFilters(feature, filters, forecast, fixedToday),
      ),
    ).toBe(true);
    expect(
      matchesFeatureFilters(
        state.features[0],
        { ...filters, risk: ["on-track"] },
        forecast,
        fixedToday,
      ),
    ).toBe(false);
    delete state.features[0].commitment;
    expect(
      matchesFeatureFilters(
        state.features[0],
        { ...filters, risk: ["unaccepted"] },
        forecast,
        fixedToday,
      ),
    ).toBe(true);
  });
  it("treats empty categories as All and never changes records or forecasts", () => {
    const state = maintenanceFixture(),
      forecast = schedule(state, fixedToday);
    const before = structuredClone({ state, forecast });
    expect(hasFeatureFilters(emptyFeatureFilters())).toBe(false);
    expect(
      hasFeatureFilters({ ...emptyFeatureFilters(), status: ["done"] }),
    ).toBe(true);
    expect(
      state.features.every((feature) =>
        matchesFeatureFilters(
          feature,
          emptyFeatureFilters(),
          forecast,
          fixedToday,
        ),
      ),
    ).toBe(true);
    expect({ state, forecast }).toEqual(before);
  });
});
