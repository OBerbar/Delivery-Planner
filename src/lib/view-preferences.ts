import { isSampleWorkspace } from "./sample-workspace";
import {
  emptyFeatureFilters,
  type FeatureFilterSelections,
} from "./feature-filters";

export interface TimelinePreferences extends FeatureFilterSelections {
  view: "features" | "people";
  zoom: "day" | "week" | "month";
  months: "1" | "2" | "3" | "4" | "5" | "6";
  start: string;
  availabilityCollapsed: boolean;
}
export interface PreferenceStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}
export interface TimelinePreferenceRecords {
  personIds: string[];
  sprintIds: string[];
}
export const timelinePreferencesKey = (appId: string) =>
  `sprint-studio:timeline:v1:${appId}`;

export function defaultTimelinePreferences(today: string): TimelinePreferences {
  return {
    view: "features",
    zoom: "month",
    months: "2",
    start: today,
    availabilityCollapsed: false,
    ...emptyFeatureFilters(),
  };
}
export function readTimelinePreferences(
  appId: string,
  today: string,
  storage?: PreferenceStorage | null,
  records?: TimelinePreferenceRecords,
): TimelinePreferences {
  const defaults = defaultTimelinePreferences(today);
  try {
    const raw = (storage === undefined ? browserStorage() : storage)?.getItem(
      timelinePreferencesKey(appId),
    );
    if (!raw) return defaults;
    const saved: unknown = JSON.parse(raw);
    if (!saved || typeof saved !== "object" || Array.isArray(saved))
      return defaults;
    const value = saved as Record<string, unknown>;
    if (value.version !== 1 && value.version !== 2) return defaults;
    const select = <T extends string>(
      field: string,
      choices: readonly T[],
      fallback: T,
    ): T =>
      choices.includes(value[field] as T) ? (value[field] as T) : fallback;
    const selection = (field: string, ids?: string[], extra: string[] = []) => {
      const raw = value[field];
      const values = Array.isArray(raw)
        ? raw
        : typeof raw === "string"
          ? [raw]
          : [];
      if (values.includes("all")) return [];
      return [...new Set(values)].filter(
        (id): id is string =>
          typeof id === "string" &&
          id.length > 0 &&
          id.length <= 200 &&
          (!ids || extra.includes(id) || ids.includes(id)),
      );
    };
    return {
      view: select("view", ["features", "people"], defaults.view),
      zoom: select("zoom", ["day", "week", "month"], defaults.zoom),
      months: select("months", ["1", "2", "3", "4", "5", "6"], defaults.months),
      start: validDate(value.start) ? value.start : defaults.start,
      availabilityCollapsed:
        typeof value.availabilityCollapsed === "boolean"
          ? value.availabilityCollapsed
          : false,
      person: selection("person", records?.personIds),
      sprint: selection("sprint", records?.sprintIds, ["unassigned"]),
      status: selection("status", ["all", "todo", "doing", "blocked", "done"]),
      risk: selection("risk", ["all", "at-risk", "on-track", "unaccepted"]),
    };
  } catch {
    return defaults;
  }
}
export function writeTimelinePreferences(
  appId: string,
  preferences: TimelinePreferences,
  storage?: PreferenceStorage | null,
): boolean {
  try {
    const target = storage === undefined ? browserStorage() : storage;
    if (!target) return false;
    target.setItem(
      timelinePreferencesKey(appId),
      JSON.stringify({ ...preferences, version: 2 }),
    );
    return true;
  } catch {
    return false;
  }
}

function browserStorage(): PreferenceStorage | null {
  try {
    return typeof window === "undefined" || isSampleWorkspace()
      ? null
      : window.localStorage;
  } catch {
    return null;
  }
}
function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const date = new Date(`${value}T12:00:00Z`);
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}
