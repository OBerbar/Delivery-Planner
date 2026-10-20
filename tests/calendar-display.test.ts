import { describe, expect, it } from "vitest";
import { emptyState } from "../src/lib/model";
import { calendarEvents } from "../src/lib/calendar-display";

const base = {
  ...emptyState,
  people: [
    { id: "alex", name: "Alex", dailyHours: 8 },
    { id: "sam", name: "Sam", dailyHours: 8 },
  ],
  members: [
    {
      id: "ma",
      appId: "app",
      personId: "alex",
      role: "Backend",
      allocation: 100,
      weekends: null,
    },
    {
      id: "ms",
      appId: "app",
      personId: "sam",
      role: "Design",
      allocation: 100,
      weekends: null,
    },
  ],
};

describe("calendar event ranges", () => {
  it("joins consecutive holidays by scope and source while preserving complete dates", () => {
    const state = {
      ...base,
      holidays: [
        {
          id: "h2",
          appId: "app",
          date: "2026-10-13",
          name: "Autumn",
          personIds: ["sam", "alex"],
          templateId: "t",
          templateEntryId: "entry",
        },
        {
          id: "h1",
          appId: "app",
          date: "2026-10-12",
          name: "Autumn",
          personIds: ["alex", "sam"],
          templateId: "t",
          templateEntryId: "entry",
        },
        {
          id: "h3",
          appId: "app",
          date: "2026-10-14",
          name: "Autumn",
          personIds: ["alex"],
          templateId: "t",
          templateEntryId: "entry",
        },
        {
          id: "h4",
          appId: "app",
          date: "2026-10-15",
          name: "Autumn",
          personIds: ["alex"],
          templateId: "other",
          templateEntryId: "entry",
        },
      ],
    };
    const events = calendarEvents(state, "app", "2026-10-13", "2026-10-15");
    expect(events).toHaveLength(3);
    expect(events[0]).toMatchObject({
      name: "Autumn",
      start: "2026-10-12",
      end: "2026-10-13",
      personNames: ["Alex", "Sam"],
    });
    expect(state.holidays[0].id).toBe("h2");
  });

  it("shows app members' global leave with hours but excludes other people and outside dates", () => {
    const state = {
      ...base,
      leaves: [
        {
          id: "leave",
          personId: "sam",
          start: "2026-10-01",
          end: "2026-10-15",
          hours: 3,
          note: "Family appointment",
        },
        {
          id: "other",
          personId: "elsewhere",
          start: "2026-10-13",
          end: "2026-10-14",
          hours: null,
          note: "Elsewhere",
        },
        {
          id: "past",
          personId: "alex",
          start: "2026-09-01",
          end: "2026-09-15",
          hours: null,
          note: "Past",
        },
      ],
    };
    expect(
      calendarEvents(state, "app", "2026-10-13", "2026-10-20"),
    ).toMatchObject([
      {
        kind: "leave",
        name: "Family appointment",
        hours: 3,
        personNames: ["Sam"],
        start: "2026-10-01",
        end: "2026-10-15",
      },
    ]);
  });

  it("keeps unapplied template entries inert and expands legacy whole-app holiday people", () => {
    const state = {
      ...base,
      holidays: [
        { id: "h", appId: "app", date: "2026-10-13", name: "Legacy holiday" },
      ],
      calendarTemplates: [
        {
          id: "t",
          name: "Unapplied",
          entries: [
            {
              id: "e",
              kind: "holiday" as const,
              name: "Do not show",
              start: "2026-10-13",
              end: "2026-10-14",
              hours: null,
            },
          ],
        },
      ],
    };
    const events = calendarEvents(state, "app", "2026-10-08", "2026-10-20");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      name: "Legacy holiday",
      personNames: ["Alex", "Sam"],
    });
  });
});
