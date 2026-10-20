import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { createStore, type Store } from "../server/store";
import { createServer } from "../server/app";
import { emptyState, stateSchema, type PlannerState } from "../src/lib/model";
import { schedule } from "../src/lib/planning";
import { enableAutomaticPlanning } from "../src/lib/date-status";

const now = "2030-01-06";
const folders: string[] = [];
const stores = new Set<Store>();
function databasePath() {
  const folder = mkdtempSync(join(tmpdir(), "sprint-studio-regressions-"));
  folders.push(folder);
  return join(folder, "planner.sqlite");
}
function open(path: string) {
  const store = createStore(path);
  stores.add(store);
  return store;
}
function close(store: Store) {
  store.close();
  stores.delete(store);
}
afterEach(() => {
  for (const store of stores) store.close();
  stores.clear();
  for (const folder of folders.splice(0))
    rmSync(folder, { recursive: true, force: true });
});

function currentState(): PlannerState {
  return stateSchema.parse({
    ...emptyState,
    apps: [
      {
        id: "a",
        name: "Local delivery",
        color: "#7464dd",
        weekends: [5, 6],
        planningStart: now,
        cadence: "month",
        customDays: 28,
        terms: "Custom terms",
        archived: false,
      },
    ],
    people: [
      { id: "p", name: "Alex", dailyHours: 8 },
      { id: "q", name: "Sam", dailyHours: 6 },
    ],
    members: [
      {
        id: "mp",
        appId: "a",
        personId: "p",
        role: "Backend",
        allocation: 75,
        weekends: null,
      },
      {
        id: "mq",
        appId: "a",
        personId: "q",
        role: "Design",
        allocation: 50,
        weekends: [0, 6],
      },
    ],
    features: [
      {
        id: "mixed",
        appId: "a",
        title: "Mixed estimates",
        priority: 0,
        description: "Keep scope",
        completion: "Verified",
        tasks: [],
        assigneeIds: ["p", "q"],
        assigneeEstimates: [
          { personId: "p", unit: "sprints", value: 1.5 },
          { personId: "q", unit: "days", value: 2.25 },
        ],
        estimateEffort: [
          { personId: "p", hours: 90 },
          { personId: "q", hours: 6.75 },
        ],
        status: "doing",
        target: "2030-02-01",
        notBefore: now,
        sprintId: "s",
        committed: true,
        commitment: { end: "2030-01-25", acceptedAt: now },
        link: "https://example.test/mixed",
      },
      {
        id: "breakdown",
        appId: "a",
        title: "Task breakdown",
        priority: 1,
        description: "Retained estimates",
        completion: "Done when reviewed",
        assigneeIds: ["p"],
        assigneeEstimates: [{ personId: "p", unit: "days", value: 5 }],
        sprintEstimate: 0.5,
        committed: false,
        link: "",
        sprintId: "s",
        tasks: [
          {
            id: "complete",
            title: "History",
            personId: "p",
            scope: "Backend",
            hours: 8,
            status: "done",
            dependsOn: [],
            actualStart: "2030-01-02",
            actualEnd: "2030-01-03",
          },
          {
            id: "pending",
            title: "Follow-up",
            personId: "p",
            scope: "QA",
            hours: 4,
            status: "blocked",
            dependsOn: ["complete"],
            dependsOnFeatures: ["mixed"],
            unblockDate: "2030-01-27",
          },
        ],
      },
    ],
    leaves: [
      {
        id: "leave",
        personId: "p",
        start: "2030-01-09",
        end: "2030-01-10",
        hours: 2,
        note: "Appointment",
        templateId: "calendar",
        templateEntryId: "leave-entry",
      },
    ],
    holidays: [
      {
        id: "holiday",
        appId: "a",
        date: "2030-01-13",
        name: "Selected holiday",
        personIds: ["q"],
        templateId: "calendar",
        templateEntryId: "holiday-entry",
      },
    ],
    calendarTemplates: [
      {
        id: "calendar",
        name: "Saved calendar",
        entries: [
          {
            id: "leave-entry",
            name: "Appointment",
            kind: "leave",
            start: "2030-01-09",
            end: "2030-01-10",
            hours: 2,
          },
          {
            id: "holiday-entry",
            name: "Selected holiday",
            kind: "holiday",
            start: "2030-01-13",
            end: "2030-01-13",
            hours: null,
          },
        ],
      },
    ],
    sprints: [
      {
        id: "s",
        appId: "a",
        number: 7,
        start: now,
        end: "2030-02-02",
        goal: "Ship",
        notes: "Keep wording",
        snapshot: "**Finalized**\nExact text\n",
        draft: "**Draft**\nCustom edits\n",
      },
    ],
  });
}

