import { describe, it, expect } from "vitest";
import { populatedFixture } from "../scripts/maintenance-fixture";
import { verifiedSave } from "../src/lib/verified-save";
import { STORAGE_SCHEMA_VERSION } from "../src/lib/runtime-version";
function network(health: unknown, result: unknown, status = 200) {
  const requests: string[] = [];
  const fetcher = async (url: string, init?: RequestInit) => {
    requests.push(`${init?.method ?? "GET"} ${url}`);
    return new Response(
      JSON.stringify(url.endsWith("health") ? health : result),
      {
        status: url.endsWith("health") ? 200 : status,
        headers: { "Content-Type": "application/json" },
      },
    );
  };
  return { fetcher, requests };
}
describe("verified save prevents silent loss of fields", () => {
  it("rejects an old running server before sending any changes", async () => {
    const n = network({ status: "ok" }, null);
    await expect(
      verifiedSave(populatedFixture(), 4, n.fetcher),
    ).rejects.toThrow(/restart/i);
    expect(n.requests).toEqual(["GET /api/health"]);
  });
  it("accepts an exact canonical save and one revision advance", async () => {
    const state = populatedFixture();
    state.features[0].doesntAffectOtherWork = true;
    const n = network(
      { status: "ok", schemaVersion: STORAGE_SCHEMA_VERSION },
      { state, revision: 5 },
    );
    expect(await verifiedSave(state, 4, n.fetcher)).toEqual({
      state,
      revision: 5,
    });
    expect(n.requests).toEqual(["GET /api/health", "PUT /api/state"]);
  });
  it("rejects a successful response that stripped the parallel option", async () => {
    const state = populatedFixture();
    state.features[0].doesntAffectOtherWork = true;
    const stripped = structuredClone(state);
    delete stripped.features[0].doesntAffectOtherWork;
    const n = network(
      { status: "ok", schemaVersion: STORAGE_SCHEMA_VERSION },
      { state: stripped, revision: 5 },
    );
    await expect(verifiedSave(state, 4, n.fetcher)).rejects.toThrow(
      /verified/i,
    );
  });
  it("rejects a server response that strips an automatic planning anchor", async () => {
    const state = populatedFixture();
    state.features[0].planningFrom = "2030-01-06";
    const stripped = structuredClone(state);
    delete stripped.features[0].planningFrom;
    const n = network(
      { status: "ok", schemaVersion: STORAGE_SCHEMA_VERSION },
      { state: stripped, revision: 5 },
    );
    await expect(verifiedSave(state, 4, n.fetcher)).rejects.toThrow(
      /verified/i,
    );
  });
  it("rejects malformed results or an unexpected revision", async () => {
    for (const result of [
      { revision: 4, state: populatedFixture() },
      { revision: 6, state: populatedFixture() },
      { revision: 5, state: {} },
      null,
    ]) {
      const n = network(
        { status: "ok", schemaVersion: STORAGE_SCHEMA_VERSION },
        result,
      );
      await expect(
        verifiedSave(populatedFixture(), 4, n.fetcher),
      ).rejects.toThrow(/verified/i);
    }
  });
  it("retains the server conflict explanation", async () => {
    const n = network(
      { status: "ok", schemaVersion: STORAGE_SCHEMA_VERSION },
      { error: "This workspace changed in another tab. Reload before saving." },
      409,
    );
    await expect(
      verifiedSave(populatedFixture(), 4, n.fetcher),
    ).rejects.toThrow(/another tab/);
  });
});
