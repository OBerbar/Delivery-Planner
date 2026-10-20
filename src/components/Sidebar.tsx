import { usePlanningMode } from "../lib/planning-mode";
import { useEffect, useId, useRef, useState, type ComponentProps } from "react";
import { Button, Label, ListBox, Select } from "@heroui/react";
import {
  CalendarRange,
  ChartNoAxesGantt,
  Grid2X2,
  Layers,
  LayoutList,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Settings2,
  Undo2,
  Users,
} from "lucide-react";
import type { PlannerState } from "../lib/model";
import "./sidebar.css";

function SidebarButton({
  title,
  ...props
}: ComponentProps<typeof Button> & { title: string }) {
  return (
    <Button
      {...props}
      render={(buttonProps) => <button {...buttonProps} title={title} />}
    />
  );
}

export const sidebarNavigation = [
  { id: "timeline", label: "Timeline", icon: ChartNoAxesGantt },
  { id: "features", label: "Features", icon: LayoutList },
  { id: "team", label: "Team & leave", icon: Users },
  { id: "sprints", label: "Sprints & plans", icon: CalendarRange },
  { id: "settings", label: "App settings", icon: Settings2 },
];

export interface SidebarProps {
  sample?: boolean;
  stakeholderMode: boolean;
  onToggleStakeholderMode: () => void;
  state: PlannerState;
  appId: string;
  page: string;
  onSelectApp: (id: string) => void;
  onNavigate: (page: string) => void;
  onAddApp: () => void;
  onUndo: () => void | Promise<void>;
  canUndo: boolean;
  busy: boolean;
}