it("round-trips the newest complete model through a full JSON backup", () => {
  const state = currentState();
  const restored = stateSchema.parse(JSON.parse(JSON.stringify(state)));
  expect(restored).toEqual(state);
  expect(restored.features[0].estimateEffort).toEqual([
    { personId: "p", hours: 90 },
    { personId: "q", hours: 6.75 },
  ]);
  expect(restored.features[0].commitment).toEqual({
    end: "2030-01-25",
    acceptedAt: now,
  });
  expect(schedule(restored, now)).toEqual(schedule(state, now));
});

it("keeps automatic planning anchors through revision-guarded API saves, SQLite reopen and legacy backup migration", async () => {
  const original = currentState();
  const state = enableAutomaticPlanning(original, now);
  const path = databasePath();
  const store = open(path);
  const server = createServer(store);
  try {
    const response = await server.inject({
      method: "PUT",
      url: "/api/state",
      payload: { revision: 0, state },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ revision: 1, state });
    const invalid = structuredClone(state);
    invalid.features[0].planningFrom = "2030-02-30";
    const rejected = await server.inject({
      method: "PUT",
      url: "/api/state",
      payload: { revision: 1, state: invalid },
    });
    expect(rejected.statusCode).toBe(400);
    expect(store.read()).toEqual({ revision: 1, state });
  } finally {
    await server.close();
    close(store);
  }
  const restored = open(path).read();
  expect(restored).toEqual({ revision: 1, state });
  expect(stateSchema.parse(JSON.parse(JSON.stringify(restored.state)))).toEqual(
    state,
  );
  const withoutAnchors = {
    ...restored.state,
    features: restored.state.features.map(
      ({ planningFrom: _anchor, ...feature }) => feature,
    ),
  };
  expect(withoutAnchors).toEqual(original);
  expect(enableAutomaticPlanning(restored.state, "2030-03-01")).toEqual(
    restored.state,
  );
});

it("closes and reopens real SQLite with mixed units, provenance, commitments and exact plan text", () => {
  const path = databasePath(),
    state = currentState();
  const first = open(path);
  expect(first.save(state, 0).revision).toBe(1);
  close(first);
  const reopened = open(path);
  expect(reopened.read()).toEqual({ revision: 1, state });
  const next = structuredClone(reopened.read().state);
  next.features[0].title = "Reopened edit";
  expect(reopened.save(next, 1).revision).toBe(2);
  close(reopened);
  const third = open(path);
  expect(third.read()).toEqual({ revision: 2, state: next });
  expect(third.read().state.sprints[0]).toMatchObject({
    snapshot: "**Finalized**\nExact text\n",
    draft: "**Draft**\nCustom edits\n",
  });
});

