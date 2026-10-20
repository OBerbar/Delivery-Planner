import { useEffect, useState } from "react";
import { today } from "./model";

/** Refresh the local calendar day without changing saved planning data. */
export function useToday(): string {
  const [currentDate, setCurrentDate] = useState(today);
  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;
    const refresh = () => {
      setCurrentDate(today());
      clearTimeout(timeout);
      const now = new Date();
      const midnight = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + 1,
      );
      timeout = setTimeout(refresh, midnight.getTime() - now.getTime());
    };
    const visible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    refresh();
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", visible);
    return () => {
      clearTimeout(timeout);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", visible);
    };
  }, []);
  return currentDate;
}
