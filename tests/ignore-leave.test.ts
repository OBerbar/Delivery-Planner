import { describe, expect, it } from "vitest";
import { maintenanceFixture } from "../scripts/maintenance-fixture";
import { schedule, generatePlan } from "../src/lib/planning";
import { explainDelay } from "../src/lib/delay-explanation";
import { stateSchema, reservationId } from "../src/lib/model";
import { featureLeaveDays } from "../src/lib/feature-leave";
import { createStore } from "../server/store";
import { createServer } from "../server/app";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifiedSave } from "../src/lib/verified-save";
import { STORAGE_SCHEMA_VERSION } from "../src/lib/runtime-version";
import {
  beginExperiment,
  changeExperiment,
  undoExperiment,
} from "../src/lib/what-if";

function fixture() {
  const state = maintenanceFixture();
  state.features = [state.features[0]];
  state.features[0].estimateEffort = [{ personId: "p", hours: 16 }];
  state.features[0].sprintEstimate = 0.5;
  return state;
}

describe("feature ignores personal leave", () => {
  it("attributes contention during leave without reporting ignored leave as a delay", () => {
    const state = fixture();
    const first = state.features[0];
    first.ignoreLeave = true;
    state.features.push({
      ...structuredClone(first),
      id: "later",
      title: "Later work",
      priority: 1,
      commitment: { end: "2030-01-07", acceptedAt: "2030-01-06" },
    });
    state.leaves = [
      {
        id: "l",
        personId: "p",
        start: "2030-01-07",
        end: "2030-01-31",
        hours: null,
        note: "Away",
      },
    ];
    state.holidays = [
      { id: "h", appId: "a", date: "2030-01-09", name: "Holiday" },
    ];
    const forecast = schedule(state, "2030-01-06");
    expect(forecast.features.later.end).toBe("2030-01-11");
    const explanation = explainDelay(state, "later", forecast, "2030-01-06")!;
    expect(explanation.people[0].competingWork).toEqual([
      expect.objectContaining({
        featureId: "long",
        hours: 16,
        dates: ["2030-01-07", "2030-01-08"],
      }),
    ]);
    expect(explanation.people[0].calendar.map((c) => c.kind)).not.toContain(
      "leave",
    );
    expect(explanation.people[0].calendar).toContainEqual(
      expect.objectContaining({ kind: "holiday", dates: ["2030-01-09"] }),
    );
    const text = generatePlan(state, state.sprints[0], forecast);
    expect(text).toContain("Ignores personal leave.");
    expect(text).toContain("Away");
  });

  it("shares parallel allocation with ordinary leave-aware work without inventing hours", () => {
    for (const ignoreParallelLeave of [false, true]) {
      const state = fixture();
      state.features[0].estimateEffort![0].hours = 8;
      state.features.push({
        ...structuredClone(state.features[0]),
        id: "parallel",
        priority: 1,
        doesntAffectOtherWork: true,
        ignoreLeave: ignoreParallelLeave,
      });
      state.leaves = [
        {
          id: "l",
          personId: "p",
          start: "2030-01-07",
          end: "2030-01-07",
          hours: 4,
          note: "Half day",
        },
      ];
      const forecast = schedule(state, "2030-01-06");
      const booked = Object.values(forecast.tasks).flatMap((t) => t.days);
      expect(
        booked
          .filter((d) => d.date === "2030-01-07")
          .reduce((n, d) => n + d.hours, 0),
      ).toBe(ignoreParallelLeave ? 8 : 4);
      expect(
        forecast.tasks[reservationId("parallel", "p")].days.reduce(
          (n, d) => n + d.hours,
          0,
        ),
      ).toBe(8);
      expect(forecast.features.long.capacityReassignedHours).toBe(4);
      expect(forecast.features.long.end).toBe("2030-01-08");
    }
  });
  it("persists through SQLite reopen and backup parsing", () => {
    const dir = mkdtempSync(join(tmpdir(), "planner-ignore-leave-"));
    const path = join(dir, "planner.sqlite");
    let store = createStore(path);
    try {
      const state = fixture();
      state.features[0].ignoreLeave = true;
      const saved = store.save(state, 0);
      store.close();
      store = createStore(path);
      expect(store.read()).toEqual(saved);
      expect(
        stateSchema.parse(JSON.parse(JSON.stringify(store.read().state)))
          .features[0].ignoreLeave,
      ).toBe(true);
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("blocks an older server before writing and rejects a returned state that drops the option", async () => {
    const state = fixture();
    state.features[0].ignoreLeave = true;
    const requests: string[] = [];
    await expect(
      verifiedSave(state, 0, async (url) => {
        requests.push(url);
        return new Response(
          JSON.stringify({ schemaVersion: STORAGE_SCHEMA_VERSION - 1 }),
        );
      }),
    ).rejects.toThrow(/restart/i);
    expect(requests).toEqual(["/api/health"]);
    await expect(
      verifiedSave(state, 0, async (url) => {
        const stripped = structuredClone(state);
        delete stripped.features[0].ignoreLeave;
        return new Response(
          JSON.stringify(
            url.endsWith("health")
              ? { schemaVersion: STORAGE_SCHEMA_VERSION }
              : { state: stripped, revision: 1 },
          ),
        );
      }),
    ).rejects.toThrow(/verified/i);
  });

  it("keeps the setting temporary in What-if and restores it on experimental Undo", () => {
    const state = fixture();
    const session = beginExperiment(state, 1);
    const next = structuredClone(state);
    next.features[0].ignoreLeave = true;
    const changed = changeExperiment(session, next);
    expect(changed.draft.features[0].ignoreLeave).toBe(true);
    expect(changed.base).toEqual(state);
    expect(undoExperiment(changed).draft).toEqual(state);
  });
  for (const hours of [null, 4]) {
    it(`ignores ${hours === null ? "full" : "partial"} leave only when checked, retaining scope and commitments`, () => {
      const state = fixture();
      const original = structuredClone(state);
      state.leaves = [
        {
          id: "l",
          personId: "p",
          start: "2030-01-07",
          end: "2030-01-08",
          hours,
          note: "Away",
        },
      ];
      expect(schedule(state, "2030-01-06").features.long.end).toBe(
        hours === null ? "2030-01-10" : "2030-01-09",
      );
      state.features[0].ignoreLeave = true;
      const forecast = schedule(state, "2030-01-06");
      expect(forecast.features.long.end).toBe("2030-01-08");
      expect(forecast.tasks).toEqual(schedule(original, "2030-01-06").tasks);
      expect(
        featureLeaveDays(
          state,
          state.features[0],
          forecast,
          "2030-01-07",
          "2030-01-10",
        ),
      ).toEqual([]);
      expect(state.features[0].estimateEffort).toEqual(
        original.features[0].estimateEffort,
      );
      expect(state.features[0].commitment).toEqual(
        original.features[0].commitment,
      );
      expect(state.sprints).toEqual(original.sprints);
      state.features[0].ignoreLeave = false;
      expect(schedule(state, "2030-01-06").features.long.end).toBe(
        hours === null ? "2030-01-10" : "2030-01-09",
      );
    });
  }

  it("honors weekends, holidays, allocation and task dependencies including parallel work", () => {
    for (const parallel of [false, true]) {
      const state = fixture();
      Object.assign(state.features[0], {
        ignoreLeave: true,
        doesntAffectOtherWork: parallel,
        tasks: [
          {
            id: "t1",
            title: "First",
            personId: "p",
            scope: "Backend",
            hours: 8,
            status: "todo",
            dependsOn: [],
          },
          {
            id: "t2",
            title: "Next",
            personId: "p",
            scope: "Backend",
            hours: 8,
            status: "todo",
            dependsOn: ["t1"],
          },
        ],
      });
      state.members[0].allocation = 50;
      state.features[0].notBefore = "2030-01-11";
      state.holidays = [
        { id: "h", appId: "a", date: "2030-01-14", name: "Holiday" },
      ];
      state.leaves = [
        {
          id: "l",
          personId: "p",
          start: "2030-01-01",
          end: "2030-01-31",
          hours: null,
          note: "Away",
        },
      ];
      const forecast = schedule(state, "2030-01-06");
      expect(forecast.tasks.t1.days).toEqual([
        { date: "2030-01-11", hours: 4 },
        { date: "2030-01-15", hours: 4 },
      ]);
      expect(forecast.tasks.t2.days).toEqual([
        { date: "2030-01-16", hours: 4 },
        { date: "2030-01-17", hours: 4 },
      ]);
    }
  });

  it("keeps competing bookings shared across apps and ordinary features leave-aware", () => {
    const state = fixture();
    state.apps.push({ ...state.apps[0], id: "b" });
    state.members.push({ ...state.members[0], id: "mb", appId: "b" });
    state.features.push({
      ...structuredClone(state.features[0]),
      id: "other",
      appId: "b",
      priority: 1,
      ignoreLeave: true,
    });
    state.features[0].ignoreLeave = true;
    state.leaves = [
      {
        id: "l",
        personId: "p",
        start: "2030-01-07",
        end: "2030-01-31",
        hours: null,
        note: "Away",
      },
    ];
    let forecast = schedule(state, "2030-01-06");
    expect(forecast.features.other.start).toBe("2030-01-09");
    expect(forecast.features.other.end).toBe("2030-01-10");
    state.features[1].ignoreLeave = false;
    forecast = schedule(state, "2030-01-06");
    expect(forecast.features.other.start).toBe("2030-02-01");
    expect(forecast.features.long.end).toBe("2030-01-08");
  });

  it("accepts older backups, preserves both flag values and rejects invalid flags through the API", async () => {
    const state = fixture();
    expect(stateSchema.parse(state).features[0].ignoreLeave).toBeUndefined();
    const store = createStore(":memory:");
    const app = createServer(store);
    try {
      for (const [revision, ignoreLeave] of [true, false].entries()) {
        state.features[0].ignoreLeave = ignoreLeave;
        const saved = await app.inject({
          method: "PUT",
          url: "/api/state",
          payload: { state, revision },
        });
        expect(saved.statusCode).toBe(200);
        expect(saved.json().state.features[0].ignoreLeave).toBe(ignoreLeave);
      }
      const saved = store.read();
      const invalid = structuredClone(state) as any;
      invalid.features[0].ignoreLeave = "yes";
      expect(
        (
          await app.inject({
            method: "PUT",
            url: "/api/state",
            payload: { state: invalid, revision: 2 },
          })
        ).statusCode,
      ).toBe(400);
      expect(store.read()).toEqual(saved);
    } finally {
      await app.close();
      store.close();
    }
  });
});
