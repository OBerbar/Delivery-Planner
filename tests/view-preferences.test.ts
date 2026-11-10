import { describe, expect, it } from "vitest";
import {
  defaultTimelinePreferences,
  readTimelinePreferences,
  writeTimelinePreferences,
  timelinePreferencesKey,
  type PreferenceStorage,
} from "../src/lib/view-preferences";

const today = "2030-01-06";
function memoryStorage(): PreferenceStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

describe("local timeline view preferences", () => {
  it("migrates legacy scalar filters and retains multiple valid selections", () => {
    const storage = memoryStorage();
    storage.setItem(
      timelinePreferencesKey("a"),
      JSON.stringify({
        version: 1,
        person: "p",
        sprint: "s",
        status: "blocked",
        risk: "at-risk",
      }),
    );
    expect(readTimelinePreferences("a", today, storage)).toMatchObject({
      person: ["p"],
      sprint: ["s"],
      status: ["blocked"],
      risk: ["at-risk"],
    });
    storage.setItem(
      timelinePreferencesKey("a"),
      JSON.stringify({
        version: 2,
        person: ["p", "q", "p", "gone"],
        sprint: ["s", "unassigned", "missing"],
        status: ["todo", "blocked", "unknown"],
        risk: ["at-risk", "unaccepted"],
      }),
    );
    expect(
      readTimelinePreferences("a", today, storage, {
        personIds: ["p", "q"],
        sprintIds: ["s"],
      }),
    ).toMatchObject({
      person: ["p", "q"],
      sprint: ["s", "unassigned"],
      status: ["todo", "blocked"],
      risk: ["at-risk", "unaccepted"],
    });
  });
  it("defaults to two months from today, features, month zoom, expanded absences and all work", () => {
    expect(readTimelinePreferences("a", today, memoryStorage())).toEqual({
      view: "features",
      zoom: "month",
      months: "2",
      start: today,
      availabilityCollapsed: false,
      person: [],
      sprint: [],
      status: [],
      risk: [],
    });
  });

  it("round trips every view setting separately per app without changing the supplied preferences", () => {
    const storage = memoryStorage();
    const preference = {
      ...defaultTimelinePreferences(today),
      view: "people" as const,
      zoom: "week" as const,
      months: "6" as const,
      start: "2030-02-02",
      availabilityCollapsed: true,
      person: ["q"],
      sprint: ["s"],
      status: ["doing"],
      risk: ["at-risk"],
    };
    const before = structuredClone(preference);
    expect(writeTimelinePreferences("a", preference, storage)).toBe(true);
    expect(readTimelinePreferences("a", today, storage)).toEqual(preference);
    expect(readTimelinePreferences("b", today, storage)).toEqual(
      defaultTimelinePreferences(today),
    );
    expect(preference).toEqual(before);
  });

  it("retains a saved Blocked filter along with other display preferences", () => {
    const storage = memoryStorage();
    storage.setItem(
      timelinePreferencesKey("a"),
      JSON.stringify({
        version: 1,
        status: "blocked",
        view: "people",
        zoom: "week",
      }),
    );
    expect(readTimelinePreferences("a", today, storage)).toEqual({
      ...defaultTimelinePreferences(today),
      status: ["blocked"],
      view: "people",
      zoom: "week",
    });
  });

  it("recovers valid fields and rejects invalid enums, calendar dates, ranges and identifier types", () => {
    const storage = memoryStorage();
    storage.setItem(
      timelinePreferencesKey("a"),
      JSON.stringify({
        version: 1,
        view: "people",
        zoom: "hour",
        months: "99",
        start: "2030-02-30",
        availabilityCollapsed: "yes",
        person: {},
        sprint: 3,
        status: "unexpected",
        risk: null,
      }),
    );
    expect(readTimelinePreferences("a", today, storage)).toEqual({
      ...defaultTimelinePreferences(today),
      view: "people",
    });
    storage.setItem(
      timelinePreferencesKey("a"),
      JSON.stringify({ version: 1, start: "2032-02-29", months: "1" }),
    );
    expect(readTimelinePreferences("a", today, storage).start).toBe(
      "2032-02-29",
    );
    storage.setItem(
      timelinePreferencesKey("a"),
      JSON.stringify({ version: 1, start: "1850-01-01" }),
    );
    expect(readTimelinePreferences("a", today, storage).start).toBe(
      "1850-01-01",
    );
  });

  it("ignores malformed JSON, nonobjects and unsupported versions", () => {
    const storage = memoryStorage();
    for (const raw of [
      "{broken",
      "null",
      "[]",
      '\"people\"',
      '{"version":3,"view":"people"}',
    ]) {
      storage.setItem(timelinePreferencesKey("a"), raw);
      expect(readTimelinePreferences("a", today, storage)).toEqual(
        defaultTimelinePreferences(today),
      );
    }
  });

  it("resets person and sprint filters whose saved records no longer belong to the app", () => {
    const storage = memoryStorage();
    writeTimelinePreferences(
      "a",
      {
        ...defaultTimelinePreferences(today),
        person: ["removed"],
        sprint: ["other-app"],
      },
      storage,
    );
    expect(
      readTimelinePreferences("a", today, storage, {
        personIds: ["p"],
        sprintIds: ["s"],
      }),
    ).toEqual(defaultTimelinePreferences(today));
    writeTimelinePreferences(
      "a",
      {
        ...defaultTimelinePreferences(today),
        person: ["p"],
        sprint: ["unassigned"],
      },
      storage,
    );
    expect(
      readTimelinePreferences("a", today, storage, {
        personIds: ["p"],
        sprintIds: ["s"],
      }).sprint,
    ).toEqual(["unassigned"]);
  });

  it("keeps the view usable when browser storage access is denied or unavailable", () => {
    const storage: PreferenceStorage = {
      getItem() {
        throw new Error("SecurityError");
      },
      setItem() {
        throw new Error("QuotaExceededError");
      },
    };
    expect(readTimelinePreferences("a", today, storage)).toEqual(
      defaultTimelinePreferences(today),
    );
    expect(
      writeTimelinePreferences("a", defaultTimelinePreferences(today), storage),
    ).toBe(false);
    expect(readTimelinePreferences("a", today, null)).toEqual(
      defaultTimelinePreferences(today),
    );
    expect(
      writeTimelinePreferences("a", defaultTimelinePreferences(today), null),
    ).toBe(false);
  });
});
