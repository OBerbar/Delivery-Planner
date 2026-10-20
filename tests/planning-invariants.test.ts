import { describe, expect, it } from "vitest";
import {
  emptyState,
  reservationId,
  stateSchema,
  type Feature,
  type PlannerState,
} from "../src/lib/model";
import {
  capacity,
  personCapacity,
  plus,
  resources,
  schedule,
  type Schedule,
} from "../src/lib/planning";
import { prepareSprintEstimate } from "../src/lib/estimation";
import { applyCalendarTemplate } from "../src/lib/availability";
import { refreshCommitments } from "../src/lib/commitments";

const now = "2030-01-06";
function fixture(): PlannerState {
  return stateSchema.parse({
    ...emptyState,
    apps: ["a", "b"].map((id) => ({
      id,
      name: `App ${id}`,
      color: "#7464dd",
      weekends: [5, 6],
      planningStart: now,
      cadence: "2w",
      customDays: 14,
      terms: "",
    })),
    people: [
      { id: "p", name: "Alex", dailyHours: 8 },
      { id: "q", name: "Sam", dailyHours: 6 },
    ],
    members: ["a", "b"].flatMap((appId) =>
      ["p", "q"].map((personId) => ({
        id: `member-${appId}-${personId}`,
        appId,
        personId,
        role: "Backend",
        allocation: 100,
        weekends: null,
      })),
    ),
    sprints: [
      {
        id: "s",
        appId: "a",
        number: 1,
        start: now,
        end: "2030-01-17",
        goal: "Delivery",
        notes: "",
        snapshot: "Accepted plan",
        draft: "Custom draft",
      },
    ],
  });
}
function draft(id: string, appId = "a"): Feature {
  return {
    id,
    appId,
    title: id,
    priority: 0,
    description: "",
    completion: "",
    link: "",
    committed: false,
    tasks: [],
    sprintEstimate: 5,
    assigneeIds: ["p", "q"],
  };
}
function seeded(seed: number) {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 2 ** 32;
  };
}
function generated(seed: number): PlannerState {
  const random = seeded(seed),
    state = fixture();
  state.people.forEach((p) => {
    p.dailyHours = 4 + Math.floor(random() * 5);
  });
  state.members.forEach((m) => {
    m.allocation = [25, 50, 75, 100][Math.floor(random() * 4)];
  });
  state.members[2].weekends = [0, 6];
  state.holidays = [
    {
      id: "h",
      appId: "a",
      date: "2030-01-09",
      name: "Selected holiday",
      personIds: ["p"],
    },
  ];
  state.leaves = [
    {
      id: "l1",
      personId: "p",
      start: "2030-01-07",
      end: "2030-01-08",
      hours: 3,
      note: "Partial",
    },
    {
      id: "l2",
      personId: "p",
      start: "2030-01-08",
      end: "2030-01-08",
      hours: 6,
      note: "Overlap",
    },
    {
      id: "l3",
      personId: "q",
      start: "2030-01-10",
      end: "2030-01-10",
      hours: null,
      note: "Full",
    },
  ];
  state.features = Array.from({ length: 8 }, (_, i) => ({
    ...draft(`feature-${i}`, i % 2 ? "b" : "a"),
    priority: Math.floor(random() * 4),
    tasks: [
      {
        id: `task-${i}`,
        title: `Task ${i}`,
        personId: i % 3 ? "p" : "q",
        scope: "Backend",
        hours: 0.25 * (1 + Math.floor(random() * 240)),
        status: "todo" as const,
        dependsOn: i === 7 ? ["task-0"] : [],
      },
    ],
  }));
  return stateSchema.parse(state);
}
function assertConservation(state: PlannerState, result: Schedule) {
  const global = new Map<string, number>(),
    perApp = new Map<string, number>();
  for (const feature of state.features) {
    const work = feature.tasks.length
      ? feature.tasks
      : (feature.estimateEffort ?? []).map((e) => ({
          id: reservationId(feature.id, e.personId),
          personId: e.personId,
          hours: e.hours,
          status: feature.status,
        }));
    for (const task of work) {
      const forecast = result.tasks[task.id];
      expect(forecast.reason).toBeUndefined();
      expect(
        forecast.days.reduce((sum, day) => sum + day.hours, 0),
      ).toBeCloseTo(task.hours, 7);
      for (const day of forecast.days) {
        expect(day.hours).toBeGreaterThan(0);
        const key = `${task.personId}|${day.date}`,
          appKey = `${feature.appId}|${key}`;
        global.set(key, (global.get(key) ?? 0) + day.hours);
        perApp.set(appKey, (perApp.get(appKey) ?? 0) + day.hours);
      }
    }
  }
  expect(global.size).toBeGreaterThan(0);
  for (const [key, booked] of global) {
    const [personId, date] = key.split("|");
    const daily = state.people.find((p) => p.id === personId)!.dailyHours;
    expect(booked).toBeLessThanOrEqual(daily + 1e-7);
    expect(booked).toBeLessThanOrEqual(
      personCapacity(state, personId, date) + 1e-7,
    );
  }
  for (const [key, booked] of perApp) {
    const [appId, personId, date] = key.split("|");
    // Independently derive the bound from the public calendar rules.
    const person = state.people.find((p) => p.id === personId)!;
    const member = state.members.find(
      (m) => m.appId === appId && m.personId === personId,
    )!;
    const app = state.apps.find((a) => a.id === appId)!;
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    const absence = state.leaves.filter(
      (l) => l.personId === personId && l.start <= date && l.end >= date,
    );
    const absent = absence.some((l) => l.hours === null)
      ? person.dailyHours
      : Math.min(
          person.dailyHours,
          absence.reduce((n, l) => n + (l.hours ?? 0), 0),
        );
    const off =
      (member.weekends ?? app.weekends).includes(weekday) ||
      state.holidays.some(
        (h) =>
          h.appId === appId &&
          h.date === date &&
          (!h.personIds || h.personIds.includes(personId)),
      );
    const expected = off
      ? 0
      : Math.min(
          (person.dailyHours * member.allocation) / 100,
          person.dailyHours - absent,
        );
    expect(booked).toBeLessThanOrEqual(expected + 1e-7);
  }
}

