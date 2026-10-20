import { personDayLabel, dayLength, workingDays } from "../lib/working-days";
import { formError } from "../lib/model";
import { useState } from "react";
import {
  Plus,
  Pencil,
  Trash2,
  CalendarDays,
  Users,
  Search,
} from "lucide-react";
import {
  Button,
  Field,
  Pick,
  Dialog,
  Weekends,
  Check,
  ErrorText,
  Avatar,
  Empty,
} from "./ui";
import {
  uid,
  today,
  weekdays,
  type PlannerState,
  type Member,
  type Person,
  type Leave,
} from "../lib/model";
import { displayDate, capacity, days } from "../lib/planning";
import { CalendarTemplates, CalendarPeoplePicker } from "./CalendarTemplates";
interface Props {
  state: PlannerState;
  appId: string;
  onSave: (s: PlannerState) => Promise<void>;
  busy: boolean;
}
export function Team({ state, appId, onSave, busy }: Props) {
  const [editing, setEditing] = useState<Member | "new" | null>(null),
    [editingLeave, setEditingLeave] = useState<Leave | "new" | null>(null),
    [holidayOpen, setHolidayOpen] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const members = state.members.filter((m) => m.appId === appId),
    app = state.apps.find((a) => a.id === appId)!;
  const search = query.trim().toLocaleLowerCase();
  const visibleMembers = members.filter((m) => {
    const person = state.people.find((p) => p.id === m.personId)!;
    return `${person.name} ${m.role}`.toLocaleLowerCase().includes(search);
  });
  const sprint = state.sprints
    .filter((s) => s.appId === appId && s.end >= today())
    .sort((a, b) => a.start.localeCompare(b.start))[0];
  const removeLeave = async (id: string) => {
    try {
      await onSave({
        ...state,
        leaves: state.leaves.filter((l) => l.id !== id),
      });
    } catch (e) {
      setError(formError(e));
    }
  };
  return (
    <>
      <div className="panel-toolbar">
        <div>
          <h3>Your people, their real availability.</h3>
          <p className="helper">
            Leave follows a person across apps. Weekend overrides belong to this
            app.
          </p>
        </div>
        <div className="button-row">
          <Button variant="outline" onPress={() => setEditingLeave("new")}>
            <CalendarDays size={16} />
            Add leave
          </Button>
          <Button onPress={() => setEditing("new")}>
            <Plus size={16} />
            Add person
          </Button>
        </div>
      </div>
      <ErrorText text={error} />
      <div className="team-roster-toolbar">
        <label className="search-field">
          <Search size={16} aria-hidden="true" />
          <input
            aria-label="Search team"
            placeholder="Search by name or role…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <span className="team-roster-count" role="status">
          {search
            ? `${visibleMembers.length} of ${members.length} team members`
            : `${members.length} team member${members.length === 1 ? "" : "s"}`}
        </span>
        {query && (
          <Button variant="ghost" size="sm" onPress={() => setQuery("")}>
            Clear team search
          </Button>
        )}
      </div>
      {search && !visibleMembers.length && (
        <p className="team-search-empty">No team members match your search.</p>
      )}
      <div className="team-grid">
        {visibleMembers.map((m) => {
          const p = state.people.find((p) => p.id === m.personId)!;
          const shared = state.members.filter(
            (v) => v.personId === p.id,
          ).length;
          const available = sprint
            ? days(sprint.start, sprint.end).reduce(
                (n, d) => n + capacity(state, appId, p.id, d),
                0,
              )
            : 0;
          return (
            <article className="person-card" key={m.id}>
              <div className="card-row">
                <Avatar name={p.name} />
                <Button
                  variant="ghost"
                  size="sm"
                  isIconOnly
                  aria-label={`Edit ${p.name}`}
                  onPress={() => setEditing(m)}
                >
                  <Pencil size={16} />
                </Button>
              </div>
              <h3>{p.name}</h3>
              <p>{m.role}</p>
              <div className="person-stats">
                <div>
                  <strong>1 day</strong>
                  <small>full workday</small>
                </div>
                <div>
                  <strong>{m.allocation}%</strong>
                  <small>allocation</small>
                </div>
                <div>
                  <strong>
                    {+workingDays(available, p.dailyHours).toFixed(3)}
                  </strong>
                  <small>
                    {sprint
                      ? `days · Sprint ${sprint.number}`
                      : "days · no sprint"}
                  </small>
                </div>
              </div>
              <div className="person-calendar">
                <CalendarDays size={14} />
                <span>
                  {(m.weekends ?? app.weekends)
                    .map((d) => weekdays[d])
                    .join(", ") || "No weekends"}{" "}
                  off
                </span>
                {m.weekends !== null && (
                  <span className="tiny-tag">Override</span>
                )}
              </div>
              {shared > 1 && (
                <span className="shared-note">
                  <Users size={13} />
                  Shared across {shared} apps
                </span>
              )}
            </article>
          );
        })}
      </div>
      <div className="two-columns">
        <section className="panel">
          <div className="section-heading">
            <h3>Leave calendar</h3>
            <span>
              {
                state.leaves.filter((l) =>
                  members.some((m) => m.personId === l.personId),
                ).length
              }{" "}
              entries
            </span>
          </div>
          {state.leaves
            .filter((l) => members.some((m) => m.personId === l.personId))
            .sort((a, b) => a.start.localeCompare(b.start))
            .map((l) => (
              <div className="availability-row" key={l.id}>
                <Avatar
                  small
                  name={state.people.find((p) => p.id === l.personId)!.name}
                  color="#b27158"
                />
                <div>
                  <strong>
                    {state.people.find((p) => p.id === l.personId)!.name}
                  </strong>
                  <p>
                    {displayDate(l.start)} – {displayDate(l.end)}
                  </p>
                  <small>
                    {l.hours === null
                      ? "Full day"
                      : `${personDayLabel(l.hours, dayLength(state, l.personId))} per day`}
                    {l.note ? ` · ${l.note}` : ""}
                  </small>
                </div>
                <div className="leave-row-actions">
                  <Button
                    variant="ghost"
                    size="sm"
                    isDisabled={busy}
                    aria-label={`Edit leave for ${state.people.find((p) => p.id === l.personId)!.name}, ${l.start} to ${l.end}`}
                    onPress={() => setEditingLeave(l)}
                  >
                    <Pencil size={15} />
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    isIconOnly
                    isDisabled={busy}
                    aria-label={`Remove leave ${l.id}`}
                    onPress={() => removeLeave(l.id)}
                  >
                    <Trash2 size={15} />
                  </Button>
                </div>
              </div>
            ))}
          {!state.leaves.some((l) =>
            members.some((m) => m.personId === l.personId),
          ) && (
            <p className="section-empty">
              No leave recorded. Add time off to see its impact.
            </p>
          )}
        </section>
        <section className="panel">
          <div className="section-heading">
            <h3>App holidays</h3>
            <Button
              variant="ghost"
              size="sm"
              onPress={() => setHolidayOpen(true)}
            >
              <Plus size={15} />
              Add holiday
            </Button>
          </div>
          {state.holidays
            .filter((h) => h.appId === appId)
            .sort((a, b) => a.date.localeCompare(b.date))
            .map((h) => (
              <div className="availability-row" key={h.id}>
                <CalendarDays size={20} />
                <div>
                  <strong>{h.name}</strong>
                  <p>{displayDate(h.date)}</p>
                  <small>
                    {h.personIds === undefined
                      ? "Whole app team"
                      : h.personIds
                          .map(
                            (id) => state.people.find((p) => p.id === id)?.name,
                          )
                          .filter(Boolean)
                          .join(", ")}
                  </small>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  isIconOnly
                  aria-label={`Remove holiday ${h.name}`}
                  onPress={async () => {
                    try {
                      await onSave({
                        ...state,
                        holidays: state.holidays.filter((v) => v.id !== h.id),
                      });
                    } catch (e) {
                      setError(formError(e));
                    }
                  }}
                >
                  <Trash2 size={15} />
                </Button>
              </div>
            ))}
          {!state.holidays.some((h) => h.appId === appId) && (
            <p className="section-empty">
              No holidays added. These apply to this app’s team.
            </p>
          )}
        </section>
      </div>
      <CalendarTemplates
        state={state}
        appId={appId}
        onSave={onSave}
        busy={busy}
      />
      {editing && (
        <MemberEditor
          state={state}
          appId={appId}
          member={editing === "new" ? undefined : editing}
          onClose={() => setEditing(null)}
          busy={busy}
          onSave={async (next) => {
            await onSave(next);
            setEditing(null);
          }}
        />
      )}
      {editingLeave && (
        <LeaveEditor
          key={editingLeave === "new" ? "new" : editingLeave.id}
          state={state}
          appId={appId}
          leave={editingLeave === "new" ? undefined : editingLeave}
          onClose={() => setEditingLeave(null)}
          busy={busy}
          onSave={async (next) => {
            await onSave(next);
            setEditingLeave(null);
          }}
        />
      )}
      {holidayOpen && (
        <HolidayEditor
          state={state}
          appId={appId}
          onClose={() => setHolidayOpen(false)}
          busy={busy}
          onSave={async (next) => {
            await onSave(next);
            setHolidayOpen(false);
          }}
        />
      )}
    </>
  );
}
function MemberEditor({
  state,
  appId,
  member,
  onClose,
  onSave,
  busy,
}: Props & { member?: Member; onClose: () => void }) {
  const app = state.apps.find((a) => a.id === appId)!;
  const original = state.people.find((p) => p.id === member?.personId);
  const [person, setPerson] = useState<Person>(
      original ?? { id: uid(), name: "", dailyHours: 8 },
    ),
    [source, setSource] = useState(member?.personId ?? "new"),
    [m, setM] = useState<Member>(
      member ?? {
        id: uid(),
        appId,
        personId: person.id,
        role: "",
        allocation: 100,
        weekends: null,
      },
    ),
    [error, setError] = useState("");
  const submit = async () => {
    try {
      const personId = source === "new" ? person.id : source;
      await onSave({
        ...state,
        people: state.people.some((p) => p.id === personId)
          ? state.people.map((p) =>
              p.id === personId ? { ...person, id: personId } : p,
            )
          : [...state.people, person],
        members: member
          ? state.members.map((v) => (v.id === m.id ? { ...m, personId } : v))
          : [...state.members, { ...m, personId }],
      });
    } catch (e) {
      setError(formError(e));
    }
  };
  return (
    <Dialog
      open
      title={member ? "Edit team member" : "Add a team member"}
      onClose={onClose}
    >
      <div className="form-stack">
        {!member && (
          <Pick
            label="Person source"
            value={source}
            onChange={(v) => {
              setSource(v);
              const existing = state.people.find((p) => p.id === v);
              setPerson(existing ?? { id: uid(), name: "", dailyHours: 8 });
            }}
            options={[
              { id: "new", label: "Create a new person" },
              ...state.people
                .filter(
                  (p) =>
                    !state.members.some(
                      (m) => m.appId === appId && m.personId === p.id,
                    ),
                )
                .map((p) => ({ id: p.id, label: p.name })),
            ]}
          />
        )}
        <Field
          label="Name"
          value={person.name}
          onChange={(name) => setPerson((p) => ({ ...p, name }))}
        />
        <Field
          label="Role / scope"
          value={m.role}
          onChange={(role) => setM((p) => ({ ...p, role }))}
        />
        <div className="form-grid">
          <Field
            label="Hours per day"
            type="number"
            value={person.dailyHours}
            onChange={(v) =>
              setPerson((p) => ({ ...p, dailyHours: Number(v) }))
            }
            min={0.25}
            max={16}
            hint="Person-wide setting, shared across apps."
          />
          <Field
            label="Allocation to this app (%)"
            type="number"
            value={m.allocation}
            onChange={(v) => setM((p) => ({ ...p, allocation: Number(v) }))}
            min={1}
            max={100}
          />
        </div>
        <Check
          label="Override app weekends"
          checked={m.weekends !== null}
          onChange={(v) =>
            setM((p) => ({ ...p, weekends: v ? [...app.weekends] : null }))
          }
        />
        {m.weekends !== null && (
          <Weekends
            value={m.weekends}
            onChange={(weekends) => setM((p) => ({ ...p, weekends }))}
          />
        )}
        <ErrorText text={error} />
        <div className="dialog-actions">
          {member && (
            <Button
              variant="danger"
              onPress={async () => {
                if (
                  state.features.some(
                    (f) =>
                      f.appId === appId &&
                      (featureAssignees(f).includes(m.personId) ||
                        f.assigneeIds?.includes(m.personId)),
                  )
                ) {
                  setError(
                    "Reassign this person’s features or tasks before removing them from the app.",
                  );
                  return;
                }
                try {
                  await onSave({
                    ...state,
                    members: state.members.filter((v) => v.id !== m.id),
                    holidays: state.holidays.flatMap((h) => {
                      if (h.appId !== appId || h.personIds === undefined)
                        return [h];
                      const personIds = h.personIds.filter(
                        (id) => id !== m.personId,
                      );
                      return personIds.length ? [{ ...h, personIds }] : [];
                    }),
                  });
                } catch (e) {
                  setError(formError(e));
                }
              }}
            >
              Remove from app
            </Button>
          )}
          <Button variant="ghost" onPress={onClose}>
            Cancel
          </Button>
          <Button isPending={busy} onPress={submit}>
            Save person
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
function LeaveEditor({
  state,
  appId,
  onSave,
  onClose,
  busy,
  leave,
}: Props & { onClose: () => void; leave?: Leave }) {
  const members = state.members.filter((m) => m.appId === appId);
  const [l, setL] = useState<Leave>(
      leave ?? {
        id: uid(),
        personId: members[0]?.personId ?? "",
        start: today(),
        end: today(),
        hours: null,
        note: "",
      },
    ),
    [error, setError] = useState("");
  return (
    <Dialog
      open
      title={leave ? "Edit time off" : "Add time off"}
      onClose={onClose}
    >
      <div className="form-stack">
        <Pick
          label="Person taking leave"
          value={l.personId}
          options={members.map((m) => ({
            id: m.personId,
            label: state.people.find((p) => p.id === m.personId)!.name,
          }))}
          onChange={(personId) => setL((v) => ({ ...v, personId }))}
        />
        <div className="form-grid">
          <Field
            label="Leave starts"
            type="date"
            value={l.start}
            onChange={(start) => setL((v) => ({ ...v, start }))}
          />
          <Field
            label="Leave ends"
            type="date"
            value={l.end}
            onChange={(end) => setL((v) => ({ ...v, end }))}
          />
        </div>
        <Check
          label="Full-day leave"
          checked={l.hours === null}
          onChange={(v) =>
            setL((l) => ({
              ...l,
              hours: v ? null : dayLength(state, l.personId) / 2,
            }))
          }
        />
        {l.hours !== null && (
          <Field
            label="Days off per day"
            type="number"
            value={+(l.hours / dayLength(state, l.personId)).toFixed(6)}
            onChange={(v) =>
              setL((l) => ({
                ...l,
                hours: +(Number(v) * dayLength(state, l.personId)).toFixed(6),
              }))
            }
            min={0.01}
            max={1}
          />
        )}
        <Field
          label="Leave note"
          value={l.note}
          onChange={(note) => setL((v) => ({ ...v, note }))}
        />
        <p className="helper">
          Dates are inclusive. Leave reduces this person’s availability across
          every app.
        </p>
        <ErrorText text={error} />
        <div className="dialog-actions">
          <Button variant="ghost" isDisabled={busy} onPress={onClose}>
            Cancel
          </Button>
          <Button
            isPending={busy}
            isDisabled={busy}
            onPress={async () => {
              if (busy) return;
              setError("");
              try {
                const unchangedSavedAmount =
                  leave &&
                  leave.personId === l.personId &&
                  leave.hours === l.hours;
                const fullDay = dayLength(state, l.personId);
                // Editing older records preserves saved amounts; new fractions allow the six-decimal storage rounding.
                const rounding = 0.0000005;
                if (
                  l.hours !== null &&
                  !unchangedSavedAmount &&
                  (l.hours < fullDay * 0.01 - rounding ||
                    l.hours > fullDay + rounding)
                )
                  throw new Error(
                    "Days off per day must be between 0.01 and 1.",
                  );
                await onSave({
                  ...state,
                  leaves: leave
                    ? state.leaves.map((entry) =>
                        entry.id === leave.id ? l : entry,
                      )
                    : [...state.leaves, l],
                });
              } catch (e) {
                setError(formError(e));
              }
            }}
          >
            Save leave
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
function HolidayEditor({
  state,
  appId,
  onSave,
  onClose,
  busy,
}: Props & { onClose: () => void }) {
  const [date, setDate] = useState(today()),
    [name, setName] = useState(""),
    [error, setError] = useState("");
  const [wholeApp, setWholeApp] = useState(true);
  const [personIds, setPersonIds] = useState(() =>
    state.members.filter((m) => m.appId === appId).map((m) => m.personId),
  );
  return (
    <Dialog open title="Add an app holiday" onClose={onClose}>
      <div className="form-stack">
        <Field
          label="Holiday name"
          value={name}
          onChange={(value) => {
            setError("");
            setName(value);
          }}
        />
        <Field
          label="Holiday date"
          type="date"
          value={date}
          onChange={(value) => {
            setError("");
            setDate(value);
          }}
        />
        <Check
          label="Whole app holiday"
          checked={wholeApp}
          onChange={(checked) => {
            setError("");
            setWholeApp(checked);
          }}
        />
        {!wholeApp && (
          <CalendarPeoplePicker
            state={state}
            appId={appId}
            personIds={personIds}
            labelPrefix="Holiday applies to"
            onChange={(ids) => {
              setError("");
              setPersonIds(ids);
            }}
          />
        )}
        <p className="helper">
          Whole-app holidays include everyone on this app, including future team
          members. Selected holidays only affect the people you choose.
        </p>
        <ErrorText text={error} />
        <div className="dialog-actions">
          <Button variant="ghost" onPress={onClose}>
            Cancel
          </Button>
          <Button
            isPending={busy}
            onPress={async () => {
              try {
                setError("");
                if (!wholeApp && !personIds.length)
                  throw new Error(
                    "Select at least one person for this holiday.",
                  );
                await onSave({
                  ...state,
                  holidays: [
                    ...state.holidays,
                    {
                      id: uid(),
                      appId,
                      date,
                      name,
                      ...(wholeApp ? {} : { personIds }),
                    },
                  ],
                });
              } catch (e) {
                setError(formError(e));
              }
            }}
          >
            Save holiday
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
import { featureAssignees } from "../lib/feature-work";
