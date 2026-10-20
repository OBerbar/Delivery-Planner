import {
  reservationId,
  type AssigneeEstimate,
  type Feature,
  type PlannerState,
  type Task,
} from "./model";

/** Internal bookings give feature estimates the same resource ledger as tasks. */
export function featureWork(state: PlannerState, feature: Feature): Task[] {
  if (feature.tasks.length)
    return feature.tasks.map((task) => ({
      ...task,
      ...(feature.planningFrom && task.status !== "done"
        ? { status: "todo" as const, unblockDate: undefined }
        : {}),
      dependsOn: [
        ...new Set([
          ...task.dependsOn,
          ...(task.dependsOnFeatures ?? []).flatMap((id) => {
            const dependency = state.features.find((f) => f.id === id);
            if (!dependency) return [];
            return dependency.tasks.length
              ? dependency.tasks.map((t) => t.id)
              : (dependency.assigneeIds ?? []).map((p) =>
                  reservationId(dependency.id, p),
                );
          }),
        ]),
      ],
    }));
  return (feature.assigneeIds ?? []).map((personId) => ({
    id: reservationId(feature.id, personId),
    title: feature.title,
    personId,
    scope:
      state.members.find(
        (m) => m.appId === feature.appId && m.personId === personId,
      )?.role ?? "Delivery",
    hours:
      feature.estimateEffort?.find((e) => e.personId === personId)?.hours ?? 0,
    status:
      feature.planningFrom && feature.status !== "done"
        ? "todo"
        : (feature.status ?? "todo"),
    dependsOn: [],
    unblockDate: feature.planningFrom ? undefined : feature.unblockDate,
    actualStart: feature.actualStart,
    actualEnd: feature.actualEnd,
  }));
}

export function featureAssignees(feature: Feature): string[] {
  return [
    ...new Set(
      feature.tasks.length
        ? feature.tasks.map((t) => t.personId)
        : (feature.assigneeIds ?? []),
    ),
  ];
}

export const sprintLabel = (estimate: number) =>
  `${estimate} sprint${estimate === 1 ? "" : "s"}`;

export const WORKING_DAYS_PER_SPRINT = 10;

export function featureEstimates(feature: Feature): AssigneeEstimate[] {
  return (
    feature.assigneeEstimates ??
    (feature.sprintEstimate !== undefined
      ? (feature.assigneeIds ?? []).map((personId) => ({
          personId,
          unit: "sprints",
          value: feature.sprintEstimate!,
        }))
      : [])
  );
}

export function estimateLabel(estimate: AssigneeEstimate): string {
  return estimate.unit === "sprints"
    ? sprintLabel(estimate.value)
    : `${estimate.value} working day${estimate.value === 1 ? "" : "s"}`;
}

export function featureEstimateLabel(
  feature: Feature,
  personId?: string,
): string {
  const estimates = featureEstimates(feature);
  if (personId) {
    const estimate = estimates.find((e) => e.personId === personId);
    return estimate ? estimateLabel(estimate) : "No estimate";
  }
  if (!estimates.length)
    return feature.sprintEstimate
      ? sprintLabel(feature.sprintEstimate)
      : "No estimate";
  const first = estimates[0];
  return estimates.every(
    (e) => e.unit === first.unit && e.value === first.value,
  )
    ? estimateLabel(first)
    : "Estimates by person";
}
