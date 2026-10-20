import { dayLabel } from "../lib/working-days";
import { useState } from "react";
import { CalendarDays, Plus, Pencil, Trash2 } from "lucide-react";
import { Button, Check, Dialog, ErrorText, Field, Pick } from "./ui";
import {
  calendarTemplateSchema,
  formError,
  today,
  uid,
  type CalendarEntry,
  type CalendarTemplate,
  type PlannerState,
} from "../lib/model";
import { applyCalendarTemplate } from "../lib/availability";
import { displayDate } from "../lib/planning";
import "./calendar-templates.css";

interface Props {
  state: PlannerState;
  appId: string;
  onSave: (state: PlannerState) => Promise<void>;
  busy: boolean;
}

export function CalendarPeoplePicker({
  state,
  appId,
  personIds,
  onChange,
  labelPrefix,
}: {
  state: PlannerState;
  appId: string;
  personIds: string[];
  onChange: (ids: string[]) => void;
  labelPrefix: string;
}) {
  const people = state.members
    .filter((m) => m.appId === appId)
    .map((m) => state.people.find((p) => p.id === m.personId)!)
    .filter(Boolean);
  return (
    <fieldset className="calendar-member-picker">
      <legend>Team members</legend>
      <div className="calendar-member-actions">
        <span>
          {personIds.length} of {people.length} selected
        </span>
        <Button
          size="sm"
          variant="ghost"
          onPress={() => onChange(people.map((p) => p.id))}
        >
          Select all members
        </Button>
        <Button size="sm" variant="ghost" onPress={() => onChange([])}>
          Clear selection
        </Button>
      </div>
      <div className="calendar-member-choices">
        {people.map((p) => (
          <Check
            key={p.id}
            label={p.name}
            ariaLabel={`${labelPrefix}: ${p.name}`}
            checked={personIds.includes(p.id)}
            onChange={(checked) =>
              onChange(
                checked
                  ? [...personIds, p.id]
                  : personIds.filter((id) => id !== p.id),
              )
            }
          />
        ))}
      </div>
      {!people.length && (
        <p className="helper">
          Add a person to this app before applying a calendar.
        </p>
      )}
    </fieldset>
  );
}

