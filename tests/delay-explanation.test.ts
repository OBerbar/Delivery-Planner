import { describe, it, expect } from "vitest";
import {
  delayFixture as automaticDelayFixture,
  fixedToday,
} from "../scripts/delay-fixture";
import { schedule, type SchedulingDiagnostics } from "../src/lib/planning";
import { explainDelay } from "../src/lib/delay-explanation";

// Retain direct-library coverage of older, unanchored workspaces.
function delayFixture() {
  const state = automaticDelayFixture();
  for (const feature of state.features) delete feature.planningFrom;
  return state;
}

function explain(state = delayFixture()) {
  return explainDelay(
    state,
    "delivery",
    schedule(state, fixedToday),
    fixedToday,
  )!;
}
describe("commitment delay explanations", () => {
  it("names the stable planning anchor and ignores legacy unblock constraints", () => {
    const state = automaticDelayFixture();
    for (const feature of state.features) feature.planningFrom = fixedToday;
    state.features[1].status = "blocked";
    state.features[1].unblockDate = "2030-02-01";
    const forecast = schedule(state, "2030-01-07");
    const result = explainDelay(state, "delivery", forecast, "2030-01-07")!;
    expect(result.people[0].startConstraints).toContainEqual({
      kind: "planning-from",
      label: "Planning began",
      date: fixedToday,
    });
    expect(
      result.people.flatMap((p) => p.startConstraints).map((c) => c.kind),
    ).not.toContain("unblock");
    expect(
      result.people.flatMap((p) => p.startConstraints).map((c) => c.kind),
    ).not.toContain("today");
  });
  it("retains calendar and start evidence when leave blocks the entire forecast horizon", () => {
    const state = delayFixture();
    state.features.shift();
    state.leaves = [
      {
        id: "long-leave",
        personId: "p",
        start: fixedToday,
        end: "2035-01-07",
        hours: null,
        note: "Extended leave",
      },
    ];
    const result = explain(state),
      person = result.people[0];
    expect(result.end).toBeUndefined();
    expect(result.delayDays).toBeUndefined();
    expect(person.reason).toMatch(/five-year forecast horizon/);
    expect(person.calendar.find((c) => c.kind === "leave")).toMatchObject({
      label: "Extended leave",
    });
    expect(person.calendar.flatMap((c) => c.dates)).toHaveLength(1827);
    expect(person.calendar.find((c) => c.kind === "leave")!.dates).toContain(
      fixedToday,
    );
    expect(person.startConstraints).toContainEqual({
      kind: "today",
      label: "Planning from today",
      date: fixedToday,
    });
  });
  it("accounts for two short delayed tasks without counting the blocking feature twice", () => {
    const state = delayFixture();
    state.features[1].commitment!.end = fixedToday;
    state.features[1].tasks = [
      {
        id: "short-1",
        title: "First part",
        personId: "p",
        scope: "Backend",
        hours: 2,
        status: "todo",
        dependsOn: [],
      },
      {
        id: "short-2",
        title: "Second part",
        personId: "p",
        scope: "Backend",
        hours: 2,
        status: "todo",
        dependsOn: [],
      },
    ];
    const person = explain(state).people[0];
    expect(person.capacityLostHours).toBe(4);
    expect(person.competingWork).toHaveLength(1);
    expect(person.competingWork[0].hours).toBe(8);
  });
  it("uses the forecast's calculation date if an explanation is opened after midnight", () => {
    const state = delayFixture();
    const forecast = schedule(state, fixedToday);
    expect(
      explainDelay(state, "delivery", forecast, "2030-01-07")!.people[0]
        .competingWork[0].dates,
    ).toEqual([fixedToday]);
  });
  it("excludes partial leave that does not reduce this app's allocated availability", () => {
    const state = delayFixture();
    state.features.shift();
    state.members[0].allocation = 50;
    state.features[0].estimateEffort![0].hours = 20;
    state.features[0].commitment!.end = "2030-01-09";
    state.leaves = [
      {
        id: "l",
        personId: "p",
        start: fixedToday,
        end: fixedToday,
        hours: 2,
        note: "Appointment",
      },
    ];
    expect(explain(state).people[0].calendar).toEqual([]);
  });
  it("names an unscheduled dependency and its owner without inventing dates", () => {
    const state = delayFixture();
    state.features[0].tasks = [
      {
        id: "blocked",
        title: "Approval",
        personId: "q",
        scope: "Design",
        hours: 8,
        status: "blocked",
        dependsOn: [],
      },
    ];
    state.features[1].tasks = [
      {
        id: "waiting",
        title: "Implementation",
        personId: "p",
        scope: "Backend",
        hours: 8,
        status: "todo",
        dependsOn: ["blocked"],
      },
    ];
    const result = explain(state);
    expect(result.end).toBeUndefined();
    expect(result.people[0].startConstraints).toContainEqual({
      kind: "blocked-dependency",
      label: "Approval",
      featureId: "blocker",
      featureTitle: "Urgent fix",
      personId: "q",
      personName: "Sam",
    });
  });
  it("identifies the person and earlier feature behind one working day plus a weekend, without changing data", () => {
    const state = delayFixture(),
      before = structuredClone(state);
    const result = explain(state);
    expect(result).toMatchObject({
      accepted: "2030-01-10",
      end: "2030-01-13",
      delayDays: 3,
    });
    expect(result.people.map((p) => p.personId)).toEqual(["p"]);
    expect(result.people[0].competingWork).toEqual([
      {
        featureId: "blocker",
        title: "Urgent fix",
        appId: "a",
        appName: "Maintenance Studio",
        hours: 8,
        dates: [fixedToday],
        internal: false,
      },
    ]);
    expect(result.people[0].capacityLostHours).toBe(8);
    expect(result.people[0].calendar).toContainEqual({
      kind: "weekend",
      label: "Weekend",
      dates: ["2030-01-11", "2030-01-12"],
      hours: 16,
    });
    expect(state).toEqual(before);
  });
  it("explains leave instead of inventing a competing feature", () => {
    const state = delayFixture();
    state.features.shift();
    state.leaves = [
      {
        id: "l",
        personId: "p",
        start: fixedToday,
        end: fixedToday,
        hours: null,
        note: "Annual leave",
      },
    ];
    const result = explain(state);
    expect(result.delayDays).toBe(3);
    expect(result.people[0].competingWork).toEqual([]);
    expect(result.people[0].calendar).toContainEqual({
      kind: "leave",
      label: "Annual leave",
      dates: [fixedToday],
      hours: 8,
    });
  });
  it("respects partial leave, member weekend overrides and selected-person holidays", () => {
    const state = delayFixture();
    state.features.shift();
    state.members[0].weekends = [];
    state.leaves = [
      {
        id: "l",
        personId: "p",
        start: fixedToday,
        end: fixedToday,
        hours: 2,
        note: "Appointment",
      },
    ];
    state.holidays = [
      {
        id: "h",
        appId: "a",
        date: "2030-01-07",
        name: "Sam only",
        personIds: ["q"],
      },
    ];
    const person = explain(state).people[0];
    expect(person.end).toBe("2030-01-11");
    expect(person.calendar).toEqual([
      { kind: "leave", label: "Appointment", dates: [fixedToday], hours: 2 },
    ]);
  });
  it("shows shared-person contention from another app but excludes bookings outside the app's allocation", () => {
    const state = delayFixture();
    state.apps.push({ ...state.apps[0], id: "b", name: "Other app" });
    state.members.push({
      ...state.members[0],
      id: "b-p",
      appId: "b",
      allocation: 100,
    });
    state.features[0].appId = "b";
    expect(explain(state).people[0].competingWork[0]).toMatchObject({
      appId: "b",
      appName: "Other app",
      hours: 8,
    });
    state.members[0].allocation = 50;
    state.members[2].allocation = 50;
    state.features[1].estimateEffort![0].hours = 20;
    state.features[1].commitment!.end = "2030-01-09";
    expect(explain(state).people[0].competingWork).toEqual([]);
    expect(explain(state).people[0].capacityLostHours).toBe(0);
  });
  it("does not blame non-pushing work or a later-priority feature for held delivery dates", () => {
    const state = delayFixture();
    state.features[0].doesntAffectOtherWork = true;
    state.features[1].commitment!.end = "2030-01-09";
    expect(explain(state).people[0].competingWork).toEqual([]);
    expect(explain(state).people[0].reassignedHours).toBe(8);
    state.features[0].doesntAffectOtherWork = false;
    state.features[0].priority = 2;
    expect(explain(state).people[0].competingWork).toEqual([]);
  });
  it("names a dependency's feature and owner even when a different person is waiting", () => {
    const state = delayFixture();
    state.features[0].tasks = [
      {
        id: "upstream",
        title: "Design approval",
        personId: "q",
        scope: "Design",
        hours: 8,
        status: "todo",
        dependsOn: [],
      },
    ];
    state.features[0].notBefore = "2030-01-10";
    state.features[1].tasks = [
      {
        id: "downstream",
        title: "Implementation",
        personId: "p",
        scope: "Backend",
        hours: 8,
        status: "todo",
        dependsOn: [],
        dependsOnFeatures: ["blocker"],
      },
    ];
    const result = explain(state);
    expect(result.end).toBe("2030-01-13");
    expect(result.people[0].startConstraints).toContainEqual({
      kind: "dependency",
      label: "Design approval",
      date: "2030-01-11",
      featureId: "blocker",
      featureTitle: "Urgent fix",
      personId: "q",
      personName: "Sam",
    });
    expect(result.people[0].competingWork).toEqual([]);
  });
  it("separates internal work on the same person from other feature contention", () => {
    const state = delayFixture();
    state.features.shift();
    state.features[0].tasks = [
      {
        id: "first",
        title: "Initial work",
        personId: "p",
        scope: "Backend",
        hours: 8,
        status: "todo",
        dependsOn: [],
      },
      {
        id: "second",
        title: "Remaining work",
        personId: "p",
        scope: "Backend",
        hours: 40,
        status: "todo",
        dependsOn: [],
      },
    ];
    expect(explain(state).people[0].competingWork).toEqual([
      {
        featureId: "delivery",
        title: "Five-day delivery",
        appId: "a",
        appName: "Maintenance Studio",
        hours: 8,
        dates: [fixedToday],
        internal: true,
      },
    ]);
  });
  it("reports start limits and unscheduled dependencies without inventing a delay duration", () => {
    const state = delayFixture();
    state.features.shift();
    state.features[0].notBefore = "2030-01-14";
    expect(explain(state).people[0].startConstraints).toContainEqual({
      kind: "not-before",
      label: "Start no earlier than",
      date: "2030-01-14",
    });
    state.features[0].status = "blocked";
    state.features[0].unblockDate = undefined;
    const result = explain(state);
    expect(result.end).toBeUndefined();
    expect(result.delayDays).toBeUndefined();
    expect(result.people[0].reason).toMatch(/Blocked/);
  });
  it("does not offer a delay explanation for non-delayed, completed, or unaccepted work", () => {
    const state = delayFixture();
    state.features.shift();
    expect(explain(state)).toBeNull();
    state.features[0].commitment = undefined;
    expect(explain(state)).toBeNull();
    state.features[0].commitment = {
      end: "2030-01-09",
      acceptedAt: fixedToday,
    };
    state.features[0].status = "done";
    state.features[0].actualStart = fixedToday;
    state.features[0].actualEnd = "2030-01-13";
    expect(explain(state)).toBeNull();
  });
  it("rolls back impossible work and keeps diagnostics from changing forecasts", () => {
    const state = delayFixture();
    state.features[0].estimateEffort![0].hours = 60000;
    state.features[1].commitment!.end = "2030-01-09";
    const before = schedule(state, fixedToday),
      diagnostics: SchedulingDiagnostics = new Map();
    expect(schedule(state, fixedToday, diagnostics)).toEqual(before);
    expect(explain(state).people[0].competingWork).toEqual([]);
    expect(explain(state).people[0].capacityLostHours).toBe(0);
  });
});
