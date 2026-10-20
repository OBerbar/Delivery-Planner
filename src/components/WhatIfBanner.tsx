import { dayLabel } from "../lib/working-days";
import { Button } from "./ui";
import { displayDate } from "../lib/planning";
import type { ExperimentComparison } from "../lib/what-if";
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
          Compare with saved plan · {comparison.features.length} feature changes
        </summary>
        {!comparison.features.length && (
          <p>
            No feature forecast changes yet. Calendar and settings edits are
            also included when you Apply.
          </p>
        )}
        <div className="experiment-changes">
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
                {displayDate(change.before)} → {displayDate(change.after)}{" "}
                {change.days
                  ? `· ${Math.abs(change.days)} calendar days ${change.days > 0 ? "later" : "earlier"}`
                  : ""}
              </p>
              <p>
                Allocated: {dayLabel(change.allocatedDaysBefore)} →{" "}
                {dayLabel(change.allocatedDaysAfter)}
              </p>
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
                  {p.name}: {dayLabel(p.beforeDays)} → {dayLabel(p.afterDays)}
                </li>
              ))}
            </ul>
          </>
        )}
      </details>
    </section>
  );
}
