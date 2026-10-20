import type { PlannerState } from "./model";
import { addDays, format, parseISO } from "date-fns";

export interface CalendarEvent {
  id: string;
  kind: "holiday" | "leave";
  name: string;
  start: string;
  end: string;
  personIds: string[];
  personNames: string[];
  hours: number | null;
}

export function calendarEvents(
  state: PlannerState,
  appId: string,
  start: string,
  end: string,
): CalendarEvent[] {
  const memberIds = state.members
    .filter((member) => member.appId === appId)
    .map((member) => member.personId);
  const names = new Map(state.people.map((person) => [person.id, person.name]));
  const events: CalendarEvent[] = [];
  // Read applied records only. Templates themselves never imply an absence.
  const holidays = state.holidays;
  const groups = new Map<string, typeof holidays>();
  for (const holiday of holidays) {
    if (holiday.appId !== appId) continue;
    const scope =
      holiday.personIds === undefined ? null : [...holiday.personIds].sort();
    const key = JSON.stringify([
      holiday.name,
      scope,
      holiday.templateId ?? null,
      holiday.templateEntryId ?? null,
    ]);
    const group = groups.get(key) ?? [];
    group.push(holiday);
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    group.sort(
      (a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id),
    );
    let range: CalendarEvent | undefined;
    for (const holiday of group) {
      if (
        range &&
        holiday.date <= format(addDays(parseISO(range.end), 1), "yyyy-MM-dd")
      ) {
        range.end = holiday.date;
        continue;
      }
      const personIds = memberIds.filter(
        (personId) =>
          holiday.personIds === undefined ||
          holiday.personIds.includes(personId),
      );
      if (holiday.personIds !== undefined && !personIds.length) continue;
      range = {
        id: `holiday:${holiday.id}`,
        kind: "holiday",
        name: holiday.name,
        start: holiday.date,
        end: holiday.date,
        personIds,
        personNames: personIds.map(
          (personId) => names.get(personId) ?? personId,
        ),
        hours: null,
      };
      events.push(range);
    }
  }
  for (const leave of state.leaves) {
    if (!memberIds.includes(leave.personId)) continue;
    events.push({
      id: `leave:${leave.id}`,
      kind: "leave",
      name: leave.note.trim() || "Personal leave",
      start: leave.start,
      end: leave.end,
      personIds: [leave.personId],
      personNames: [names.get(leave.personId) ?? leave.personId],
      hours: leave.hours,
    });
  }
  return events
    .filter((event) => event.start <= end && event.end >= start)
    .sort(
      (a, b) =>
        a.start.localeCompare(b.start) ||
        a.name.localeCompare(b.name) ||
        a.id.localeCompare(b.id),
    );
}
