import {
  confirmSchedulingReview,
  openFeatureSection,
} from "./helpers/ui-workflows";
import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { observeBrowser } from "../scripts/browser-observability";
import { readFile, writeFile } from "node:fs/promises";
import { emptyState, type PlannerState } from "../src/lib/model";
import {
  fixedToday,
  maintenanceFixture,
  populatedFixture,
  largeFixture,
} from "../scripts/maintenance-fixture";
const browserIssues = new WeakMap<Page, string[]>();

async function read(request: APIRequestContext): Promise<PlannerState> {
  return (await (await request.get("/api/state")).json()).state;
}
async function seed(request: APIRequestContext, state: PlannerState) {
  const { revision } = await (await request.get("/api/state")).json();
  const response = await request.put("/api/state", {
    data: { revision, state },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
}
async function nav(page: Page, name: string) {
  await page
    .getByRole("button", { name: new RegExp(`^${name.trim()}(?:\\s|$)`) })
    .click();
}
async function select(page: Page, label: string, option: string) {
  await page.getByRole("button", { name: new RegExp(label) }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
  await expect(page.getByRole("listbox")).toHaveCount(0);
}
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    ),
  ).toBeLessThanOrEqual(1);
}
async function accessibility(page: Page, label: string) {
  await expect(page.locator("[data-entering], [data-exiting]")).toHaveCount(0);
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const name = `axe-${label.replace(/[^a-z0-9]+/gi, "-")}`;
  const path = test.info().outputPath(`${name}.json`);
  await writeFile(path, JSON.stringify(result, null, 2));
  await test.info().attach(name, {
    path,
    contentType: "application/json",
  });
  expect(
    result.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      affectedNodes: v.nodes.length,
      firstTargets: v.nodes.slice(0, 3).map((n) => n.target),
    })),
    `${label}: full axe results attached`,
  ).toEqual([]);
}
test.beforeEach(async ({ page, request }) => {
  browserIssues.set(page, observeBrowser(page));
  await page.clock.install({ time: new Date(`${fixedToday}T10:00:00Z`) });
  await seed(request, populatedFixture());
});
test.afterEach(async ({ page }) => {
  const issues = browserIssues.get(page) ?? [];
  if (issues.length)
    await test.info().attach("browser-errors", {
      body: JSON.stringify(issues, null, 2),
      contentType: "application/json",
    });
  expect(issues, "Unexpected browser console, page or network errors").toEqual(
    [],
  );
});

test("@print edited draft renders printable plan content", async ({ page }) => {
  await page.goto("/");
  await nav(page, "Sprints & plans");
  await page.getByRole("tab", { name: "Sprint plan", exact: true }).click();
  await page.getByRole("button", { name: "Edit text", exact: true }).click();
  await page
    .getByLabel("Sprint plan Markdown", { exact: true })
    .fill("# Printable edited draft\nThis unsaved text must print.");
  await page.emulateMedia({ media: "print" });
  const printable = page.locator("article.plan-print");
  await expect(printable).toBeVisible();
  await expect(printable).toContainText("Printable edited draft");
  await expect(printable).toContainText("This unsaved text must print.");
  await expect(page.locator(".sidebar")).not.toBeVisible();
  await expect(page.locator(".topbar")).not.toBeVisible();
});

