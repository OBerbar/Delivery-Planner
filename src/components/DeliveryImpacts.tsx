import { ArrowRight, TriangleAlert } from "lucide-react";
import type { DeliveryChange } from "../lib/changes";
import { displayDate } from "../lib/planning";

export function DeliveryImpacts({
  changes,
  reason,
}: {
  changes: DeliveryChange[];
  reason: string;
}) {
  if (!changes.length) return null;
  return (
    <section
      className="impact-panel"
      aria-label="Delivery changes"
      aria-live="polite"
    >
      <div>
        <TriangleAlert size={18} />
        <h3>Here’s what moved</h3>
        <span>{reason}. These forecasts were recalculated.</span>
      </div>
      {changes.map((change) => (
        <article className="delivery-impact" key={change.id}>
          <p>
            <strong>{change.title}</strong>
            <span>
              {displayDate(change.before)}
              <ArrowRight size={14} />
              {displayDate(change.after)}
            </span>
          </p>
          {change.days !== undefined && change.days !== 0 && (
            <b className={change.days > 0 ? "impact-delay" : "impact-earlier"}>
              {Math.abs(change.days)}{" "}
              {Math.abs(change.days) === 1 ? "day" : "days"}{" "}
              {change.days > 0 ? "later" : "earlier"}
            </b>
          )}
          {change.reason && <small>{change.reason}</small>}
        </article>
      ))}
    </section>
  );
}
