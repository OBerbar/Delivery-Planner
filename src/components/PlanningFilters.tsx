import type { PlannerState } from "../lib/model";
import { statusLabels } from "../lib/date-status";
import { emptyFeatureFilters, hasFeatureFilters } from "../lib/feature-filters";
import { useViewPreferences } from "../lib/use-view-preferences";
import { Button, MultiPick } from "./ui";

export function PlanningFilters({
  state,
  appId,
  screen,
  count,
  total,
  occurrences,
}: {
  state: PlannerState;
  appId: string;
  screen: "Timeline" | "Features";
  count: number;
  total: number;
  occurrences?: number;
}) {
  const { preferences, setPreferences } = useViewPreferences();
  const memberIds = state.members
    .filter((member) => member.appId === appId)
    .map((member) => member.personId);
  const fields = [
    {
      key: "person",
      all: "All people",
      options: state.people
        .filter((person) => memberIds.includes(person.id))
        .map((person) => ({ id: person.id, label: person.name })),
    },
    {
      key: "sprint",
      all: "All sprints",
      options: [
        { id: "unassigned", label: "No assigned sprint" },
        ...state.sprints
          .filter((sprint) => sprint.appId === appId)
          .map((sprint) => ({
            id: sprint.id,
            label: `Sprint ${sprint.number}`,
          })),
      ],
    },
    {
      key: "status",
      all: "All statuses",
      options: Object.entries(statusLabels).map(([id, label]) => ({
        id,
        label,
      })),
    },
    {
      key: "risk",
      all: "All risk",
      options: [
        { id: "at-risk", label: "At risk" },
        { id: "on-track", label: "On track" },
        { id: "unaccepted", label: "No accepted date" },
      ],
    },
  ] as const;
  return (
    <div
      className="timeline-filters"
      role="region"
      aria-label={`${screen} display filters`}
    >
      <h2 className="sr-only">{screen} filters</h2>
      {fields.map((field) => (
        <MultiPick
          key={field.key}
          label={`Filter by ${field.key}`}
          allLabel={field.all}
          options={field.options}
          value={preferences[field.key]}
          onChange={(values) =>
            setPreferences((previous) => ({ ...previous, [field.key]: values }))
          }
        />
      ))}
      {hasFeatureFilters(preferences) && (
        <Button
          variant="ghost"
          onPress={() =>
            setPreferences((previous) => ({
              ...previous,
              ...emptyFeatureFilters(),
            }))
          }
        >
          Reset filters
        </Button>
      )}
      <p className="timeline-filter-note">
        Showing {count} of {total} features
        {occurrences !== undefined
          ? ` · ${occurrences} occurrences`
          : ""} ·{" "}
        {screen === "Timeline"
          ? "Filters change this view only. PDF includes all app work."
          : "Filters also apply on Timeline. Search narrows these results."}
      </p>
    </div>
  );
}
