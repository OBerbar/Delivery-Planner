import { uid, type Feature, type PlannerState } from "./model";

/** A legacy feature is its own group until another occurrence is added. */
export function occurrenceGroupId(feature: Feature): string {
  return feature.occurrenceGroupId ?? feature.id;
}

export function featureOccurrences(
  features: Feature[],
  feature: Feature,
): Feature[] {
  return features.filter(
    (candidate) =>
      candidate.appId === feature.appId &&
      occurrenceGroupId(candidate) === occurrenceGroupId(feature),
  );
}

export function groupOccurrences(features: Feature[]): Feature[][] {
  const groups = new Map<string, Feature[]>();
  for (const feature of features) {
    const key = JSON.stringify([feature.appId, occurrenceGroupId(feature)]);
    const group = groups.get(key);
    if (group) group.push(feature);
    else groups.set(key, [feature]);
  }
  return [...groups.values()];
}

export function occurrenceLabel(state: PlannerState, feature: Feature): string {
  const index = featureOccurrences(state.features, feature).findIndex(
    (candidate) => candidate.id === feature.id,
  );
  const sprint = state.sprints.find(
    (candidate) =>
      candidate.id === feature.sprintId && candidate.appId === feature.appId,
  );
  return `Occurrence ${index < 0 ? featureOccurrences(state.features, feature).length + 1 : index + 1}${sprint ? ` · Sprint ${sprint.number}` : ""}`;
}

/** Create a draft only: saved records remain untouched until applyFeatureChange. */
export function createOccurrence(
  _state: PlannerState,
  source: Feature,
  now: string,
  newId: string = uid(),
): Feature {
  const copy = structuredClone(source);
  const taskIds = new Map(copy.tasks.map((task) => [task.id, uid()]));
  return {
    ...copy,
    id: newId,
    occurrenceGroupId: occurrenceGroupId(source),
    sprintId: undefined,
    target: undefined,
    notBefore: undefined,
    commitment: undefined,
    committed: false,
    actualStart: undefined,
    actualEnd: undefined,
    status: "todo",
    blocked: false,
    unblockDate: undefined,
    planningFrom: now,
    tasks: copy.tasks.map((task) => ({
      ...task,
      id: taskIds.get(task.id)!,
      dependsOn: task.dependsOn.flatMap((id) =>
        taskIds.has(id) ? [taskIds.get(id)!] : [],
      ),
      dependsOnFeatures: undefined,
      status: "todo",
      actualStart: undefined,
      actualEnd: undefined,
      unblockDate: undefined,
    })),
  };
}