export function Sidebar({
  sample = false,
  stakeholderMode,
  onToggleStakeholderMode,
  state,
  appId,
  page,
  onSelectApp,
  onNavigate,
  onAddApp,
  onUndo,
  canUndo,
  busy,
}: SidebarProps) {
  const experiment = usePlanningMode();
  const [expanded, setExpanded] = useState(true);
  const [pointerWithin, setPointerWithin] = useState(false);
  const [focusWithin, setFocusWithin] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const navigationId = useId();
  const logoSequence = useRef({ count: 0, startedAt: 0 });
  const activateLogo = () => {
    const now = Date.now();
    const previous = logoSequence.current;
    const count = now - previous.startedAt <= 3000 ? previous.count + 1 : 1;
    logoSequence.current = {
      count,
      startedAt: count === 1 ? now : previous.startedAt,
    };
    if (count === 5) {
      logoSequence.current = { count: 0, startedAt: 0 };
      onToggleStakeholderMode();
    }
  };

  useEffect(() => {
    if (!expanded || pointerWithin || focusWithin || pickerOpen) return;
    const timer = window.setTimeout(() => setExpanded(false), 3000);
    return () => window.clearTimeout(timer);
  }, [expanded, pointerWithin, focusWithin, pickerOpen]);

  const app =
    state.apps.find((candidate) => candidate.id === appId) ?? state.apps[0];
  if (!app) return null;
  const featureCount = state.features.filter(
    (feature) => feature.appId === app.id,
  ).length;
  const memberCount = state.members.filter(
    (member) => member.appId === app.id,
  ).length;
  const navigate = (nextPage: string) => {
    onNavigate(nextPage);
    if (window.matchMedia("(max-width:600px)").matches) setExpanded(false);
  };
  const toggleLabel = expanded ? "Collapse navigation" : "Expand navigation";

  return (
    <aside
      aria-label="Workspace navigation"
      className={`sidebar sidebar-navigation${expanded ? "" : " sidebar-collapsed"}`}
      data-expanded={expanded}
      onPointerEnter={() => setPointerWithin(true)}
      onPointerLeave={() => setPointerWithin(false)}
      onFocusCapture={() => setFocusWithin(true)}
      onBlurCapture={(event) => {
        const nextFocus = event.relatedTarget;
        if (
          !(nextFocus instanceof Node) ||
          !event.currentTarget.contains(nextFocus)
        ) {
          setFocusWithin(false);
        }
      }}
    >
      <div className="sidebar-brand-row">
        <div className="brand">
          <button
            type="button"
            className="brand-logo-button"
            aria-label="Delivery Studio logo"
            aria-description="Activate five times within three seconds to toggle Stakeholder mode."
            aria-pressed={stakeholderMode}
            title={stakeholderMode ? "Stakeholder mode" : "Delivery Studio"}
            onClick={activateLogo}
          >
            <span
              className={`brand-symbol${stakeholderMode ? " stakeholder-active" : ""}`}
            >
              <Layers size={20} aria-hidden="true" />
            </span>
          </button>
          <span className="sidebar-brand-name">
            Delivery<span className="brand-light"> Studio</span>
          </span>
        </div>
        <SidebarButton
          variant="ghost"
          isIconOnly
          className="sidebar-toggle"
          aria-label={toggleLabel}
          aria-expanded={expanded}
          aria-controls={navigationId}
          title={toggleLabel}
          onPress={() => setExpanded((value) => !value)}
        >
          {expanded ? (
            <PanelLeftClose size={19} aria-hidden="true" />
          ) : (
            <PanelLeftOpen size={19} aria-hidden="true" />
          )}
        </SidebarButton>
      </div>
      <div className="workspace-label">
        {sample ? "SAMPLE WORKSPACE" : "YOUR WORKSPACE"}
        <span>{sample ? "TEMPORARY" : "LOCAL"}</span>
      </div>
      <div className="app-switch" title={`Current app: ${app.name}`}>
        <Select
          className="field"
          aria-label="Current app"
          value={app.id}
          onChange={(value) => onSelectApp(String(value ?? ""))}
          isOpen={pickerOpen}
          onOpenChange={setPickerOpen}
        >
          <Label>Current app</Label>
          <Select.Trigger>
            <Layers size={18} className="sidebar-app-icon" aria-hidden="true" />
            <Select.Value />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover
            className="sidebar-app-popover"
            placement="bottom start"
          >
            <ListBox>
              {state.apps.map((candidate) => {
                const label =
                  candidate.name + (candidate.archived ? " (archived)" : "");
                return (
                  <ListBox.Item
                    key={candidate.id}
                    id={candidate.id}
                    textValue={label}
                  >
                    {label}
                    <ListBox.ItemIndicator />
                  </ListBox.Item>
                );
              })}
            </ListBox>
          </Select.Popover>
        </Select>
      </div>
      <nav id={navigationId} aria-label="Planner screens">
        {sidebarNavigation.map((item) => {
          const count =
            item.id === "features"
              ? featureCount
              : item.id === "team"
                ? memberCount
                : null;
          const label = item.label + (count === null ? "" : ` ${count}`);
          return (
            <SidebarButton
              key={item.id}
              variant="ghost"
              className={page === item.id ? "active" : ""}
              aria-label={label}
              aria-current={page === item.id ? "page" : undefined}
              title={label}
              onPress={() => navigate(item.id)}
            >
              <item.icon size={19} aria-hidden="true" />
              <span className="sidebar-control-label">{item.label}</span>
              {count !== null && <small>{count}</small>}
            </SidebarButton>
          );
        })}
      </nav>
      <div className="sidebar-divider" />
      <SidebarButton
        variant="ghost"
        className={`overview-link ${page === "overview" ? "active" : ""}`}
        aria-label="All apps overview"
        aria-current={page === "overview" ? "page" : undefined}
        title="All apps overview"
        onPress={() => navigate("overview")}
      >
        <Grid2X2 size={19} aria-hidden="true" />
        <span className="sidebar-control-label">All apps overview</span>
      </SidebarButton>
      <SidebarButton
        variant="ghost"
        className="new-app"
        aria-label="Add an app"
        title="Add an app"
        onPress={onAddApp}
        isDisabled={busy || experiment}
      >
        <Plus size={19} aria-hidden="true" />
        <span className="sidebar-control-label">Add an app</span>
      </SidebarButton>
      <SidebarButton
        variant="ghost"
        className="new-app workspace-undo"
        aria-label="Undo last change"
        title="Undo last change"
        isDisabled={!canUndo || busy}
        onPress={() => void onUndo()}
      >
        <Undo2 size={19} aria-hidden="true" />
        <span className="sidebar-control-label">Undo last change</span>
      </SidebarButton>
      <div className="sidebar-bottom">
        <div
          className="local-note"
          title={
            sample
              ? "Temporary sample: resets on refresh"
              : "Saved on this computer"
          }
        >
          <span className="green-dot" aria-hidden="true" />
          <span className="sidebar-control-label">
            {sample ? "Temporary sample" : "Saved on this computer"}
          </span>
        </div>
      </div>
    </aside>
  );
}