describe("deterministic generated scheduling invariants", () => {
  it.each([1, 7, 19, 41, 73, 101, 409, 8191])(
    "conserves all effort and both daily ledgers without mutating input (seed %i)",
    (seed) => {
      const state = generated(seed),
        saved = structuredClone(state);
      const first = schedule(state, now);
      expect(schedule(state, now)).toEqual(first);
      expect(state).toEqual(saved);
      assertConservation(state, first);
      expect(personCapacity(state, "p", "2030-01-08")).toBe(0);
      expect(
        Object.entries(first.tasks)
          .filter(
            ([id]) =>
              state.features.find((f) => f.tasks[0].id === id)!.tasks[0]
                .personId === "p",
          )
          .flatMap(([, t]) => t.days)
          .some((d) => d.date === "2030-01-08"),
      ).toBe(false);
      expect(first.tasks["task-7"].start! > first.tasks["task-0"].end!).toBe(
        true,
      );
    },
  );

  it.each([3, 11, 29, 53, 97, 211])(
    "adding leave cannot advance isolated single-feature delivery (seed %i)",
    (seed) => {
      const random = seeded(seed),
        state = fixture();
      const hours = 8 * (2 + Math.floor(random() * 15));
      state.features = [
        {
          ...draft("isolated"),
          tasks: [
            {
              id: "only-task",
              title: "Only task",
              personId: "p",
              scope: "Backend",
              hours,
              status: "todo",
              dependsOn: [],
            },
          ],
        },
      ];
      const before = schedule(state, now);
      const next = {
        ...state,
        leaves: [
          {
            id: "added",
            personId: "p",
            start: now,
            end: plus(now, Math.floor(random() * 4)),
            hours: random() < 0.5 ? null : 4,
            note: "Added leave",
          },
        ],
      };
      const after = schedule(next, now);
      expect(
        after.features.isolated.end! >= before.features.isolated.end!,
      ).toBe(true);
      expect(after.features.isolated.hours).toBe(hours);
      expect(
        after.tasks["only-task"].days.reduce((sum, day) => sum + day.hours, 0),
      ).toBe(hours);
    },
  );
});

it("keeps mixed-unit saved hours through simultaneous hours, allocation, weekend, sprint and absence edits", () => {
  const state = fixture();
  const feature = prepareSprintEstimate(
    state,
    {
      ...draft("mixed"),
      sprintEstimate: undefined,
      assigneeEstimates: [
        { personId: "p", unit: "sprints", value: 1.5 },
        { personId: "q", unit: "days", value: 2.25 },
      ],
    },
    now,
  );
  expect(feature.estimateEffort).toEqual([
    { personId: "p", hours: 120 },
    { personId: "q", hours: 13.5 },
  ]);
  const changed = structuredClone(state);
  changed.people[0].dailyHours = 4;
  changed.members[0].allocation = 25;
  changed.members[1].weekends = [0, 5, 6];
  changed.apps[0].cadence = "month";
  changed.sprints[0].start = "2030-02-03";
  changed.sprints[0].end = "2030-03-02";
  changed.leaves.push({
    id: "new-leave",
    personId: "q",
    start: now,
    end: "2030-01-10",
    hours: null,
    note: "Away",
  });
  changed.holidays.push({
    id: "new-holiday",
    appId: "a",
    date: "2030-02-04",
    name: "Holiday",
  });
  const saved = structuredClone(feature),
    input = structuredClone(changed);
  const next = prepareSprintEstimate(
    changed,
    { ...feature, sprintId: "s", title: "Renamed" },
    now,
    feature,
  );
  expect(next.estimateEffort).toEqual(saved.estimateEffort);
  expect(feature).toEqual(saved);
  expect(changed).toEqual(input);
  changed.features = [next];
  expect(schedule(changed, now).features.mixed.hours).toBe(133.5);
  expect(schedule(changed, now).features.mixed.start).toBe("2030-02-03");
});

