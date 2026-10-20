import type { Feature, PlannerState } from "./model";
import type { Schedule } from "./planning";
import { featureConstraints, type PersonDelay } from "./delay-explanation";
import { differenceInCalendarDays, parseISO } from "date-fns";
import {
  featureEstimates,
  featureWork,
  WORKING_DAYS_PER_SPRINT,
} from "./feature-work";
import { remainingWorkHours, workIsDone } from "./date-status";

export interface OverviewPerson {
  personId: string;
  name: string;
  role: string;
  allocation: number;
  estimatedDays: number;
  inputEstimateDays?: number;
  remainingDays: number;
  allocatedDays: number;
  reassignedDays: number;
  start?: string;
  end?: string;
  reason?: string;
  completed: boolean;
  determinesDelivery: boolean;
}
export interface FeatureOverview {
  start?: string;
  end?: string;
  calendarDays?: number;
  people: OverviewPerson[];
  sharedEffortDays?: number;
  sharedInputEstimateDays?: number;
  allTeam: boolean;
  constraints: PersonDelay[];
}
/** Derive the drawer's read-only view from saved effort and the displayed forecast. */
export function featureOverview(
  state: PlannerState,
  feature: Feature,
  forecast: Schedule,
): FeatureOverview {
  const range = forecast.features[feature.id];
  const work = featureWork(state, feature);
  // Task effort supersedes main-assignee inputs retained by the feature editor.
  const inputEstimates = feature.tasks.length ? [] : featureEstimates(feature);
  const people = [...new Set(work.map((task) => task.personId))].map(
    (personId): OverviewPerson => {
      const person = state.people.find((p) => p.id === personId)!;
      const member = state.members.find(
        (m) => m.appId === feature.appId && m.personId === personId,
      );
      const tasks = work.filter((task) => task.personId === personId);
      const input = inputEstimates.find(
        (estimate) => estimate.personId === personId,
      );
      const inputDays = input
        ? input.value * (input.unit === "sprints" ? WORKING_DAYS_PER_SPRINT : 1)
        : undefined;
      const bookings = tasks.map((task) => forecast.tasks[task.id]);
      const starts = bookings
        .flatMap((booking) => (booking?.start ? [booking.start] : []))
        .sort();
      const ends = bookings
        .flatMap((booking) => (booking?.end ? [booking.end] : []))
        .sort();
      // A scheduled subset is useful context, but cannot establish a complete finish.
      const end = bookings.every((booking) => booking?.end)
        ? ends.at(-1)
        : undefined;
      return {
        personId,
        name: person.name,
        role: member?.role ?? tasks[0].scope,
        allocation: member?.allocation ?? 0,
        inputEstimateDays:
          inputDays !== undefined && Number.isFinite(inputDays) && inputDays > 0
            ? inputDays
            : undefined,
        estimatedDays:
          tasks.reduce((sum, task) => sum + task.hours, 0) / person.dailyHours,
        remainingDays:
          tasks.reduce(
            (sum, task) => sum + remainingWorkHours(feature, task, forecast),
            0,
          ) / person.dailyHours,
        allocatedDays:
          bookings
            .flatMap((booking) => booking?.days ?? [])
            .reduce((sum, day) => sum + day.hours, 0) / person.dailyHours,
        reassignedDays:
          bookings
            .flatMap((booking) => booking?.capacityReassigned ?? [])
            .reduce((sum, day) => sum + day.hours, 0) / person.dailyHours,
        start: starts[0],
        end,
        reason: bookings.map((booking) => booking?.reason).find(Boolean),
        completed: tasks.every((task) => workIsDone(feature, task, forecast)),
        determinesDelivery: !!range?.end && end === range.end,
      };
    },
  );
  const members = state.members.filter(
    (member) => member.appId === feature.appId,
  );
  const shared = people[0]?.estimatedDays;
  const sharedInput = people[0]?.inputEstimateDays;
  return {
    start: range?.start,
    end: range?.end,
    calendarDays:
      range?.start && range.end
        ? differenceInCalendarDays(parseISO(range.end), parseISO(range.start)) +
          1
        : undefined,
    people,
    sharedEffortDays:
      shared !== undefined &&
      people.every((person) => Math.abs(person.estimatedDays - shared) < 1e-7)
        ? shared
        : undefined,
    sharedInputEstimateDays:
      sharedInput !== undefined &&
      people.every(
        (person) =>
          person.inputEstimateDays !== undefined &&
          Math.abs(person.inputEstimateDays - sharedInput) < 1e-7,
      )
        ? sharedInput
        : undefined,
    allTeam:
      members.length > 0 &&
      members.every((member) =>
        people.some((person) => person.personId === member.personId),
      ),
    constraints: featureConstraints(state, feature, forecast),
  };
}