test("five sprint scope survives leave, competing work, refresh, resources and backup", async ({
  page,
  request,
}) => {
  await seed(request, maintenanceFixture());
  await page.goto("/");
  await nav(page, "Sprints & plans");
  await expect(page.locator(".sprint-feature-row")).toContainText(
    "Accepted delivery: Mar 15, 2030",
  );
  const alexResources = page
    .locator(".resource-table tbody tr")
    .filter({ hasText: "Alex" })
    .locator("td");
  await expect(alexResources).toHaveText([
    "Alex",
    "10 working days",
    "50 working days",
    "10 working days",
    "0 working days",
  ]);
  const originalText = (await read(request)).sprints[0];
  await nav(page, "Team & leave");
  await page.getByRole("button", { name: "Add leave", exact: true }).click();
  await page.getByLabel("Leave starts", { exact: true }).fill("2030-01-14");
  await page.getByLabel("Leave ends", { exact: true }).fill("2030-01-18");
  await page.getByLabel("Leave note", { exact: true }).fill("One week away");
  await page.getByRole("button", { name: "Save leave", exact: true }).click();
  await confirmSchedulingReview(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await nav(page, "Sprints & plans");
  await expect(page.locator(".sprint-feature-row")).toContainText(
    "7 calendar days later",
  );
  await expect(alexResources).toHaveText([
    "Alex",
    "5 working days",
    "50 working days",
    "5 working days",
    "0 working days",
  ]);
  await nav(page, "Timeline");
  await page.getByRole("button", { name: "Add feature", exact: true }).click();
  await page
    .getByLabel("Feature title", { exact: true })
    .fill("Urgent competing work");
  await page.getByLabel("Main assignee: Alex", { exact: true }).check();
  await select(page, "Estimate unit", "Working days");
  await page.getByLabel("Working days estimation", { exact: true }).fill("2");
  await page.getByRole("button", { name: "Save feature", exact: true }).click();
  await confirmSchedulingReview(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await nav(page, "Sprints & plans");
  await expect(page.locator(".sprint-feature-row")).toContainText(
    "11 calendar days later",
  );
  await expect(alexResources).toHaveText([
    "Alex",
    "5 working days",
    "50 working days",
    "3 working days",
    "0 working days",
  ]);
  await page
    .getByRole("button", {
      name: "Refresh sprint commitment dates",
      exact: true,
    })
    .click();
  await expect(page.locator(".notice")).toContainText(
    "Commitment dates refreshed",
  );
  const saved = await read(request);
  expect(saved.features.find((f) => f.id === "long")).toMatchObject({
    commitment: { end: "2030-03-29", acceptedAt: fixedToday },
    estimateEffort: [{ personId: "p", hours: 400 }],
  });
  expect(saved.sprints[0].snapshot).toBe(originalText.snapshot);
  expect(saved.sprints[0].draft).toBe(originalText.draft);
  await expect(page.locator(".sprint-card")).not.toContainText("At risk");
  await nav(page, "App settings");
  const downloadEvent = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export full backup", exact: true })
    .click();
  const backup = JSON.parse(
    await readFile((await (await downloadEvent).path())!, "utf8"),
  );
  expect(backup).toEqual(saved);
  await nav(page, "App settings");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByLabel("Restore backup", { exact: true }).setInputFiles({
    name: "maintenance.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(backup)),
  });
  await expect(page.locator(".notice")).toContainText("Backup restored");
  expect(await read(request)).toEqual(saved);
  await page.reload();
  expect(
    (await read(request)).features.find((f) => f.id === "long")?.commitment
      ?.end,
  ).toBe("2030-03-29");
});

for (const viewport of [
  { name: "tablet-portrait-744x1133", width: 744, height: 1133 },
  { name: "tablet-landscape-1133x744", width: 1133, height: 744 },
  { name: "desktop-1920x1080", width: 1920, height: 1080 },
  { name: "desktop-3840x2160", width: 3840, height: 2160 },
]) {
  test(`@visual ${viewport.name} populated views and editable dialogs`, async ({
    page,
  }) => {
    await page.clock.pauseAt(new Date(`${fixedToday}T12:00:00Z`));
    await page.setViewportSize({
      width: viewport.width,
      height: viewport.height,
    });
    await page.goto("/");
    await expect(page.locator(".timeline-grid")).toBeVisible();
    await noOverflow(page);
    await expect.soft(page).toHaveScreenshot(`${viewport.name}-timeline.png`, {
      fullPage: true,
    });
    await nav(page, "Team & leave");
    await expect(page.locator(".person-card")).toHaveCount(2);
    await noOverflow(page);
    await expect.soft(page).toHaveScreenshot(`${viewport.name}-team.png`, {
      fullPage: true,
    });
    await page
      .getByRole("button", {
        name: "Edit leave for Sam, 2030-01-09 to 2030-01-10",
        exact: true,
      })
      .click();
    await expect(page.getByLabel("Leave note", { exact: true })).toHaveValue(
      "Appointment",
    );
    await expect
      .soft(page.getByRole("dialog"))
      .toHaveScreenshot(`${viewport.name}-leave-dialog.png`);
    if (viewport.width <= 1133) {
      for (const name of ["Save leave", "Cancel"]) {
        const box = await page
          .getByRole("button", { name, exact: true })
          .boundingBox();
        expect(box?.height).toBeGreaterThanOrEqual(44);
        expect(box?.width).toBeGreaterThanOrEqual(44);
      }
    }
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await nav(page, "Features ");
    await page
      .getByRole("button", { name: "Edit Mixed person estimates", exact: true })
      .click();
    await expect(page.getByLabel("Sam estimate", { exact: true })).toHaveValue(
      "3",
    );
    await expect
      .soft(page.getByRole("dialog"))
      .toHaveScreenshot(`${viewport.name}-estimates-dialog.png`);
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await nav(page, "Sprints & plans");
    await noOverflow(page);
    await expect.soft(page).toHaveScreenshot(`${viewport.name}-sprints.png`, {
      fullPage: true,
    });
  });
}

test("@a11y populated views, empty and filled forms, and keyboard dialog focus", async ({
  page,
}) => {
  test.setTimeout(240000);
  await page.goto("/");
  for (const view of [
    "Timeline",
    "Features ",
    "Team & leave",
    "Sprints & plans",
    "App settings",
    "All apps overview",
  ]) {
    await nav(page, view);
    await accessibility(page, view);
  }
  await nav(page, "Timeline");
  await page.getByRole("button", { name: "Add feature", exact: true }).click();
  await accessibility(page, "empty feature form");
  await page
    .getByLabel("Feature title", { exact: true })
    .fill("Keyboard delivery");
  await page.getByLabel("Main assignee: Alex", { exact: true }).check();
  await accessibility(page, "filled feature form");
  await page.getByLabel("Feature title", { exact: true }).focus();
  await page.keyboard.press("Tab");
  expect(
    await page
      .getByRole("dialog")
      .evaluate((dialog) => dialog.contains(document.activeElement)),
  ).toBeTruthy();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Add feature", exact: true }),
  ).toBeFocused();
  await nav(page, "Team & leave");
  await page.getByRole("button", { name: "Add leave", exact: true }).click();
  await accessibility(page, "new leave form");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page
    .getByRole("button", {
      name: "Edit leave for Sam, 2030-01-09 to 2030-01-10",
      exact: true,
    })
    .click();
  await accessibility(page, "existing leave form");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page
    .getByRole("button", { name: "New calendar template", exact: true })
    .click();
  await accessibility(page, "empty calendar template form");
  await page
    .getByLabel("Template name", { exact: true })
    .fill("Accessible calendar");
  await page
    .getByLabel("Entry 1 name", { exact: true })
    .fill("Accessible holiday");
  await accessibility(page, "filled calendar template form");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page
    .getByRole("button", { name: "Apply Winter calendar", exact: true })
    .click();
  await accessibility(page, "apply calendar dialog");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Add person", exact: true }).click();
  await accessibility(page, "empty member editor");
  await page.getByLabel("Name", { exact: true }).fill("Accessible planner");
  await page.getByLabel("Role / scope", { exact: true }).fill("Backend");
  await page.getByLabel("Override app weekends", { exact: true }).check();
  await accessibility(page, "filled member editor with weekend override");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Add holiday", exact: true }).click();
  await accessibility(page, "empty whole app holiday editor");
  await page
    .getByLabel("Holiday name", { exact: true })
    .fill("Accessible holiday");
  await page.getByLabel("Whole app holiday", { exact: true }).uncheck();
  await accessibility(page, "filled selected person holiday editor");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await nav(page, "Features");
  await page
    .getByRole("button", { name: "Edit Mixed person estimates", exact: true })
    .click();
  await accessibility(page, "per person mixed estimate editor");
  await openFeatureSection(page, "Scheduling options");
  await expect(page.getByLabel("Feature status", { exact: true })).toHaveCount(
    0,
  );
  await expect(
    page.getByLabel("Expected unblock date", { exact: true }),
  ).toHaveCount(0);
  await accessibility(
    page,
    "automatic feature status and scheduling constraints",
  );
  await openFeatureSection(page, "Optional tasks");
  await page.getByLabel("Add optional task breakdown", { exact: true }).check();
  await page
    .getByLabel("Task 1 title", { exact: true })
    .fill("Accessible task");
  await page
    .getByRole("checkbox", { name: /^Five sprint delivery · feature delivery/ })
    .check();
  await expect(page.getByLabel("Task 1 status", { exact: true })).toHaveCount(
    0,
  );
  await expect(
    page.getByLabel("Task 1 actual start", { exact: true }),
  ).toHaveCount(0);
  await accessibility(
    page,
    "automatic task status and feature delivery dependency",
  );
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await nav(page, "Sprints & plans");
  await page.getByRole("button", { name: "New sprint", exact: true }).click();
  await accessibility(page, "new sprint editor");
  await page
    .getByLabel("Planning notes", { exact: true })
    .fill("Accessible sprint context");
  await accessibility(page, "filled sprint editor");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("tab", { name: "Sprint plan", exact: true }).click();
  await accessibility(page, "saved draft preview");
  await page.getByRole("button", { name: "Saved plan", exact: true }).click();
  await accessibility(page, "finalized snapshot preview");
  await page.getByRole("button", { name: "Edit text", exact: true }).click();
  await accessibility(page, "plan Markdown editing form");
  await page.getByRole("button", { name: /Current app/ }).click();
  await accessibility(page, "app selector option list");
  await page
    .getByRole("option", { name: "Maintenance Studio", exact: true })
    .click();
});

test("@a11y empty workspace and empty planning views", async ({
  page,
  request,
}) => {
  test.setTimeout(180000);
  await seed(request, emptyState);
  await page.goto("/");
  await expect(page.getByLabel("App name", { exact: true })).toBeVisible();
  await accessibility(page, "empty setup wizard");
  await page
    .getByLabel("App name", { exact: true })
    .fill("Accessible wizard app");
  await accessibility(page, "filled setup app step");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Add person", exact: true }).click();
  await accessibility(page, "empty wizard person row");
  await page
    .getByLabel("Person 1 name", { exact: true })
    .fill("Wizard planner");
  await page.getByLabel("Person 1 role", { exact: true }).fill("Design");
  await page
    .getByLabel("Override app weekends for this person", { exact: true })
    .check();
  await accessibility(page, "filled wizard person and weekend controls");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await accessibility(page, "wizard app calendar step");
  await page.getByLabel("Plan in sprints", { exact: true }).check();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: /Default sprint length/ }).click();
  await accessibility(page, "wizard cadence option list");
  await page
    .getByRole("option", { name: "Custom duration", exact: true })
    .click();
  await page.getByLabel("Calendar days per sprint", { exact: true }).fill("14");
  await accessibility(page, "wizard custom duration step");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await accessibility(page, "wizard final review step");
  const state = maintenanceFixture();
  state.features = [];
  state.sprints = [];
  state.calendarTemplates = [];
  await seed(request, state);
  await page.reload();
  for (const view of [
    "Timeline",
    "Features ",
    "Team & leave",
    "Sprints & plans",
  ]) {
    await nav(page, view);
    await accessibility(page, `empty ${view}`);
  }
});

