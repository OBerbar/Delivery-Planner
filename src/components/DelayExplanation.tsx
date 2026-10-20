import { personDayLabel } from "../lib/working-days";
import { useMemo, useState } from "react";
import { CircleHelp } from "lucide-react";
import type { Feature, PlannerState } from "../lib/model";
import { today } from "../lib/model";
import { displayDate, type Schedule } from "../lib/planning";
import {
  dateRanges,
  explainDelay,
  type DelayExplanation as Explanation,
} from "../lib/delay-explanation";
import { Button, Dialog } from "./ui";
import "./delay-explanation.css";

function dates(values: string[]) {
  return dateRanges(values)
    .map((r) =>
      r.start === r.end
        ? displayDate(r.start)
        : `${displayDate(r.start)} – ${displayDate(r.end)}`,
    )
    .join(", ");
}
export function DelayExplanationBody({
  explanation,
}: {
  explanation: Explanation;
}) {
  return (
    <div
      className="delay-explanation-body"
      tabIndex={0}
      role="region"
      aria-label="Delay explanation details"
    >
      <dl className="delay-date-comparison">
        <div>
          <dt>Accepted delivery</dt>
          <dd>{displayDate(explanation.accepted)}</dd>
        </div>
        <div>
          <dt>Current forecast</dt>
          <dd>{displayDate(explanation.end)}</dd>
        </div>
      </dl>
      <p className="delay-summary">
        {explanation.delayDays !== undefined
          ? `${explanation.delayDays} calendar day${explanation.delayDays === 1 ? "" : "s"} later`
          : "Delivery cannot currently be forecast"}
      </p>
      <p className="helper delay-context">
        This explains the current schedule. The accepted date does not include
        the original schedule, so it cannot prove which change introduced every
        day of delay. Working days of effort and calendar dates are different
        measures; contributors can overlap.
      </p>
      <h3>Affected people</h3>
      <ForecastPeople people={explanation.people} />
    </div>
  );
}
export function DelayExplanation({
  state,
  feature,
  forecast,
  timeline = false,
  savedEditor = false,
}: {
  state: PlannerState;
  feature: Feature;
  forecast: Schedule;
  timeline?: boolean;
  savedEditor?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const now = today();
  const explanation = useMemo(
    () => (open ? explainDelay(state, feature.id, forecast, now) : null),
    [open, state, feature.id, forecast, now],
  );
  if (!feature.commitment || !forecast.features[feature.id]?.commitmentDelayed)
    return null;
  const content = explanation && (
    <>
      {savedEditor && (
        <p className="helper">
          This is the saved feature’s forecast. Save edits to recalculate its
          explanation.
        </p>
      )}
      <DelayExplanationBody explanation={explanation} />
    </>
  );
  return timeline ? (
    <>
      <Button
        variant="ghost"
        isIconOnly
        className="timeline-delay-trigger"
        aria-label={`Why delayed? ${feature.title}`}
        onPress={() => setOpen(true)}
      >
        <CircleHelp size={17} aria-hidden="true" />
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={`Why ${feature.title} is delayed`}
        wide
      >
        {content}
      </Dialog>
    </>
  ) : (
    <details
      className="delay-explanation"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary aria-label={`Why delayed? ${feature.title}`}>
        Why delayed?
      </summary>
      {content}
    </details>
  );
}

export function ForecastPeople({ people }: { people: Explanation["people"] }) {
  return (
    <>
      {people.map((person) => (
        <section
          className="delay-person"
          key={person.personId}
          aria-label={`${person.name} delay details`}
        >
          <h4>{person.name}</h4>
          <p>
            Forecast finish: <strong>{displayDate(person.end)}</strong>
          </p>
          {person.reason && <p className="inline-warning">{person.reason}</p>}
          {!!person.capacityLostHours && (
            <p>
              {personDayLabel(person.capacityLostHours, person.dailyHours)} of
              capacity unavailable while scheduling this person’s work.
            </p>
          )}
          <h5>Competing work</h5>
          {person.competingWork.length ? (
            <ul>
              {person.competingWork.map((work) => (
                <li key={work.featureId}>
                  <strong>{work.title}</strong>
                  <span>
                    {work.internal
                      ? "Other work in this feature"
                      : work.appName}{" "}
                    · {personDayLabel(work.hours, person.dailyHours)} booked
                  </span>
                  <span>{dates(work.dates)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p>
              No competing feature bookings reduced this person’s scheduling
              capacity.
            </p>
          )}
          {!!person.reassignedHours && (
            <p>
              {personDayLabel(person.reassignedHours, person.dailyHours)} was
              reassigned to parallel work. That reassignment holds delivery
              dates and is not counted as a capacity-driven delay.
            </p>
          )}
          <h5>Calendar constraints</h5>
          {person.calendar.length ? (
            <ul>
              {person.calendar.map((entry, i) => (
                <li key={i}>
                  <strong>
                    {entry.kind === "weekend"
                      ? entry.label
                      : `${entry.kind === "leave" ? "Leave" : "Holiday"}: ${entry.label}`}
                  </strong>
                  <span>{dates(entry.dates)}</span>
                  <span>
                    {personDayLabel(entry.hours, person.dailyHours)} unavailable
                    for this app in this work window
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p>
              No calendar constraints reduced this app’s availability in this
              work window.
            </p>
          )}
          {!!person.startConstraints.length && (
            <>
              <h5>Start and dependency constraints</h5>
              <ul>
                {person.startConstraints.map((constraint, i) => (
                  <li key={i}>
                    <strong>
                      {constraint.kind === "dependency" ||
                      constraint.kind === "blocked-dependency"
                        ? `Waiting for ${constraint.featureTitle} · ${constraint.label} (${constraint.personName})`
                        : constraint.label}
                    </strong>
                    <span>
                      {constraint.date
                        ? `Earliest start: ${displayDate(constraint.date)}`
                        : "Dependency has no scheduled finish"}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      ))}
    </>
  );
}
