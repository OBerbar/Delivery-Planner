import { differenceInCalendarDays, format, parseISO } from "date-fns";
import type { PlannerState } from "./model";
import { FEATURE_BLOCKED_COLOR } from "./date-status";
import {
  printDayKind,
  PRINT_LABEL_WIDTH as LABEL,
  PRINT_GRID_WIDTH as GRID,
  PRINT_LANE_HEIGHT,
  type TimelinePrintPage,
} from "./timeline-print-layout";

export const escapePrintText = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const text = (x: number, y: number, value: string, size = 11, attrs = "") =>
  `<text x="${x}" y="${y}" font-size="${size}" ${attrs}>${escapePrintText(value)}</text>`;
const rect = (
  x: number,
  y: number,
  w: number,
  h: number,
  fill: string,
  attrs = "",
) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" ${attrs}/>`;
const fills = {
  working: "#ffffff",
  weekend: "#e8e8f3",
  leave: "#f3e1d9",
  holiday: "#efe9d4",
};
const HEADER = 91;

function chart(
  state: PlannerState,
  appId: string,
  page: TimelinePrintPage,
  index: number,
  featuresOnly: boolean,
): string {
  const cell = GRID / page.dates.length;
  const offset = (date: string) =>
    differenceInCalendarDays(parseISO(date), parseISO(page.start));
  const elements: string[] = [
    rect(0, 0, 1000, HEADER, "#f8f8fc"),
    text(
      12,
      26,
      page.view === "features" ? "Feature" : "PERSON / ASSIGNED FEATURES",
      10,
      'font-weight="bold"',
    ),
  ];
  page.dates.forEach((date, i) => {
    const x = LABEL + i * cell;
    if (i === 0 || date.slice(8) === "01")
      elements.push(
        text(
          x + 3,
          17,
          format(parseISO(date), "MMMM yyyy"),
          10,
          'font-weight="bold"',
        ),
      );
    const weekend = state.apps
      .find((a) => a.id === appId)!
      .weekends.includes(parseISO(date).getDay());
    elements.push(
      rect(x, 25, cell, 34, weekend ? fills.weekend : "#fff"),
      text(
        x + cell / 2,
        38,
        format(parseISO(date), "EEEEE"),
        8,
        'text-anchor="middle"',
      ),
      text(
        x + cell / 2,
        51,
        String(Number(date.slice(8))),
        9,
        'text-anchor="middle"',
      ),
    );
  });
  const sprintLanes: number[] = [];
  for (const sprint of state.sprints
    .filter(
      (s) => s.appId === appId && s.end >= page.start && s.start <= page.end,
    )
    .sort((a, b) => a.start.localeCompare(b.start))) {
    const left = Math.max(0, offset(sprint.start)),
      right = Math.min(page.dates.length, offset(sprint.end) + 1);
    const lane = sprintLanes.findIndex((end) => end <= left);
    const actual = lane < 0 ? sprintLanes.length : lane;
    sprintLanes[actual] = right;
    elements.push(
      rect(
        LABEL + left * cell,
        63 + Math.min(actual, 1) * 13,
        (right - left) * cell,
        12,
        "#ece8fa",
      ),
      text(
        LABEL + left * cell + 3,
        72 + Math.min(actual, 1) * 13,
        `S${sprint.number}`,
        8,
      ),
    );
  }
  const used = page.rows.reduce((n, r) => n + r.height, 0);
  if (!page.rows.length)
    elements.push(
      text(
        12,
        HEADER + 30,
        page.view === "features"
          ? "No features in this app."
          : "No team members in this app.",
        13,
      ),
    );
  page.rows.forEach((row, rindex) => {
    const y = HEADER + row.top;
    const clip = `row-${index}-${rindex}`;
    elements.push(
      `<g data-row-id="${escapePrintText(row.id)}" ${row.personId ? `data-person-id="${escapePrintText(row.personId)}"` : ""}><title>${escapePrintText(row.title)}</title>`,
    );
    elements.push(rect(0, y, LABEL, row.height, "#fafafe"));
    const labelY = page.compact
      ? (row.height - row.labelLines.length * 12) / 2 + 10
      : 17;
    row.labelLines.forEach((line, i) =>
      elements.push(
        text(12, y + labelY + i * 12, line, 11, 'font-weight="bold"'),
      ),
    );
    const subLines = row.continued
      ? ["Continued", ...row.subLines]
      : row.subLines;
    subLines.forEach((sub, i) =>
      elements.push(
        text(
          12,
          y + row.labelLines.length * 12 + 18 + i * 11,
          sub,
          9,
          'fill="#56596a"',
        ),
      ),
    );
    for (const [d, date] of page.dates.entries()) {
      const kind = printDayKind(state, appId, row, date);
      elements.push(
        rect(
          LABEL + d * cell,
          y,
          cell,
          row.height,
          fills[kind],
          `data-day-kind="${kind}" data-date="${date}" stroke="#dcdfea" stroke-width="0.5"`,
        ),
      );
    }
    elements.push(
      `<defs><clipPath id="${clip}">${rect(LABEL, y, GRID, row.height, "white")}</clipPath></defs><g clip-path="url(#${clip})">`,
    );
    row.bars.forEach((bar, bindex) => {
      const { start, end, reason } = bar.forecast;
      const barTitle = bar.feature.blocked
        ? `Blocked · ${bar.title}`
        : bar.title;
      const top =
        y +
        (page.compact
          ? (row.height - 19) / 2
          : 9 + bar.lane * PRINT_LANE_HEIGHT);
      if (!start || !end) {
        elements.push(
          text(
            LABEL + 7,
            top + 13,
            `${barTitle}: ${reason ?? "Not scheduled"}`,
            10,
            `fill="${bar.feature.blocked ? FEATURE_BLOCKED_COLOR : "#8a4825"}"`,
          ),
        );
        return;
      }
      if (end < page.start || start > page.end) return;
      const x = LABEL + Math.max(0, offset(start)) * cell + 2;
      const width = Math.max(
        2,
        (Math.min(page.dates.length, offset(end) + 1) -
          Math.max(0, offset(start))) *
          cell -
          4,
      );
      const barclip = `bar-${index}-${rindex}-${bindex}`;
      elements.push(
        `<g data-feature-id="${escapePrintText(bar.feature.id)}"><title>${escapePrintText(`${barTitle}: ${start} - ${end}${reason ? ` (${reason})` : ""}`)}</title>`,
        rect(x, top, width, 19, bar.color, 'rx="3"'),
        `<defs><clipPath id="${barclip}">${rect(x + 3, top, Math.max(1, width - 6), 19, "white")}</clipPath></defs>`,
        text(
          x + 5,
          top + 13,
          barTitle,
          9,
          `fill="white" clip-path="url(#${barclip})"`,
        ),
        "</g>",
      );
    });
    elements.push(
      "</g>",
      `<path d="M0 ${y + row.height} H1000" stroke="#d8dbe5"/>`,
      "</g>",
    );
  });
  elements.push(`<path d="M${LABEL} 0 V${HEADER + used}" stroke="#d4d7e2"/>`);
  const legendY = HEADER + used + 24;
  for (const [i, [label, color]] of [
    ["Weekend", fills.weekend],
    ["Leave (full / partial)", fills.leave],
    ["Holiday", fills.holiday],
    ...(page.rows.some((row) => row.bars.some((bar) => bar.feature.blocked))
      ? [["Blocked", FEATURE_BLOCKED_COLOR]]
      : []),
  ].entries())
    elements.push(
      rect(
        12 + i * 190,
        legendY - 9,
        10,
        10,
        color,
        'stroke="#b6bac8" stroke-width="0.5"',
      ),
      text(28 + i * 190, legendY, label, 10),
    );
  elements.push(
    text(
      12,
      legendY + 19,
      page.view === "features"
        ? `Feature shading: time off affecting any assignee.${featuresOnly ? " Detailed calendars are available in Team & leave." : " Person calendars are detailed in By person."}`
        : "Each row uses that person's app weekends, personal leave and applicable holidays.",
      9,
      'fill="#56596a"',
    ),
  );
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 600" role="img" aria-label="${page.view === "features" ? "By feature" : "By person"} timeline" font-family="Arial, sans-serif" fill="#272b36">${elements.join("")}</svg>`;
}

