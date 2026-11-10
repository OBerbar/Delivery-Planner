import type { Feature } from "./model";
import type { Schedule } from "./planning";
import { featureAssignees } from "./feature-work";
import { featureStatus } from "./date-status";

export interface FeatureFilterSelections {
  person: string[];
  sprint: string[];
  status: string[];
  risk: string[];
}
export const emptyFeatureFilters = (): FeatureFilterSelections => ({
  person: [],
  sprint: [],
  status: [],
  risk: [],
});
export const hasFeatureFilters = (filters: FeatureFilterSelections) =>
  [filters.person, filters.sprint, filters.status, filters.risk].some(
    (values) => values.length > 0,
  );

/** Any selection within a category, every active category across a feature. */
export function matchesFeatureFilters(
  feature: Feature,
  filters: FeatureFilterSelections,
  forecast: Schedule,
  now: string,
) {
  const result = forecast.features[feature.id];
  const risk =
    feature.committed && feature.commitment
      ? result?.commitmentDelayed
        ? "at-risk"
        : "on-track"
      : "unaccepted";
  return (
    (!filters.person.length ||
      featureAssignees(feature).some((id) => filters.person.includes(id))) &&
    (!filters.sprint.length ||
      filters.sprint.includes(feature.sprintId ?? "unassigned")) &&
    (!filters.status.length ||
      filters.status.includes(featureStatus(feature, result ?? {}, now))) &&
    (!filters.risk.length || filters.risk.includes(risk))
  );
}
