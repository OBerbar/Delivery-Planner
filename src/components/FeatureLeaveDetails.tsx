import { personDayLabel } from "../lib/working-days";
import { useState } from "react";
import { CalendarDays } from "lucide-react";
import { Button, Dialog } from "./ui";
import { displayDate } from "../lib/planning";
import { featureLeaveRanges, type FeatureLeaveDay } from "../lib/feature-leave";
import "./feature-leave.css";

export function FeatureLeaveDetails({
  title,
  days,
}: {
  title: string;
  days: FeatureLeaveDay[];
}) {
  const [open, setOpen] = useState(false);
  if (!days.length) return null;
  return (
    <>
      <Button
        variant="ghost"
        isIconOnly
        className="feature-leave-trigger"
        aria-label={`Leave details for ${title}`}
        onPress={() => setOpen(true)}
      >
        <CalendarDays size={17} aria-hidden="true" />
      </Button>
      <Dialog
        title="Feature leave details"
        open={open}
        onClose={() => setOpen(false)}
        wide
      >
        <div
          className="feature-leave-details"
          role="region"
          aria-label="Feature leave dates and people"
          tabIndex={0}
        >
          <p className="feature-leave-title">{title}</p>
          <p>
            Leave affecting active assignees within this timeline window.
            Stripes mean some calendar capacity remains; stronger shading means
            all active assignees are unavailable. Shading includes overlapping
            weekends and holidays throughout the saved leave period.
          </p>
          <p className="helper">
            Calendar capacity is availability for this app before competing
            work. Overlapping weekends and holidays add no extra leave-related
            capacity loss. These dates provide context, not an exact count of
            delivery delay. Use Why delayed? for commitment explanations.
          </p>
          {featureLeaveRanges(days).map((range) => (
            <section
              className={`feature-leave-range ${range.coverage}`}
              key={range.date}
            >
              <h3>
                {displayDate(range.date)}
                {range.end !== range.date && ` – ${displayDate(range.end)}`}
              </h3>
              <p className="feature-leave-coverage">
                {range.coverage === "full"
                  ? "All unavailable"
                  : "Partial leave impact"}
              </p>
              <ul>
                {range.people.map((person) => (
                  <li key={person.personId}>
                    <strong>{person.name}</strong>
                    {person.leaves.map((leave) => (
                      <span key={leave.id}>
                        {leave.note.trim() || "Personal leave"} ·{" "}
                        {leave.hours === null
                          ? "Full day off"
                          : `${personDayLabel(leave.hours, person.dailyHours)} off per day`}
                        <br />
                        Saved leave: {displayDate(leave.start)}
                        {leave.end !== leave.start &&
                          ` – ${displayDate(leave.end)}`}
                      </span>
                    ))}
                    {person.calendarReason && (
                      <span>{person.calendarReason}</span>
                    )}
                    <span>
                      {personDayLabel(person.remainingHours, person.dailyHours)}{" "}
                      calendar capacity remaining
                      {person.lostHours > 0
                        ? ` · ${personDayLabel(person.lostHours, person.dailyHours)} reduced by leave`
                        : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </Dialog>
    </>
  );
}
