import { it, expect } from "vitest";
import { emptyState, stateSchema } from "../src/lib/model";
import { schedule } from "../src/lib/planning";
const fixture = () =>
  stateSchema.parse({
    ...emptyState,
    apps: [
      {
        id: "a",
        name: "App",
        color: "#7565db",
        weekends: [5, 6],
        planningStart: "2026-10-06",
        cadence: "2w",
        customDays: 14,
        terms: "",
      },
    ],
    people: [{ id: "p", name: "Alex", dailyHours: 8 }],
    members: [
      {
        id: "m",
        appId: "a",
        personId: "p",
        role: "Backend",
        allocation: 100,
        weekends: null,
      },
    ],
    features: [
      {
        id: "f",
        appId: "a",
        title: "Feature",
        priority: 0,
        tasks: [
          {
            id: "t",
            title: "API",
            personId: "p",
            scope: "Backend",
            hours: 8,
            status: "doing",
            unblockDate: "2026-11-01",
            dependsOn: [],
          },
        ],
      },
    ],
  });
it("an unblocked task ignores its old expected unblock date", () => {
  expect(schedule(fixture(), "2026-10-06").tasks.t.start).toBe("2026-10-06");
});
it("archiving an app preserves completed history and satisfies active dependencies", () => {
  const s = fixture();
  s.apps[0].archived = true;
  Object.assign(s.features[0].tasks[0], {
    status: "done",
    actualStart: "2026-10-01",
    actualEnd: "2026-10-02",
  });
  s.apps.push({ ...s.apps[0], id: "b", archived: false });
  s.members.push({ ...s.members[0], id: "n", appId: "b" });
  s.features.push({
    ...s.features[0],
    id: "g",
    appId: "b",
    tasks: [
      {
        id: "u",
        title: "Next task",
        personId: "p",
        scope: "Backend",
        hours: 8,
        status: "todo",
        dependsOn: ["t"],
      },
    ],
  });
  const r = schedule(s, "2026-10-06");
  expect(r.tasks.t.end).toBe("2026-10-02");
  expect(r.tasks.u.start).toBe("2026-10-06");
});
it("an archived unfinished dependency is reported clearly", () => {
  const s = fixture();
  s.apps[0].archived = true;
  expect(schedule(s, "2026-10-06").tasks.t.reason).toMatch(/archived/i);
});
import { applyFeatureChange } from "../src/lib/changes";
it("removing a task disconnects downstream references and keeps remaining work", () => {
  const s = fixture();
  s.features[0].tasks.push({
    ...s.features[0].tasks[0],
    id: "t2",
    dependsOn: [],
  });
  s.features.push({
    ...s.features[0],
    id: "g",
    tasks: [{ ...s.features[0].tasks[0], id: "u", dependsOn: ["t"] }],
  });
  const f = {
    ...s.features[0],
    tasks: s.features[0].tasks.filter((t) => t.id !== "t"),
  };
  const next = applyFeatureChange(s, f);
  expect(next.features[0].tasks.map((t) => t.id)).toEqual(["t2"]);
  expect(next.features[1].tasks[0].dependsOn).toEqual([]);
  expect(stateSchema.safeParse(next).success).toBe(true);
});
it("schedules imported tasks whose IDs match object property names", () => {
  const s = fixture();
  s.features[0].tasks[0].id = "constructor";
  const result = schedule(s, "2026-10-06");
  expect(Object.values(result.tasks)[0]?.start).toBe("2026-10-06");
});
