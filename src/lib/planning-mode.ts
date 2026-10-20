import { createContext, useContext } from "react";
export const PlanningModeContext = createContext(false);
export const usePlanningMode = () => useContext(PlanningModeContext);
