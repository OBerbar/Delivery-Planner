import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { maintenanceFixture, fixedToday } from "../scripts/maintenance-fixture";
import { schedule, resources, generatePlan } from "../src/lib/planning";
import { stateSchema, reservationId } from "../src/lib/model";
import { applyFeatureChanges } from "../src/lib/changes";
import { createOccurrence } from "../src/lib/occurrences";
import { reconcileCommitments } from "../src/lib/commitments";
import { peopleTimelineRows } from "../src/lib/timeline-people";
import {
  beginExperiment,
  changeExperiment,
  compareExperiment,
} from "../src/lib/what-if";
import { createStore } from "../server/store";
import { timelinePrintPages } from "../src/lib/timeline-print-layout";

function fixture() {
  const state = maintenanceFixture();
  state.features[0].estimateEffort = [{ personId: "p", hours: 16 }];
  return state;
}

describe("feature backlog", () => {
  it("treats an explicit timeline placement as equivalent to legacy missing placement in What-if", () => {
    const state = fixture();
    const draft = structuredClone(state);
    draft.features[0].placement = "timeline";
    const experiment = changeExperiment(beginExperiment(state, 1), draft);
    expect(compareExperiment(experiment, fixedToday).features).toEqual([]);
  });
  it("releases bookings and advances competing work without changing saved feature data", () => {
    const state = fixture();
    const original = structuredClone(state);
    const before = schedule(state, fixedToday);
    Object.assign(state.features[0], { placement: "backlog" });
    const after = schedule(state, fixedToday);
    expect(after.features.long.start).toBeUndefined();
    expect(after.features.long.end).toBeUndefined();
    expect(after.tasks[reservationId("long", "p")].days).toEqual([]);
    expect(after.features.mixed.start).toBe("2030-01-07");
    expect(after.features.mixed.end! < before.features.mixed.end!).toBe(true);
    expect(state.features[0]).toEqual({
      ...original.features[0],
      placement: "backlog",
    });
    Object.assign(state.features[0], { placement: "timeline" });
    expect(schedule(state, fixedToday)).toEqual(before);
    expect(state.sprints).toEqual(original.sprints);
  });

  it("keeps dependency links and explicitly waits for backlog work, including completed legacy tasks", () => {
    for (const completed of [false, true]) {
      const state = fixture();
      Object.assign(state.features[0], { placement: "backlog" });
      state.features[0].tasks = [
        {
          id: "source",
          title: "Source",
          personId: "p",
          scope: "Backend",
          hours: 8,
          dependsOn: [],
          status: completed ? "done" : "todo",
          ...(completed
            ? { actualStart: "2029-12-01", actualEnd: "2029-12-02" }
            : {}),
        },
      ];
      state.features[1].tasks = [
        {
          id: "dependent",
          title: "Dependent",
          personId: "q",
          scope: "Design",
          hours: 8,
          status: "todo",
          dependsOn: [],
          dependsOnFeatures: ["long"],
        },
      ];
      const forecast = schedule(state, fixedToday);
      expect(forecast.tasks.source.end).toBeUndefined();
      expect(forecast.tasks.dependent.end).toBeUndefined();
      expect(forecast.tasks.dependent.reason).toMatch(/backlog/i);
      expect(state.features[1].tasks[0].dependsOnFeatures).toEqual(["long"]);
    }
  });

  it("excludes backlog from sprint demand, generated plans and person timeline rows", () => {
    const state = fixture();
    Object.assign(state.features[0], { placement: "backlog" });
    const forecast = schedule(state, fixedToday);
    expect(resources(state, state.sprints[0], forecast)).toEqual([]);
    expect(generatePlan(state, state.sprints[0], forecast)).not.toContain(
      state.features[0].title,
    );
    const rows = peopleTimelineRows(
      state,
      "a",
      forecast,
      "2030-01-01",
      "2030-02-28",
      24,
    );
    expect(
      rows.flatMap((r) => r.bars).some((b) => b.feature.id === "long"),
    ).toBe(false);
    expect(forecast.features.long.commitmentDelayed).toBeFalsy();
    expect(forecast.features.long.hours).toBe(0);
    expect(
      JSON.stringify(
        timelinePrintPages(state, "a", forecast, "2030-01-01", "2030-02-28"),
      ),
    ).not.toContain(state.features[0].title);
  });

  it("moves every occurrence together while preserving each record", () => {
    const state = fixture();
    const repeat = createOccurrence(
      state,
      state.features[0],
      fixedToday,
      "repeat",
    );
    const grouped = applyFeatureChanges(state, [repeat]);
    const next = applyFeatureChanges(grouped, [
      Object.assign({ ...grouped.features[0] }, { placement: "backlog" }),
    ]);
    for (const feature of next.features.filter((f) => f.id !== "mixed")) {
      expect(feature).toEqual({
        ...grouped.features.find((f) => f.id === feature.id),
        placement: "backlog",
      });
    }
    expect(stateSchema.safeParse(next).success).toBe(true);
  });

  it("preserves legacy defaults and round-trips backlog and accepted dates through SQLite and backup parsing", () => {
    const state = fixture();
    expect(schedule(stateSchema.parse(state), fixedToday)).toEqual(
      schedule(state, fixedToday),
    );
    Object.assign(state.features[0], { placement: "backlog" });
    const parsed = stateSchema.parse(JSON.parse(JSON.stringify(state)));
    expect(parsed.features[0]).toMatchObject({
      placement: "backlog",
      commitment: state.features[0].commitment,
    });
    const directory = mkdtempSync(join(tmpdir(), "planner-backlog-"));
    let store = createStore(join(directory, "planner.sqlite"));
    try {
      store.save(parsed, 0);
      store.close();
      store = createStore(join(directory, "planner.sqlite"));
      expect(store.read()).toEqual({ state: parsed, revision: 1 });
    } finally {
      store.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("retains existing commitments while parked and defers new acceptance until on the timeline", () => {
    const before = fixture();
    const next = structuredClone(before);
    Object.assign(next.features[0], { placement: "backlog" });
    Object.assign(next.features[1], { placement: "backlog", committed: true });
    const parked = reconcileCommitments(before, next, fixedToday);
    expect(parked.features[0].commitment).toEqual(
      before.features[0].commitment,
    );
    expect(parked.features[1].commitment).toBeUndefined();
  });

  it("explains placement edits in What-if even when no date exists", () => {
    const state = fixture();
    Object.assign(state.features[0], { placement: "backlog" });
    let experiment = beginExperiment(state, 1);
    const draft = structuredClone(state);
    Object.assign(draft.features[0], { placement: "timeline" });
    experiment = changeExperiment(experiment, draft);
    expect(
      compareExperiment(experiment, fixedToday).features.find(
        (f) => f.id === "long",
      )?.reasons,
    ).toContain("Placement changed");
  });
});