test("100 features, 15 people and six month timeline keep controls usable and scrolling contained", async ({
  page,
  request,
}) => {
  test.setTimeout(60000);
  await seed(request, largeFixture());
  await page.setViewportSize({ width: 744, height: 1133 });
  await page.goto("/");
  await expect(
    page.locator('.timeline-row-label[draggable="true"]'),
  ).toHaveCount(100);
  await select(page, "Timeline range", "6 months");
  await noOverflow(page);
  await page.locator(".timeline-scroll").evaluate((el) => {
    el.scrollLeft = el.scrollWidth;
    el.scrollTop = el.scrollHeight;
  });
  expect(
    await page.locator(".timeline-scroll").evaluate((el) => el.scrollLeft),
  ).toBeGreaterThan(0);
  await page.getByRole("button", { name: "By person", exact: true }).click();
  await expect(page.locator(".timeline-track[data-person-id]")).toHaveCount(15);
  await expect(
    page.locator(".timeline-track[data-person-id] .timeline-bar"),
  ).toHaveCount(100);
  expect(
    await page
      .locator(".timeline-track[data-person-id]")
      .evaluateAll(
        (tracks) =>
          new Set(tracks.map((track) => track.getAttribute("data-person-id")))
            .size,
      ),
  ).toBe(15);
  await noOverflow(page);
  await nav(page, "Team & leave");
  await page.getByLabel("Search team", { exact: true }).fill("Planner 15");
  await expect(page.locator(".person-card")).toHaveCount(1);
  await page
    .getByRole("button", { name: "Clear team search", exact: true })
    .click();
  await expect(page.locator(".person-card")).toHaveCount(15);
  await nav(page, "Features ");
  await expect(page.locator(".feature-item")).toHaveCount(100);
  await page
    .getByRole("button", { name: "Edit Delivery 100", exact: true })
    .click();
  await expect(page.getByLabel("Feature title", { exact: true })).toHaveValue(
    "Delivery 100",
  );
  await noOverflow(page);
});