const legacyCases = [
  "task-only",
  "global-estimate",
  "checkbox-commitment",
  "saved-draft",
] as const;
describe("older on-disk version-one workspaces", () => {
  it.each(legacyCases)(
    "loads and saves %s without inventing modern planning semantics",
    (kind) => {
      const modern = currentState();
      const common = {
        version: 1,
        apps: modern.apps,
        people: modern.people,
        members: modern.members,
        leaves: [],
        holidays: [],
        sprints: modern.sprints.map(({ draft: _draft, ...sprint }) => sprint),
      };
      const global = {
        id: "legacy",
        appId: "a",
        title: "Legacy estimate",
        priority: 0,
        description: "",
        completion: "",
        tasks: [],
        assigneeIds: ["p"],
        sprintEstimate: 1,
        estimateEffort: [{ personId: "p", hours: 60 }],
        link: "",
        committed: kind === "checkbox-commitment",
      };
      const task = {
        id: "legacy",
        appId: "a",
        title: "Legacy task",
        priority: 0,
        tasks: [
          {
            id: "legacy-task",
            title: "Task",
            personId: "p",
            scope: "Backend",
            hours: 12,
            status: "todo",
            dependsOn: [],
          },
        ],
      };
      const raw = {
        ...common,
        features: [kind === "task-only" ? task : global],
      };
      if (kind === "saved-draft")
        Object.assign(raw.sprints[0], {
          draft: "Legacy handwritten draft\nKeep this line",
        });
      const path = databasePath();
      const sqlite = new Database(path);
      sqlite.exec(
        "CREATE TABLE workspace (id INTEGER PRIMARY KEY, revision INTEGER NOT NULL, body TEXT NOT NULL)",
      );
      sqlite
        .prepare("INSERT INTO workspace (id, revision, body) VALUES (1, ?, ?)")
        .run(12, JSON.stringify(raw));
      sqlite.close();
      const store = open(path),
        loaded = store.read();
      expect(loaded.revision).toBe(12);
      expect(loaded.state.calendarTemplates).toBeUndefined();
      expect(loaded.state.features[0].assigneeEstimates).toBeUndefined();
      expect(loaded.state.features[0].commitment).toBeUndefined();
      expect(schedule(loaded.state, now).features.legacy).toMatchObject({
        hours: kind === "task-only" ? 12 : 60,
        end: kind === "task-only" ? "2030-01-07" : "2030-01-17",
        commitmentDelayed: false,
      });
      expect(loaded.state.features[0].committed).toBe(
        kind === "checkbox-commitment",
      );
      expect(loaded.state.sprints[0].draft).toBe(
        kind === "saved-draft"
          ? "Legacy handwritten draft\nKeep this line"
          : undefined,
      );
      expect(store.save(loaded.state, 12).revision).toBe(13);
      close(store);
      const reopened = open(path);
      expect(reopened.read()).toEqual({ revision: 13, state: loaded.state });
    },
  );
});

it("rejects a stale revision across two independent SQLite connections without losing the winning update", () => {
  const path = databasePath(),
    first = open(path),
    second = open(path);
  const snapshot = second.read();
  const winning = currentState();
  expect(first.save(winning, 0).revision).toBe(1);
  expect(() =>
    second.save(
      {
        ...snapshot.state,
        people: [{ id: "loser", name: "Stale update", dailyHours: 8 }],
      },
      snapshot.revision,
    ),
  ).toThrow(/changed in another tab/);
  expect(first.read()).toEqual({ revision: 1, state: winning });
  expect(second.read()).toEqual(first.read());
  const retry = structuredClone(second.read().state);
  retry.people[0].name = "Reloaded update";
  expect(second.save(retry, 1).revision).toBe(2);
  expect(first.read()).toEqual({ revision: 2, state: retry });
});

