import { useEffect, useState } from "react";

const storageKey = "sprint-studio:stakeholder-mode";

export function useStakeholderMode() {
  const [active, setActive] = useState(() => {
    try {
      return window.sessionStorage.getItem(storageKey) === "true";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      window.sessionStorage.setItem(storageKey, String(active));
    } catch {
      // The display toggle still works when browser storage is unavailable.
    }
  }, [active]);
  return [active, () => setActive((value) => !value)] as const;
}
