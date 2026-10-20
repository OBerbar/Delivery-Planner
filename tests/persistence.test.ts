import { describe, it, expect } from "vitest";
import { createStore } from "../server/store";
import { emptyState } from "../src/lib/model";
import { createServer } from "../server/app";

describe("local persistence", () => {
  it("saves and reloads with revision checks", () => {
    const store = createStore(":memory:");
    expect(store.read().revision).toBe(0);
    const state = {
      ...emptyState,
      people: [{ id: "p", name: "Alex", dailyHours: 8 }],
    };
    store.save(state, 0);
    expect(store.read().state.people[0].name).toBe("Alex");
    expect(() => store.save(emptyState, 0)).toThrow(/changed/i);
    store.close();
  });
  it("rejects invalid imported state without changing saved data", () => {
    const store = createStore(":memory:");
    expect(() => store.save({ ...emptyState, version: 2 } as any, 0)).toThrow();
    expect(store.read().revision).toBe(0);
    store.close();
  });
  it("checks origin and rejects stale updates over HTTP", async () => {
    const store = createStore(":memory:");
    const app = createServer(store);
    const get = await app.inject({ method: "GET", url: "/api/state" });
    expect(get.statusCode).toBe(200);
    const bad = await app.inject({
      method: "PUT",
      url: "/api/state",
      headers: { origin: "https://other.example" },
      payload: { state: emptyState, revision: 0 },
    });
    expect(bad.statusCode).toBe(403);
    const good = await app.inject({
      method: "PUT",
      url: "/api/state",
      payload: { state: emptyState, revision: 0 },
    });
    expect(good.statusCode).toBe(200);
    const stale = await app.inject({
      method: "PUT",
      url: "/api/state",
      payload: { state: emptyState, revision: 0 },
    });
    expect(stale.statusCode).toBe(409);
    await app.close();
    store.close();
  });
});
