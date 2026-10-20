import { formError } from "../lib/model";
import { useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Layers,
  Plus,
  Trash2,
  Users,
  CalendarDays,
  Flag,
  Sparkles,
} from "lucide-react";
import { Button, Field, Pick, Weekends, Check, ErrorText } from "./ui";
import {
  uid,
  today,
  exampleRoster,
  defaultTerms,
  appSchema,
  personSchema,
  memberSchema,
  weekdays,
  type PlannerState,
  type AppConfig,
} from "../lib/model";
import { displayDate } from "../lib/planning";
import { SampleLink } from "./SampleWorkspace";
import { isSampleWorkspace } from "../lib/sample-workspace";
import { commonWeekends, sprintPeriod } from "../lib/sprint-calendar";
interface Row {
  id: string;
  personId: string;
  name: string;
  role: string;
  dailyHours: number;
  allocation: number;
  weekends: number[] | null;
}
const colors = [
  "#7565db",
  "#328eaa",
  "#34886e",
  "#c0813a",
  "#cc6376",
  "#5b77c8",
];
const steps = [
  { label: "Your app", icon: Layers },
  { label: "Your people", icon: Users },
  { label: "Working calendar", icon: CalendarDays },
  { label: "Sprint rhythm", icon: Flag },
  { label: "Ready to plan", icon: CheckCircle2 },
];
export function Wizard({
  state,
  onSave,
  onCancel,
  busy,
}: {
  state: PlannerState;
  onSave: (s: PlannerState, appId: string) => Promise<void>;
  onCancel?: () => void;
  busy: boolean;
}) {
  const [useSprints, setUseSprints] = useState(false);
  const visibleSteps = steps
    .map((item, index) => ({ ...item, index }))
    .filter((item) => useSprints || item.index !== 3);
  const [step, setStep] = useState(0),
    [error, setError] = useState("");
  const visibleStep = visibleSteps.findIndex((item) => item.index === step);
  const [app, setApp] = useState<AppConfig>({
    id: uid(),
    name: "",
    color: colors[0],
    weekends: [5, 6],
    planningStart: today(),
    cadence: "2w",
    customDays: 14,
    terms: "",
    archived: false,
  });
  const [team, setTeam] = useState<Row[]>([]),
    [number, setNumber] = useState(1);
  const firstSprint = appSchema.safeParse(app).success
    ? sprintPeriod(
        app.planningStart,
        app,
        commonWeekends(
          app.weekends,
          team.map((row) => row.weekends),
        ),
      )
    : null;
  const patch = (v: Partial<AppConfig>) => setApp((a) => ({ ...a, ...v }));
  const update = (id: string, v: Partial<Row>) =>
    setTeam((rows) => rows.map((r) => (r.id === id ? { ...r, ...v } : r)));
  const preset = () => {
    patch({ name: app.name || "Northstar", terms: defaultTerms });
    setTeam(
      exampleRoster.map(([name, role]) => ({
        id: uid(),
        personId: "",
        name,
        role,
        dailyHours: 8,
        allocation: 100,
        weekends: null,
      })),
    );
  };
  const validate = () => {
    if (step === 0 && !app.name.trim())
      throw new Error("Give your app a name to continue.");
    if (step === 1) {
      if (!team.length)
        throw new Error("Add at least one person to your team.");
      const ids = team.filter((r) => r.personId).map((r) => r.personId);
      if (new Set(ids).size !== ids.length)
        throw new Error("A person can only join this app once.");
      for (const r of team) {
        personSchema.parse({
          id: r.id,
          name: r.name,
          dailyHours: r.dailyHours,
        });
        memberSchema.parse({
          id: r.id,
          appId: app.id,
          personId: r.id,
          role: r.role,
          allocation: r.allocation,
          weekends: r.weekends,
        });
      }
    }
    if (step === 2 || step === 3) appSchema.parse(app);
    if (step === 3 && (!Number.isInteger(number) || number < 1))
      throw new Error("Sprint number must be a positive whole number.");
  };
  const next = () => {
    try {
      validate();
      setError("");
      setStep((s) => (s === 2 && !useSprints ? 4 : s + 1));
    } catch (e) {
      setError(formError(e));
    }
  };
  const finish = async () => {
    try {
      appSchema.parse(app);
      if (useSprints && !firstSprint)
        throw new Error("Enter a valid planning date and duration.");
      const people = [...state.people],
        members = [...state.members];
      for (const row of team) {
        const personId = row.personId || uid();
        if (!row.personId)
          people.push({
            id: personId,
            name: row.name.trim(),
            dailyHours: row.dailyHours,
          });
        else {
          const index = people.findIndex((p) => p.id === personId);
          people[index] = {
            ...people[index],
            name: row.name.trim(),
            dailyHours: row.dailyHours,
          };
        }
        members.push({
          id: row.id,
          personId,
          appId: app.id,
          role: row.role.trim(),
          allocation: row.allocation,
          weekends: row.weekends,
        });
      }
      const sprint = firstSprint
        ? {
            id: uid(),
            appId: app.id,
            number,
            ...firstSprint,
            goal: "",
            notes: "",
            snapshot: null,
          }
        : null;
      await onSave(
        {
          ...state,
          apps: [...state.apps, { ...app, name: app.name.trim() }],
          people,
          members,
          sprints:
            useSprints && sprint ? [...state.sprints, sprint] : state.sprints,
        },
        app.id,
      );
    } catch (e) {
      setError(formError(e));
    }
  };
  return (
    <div className="wizard-screen">
      <aside className="wizard-aside">
        <div className="brand">
          <span className="brand-symbol">
            <Layers size={23} />
          </span>
          <span>
            Delivery<span className="brand-light"> Studio</span>
          </span>
        </div>
        <div className="wizard-intro">
          <span className="eyebrow">A LITTLE SETUP. A CLEARER ROADMAP.</span>
          <h1>
            Make room
            <br />
            for what’s next.
          </h1>
          <p>Your people, their time, and a plan that moves with reality.</p>
        </div>
        <ol className="wizard-steps">
          {visibleSteps.map((s, i) => (
            <li
              key={s.label}
              className={
                s.index === step ? "active" : s.index < step ? "complete" : ""
              }
            >
              <span>
                {s.index < step ? (
                  <CheckCircle2 size={18} />
                ) : (
                  <s.icon size={18} />
                )}
              </span>
              <div>
                <small>STEP {i + 1}</small>
                <strong>{s.label}</strong>
              </div>
            </li>
          ))}
        </ol>
        <div className="local-note">
          <span className="green-dot" />
          Local by design. Yours to keep.
        </div>
      </aside>
      <main className="wizard-main">
        <div className="wizard-top">
          <span>LET’S SET UP YOUR WORKSPACE</span>
          {onCancel && (
            <Button variant="ghost" onPress={onCancel}>
              Cancel setup
            </Button>
          )}
          <span>
            {visibleStep + 1} / {visibleSteps.length}
          </span>
        </div>
        <div className="wizard-content">
          <span className="step-kicker">
            STEP {String(visibleStep + 1).padStart(2, "0")}
          </span>
          {step === 0 && (
            <>
              <h2>
                Every great plan
                <br />
                starts somewhere.
              </h2>
              <p className="lead">
                Bring your people, features, and availability together.
              </p>
              <div className="form-stack">
                <Field
                  label="App name"
                  value={app.name}
                  onChange={(name) => patch({ name })}
                  placeholder="e.g. Northstar, your next big idea"
                  required
                />
                <div>
                  <label className="field-caption">Give it a color</label>
                  <div className="color-picker">
                    {colors.map((color) => (
                      <button
                        key={color}
                        aria-label={`Choose ${color}`}
                        aria-pressed={app.color === color}
                        style={{ background: color }}
                        className={app.color === color ? "chosen" : ""}
                        onClick={() => patch({ color })}
                      >
                        {app.color === color ? "✓" : ""}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="preset-card">
                  <Sparkles size={22} />
                  <div>
                    <strong>Start with a fictional team</strong>
                    <p>
                      Try six fictional people with editable names, roles, and
                      availability.
                    </p>
                  </div>
                  <Button variant="secondary" onPress={preset}>
                    Use example team
                  </Button>
                </div>
              </div>
            </>
          )}
          {step === 1 && (
            <>
              <h2>
                Put people
                <br />
                at the heart of the plan.
              </h2>
              <p className="lead">
                Add your team. Link an existing person to share availability
                across apps.
              </p>
              <div className="team-wizard">
                {team.map((r, i) => (
                  <div className="team-input-card" key={r.id}>
                    <div className="card-row">
                      <span className="step-kicker">PERSON {i + 1}</span>
                      <Button
                        variant="ghost"
                        size="sm"
                        isIconOnly
                        aria-label={`Remove ${r.name || "person"}`}
                        onPress={() =>
                          setTeam((rows) => rows.filter((t) => t.id !== r.id))
                        }
                      >
                        <Trash2 size={15} />
                      </Button>
                    </div>
                    {state.people.length > 0 && (
                      <Pick
                        label={`Person ${i + 1} source`}
                        value={r.personId || "new"}
                        options={[
                          { id: "new", label: "Create a new person" },
                          ...state.people.map((p) => ({
                            id: p.id,
                            label: p.name,
                          })),
                        ]}
                        onChange={(personId) => {
                          const p = state.people.find((v) => v.id === personId);
                          update(r.id, {
                            personId: personId === "new" ? "" : personId,
                            ...(p
                              ? { name: p.name, dailyHours: p.dailyHours }
                              : {}),
                          });
                        }}
                      />
                    )}
                    <div className="form-grid">
                      <Field
                        label={`Person ${i + 1} name`}
                        value={r.name}
                        onChange={(name) => update(r.id, { name })}
                        required
                      />
                      <Field
                        label={`Person ${i + 1} role`}
                        value={r.role}
                        onChange={(role) => update(r.id, { role })}
                        placeholder="Designer, Backend, QA…"
                        required
                      />
                      <Field
                        label={`Person ${i + 1} hours per day`}
                        type="number"
                        value={r.dailyHours}
                        onChange={(v) =>
                          update(r.id, { dailyHours: Number(v) })
                        }
                        min={0.25}
                        max={16}
                        hint={
                          r.personId
                            ? "Shared across all apps for this person."
                            : undefined
                        }
                      />
                      <Field
                        label={`Person ${i + 1} allocation (%)`}
                        type="number"
                        value={r.allocation}
                        onChange={(v) =>
                          update(r.id, { allocation: Number(v) })
                        }
                        min={1}
                        max={100}
                      />
                    </div>
                    <Check
                      label="Override app weekends for this person"
                      checked={r.weekends !== null}
                      onChange={(v) =>
                        update(r.id, { weekends: v ? [...app.weekends] : null })
                      }
                    />
                    {r.weekends !== null && (
                      <Weekends
                        value={r.weekends}
                        onChange={(weekends) => update(r.id, { weekends })}
                      />
                    )}
                  </div>
                ))}
              </div>
              <Button
                variant="outline"
                onPress={() =>
                  setTeam((rows) => [
                    ...rows,
                    {
                      id: uid(),
                      personId: "",
                      name: "",
                      role: "",
                      dailyHours: 8,
                      allocation: 100,
                      weekends: null,
                    },
                  ])
                }
              >
                <Plus size={16} />
                Add person
              </Button>
            </>
          )}
          {step === 2 && (
            <>
              <h2>
                A calendar that
                <br />
                works for your team.
              </h2>
              <p className="lead">
                Select the days off by default. Each team member can have their
                own weekend.
              </p>
              <div className="form-stack">
                <Field
                  label="Planning starts"
                  type="date"
                  value={app.planningStart}
                  onChange={(planningStart) => patch({ planningStart })}
                />
                <div>
                  <label className="field-caption">App weekend days</label>
                  <Weekends
                    value={app.weekends}
                    onChange={(weekends) => patch({ weekends })}
                  />
                  <p className="helper">Selected days are non-working days.</p>
                </div>
                <Check
                  label="Plan in sprints"
                  checked={useSprints}
                  onChange={setUseSprints}
                />
                <p className="helper">
                  Optional. Leave this off to plan features on a delivery
                  timeline. You can add sprints later.
                </p>
                <div className="info-box">
                  <CalendarDays size={20} />
                  <p>
                    Holidays and leave can be added any time. They’ll
                    automatically shift unfinished work and dependent delivery
                    dates.
                  </p>
                </div>
                <div className="summary-list">
                  {team
                    .filter((p) => p.weekends !== null)
                    .map((p) => (
                      <div key={p.id}>
                        <strong>{p.name}</strong>
                        <span>
                          Weekend:{" "}
                          {p.weekends!.map((d) => weekdays[d]).join(", ") ||
                            "None"}
                        </span>
                      </div>
                    ))}
                </div>
              </div>
            </>
          )}
          {step === 3 && (
            <>
              <h2>
                Find your
                <br />
                sprint rhythm.
              </h2>
              <p className="lead">
                Set a default cadence. Any individual sprint can have its own
                dates.
              </p>
              <div className="form-stack">
                <div className="form-grid">
                  <Pick
                    label="Default sprint length"
                    value={app.cadence}
                    onChange={(cadence) =>
                      patch({ cadence: cadence as AppConfig["cadence"] })
                    }
                    options={[
                      { id: "2w", label: "2 weeks" },
                      { id: "3w", label: "3 weeks" },
                      { id: "month", label: "1 calendar month" },
                      { id: "custom", label: "Custom duration" },
                    ]}
                  />
                  <Field
                    label="First sprint number"
                    type="number"
                    value={number}
                    onChange={(v) => setNumber(Number(v))}
                    min={1}
                  />
                </div>
                {app.cadence === "custom" && (
                  <Field
                    label="Calendar days per sprint"
                    type="number"
                    value={app.customDays}
                    onChange={(v) => patch({ customDays: Number(v) })}
                    min={1}
                    max={366}
                  />
                )}
                <div className="info-box">
                  <Flag size={20} />
                  <p>
                    {firstSprint ? (
                      <>
                        First sprint:{" "}
                        <strong>
                          {displayDate(firstSprint.start)} –{" "}
                          {displayDate(firstSprint.end)}
                        </strong>
                        . Sprint boundaries skip weekends shared by the whole
                        team. Working capacity uses each person’s calendar.
                      </>
                    ) : (
                      "Enter a valid planning date and duration to preview the sprint."
                    )}
                  </p>
                </div>
                <Field
                  label="General terms for sprint plans"
                  value={app.terms}
                  onChange={(terms) => patch({ terms })}
                  rows={6}
                  hint="Optional. Reused in exported plans and editable in app settings."
                />
              </div>
            </>
          )}
          {step === 4 && (
            <>
              <h2>
                You’re ready
                <br />
                to see the bigger picture.
              </h2>
              <p className="lead">
                Your app is set up. Add features next, and watch the timeline
                take shape.
              </p>
              <div className="review-card">
                <div className="review-app">
                  <span className="app-icon" style={{ background: app.color }}>
                    {app.name.slice(0, 1).toUpperCase()}
                  </span>
                  <div>
                    <h3>{app.name}</h3>
                    <p>
                      {team.length} people ·{" "}
                      {useSprints
                        ? `${app.cadence === "month" ? "Monthly" : app.cadence === "custom" ? `${app.customDays}-day` : app.cadence === "2w" ? "2-week" : "3-week"} sprints`
                        : "Feature timeline"}
                    </p>
                  </div>
                </div>
                <div className="summary-list">
                  <div>
                    <span>Planning start</span>
                    <strong>{displayDate(app.planningStart)}</strong>
                  </div>
                  <div>
                    <span>App weekends</span>
                    <strong>
                      {app.weekends.map((d) => weekdays[d]).join(", ") ||
                        "None"}
                    </strong>
                  </div>
                  <div>
                    <span>Personal weekend overrides</span>
                    <strong>
                      {team.filter((r) => r.weekends !== null).length}
                    </strong>
                  </div>
                  {useSprints && (
                    <div>
                      <span>First sprint</span>
                      <strong>#{number}</strong>
                    </div>
                  )}
                </div>
                <div className="review-people">
                  {team.map((r) => (
                    <span key={r.id}>
                      {r.name}
                      <small>{r.role}</small>
                    </span>
                  ))}
                </div>
              </div>
            </>
          )}
          <ErrorText text={error} />
          <div className="wizard-actions">
            {step > 0 ? (
              <Button
                variant="ghost"
                onPress={() => {
                  setStep((s) => (s === 4 && !useSprints ? 2 : s - 1));
                  setError("");
                }}
              >
                <ArrowLeft size={16} />
                Back
              </Button>
            ) : (
              <span />
            )}
            {step < 4 ? (
              <Button onPress={next}>
                Continue
                <ArrowRight size={17} />
              </Button>
            ) : (
              <Button onPress={finish} isPending={busy}>
                Open my planner
                <ArrowRight size={17} />
              </Button>
            )}
          </div>
        </div>
        <footer className="wizard-footer">
          FREE TO USE. NO CLOUD. NO SUBSCRIPTIONS.
          {!isSampleWorkspace() && <SampleLink />}
        </footer>
      </main>
    </div>
  );
}
