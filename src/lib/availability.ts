import { addDays, format, parseISO } from "date-fns";
import {
  calendarTemplateSchema,
  stateSchema,
  uid,
  type Holiday,
  type PlannerState,
} from "./model";

export function holidayApplies(
  holiday: Holiday,
  appId: string,
  personId: string,
  date: string,
): boolean {
  return (
    holiday.appId === appId &&
    holiday.date === date &&
    (holiday.personIds === undefined || holiday.personIds.includes(personId))
  );
}

/** Apply independent calendar copies. Repeated application cannot double-book absence. */
export function applyCalendarTemplate(
  state: PlannerState,
  templateId: string,
  appId: string,
  personIds: string[],
): PlannerState {
  const source = state.calendarTemplates?.find((t) => t.id === templateId);
  if (!source) throw new Error("Choose an existing calendar template.");
  const template = calendarTemplateSchema.parse(source);
  if (!state.apps.some((a) => a.id === appId))
    throw new Error("Choose an app for this calendar.");
  if (!personIds.length)
    throw new Error("Select at least one person for this calendar.");
  if (
    new Set(personIds).size !== personIds.length ||
    personIds.some(
      (p) => !state.members.some((m) => m.appId === appId && m.personId === p),
    )
  )
    throw new Error(
      "Selected calendar people must be unique members of this app.",
    );
  const next = {
    ...state,
    holidays: state.holidays.map((h) => ({
      ...h,
      ...(h.personIds ? { personIds: [...h.personIds] } : {}),
    })),
    leaves: [...state.leaves],
  };
  for (const entry of template.entries) {
    const provenance = { templateId: template.id, templateEntryId: entry.id };
    if (entry.kind === "leave") {
      for (const personId of personIds) {
        if (
          !next.leaves.some(
            (l) =>
              l.templateId === template.id &&
              l.templateEntryId === entry.id &&
              l.personId === personId &&
              l.start === entry.start &&
              l.end === entry.end,
          )
        )
          next.leaves.push({
            id: uid(),
            personId,
            start: entry.start,
            end: entry.end,
            hours:
              entry.hours === null
                ? null
                : entry.dayFraction === undefined
                  ? entry.hours
                  : +(
                      entry.dayFraction *
                      state.people.find((p) => p.id === personId)!.dailyHours
                    ).toFixed(6),
            note: entry.name,
            ...provenance,
          });
      }
    } else {
      for (
        let date = entry.start;
        date <= entry.end;
        date = format(addDays(parseISO(date), 1), "yyyy-MM-dd")
      ) {
        const existing = next.holidays.find(
          (h) =>
            h.templateId === template.id &&
            h.templateEntryId === entry.id &&
            h.appId === appId &&
            h.date === date,
        );
        if (existing) {
          if (existing.personIds)
            existing.personIds = [
              ...new Set([...existing.personIds, ...personIds]),
            ];
        } else
          next.holidays.push({
            id: uid(),
            appId,
            date,
            name: entry.name,
            personIds: [...personIds],
            ...provenance,
          });
      }
    }
  }
  return stateSchema.parse(next);
}