it("rejects invalid HTTP restores atomically while preserving a nonempty disk workspace and revision", async () => {
  const store = open(databasePath()),
    state = currentState();
  store.save(state, 0);
  const server = createServer(store);
  try {
    const invalid = [
      { ...state, version: 2 },
      { ...state, people: [] },
      {
        ...state,
        features: state.features.map((f) => ({
          ...f,
          commitment: { end: "2030-02-30", acceptedAt: now },
        })),
      },
      {
        ...state,
        holidays: [{ ...state.holidays[0], personIds: ["outside"] }],
      },
      {
        ...state,
        features: [
          {
            ...state.features[0],
            estimateEffort: [{ personId: "p", hours: 90 }],
          },
        ],
      },
    ];
    for (const bad of invalid) {
      const response = await server.inject({
        method: "PUT",
        url: "/api/state",
        payload: { revision: 1, state: bad },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error).toBeTruthy();
      expect(store.read()).toEqual({ revision: 1, state });
    }
    const response = await server.inject({ method: "GET", url: "/api/state" });
    expect(response.json()).toEqual({ revision: 1, state });
  } finally {
    await server.close();
  }
});

const hostileHeaders = [
  { origin: "https://evil.example", host: "localhost:4311" },
  { origin: "http://localhost:4311.evil.example", host: "localhost:4311" },
  { origin: "null", host: "localhost:4311" },
  { origin: "http://127.0.0.1:4311", host: "evil.example" },
  { host: "127.0.0.1.evil.example:4311" },
];
it.each(hostileHeaders)(
  "rejects hostile local-API headers %j before writing",
  async (headers) => {
    const store = open(databasePath()),
      state = currentState();
    store.save(state, 0);
    const server = createServer(store);
    try {
      for (const method of ["GET", "PUT"] as const) {
        const response = await server.inject({
          method,
          url: "/api/state",
          headers,
          ...(method === "PUT"
            ? { payload: { revision: 1, state: emptyState } }
            : {}),
        });
        expect(response.statusCode).toBe(403);
        expect(store.read()).toEqual({ revision: 1, state });
      }
    } finally {
      await server.close();
    }
  },
);

it.each([
  {},
  { revision: -1, state: emptyState },
  { revision: 0.5, state: emptyState },
  { revision: "0", state: emptyState },
  { revision: 0 },
  null,
])(
  "rejects malformed save envelopes %j without a revision bump",
  async (payload) => {
    const store = open(databasePath()),
      server = createServer(store);
    try {
      const response = await server.inject({
        method: "PUT",
        url: "/api/state",
        headers: {
          origin: "http://localhost:4311",
          host: "127.0.0.1:4311",
          "content-type": "application/json",
        },
        payload: JSON.stringify(payload),
      });
      expect(response.statusCode).toBe(400);
      expect(store.read()).toEqual({ revision: 0, state: emptyState });
    } finally {
      await server.close();
    }
  },
);

it("rejects malformed JSON and still accepts a subsequent well-formed local save", async () => {
  const store = open(databasePath()),
    server = createServer(store);
  try {
    const bad = await server.inject({
      method: "PUT",
      url: "/api/state",
      headers: {
        "content-type": "application/json",
        origin: "http://127.0.0.1:4311",
      },
      payload: '{"revision":0,"state":',
    });
    expect(bad.statusCode).toBe(400);
    expect(store.read().revision).toBe(0);
    const good = await server.inject({
      method: "PUT",
      url: "/api/state",
      headers: { origin: "http://127.0.0.1:4311", host: "localhost:4311" },
      payload: { revision: 0, state: currentState() },
    });
    expect(good.statusCode).toBe(200);
    expect(store.read()).toEqual({ revision: 1, state: currentState() });
  } finally {
    await server.close();
  }
});

it("persists person-relative partial-day templates and tiny valid workdays through API, reopening and backup parsing", async () => {
  const { maintenanceFixture } = await import("../scripts/maintenance-fixture");
  const { applyCalendarTemplate } = await import("../src/lib/availability");
  const state = maintenanceFixture();
  state.people[1].dailyHours = 0.25;
  state.calendarTemplates![0].entries[0] = {
    ...state.calendarTemplates![0].entries[0],
    hours: 0.08,
    dayFraction: 0.01,
  };
  const applied = applyCalendarTemplate(state, "template", "a", ["p", "q"]);
  const path = databasePath();
  const store = open(path);
  const api = createServer(store);
  const response = await api.inject({
    method: "PUT",
    url: "/api/state",
    payload: { revision: 0, state: applied },
  });
  expect(response.statusCode).toBe(200);
  expect(
    response.json().state.leaves.map((l: { hours: number }) => l.hours),
  ).toEqual([0.08, 0.0025]);
  await api.close();
  close(store);
  const reopened = open(path).read();
  expect(reopened.revision).toBe(1);
  expect(reopened.state.calendarTemplates![0].entries[0].dayFraction).toBe(
    0.01,
  );
  expect(stateSchema.parse(JSON.parse(JSON.stringify(reopened.state)))).toEqual(
    reopened.state,
  );
  const invalid = structuredClone(reopened.state);
  invalid.calendarTemplates![0].entries[0].dayFraction = 1.1;
  expect(stateSchema.safeParse(invalid).success).toBe(false);
});
