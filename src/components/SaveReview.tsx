import { dayLabel } from "../lib/working-days";
import { Dialog, Button } from "./ui";
import { displayDate } from "../lib/planning";
import type { PlannerState } from "../lib/model";
import { featureAssignees } from "../lib/feature-work";
import type { SchedulingChange } from "../lib/scheduling-review";
export interface SchedulingReview {
  state: PlannerState;
  changes: SchedulingChange[];
}
export function SaveReview({
  review,
  onDecision,
}: {
  review: SchedulingReview | null;
  onDecision: (accept: boolean) => void;
}) {
  return (
    <Dialog
      open={!!review}
      onClose={() => onDecision(false)}
      title="Review scheduling changes"
      wide
    >
      {review && (
        <div className="form-stack">
          <p>
            Review the effect on existing work. Accepted delivery dates and
            finalized plan text stay as saved.
          </p>
          <div className="save-review-list">
            {review.changes.map((change) => {
              const feature = review.state.features.find(
                (f) => f.id === change.id,
              )!;
              const names = featureAssignees(feature)
                .map((id) => review.state.people.find((p) => p.id === id)?.name)
                .filter(Boolean)
                .join(", ");
              return (
                <article key={change.id}>
                  <strong>{change.title}</strong>
                  <p>
                    {
                      review.state.apps.find((a) => a.id === feature.appId)
                        ?.name
                    }{" "}
                    · {names || "No assigned person"}
                  </p>
                  <p>
                    {displayDate(change.before)} → {displayDate(change.after)}{" "}
                    {change.days
                      ? `· ${Math.abs(change.days)} calendar days ${change.days > 0 ? "later" : "earlier"}`
                      : ""}
                  </p>
                  {Math.abs(change.allocatedBefore - change.allocatedAfter) >
                    1e-7 && (
                    <p>
                      Allocated capacity: {dayLabel(change.allocatedDaysBefore)}{" "}
                      → {dayLabel(change.allocatedDaysAfter)}. Saved estimate
                      retained.
                    </p>
                  )}
                  {change.reason && <p>{change.reason}</p>}
                </article>
              );
            })}
          </div>
          <div className="dialog-actions">
            <Button variant="outline" onPress={() => onDecision(false)}>
              Keep editing
            </Button>
            <Button onPress={() => onDecision(true)}>Save changes</Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
