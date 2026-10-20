import { expect, it } from "vitest";
import { emptyState, stateSchema } from "../src/lib/model";
import { capacity, generatePlan, schedule } from "../src/lib/planning";
import { prepareSprintEstimate } from "../src/lib/estimation";
import { applyFeatureChange } from "../src/lib/changes";
import { applyCalendarTemplate } from "../src/lib/availability";
import {
  reconcileCommitments,
  refreshCommitments,
} from "../src/lib/commitments";
import { differenceInCalendarDays, parseISO } from "date-fns";

const now = "2026-10-04";
function fixture() {
  const state = stateSchema.parse({
    ...emptyState,
    apps: [
      {
        id: "a",
        name: "Planner",
        color: "#7464dd",
        weekends: [5, 6],
        planningStart: now,
        cadence: "2w",
        customDays: 14,
        terms: "",
      },
    ],
    people: [
      { id: "p", name: "Alex", dailyHours: 8 },
      { id: "q", name: "Sam", dailyHours: 8 },
    ],
    members: [
      {
        id: "m",
        appId: "a",
        personId: "p",
        role: "Web",
        allocation: 100,
        weekends: null,
      },
      {
        id: "n",
        appId: "a",
        personId: "q",
        role: "Design",
        allocation: 100,
        weekends: null,
      },
    ],
    sprints: [
      {
        id: "s",
        appId: "a",
        number: 1,
        start: now,
        end: "2026-10-16",
        goal: "",
        notes: "",
        snapshot: "Original snapshot text",
      },
    ],
  });
  state.features = [
    prepareSprintEstimate(
      state,
      {
        id: "f",
        appId: "a",
        title: "Five sprint feature",
        description: "",
        completion: "",
        priority: 0,
        tasks: [],
        sprintEstimate: 5,
        assigneeIds: ["p"],
        sprintId: "s",
        committed: true,
        link: "",
      },
      now,
    ),
  ];
  return state;
}
const template = {
  id: "calendar",
  name: "Autumn calendar",
  entries: [
    {
      id: "entry",
      name: "Team break",
      kind: "holiday" as const,
      start: "2026-10-11",
      end: "2026-10-15",
      hours: null,
    },
  ],
};

it("treats a starting sprint as grouping, without flagging expected multi-sprint work", () => {
  const s = fixture();
  expect(schedule(s, now).features.f.warning).toBeUndefined();
});
it("applies a holiday template only to selected members and moves fifty working days by one week", () => {
  const state = { ...fixture(), calendarTemplates: [template] };
  const before = schedule(state, now);
  const applied = applyCalendarTemplate(state, "calendar", "a", ["p"]);
  expect(applied.holidays).toHaveLength(5);
  expect(capacity(applied, "a", "p", "2026-10-12")).toBe(0);
  expect(capacity(applied, "a", "q", "2026-10-12")).toBe(8);
  const after = schedule(applied, now);
  expect(
    differenceInCalendarDays(
      parseISO(after.features.f.end!),
      parseISO(before.features.f.end!),
    ),
  ).toBe(7);
  expect(after.features.f.hours).toBe(400);
  expect(applied.features[0].estimateEffort).toEqual(
    state.features[0].estimateEffort,
  );
  const again = applyCalendarTemplate(applied, "calendar", "a", ["p"]);
  expect(again.holidays).toEqual(applied.holidays);
  const extended = applyCalendarTemplate(again, "calendar", "a", ["q"]);
  expect(extended.holidays).toHaveLength(5);
  expect(capacity(extended, "a", "q", "2026-10-12")).toBe(0);
  expect(stateSchema.parse(extended).calendarTemplates).toEqual([template]);
  expect(
    generatePlan(extended, extended.sprints[0], schedule(extended, now)),
  ).toContain("Alex, Sam");
});
it("applies reusable personal leave globally, avoids duplicate deductions, and retains applied records when template changes", () => {
  const state = fixture();
  state.apps.push({ ...state.apps[0], id: "b", name: "Second" });
  state.members.push({ ...state.members[0], id: "member-b", appId: "b" });
  const source = {
    ...template,
    entries: [{ ...template.entries[0], kind: "leave" as const, hours: 4 }],
  };
  const applied = applyCalendarTemplate(
    { ...state, calendarTemplates: [source] },
    source.id,
    "a",
    ["p"],
  );
  expect(applied.leaves).toHaveLength(1);
  expect(capacity(applied, "a", "p", "2026-10-12")).toBe(4);
  expect(capacity(applied, "b", "p", "2026-10-12")).toBe(4);
  const again = applyCalendarTemplate(applied, source.id, "b", ["p"]);
  expect(again.leaves).toEqual(applied.leaves);
  const removed = { ...again, calendarTemplates: [] };
  expect(capacity(removed, "a", "p", "2026-10-12")).toBe(4);
});
it("personal leave and overlapping holidays move commitments without double-counting full absence", () => {
  const before = refreshCommitments(fixture(), ["f"], now);
  const after = {
    ...before,
    leaves: [
      {
        id: "personal",
        personId: "p",
        start: "2026-10-11",
        end: "2026-10-17",
        hours: null,
        note: "One week away",
      },
      {
        id: "overlap",
        personId: "p",
        start: "2026-10-12",
        end: "2026-10-12",
        hours: 4,
        note: "Appointment",
      },
    ],
    holidays: [
      { id: "holiday", appId: "a", date: "2026-10-12", name: "Public holiday" },
    ],
  };
  const forecast = schedule(after, now).features.f;
  expect(forecast.hours).toBe(400);
  expect(forecast.delayDays).toBe(7);
  expect(forecast.commitmentDelayed).toBe(true);
  expect(after.features[0].commitment).toEqual(before.features[0].commitment);
  expect(capacity(after, "a", "p", "2026-10-12")).toBe(0);
});