it("extends template selections across apps while preserving deduplication provenance and independent copies", () => {
  const state = fixture();
  state.calendarTemplates = [
    {
      id: "template",
      name: "Shared calendar",
      entries: [
        {
          id: "holiday-entry",
          name: "Break",
          kind: "holiday",
          start: "2030-01-07",
          end: "2030-01-08",
          hours: null,
        },
        {
          id: "leave-entry",
          name: "Appointment",
          kind: "leave",
          start: "2030-01-09",
          end: "2030-01-09",
          hours: 2,
        },
      ],
    },
  ];
  const original = structuredClone(state);
  const first = applyCalendarTemplate(state, "template", "a", ["p"]);
  const both = applyCalendarTemplate(first, "template", "a", ["p", "q"]);
  const across = applyCalendarTemplate(both, "template", "b", ["p"]);
  const repeated = applyCalendarTemplate(across, "template", "b", ["p"]);
  expect(state).toEqual(original);
  expect(first.holidays.every((h) => h.personIds?.join() === "p")).toBe(true);
  expect(both.holidays).toHaveLength(2);
  expect(repeated.holidays).toHaveLength(4);
  expect(repeated.leaves).toHaveLength(2);
  expect(repeated).toEqual(across);
  expect(
    repeated.leaves.map((l) => [
      l.personId,
      l.templateId,
      l.templateEntryId,
      l.hours,
    ]),
  ).toEqual([
    ["p", "template", "leave-entry", 2],
    ["q", "template", "leave-entry", 2],
  ]);
  expect(
    repeated.holidays.map((h) => [
      h.appId,
      h.date,
      h.personIds,
      h.templateId,
      h.templateEntryId,
    ]),
  ).toEqual([
    ["a", "2030-01-07", ["p", "q"], "template", "holiday-entry"],
    ["a", "2030-01-08", ["p", "q"], "template", "holiday-entry"],
    ["b", "2030-01-07", ["p"], "template", "holiday-entry"],
    ["b", "2030-01-08", ["p"], "template", "holiday-entry"],
  ]);
  const removed = { ...repeated, calendarTemplates: [] };
  expect(capacity(removed, "b", "p", "2030-01-09")).toBe(6);
  expect(capacity(removed, "b", "q", "2030-01-09")).toBe(4);
});

it("combines five-sprint commitments, competing app priority and capped leave with exact resource accounting", () => {
  const state = fixture();
  state.features = [
    prepareSprintEstimate(
      state,
      { ...draft("long"), sprintId: "s", committed: true },
      now,
    ),
  ];
  const accepted = refreshCommitments(state, ["long"], now);
  expect(accepted.features[0].commitment).toEqual({
    end: "2030-03-14",
    acceptedAt: now,
  });
  const changed = structuredClone(accepted);
  changed.features[0].priority = 1;
  changed.features.push({
    ...draft("urgent", "b"),
    tasks: [
      {
        id: "urgent-task",
        title: "Urgent",
        personId: "p",
        scope: "Backend",
        hours: 8,
        status: "todo",
        dependsOn: [],
      },
    ],
  });
  changed.leaves = [
    {
      id: "full",
      personId: "p",
      start: "2030-01-08",
      end: "2030-01-08",
      hours: null,
      note: "Away",
    },
    {
      id: "overlap",
      personId: "p",
      start: "2030-01-08",
      end: "2030-01-09",
      hours: 4,
      note: "Appointment",
    },
  ];
  changed.holidays = [
    {
      id: "same-day",
      appId: "a",
      date: "2030-01-08",
      name: "Overlapping holiday",
      personIds: ["p"],
    },
  ];
  const forecast = schedule(changed, now);
  expect(forecast.features.long).toMatchObject({
    end: "2030-03-19",
    hours: 700,
    commitmentDelayed: true,
    delayDays: 5,
  });
  expect(forecast.tasks[reservationId("long", "q")].end).toBe("2030-03-14");
  expect(forecast.features.urgent.end).toBe(now);
  expect(
    resources(changed, changed.sprints[0], forecast).map((r) => [
      r.person.id,
      r.available,
      r.demand,
      r.scheduled,
      r.other,
    ]),
  ).toEqual([
    ["p", 68, 400, 60, 8],
    ["q", 60, 300, 60, 0],
  ]);
  assertConservation(changed, forecast);
  expect(changed.features[0].commitment).toEqual(
    accepted.features[0].commitment,
  );
  expect(changed.features[0].estimateEffort).toEqual([
    { personId: "p", hours: 400 },
    { personId: "q", hours: 300 },
  ]);
  const refreshed = refreshCommitments(changed, ["long"], now);
  expect(refreshed.features[0].commitment?.end).toBe("2030-03-28");
  expect(refreshed.sprints[0]).toMatchObject({
    snapshot: "Accepted plan",
    draft: "Custom draft",
  });
});
