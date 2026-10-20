import {
  assigneeEstimateSchema,
  type AssigneeEstimate,
  type Feature,
  type PlannerState,
} from "./model";
import { featureEstimates, WORKING_DAYS_PER_SPRINT } from "./feature-work";

// Match the eight-decimal precision used by the modal's unit conversion.
const sprintUnitsOf = (estimate: AssigneeEstimate) =>
  Number(
    (
      estimate.value *
      (estimate.unit === "days" ? 1 / WORKING_DAYS_PER_SPRINT : 1)
    ).toFixed(8),
  );

/** Save working-day effort once; calendars and leave affect delivery, not scope. */
export function prepareSprintEstimate(
  state: PlannerState,
  feature: Feature,
  _now: string,
  previous?: Feature,
): Feature {
  if (feature.tasks.length) return { ...feature, estimateEffort: undefined };
  const assignees = feature.assigneeIds ?? [];
  if (
    feature.assigneeEstimates === undefined &&
    (!feature.sprintEstimate ||
      !Number.isFinite(feature.sprintEstimate) ||
      feature.sprintEstimate < 0.5 ||
      feature.sprintEstimate > 100)
  )
    throw new Error("Sprint estimation must be between 0.5 and 100 sprints.");
  if (!assignees.length) throw new Error("Select at least one main assignee.");
  const estimates = featureEstimates(feature);
  if (
    new Set(assignees).size !== assignees.length ||
    estimates.length !== assignees.length ||
    new Set(estimates.map((e) => e.personId)).size !== estimates.length ||
    assignees.some((p) => !estimates.some((e) => e.personId === p))
  )
    throw new Error(
      "Individual estimates must match the selected main assignees.",
    );
  if (!state.apps.some((a) => a.id === feature.appId))
    throw new Error("Choose an app before estimating work.");
  const previousEstimates =
    previous && !previous.tasks.length && previous.appId === feature.appId
      ? featureEstimates(previous)
      : [];
  const estimateEffort = estimates.map((raw) => {
    const person = state.people.find((p) => p.id === raw.personId);
    const member = state.members.find(
      (m) => m.appId === feature.appId && m.personId === raw.personId,
    );
    if (!person || !member)
      throw new Error("Selected assignees must belong to this app.");
    const parsed = assigneeEstimateSchema.safeParse(raw);
    if (!parsed.success)
      throw new Error(
        `${person.name}: enter ${raw.unit === "days" ? "0.25–1000 working days" : "0.5–100 sprints"}.`,
      );
    const estimate = parsed.data;
    const before = previousEstimates.find(
      (e) => e.personId === estimate.personId,
    );
    const saved = previous?.estimateEffort?.find(
      (e) => e.personId === estimate.personId,
    );
    if (before && sprintUnitsOf(before) === sprintUnitsOf(estimate) && saved)
      return { ...saved };
    const workingDays =
      estimate.value *
      (estimate.unit === "sprints" ? WORKING_DAYS_PER_SPRINT : 1);
    const hours = (workingDays * person.dailyHours * member.allocation) / 100;
    return { personId: estimate.personId, hours: +hours.toFixed(6) };
  });
  return { ...feature, estimateEffort };
}
