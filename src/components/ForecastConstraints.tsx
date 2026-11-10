import type { Feature } from "../lib/model";
import type { FeatureOverview } from "../lib/feature-overview";
import { dateRanges, type PersonDelay } from "../lib/delay-explanation";
import { displayDate } from "../lib/planning";
import { personDayLabel } from "../lib/working-days";

function exactDates(values: string[]) {
  return dateRanges(values)
    .map(({ start, end }) =>
      start === end
        ? displayDate(start)
        : `${displayDate(start)} – ${displayDate(end)}`,
    )
    .join(", ");
}

function dateWindow(values: string[]) {
  const sorted = [...values].sort();
  return sorted[0] === sorted.at(-1)
    ? displayDate(sorted[0])
    : `Within ${displayDate(sorted[0])} – ${displayDate(sorted.at(-1))}`;
}

function SchedulingDetails({ person }: { person: PersonDelay }) {
  const weekends = person.calendar.filter((entry) => entry.kind === "weekend");
  const weekendDays = new Set(weekends.flatMap((entry) => entry.dates)).size;
  return (
    <details className="forecast-evidence">
      <summary>View scheduling details</summary>
      <div className="forecast-evidence-body">
        {person.capacityLostHours > 0 && (
          <p>
            <strong>Capacity unavailable</strong>:{" "}
            {personDayLabel(person.capacityLostHours, person.dailyHours)} lost
            to earlier bookings. This is not extra calendar-day delay.
          </p>
        )}
        {person.reassignedHours > 0 && (
          <p>
            <strong>Parallel capacity reassigned</strong>:{" "}
            {personDayLabel(person.reassignedHours, person.dailyHours)}.
            Delivery windows are held; saved effort is retained.
          </p>
        )}
        {weekendDays > 0 && (
          <div className="forecast-evidence-item">
            <strong>Weekend</strong>
            <span>
              {weekendDays} weekend {weekendDays === 1 ? "day" : "days"}
            </span>
            <span>{exactDates(weekends.flatMap((entry) => entry.dates))}</span>
            <span>Already accounted for in the working calendar.</span>
          </div>
        )}
        {person.competingWork.map((work) => (
          <div className="forecast-evidence-item" key={work.featureId}>
            <strong>{work.title} · booked dates</strong>
            <span>{exactDates(work.dates)}</span>
            <span>
              {personDayLabel(work.hours, person.dailyHours)} booked ·{" "}
              {work.internal ? "Other work in this feature" : work.appName}
            </span>
          </div>
        ))}
        {person.calendar
          .filter((entry) => entry.kind !== "weekend")
          .map((entry, i) => (
            <div className="forecast-evidence-item" key={i}>
              <strong>
                {entry.kind === "leave" ? "Leave" : "Holiday"}: {entry.label} ·
                affected dates
              </strong>
              <span>{exactDates(entry.dates)}</span>
              <span>
                {personDayLabel(entry.hours, person.dailyHours)} unavailable for
                this app
              </span>
            </div>
          ))}
        {person.startConstraints.map((constraint, i) => (
          <div className="forecast-evidence-item" key={i}>
            <strong>
              {constraint.featureTitle
                ? `${constraint.featureTitle} · ${constraint.label} (${constraint.personName})`
                : constraint.label}
            </strong>
            <span>
              {constraint.date
                ? `Earliest start: ${displayDate(constraint.date)}`
                : "Dependency has no scheduled finish"}
            </span>
          </div>
        ))}
        {!person.calendar.length &&
          !person.competingWork.length &&
          !person.startConstraints.length &&
          !person.capacityLostHours &&
          !person.reassignedHours && (
            <p>No additional scheduling details are available.</p>
          )}
      </div>
    </details>
  );
}

