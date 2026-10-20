import { getDay, parseISO } from "date-fns";
import type { AppConfig, Sprint } from "./model";
import { plus, sprintEnd } from "./planning";

export function commonWeekends(
  appWeekends: number[],
  memberOverrides: (number[] | null)[],
) {
  const calendars = memberOverrides.length
    ? memberOverrides.map((override) => override ?? appWeekends)
    : [appWeekends];
  return [0, 1, 2, 3, 4, 5, 6].filter((day) =>
    calendars.every((weekends) => weekends.includes(day)),
  );
}

export function sprintPeriod(
  requestedStart: string,
  app: Pick<AppConfig, "cadence" | "customDays">,
  weekends: number[],
) {
  const isWeekend = (date: string) => weekends.includes(getDay(parseISO(date)));
  let start = requestedStart;
  // Valid app/member calendars always leave at least one weekday available.
  for (let i = 0; i < 7 && isWeekend(start); i++) start = plus(start, 1);
  let end = sprintEnd(start, app.cadence, app.customDays);
  while (end > start && isWeekend(end)) end = plus(end, -1);
  return { start, end };
}

export function nextSprintPeriod(
  app: AppConfig,
  weekends: number[],
  prior?: Pick<Sprint, "start" | "end">,
) {
  return sprintPeriod(
    prior ? plus(prior.end, 1) : app.planningStart,
    app,
    weekends,
  );
}
