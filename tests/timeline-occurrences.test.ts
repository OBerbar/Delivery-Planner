import { expect, it } from "vitest";
import { occurrencesFixture } from "./occurrences-fixture";
import { schedule } from "../src/lib/planning";
import { featureTimelineRows } from "../src/lib/timeline-occurrences";
import { timelinePrintPages } from "../src/lib/timeline-print-layout";

function repeatedState() {
  const state = occurrencesFixture();
  const first = { ...state.features[0], occurrenceGroupId: "retesting" };
  state.features = [
    first,
    { ...structuredClone(first), id: "second", sprintId: "s2", priority: 1 },
    { ...structuredClone(first), id: "third", sprintId: "s3", priority: 2 },
  ];
  return state;
}
it("renders independent forecasts as three bars on one row with empty gaps", () => {
  const state = repeatedState();
  const forecast = schedule(state, "2030-01-06");
  const rows = featureTimelineRows(
    state,
    state.features,
    forecast,
    "2030-01-06",
    "2030-03-06",
    20,
  );
  expect(rows).toHaveLength(1);
  expect(
    rows[0].bars.map((b) => [b.forecast.start, b.forecast.end, b.lane]),
  ).toEqual([
    ["2030-01-07", "2030-01-08", 0],
    ["2030-01-21", "2030-01-22", 0],
    ["2030-02-04", "2030-02-05", 0],
  ]);
  expect(rows[0].sub).toContain("3 occurrences");
});
it("uses multiple lanes inside the same row when runs overlap", () => {
  const state = repeatedState();
  state.features[1].sprintId = "s";
  state.features[1].assigneeIds = ["q"];
  state.features[1].assigneeEstimates = [
    { personId: "q", unit: "days", value: 2 },
  ];
  state.features[1].estimateEffort = [{ personId: "q", hours: 16 }];
  const rows = featureTimelineRows(
    state,
    state.features,
    schedule(state, "2030-01-06"),
    "2030-01-06",
    "2030-03-06",
    20,
  );
  expect(rows).toHaveLength(1);
  expect(rows[0].bars[0].lane).not.toBe(rows[0].bars[1].lane);
  expect(rows[0].height).toBeGreaterThan(72);
});
it("groups feature PDF bars while preserving each occurrence booking", () => {
  const state = repeatedState();
  const pages = timelinePrintPages(
    state,
    "a",
    schedule(state, "2030-01-06"),
    "2030-01-06",
    "2030-03-05",
    "features",
  );
  expect(pages[0].rows).toHaveLength(1);
  expect(pages[0].rows[0].bars).toHaveLength(3);
});