export function CalendarTemplates({ state, appId, onSave, busy }: Props) {
  const [editing, setEditing] = useState<CalendarTemplate | "new" | null>(null);
  const [applying, setApplying] = useState<CalendarTemplate | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const templates = state.calendarTemplates ?? [];
  return (
    <section
      className="panel calendar-templates"
      aria-labelledby="calendar-templates-heading"
    >
      <div className="section-heading">
        <h3 id="calendar-templates-heading">Reusable calendars</h3>
        <Button
          variant="outline"
          size="sm"
          isDisabled={busy || templates.length >= 100}
          onPress={() => {
            setError("");
            setMessage("");
            setEditing("new");
          }}
        >
          <Plus size={15} /> New calendar template
        </Button>
      </div>
      <p className="calendar-templates-intro">
        Save holidays and leave once, then apply them to selected people in any
        app. Templates only affect availability after you apply them.
      </p>
      <ErrorText text={error} />
      {message && (
        <p className="calendar-success" role="status">
          {message}
        </p>
      )}
      {!templates.length && (
        <p className="section-empty">
          No reusable calendars yet. Create a named template with holidays,
          full-day leave or partial days off.
        </p>
      )}
      <div className="calendar-template-grid">
        {templates.map((template) => (
          <article className="calendar-template-card" key={template.id}>
            <div className="calendar-template-title">
              <CalendarDays size={18} aria-hidden="true" />
              <h4>{template.name}</h4>
            </div>
            <ul className="calendar-template-entries">
              {template.entries.map((entry) => (
                <li key={entry.id}>
                  <strong>{entry.name}</strong>
                  <span>
                    {entry.kind === "holiday" ? "Holiday" : "Leave"} ·{" "}
                    {displayDate(entry.start)}
                    {entry.end !== entry.start
                      ? ` – ${displayDate(entry.end)}`
                      : ""}
                  </span>
                  {entry.kind === "leave" && (
                    <span>
                      {entry.hours === null
                        ? "Full day"
                        : `${dayLabel(entry.dayFraction ?? entry.hours / 8)} off per day${entry.dayFraction === undefined ? " (standard day)" : ""}`}
                    </span>
                  )}
                </li>
              ))}
            </ul>
            <div className="calendar-template-actions">
              <Button
                size="sm"
                variant="secondary"
                aria-label={`Apply ${template.name}`}
                isDisabled={busy}
                onPress={() => {
                  setError("");
                  setMessage("");
                  setApplying(template);
                }}
              >
                Apply calendar
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Edit ${template.name}`}
                isDisabled={busy}
                onPress={() => {
                  setError("");
                  setMessage("");
                  setEditing(template);
                }}
              >
                <Pencil size={14} /> Edit
              </Button>
              <Button
                size="sm"
                variant="ghost"
                isIconOnly
                aria-label={`Delete ${template.name}`}
                isDisabled={busy}
                onPress={async () => {
                  try {
                    setError("");
                    await onSave({
                      ...state,
                      calendarTemplates: templates.filter(
                        (t) => t.id !== template.id,
                      ),
                    });
                    setMessage(
                      `Deleted ${template.name}. Applied holidays and leave are kept.`,
                    );
                  } catch (e) {
                    setError(formError(e));
                  }
                }}
              >
                <Trash2 size={15} />
              </Button>
            </div>
          </article>
        ))}
      </div>
      {editing && (
        <CalendarTemplateEditor
          template={editing === "new" ? undefined : editing}
          busy={busy}
          onClose={() => setEditing(null)}
          onSave={async (template) => {
            await onSave({
              ...state,
              calendarTemplates:
                editing === "new"
                  ? [...templates, template]
                  : templates.map((t) => (t.id === template.id ? template : t)),
            });
            setEditing(null);
            setMessage(
              `Saved ${template.name}. Apply it when you want to add its dates to people’s calendars.`,
            );
          }}
        />
      )}
      {applying && (
        <ApplyCalendarDialog
          state={state}
          appId={appId}
          template={applying}
          busy={busy}
          onClose={() => setApplying(null)}
          onSave={async (next) => {
            await onSave(next);
            setApplying(null);
            setMessage(
              `Applied ${applying.name}. Existing entries from this template are counted once.`,
            );
          }}
        />
      )}
    </section>
  );
}

const newEntry = (): CalendarEntry => ({
  id: uid(),
  name: "",
  kind: "holiday",
  start: today(),
  end: today(),
  hours: null,
});

function CalendarTemplateEditor({
  template,
  onSave,
  onClose,
  busy,
}: {
  template?: CalendarTemplate;
  onSave: (template: CalendarTemplate) => Promise<void>;
  onClose: () => void;
  busy: boolean;
}) {
  const [draft, setDraft] = useState<CalendarTemplate>(() =>
    template
      ? { ...template, entries: template.entries.map((e) => ({ ...e })) }
      : { id: uid(), name: "", entries: [newEntry()] },
  );
  const [error, setError] = useState("");
  const update = (entryId: string, patch: Partial<CalendarEntry>) => {
    setError("");
    setDraft((current) => ({
      ...current,
      entries: current.entries.map((entry) =>
        entry.id === entryId ? { ...entry, ...patch } : entry,
      ),
    }));
  };
  return (
    <Dialog
      open
      wide
      title={template ? "Edit calendar template" : "Create a calendar template"}
      onClose={onClose}
    >
      <div className="form-stack calendar-template-editor">
        <p className="helper">
          Dates are inclusive. Editing a template keeps previously applied
          holidays and leave unchanged.
        </p>
        <ErrorText text={error} />
        <Field
          label="Template name"
          value={draft.name}
          onChange={(name) => {
            setError("");
            setDraft((v) => ({ ...v, name }));
          }}
          required
        />
        {draft.entries.map((entry, index) => {
          const prefix = `Entry ${index + 1}`;
          return (
            <fieldset className="calendar-entry-editor" key={entry.id}>
              <legend>{prefix}</legend>
              <div className="calendar-entry-top">
                <Field
                  label={`${prefix} name`}
                  value={entry.name}
                  onChange={(name) => update(entry.id, { name })}
                  required
                />
                <Pick
                  label={`${prefix} kind`}
                  value={entry.kind}
                  options={[
                    { id: "holiday", label: "Holiday" },
                    { id: "leave", label: "Leave" },
                  ]}
                  onChange={(kind) =>
                    update(entry.id, {
                      kind: kind as CalendarEntry["kind"],
                      hours: null,
                      dayFraction: undefined,
                    })
                  }
                />
              </div>
              <div className="calendar-entry-dates">
                <Field
                  label={`${prefix} starts`}
                  type="date"
                  value={entry.start}
                  onChange={(start) => update(entry.id, { start })}
                  required
                />
                <Field
                  label={`${prefix} ends`}
                  type="date"
                  value={entry.end}
                  onChange={(end) => update(entry.id, { end })}
                  required
                />
              </div>
              {entry.kind === "leave" && (
                <>
                  <Check
                    label="Full-day leave"
                    ariaLabel={`${prefix} full-day leave`}
                    checked={entry.hours === null}
                    onChange={(full) =>
                      update(entry.id, {
                        hours: full ? null : 4,
                        dayFraction: full ? undefined : 0.5,
                      })
                    }
                  />
                  {entry.hours !== null && (
                    <Field
                      label={`${prefix} days off per day`}
                      type="number"
                      value={entry.dayFraction ?? entry.hours / 8}
                      min={0.01}
                      max={1}
                      onChange={(days) =>
                        update(entry.id, {
                          hours: Number(days) * 8,
                          dayFraction: Number(days),
                        })
                      }
                    />
                  )}
                </>
              )}
              <div className="calendar-entry-footer">
                <span>Up to 366 days per entry</span>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Remove entry ${index + 1}`}
                  onPress={() => {
                    setError("");
                    setDraft((v) => ({
                      ...v,
                      entries: v.entries.filter((e) => e.id !== entry.id),
                    }));
                  }}
                >
                  <Trash2 size={14} /> Remove entry
                </Button>
              </div>
            </fieldset>
          );
        })}
        <Button
          variant="outline"
          isDisabled={draft.entries.length >= 100}
          onPress={() => {
            setError("");
            setDraft((v) => ({ ...v, entries: [...v.entries, newEntry()] }));
          }}
        >
          <Plus size={16} /> Add calendar entry
        </Button>
        <div className="dialog-actions">
          <Button variant="ghost" onPress={onClose}>
            Cancel
          </Button>
          <Button
            isPending={busy}
            isDisabled={busy}
            onPress={async () => {
              try {
                setError("");
                await onSave(calendarTemplateSchema.parse(draft));
              } catch (e) {
                setError(formError(e));
              }
            }}
          >
            Save template
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function ApplyCalendarDialog({
  state,
  appId,
  template,
  onSave,
  onClose,
  busy,
}: Props & { template: CalendarTemplate; onClose: () => void }) {
  const [personIds, setPersonIds] = useState(() =>
    state.members.filter((m) => m.appId === appId).map((m) => m.personId),
  );
  const [error, setError] = useState("");
  const app = state.apps.find((a) => a.id === appId)!;
  return (
    <Dialog open title={`Apply ${template.name}`} onClose={onClose}>
      <div className="form-stack calendar-apply-dialog">
        <p className="helper">
          Apply {template.entries.length}{" "}
          {template.entries.length === 1 ? "entry" : "entries"} to{" "}
          <strong>{app.name}</strong>. Holidays affect selected people in this
          app; leave follows them across every app.
        </p>
        <ErrorText text={error} />
        <CalendarPeoplePicker
          state={state}
          appId={appId}
          personIds={personIds}
          labelPrefix="Apply calendar to"
          onChange={(ids) => {
            setError("");
            setPersonIds(ids);
          }}
        />
        <p className="helper">
          Applying this template again keeps existing entries and adds any newly
          selected people.
        </p>
        <div className="dialog-actions">
          <Button variant="ghost" onPress={onClose}>
            Cancel
          </Button>
          <Button
            isPending={busy}
            isDisabled={busy}
            onPress={async () => {
              try {
                setError("");
                if (!personIds.length)
                  throw new Error(
                    "Select at least one person to apply this calendar.",
                  );
                await onSave(
                  applyCalendarTemplate(state, template.id, appId, personIds),
                );
              } catch (e) {
                setError(formError(e));
              }
            }}
          >
            Apply calendar
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
