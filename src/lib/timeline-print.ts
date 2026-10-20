import type { PlannerState } from "./model";
import type { Schedule } from "./planning";
import {
  timelinePrintPages,
  type TimelinePrintScope,
} from "./timeline-print-layout";
import { timelinePrintDocument } from "./timeline-print-document";

/** Local print preview: no server requests, persisted changes or remote resources. */
export function exportTimelinePdf(
  state: PlannerState,
  appId: string,
  forecast: Schedule,
  start: string,
  end: string,
  experiment = false,
  scope: TimelinePrintScope = "all",
): void {
  const pages = timelinePrintPages(state, appId, forecast, start, end, scope);
  const html = timelinePrintDocument(state, appId, pages, experiment);
  const action =
    scope === "compact-features"
      ? "Export compact features PDF"
      : scope === "features"
        ? "Export features PDF"
        : "Export timeline PDF";
  const preview = window.open("about:blank", "_blank");
  if (!preview)
    throw new Error(
      `Allow pop-ups for this local planner, then choose ${action} again.`,
    );
  try {
    preview.document.open();
    preview.document.write(html);
    preview.document.close();
    const print = () => {
      preview.focus();
      preview.print();
    };
    preview.document
      .getElementById("print-pdf")!
      .addEventListener("click", print);
    preview.document
      .getElementById("close-preview")!
      .addEventListener("click", () => preview.close());
    // The rendered document remains available after cancellation, with a Print / Save PDF retry button.
    void preview.document.fonts.ready.then(() => {
      if (!preview.closed) {
        try {
          print();
        } catch {
          preview.document.querySelector(".print-actions p")!.textContent =
            "Printing could not start. Choose Print / Save PDF to retry.";
        }
      }
    });
  } catch {
    preview.close();
    throw new Error(
      `The timeline preview could not open. Choose ${action} to retry.`,
    );
  }
}
