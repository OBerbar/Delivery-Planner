import { useEffect, useRef, useState } from "react";
import { emptyState, stateSchema, today, type PlannerState } from "./model";
import { enableAutomaticPlanning } from "./date-status";
import { verifiedSave } from "./verified-save";
import { loadPlanner } from "./load-planner";
interface PlannerStorage {
  load: () => Promise<{ state: PlannerState; revision: number }>;
  save: (
    state: PlannerState,
    revision: number,
  ) => Promise<{ state: PlannerState; revision: number }>;
}
export function usePlanner(storage?: PlannerStorage) {
  const [state, setState] = useState<PlannerState>(emptyState),
    [loading, setLoading] = useState(true),
    [saving, setSaving] = useState(false),
    [error, setError] = useState(""),
    [history, setHistory] = useState<PlannerState[]>([]);
  const revision = useRef(0),
    current = useRef(state),
    busy = useRef(false);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        let last: unknown;
        for (let attempt = 0; attempt < 5; attempt++) {
          try {
            const data = storage ? await storage.load() : await loadPlanner();
            if (cancelled) return;
            revision.current = data.revision;
            current.current = data.state;
            setState(data.state);
            return;
          } catch (e) {
            last = e;
            if (attempt < 4)
              await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
          }
        }
        throw last;
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, []);
  const save = async (
    next: PlannerState,
    remember = true,
    expectedRevision = revision.current,
  ) => {
    if (busy.current)
      throw new Error("Please wait for the current save to finish.");
    const validated = stateSchema.safeParse(
      enableAutomaticPlanning(next, today()),
    );
    if (!validated.success)
      throw new Error(validated.error.issues.map((i) => i.message).join("; "));
    busy.current = true;
    setSaving(true);
    setError("");
    const previous = current.current;
    setState(validated.data);
    try {
      const result = storage
        ? await storage.save(validated.data, expectedRevision)
        : await verifiedSave(validated.data, expectedRevision);
      if (remember) setHistory((h) => [...h.slice(-19), current.current]);
      revision.current = result.revision;
      current.current = result.state;
      setState(result.state);
    } catch (e) {
      setState(previous);
      setError((e as Error).message);
      throw e;
    } finally {
      busy.current = false;
      setSaving(false);
    }
  };
  const undo = async () => {
    if (!history.length) return;
    await save(history.at(-1)!, false);
    setHistory((h) => h.slice(0, -1));
  };
  const reload = async () => {
    if (busy.current)
      throw new Error("Please wait for the current save to finish.");
    const data = storage
      ? await storage.load()
      : await loadPlanner(
          today(),
          fetch,
          "Could not reload the saved workspace. Your experiment is still available.",
        );
    if (data.revision !== revision.current) setHistory([]);
    revision.current = data.revision;
    current.current = data.state;
    setState(data.state);
    setError("");
  };
  return {
    state,
    revision: revision.current,
    reload,
    loading,
    saving,
    error,
    setError,
    save,
    undo,
    canUndo: history.length > 0,
  };
}
export function download(
  name: string,
  content: string,
  type = "text/markdown",
) {
  const blob = new Blob([content], { type }),
    url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