export function timelinePrintDocument(
  state: PlannerState,
  appId: string,
  pages: TimelinePrintPage[],
  experiment = false,
): string {
  const app = state.apps.find((a) => a.id === appId)!;
  const safeName = escapePrintText((experiment ? "WHAT-IF · " : "") + app.name);
  const featuresOnly = pages.every((page) => page.view === "features");
  const compact = pages.every((page) => page.compact);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>${safeName} - Timeline</title><style>
  @page { size: A4 landscape; margin: 8mm; }
  * { box-sizing:border-box; }
  body { margin:0; color:#272b36; font-family:Arial,sans-serif; background:#edf0f5; }
  .print-actions { padding:16px; display:flex; flex-wrap:wrap; align-items:center; gap:12px; background:white; position:sticky;top:0;z-index:1;box-shadow:0 1px 5px #0002; }
  button { min-height:44px;padding:10px 16px;background:#7565db;color:white;border:0;border-radius:7px;font:inherit;cursor:pointer; }
  button:focus-visible { outline:3px solid #272b36;outline-offset:3px; }
  .print-actions p { margin:0;font-size:14px; }
  .print-page { width:281mm;height:193mm;padding:0;margin:16px auto;background:white;break-after:page;overflow:hidden; }
  .print-page:last-child { break-after:auto; }
  .print-page-header { height:26mm;display:flex;align-items:flex-start;justify-content:space-between;gap:15px;padding:3mm 0; }
  h1 { font-size:16px;line-height:1.15;margin:0 0 4px;max-width:185mm;overflow-wrap:anywhere; }
  .long-app-name {font-size:11px;}
  h2 { font-size:13px;margin:0;color:#7565db; }
  .print-page-header p { font-size:10px;margin:3px 0;text-align:right;white-space:nowrap; }
  svg { display:block;width:281mm;height:166mm; }
  @media print { body {background:white;} .print-actions {display:none;} .print-page { margin:0; } * {-webkit-print-color-adjust:exact;print-color-adjust:exact;} }
  </style></head><body><nav class="print-actions" aria-label="PDF export controls"><button id="print-pdf">Print / Save PDF</button><button id="close-preview">Close preview</button><p>Choose Save as PDF. Paper: A4, landscape. ${compact ? "Compact features only; titles without subtitles. Time off is shaded." : featuresOnly ? "Features only; time off is shaded." : "Both views are included; time off is shaded."}</p></nav><main>${pages.map((page, i) => `<section class="print-page" data-view="${page.view}" data-start="${page.start}" data-end="${page.end}"><header class="print-page-header"><div><h1 class="${app.name.length > 80 ? "long-app-name" : ""}">${safeName}</h1><h2>${page.compact ? "By feature · Compact" : page.view === "features" ? "By feature" : "By person"}</h2></div><div><p>${escapePrintText(format(parseISO(page.start), "MMM d, yyyy"))} - ${escapePrintText(format(parseISO(page.end), "MMM d, yyyy"))}</p><p>Page ${i + 1} of ${pages.length}</p></div></header>${chart(state, appId, page, i, featuresOnly)}</section>`).join("")}</main></body></html>`;
}
