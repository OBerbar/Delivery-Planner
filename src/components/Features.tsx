import { dayLength, dayLabel, remainingFeatureDays } from "../lib/working-days";
import { usePlanningMode } from "../lib/planning-mode";
import { formError } from "../lib/model";
import { featureStatus, statusLabels } from "../lib/date-status";
import { useState } from "react";
import {
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  ExternalLink,
  Pencil,
  Search,
  RefreshCw,
} from "lucide-react";
import {
  Button,
  Field,
  Pick,
  Dialog,
  Check,
  ErrorText,
  Empty,
  Avatar,
} from "./ui";
import {
  uid,
  today,
  scopes,
  featureSchema,
  type PlannerState,
  type Feature,
  type Task,
} from "../lib/model";
import { displayDate, type Schedule } from "../lib/planning";
import { prepareSprintEstimate } from "../lib/estimation";
import {
  featureAssignees,
  featureWork,
  featureEstimateLabel,
} from "../lib/feature-work";
import { FeatureEstimates } from "./FeatureEstimates";
import "./commitments.css";
import "./feature-editor.css";
import { workCapacityNote } from "../lib/capacity-notes";
import { DelayExplanation } from "./DelayExplanation";

export function CommitmentDates({
  feature,
  result,
}: {
  feature: Feature;
  result?: Schedule["features"][string];
}) {
  if (!feature.committed) return null;
  return (
    <div className="commitment-dates">
      {feature.commitment ? (
        <>
          <span className="commitment-accepted">
            Accepted delivery: {displayDate(feature.commitment.end)}
          </span>
          <span className="commitment-recorded">
            Accepted on {displayDate(feature.commitment.acceptedAt)}
          </span>
          {!result?.done && result?.commitmentDelayed && (
            <span className="commitment-risk">
              {result.end
                ? `At risk · ${result.delayDays} calendar day${result.delayDays === 1 ? "" : "s"} later`
                : "Forecast unavailable · review planning warning"}
            </span>
          )}
        </>
      ) : (
        <span className="commitment-missing">Accept commitment dates</span>
      )}
    </div>
  );
}
export function FeatureEditor({
  state,
  forecast,
  appId,
  feature,
  onSave,
  onClose,
  busy,
}: {
  state: PlannerState;
  forecast: Schedule;
  appId: string;
  feature?: Feature;
  onSave: (f: Feature | null) => Promise<void>;
  onClose: () => void;
  busy: boolean;
}) {
  const experiment = usePlanningMode();
  const members = state.members.filter((m) => m.appId === appId);
  const freshTask = (): Task => ({
    id: uid(),
    title: "",
    personId: members[0]?.personId ?? "",
    scope: members[0]?.role ?? "Backend",
    hours: dayLength(state, members[0]?.personId ?? ""),
    status: "todo",
    dependsOn: [],
  });
  const [draft, setDraft] = useState<Feature>(() =>
      feature
        ? {
            ...structuredClone(feature),
            assigneeIds: feature.assigneeIds ?? featureAssignees(feature),
            sprintEstimate:
              feature.sprintEstimate ??
              (feature.assigneeEstimates?.length ? undefined : 1),
          }
        : {
            id: uid(),
            appId,
            title: "",
            description: "",
            completion: "",
            priority: 0,
            tasks: [],
            sprintEstimate: state.sprints.some((s) => s.appId === appId)
              ? 1
              : undefined,
            assigneeIds: [],
            status: "todo",
            planningFrom: today(),
            committed: false,
            link: "",
          },
    ),
    [detailsOpen, setDetailsOpen] = useState(
      !!(feature?.description || feature?.link || feature?.completion),
    ),
    [schedulingOpen, setSchedulingOpen] = useState(
      !!(
        feature?.target ||
        feature?.notBefore ||
        feature?.committed ||
        feature?.doesntAffectOtherWork ||
        feature?.ignoreLeave
      ),
    ),
    [tasksOpen, setTasksOpen] = useState(!!feature?.tasks.length),
    [error, setError] = useState(""),
    [breakdownDraft, setBreakdownDraft] = useState<Task[]>(() =>
      structuredClone(feature?.tasks ?? []),
    );
  const patch = (v: Partial<Feature>) => setDraft((f) => ({ ...f, ...v }));
  const taskPatch = (id: string, v: Partial<Task>) =>
    patch({
      tasks: draft.tasks.map((t) => (t.id === id ? { ...t, ...v } : t)),
    });
  const submit = async () => {
    try {
      const normalized = {
        ...draft,
        tasks: draft.tasks.map((t) => {
          const complete = state.features.filter(
            (f) =>
              f.id !== draft.id &&
              !f.tasks.length &&
              featureWork(state, f).length &&
              featureWork(state, f).every((w) => t.dependsOn.includes(w.id)),
          );
          const migratedIds = complete.flatMap((f) =>
            featureWork(state, f).map((w) => w.id),
          );
          return complete.length
            ? {
                ...t,
                dependsOn: t.dependsOn.filter(
                  (id) => !migratedIds.includes(id),
                ),
                dependsOnFeatures: [
                  ...new Set([
                    ...(t.dependsOnFeatures ?? []),
                    ...complete.map((f) => f.id),
                  ]),
                ],
              }
            : t;
        }),
      };
      const parsed = featureSchema.parse(
        prepareSprintEstimate(state, normalized, today(), feature),
      );
      await onSave(parsed);
    } catch (e) {
      setError(formError(e));
      setDetailsOpen(true);
      setSchedulingOpen(true);
      setTasksOpen(true);
    }
  };
  const allTasks = [
    ...state.features.filter((f) => f.id !== draft.id),
    draft,
  ].flatMap((f) => {
    const work = featureWork(state, f);
    const group = work.length
      ? [
          {
            id: `${f.id}:delivery`,
            featureId: f.id as string | undefined,
            ids: work.map((t) => t.id),
            label: `${f.title || "This feature"} · feature delivery (${f.tasks.length ? "all work" : "all main assignees"})`,
          },
        ]
      : [];
    const individual = f.tasks.length
      ? work.map((t) => ({
          id: t.id,
          featureId: undefined as string | undefined,
          ids: [t.id],
          label: `${f.title || "This feature"} · ${t.title || "Untitled task"}`,
        }))
      : work
          .filter((w) => draft.tasks.some((t) => t.dependsOn.includes(w.id)))
          .map((w) => ({
            id: w.id,
            featureId: undefined as string | undefined,
            ids: [w.id],
            label: `${f.title} · ${state.people.find((p) => p.id === w.personId)?.name ?? "Assignee"} only`,
          }));
    return [...group, ...individual];
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title={feature ? "Edit feature" : "Add a feature"}
      panel
    >
      <div className="form-stack feature-editor-form">
        <Field
          label="Feature title"
          value={draft.title}
          onChange={(title) => patch({ title })}
          placeholder="What are we delivering?"
          required
        />
        <FeatureEstimates state={state} draft={draft} onChange={patch} />
        {state.sprints.some((s) => s.appId === appId) && (
          <Pick
            label="Assigned sprint"
            value={draft.sprintId ?? "none"}
            options={[
              { id: "none", label: "Backlog / not assigned" },
              ...state.sprints
                .filter((s) => s.appId === appId)
                .map((s) => ({
                  id: s.id,
                  label: `Sprint ${s.number} · ${displayDate(s.start)}`,
                })),
            ]}
            onChange={(v) => patch({ sprintId: v === "none" ? undefined : v })}
          />
        )}
        <fieldset className="commitment-toggle" disabled={busy}>
          <Check
            label="Feature blocked"
            checked={!!draft.blocked}
            onChange={(blocked) => patch({ blocked })}
          />
        </fieldset>
        <p className="helper">
          Shows Blocked in red until you clear it. Forecast dates and capacity
          stay unchanged. Clearing it restores the status from scheduled dates.
        </p>
        <details
          className="feature-editor-section"
          open={detailsOpen}
          onToggle={(event) => setDetailsOpen(event.currentTarget.open)}
        >
          <summary>{"Details & completion"}</summary>
          <div className="form-stack feature-editor-section-content">
            <Field
              label="Description"
              value={draft.description}
              onChange={(description) => patch({ description })}
              rows={2}
            />
            <Field
              label="Reference link or work-item ID"
              value={draft.link}
              onChange={(link) => patch({ link })}
            />
            <Field
              label="Completion conditions"
              value={draft.completion}
              onChange={(completion) => patch({ completion })}
              rows={3}
              placeholder="What needs to be true before this feature is complete?"
            />
          </div>
        </details>
        <details
          className="feature-editor-section"
          open={schedulingOpen}
          onToggle={(event) => setSchedulingOpen(event.currentTarget.open)}
        >
          <summary>Scheduling options</summary>
          <div className="form-stack feature-editor-section-content">
            <p className="helper">
              Status follows scheduled dates automatically for features and
              tasks: Planned before the start, In progress through the end date,
              and Done afterward. Unscheduled work stays Planned. Feature
              blocked overrides the feature display until you clear it; tasks
              keep their automatic statuses.
            </p>
            <div className="form-grid">
              <Field
                label="Target delivery date"
                type="date"
                value={draft.target ?? ""}
                onChange={(v) => patch({ target: v || undefined })}
              />
              <Field
                label="Start no earlier than"
                type="date"
                value={draft.notBefore ?? ""}
                onChange={(v) => patch({ notBefore: v || undefined })}
              />
            </div>
            <fieldset className="commitment-toggle" disabled={busy}>
              <Check
                label="Ignore leave"
                checked={!!draft.ignoreLeave}
                onChange={(ignoreLeave) => patch({ ignoreLeave })}
              />
            </fieldset>
            <p className="helper commitment-help">
              Personal leave won’t reduce capacity for this feature or its
              tasks. Weekends, holidays, allocation, competing work and
              dependencies still apply.
            </p>
            <fieldset className="commitment-toggle" disabled={busy}>
              <Check
                label="Keep other delivery dates"
                checked={!!draft.doesntAffectOtherWork}
                onChange={(doesntAffectOtherWork) =>
                  patch({ doesntAffectOtherWork })
                }
              />
            </fieldset>
            <p className="helper commitment-help">
              Uses capacity inside other work's delivery windows without moving
              their dates. Their allocated working days may decrease; saved
              estimates stay the same. Weekends, holidays and explicit
              dependencies still apply; personal leave applies unless Ignore
              leave is checked.
            </p>
            <fieldset
              className="commitment-toggle"
              disabled={busy || experiment}
            >
              <Check
                label="Accept delivery date"
                checked={draft.committed}
                onChange={(committed) =>
                  patch({
                    committed,
                    commitment:
                      committed && feature?.committed
                        ? feature.commitment
                        : undefined,
                  })
                }
              />
            </fieldset>
            <p className="helper commitment-help">
              {experiment
                ? "Apply or Discard before accepting delivery dates. "
                : ""}
              Checking this option accepts the delivery sprint’s ending when you
              save. Delivery can span several sprints; the assigned sprint
              groups where work starts. Later forecasts are compared with the
              accepted delivery date.
            </p>
            {feature?.committed && draft.committed && (
              <div className="commitment-editor-baseline">
                <CommitmentDates
                  feature={feature}
                  result={forecast.features[feature.id]}
                />
                <DelayExplanation
                  state={state}
                  feature={feature}
                  forecast={forecast}
                  savedEditor
                />
                <p className="helper">
                  Save changes, then use Refresh commitment date in Features to
                  accept the current delivery sprint’s ending.
                </p>
              </div>
            )}
          </div>
        </details>
        <details
          className="feature-editor-section"
          open={tasksOpen}
          onToggle={(event) => setTasksOpen(event.currentTarget.open)}
        >
          <summary>Optional tasks</summary>
          <div className="form-stack feature-editor-section-content">
            <Check
              label="Add optional task breakdown"
              checked={draft.tasks.length > 0}
              onChange={(checked) => {
                if (!checked) setBreakdownDraft(structuredClone(draft.tasks));
                patch({
                  tasks: checked
                    ? breakdownDraft.length
                      ? structuredClone(breakdownDraft)
                      : [freshTask()]
                    : [],
                });
              }}
            />
            {!!feature?.tasks.length && !draft.tasks.length && (
              <p className="inline-warning">
                Saving without this breakdown removes its saved tasks,
                completed-task dates and dependency links. Re-enable the
                breakdown to keep them.
              </p>
            )}
            {draft.tasks.length > 0 && (
              <p className="helper">
                Task effort replaces the feature estimate. They are not counted
                twice.
              </p>
            )}
            {draft.tasks.map((t, index) => (
              <div className="task-card" key={t.id}>
                <div className="card-row">
                  <span className="step-kicker">TASK {index + 1}</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    isIconOnly
                    aria-label={`Remove task ${index + 1}`}
                    onPress={() =>
                      patch({
                        tasks: draft.tasks
                          .filter((v) => v.id !== t.id)
                          .map((v) => ({
                            ...v,
                            dependsOn: v.dependsOn.filter((d) => d !== t.id),
                          })),
                      })
                    }
                  >
                    <Trash2 size={15} />
                  </Button>
                </div>
                <Field
                  label={`Task ${index + 1} title`}
                  value={t.title}
                  onChange={(title) => taskPatch(t.id, { title })}
                  required
                />
                <div className="form-grid">
                  <Pick
                    label={`Task ${index + 1} owner`}
                    value={t.personId}
                    options={members.map((m) => ({
                      id: m.personId,
                      label: state.people.find((p) => p.id === m.personId)!
                        .name,
                    }))}
                    onChange={(personId) => taskPatch(t.id, { personId })}
                  />
                  <Field
                    label={`Task ${index + 1} scope`}
                    value={t.scope}
                    onChange={(scope) => taskPatch(t.id, { scope })}
                    hint={`Examples: ${scopes.join(", ")}`}
                  />
                  <Field
                    label={`Task ${index + 1} remaining days`}
                    type="number"
                    value={+(t.hours / dayLength(state, t.personId)).toFixed(6)}
                    onChange={(v) =>
                      taskPatch(t.id, {
                        hours: +(
                          Number(v) * dayLength(state, t.personId)
                        ).toFixed(6),
                      })
                    }
                    min={0.25 / dayLength(state, t.personId)}
                    max={5000 / dayLength(state, t.personId)}
                  />
                </div>
                <div className="dependency-choices">
                  <span className="field-caption">
                    Depends on (finishes before this task starts)
                  </span>
                  {allTasks.filter((v) => !v.ids.includes(t.id)).length ? (
                    allTasks
                      .filter((v) => !v.ids.includes(t.id))
                      .map((v) => (
                        <Check
                          key={v.id}
                          label={v.label}
                          checked={
                            (!!v.featureId &&
                              !!t.dependsOnFeatures?.includes(v.featureId)) ||
                            v.ids.every((id) => t.dependsOn.includes(id))
                          }
                          onChange={(checked) =>
                            taskPatch(t.id, {
                              dependsOn:
                                checked && !v.featureId
                                  ? [...new Set([...t.dependsOn, ...v.ids])]
                                  : t.dependsOn.filter(
                                      (d) => !v.ids.includes(d),
                                    ),
                              dependsOnFeatures: v.featureId
                                ? checked
                                  ? [
                                      ...new Set([
                                        ...(t.dependsOnFeatures ?? []),
                                        v.featureId,
                                      ]),
                                    ]
                                  : t.dependsOnFeatures?.filter(
                                      (id) => id !== v.featureId,
                                    )
                                : t.dependsOnFeatures,
                            })
                          }
                        />
                      ))
                  ) : (
                    <span className="helper">
                      Add another task or feature to connect dependencies.
                    </span>
                  )}
                </div>
              </div>
            ))}
            {draft.tasks.length > 0 && (
              <Button
                variant="outline"
                onPress={() => patch({ tasks: [...draft.tasks, freshTask()] })}
              >
                <Plus size={16} />
                Add task
              </Button>
            )}
          </div>
        </details>
        <ErrorText text={error} />
        <div className="dialog-actions">
          {feature && (
            <Button
              variant="danger"
              onPress={async () => {
                if (confirm("Delete this feature? You can undo this change."))
                  try {
                    await onSave(null);
                  } catch (e) {
                    setError(formError(e));
                  }
              }}
            >
              <Trash2 size={15} />
              Delete feature
            </Button>
          )}
          <Button variant="ghost" onPress={onClose}>
            Cancel
          </Button>
          <Button isPending={busy} onPress={submit}>
            Save feature
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
export function Features({
  state,
  appId,
  forecast,
  onEdit,
  onOverview,
  onAdd,
  onMove,
  onRefreshCommitments,
  busy,
}: {
  state: PlannerState;
  appId: string;
  forecast: Schedule;
  onEdit: (f: Feature) => void;
  onOverview: (f: Feature) => void;
  onAdd: () => void;
  onMove: (id: string, direction: number) => void;
  onRefreshCommitments: (ids: string[]) => Promise<void>;
  busy: boolean;
}) {
  const experiment = usePlanningMode();
  const [search, setSearch] = useState(""),
    [error, setError] = useState("");
  const all = state.features
      .filter((f) => f.appId === appId)
      .sort((a, b) => a.priority - b.priority),
    features = all.filter((f) =>
      (f.title + " " + f.description)
        .toLowerCase()
        .includes(search.toLowerCase()),
    );
  const commitments = all.filter(
    (f) => f.committed && !forecast.features[f.id]?.done,
  );
  const refresh = async (ids: string[]) => {
    if (busy) return;
    setError("");
    try {
      await onRefreshCommitments(ids);
    } catch (e) {
      setError(formError(e));
    }
  };
  return (
    <>
      <div className="panel-toolbar">
        <div className="search-field">
          <Search size={17} />
          <input
            aria-label="Search features"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Find a feature…"
          />
        </div>
        <div className="button-row commitment-toolbar-actions">
          <Button
            variant="outline"
            isDisabled={busy || experiment || !commitments.length}
            isPending={busy}
            onPress={() => refresh(commitments.map((f) => f.id))}
          >
            <RefreshCw size={15} aria-hidden="true" />
            Refresh app commitment dates
          </Button>
          <Button onPress={onAdd} isDisabled={busy}>
            <Plus size={16} />
            Add feature
          </Button>
        </div>
      </div>
      {!!commitments.length && (
        <p className="helper commitment-refresh-hint">
          Refresh accepts current delivery sprint endings as commitment dates
          for unfinished committed features in this app.
        </p>
      )}
      <ErrorText text={error} />
      {!features.length ? (
        <Empty
          title={
            search ? "No matching features" : "Your next delivery starts here"
          }
          detail={
            search
              ? "Try another title or description."
              : "Add a feature, estimate its sprints, and select its main assignees."
          }
          action={
            !search && (
              <Button variant="secondary" onPress={onAdd}>
                Add your first feature
              </Button>
            )
          }
        />
      ) : (
        <div className="feature-list">
          {features.map((f) => {
            const r = forecast.features[f.id],
              sprint = state.sprints.find((s) => s.id === f.sprintId),
              status = featureStatus(f, r ?? {}, forecast.asOf ?? today());
            return (
              <article className="feature-item" key={f.id}>
                <div className="feature-priority">
                  {String(all.findIndex((v) => v.id === f.id) + 1).padStart(
                    2,
                    "0",
                  )}
                  <div>
                    <Button
                      variant="ghost"
                      size="sm"
                      isIconOnly
                      aria-label={`Move ${f.title} up`}
                      isDisabled={busy || all[0].id === f.id}
                      onPress={() => onMove(f.id, -1)}
                    >
                      <ArrowUp size={13} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      isIconOnly
                      aria-label={`Move ${f.title} down`}
                      isDisabled={busy || all.at(-1)!.id === f.id}
                      onPress={() => onMove(f.id, 1)}
                    >
                      <ArrowDown size={13} />
                    </Button>
                  </div>
                </div>
                <div className="feature-main">
                  <div className="card-row">
                    <h3>
                      <button
                        onClick={(event) => {
                          event.currentTarget.focus();
                          onOverview(f);
                        }}
                      >
                        {f.title}
                      </button>
                    </h3>
                    <span className={`status-pill ${status}`}>
                      {statusLabels[status]}
                    </span>
                  </div>
                  <p>{f.description || "No description yet."}</p>
                  <div className="feature-meta">
                    <span>
                      {dayLabel(remainingFeatureDays(state, f, forecast))}{" "}
                      remaining
                    </span>
                    <span>
                      {f.tasks.length
                        ? `${f.tasks.length} tasks`
                        : featureEstimateLabel(f)}
                    </span>
                    <span>
                      {sprint ? `Sprint ${sprint.number}` : "Backlog"}
                    </span>
                    <span>{f.committed ? "Committed" : "Non-committed"}</span>
                    {f.doesntAffectOtherWork && (
                      <span>Keep other delivery dates</span>
                    )}
                  </div>
                  {!!r.capacityReassignedHours && (
                    <p className="helper">
                      {workCapacityNote(
                        state,
                        forecast,
                        featureWork(state, f).map((t) => t.id),
                      )}
                    </p>
                  )}
                  {r.warning && (
                    <div className="inline-warning">{r.warning}</div>
                  )}
                  <DelayExplanation
                    state={state}
                    feature={f}
                    forecast={forecast}
                  />
                </div>
                <div className="feature-dates">
                  <small>FORECAST DELIVERY</small>
                  <strong>{displayDate(r.end)}</strong>
                  <CommitmentDates feature={f} result={r} />
                  {f.committed && !r.done && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="commitment-refresh-button"
                      aria-label={`Refresh commitment date for ${f.title}`}
                      isDisabled={busy || experiment || !r.end}
                      isPending={busy}
                      onPress={() => refresh([f.id])}
                    >
                      <RefreshCw size={13} aria-hidden="true" />
                      Refresh commitment date
                    </Button>
                  )}
                  {f.target && <span>Target {displayDate(f.target)}</span>}
                  <div className="avatar-stack">
                    {featureAssignees(f).map((p) => (
                      <Avatar
                        small
                        key={p}
                        name={state.people.find((v) => v.id === p)?.name ?? "?"}
                      />
                    ))}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  isIconOnly
                  aria-label={`Edit ${f.title}`}
                  onPress={() => onEdit(f)}
                >
                  <Pencil size={16} />
                </Button>
                {/^https?:\/\//.test(f.link) && (
                  <a
                    href={f.link}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`Open reference for ${f.title}`}
                  >
                    <ExternalLink size={15} />
                  </a>
                )}
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}
