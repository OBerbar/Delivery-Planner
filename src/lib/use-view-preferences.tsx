import {
  createContext,
  useContext,
  useEffect,
  useState,
  type Dispatch,
  type SetStateAction,
  type ReactNode,
} from "react";
import { today, type PlannerState } from "./model";
import {
  readTimelinePreferences,
  writeTimelinePreferences,
  type TimelinePreferences,
} from "./view-preferences";

const ViewPreferencesContext = createContext<{
  preferences: TimelinePreferences;
  setPreferences: Dispatch<SetStateAction<TimelinePreferences>>;
} | null>(null);

/** One per-app display state shared by Timeline and Features, including sample tabs. */
export function ViewPreferencesProvider({
  appId,
  state,
  children,
}: {
  appId: string;
  state: PlannerState;
  children: ReactNode;
}) {
  const personIds = state.members
    .filter((member) => member.appId === appId)
    .map((member) => member.personId);
  const sprintIds = state.sprints
    .filter((sprint) => sprint.appId === appId)
    .map((sprint) => sprint.id);
  const [preferences, setPreferences] = useState(() =>
    readTimelinePreferences(appId, today(), undefined, {
      personIds,
      sprintIds,
    }),
  );
  const peopleKey = JSON.stringify(personIds),
    sprintKey = JSON.stringify(sprintIds);
  useEffect(() => {
    setPreferences((previous) => {
      const person = previous.person.filter((id) => personIds.includes(id));
      const sprint = previous.sprint.filter(
        (id) => id === "unassigned" || sprintIds.includes(id),
      );
      return person.length === previous.person.length &&
        sprint.length === previous.sprint.length
        ? previous
        : { ...previous, person, sprint };
    });
  }, [peopleKey, sprintKey]);
  useEffect(() => {
    writeTimelinePreferences(appId, preferences);
  }, [appId, preferences]);
  return (
    <ViewPreferencesContext.Provider value={{ preferences, setPreferences }}>
      {children}
    </ViewPreferencesContext.Provider>
  );
}

export function useViewPreferences() {
  const context = useContext(ViewPreferencesContext);
  if (!context)
    throw new Error("Planning views require ViewPreferencesProvider");
  return context;
}
