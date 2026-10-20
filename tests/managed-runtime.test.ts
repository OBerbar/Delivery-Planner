import { afterEach, describe, expect, it } from "vitest";
import { createStore } from "../server/store";
import { createServer } from "../server/app";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
function setup(managed = true) {
  const store = createStore(":memory:");
  let quitCount = 0;
  const app = createServer(
    store,
    managed
      ? {
          instanceId: "example-instance",
          quitToken: "example-quit-token",
          onQuit: async () => {
            quitCount++;
          },
        }
      : undefined,
  );
  cleanups.push(async () => {
    await app.close();
    store.close();
  });
  return { app, quits: () => quitCount };
}
describe("managed local runtime", () => {
  it("advertises the managed identity without changing saved workspace state", async () => {
    const { app } = setup();
    const before = (await app.inject({ url: "/api/state" })).json();
    const health = (await app.inject({ url: "/api/health" })).json();
    expect(health).toMatchObject({
      application: "delivery-studio",
      instanceId: "example-instance",
    });
    expect((await app.inject({ url: "/api/runtime" })).json()).toEqual({
      managed: true,
      quitToken: "example-quit-token",
    });
    expect((await app.inject({ url: "/api/state" })).json()).toEqual(before);
  });
  it("rejects an unknown origin or quit token and quits only on explicit authorization", async () => {
    const { app, quits } = setup();
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/quit",
          headers: {
            origin: "https://example.com",
            "x-delivery-studio-token": "example-quit-token",
          },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/quit",
          headers: { "x-delivery-studio-token": "wrong" },
        })
      ).statusCode,
    ).toBe(403);
    expect(quits()).toBe(0);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/quit",
          headers: { "x-delivery-studio-token": "example-quit-token" },
        })
      ).statusCode,
    ).toBe(200);
    await new Promise((resolve) => setImmediate(resolve));
    expect(quits()).toBe(1);
  });
  it("leaves runtime quit unavailable in the source edition", async () => {
    const { app } = setup(false);
    expect((await app.inject({ url: "/api/runtime" })).json()).toEqual({
      managed: false,
    });
    expect(
      (await app.inject({ method: "POST", url: "/api/quit" })).statusCode,
    ).toBe(404);
  });
  it("accepts its dynamically bound loopback origin and rejects remote hosts", async () => {
    const { app } = setup();
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    if (!address || typeof address === "string")
      throw new Error("Expected a bound TCP address");
    const url = `http://127.0.0.1:${address.port}`;
    expect(
      (await fetch(url + "/api/state", { headers: { origin: url } })).status,
    ).toBe(200);
    expect(
      (
        await app.inject({
          url: "/api/state",
          headers: { host: "example.com" },
        })
      ).statusCode,
    ).toBe(403);
  });
});

it("acknowledges a quit request without falsely claiming a failed shutdown completed", async () => {
  const store = createStore(":memory:");
  const app = createServer(store, {
    instanceId: "failed",
    quitToken: "failed-token",
    onQuit: async () => {
      throw new Error("synthetic shutdown failure");
    },
  });
  cleanups.push(async () => {
    await app.close();
    store.close();
  });
  const response = await app.inject({
    method: "POST",
    url: "/api/quit",
    headers: { "x-delivery-studio-token": "failed-token" },
  });
  expect(response.json()).toEqual({ stopping: true });
  await new Promise((done) => setImmediate(done));
  expect((await app.inject({ url: "/api/health" })).statusCode).toBe(200);
});
