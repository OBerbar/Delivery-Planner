import { describe, expect, it } from "vitest";
import {
  timelinePrintPages,
  printDayKind,
} from "../src/lib/timeline-print-layout";
import { timelinePrintDocument } from "../src/lib/timeline-print-document";
import {
  populatedFixture,
  largeFixture,
  fixedToday,
} from "../scripts/maintenance-fixture";
import { schedule, plus } from "../src/lib/planning";

describe("timeline PDF layout", () => {
  it("compacts feature rows to titles only without changing bars, calendars or the standard export", () => {
    const state = populatedFixture();
    state.features[0].blocked = true;
    state.features[1].doesntAffectOtherWork = true;
    const before = structuredClone(state);
    const forecast = schedule(state, fixedToday);
    const standard = timelinePrintPages(
      state,
      "a",
      forecast,
      fixedToday,
      "2030-03-05",
      "features",
    );
    const compact = timelinePrintPages(
      state,
      "a",
      forecast,
      fixedToday,
      "2030-03-05",
      "compact-features",
    );
    expect(compact).toHaveLength(1);
    expect(compact[0].view).toBe("features");
    expect(compact[0].compact).toBe(true);
    compact[0].rows.forEach((row, i) => {
      expect(row.subLines).toEqual([]);
      expect(row.labelLines).toEqual(standard[0].rows[i].labelLines);
      expect(row.height).toBeLessThan(standard[0].rows[i].height);
      expect(row.bars).toEqual(standard[0].rows[i].bars);
      expect(printDayKind(state, "a", row, "2030-01-09")).toBe(
        printDayKind(state, "a", standard[0].rows[i], "2030-01-09"),
      );
    });
    expect(standard[0].rows.every((row) => row.subLines.length > 0)).toBe(true);
    const html = timelinePrintDocument(state, "a", compact, true);
    expect(html).toContain("By feature · Compact");
    expect(html).toContain("WHAT-IF");
    expect(html).toContain("Blocked");
    expect(html).not.toContain("By person");
    expect(state).toEqual(before);
  });

  it("fits more compact features on each page while preserving all titles in every date section", () => {
    const state = largeFixture();
    state.features.forEach((feature, i) => {
      feature.title = `Feature ${i}`;
    });
    const forecast = schedule(state, fixedToday);
    const standard = timelinePrintPages(
      state,
      "a",
      forecast,
      fixedToday,
      "2030-07-05",
      "features",
    );
    const compact = timelinePrintPages(
      state,
      "a",
      forecast,
      fixedToday,
      "2030-07-05",
      "compact-features",
    );
    expect(compact.length).toBeLessThan(standard.length);
    for (const start of new Set(compact.map((page) => page.start))) {
      const rows = compact
        .filter((page) => page.start === start)
        .flatMap((page) => page.rows);
      expect(rows.map((row) => row.id)).toEqual(
        state.features.map((feature) => feature.id),
      );
      expect(
        rows.every((row) => row.height === 28 && row.subLines.length === 0),
      ).toBe(true);
    }
    state.features[0].title = "W".repeat(250);
    const long = timelinePrintPages(
      state,
      "a",
      forecast,
      fixedToday,
      "2030-03-05",
      "compact-features",
    )[0].rows[0];
    expect(long.labelLines.join("")).toBe("W".repeat(250));
    expect(long.height).toBeGreaterThanOrEqual(
      long.labelLines.length * 12 + 10,
    );
    state.features = [];
    const empty = timelinePrintPages(
      state,
      "a",
      schedule(state, fixedToday),
      fixedToday,
      "2030-03-05",
      "compact-features",
    );
    expect(empty).toHaveLength(1);
    expect(empty[0].compact).toBe(true);
    expect(timelinePrintDocument(state, "a", empty)).toContain(
      "No features in this app.",
    );
  });

  it("exports only features across the full date window, preserving forecasts, blocked work and saved data", () => {
    const state = populatedFixture();
    state.features[0].blocked = true;
    const before = structuredClone(state);
    const forecast = schedule(state, fixedToday);
    const pages = timelinePrintPages(
      state,
      "a",
      forecast,
      fixedToday,
      "2030-07-05",
      "features",
    );
    expect(pages).toHaveLength(3);
    expect(pages.every((page) => page.view === "features")).toBe(true);
    expect(pages[0].start).toBe(fixedToday);
    expect(pages.at(-1)?.end).toBe("2030-07-05");
    for (const page of pages) {
      expect(page.rows.map((row) => row.id)).toEqual(["long", "mixed"]);
      expect(page.rows.every((row) => !row.personId)).toBe(true);
      expect(page.rows[0].bars[0].forecast.end).toBe(
        forecast.features.long.end,
      );
    }
    const html = timelinePrintDocument(state, "a", pages, true);
    expect(html).toContain("WHAT-IF");
    expect(html).toContain("Blocked");
    expect(html).toMatch(/>Feature<\/text>/);
    expect(html).toContain("Features only; time off is shaded.");
    expect(html).not.toMatch(/By person|PERSON \/ ASSIGNED|data-person-id/);
    expect(state).toEqual(before);
  });

  it("keeps an empty feature-only export to one labeled page", () => {
    const state = populatedFixture();
    state.features = [];
    const pages = timelinePrintPages(
      state,
      "a",
      schedule(state, fixedToday),
      fixedToday,
      "2030-03-05",
      "features",
    );
    expect(pages.map((page) => page.view)).toEqual(["features"]);
    const html = timelinePrintDocument(state, "a", pages);
    expect(html).toContain("No features in this app.");
    expect(html).not.toContain("By person");
  });

  it("includes both groupings, current forecasts and each app member once without changing saved data", () => {
    const state = populatedFixture();
    const before = structuredClone(state);
    const forecast = schedule(state, fixedToday);
    const pages = timelinePrintPages(
      state,
      "a",
      forecast,
      fixedToday,
      "2030-03-05",
    );
    expect(pages.map((p) => p.view)).toEqual(["features", "people"]);
    expect(pages[0].rows.map((r) => r.id)).toEqual(["long", "mixed"]);
    expect(pages[1].rows.map((r) => r.personId)).toEqual(["p", "q"]);
    expect(pages[1].rows[0].bars.map((b) => b.feature.id)).toEqual([
      "long",
      "mixed",
    ]);
    expect(pages[0].rows[0].bars[0].forecast.end).toBe(
      forecast.features.long.end,
    );
    expect(state).toEqual(before);
  });

  it("tiles the full six-month range without gaps or duplicated dates, including a clamped month start", () => {
    const state = populatedFixture();
    const pages = timelinePrintPages(
      state,
      "a",
      schedule(state, fixedToday),
      "2030-01-31",
      "2030-07-30",
    );
    for (const view of ["features", "people"]) {
      const windows = pages.filter((p) => p.view === view);
      expect(windows).toHaveLength(3);
      expect(windows[0].start).toBe("2030-01-31");
      expect(windows.at(-1)?.end).toBe("2030-07-30");
      for (let i = 1; i < windows.length; i++)
        expect(windows[i].start).toBe(plus(windows[i - 1].end, 1));
      expect(windows.every((p) => p.dates.length <= 62)).toBe(true);
    }
  });

  it("shades personal leave, selected holidays and member weekends without inventing absence rows", () => {
    const state = populatedFixture();
    state.members[0].weekends = [5];
    const pages = timelinePrintPages(
      state,
      "a",
      schedule(state, fixedToday),
      fixedToday,
      "2030-03-05",
    );
    const people = pages.find((p) => p.view === "people")!.rows;
    const alex = people.find((r) => r.personId === "p")!,
      sam = people.find((r) => r.personId === "q")!;
    expect(printDayKind(state, "a", sam, "2030-01-09")).toBe("leave");
    expect(printDayKind(state, "a", alex, "2030-01-09")).toBe("working");
    expect(printDayKind(state, "a", sam, "2030-01-14")).toBe("holiday");
    expect(printDayKind(state, "a", alex, "2030-01-14")).toBe("working");
    expect(printDayKind(state, "a", alex, "2030-01-11")).toBe("weekend");
    expect(printDayKind(state, "a", sam, "2030-01-11")).toBe("working");
    const mixed = pages[0].rows.find((r) => r.id === "mixed")!;
    expect(printDayKind(state, "a", mixed, "2030-01-09")).toBe("leave");
    expect(people).toHaveLength(state.members.length);
  });

  it("paginates larger data while preserving every feature and person bar in each date section", () => {
    const state = largeFixture();
    const pages = timelinePrintPages(
      state,
      "a",
      schedule(state, fixedToday),
      fixedToday,
      "2030-07-05",
    );
    for (const start of new Set(pages.map((p) => p.start))) {
      const featureRows = pages
        .filter((p) => p.start === start && p.view === "features")
        .flatMap((p) => p.rows);
      expect(featureRows.map((r) => r.id)).toHaveLength(100);
      expect(new Set(featureRows.map((r) => r.id)).size).toBe(100);
      const personRows = pages
        .filter((p) => p.start === start && p.view === "people")
        .flatMap((p) => p.rows);
      expect(new Set(personRows.map((r) => r.personId)).size).toBe(15);
      expect(personRows.flatMap((r) => r.bars)).toHaveLength(100);
    }
    expect(
      pages.every((p) => p.rows.reduce((sum, r) => sum + r.height, 0) <= 440),
    ).toBe(true);
  });

  it("continues a person with many overlapping bars across pages without dropping or duplicating bars", () => {
    const state = populatedFixture();
    state.people[0].name = "W".repeat(250);
    state.features = Array.from({ length: 35 }, (_, i) => ({
      ...state.features[0],
      id: `overlap-${i}`,
      priority: i,
    }));
    const forecast = schedule(state, fixedToday);
    for (const value of Object.values(forecast.tasks)) {
      value.start = "2030-01-07";
      value.end = "2030-02-01";
    }
    const rows = timelinePrintPages(
      state,
      "a",
      forecast,
      fixedToday,
      "2030-03-05",
    )
      .filter((p) => p.view === "people")
      .flatMap((p) => p.rows)
      .filter((r) => r.personId === "p");
    expect(rows.length).toBeGreaterThan(1);
    expect(rows.slice(1).every((r) => r.continued)).toBe(true);
    for (const row of rows) {
      expect(row.height).toBeGreaterThanOrEqual(
        row.labelLines.length * 12 +
          row.subLines.length * 11 +
          12 +
          (row.continued ? 11 : 0),
      );
    }
    expect(rows.flatMap((r) => r.bars)).toHaveLength(35);
    expect(
      new Set(rows.flatMap((r) => r.bars.map((b) => b.feature.id))).size,
    ).toBe(35);
  });

  it("retains empty and unscheduled work and escapes user content without scripts or remote resources", () => {
    const state = populatedFixture();
    state.apps[0].name = '<script>alert("x")</script>';
    state.features[0].title =
      "Long " +
      "word ".repeat(90) +
      '<img src="https://example.com/x" onerror="alert(1)">';
    const forecast = schedule(state, fixedToday);
    delete forecast.features.long.end;
    forecast.features.long.warning = "Blocked until reviewed";
    const pages = timelinePrintPages(
      state,
      "a",
      forecast,
      fixedToday,
      "2030-03-05",
    );
    const html = timelinePrintDocument(state, "a", pages);
    expect(html).toContain("Blocked until reviewed");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toMatch(/<script|<img|<iframe/i);
    expect(html).toContain("A4 landscape");
    state.features = [];
    expect(
      timelinePrintPages(
        state,
        "a",
        schedule(state, fixedToday),
        fixedToday,
        "2030-03-05",
      ).map((p) => p.view),
    ).toEqual(["features", "people"]);
  });
});