it("rejects invalid templates and foreign, duplicate or empty selected people", () => {
  const s = { ...fixture(), calendarTemplates: [template] };
  for (const people of [[], ["outside"], ["p", "p"]])
    expect(() => applyCalendarTemplate(s, "calendar", "a", people)).toThrow();
  for (const entries of [
    [],
    [{ ...template.entries[0], end: "2026-10-01" }],
    [{ ...template.entries[0], end: "2030-10-01" }],
    [{ ...template.entries[0], kind: "leave", hours: 0 }],
  ])
    expect(
      stateSchema.safeParse({
        ...s,
        calendarTemplates: [{ ...template, entries }],
      }).success,
    ).toBe(false);
  expect(
    stateSchema.safeParse({
      ...s,
      holidays: [
        {
          id: "h",
          appId: "a",
          date: now,
          name: "Holiday",
          personIds: ["outside"],
        },
      ],
    }).success,
  ).toBe(false);
});
it("captures a new commitment and only reports risk after the accepted forecast moves", () => {
  const before = fixture();
  before.features[0].committed = false;
  const next = {
    ...before,
    features: before.features.map((f) => ({ ...f, committed: true })),
  };
  const accepted = reconcileCommitments(before, next, now);
  const baseline = schedule(before, now).features.f.end;
  expect(accepted.features[0].commitment).toEqual({
    end: baseline,
    acceptedAt: now,
  });
  expect(schedule(accepted, now).features.f.commitmentDelayed).toBe(false);
  const urgent = prepareSprintEstimate(
    accepted,
    {
      ...accepted.features[0],
      id: "urgent",
      title: "Priority work",
      sprintEstimate: 0.5,
      committed: false,
      commitment: undefined,
    },
    now,
  );
  const changed = applyFeatureChange(accepted, urgent);
  const risk = schedule(changed, now).features.f;
  expect(risk.commitmentDelayed).toBe(true);
  expect(risk.delayDays).toBe(7);
  expect(risk.warning).toMatch(/commitment/i);
  const retained = reconcileCommitments(accepted, changed, now);
  expect(retained.features.find((f) => f.id === "f")?.commitment?.end).toBe(
    baseline,
  );
  const refreshed = refreshCommitments(retained, ["f"], now);
  expect(refreshed.features.find((f) => f.id === "f")?.commitment?.end).toBe(
    "2026-12-24",
  );
  expect(schedule(refreshed, now).features.f.commitmentDelayed).toBe(false);
  expect(refreshed.sprints[0].snapshot).toBe("Original snapshot text");
  expect(
    generatePlan(refreshed, refreshed.sprints[0], schedule(refreshed, now)),
  ).toContain("Accepted delivery:");
});
it("leaves old checkbox-only records awaiting an explicit baseline and clears it on uncommit", () => {
  const state = fixture();
  expect(
    reconcileCommitments(state, state, now).features[0].commitment,
  ).toBeUndefined();
  const accepted = refreshCommitments(state, ["f"], now);
  const cleared = reconcileCommitments(
    accepted,
    {
      ...accepted,
      features: accepted.features.map((f) => ({ ...f, committed: false })),
    },
    now,
  );
  expect(cleared.features[0].commitment).toBeUndefined();
  const blocked = {
    ...accepted,
    features: accepted.features.map((f) => ({
      ...f,
      status: "blocked" as const,
    })),
  };
  expect(() => refreshCommitments(blocked, ["f"], now)).toThrow(
    /Five sprint feature/,
  );
  expect(schedule(blocked, now).features.f.commitmentDelayed).toBe(true);
});
