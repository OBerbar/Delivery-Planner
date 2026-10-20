import { afterEach, describe, expect, it } from "vitest";
import { createStore, type Store } from "../server/store";
import { createServer } from "../server/app";
import { maintenanceFixture } from "../scripts/maintenance-fixture";
import { stateSchema } from "../src/lib/model";
import { schedule } from "../src/lib/planning";
import { loadPlanner } from "../src/lib/load-planner";

const stores: Store[] = [];
afterEach(() => stores.splice(0).forEach((store) => store.close()));

function workspace() {
  const original = maintenanceFixture();
  original.features = [original.features[0]];
  delete original.features[0].planningFrom;
  original.features[0].estimateEffort = [{ personId: "p", hours: 8 }];
  const state = stateSchema.parse(original);
  const store = createStore(":memory:");
  stores.push(store);
  store.save(state, 0);
  const server = createServer(store);
  const requests: string[] = [];
  const fetcher = async (url: string, init?: RequestInit) => {
    requests.push(`${init?.method ?? "GET"} ${url}`);
    const response = await server.inject({
      method: init?.method === "PUT" ? "PUT" : "GET",
      url,
      ...(init?.body ? { payload: JSON.parse(String(init.body)) } : {}),
    });
    return new Response(response.body, {
      status: response.statusCode,
      headers: { "Content-Type": "application/json" },
    });
  };
  return { state, store, server, requests, fetcher };
}

describe("first-load automatic planning migration", () => {
  it("adds missing anchors while preserving older anchors and every other field", async () => {
    const { state, store, server, fetcher } = workspace();
    state.features.push({
      ...state.features[0],
      id: "already-anchored",
      planningFrom: "2030-01-02",
      priority: 1,
    });
    store.save(state, 1);
    try {
      const load = await loadPlanner("2030-01-07", fetcher);
      expect(load).toEqual({
        revision: 3,
        state: {
          ...state,
          features: [
            { ...state.features[0], planningFrom: "2030-01-07" },
            state.features[1],
          ],
        },
      });
      expect(store.read()).toEqual(load);
    } finally {
      await server.close();
    }
  });
  it("persists only missing anchors before returning and does not reset dates on an unsaved next-day reload", async () => {
    const { state, store, server, fetcher, requests } = workspace();
    try {
      const first = await loadPlanner("2030-01-07", fetcher);
      expect(first.revision).toBe(2);
      expect(first.state).toEqual({
        ...state,
        features: [{ ...state.features[0], planningFrom: "2030-01-07" }],
      });
      expect(store.read()).toEqual(first);
      const nextDay = await loadPlanner("2030-01-08", fetcher);
      expect(nextDay).toEqual(first);
      expect(schedule(nextDay.state, "2030-01-08").features.long).toMatchObject(
        { start: "2030-01-07", end: "2030-01-07", done: true },
      );
      expect(requests).toEqual([
        "GET /api/state",
        "GET /api/health",
        "PUT /api/state",
        "GET /api/state",
      ]);
    } finally {
      await server.close();
    }
  });

  it("refetches on a migration conflict, preserving the winning edit before retrying", async () => {
    const { state, store, server, fetcher } = workspace();
    let raced = false;
    try {
      const load = await loadPlanner("2030-01-07", async (url, init) => {
        if (init?.method === "PUT" && !raced) {
          raced = true;
          const winning = structuredClone(state);
          winning.features[0].title = "A newer edit";
          store.save(winning, 1);
        }
        return fetcher(url, init);
      });
      expect(load.revision).toBe(3);
      expect(load.state.features[0]).toMatchObject({
        title: "A newer edit",
        planningFrom: "2030-01-07",
      });
      expect(store.read()).toEqual(load);
    } finally {
      await server.close();
    }
  });

  it("keeps existing anchors when concurrent migration wins", async () => {
    const { state, store, server, fetcher, requests } = workspace();
    let raced = false;
    try {
      const load = await loadPlanner("2030-01-08", async (url, init) => {
        if (init?.method === "PUT" && !raced) {
          raced = true;
          const winning = structuredClone(state);
          winning.features[0].planningFrom = "2030-01-07";
          store.save(winning, 1);
        }
        return fetcher(url, init);
      });
      expect(load.revision).toBe(2);
      expect(load.state.features[0].planningFrom).toBe("2030-01-07");
      expect(
        requests.filter((request) => request.startsWith("PUT")),
      ).toHaveLength(1);
    } finally {
      await server.close();
    }
  });

  it("blocks migration against an old running server without writing or hiding the restart error", async () => {
    const { state, store, server, fetcher, requests } = workspace();
    try {
      await expect(
        loadPlanner("2030-01-07", (url, init) =>
          url === "/api/health"
            ? Promise.resolve(
                new Response(JSON.stringify({ schemaVersion: -1 })),
              )
            : fetcher(url, init),
        ),
      ).rejects.toThrow(/Restart Delivery Studio/);
      expect(store.read()).toEqual({ revision: 1, state });
      expect(requests).toEqual(["GET /api/state"]);
    } finally {
      await server.close();
    }
  });

  it("does not repeat permanent save failures", async () => {
    const { store, server, fetcher } = workspace();
    let puts = 0;
    try {
      await expect(
        loadPlanner("2030-01-07", async (url, init) => {
          if (init?.method === "PUT") {
            puts++;
            return new Response(JSON.stringify({ error: "Disk unavailable" }), {
              status: 500,
            });
          }
          return fetcher(url, init);
        }),
      ).rejects.toThrow("Disk unavailable");
      expect(puts).toBe(1);
      expect(store.read().revision).toBe(1);
    } finally {
      await server.close();
    }
  });
  it("stops after repeated revision conflicts without overwriting winning records", async () => {
    const { store, server, fetcher } = workspace();
    let puts = 0;
    try {
      await expect(
        loadPlanner("2030-01-07", async (url, init) => {
          if (init?.method === "PUT") {
            puts++;
            const winning = store.read();
            winning.state.features[0].title = `Winning edit ${puts}`;
            store.save(winning.state, winning.revision);
          }
          return fetcher(url, init);
        }),
      ).rejects.toThrow(/another tab/);
      expect(puts).toBe(3);
      expect(store.read().state.features[0]).toMatchObject({
        title: "Winning edit 3",
      });
      expect(store.read().state.features[0].planningFrom).toBeUndefined();
    } finally {
      await server.close();
    }
  });
});
