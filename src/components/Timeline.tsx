import {
  dayLabel,
  personDayLabel,
  dayLength,
  remainingFeatureDays,
} from "../lib/working-days";
import { usePlanningMode } from "../lib/planning-mode";
import { workCapacityNote } from "../lib/capacity-notes";
import { DelayExplanation } from "./DelayExplanation";
import { FeatureLeaveDetails } from "./FeatureLeaveDetails";
import { featureLeaveDays, featureLeaveSummary } from "../lib/feature-leave";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  addMonths,
  differenceInCalendarDays,
  format,
  getDay,
  parseISO,
} from "date-fns";
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  ChevronDown,
  GripVertical,
  ArrowRight,
  CalendarDays,
  Printer,
} from "lucide-react";
import { Button, Empty, Pick, ErrorText } from "./ui";
import { today, type PlannerState, type Feature } from "../lib/model";
import { dateStatus, featureStatus, statusLabels } from "../lib/date-status";
import {
  featureWork,
  featureEstimateLabel,
  featureAssignees,
} from "../lib/feature-work";
import {
  readTimelinePreferences,
  writeTimelinePreferences,
  type TimelinePreferences,
} from "../lib/view-preferences";
import { calendarEvents } from "../lib/calendar-display";
import { holidayApplies } from "../lib/availability";
import { exportTimelinePdf } from "../lib/timeline-print";
import type { TimelinePrintScope } from "../lib/timeline-print-layout";
import "./timeline-availability.css";
import "./timeline-people.css";
import "./timeline-refinements.css";
import {
  peopleTimelineRows,
  type TimelineDisplayRow,
} from "../lib/timeline-people";
import {
  plus,
  days,
  displayDate,
  type Schedule,
  type TaskForecast,
} from "../lib/planning";
interface Row {
  id: string;
  feature: Feature;
  title: string;
  sub?: string;
  personId?: string;
  taskId?: string;
  forecast: TaskForecast;
  color: string;
  child?: boolean;
}
interface TimelineProps {
  focusFeatureId?: string;
  stakeholderMode?: boolean;
  state: PlannerState;
  appId: string;
  forecast: Schedule;
  onEdit: (f: Feature) => void;
  onAdd: () => void;
  onReorder: (from: string, to: string) => void;
}

export function Timeline(props: TimelineProps) {
  return <TimelineView key={props.appId} {...props} />;
}

