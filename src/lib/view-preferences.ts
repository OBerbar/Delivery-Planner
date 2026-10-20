import { isSampleWorkspace } from "./sample-workspace";

export interface TimelinePreferences {
  view: "features" | "people";
  zoom: "day" | "week" | "month";
  months: "1" | "2" | "3" | "4" | "5" | "6";
  start: string;
  availabilityCollapsed: boolean;
  person: string;
  sprint: string;
  status: "all" | "todo" | "doing" | "blocked" | "done";
  risk: "all" | "at-risk" | "on-track" | "unaccepted";
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
    person: "all",
    sprint: "all",
    status: "all",
    risk: "all",
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
    if (value.version !== 1) return defaults;
    const select = <T extends string>(
      field: string,
      choices: readonly T[],
      fallback: T,
    ): T =>
      choices.includes(value[field] as T) ? (value[field] as T) : fallback;
    const identifier = (
      field: string,
      ids?: string[],
      extra: string[] = [],
    ) => {
      const id = value[field];
      return typeof id === "string" &&
        id.length > 0 &&
        id.length <= 200 &&
        (!ids || id === "all" || extra.includes(id) || ids.includes(id))
        ? id
        : "all";
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
      person: identifier("person", records?.personIds),
      sprint: identifier("sprint", records?.sprintIds, ["unassigned"]),
      status: select(
        "status",
        ["all", "todo", "doing", "blocked", "done"],
        defaults.status,
      ),
      risk: select(
        "risk",
        ["all", "at-risk", "on-track", "unaccepted"],
        defaults.risk,
      ),
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
      JSON.stringify({ ...preferences, version: 1 }),
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
