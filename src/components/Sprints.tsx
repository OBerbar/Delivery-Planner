import { personDayLabel } from "../lib/working-days";
import { sprintPlanContent } from "../lib/sprint-plan-content";
import { usePlanningMode } from "../lib/planning-mode";
import { formError } from "../lib/model";
import { useEffect, useRef, useState } from "react";
import {
  Plus,
  Download,
  FileText,
  LockKeyhole,
  RefreshCw,
  Pencil,
  Printer,
  Trash2,
  Flag,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button, Field, Dialog, ErrorText, Check, Empty } from "./ui";
import {
  uid,
  today,
  sprintSchema,
  type PlannerState,
  type Sprint,
} from "../lib/model";
import {
  generatePlan,
  resources,
  displayDate,
  type Schedule,
} from "../lib/planning";
import {
  commonWeekends,
  nextSprintPeriod,
  sprintPeriod,
} from "../lib/sprint-calendar";
import { download } from "../lib/usePlanner";
import { CommitmentDates } from "./Features";
import { DelayExplanation } from "./DelayExplanation";
interface Props {
  state: PlannerState;
  appId: string;
  forecast: Schedule;
  onSave: (s: PlannerState) => Promise<void>;
  busy: boolean;
  onRefreshCommitments: (ids: string[]) => Promise<void>;
}
export function Sprints({
  state,
  appId,
  forecast,
  onSave,
  busy,
  onRefreshCommitments,
}: Props) {
  const experiment = usePlanningMode();
  const sprints = state.sprints
    .filter((s) => s.appId === appId)
    .sort((a, b) => a.start.localeCompare(b.start));
  const [selected, setSelected] = useState(
      sprints.find((s) => s.end >= today())?.id ?? sprints.at(-1)?.id ?? "",
    ),
    [editing, setEditing] = useState<Sprint | "new" | null>(null);
  const sprint = sprints.find((s) => s.id === selected) ?? sprints[0];
  const [error, setError] = useState("");
  return (
    <>
      <div className="panel-toolbar">
        <div>
          <h3>Turn a forecast into a clear commitment.</h3>
          <p className="helper">
            Override any sprint’s dates. Preview resources, then generate your
            plan.
          </p>
        </div>
        <Button onPress={() => setEditing("new")}>
          <Plus size={16} />
          New sprint
        </Button>
      </div>
      <ErrorText text={error} />
      {!sprint ? (
        <Empty
          title="Find your next rhythm"
          detail="Create a sprint to group work and generate a delivery plan."
          action={
            <Button variant="secondary" onPress={() => setEditing("new")}>
              Create sprint
            </Button>
          }
        />
      ) : (
        <div className="sprint-workspace">
          <aside className="sprint-list">
            {sprints.map((s) => {
              const features = state.features.filter(
                  (f) => f.sprintId === s.id,
                ),
                risk = features.some(
                  (f) =>
                    f.committed && forecast.features[f.id]?.commitmentDelayed,
                );
              return (
                <button
                  className={`sprint-card ${s.id === sprint.id ? "selected" : ""}`}
                  key={s.id}
                  onClick={() => setSelected(s.id)}
                >
                  <div className="card-row">
                    <strong>Sprint {s.number}</strong>
                    {s.snapshot ? (
                      <LockKeyhole size={14} />
                    ) : (
                      <Flag size={14} />
                    )}
                  </div>
                  <span>
                    {displayDate(s.start)}
                    <br />— {displayDate(s.end)}
                  </span>
                  <div className="card-row">
                    <small>{features.length} features</small>
                    <span className={`tiny-tag ${risk ? "risk" : ""}`}>
                      {risk ? "At risk" : s.snapshot ? "Finalized" : "Draft"}
                    </span>
                  </div>
                </button>
              );
            })}
            <div className="sprint-tip">
              <FileText size={20} />
              <p>
                Exports follow your existing sprint-plan format. Commitments
                always stay explicit.
              </p>
            </div>
          </aside>
          <SprintWorkbench
            key={sprint.id}
            {...{
              state,
              appId,
              forecast,
              onSave,
              busy,
              sprint,
              onRefreshCommitments,
            }}
            onEdit={() => setEditing(sprint)}
            onDelete={async () => {
              if (
                confirm(
                  `Delete Sprint ${sprint.number}? Its features will return to the backlog. You can undo this change.`,
                )
              ) {
                try {
                  await onSave({
                    ...state,
                    sprints: state.sprints.filter((v) => v.id !== sprint.id),
                    features: state.features.map((f) =>
                      f.sprintId === sprint.id
                        ? { ...f, sprintId: undefined, committed: false }
                        : f,
                    ),
                  });
                  setSelected("");
                } catch (e) {
                  setError(formError(e));
                }
              }
            }}
          />
        </div>
      )}
      {editing && (
        <SprintEditor
          state={state}
          appId={appId}
          sprint={editing === "new" ? undefined : editing}
          onClose={() => setEditing(null)}
          busy={busy}
          onSave={async (next) => {
            await onSave(next);
            setEditing(null);
          }}
        />
      )}
    </>
  );
}
function SprintWorkbench({
  state,
  forecast,
  onSave,
  busy,
  sprint,
  onEdit,
  onDelete,
  onRefreshCommitments,
}: Props & { sprint: Sprint; onEdit: () => void; onDelete: () => void }) {
  const experiment = usePlanningMode();
  const [draft, setDraft] = useState(
      () =>
        sprint.draft ??
        sprint.snapshot ??
        generatePlan(state, sprint, forecast),
    ),
    [edit, setEdit] = useState(false),
    [snapshot, setSnapshot] = useState(!!sprint.snapshot && !sprint.draft),
    [error, setError] = useState("");
  const app = state.apps.find((a) => a.id === sprint.appId)!;
  const team = resources(state, sprint, forecast),
    features = state.features.filter((f) => f.sprintId === sprint.id);
  const { goals } = sprintPlanContent(state, sprint, forecast);
  const [tab, setTab] = useState("scope");
  const settledText = useRef({
    draft: sprint.draft,
    snapshot: sprint.snapshot,
  });
  useEffect(() => {
    // Ignore optimistic writes so a failed save keeps the user's edits for retry.
    if (busy) return;
    if (
      settledText.current.draft === sprint.draft &&
      settledText.current.snapshot === sprint.snapshot
    )
      return;
    settledText.current = { draft: sprint.draft, snapshot: sprint.snapshot };
    setDraft(
      sprint.draft ?? sprint.snapshot ?? generatePlan(state, sprint, forecast),
    );
    setSnapshot(!!sprint.snapshot && !sprint.draft);
  }, [sprint.draft, sprint.snapshot, busy]);
  const saveFeature = async (id: string, committed: boolean) => {
    if (busy) return;
    setError("");
    try {
      await onSave({
        ...state,
        features: state.features.map((f) =>
          f.id === id ? { ...f, committed } : f,
        ),
      });
    } catch (e) {
      setError(formError(e));
    }
  };
  return (
    <section className="sprint-detail">
      <div className="detail-title">
        <div>
          <span className="eyebrow">DELIVERY WORKSPACE</span>
          <h2>Sprint {sprint.number}</h2>
          <p>
            {displayDate(sprint.start)} – {displayDate(sprint.end)}
          </p>
        </div>
        <div className="button-row">
          <Button variant="outline" size="sm" onPress={onEdit}>
            <Pencil size={14} />
            Edit sprint
          </Button>
          <Button
            variant="ghost"
            size="sm"
            isIconOnly
            aria-label="Delete sprint"
            isDisabled={busy || (experiment && !!sprint.snapshot)}
            onPress={onDelete}
          >
            <Trash2 size={16} />
          </Button>
        </div>
      </div>
      <div className="workbench-tabs" role="tablist">
        {[
          ["scope", "Scope & capacity"],
          ["plan", "Sprint plan"],
        ].map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => {
              setTab(id);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <ErrorText text={error} />
      {tab === "scope" ? (
        <>
          <div className="section-heading">
            <h3>Sprint goal</h3>
          </div>
          <p className="goal-text">
            {goals.join("\n") || "No features scheduled in this sprint."}
          </p>
          <div className="section-heading">
            <h3>Features & commitments</h3>
            <span>{features.length} features</span>
          </div>
          <div className="commitment-sprint-actions">
            <p className="helper">
              Committed deliveries may span several sprints. Refresh explicitly
              accepts delivery sprint endings as new dates for unfinished
              commitments.
            </p>
            <Button
              variant="outline"
              size="sm"
              isPending={busy}
              isDisabled={
                busy ||
                experiment ||
                !features.some(
                  (f) => f.committed && !forecast.features[f.id]?.done,
                )
              }
              onPress={async () => {
                if (busy) return;
                setError("");
                try {
                  await onRefreshCommitments(
                    features
                      .filter(
                        (f) => f.committed && !forecast.features[f.id]?.done,
                      )
                      .map((f) => f.id),
                  );
                } catch (e) {
                  setError(formError(e));
                }
              }}
            >
              <RefreshCw size={14} aria-hidden="true" />
              Refresh sprint commitment dates
            </Button>
          </div>
          {features.map((f) => (
            <div className="sprint-feature-row" key={f.id}>
              <div>
                <strong>{f.title}</strong>
                <small>
                  Forecast: {displayDate(forecast.features[f.id]?.end)}
                </small>
                <CommitmentDates feature={f} result={forecast.features[f.id]} />
                {forecast.features[f.id]?.warning && (
                  <span className="inline-warning">
                    {forecast.features[f.id].warning}
                  </span>
                )}
                <DelayExplanation
                  state={state}
                  feature={f}
                  forecast={forecast}
                />
              </div>
              <fieldset
                className="commitment-toggle"
                disabled={
                  busy ||
                  experiment ||
                  (!!forecast.features[f.id]?.done && !f.committed)
                }
              >
                <Check
                  label="Committed"
                  checked={f.committed}
                  onChange={(v) => saveFeature(f.id, v)}
                />
              </fieldset>
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Remove ${f.title} from sprint`}
                isDisabled={busy}
                onPress={async () => {
                  try {
                    await onSave({
                      ...state,
                      features: state.features.map((v) =>
                        v.id === f.id
                          ? {
                              ...v,
                              sprintId: undefined,
                              committed: experiment ? v.committed : false,
                            }
                          : v,
                      ),
                    });
                  } catch (e) {
                    setError(formError(e));
                  }
                }}
              >
                Remove
              </Button>
            </div>
          ))}
          {!features.length && (
            <p className="section-empty">
              Assign features using their feature editor.
            </p>
          )}
          <div className="section-heading">
            <h3>Resource allocation</h3>
            <span>Working days · after calendars & leave</span>
          </div>
          <div className="table-scroll">
            <table className="resource-table">
              <thead>
                <tr>
                  <th>Person</th>
                  <th>Available</th>
                  <th>Remaining</th>
                  <th>Fits here</th>
                  <th>Other apps</th>
                  {team.some((r) => r.reassigned > 0) && <th>Reassigned</th>}
                </tr>
              </thead>
              <tbody>
                {team.map((r) => (
                  <tr key={r.person.id}>
                    <td>{r.person.name}</td>
                    <td>{personDayLabel(r.available, r.person.dailyHours)}</td>
                    <td
                      className={r.demand > r.available ? "text-warning" : ""}
                    >
                      {personDayLabel(r.demand, r.person.dailyHours)}
                    </td>
                    <td>{personDayLabel(r.scheduled, r.person.dailyHours)}</td>
                    <td>{personDayLabel(r.other, r.person.dailyHours)}</td>
                    {team.some((row) => row.reassigned > 0) && (
                      <td>
                        {personDayLabel(r.reassigned, r.person.dailyHours)}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="helper">
            “Fits here” is effort actually forecast inside this sprint.
            Dependencies and work on other apps can reduce it.
            {team.some((r) => r.reassigned > 0) &&
              " Reassigned is capacity taken by parallel work inside this sprint while delivery windows stay fixed. Original estimates remain unchanged."}
          </p>
          <Button
            variant="secondary"
            onPress={() => {
              setTab("plan");
              setSnapshot(false);
              setDraft(generatePlan(state, sprint, forecast));
            }}
          >
            Generate sprint plan
            <FileText size={16} />
          </Button>
        </>
      ) : (
        <>
          <div className="plan-toolbar">
            <div className="button-row">
              <Button
                variant="outline"
                size="sm"
                isDisabled={busy}
                onPress={() => {
                  setSnapshot(false);
                  setDraft(generatePlan(state, sprint, forecast));
                  setEdit(false);
                }}
              >
                <RefreshCw size={14} />
                Regenerate draft
              </Button>
              <Button
                variant="ghost"
                size="sm"
                isDisabled={busy}
                onPress={() => {
                  setSnapshot(false);
                  setEdit(!edit);
                }}
              >
                <Pencil size={14} />
                {edit ? "Preview" : "Edit text"}
              </Button>
              {sprint.snapshot && (
                <Button
                  variant="ghost"
                  size="sm"
                  isDisabled={busy}
                  onPress={() => {
                    setSnapshot(true);
                    setDraft(sprint.snapshot!);
                    setEdit(false);
                  }}
                >
                  Saved plan
                </Button>
              )}
            </div>
            <span className="tiny-tag">
              {snapshot ? "Saved snapshot" : "Live draft"}
            </span>
          </div>
          {edit ? (
            <>
              <Field
                label="Sprint plan Markdown"
                value={draft}
                onChange={setDraft}
                rows={24}
                disabled={busy}
              />
              <article
                className="markdown plan-print print-only-plan"
                aria-hidden="true"
              >
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {experiment
                    ? `> WHAT-IF EXPERIMENT — Not an accepted plan\n\n${draft}`
                    : draft}
                </ReactMarkdown>
              </article>
            </>
          ) : (
            <article className="markdown plan-print">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {experiment
                  ? `> WHAT-IF EXPERIMENT — Not an accepted plan\n\n${draft}`
                  : draft}
              </ReactMarkdown>
            </article>
          )}
          <div className="plan-actions">
            <Button
              variant="outline"
              isPending={busy}
              onPress={async () => {
                try {
                  await onSave({
                    ...state,
                    sprints: state.sprints.map((s) =>
                      s.id === sprint.id ? { ...s, draft } : s,
                    ),
                  });
                  setSnapshot(false);
                } catch (e) {
                  setError(formError(e));
                }
              }}
            >
              Save draft
            </Button>
            <Button
              variant="outline"
              onPress={() =>
                download(
                  `${experiment ? "what-if-" : ""}sprint-plan-${sprint.number}.md`,
                  experiment
                    ? `> WHAT-IF EXPERIMENT — Not an accepted plan\n\n${draft}`
                    : draft,
                )
              }
            >
              <Download size={16} />
              Export Markdown
            </Button>
            <Button variant="outline" onPress={() => window.print()}>
              <Printer size={16} />
              Print / PDF
            </Button>
            <Button
              isPending={busy}
              isDisabled={busy || experiment}
              onPress={async () => {
                try {
                  await onSave({
                    ...state,
                    sprints: state.sprints.map((s) =>
                      s.id === sprint.id
                        ? { ...s, snapshot: draft, draft: null }
                        : s,
                    ),
                  });
                  setSnapshot(true);
                  setEdit(false);
                } catch (e) {
                  setError(formError(e));
                }
              }}
            >
              <LockKeyhole size={16} />
              {sprint.snapshot ? "Save new snapshot" : "Finalize plan"}
            </Button>
          </div>
          <p className="helper">
            Save draft to keep edits between visits. Finalizing saves this exact
            text; later timeline changes won’t rewrite it.
          </p>
        </>
      )}
    </section>
  );
}
function SprintEditor({
  state,
  appId,
  sprint,
  onSave,
  onClose,
  busy,
}: Omit<Props, "forecast" | "onRefreshCommitments"> & {
  sprint?: Sprint;
  onClose: () => void;
}) {
  const app = state.apps.find((a) => a.id === appId)!;
  const prior = state.sprints
    .filter((s) => s.appId === appId)
    .sort((a, b) => a.end.localeCompare(b.end))
    .at(-1);
  const weekends = commonWeekends(
    app.weekends,
    state.members.filter((m) => m.appId === appId).map((m) => m.weekends),
  );
  const period = nextSprintPeriod(app, weekends, prior);
  const [s, setS] = useState<Sprint>(
      sprint ?? {
        id: uid(),
        appId,
        number: (prior?.number ?? 0) + 1,
        ...period,
        goal: "",
        notes: "",
        snapshot: null,
      },
    ),
    [error, setError] = useState("");
  return (
    <Dialog
      open
      title={sprint ? "Edit sprint" : "Create a sprint"}
      onClose={onClose}
    >
      <div className="form-stack">
        <Field
          label="Sprint number"
          type="number"
          value={s.number}
          onChange={(v) => setS((s) => ({ ...s, number: Number(v) }))}
          min={1}
        />
        <div className="form-grid">
          <Field
            label="Sprint starts"
            type="date"
            value={s.start}
            onChange={(start) => setS((s) => ({ ...s, start }))}
          />
          <Field
            label="Sprint ends"
            type="date"
            value={s.end}
            onChange={(end) => setS((s) => ({ ...s, end }))}
          />
        </div>
        <Button
          variant="secondary"
          size="sm"
          onPress={() => {
            if (!s.start) {
              setError("Choose a sprint start date first.");
              return;
            }
            setS({ ...s, ...sprintPeriod(s.start, app, weekends) });
            setError("");
          }}
        >
          Apply app’s default duration
        </Button>
        <p className="helper">
          Suggested dates skip weekends shared by the whole team. You can
          override both dates for this sprint.
        </p>
        <p className="helper">
          Sprint goals come from scheduled features: Start in the first sprint,
          Proceed with while continuing, and the feature name in its finishing
          sprint. Add any extra context in Planning notes.
        </p>
        <Field
          label="Planning notes"
          value={s.notes}
          onChange={(notes) => setS((s) => ({ ...s, notes }))}
          rows={3}
        />
        <ErrorText text={error} />
        <div className="dialog-actions">
          <Button variant="ghost" onPress={onClose}>
            Cancel
          </Button>
          <Button
            isPending={busy}
            onPress={async () => {
              try {
                const parsed = sprintSchema.parse(s);
                if (
                  state.sprints.some(
                    (v) =>
                      v.appId === appId &&
                      v.id !== s.id &&
                      v.start <= s.end &&
                      v.end >= s.start,
                  )
                )
                  throw new Error(
                    "This sprint overlaps another sprint in the app. Adjust its dates.",
                  );
                await onSave({
                  ...state,
                  sprints: sprint
                    ? state.sprints.map((v) => (v.id === s.id ? parsed : v))
                    : [...state.sprints, parsed],
                });
              } catch (e) {
                setError(formError(e));
              }
            }}
          >
            Save sprint
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
