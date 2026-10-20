import {
  applyFeatureChange,
  describeDeliveryChanges,
  type DeliveryChange,
} from "./lib/changes";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Layers, Plus, ArrowUpRight, CheckCircle2 } from "lucide-react";
import { Button, ErrorText } from "./components/ui";
import { Wizard } from "./components/Wizard";
import { Timeline } from "./components/Timeline";
import { DeliveryImpacts } from "./components/DeliveryImpacts";
import { Features, FeatureEditor } from "./components/Features";
import { FeatureOverview } from "./components/FeatureOverview";
import { Team } from "./components/Team";
import { Sprints } from "./components/Sprints";
import { Settings } from "./components/Settings";
import {
  stateSchema,
  today,
  type Feature,
  type PlannerState,
} from "./lib/model";
import { createSampleWorkspace } from "./lib/sample-workspace";
import { schedule, displayDate } from "./lib/planning";
import { usePlanner } from "./lib/usePlanner";
import { useToday } from "./lib/useToday";
import { useStakeholderMode } from "./lib/useStakeholderMode";
import { enableAutomaticPlanning } from "./lib/date-status";
import { reconcileCommitments, refreshCommitments } from "./lib/commitments";
import { Sidebar, sidebarNavigation } from "./components/Sidebar";
import { SaveReview, type SchedulingReview } from "./components/SaveReview";
import { schedulingReview } from "./lib/scheduling-review";
import { PlanningModeContext } from "./lib/planning-mode";
import {
  beginExperiment,
  changeExperiment,
  undoExperiment,
  compareExperiment,
  type Experiment,
} from "./lib/what-if";
import { WhatIfBanner } from "./components/WhatIfBanner";
const nav = sidebarNavigation;
const headings: Record<string, [string, string]> = {
  timeline: ["Timeline", "Delivery dates, people and availability."],
  features: ["Features", "Prioritize and estimate your work."],
  team: ["Team & leave", "People, working calendars and time off."],
  sprints: ["Sprints & plans", "Scope, resources and sprint plans."],
  settings: ["App settings", "Calendars, defaults and local backups."],
  overview: ["All apps", "Delivery across your workspace."],
};
export default function App({
  sample = false,
  banner,
}: {
  sample?: boolean;
  banner?: ReactNode;
}) {
  const [sampleStorage] = useState(() =>
    sample ? createSampleWorkspace(today()) : undefined,
  );
  const planner = usePlanner(sampleStorage);
  const currentDate = useToday();
  const [stakeholderMode, toggleStakeholderMode] = useStakeholderMode();
  const { loading, error, setError } = planner;
  const [experiment, setExperiment] = useState<Experiment | null>(null);
  const [endingExperiment, setEndingExperiment] = useState(false);
  const experimentLock = useRef(false);
  const state = experiment?.draft ?? planner.state;
  const saving = planner.saving || endingExperiment;
  const experimentChanged =
    !!experiment &&
    JSON.stringify(experiment.base) !== JSON.stringify(experiment.draft);
  const comparison = useMemo(
    () =>
      experiment
        ? compareExperiment(experiment, currentDate)
        : { features: [], people: [] },
    [experiment, currentDate],
  );
  useEffect(() => {
    if (!experimentChanged) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [experimentChanged]);
  const [appId, setAppId] = useState(() => {
      try {
        return sample ? "" : (localStorage.getItem("sprint-studio-app") ?? "");
      } catch {
        return "";
      }
    }),
    [page, setPage] = useState("timeline"),
    [wizard, setWizard] = useState(false),
    [editing, setEditing] = useState<Feature | "new" | null>(null),
    [overviewId, setOverviewId] = useState<string | null>(null),
    [timelineFocus, setTimelineFocus] = useState<string | undefined>(),
    [notice, setNotice] = useState(""),
    [impactReason, setImpactReason] = useState(""),
    [impacts, setImpacts] = useState<DeliveryChange[]>([]);
  const [review, setReview] = useState<SchedulingReview | null>(null);
  const overviewTrigger = useRef<HTMLElement | null>(null);
  const editorReturnFocus = useRef<HTMLElement | null>(null);
  const closeEditor = () => {
    setEditing(null);
    const trigger = editorReturnFocus.current;
    editorReturnFocus.current = null;
    if (trigger)
      requestAnimationFrame(() => {
        if (trigger.isConnected) trigger.focus();
      });
  };
  const reviewDecision = useRef<((accept: boolean) => void) | null>(null);
  const decideReview = (accept: boolean) => {
    const resolve = reviewDecision.current;
    reviewDecision.current = null;
    setReview(null);
    resolve?.(accept);
  };
  const forecast = useMemo(
    () => schedule(state, currentDate),
    [state, currentDate],
  );
  const app = state.apps.find((a) => a.id === appId) ?? state.apps[0];
  const features = state.features.filter((f) => f.appId === app?.id);
  const selectApp = (id: string) => {
    setOverviewId(null);
    setTimelineFocus(undefined);
    setAppId(id);
    try {
      if (!sample) localStorage.setItem("sprint-studio-app", id);
    } catch {
      /* App selection still works when browser storage is unavailable. */
    }
    setPage("timeline");
    setImpacts([]);
  };
  const save = async (
    next: PlannerState,
    options: { preserveCommitments?: boolean } = {},
  ) => {
    if (saving || experimentLock.current)
      throw new Error("Please wait for the current save to finish.");
    next = enableAutomaticPlanning(next, currentDate);
    if (experiment) {
      setExperiment(changeExperiment(experiment, next));
      setImpacts([]);
      setNotice(
        "Updated in your experiment. Choose Apply to save these changes.",
      );
      return;
    }
    if (!options.preserveCommitments)
      next = reconcileCommitments(state, next, currentDate);
    next = stateSchema.parse(next);
    const hasChange = (key: keyof PlannerState) =>
      JSON.stringify(state[key]) !== JSON.stringify(next[key]);
    const cause = hasChange("leaves")
      ? "Leave availability changed"
      : hasChange("holidays")
        ? "App holidays changed"
        : hasChange("members") || hasChange("people")
          ? "Team availability changed"
          : hasChange("apps")
            ? "App calendars or settings changed"
            : hasChange("sprints")
              ? "Sprint dates or scope changed"
              : "Feature effort, priority, or dependencies changed";
    const nextForecast = schedule(next, currentDate);
    const changed = describeDeliveryChanges(
      state,
      next,
      forecast,
      nextForecast,
    );
    const added = next.features.filter(
      (f) => !state.features.some((v) => v.id === f.id),
    );
    const reviewChanges = schedulingReview(state, next, forecast, nextForecast);
    if (reviewChanges.length) {
      if (reviewDecision.current)
        throw new Error("Finish reviewing the current change first.");
      const accepted = await new Promise<boolean>((resolve) => {
        reviewDecision.current = resolve;
        setReview({
          state: next,
          changes: reviewChanges,
        });
      });
      if (!accepted)
        throw new Error(
          "Changes have not been saved. Your draft is ready to edit.",
        );
    }
    await planner.save(next);
    setImpacts(changed);
    setImpactReason(
      added.length ? `Added “${added.map((f) => f.title).join(", ")}”` : cause,
    );
    setNotice(
      changed.length
        ? `Saved. ${changed.length} feature forecast${changed.length > 1 ? "s" : ""} changed.`
        : sample
          ? "Updated in the temporary sample workspace."
          : "Saved to your local workspace.",
    );
  };
  const refreshFeatureCommitments = async (ids: string[]) => {
    if (experiment)
      throw new Error(
        "Apply or Discard the experiment before accepting delivery dates.",
      );
    if (saving) throw new Error("Please wait for the current save to finish.");
    setNotice("");
    await save(refreshCommitments(state, ids, currentDate));
    setNotice(
      `Commitment dates refreshed. Accepted the current forecast for ${ids.length} feature${ids.length === 1 ? "" : "s"}.`,
    );
  };
  const safeSave = async (next: PlannerState) => {
    try {
      await save(next);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const reorder = (from: string, to: string) => {
    const ordered = features.slice().sort((a, b) => a.priority - b.priority);
    const a = ordered.findIndex((f) => f.id === from),
      b = ordered.findIndex((f) => f.id === to);
    if (a < 0 || b < 0) return;
    const [moved] = ordered.splice(a, 1);
    ordered.splice(b, 0, moved);
    safeSave({
      ...state,
      features: state.features.map((f) =>
        f.appId === app.id
          ? { ...f, priority: ordered.findIndex((v) => v.id === f.id) }
          : f,
      ),
    });
  };
  const move = (id: string, direction: number) => {
    const sorted = features.slice().sort((a, b) => a.priority - b.priority),
      index = sorted.findIndex((f) => f.id === id);
    if (sorted[index + direction]) reorder(id, sorted[index + direction].id);
  };
  const applyExperiment = async () => {
    if (!experiment || experimentLock.current || !experimentChanged) return;
    experimentLock.current = true;
    setEndingExperiment(true);
    setError("");
    try {
      await planner.save(experiment.draft, true, experiment.revision);
      setExperiment(null);
      setImpacts([]);
      setNotice(
        sample
          ? "Experiment applied to the temporary sample. Undo restores the previous sample plan."
          : "Experiment applied to your local workspace. Undo restores the previous plan.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      experimentLock.current = false;
      setEndingExperiment(false);
    }
  };
  const discardExperiment = async () => {
    if (!experiment || experimentLock.current) return;
    experimentLock.current = true;
    setEndingExperiment(true);
    try {
      await planner.reload();
      setExperiment(null);
      setImpacts([]);
      setError("");
      setNotice(
        sample
          ? "Experiment discarded. Showing the sample before the experiment."
          : "Experiment discarded. Showing the saved workspace.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      experimentLock.current = false;
      setEndingExperiment(false);
    }
  };
  const restore = async (file: File) => {
    if (experiment)
      throw new Error(
        "Apply or Discard the experiment before restoring a backup.",
      );
    if (file.size > 15 * 1024 * 1024)
      throw new Error("Backup is too large (maximum 15 MB).");
    const parsed = stateSchema.parse(JSON.parse(await file.text()));
    await save(parsed, { preserveCommitments: true });
    setNotice(
      sample
        ? "Backup restored into the temporary sample only. Undo is available."
        : "Backup restored. Undo is available.",
    );
  };
  if (loading)
    return (
      <div className="loading-screen">
        <Layers size={34} />
        <p>Opening your local workspace…</p>
      </div>
    );
  if (error && !state.apps.length)
    return (
      <div className="loading-screen">
        <div className="form-stack">
          <h2>Couldn’t open your local workspace.</h2>
          <ErrorText text={error} />
          <Button onPress={() => location.reload()}>Retry connection</Button>
        </div>
      </div>
    );
  if (!state.apps.length || wizard)
    return (
      <>
        {banner}
        <Wizard
          state={state}
          busy={saving}
          onCancel={state.apps.length ? () => setWizard(false) : undefined}
          onSave={async (next, id) => {
            await save(next);
            selectApp(id);
            setWizard(false);
          }}
        />
        <SaveReview review={review} onDecision={decideReview} />
        {error && (
          <div className="connection-error">
            <ErrorText text={error} />
            <Button variant="outline" onPress={() => location.reload()}>
              Retry connection
            </Button>
          </div>
        )}
      </>
    );
  const heading = headings[page];
  const dates = features
    .flatMap((f) =>
      forecast.features[f.id]?.end ? [forecast.features[f.id].end!] : [],
    )
    .sort();
  return (
    <PlanningModeContext.Provider value={!!experiment}>
      <div className="app-shell">
        <Sidebar
          sample={sample}
          stakeholderMode={stakeholderMode}
          onToggleStakeholderMode={toggleStakeholderMode}
          state={state}
          appId={app.id}
          page={page}
          onSelectApp={selectApp}
          onNavigate={(next) => {
            setOverviewId(null);
            setTimelineFocus(undefined);
            setPage(next);
          }}
          onAddApp={() => {
            if (!experiment) setWizard(true);
          }}
          canUndo={experiment ? !!experiment.history.length : planner.canUndo}
          busy={saving || !!review}
          onUndo={async () => {
            try {
              if (experiment) setExperiment(undoExperiment(experiment));
              else await planner.undo();
              setImpacts([]);
              setNotice(
                experiment
                  ? "Last experiment change undone."
                  : "Last change undone.",
              );
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        />
        <main className="main-area" key={experiment ? "experiment" : "saved"}>
          {banner}
          <div className="page-content">
            <div className="page-heading">
              <div>
                <span className="eyebrow">
                  {page === "overview"
                    ? "THE BIGGER PICTURE"
                    : `${app.name.toUpperCase()} / ${nav.find((n) => n.id === page)?.label.toUpperCase()}`}
                </span>
                <h1>{heading[0]}</h1>
                <p>{heading[1]}</p>
              </div>
              {page === "timeline" && !experiment && (
                <Button
                  variant="outline"
                  isDisabled={saving || !!review}
                  onPress={() => {
                    setExperiment(
                      beginExperiment(planner.state, planner.revision),
                    );
                    setError("");
                    setNotice("");
                    setImpacts([]);
                  }}
                >
                  What-if planning
                </Button>
              )}
              {page !== "overview" && (
                <span
                  className="app-badge"
                  style={{ color: app.color, background: app.color + "12" }}
                >
                  <Layers size={14} />
                  {app.archived
                    ? "Archived"
                    : `${state.members.filter((m) => m.appId === app.id).length} people`}
                </span>
              )}
            </div>
            {experiment && (
              <WhatIfBanner
                sample={sample}
                comparison={comparison}
                changed={experimentChanged}
                busy={saving}
                onApply={applyExperiment}
                onDiscard={discardExperiment}
              />
            )}
            <ErrorText text={error} />
            {notice && (
              <div className="notice" role="status">
                <CheckCircle2 size={16} />
                {notice}
                <button
                  aria-label="Dismiss message"
                  onClick={() => setNotice("")}
                >
                  ×
                </button>
              </div>
            )}
            {page === "timeline" && (
              <>
                <Timeline
                  {...{ state, forecast }}
                  stakeholderMode={stakeholderMode}
                  appId={app.id}
                  onEdit={setEditing}
                  onAdd={() => setEditing("new")}
                  onReorder={reorder}
                  focusFeatureId={timelineFocus}
                />
                <DeliveryImpacts changes={impacts} reason={impactReason} />
                <div className="timeline-bottom">
                  <p>
                    <span className="green-dot" />
                    Calendars, leave, and dependencies are reflected in every
                    forecast.
                  </p>
                  <span>
                    Last forecast:{" "}
                    {dates.at(-1)
                      ? displayDate(dates.at(-1))
                      : "Add work to begin"}
                  </span>
                </div>
              </>
            )}
            {page === "features" && (
              <>
                <Features
                  {...{ state, forecast }}
                  appId={app.id}
                  onEdit={setEditing}
                  onOverview={(feature) => {
                    overviewTrigger.current =
                      document.activeElement instanceof HTMLElement
                        ? document.activeElement
                        : null;
                    setOverviewId(feature.id);
                  }}
                  onAdd={() => setEditing("new")}
                  onMove={move}
                  onRefreshCommitments={refreshFeatureCommitments}
                  busy={saving}
                />
                <DeliveryImpacts changes={impacts} reason={impactReason} />
              </>
            )}{" "}
            {page === "team" && (
              <Team
                key={app.id}
                state={state}
                appId={app.id}
                onSave={save}
                busy={saving}
              />
            )}{" "}
            {page === "sprints" && (
              <Sprints
                state={state}
                appId={app.id}
                forecast={forecast}
                onSave={save}
                busy={saving}
                onRefreshCommitments={refreshFeatureCommitments}
              />
            )}{" "}
            {page === "settings" && (
              <Settings
                key={app.id}
                state={state}
                appId={app.id}
                onSave={save}
                onRestore={restore}
                busy={saving}
              />
            )}{" "}
            {page === "overview" && (
              <div className="overview-grid">
                {state.apps.map((a) => {
                  const fs = state.features.filter((f) => f.appId === a.id),
                    end = fs
                      .flatMap((f) =>
                        forecast.features[f.id]?.end
                          ? [forecast.features[f.id].end!]
                          : [],
                      )
                      .sort()
                      .at(-1);
                  return (
                    <button
                      className="overview-card"
                      key={a.id}
                      onClick={() => selectApp(a.id)}
                    >
                      <div className="card-row">
                        <span
                          className="app-icon"
                          style={{ background: a.color }}
                        >
                          {a.name[0]}
                        </span>
                        <ArrowUpRight size={20} />
                      </div>
                      <h2>{a.name}</h2>
                      <p>
                        {a.archived
                          ? "Archived"
                          : `${state.members.filter((m) => m.appId === a.id).length} people · ${fs.length} features`}
                      </p>
                      <div className="overview-card-footer">
                        <span>Latest forecast</span>
                        <strong>{displayDate(end)}</strong>
                      </div>
                    </button>
                  );
                })}
                <button
                  className="overview-card add-app-card"
                  disabled={!!experiment || saving}
                  onClick={() => setWizard(true)}
                >
                  <Plus size={30} />
                  <h3>Make space for another app</h3>
                  <p>A new team. A new roadmap. Same clarity.</p>
                </button>
              </div>
            )}
          </div>
          <footer className="app-footer">
            DELIVERY STUDIO<span>Built for a clearer working day.</span>
          </footer>
        </main>
        <SaveReview review={review} onDecision={decideReview} />
        {overviewId && state.features.some((f) => f.id === overviewId) && (
          <FeatureOverview
            state={state}
            feature={state.features.find((f) => f.id === overviewId)!}
            forecast={forecast}
            busy={saving}
            onClose={() => setOverviewId(null)}
            onEdit={() => {
              editorReturnFocus.current = overviewTrigger.current;
              setEditing(state.features.find((f) => f.id === overviewId)!);
              setOverviewId(null);
            }}
            onTimeline={() => {
              setTimelineFocus(overviewId);
              setOverviewId(null);
              setPage("timeline");
            }}
          />
        )}
        {editing && (
          <FeatureEditor
            key={editing === "new" ? "new" : editing.id}
            state={state}
            forecast={forecast}
            appId={app.id}
            feature={editing === "new" ? undefined : editing}
            busy={saving}
            onClose={closeEditor}
            onSave={async (f) => {
              const next = applyFeatureChange(
                state,
                f,
                editing === "new" ? undefined : editing.id,
              );
              await save(next);
              closeEditor();
            }}
          />
        )}
      </div>
    </PlanningModeContext.Provider>
  );
}