function PersonConstraints({
  person,
  determines,
}: {
  person: PersonDelay;
  determines: boolean;
}) {
  const calendar = person.calendar.filter((entry) => entry.kind !== "weekend");
  const dependencies = person.startConstraints.filter(
    (constraint) =>
      constraint.kind === "dependency" ||
      constraint.kind === "blocked-dependency",
  );
  const routineStart =
    person.startConstraints
      .filter((constraint) =>
        ["planning-from", "today", "app-start"].includes(constraint.kind),
      )
      .map((constraint) => constraint.date ?? "")
      .sort()
      .at(-1) ?? "";
  const explicitStart = person.startConstraints
    .filter(
      (constraint) =>
        ["not-before", "sprint", "unblock"].includes(constraint.kind) &&
        constraint.date &&
        constraint.date > routineStart,
    )
    .map((constraint) => constraint.date!)
    .sort()
    .at(-1);
  const hasHighlights =
    person.competingWork.length ||
    calendar.length ||
    dependencies.length ||
    explicitStart ||
    person.reassignedHours;
  return (
    <section
      className="forecast-person"
      aria-label={`${person.name} forecast constraints`}
    >
      <details open={determines || !person.end}>
        <summary>
          <span className="forecast-person-name">{person.name}</span>
          <span>
            {person.end
              ? `Finishes ${displayDate(person.end)}`
              : "Not scheduled"}
          </span>
          {determines && (
            <span className="forecast-delivery-label">Sets delivery date</span>
          )}
          {!person.end && (
            <span className="forecast-delivery-label">
              Prevents a complete forecast
            </span>
          )}
        </summary>
        <div className="forecast-person-body">
          {person.reason && <p className="inline-warning">{person.reason}</p>}
          {hasHighlights ? (
            <ul className="forecast-highlights">
              {person.competingWork.map((work) => (
                <li key={work.featureId}>
                  <strong>{work.title}</strong>
                  <span>
                    {work.internal
                      ? "Other work in this feature"
                      : work.appName}{" "}
                    · {personDayLabel(work.hours, person.dailyHours)} booked
                  </span>
                  <span>{dateWindow(work.dates)}</span>
                </li>
              ))}
              {calendar.map((entry, i) => (
                <li key={i}>
                  <strong>
                    {entry.kind === "leave" ? "Leave" : "Holiday"}:{" "}
                    {entry.label}
                  </strong>
                  <span>
                    {personDayLabel(entry.hours, person.dailyHours)} unavailable
                    · {dateWindow(entry.dates)}
                  </span>
                </li>
              ))}
              {dependencies.map((constraint, i) => (
                <li key={`dependency-${i}`}>
                  <strong>Waiting for {constraint.featureTitle}</strong>
                  <span>
                    {constraint.label} · {constraint.personName}
                  </span>
                  <span>
                    {constraint.date
                      ? `Can follow from ${displayDate(constraint.date)}`
                      : "Dependency has no scheduled finish"}
                  </span>
                </li>
              ))}
              {explicitStart && (
                <li>
                  <strong>
                    Start restriction: {displayDate(explicitStart)}
                  </strong>
                </li>
              )}
              {person.reassignedHours > 0 && (
                <li>
                  <strong>Capacity reassigned to parallel work</strong>
                  <span>Delivery window held; see scheduling details.</span>
                </li>
              )}
            </ul>
          ) : !person.reason ? (
            <p>No additional constraints beyond the working calendar.</p>
          ) : null}
          <SchedulingDetails person={person} />
        </div>
      </details>
    </section>
  );
}

export function ForecastConstraints({
  feature,
  data,
  completed,
}: {
  feature: Feature;
  data: FeatureOverview;
  completed?: boolean;
}) {
  const determines = new Set(
    data.people
      .filter((person) => person.determinesDelivery)
      .map((person) => person.personId),
  );
  const people = [...data.constraints].sort((a, b) => {
    const rank = (person: PersonDelay) =>
      !person.end ? 0 : determines.has(person.personId) ? 1 : 2;
    return rank(a) - rank(b);
  });
  const names = data.people
    .filter((person) => person.determinesDelivery)
    .map((person) => person.name);
  return (
    <section className="overview-constraints" aria-label="Forecast constraints">
      <h3>What shapes this forecast?</h3>
      {people.length > 0 && (
        <>
          <p className="forecast-delivery-summary">
            {!data.end
              ? "Delivery cannot currently be forecast. Review unscheduled work first."
              : names.length
                ? `${names.join(" and ")} ${names.length === 1 ? "sets" : "set"} delivery on ${displayDate(data.end)}.`
                : `Forecast delivery: ${displayDate(data.end)}.`}
          </p>
          <p className="helper">
            Forecast accounts for each person’s working calendar. Expand a
            person for constraints and scheduling details.
          </p>
        </>
      )}
      {(feature.ignoreLeave || feature.doesntAffectOtherWork) && (
        <div className="overview-assumptions">
          {feature.ignoreLeave && <span>Ignore leave: On</span>}
          {feature.doesntAffectOtherWork && (
            <span>Keep other delivery dates: On</span>
          )}
        </div>
      )}
      {feature.ignoreLeave && (
        <p className="helper">
          Personal leave is excluded for this feature. Holidays, weekends,
          shared bookings and dependencies still apply.
        </p>
      )}
      {people.length ? (
        <>
          {people.map((person) => (
            <PersonConstraints
              key={person.personId}
              person={person}
              determines={determines.has(person.personId)}
            />
          ))}
          <p className="helper">
            Current scheduling constraints, not a change history. Working-day
            amounts can overlap and do not add up to calendar-day delay.
          </p>
        </>
      ) : (
        <p className="helper">
          {completed
            ? "This feature is complete. Historical causes are not reconstructed from today’s calendars."
            : "No unfinished work has scheduling constraints to show."}
        </p>
      )}
    </section>
  );
}
