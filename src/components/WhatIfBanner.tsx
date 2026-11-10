import { dayLabel } from "../lib/working-days";
import { Button } from "./ui";
import { displayDate } from "../lib/planning";
import type { ExperimentComparison } from "../lib/what-if";

function allocationComparison(
  before: number,
  after: number,
  showUnchanged = true,
) {
  const previous = dayLabel(before),
    current = dayLabel(after);
  if (Math.abs(before - after) < 1e-7)
    return `${current}${showUnchanged ? " (unchanged)" : ""}`;
  if (previous === current)
    return `${current} (small ${after > before ? "increase" : "decrease"}; below displayed precision)`;
  return `${previous} → ${current}`;
}

export function WhatIfBanner({
  sample = false,
  comparison,
  changed,
  busy,
  onApply,
  onDiscard,
}: {
  sample?: boolean;
  comparison: ExperimentComparison;
  changed: boolean;
  busy: boolean;
  onApply: () => void;
  onDiscard: () => void;
}) {
  return (
    <section
      className="what-if-banner"
      role="region"
      aria-label="What-if experiment"
    >
      <div className="what-if-header">
        <div>
          <h2>What-if experiment</h2>
          <p>
            {sample
              ? "Apply keeps changes only in this sample tab. Discard returns to the sample before the experiment. Your saved planner stays separate."
              : "Changes stay temporary across all apps. Apply saves them together; Discard returns to the saved workspace."}
          </p>
        </div>
        <div className="button-row">
          <Button variant="outline" isDisabled={busy} onPress={onDiscard}>
            Discard experiment
          </Button>
          <Button
            isDisabled={busy || !changed}
            isPending={busy}
            onPress={onApply}
          >
            Apply experiment
          </Button>
        </div>
      </div>
      <details>
        <summary>
          Compare with saved plan · {comparison.features.length} feature{" "}
          {comparison.features.length === 1 ? "change" : "changes"}
        </summary>
        {!comparison.features.length && (
          <p>
            No feature changes to show. Calendar, settings and priority edits
            are still included when you Apply.
          </p>
        )}
        <div
          className="experiment-changes"
          role="region"
          aria-label="Feature comparison details"
          tabIndex={0}
        >
          {comparison.features.map((change) => (
            <article key={change.id}>
              <strong>
                {change.title} <span>({change.kind})</span>
              </strong>
              <p>
                {change.app} ·{" "}
                {change.people.join(", ") || "No assigned person"}
              </p>
              <p>
                {change.kind === "changed" && change.before === change.after
                  ? `Delivery unchanged: ${displayDate(change.after)}`
                  : `${displayDate(change.before)} → ${displayDate(change.after)}`}{" "}
                {change.days
                  ? `· ${Math.abs(change.days)} calendar days ${change.days > 0 ? "later" : "earlier"}`
                  : ""}
              </p>
              {change.kind === "changed" &&
                change.startBefore !== change.startAfter && (
                  <p>
                    Start: {displayDate(change.startBefore)} →{" "}
                    {displayDate(change.startAfter)}
                  </p>
                )}
              <p>
                Allocated:{" "}
                {allocationComparison(
                  change.allocatedDaysBefore,
                  change.allocatedDaysAfter,
                  change.kind === "changed",
                )}
              </p>
              {!!change.reasons.length && (
                <ul
                  className="experiment-change-reasons"
                  aria-label="What changed"
                >
                  {change.reasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              )}
            </article>
          ))}
        </div>
        {!!comparison.people.length && (
          <>
            <h3>Allocated working days by person</h3>
            <p>
              All scheduled work across the workspace, including the full
              forecast beyond individual sprints.
            </p>
            <ul>
              {comparison.people.map((p) => (
                <li key={p.id}>
                  {p.name}: {allocationComparison(p.beforeDays, p.afterDays)}
                </li>
              ))}
            </ul>
          </>
        )}
      </details>
    </section>
  );
}