test("@a11y invalid estimate keeps its guidance and assignee controls stable on blur", async ({
  page,
}) => {
  await page.goto("/");
  await nav(page, "Features");
  await page.getByRole("button", { name: "Add feature", exact: true }).click();
  await page
    .getByLabel("Feature title", { exact: true })
    .fill("Validation interaction");
  await page.getByLabel("Sprint estimation", { exact: true }).fill("0.25");
  const guidance = page.locator(".estimate-panel .field .description");
  await expect(guidance).toBeVisible();
  const assignee = page.getByLabel("Main assignee: Sam", { exact: true });
  await assignee.focus();
  await expect(
    page.getByLabel("Sprint estimation", { exact: true }),
  ).toHaveAttribute("aria-invalid", "true");
  await expect(guidance).toBeVisible();
  await assignee.check();
  await expect(assignee).toBeChecked();
  await page.getByRole("button", { name: "Save feature", exact: true }).click();
  await confirmSchedulingReview(page);
  await expect(page.locator(".dialog .form-error")).toBeVisible();
  await accessibility(page, "invalid estimate form");
  await page.getByLabel("Sprint estimation", { exact: true }).fill("0.5");
  await page.getByRole("button", { name: "Save feature", exact: true }).click();
  await confirmSchedulingReview(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.locator(".feature-item").filter({ hasText: "Validation interaction" }),
  ).toBeVisible();
});
