import { useMemo } from "react";
import { differenceInCalendarDays, parseISO } from "date-fns";
import { today, type Feature, type PlannerState } from "../lib/model";
import { featureOverview } from "../lib/feature-overview";
import { displayDate, type Schedule } from "../lib/planning";
import { dayLabel } from "../lib/working-days";
import { featureStatus, statusLabels } from "../lib/date-status";
import { usePlanningMode } from "../lib/planning-mode";
import { ForecastPeople } from "./DelayExplanation";
import { CommitmentDates } from "./Features";
import { Button, Dialog } from "./ui";
import "./feature-editor.css";
import "./feature-overview.css";

export function FeatureOverview({
  state,
  feature,
  forecast,
  onClose,
  onEdit,
  onTimeline,
  busy,
}: {
  state: PlannerState;
  feature: Feature;
  forecast: Schedule;
  onClose: () => void;
  onEdit: () => void;
  onTimeline: () => void;
  busy: boolean;
}) {
  const data = useMemo(
    () => featureOverview(state, feature, forecast),
    [state, feature, forecast],
  );
  const experiment = usePlanningMode();
  const result = forecast.features[feature.id];
  const status = featureStatus(feature, result ?? {}, forecast.asOf ?? today());
  const determiners = data.people.filter((p) => p.determinesDelivery);
  const inputEstimates = data.people.some(
    (person) => person.inputEstimateDays !== undefined,
  );
  const sharedEstimate = inputEstimates
    ? data.sharedInputEstimateDays
    : data.sharedEffortDays;
  const equal = sharedEstimate !== undefined;
  const offset = (date: string) =>
    differenceInCalendarDays(parseISO(date), parseISO(data.start!));
  return (
    <Dialog open onClose={onClose} title="Feature overview" panel>
      <div className="feature-overview">
        <header className="overview-feature-heading">
          <p className="overview-eyebrow">
            {state.apps.find((a) => a.id === feature.appId)?.name}
            {experiment ? " · What-if forecast" : ""}
          </p>
          <h2>{feature.title}</h2>
          <span className={`status-pill ${status}`}>
            {statusLabels[status]}
          </span>
          {feature.description && <p>{feature.description}</p>}
        </header>
        <dl className="overview-dates">
          <div>
            <dt>Scheduled start</dt>
            <dd>{displayDate(data.start)}</dd>
          </div>
          <div>
            <dt>Forecast delivery</dt>
            <dd>{displayDate(data.end)}</dd>
          </div>
          <div>
            <dt>Elapsed duration</dt>
            <dd>
              {data.calendarDays === undefined
                ? "Not scheduled"
                : `${data.calendarDays} calendar day${data.calendarDays === 1 ? "" : "s"}`}
            </dd>
          </div>
        </dl>
        <CommitmentDates feature={feature} result={result} />
        {feature.target && (
          <p className="helper">
            Target delivery: {displayDate(feature.target)}
          </p>
        )}
        {result?.warning && <p className="inline-warning">{result.warning}</p>}
        <section className="overview-effort" aria-label="Team effort">
          <h3>Team effort</h3>
          {equal ? (
            <p className="overview-effort-summary">
              {dayLabel(sharedEstimate!)} each ·{" "}
              {data.allTeam ? "whole team" : `${data.people.length} people`}
              {data.allTeam ? ` · ${data.people.length} people` : ""}
            </p>
          ) : (
            <p className="overview-effort-summary">
              Different estimates by person · {data.people.length} people
            </p>
          )}
          <p className="helper">
            Working days measure effort. Calendar duration includes waiting and
            time off; people can work in parallel. Allocation below is planned
            work, not time tracking.
          </p>
          {data.people.some(
            (person) =>
              person.inputEstimateDays !== undefined &&
              Math.abs(person.inputEstimateDays - person.estimatedDays) > 1e-7,
          ) && (
            <p className="helper">
              The summary keeps your saved estimates. Per-person effort uses
              full working-day equivalents, which can differ because of
              allocation or changed daily hours.
            </p>
          )}
          <details className="overview-people" open={!equal}>
            <summary>Per-person breakdown</summary>
            {data.people.map((person) => (
              <section
                className="overview-person"
                role="region"
                aria-label={`${person.name} effort and dates`}
                key={person.personId}
              >
                <div className="overview-person-heading">
                  <h4>{person.name}</h4>
                  <span>
                    {person.role} · {person.allocation}% allocation
                  </span>
                </div>
                <dl className="overview-person-values">
                  {person.inputEstimateDays !== undefined && (
                    <div>
                      <dt>Saved estimate</dt>
                      <dd>{dayLabel(person.inputEstimateDays)}</dd>
                    </div>
                  )}
                  <div>
                    <dt>Estimated effort</dt>
                    <dd>{dayLabel(person.estimatedDays)}</dd>
                  </div>
                  <div>
                    <dt>Remaining effort</dt>
                    <dd>{dayLabel(person.remainingDays)}</dd>
                  </div>
                  <div>
                    <dt>Planned allocation</dt>
                    <dd>
                      {person.completed &&
                      person.allocatedDays === 0 &&
                      person.reassignedDays === 0
                        ? "Not recorded"
                        : dayLabel(person.allocatedDays)}
                    </dd>
                  </div>
                  <div>
                    <dt>Start</dt>
                    <dd>{displayDate(person.start)}</dd>
                  </div>
                  <div>
                    <dt>Finish</dt>
                    <dd>{displayDate(person.end)}</dd>
                  </div>
                </dl>
                {person.reassignedDays > 0 && (
                  <p>
                    {dayLabel(person.reassignedDays)} reassigned; saved estimate
                    retained.
                  </p>
                )}
                {person.reason && (
                  <p className="inline-warning">{person.reason}</p>
                )}
                {person.determinesDelivery && (
                  <p className="overview-determiner">
                    {person.name} determines delivery
                  </p>
                )}
                {person.completed && (
                  <p className="helper">
                    Scheduled work is complete. Effort and allocation describe
                    the plan, not recorded time spent.
                  </p>
                )}
              </section>
            ))}
          </details>
        </section>
        <section aria-label="Delivery drivers">
          <h3>Who determines delivery?</h3>
          <p>
            {!data.end
              ? "Delivery is not fully scheduled. Resolve the planning warnings to identify its finish."
              : determiners.length
                ? `${determiners.map((p) => p.name).join(" and ")} ${determiners.length === 1 ? "determines" : "determine"} delivery${determiners.length > 1 ? " together" : ""}: ${displayDate(data.end)}.`
                : "Delivery follows the feature’s scheduled work."}
          </p>
        </section>
        <figure
          className="overview-mini-timeline"
          aria-label="Person delivery timeline"
        >
          <figcaption>Person delivery timeline</figcaption>
          {data.start && data.end && data.calendarDays ? (
            <>
              <div className="overview-mini-range">
                <span>{displayDate(data.start)}</span>
                <span>{displayDate(data.end)}</span>
              </div>
              {data.people.map((p) => (
                <div className="overview-mini-row" key={p.personId}>
                  <span>{p.name}</span>
                  <div
                    className="overview-mini-track"
                    role="img"
                    aria-label={`${p.name}: ${displayDate(p.start)} – ${displayDate(p.end)}`}
                  >
                    {p.start && p.end ? (
                      <span
                        className={`overview-mini-bar ${p.determinesDelivery ? "determines" : ""}`}
                        style={{
                          left: `${(offset(p.start) / data.calendarDays!) * 100}%`,
                          width: `${((offset(p.end) - offset(p.start) + 1) / data.calendarDays!) * 100}%`,
                        }}
                      />
                    ) : (
                      <span className="helper">Not scheduled</span>
                    )}
                  </div>
                </div>
              ))}
              <p className="helper">
                Bars show each person’s work window, including gaps and
                nonworking days. Highlighted bars finish on the delivery date.
              </p>
            </>
          ) : (
            <p className="helper">
              A complete timeline appears when all work has scheduled dates.
            </p>
          )}
        </figure>
        <section
          className="overview-constraints delay-explanation-body"
          aria-label="Forecast constraints"
        >
          <h3>What shapes this forecast?</h3>
          <div className="overview-assumptions">
            <span>Ignore leave: {feature.ignoreLeave ? "On" : "Off"}</span>
            <span>
              Keep other delivery dates:{" "}
              {feature.doesntAffectOtherWork ? "On" : "Off"}
            </span>
          </div>
          {feature.ignoreLeave && (
            <p className="helper">
              Personal leave is excluded for this feature. Holidays, weekends,
              shared bookings and dependencies still apply.
            </p>
          )}
          <p className="helper">
            These are current scheduling constraints, not a history of changes.
            Booked and unavailable working days can overlap; they cannot be
            added into a calendar-day delay.
          </p>
          {data.constraints.length ? (
            <ForecastPeople people={data.constraints} />
          ) : (
            <p className="helper">
              {result?.done
                ? "This feature is complete. Historical causes are not reconstructed from today’s calendars."
                : "No unfinished work has scheduling constraints to show."}
            </p>
          )}
        </section>
        <div className="dialog-actions overview-actions">
          <Button variant="ghost" onPress={onClose}>
            Close overview
          </Button>
          <Button variant="secondary" onPress={onTimeline}>
            View on timeline
          </Button>
          <Button isDisabled={busy} onPress={onEdit}>
            Edit feature
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
