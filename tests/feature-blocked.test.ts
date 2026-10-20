import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { maintenanceFixture } from "../scripts/maintenance-fixture";
import { stateSchema } from "../src/lib/model";
import { dateStatus, featureStatus } from "../src/lib/date-status";
import { schedule } from "../src/lib/planning";
import { createStore } from "../server/store";
import { createServer } from "../server/app";
import { verifiedSave } from "../src/lib/verified-save";
import { STORAGE_SCHEMA_VERSION } from "../src/lib/runtime-version";
import { timelinePrintPages } from "../src/lib/timeline-print-layout";
import { timelinePrintDocument } from "../src/lib/timeline-print-document";

describe("explicit feature blocked metadata", () => {
  it("preserves the flag while older records remain unblocked and invalid flags reject", () => {
    const state = maintenanceFixture();
    const old = stateSchema.parse(state);
    expect(old.features[0].blocked).toBeUndefined();
    state.features[0].blocked = true;
    expect(stateSchema.parse(state).features[0].blocked).toBe(true);
    state.features[0].blocked = false;
    expect(stateSchema.parse(state).features[0].blocked).toBe(false);
    expect(() =>
      stateSchema.parse({
        ...state,
        features: [{ ...state.features[0], blocked: "true" }],
      }),
    ).toThrow();
  });

  it("overrides every date status until explicitly cleared without activating legacy flags", () => {
    const feature = maintenanceFixture().features[0];
    const range = { start: "2030-01-07", end: "2030-01-09" };
    for (const now of ["2030-01-06", "2030-01-08", "2030-01-10"]) {
      expect(featureStatus({ ...feature, blocked: true }, range, now)).toBe(
        "blocked",
      );
      expect(featureStatus({ ...feature, blocked: false }, range, now)).toBe(
        dateStatus(range, now),
      );
      expect(featureStatus({ ...feature, status: "blocked" }, range, now)).toBe(
        dateStatus(range, now),
      );
    }
    expect(featureStatus({ ...feature, blocked: true }, {}, "2030-01-10")).toBe(
      "blocked",
    );
  });

  it("leaves all schedule bookings, remaining effort, dependency forecasts and commitments unchanged", () => {
    const state = maintenanceFixture();
    const before = structuredClone(state);
    const forecast = schedule(state, "2030-01-06");
    const blocked = structuredClone(state);
    blocked.features.forEach((feature) => {
      feature.blocked = true;
    });
    expect(schedule(blocked, "2030-01-06")).toEqual(forecast);
    expect(
      blocked.features.map(({ blocked: _blocked, ...feature }) => feature),
    ).toEqual(before.features);
    expect(state).toEqual(before);
  });

  it("retains blocked and unblocked flags across SQLite close and reopen", () => {
    const dir = mkdtempSync(join(tmpdir(), "planner-blocked-"));
    const path = join(dir, "planner.sqlite");
    let store = createStore(path);
    try {
      const state = maintenanceFixture();
      state.features[0].blocked = true;
      state.features[1].blocked = false;
      const saved = store.save(state, 0);
      store.close();
      store = createStore(path);
      expect(store.read()).toEqual(saved);
      expect(store.read().state.features[0].blocked).toBe(true);
      expect(store.read().state.features[1].blocked).toBe(false);
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("API round trips the flag and rejects invalid flags without advancing revision", async () => {
    const store = createStore(":memory:");
    const app = createServer(store);
    try {
      const state = maintenanceFixture();
      state.features[0].blocked = true;
      const saved = await app.inject({
        method: "PUT",
        url: "/api/state",
        payload: { state, revision: 0 },
      });
      expect(saved.statusCode).toBe(200);
      expect(saved.json().state.features[0].blocked).toBe(true);
      const invalid = structuredClone(state) as any;
      invalid.features[0].blocked = "yes";
      expect(
        (
          await app.inject({
            method: "PUT",
            url: "/api/state",
            payload: { state: invalid, revision: 1 },
          })
        ).statusCode,
      ).toBe(400);
      expect(store.read()).toEqual(saved.json());
    } finally {
      await app.close();
      store.close();
    }
  });

  it("verified save rejects a server stripping the flag and an older runtime before sending", async () => {
    const state = maintenanceFixture();
    state.features[0].blocked = true;
    const stripped = structuredClone(state);
    delete stripped.features[0].blocked;
    const requests: string[] = [];
    const fetcher = async (url: string) => {
      requests.push(url);
      return new Response(
        JSON.stringify(
          url.endsWith("health")
            ? { schemaVersion: STORAGE_SCHEMA_VERSION }
            : { state: stripped, revision: 1 },
        ),
      );
    };
    await expect(verifiedSave(state, 0, fetcher)).rejects.toThrow(/verified/i);
    expect(requests).toEqual(["/api/health", "/api/state"]);
    requests.length = 0;
    await expect(
      verifiedSave(state, 0, async (url) => {
        requests.push(url);
        return new Response(JSON.stringify({ schemaVersion: 4 }));
      }),
    ).rejects.toThrow(/restart/i);
    expect(requests).toEqual(["/api/health"]);
  });

  it("PDF feature and person views retain dates and render blocked color and text", () => {
    const state = maintenanceFixture();
    state.features[0].blocked = true;
    const before = structuredClone(state);
    const forecast = schedule(state, "2030-01-06");
    const pages = timelinePrintPages(
      state,
      "a",
      forecast,
      "2030-01-06",
      "2030-03-05",
    );
    for (const view of ["features", "people"]) {
      const page = pages.find((p) => p.view === view)!;
      const bars = page.rows
        .flatMap((r) => r.bars)
        .filter((b) => b.feature.id === state.features[0].id);
      expect(bars.length).toBeGreaterThan(0);
      expect(bars.every((b) => b.color === "#ad3045")).toBe(true);
      const html = timelinePrintDocument(state, "a", [page]);
      expect(html).toContain("#ad3045");
      expect(html).toContain("Blocked");
    }
    expect(state).toEqual(before);
  });
});