function TimelineView({
  focusFeatureId,
  stakeholderMode = false,
  state,
  appId,
  forecast,
  onEdit,
  onAdd,
  onReorder,
}: TimelineProps) {
  const experiment = usePlanningMode();
  const currentDate = forecast.asOf ?? today();
  const app = state.apps.find((a) => a.id === appId)!;
  const availabilityId = useId();
  const [exportError, setExportError] = useState("");
  const memberIds = state.members
    .filter((m) => m.appId === appId)
    .map((m) => m.personId);
  const sprints = state.sprints.filter((s) => s.appId === appId);
  const [preferences, setPreferences] = useState(() => {
    const saved = readTimelinePreferences(appId, today(), undefined, {
      personIds: memberIds,
      sprintIds: sprints.map((s) => s.id),
    });
    return focusFeatureId
      ? {
          ...saved,
          view: "features" as const,
          zoom: "month" as const,
          start: forecast.features[focusFeatureId]?.start ?? currentDate,
          person: "all",
          sprint: "all",
          status: "all" as const,
          risk: "all" as const,
        }
      : saved;
  });
  const {
    start,
    zoom,
    view: savedView,
    months,
    availabilityCollapsed,
    person,
    sprint,
    status,
    risk,
  } = preferences;
  const view = stakeholderMode ? "features" : savedView;
  const updatePreference = <K extends keyof TimelinePreferences>(
    key: K,
    value: TimelinePreferences[K],
  ) => setPreferences((previous) => ({ ...previous, [key]: value }));
  useEffect(() => {
    writeTimelinePreferences(appId, preferences);
  }, [appId, preferences]);
  const personExists = person === "all" || memberIds.includes(person);
  const sprintExists =
    sprint === "all" ||
    sprint === "unassigned" ||
    sprints.some((s) => s.id === sprint);
  useEffect(() => {
    if (!personExists || !sprintExists)
      setPreferences((previous) => ({
        ...previous,
        person: personExists ? previous.person : "all",
        sprint: sprintExists ? previous.sprint : "all",
      }));
  }, [personExists, sprintExists]);
  const [expanded, setExpanded] = useState<string[]>([]),
    [dragging, setDragging] = useState("");
  const allFeatures = state.features
    .filter((f) => f.appId === appId)
    .sort((a, b) => a.priority - b.priority);
  const features = allFeatures.filter(
    (f) =>
      (person === "all" || featureAssignees(f).includes(person)) &&
      (sprint === "all" ||
        (sprint === "unassigned" ? !f.sprintId : f.sprintId === sprint)) &&
      (status === "all" ||
        featureStatus(f, forecast.features[f.id] ?? {}, currentDate) ===
          status) &&
      (risk === "all" ||
        (risk === "at-risk"
          ? !!forecast.features[f.id]?.commitmentDelayed
          : risk === "on-track"
            ? !!(
                f.committed &&
                f.commitment &&
                !forecast.features[f.id]?.commitmentDelayed
              )
            : !(f.committed && f.commitment))),
  );
  const filtered =
    person !== "all" || sprint !== "all" || status !== "all" || risk !== "all";
  const resetFilters = () =>
    setPreferences((previous) => ({
      ...previous,
      person: "all",
      sprint: "all",
      status: "all",
      risk: "all",
    }));
  const hasCalendar =
    state.holidays.some(
      (holiday) =>
        holiday.appId === appId &&
        (holiday.personIds === undefined ||
          holiday.personIds.some((id) => memberIds.includes(id))),
    ) || state.leaves.some((leave) => memberIds.includes(leave.personId));
  const [viewport, setViewport] = useState(1100);
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!focusFeatureId) return;
    const frame = requestAnimationFrame(() => {
      const target = [
        ...(scrollRef.current?.querySelectorAll<HTMLButtonElement>(
          "button[data-feature-id]",
        ) ?? []),
      ].find((element) => element.dataset.featureId === focusFeatureId);
      target?.focus({ preventScroll: true });
      target?.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
    return () => cancelAnimationFrame(frame);
  }, [focusFeatureId]);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) =>
      setViewport(entries[0].contentRect.width),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [features.length, hasCalendar, view, memberIds.length]);
  const dates = days(
      start,
      format(addMonths(parseISO(start), Number(months)), "yyyy-MM-dd"),
    ).slice(0, -1),
    labelWidth = viewport < 600 ? 180 : 284,
    baseDays = differenceInCalendarDays(
      addMonths(parseISO(start), 2),
      parseISO(start),
    ),
    cell =
      zoom === "day"
        ? 44
        : zoom === "week"
          ? 24
          : Math.max(
              viewport < 600 ? 14 : 5,
              (viewport - labelWidth) / baseDays,
            ),
    width = cell * dates.length,
    rowHeight = 72;
  const availability = calendarEvents(state, appId, start, dates.at(-1)!);
  const featureLeaves = useMemo(
    () =>
      new Map(
        features.map((feature) => [
          feature.id,
          featureLeaveDays(state, feature, forecast, start, dates.at(-1)!),
        ]),
      ),
    [state, forecast, start, dates.at(-1), features],
  );
  const featureLeaveCells = new Map(
    [...featureLeaves].map(([id, values]) => [
      id,
      new Map(values.map((day) => [day.date, day])),
    ]),
  );
  const rows = useMemo(() => {
    const out: Row[] = [];
    for (const f of features) {
      const r = forecast.features[f.id];
      if (view === "features") {
        out.push({
          id: f.id,
          feature: f,
          title: f.title,
          sub: f.tasks.length
            ? `${f.tasks.length} tasks · ${dayLabel(remainingFeatureDays(state, f, forecast))} remaining`
            : `${featureEstimateLabel(f)} · ${f.assigneeIds?.length ?? 0} assignee${f.assigneeIds?.length === 1 ? "" : "s"}`,
          forecast: { start: r.start, end: r.end, days: [], reason: r.warning },
          color: app.color,
        });
      }
      if (!stakeholderMode && view === "features" && expanded.includes(f.id))
        for (const t of featureWork(state, f).filter(
          (t) => person === "all" || t.personId === person,
        )) {
          out.push({
            id: t.id,
            feature: f,
            title: f.tasks.length
              ? t.title
              : state.people.find((p) => p.id === t.personId)!.name,
            sub: `${state.people.find((p) => p.id === t.personId)!.name} · ${personDayLabel(t.hours, dayLength(state, t.personId))} · ${t.scope}`,
            personId: t.personId,
            taskId: t.id,
            forecast: forecast.tasks[t.id] ?? { days: [] },
            color:
              dateStatus(forecast.tasks[t.id] ?? {}, currentDate) === "done"
                ? "#34886e"
                : app.color,
            child: view === "features",
          });
        }
    }
    return out;
  }, [
    features,
    forecast,
    view,
    expanded,
    app.color,
    state.people,
    person,
    stakeholderMode,
  ]);
  const displayRows: TimelineDisplayRow[] =
    view === "people"
      ? peopleTimelineRows(
          {
            ...state,
            features,
            members: state.members.filter(
              (m) =>
                m.appId !== appId || person === "all" || m.personId === person,
            ),
          },
          appId,
          forecast,
          start,
          dates.at(-1)!,
          cell,
        )
      : rows.map((r, i) => ({
          ...r,
          height: rowHeight,
          top: i * rowHeight,
          bars: [
            {
              id: r.id,
              feature: r.feature,
              title: r.child ? r.title : r.feature.title,
              forecast: r.forecast,
              color: r.color,
              child: r.child,
              lane: 0,
              taskIds: r.taskId
                ? [r.taskId]
                : featureWork(state, r.feature).map((t) => t.id),
            },
          ],
        }));
  const canvasHeight = displayRows.reduce((sum, r) => sum + r.height, 0);
  const anchorByTask = new Map<string, { id: string; y: number }>();
  displayRows.forEach((row) =>
    row.bars.forEach((bar) => {
      bar.taskIds.forEach((id) =>
        anchorByTask.set(id, {
          id: `${row.id}:${bar.id}`,
          y: row.top + (view === "people" ? 36 + bar.lane * 48 : 36),
        }),
      );
    }),
  );
  const rawOffset = (date: string) =>
    differenceInCalendarDays(parseISO(date), parseISO(start));
  const arrows: React.ReactNode[] = [];
  for (const feature of features) {
    for (const t of featureWork(state, feature))
      for (const dep of t.dependsOn) {
        const a = anchorByTask.get(dep),
          b = anchorByTask.get(t.id),
          source = forecast.tasks[dep],
          target = forecast.tasks[t.id];
        if (!a || !b || a.id === b.id || !source?.end || !target?.start)
          continue;
        const x1 = (rawOffset(source.end) + 1) * cell - 6,
          x2 = rawOffset(target.start) * cell + 4;
        if (x1 < 0 || x2 > width) continue;
        arrows.push(
          <path
            key={`${dep}-${t.id}`}
            d={`M ${x1} ${a.y} H ${x1 + 12} V ${b.y} H ${x2}`}
            markerEnd="url(#arrow)"
          />,
        );
      }
  }
  const exportPdf = (scope: TimelinePrintScope) => {
    try {
      setExportError("");
      exportTimelinePdf(
        state,
        appId,
        forecast,
        start,
        dates.at(-1)!,
        experiment,
        scope,
      );
    } catch (error) {
      setExportError((error as Error).message);
    }
  };
  return (
    <>
      <div className="panel-toolbar timeline-toolbar">
        <div className="segmented" aria-label="Timeline grouping">
          <button
            className={view === "features" ? "selected" : ""}
            aria-pressed={view === "features"}
            onClick={() => {
              if (!stakeholderMode) updatePreference("view", "features");
            }}
          >
            By feature
          </button>
          {!stakeholderMode && (
            <button
              className={view === "people" ? "selected" : ""}
              aria-pressed={view === "people"}
              onClick={() => updatePreference("view", "people")}
            >
              By person
            </button>
          )}
        </div>
        <div className="button-row">
          <div className="range-select">
            <Pick
              label="Timeline range"
              value={months}
              onChange={(value) =>
                updatePreference(
                  "months",
                  value as TimelinePreferences["months"],
                )
              }
              options={[1, 2, 3, 4, 5, 6].map((n) => ({
                id: String(n),
                label: `${n} month${n === 1 ? "" : "s"}`,
              }))}
            />
          </div>
          <Button
            variant="ghost"
            size="sm"
            isIconOnly
            aria-label="Previous week"
            onPress={() => updatePreference("start", plus(start, -7))}
          >
            <ChevronLeft size={17} />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onPress={() => updatePreference("start", today())}
          >
            Today
          </Button>
          <Button
            variant="ghost"
            size="sm"
            isIconOnly
            aria-label="Next week"
            onPress={() => updatePreference("start", plus(start, 7))}
          >
            <ChevronRight size={17} />
          </Button>
          <div className="segmented">
            <button
              className={zoom === "day" ? "selected" : ""}
              aria-pressed={zoom === "day"}
              onClick={() => updatePreference("zoom", "day")}
            >
              Day
            </button>
            <button
              className={zoom === "week" ? "selected" : ""}
              aria-pressed={zoom === "week"}
              onClick={() => updatePreference("zoom", "week")}
            >
              Week
            </button>
            <button
              className={zoom === "month" ? "selected" : ""}
              aria-pressed={zoom === "month"}
              onClick={() => updatePreference("zoom", "month")}
            >
              Month
            </button>
          </div>
          <Button
            variant="outline"
            className="timeline-export"
            onPress={() => exportPdf("all")}
          >
            <Printer size={16} />
            Export timeline PDF
          </Button>
          <Button
            variant="outline"
            className="timeline-export"
            onPress={() => exportPdf("features")}
          >
            <Printer size={16} />
            Export features PDF
          </Button>
          <Button
            variant="outline"
            className="timeline-export"
            onPress={() => exportPdf("compact-features")}
          >
            <Printer size={16} />
            Export compact features PDF
          </Button>
          <Button onPress={onAdd}>
            <Plus size={16} />
            Add feature
          </Button>
        </div>
      </div>
      <div className="timeline-filters" aria-label="Timeline display filters">
        <Pick
          label="Filter by person"
          value={person}
          onChange={(value) => updatePreference("person", value)}
          options={[
            { id: "all", label: "All people" },
            ...state.people
              .filter((p) => memberIds.includes(p.id))
              .map((p) => ({ id: p.id, label: p.name })),
          ]}
        />
        <Pick
          label="Filter by sprint"
          value={sprint}
          onChange={(value) => updatePreference("sprint", value)}
          options={[
            { id: "all", label: "All sprints" },
            { id: "unassigned", label: "No assigned sprint" },
            ...sprints.map((s) => ({ id: s.id, label: `Sprint ${s.number}` })),
          ]}
        />
        <Pick
          label="Filter by status"
          value={status}
          onChange={(value) =>
            updatePreference("status", value as TimelinePreferences["status"])
          }
          options={[
            { id: "all", label: "All statuses" },
            ...Object.entries(statusLabels).map(([id, label]) => ({
              id,
              label,
            })),
          ]}
        />
        <Pick
          label="Filter by risk"
          value={risk}
          onChange={(value) =>
            updatePreference("risk", value as TimelinePreferences["risk"])
          }
          options={[
            { id: "all", label: "All risk" },
            { id: "at-risk", label: "At risk" },
            { id: "on-track", label: "On track" },
            { id: "unaccepted", label: "No accepted date" },
          ]}
        />
        {filtered && (
          <Button variant="ghost" onPress={resetFilters}>
            Reset filters
          </Button>
        )}
        <p className="timeline-filter-note">
          Showing {features.length} of {allFeatures.length} features · Filters
          change this view only. PDF includes all app work.
        </p>
      </div>
      {filtered && !features.length && (
        <p className="timeline-filter-empty" role="status">
          No features match these filters.
        </p>
      )}
      <ErrorText text={exportError} />
      {!allFeatures.length &&
      !hasCalendar &&
      (view !== "people" || !memberIds.length) ? (
        <Empty
          title="A clear view of what’s ahead"
          detail="Add your first feature to turn team availability into a delivery timeline."
          action={
            <Button variant="secondary" onPress={onAdd}>
              Add your first feature
              <ArrowRight size={16} />
            </Button>
          }
        />
      ) : (
        <div className="timeline-panel">
          <div
            className="timeline-scroll"
            ref={scrollRef}
            role="region"
            aria-label="Delivery timeline"
            tabIndex={0}
          >
            <div
              className="timeline-grid"
              style={{
                width: labelWidth + width,
                gridTemplateColumns: `${labelWidth}px 1fr`,
              }}
            >
              <div className="timeline-label-head">
                <span>
                  {view === "features"
                    ? "FEATURE / WORK BREAKDOWN"
                    : "PERSON / ASSIGNED WORK"}
                </span>
                <small>
                  {view === "people" ? `${displayRows.length} people · ` : ""}
                  {features.length} features
                </small>
              </div>
              <div className="timeline-date-head" style={{ width }}>
                <div className="month-bands">
                  {dates
                    .map((d, i) => ({ d, i }))
                    .filter(({ d, i }) => i === 0 || d.slice(8) === "01")
                    .map(({ d, i }) => (
                      <span key={d} style={{ left: i * cell }}>
                        {format(parseISO(d), "MMMM yyyy")}
                      </span>
                    ))}
                </div>
                <div className="week-bands">
                  {dates
                    .filter((_, i) => i % 7 === 0)
                    .map((d, i) => (
                      <div
                        key={d}
                        style={{ left: i * 7 * cell, width: 7 * cell }}
                      >
                        {format(parseISO(d), "MMM d")} —{" "}
                        {format(parseISO(plus(d, 6)), "MMM d")}
                      </div>
                    ))}
                </div>
                <div className="date-cells">
                  {dates.map((d) => (
                    <div
                      key={d}
                      style={{ width: cell }}
                      className={`${app.weekends.includes(getDay(parseISO(d))) ? "off" : ""} ${d === currentDate ? "today" : ""}`}
                    >
                      {cell >= 18 && (
                        <small>{format(parseISO(d), "EEEEE")}</small>
                      )}
                      {(cell >= 12 || getDay(parseISO(d)) === 0) && (
                        <strong>{format(parseISO(d), "d")}</strong>
                      )}
                    </div>
                  ))}
                </div>
              </div>
              <div className="sprint-label">SPRINTS</div>
              <div className="sprint-bands" style={{ width }}>
                {state.sprints
                  .filter(
                    (s) =>
                      s.appId === appId &&
                      s.start <= dates.at(-1)! &&
                      s.end >= start,
                  )
                  .map((s) => {
                    const left = Math.max(0, rawOffset(s.start)),
                      right = Math.min(dates.length, rawOffset(s.end) + 1);
                    return (
                      <div
                        key={s.id}
                        style={{
                          left: left * cell,
                          width: (right - left) * cell,
                        }}
                      >
                        <FlagIcon />
                        Sprint {s.number}
                        {s.snapshot && " · finalized"}
                      </div>
                    );
                  })}
              </div>
              {availability.length > 0 && (
                <>
                  <div className="timeline-availability-heading">
                    <Button
                      variant="ghost"
                      className="timeline-availability-toggle"
                      aria-label={
                        availabilityCollapsed
                          ? "Expand leaves and holidays"
                          : "Collapse leaves and holidays"
                      }
                      aria-expanded={!availabilityCollapsed}
                      aria-controls={`${availabilityId}-labels ${availabilityId}-bars`}
                      onPress={() =>
                        updatePreference(
                          "availabilityCollapsed",
                          !availabilityCollapsed,
                        )
                      }
                    >
                      {availabilityCollapsed ? (
                        <ChevronRight size={16} aria-hidden="true" />
                      ) : (
                        <ChevronDown size={16} aria-hidden="true" />
                      )}
                      <span>
                        <strong>Leaves &amp; holidays</strong>
                        <small>
                          {availability.length}{" "}
                          {availability.length === 1 ? "entry" : "entries"}
                        </small>
                      </span>
                    </Button>
                  </div>
                  <div
                    className="timeline-availability-summary"
                    style={{ width }}
                  >
                    {availabilityCollapsed ? "Collapsed" : "Expanded"} · Time
                    off still affects delivery dates
                  </div>
                  <div
                    id={`${availabilityId}-labels`}
                    className="timeline-availability-labels"
                    hidden={availabilityCollapsed}
                  >
                    {availability.map((event) => (
                      <div
                        key={event.id}
                        className="timeline-availability-label"
                      >
                        <strong>
                          {event.kind === "holiday" ? "Holiday" : "Leave"} ·{" "}
                          {event.name}
                        </strong>
                        <span>
                          {event.personNames.join(", ") || "Whole app"}
                        </span>
                        <small>
                          {displayDate(event.start)}
                          {event.end !== event.start &&
                            ` – ${displayDate(event.end)}`}
                          {event.kind === "leave" &&
                            ` · ${event.hours === null ? "Full days" : `${personDayLabel(event.hours, dayLength(state, event.personIds[0]))} off / day`}`}
                        </small>
                      </div>
                    ))}
                  </div>
                  <div
                    id={`${availabilityId}-bars`}
                    className="timeline-availability-canvas"
                    style={{ width }}
                    hidden={availabilityCollapsed}
                  >
                    {availability.map((event) => {
                      const left = Math.max(0, rawOffset(event.start));
                      const right = Math.min(
                        dates.length,
                        rawOffset(event.end) + 1,
                      );
                      const label = `${event.kind === "holiday" ? "Holiday" : "Leave"}: ${event.name} · ${event.personNames.join(", ") || "Whole app"} · ${event.start} – ${event.end}${event.kind === "leave" ? ` · ${event.hours === null ? "Full days off" : `${personDayLabel(event.hours, dayLength(state, event.personIds[0]))} off per day`}` : ""}`;
                      return (
                        <div
                          key={event.id}
                          className="timeline-availability-track"
                        >
                          {dates.map((date, index) => (
                            <span
                              key={date}
                              aria-hidden="true"
                              className={`grid-cell ${app.weekends.includes(getDay(parseISO(date))) ? "off" : ""}`}
                              style={{ left: index * cell, width: cell }}
                            />
                          ))}
                          <div
                            role="img"
                            tabIndex={0}
                            aria-label={label}
                            title={label}
                            className={`timeline-availability-bar ${event.kind}`}
                            style={{
                              left: left * cell + 2,
                              width: Math.max(1, (right - left) * cell - 4),
                            }}
                          >
                            {event.name}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
              <div className="timeline-body-labels">
                {displayRows.map((r) => (
                  <div
                    key={r.id}
                    className={`timeline-row-label ${r.child ? "child" : ""}`}
                    style={{ height: r.height }}
                    draggable={!r.child && view === "features"}
                    onDragStart={(e) => {
                      if (!r.feature || view !== "features") return;
                      setDragging(r.feature!.id);
                      e.dataTransfer.setData("text/plain", r.feature!.id);
                    }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (!r.feature || view !== "features") return;
                      const from =
                        e.dataTransfer.getData("text/plain") || dragging;
                      if (from && from !== r.feature!.id)
                        onReorder(from, r.feature!.id);
                      setDragging("");
                    }}
                  >
                    {view === "features" && !r.child && (
                      <GripVertical size={14} className="grip" />
                    )}
                    {!stakeholderMode && view === "features" && !r.child && (
                      <button
                        className="expand-button"
                        aria-label={`Expand ${r.title}`}
                        aria-expanded={expanded.includes(r.feature!.id)}
                        onClick={() =>
                          setExpanded((v) =>
                            v.includes(r.feature!.id)
                              ? v.filter((id) => id !== r.feature!.id)
                              : [...v, r.feature!.id],
                          )
                        }
                      >
                        {expanded.includes(r.feature!.id) ? (
                          <ChevronDown size={15} />
                        ) : (
                          <ChevronRight size={15} />
                        )}
                      </button>
                    )}
                    {view === "people" ? (
                      <div className="timeline-row-title">
                        <strong>{r.title}</strong>
                        <small>{r.sub}</small>
                      </div>
                    ) : (
                      <button
                        className="timeline-row-title"
                        title={r.title}
                        onClick={() => onEdit(r.feature!)}
                      >
                        <strong>{r.title}</strong>
                        <small>{r.sub}</small>
                      </button>
                    )}
                    {view === "features" && !r.child && r.feature && (
                      <FeatureLeaveDetails
                        title={r.feature.title}
                        days={featureLeaves.get(r.feature.id) ?? []}
                      />
                    )}
                    {view === "features" && !r.child && r.feature && (
                      <DelayExplanation
                        state={state}
                        feature={r.feature}
                        forecast={forecast}
                        timeline
                      />
                    )}
                  </div>
                ))}
              </div>
              <div
                className="timeline-canvas"
                style={{ width, height: canvasHeight }}
              >
                {displayRows.map((r) => {
                  const member = state.members.find(
                    (m) => m.appId === appId && m.personId === r.personId,
                  );
                  const off = member?.weekends ?? app.weekends;
                  return (
                    <div
                      key={r.id}
                      className="timeline-track"
                      data-person-id={r.personId}
                      data-track-feature-id={
                        view === "features" && !r.child
                          ? r.feature?.id
                          : undefined
                      }
                      style={{ top: r.top, height: r.height }}
                    >
                      {dates.map((date, index) => {
                        const featureLeave =
                          view === "features" && !r.child && r.feature
                            ? featureLeaveCells.get(r.feature.id)?.get(date)
                            : undefined;
                        const leaves = state.leaves.filter(
                            (l) =>
                              l.personId === r.personId &&
                              l.start <= date &&
                              l.end >= date,
                          ),
                          holidays = state.holidays.filter((holiday) =>
                            r.personId
                              ? holidayApplies(holiday, appId, r.personId, date)
                              : holiday.appId === appId &&
                                holiday.date === date &&
                                holiday.personIds === undefined,
                          );
                        return (
                          <span
                            key={date}
                            data-date={date}
                            style={{ left: index * cell, width: cell }}
                            className={`grid-cell ${off.includes(getDay(parseISO(date))) ? "off" : ""} ${leaves.length ? "leave" : ""} ${holidays.length ? "holiday" : ""} ${featureLeave ? `feature-leave-${featureLeave.coverage}` : ""}`}
                            title={[
                              date,
                              featureLeave
                                ? featureLeaveSummary(featureLeave)
                                : null,
                              r.personId
                                ? state.people.find(
                                    (person) => person.id === r.personId,
                                  )?.name
                                : null,
                              ...leaves.map(
                                (leave) =>
                                  `Leave: ${leave.note.trim() || "Personal leave"} · ${leave.hours === null ? "Full day off" : `${personDayLabel(leave.hours, dayLength(state, leave.personId))} off per day`}`,
                              ),
                              ...holidays.map(
                                (holiday) => `Holiday: ${holiday.name}`,
                              ),
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          />
                        );
                      })}
                      {r.bars.map((bar) => {
                        const f = bar.forecast;
                        const statusRange =
                          view === "features" && !bar.child
                            ? { start: f.start, end: f.end }
                            : f;
                        const barStatus = bar.child
                          ? dateStatus(statusRange, currentDate)
                          : featureStatus(
                              bar.feature,
                              statusRange,
                              currentDate,
                            );
                        const statusDetail = statusLabels[barStatus];
                        const capacityDetail = workCapacityNote(
                          state,
                          forecast,
                          bar.taskIds,
                        );
                        const parallelDetail = bar.feature.doesntAffectOtherWork
                          ? " · Keep other delivery dates · Parallel"
                          : "";
                        const left = f.start
                          ? Math.max(0, rawOffset(f.start))
                          : 0;
                        const right = f.end
                          ? Math.min(dates.length, rawOffset(f.end) + 1)
                          : 0;
                        const visible =
                          f.start &&
                          f.end &&
                          f.end >= start &&
                          f.start <= dates.at(-1)!;
                        const personStyle =
                          view === "people"
                            ? { top: 16 + bar.lane * 48, height: 40 }
                            : {};
                        const label =
                          view === "people"
                            ? `${bar.title} · ${r.title}`
                            : r.child
                              ? r.title
                              : r.feature!.title;
                        return visible ? (
                          <button
                            key={bar.id}
                            data-feature-id={bar.feature.id}
                            className={`timeline-bar status-${barStatus} ${bar.feature.doesntAffectOtherWork ? "parallel-work" : ""} ${bar.child ? "task-bar" : ""} ${view === "people" ? "person-feature-bar" : ""}`}
                            style={{
                              left: left * cell + 4,
                              width: Math.max(18, (right - left) * cell - 8),
                              ...personStyle,
                            }}
                            title={`${view === "people" ? label : r.title}: ${displayDate(f.start)} – ${displayDate(f.end)} · ${statusDetail}${f.reason ? ` · ${f.reason}` : ""}${parallelDetail}${capacityDetail ? ` · ${capacityDetail}` : ""}`}
                            aria-label={`${label}: ${displayDate(f.start)} – ${displayDate(f.end)} · ${statusDetail}${f.reason ? ` · ${f.reason}` : ""}${parallelDetail}${capacityDetail ? ` · ${capacityDetail}` : ""}`}
                            onClick={() => onEdit(bar.feature)}
                          >
                            <span className="timeline-bar-title">
                              {bar.title}
                            </span>
                            <span className="timeline-bar-status">
                              {statusDetail}
                            </span>
                            {bar.feature.doesntAffectOtherWork && (
                              <span className="timeline-bar-parallel">
                                Parallel
                              </span>
                            )}
                            {f.reason && <span> !</span>}
                          </button>
                        ) : !f.end ? (
                          <button
                            key={bar.id}
                            data-feature-id={bar.feature.id}
                            className={`unscheduled status-${barStatus}`}
                            style={personStyle}
                            title={`${label}: ${f.reason ?? "Not scheduled"}`}
                            onClick={() => onEdit(bar.feature)}
                          >
                            {view === "people" ? `${bar.title} · ` : ""}
                            {statusDetail} · {f.reason ?? "Not scheduled"}
                          </button>
                        ) : null;
                      })}
                      {view === "features" &&
                        !r.child &&
                        r.feature?.committed &&
                        r.feature.commitment &&
                        r.feature.commitment.end >= start &&
                        r.feature.commitment.end <= dates.at(-1)! && (
                          <span
                            className="timeline-accepted-date"
                            role="img"
                            tabIndex={0}
                            aria-label={`${r.feature.title}: accepted delivery date ${r.feature.commitment.end}`}
                            title={`${r.feature.title}: accepted delivery date ${r.feature.commitment.end}`}
                            style={{
                              left:
                                rawOffset(r.feature.commitment.end) * cell +
                                cell / 2,
                            }}
                          >
                            <span>
                              Accepted{" "}
                              {format(
                                parseISO(r.feature.commitment.end),
                                "MMM d",
                              )}
                            </span>
                          </span>
                        )}
                    </div>
                  );
                })}
                <svg
                  className="dependency-lines"
                  width={width}
                  height={canvasHeight}
                >
                  <defs>
                    <marker
                      id="arrow"
                      viewBox="0 0 10 10"
                      refX="9"
                      refY="5"
                      markerWidth="5"
                      markerHeight="5"
                      orient="auto-start-reverse"
                    >
                      <path d="M 0 0 L 10 5 L 0 10 z" fill="#a49ab8" />
                    </marker>
                  </defs>
                  {arrows}
                </svg>
                {currentDate >= start && currentDate <= dates.at(-1)! && (
                  <div
                    className="today-line"
                    style={{ left: rawOffset(currentDate) * cell + cell / 2 }}
                  />
                )}
              </div>
            </div>
          </div>
          <div className="timeline-footer">
            <div className="legend">
              <span>
                <i className="legend-planned" />
                Planned
              </span>
              <span>
                <i className="legend-doing" />
                In progress
              </span>
              <span>
                <i className="legend-blocked" />
                Blocked
              </span>
              <span>
                <i className="legend-done" />
                Done
              </span>
              <span>
                <i className="legend-parallel" />
                Parallel
              </span>
              <span>
                <i className="legend-accepted" />
                Accepted date
              </span>
              <span>
                <i className="legend-off" />
                Weekend
              </span>
              <span>
                <i className="legend-leave" />
                Leave
              </span>
              {view === "features" && (
                <>
                  <span>
                    <i className="legend-feature-leave-partial" />
                    Partial leave impact
                  </span>
                  <span>
                    <i className="legend-feature-leave-full" />
                    All unavailable
                  </span>
                </>
              )}
              <span>
                <i className="legend-holiday" />
                Holiday
              </span>
              <span>
                <i className="legend-today" />
                Today
              </span>
            </div>
            <span>Drag feature rows to change priority</span>
          </div>
        </div>
      )}
    </>
  );
}
function FlagIcon() {
  return <CalendarDays size={11} />;
}
