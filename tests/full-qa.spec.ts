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
import {
  emptyState,
  stateSchema,
  today,
  type PlannerState,
} from "../src/lib/model";
import { plus, sprintEnd, schedule } from "../src/lib/planning";

const start = "2030-01-06";
function fixture(): PlannerState {
  return stateSchema.parse({
    ...emptyState,
    apps: [
      {
        id: "a",
        name: "QA App",
        color: "#7565db",
        weekends: [5, 6],
        planningStart: start,
        cadence: "2w",
        customDays: 14,
        terms: "QA general terms",
        archived: false,
      },
    ],
    people: [
      { id: "p", name: "Alex", dailyHours: 8 },
      { id: "q", name: "Sam", dailyHours: 6 },
    ],
    members: [
      {
        id: "m",
        appId: "a",
        personId: "p",
        role: "Backend",
        allocation: 100,
        weekends: null,
      },
      {
        id: "n",
        appId: "a",
        personId: "q",
        role: "Designer",
        allocation: 50,
        weekends: [0, 6],
      },
    ],
    features: [
      {
        id: "f",
        appId: "a",
        title: "First feature",
        description: "QA delivery",
        completion: "",
        priority: 0,
        tasks: [
          {
            id: "t",
            title: "API",
            personId: "p",
            scope: "Backend",
            hours: 24,
            status: "todo",
            dependsOn: [],
          },
        ],
        sprintId: "s",
        committed: false,
        link: "",
      },
    ],
    sprints: [
      {
        id: "s",
        appId: "a",
        number: 1,
        start,
        end: plus(start, 13),
        goal: "Deliver the first feature",
        notes: "Planning note",
        snapshot: null,
      },
    ],
  });
}
async function read(request: APIRequestContext) {
  return (await (await request.get("/api/state")).json()).state as PlannerState;
}
async function seed(request: APIRequestContext, state: PlannerState) {
  const { revision } = await (await request.get("/api/state")).json();
  expect(
    (await request.put("/api/state", { data: { revision, state } })).ok(),
  ).toBeTruthy();
}
async function nav(page: Page, name: string) {
  await page
    .locator(".sidebar nav")
    .getByRole("button", { name: new RegExp("^" + name) })
    .click();
}
async function select(page: Page, label: string, option: string) {
  await page.getByRole("button", { name: new RegExp(label) }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}
async function saved(page: Page) {
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".notice")).toContainText("Saved");
}
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - innerWidth,
    ),
  ).toBeLessThanOrEqual(1);
}
async function timelineTouchTargets(page: Page) {
  for (const button of await page.locator(".timeline-toolbar button").all()) {
    const box = (await button.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.width).toBeGreaterThanOrEqual(44);
  }
}
const browserErrors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date(`${start}T10:00:00Z`) });
  const errors: string[] = [];
  browserErrors.set(page, errors);
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("requestfailed", (r) =>
    errors.push(`${r.method()} ${r.url()}: ${r.failure()?.errorText}`),
  );
});
test.afterEach(async ({ page }, info) => {
  const errors = browserErrors.get(page) ?? [];
  const unexpected = info.title.includes("failed save")
    ? errors.filter((e) => !e.includes("500 (Internal Server Error)"))
    : errors;
  expect(unexpected, "Unexpected browser or network errors").toEqual([]);
});
test.beforeEach(async ({ request }) => {
  await seed(request, fixture());
});

test("wizard preset plus two custom people persist, search and appear as main assignees", async ({
  page,
  request,
}) => {
  await seed(request, emptyState);
  await page.goto("/");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.locator(".form-error")).toContainText(
    "Give your app a name",
  );
  await page.getByLabel("App name", { exact: true }).fill("Wizard team");
  await page.getByRole("button", { name: "Use example team" }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  for (const [i, name, role] of [
    [7, "Riley Chen", "Frontend"],
    [8, "Morgan Vale", "Backend"],
  ] as const) {
    await page.getByRole("button", { name: "Add person", exact: true }).click();
    await page.getByLabel(`Person ${i} name`, { exact: true }).fill(name);
    await page.getByLabel(`Person ${i} role`, { exact: true }).fill(role);
  }
  await page
    .getByLabel("Override app weekends for this person", { exact: true })
    .nth(7)
    .check();
  await page
    .locator(".team-input-card")
    .nth(7)
    .getByRole("button", { name: "Sun weekend", exact: true })
    .click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByLabel("Person 8 name", { exact: true })).toHaveValue(
    "Morgan Vale",
  );
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByLabel("Plan in sprints", { exact: true }).check();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await select(page, "Default sprint length", "3 weeks");
  await page.getByLabel("First sprint number", { exact: true }).fill("42");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.locator(".wizard-content")).toContainText("Morgan Vale");
  await page
    .getByRole("button", { name: "Open my planner", exact: true })
    .click();
  await confirmSchedulingReview(page);
  await nav(page, "Team & leave");
  await expect(page.locator(".person-card")).toHaveCount(8);
  await expect(page.locator(".team-roster-count")).toHaveText("8 team members");
  await page.getByLabel("Search team", { exact: true }).fill("riley");
  await expect(page.locator(".person-card h3")).toHaveText(["Riley Chen"]);
  await page.getByLabel("Search team", { exact: true }).fill("Backend");
  await expect(page.locator(".team-grid")).toContainText("Morgan Vale");
  await page
    .getByLabel("Search team", { exact: true })
    .fill("no matching person");
  await expect(
    page.getByText("No team members match your search."),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Clear team search", exact: true })
    .click();
  await expect(page.locator(".person-card")).toHaveCount(8);
  await page.reload();
  await nav(page, "Team & leave");
  await expect(page.locator(".person-card")).toHaveCount(8);
  await nav(page, "Features");
  await page.getByRole("button", { name: "Add feature", exact: true }).click();
  await expect(page.locator(".assignee-choices input")).toHaveCount(8);
  const state = await read(request);
  expect(state.people).toHaveLength(8);
  expect(state.members).toHaveLength(8);
  expect(state.members[7].weekends).toContain(0);
  // Friday/Saturday are shared weekends, so a three-week span ends Thursday.
  expect(state.sprints[0]).toMatchObject({
    number: 42,
    start,
    end: "2030-01-24",
  });
});

for (const [width, height] of [
  [744, 1133],
  [1133, 744],
  [768, 1024],
  [1024, 768],
  [1366, 1024],
  [1440, 900],
  [1920, 1080],
  [2560, 1440],
  [3840, 2160],
  [390, 844],
]) {
  test(`all pages and feature editor fit ${width}x${height} using the available width`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await page.goto("/");
    for (const name of [
      "Timeline",
      "Features",
      "Team & leave",
      "Sprints & plans",
      "App settings",
    ]) {
      await nav(page, name);
      await noOverflow(page);
      const content = await page.locator(".page-content").boundingBox();
      const main = await page.locator(".main-area").boundingBox();
      expect(content!.width).toBeCloseTo(main!.width, 0);
      expect(
        Math.abs(content!.x + content!.width / 2 - main!.x - main!.width / 2),
      ).toBeLessThan(2);
    }
    for (const selector of [".app-footer"]) {
      const frame = (await page.locator(selector).boundingBox())!;
      const main = (await page.locator(".main-area").boundingBox())!;
      expect(frame.width).toBeCloseTo(main.width, 0);
      expect(
        Math.abs(frame.x + frame.width / 2 - main.x - main.width / 2),
      ).toBeLessThan(2);
    }
    await page
      .getByRole("button", { name: "All apps overview", exact: true })
      .click();
    await noOverflow(page);
    await nav(page, "Features");
    await page
      .getByRole("button", { name: "Add feature", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Add a feature",
      exact: true,
    });
    await expect(dialog).toBeVisible();
    await noOverflow(page);
    const box = await dialog.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dialog).toHaveCount(0);
  });
}

test("team validates, adds, edits and removes people, and protects assigned members", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await nav(page, "Team & leave");
  await page.getByRole("button", { name: "Add person", exact: true }).click();
  await page.getByRole("button", { name: "Save person", exact: true }).click();
  await confirmSchedulingReview(page);
  await expect(page.locator(".dialog .form-error")).toContainText("required");
  await page.getByLabel("Name", { exact: true }).fill("New teammate");
  await page.getByLabel("Role / scope", { exact: true }).fill("QA");
  await page.getByLabel("Hours per day", { exact: true }).fill("6");
  await page
    .getByLabel("Allocation to this app (%)", { exact: true })
    .fill("75");
  await page.getByLabel("Override app weekends", { exact: true }).check();
  await page.getByRole("button", { name: "Sun weekend", exact: true }).click();
  await page.getByRole("button", { name: "Save person", exact: true }).click();
  await confirmSchedulingReview(page);
  await saved(page);
  await expect(page.locator(".person-card")).toHaveCount(3);
  await page
    .getByRole("button", { name: "Edit New teammate", exact: true })
    .click();
  await page.getByLabel("Name", { exact: true }).fill("Updated teammate");
  await page.getByRole("button", { name: "Save person", exact: true }).click();
  await confirmSchedulingReview(page);
  await saved(page);
  await page
    .getByRole("button", { name: "Edit Updated teammate", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Remove from app", exact: true })
    .click();
  await confirmSchedulingReview(page);
  await saved(page);
  await expect(page.locator(".person-card")).toHaveCount(2);
  await page.getByRole("button", { name: "Edit Alex", exact: true }).click();
  await page
    .getByRole("button", { name: "Remove from app", exact: true })
    .click();
  await confirmSchedulingReview(page);
  await expect(page.locator(".dialog .form-error")).toContainText("Reassign");
  expect((await read(request)).members).toHaveLength(2);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("full and partial leave and holidays validate and change delivery", async ({
  page,
  request,
}) => {
  const state = fixture();
  state.features[0].tasks[0].hours = 80;
  await seed(request, state);
  const baseline = schedule(state, start).features.f.end;
  await page.goto("/");
  await nav(page, "Team & leave");
  await page.getByRole("button", { name: "Add leave", exact: true }).click();
  await page.getByLabel("Leave starts", { exact: true }).fill(start);
  await page.getByLabel("Leave ends", { exact: true }).fill(plus(start, -1));
  await page.getByRole("button", { name: "Save leave", exact: true }).click();
  await confirmSchedulingReview(page);
  await expect(page.locator(".dialog .form-error")).toContainText("Leave end");
  await page.getByLabel("Leave ends", { exact: true }).fill(plus(start, 4));
  await page.getByLabel("Leave note", { exact: true }).fill("Vacation");
  await page.getByRole("button", { name: "Save leave", exact: true }).click();
  await confirmSchedulingReview(page);
  await saved(page);
  expect(
    schedule(await read(request), start).features.f.end! > baseline!,
  ).toBeTruthy();
  await expect(
    page.getByText("Full day · Vacation", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Add leave", exact: true }).click();
  await select(page, "Person taking leave", "Sam");
  await page.getByLabel("Full-day leave", { exact: true }).uncheck();
  await page
    .getByLabel("Days off per day", { exact: true })
    .fill("0.3333333333333333");
  await page.getByRole("button", { name: "Save leave", exact: true }).click();
  await confirmSchedulingReview(page);
  await saved(page);
  expect(
    (await read(request)).leaves.find((l) => l.personId === "q")!.hours,
  ).toBe(2);
  await page.getByRole("button", { name: "Add holiday", exact: true }).click();
  await page.getByRole("button", { name: "Save holiday", exact: true }).click();
  await confirmSchedulingReview(page);
  await expect(page.locator(".dialog .form-error")).toContainText("required");
  await page.getByLabel("Holiday name", { exact: true }).fill("Office holiday");
  await page.getByLabel("Holiday date", { exact: true }).fill(plus(start, 5));
  await page.getByRole("button", { name: "Save holiday", exact: true }).click();
  await confirmSchedulingReview(page);
  await saved(page);
  await expect(page.getByText("Office holiday", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Remove holiday Office holiday", exact: true })
    .click();
  await confirmSchedulingReview(page);
  await expect(page.getByText("Office holiday", { exact: true })).toHaveCount(
    0,
  );
  for (const l of (await read(request)).leaves) {
    await page
      .getByRole("button", { name: `Remove leave ${l.id}`, exact: true })
      .click();
    await confirmSchedulingReview(page);
    await expect
      .poll(async () => (await read(request)).leaves.some((v) => v.id === l.id))
      .toBe(false);
  }
  expect(schedule(await read(request), start).features.f.end).toBe(baseline);
});

for (const [cadence, label, days] of [
  ["2w", "2 weeks", 14],
  ["3w", "3 weeks", 21],
  ["month", "1 calendar month", 14],
  ["custom", "Custom duration", 10],
] as const) {
  test(`cadence ${cadence} applies to new sprints and individual overrides persist`, async ({
    page,
    request,
  }) => {
    await page.goto("/");
    await nav(page, "App settings");
    await select(page, "Default sprint length", label);
    if (cadence === "custom")
      await page
        .getByLabel("Calendar days per sprint", { exact: true })
        .fill(String(days));
    await page
      .getByRole("button", { name: "Save settings", exact: true })
      .click();
    await confirmSchedulingReview(page);
    await expect(page.locator(".saved-note")).toBeVisible();
    await nav(page, "Sprints & plans");
    await page.getByRole("button", { name: "New sprint", exact: true }).click();
    // These two member calendars share Saturday only.
    const from = plus(
      start,
      new Date(plus(start, 14)).getUTCDay() === 6 ? 15 : 14,
    );
    let to = sprintEnd(from, cadence, days);
    if (new Date(to).getUTCDay() === 6) to = plus(to, -1);
    await expect(page.getByLabel("Sprint starts", { exact: true })).toHaveValue(
      from,
    );
    await expect(page.getByLabel("Sprint ends", { exact: true })).toHaveValue(
      to,
    );
    await page.getByLabel("Sprint ends", { exact: true }).fill(plus(start, 19));
    await expect(page.getByLabel("Sprint goal", { exact: true })).toHaveCount(
      0,
    );
    await page
      .getByLabel("Planning notes", { exact: true })
      .fill("Short sprint");
    await page
      .getByRole("button", { name: "Save sprint", exact: true })
      .click();
    await confirmSchedulingReview(page);
    await saved(page);
    expect((await read(request)).sprints[1]).toMatchObject({
      start: from,
      end: plus(start, 19),
      notes: "Short sprint",
    });
    await page.reload();
    await nav(page, "Sprints & plans");
    await page.locator(".sprint-card").nth(1).click();
    await expect(page.locator(".goal-text")).toHaveText(
      "No features scheduled in this sprint.",
    );
  });
}

test("sprint overlap and reversed dates are rejected, edit and delete return scope to backlog", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await nav(page, "Sprints & plans");
  await page.getByRole("button", { name: "New sprint", exact: true }).click();
  await page.getByLabel("Sprint starts", { exact: true }).fill(start);
  await page.getByRole("button", { name: "Save sprint", exact: true }).click();
  await confirmSchedulingReview(page);
  await expect(page.locator(".dialog .form-error")).toContainText("overlaps");
  await page.getByLabel("Sprint ends", { exact: true }).fill(plus(start, -1));
  await page.getByRole("button", { name: "Save sprint", exact: true }).click();
  await confirmSchedulingReview(page);
  await expect(page.locator(".dialog .form-error")).toContainText("Sprint end");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Edit sprint", exact: true }).click();
  await page
    .getByLabel("Planning notes", { exact: true })
    .fill("Updated planning context");
  await page
    .getByRole("button", { name: "Apply app’s default duration", exact: true })
    .click();
  await page.getByRole("button", { name: "Save sprint", exact: true }).click();
  await confirmSchedulingReview(page);
  await saved(page);
  await expect(page.locator(".goal-text")).toHaveText("First feature");
  expect((await read(request)).sprints[0].notes).toBe(
    "Updated planning context",
  );
  await page.getByLabel("Committed", { exact: true }).check();
  await expect
    .poll(async () => (await read(request)).features[0].committed)
    .toBe(true);
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "Delete sprint", exact: true })
    .click();
  await confirmSchedulingReview(page);
  await expect(
    page.getByRole("heading", { name: "Find your next rhythm" }),
  ).toBeVisible();
  const state = await read(request);
  expect(state.sprints).toHaveLength(0);
  expect(state.features[0].sprintId).toBeUndefined();
  expect(state.features[0].committed).toBe(false);
  await page
    .getByRole("button", { name: "Undo last change", exact: true })
    .click();
  await expect(page.locator(".sprint-card")).toHaveCount(1);
});

test("finalized edited plans remain stable, export Markdown and print only the plan", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await nav(page, "Sprints & plans");
  await expect(page.locator(".resource-table tbody tr")).toHaveCount(1);
  await page
    .getByRole("button", { name: "Generate sprint plan", exact: true })
    .click();
  await expect(page.locator(".markdown")).toContainText("QA general terms");
  await page.getByRole("button", { name: "Edit text", exact: true }).click();
  await page
    .getByLabel("Sprint plan Markdown", { exact: true })
    .fill("# Final QA plan\n\nApproved custom text.");
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await page
    .getByRole("button", { name: "Finalize plan", exact: true })
    .click();
  await expect(page.getByText("Saved snapshot", { exact: true })).toBeVisible();
  await nav(page, "App settings");
  await page
    .getByLabel("General terms for exported plans", { exact: true })
    .fill("New terms");
  await page
    .getByRole("button", { name: "Save settings", exact: true })
    .click();
  await confirmSchedulingReview(page);
  await expect(page.locator(".saved-note")).toBeVisible();
  await page.reload();
  await nav(page, "Sprints & plans");
  await page.getByRole("tab", { name: "Sprint plan", exact: true }).click();
  await expect(page.locator(".markdown")).toContainText(
    "Approved custom text.",
  );
  expect((await read(request)).sprints[0].snapshot).toBe(
    "# Final QA plan\n\nApproved custom text.",
  );
  const dl = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export Markdown", exact: true })
    .click();
  const download = await dl;
  expect(download.suggestedFilename()).toBe("sprint-plan-1.md");
  await page.evaluate(() => {
    (window as unknown as { qaPrint: number }).qaPrint = 0;
    window.print = () => {
      (window as unknown as { qaPrint: number }).qaPrint++;
    };
  });
  await page.getByRole("button", { name: "Print / PDF", exact: true }).click();
  expect(
    await page.evaluate(
      () => (window as unknown as { qaPrint: number }).qaPrint,
    ),
  ).toBe(1);
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".sidebar")).not.toBeVisible();
  await expect(page.locator(".plan-print")).toBeVisible();
  await page.emulateMedia({ media: "screen" });
  await page
    .getByRole("button", { name: "Regenerate draft", exact: true })
    .click();
  await expect(page.locator(".markdown")).toContainText("New terms");
  await page.getByRole("button", { name: "Saved plan", exact: true }).click();
  await expect(page.locator(".markdown")).toContainText(
    "Approved custom text.",
  );
});

test("backup exports all records, restore validates, undo and archive preserve records", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await nav(page, "App settings");
  const dl = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export full backup", exact: true })
    .click();
  const download = await dl;
  const path = await download.path();
  const { readFile } = await import("node:fs/promises");
  expect(JSON.parse(await readFile(path!, "utf8"))).toEqual(
    await read(request),
  );
  page.once("dialog", (d) => d.accept());
  await page.getByLabel("Restore backup", { exact: true }).setInputFiles({
    name: "invalid.json",
    mimeType: "application/json",
    buffer: Buffer.from("{}"),
  });
  await expect(page.locator(".form-error")).toBeVisible();
  expect((await read(request)).apps[0].name).toBe("QA App");
  const restored = fixture();
  restored.apps[0].name = "Restored QA";
  page.once("dialog", (d) => d.accept());
  await page.getByLabel("Restore backup", { exact: true }).setInputFiles({
    name: "backup.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(restored)),
  });
  await expect(page.locator(".app-switch")).toContainText("Restored QA");
  await expect(page.getByLabel("App name", { exact: true })).toHaveValue(
    "Restored QA",
  );
  await page
    .getByRole("button", { name: "Undo last change", exact: true })
    .click();
  await expect(page.getByLabel("App name", { exact: true })).toHaveValue(
    "QA App",
  );
  await page.getByRole("button", { name: "Archive app", exact: true }).click();
  await confirmSchedulingReview(page);
  await expect(
    page.getByRole("button", { name: "Restore app", exact: true }),
  ).toBeVisible();
  const archived = await read(request);
  expect(archived.features).toHaveLength(1);
  expect(schedule(archived, start).features.f.end).toBeUndefined();
  await page.getByRole("button", { name: "Restore app", exact: true }).click();
  await confirmSchedulingReview(page);
  await expect(
    page.getByRole("button", { name: "Archive app", exact: true }),
  ).toBeVisible();
});

test("timeline controls, expansion and bars navigate and open the correct feature", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Expand First feature", exact: true })
    .click();
  await expect(page.locator(".timeline-grid")).toContainText("API");
  await page.getByRole("button", { name: "By person", exact: true }).click();
  await expect(page.locator(".timeline-grid")).toContainText("Alex");
  await page.getByRole("button", { name: "By feature", exact: true }).click();
  for (const zoom of ["Day", "Week", "Month"]) {
    await page.getByRole("button", { name: zoom, exact: true }).click();
    await noOverflow(page);
  }
  for (const range of [
    "1 month",
    "2 months",
    "3 months",
    "4 months",
    "5 months",
    "6 months",
  ]) {
    await select(page, "Timeline range", range);
    await expect(page.locator(".timeline-grid")).toBeVisible();
  }
  await page
    .getByRole("button", { name: "Previous week", exact: true })
    .click();
  await page.getByRole("button", { name: "Next week", exact: true }).click();
  await page.getByRole("button", { name: "Today", exact: true }).click();
  await page.locator(".timeline-bar").first().click();
  await expect(
    page.getByRole("dialog", { name: "Edit feature", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

for (const [width, height] of [
  [744, 1133],
  [1133, 744],
  [768, 1024],
  [1024, 768],
  [1366, 1024],
  [1440, 900],
  [1920, 1080],
  [2560, 1440],
  [3840, 2160],
  [390, 844],
]) {
  test(`wizard and availability dialogs fit ${width}x${height}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await page.goto("/");
    await nav(page, "Team & leave");
    for (const [button, title] of [
      ["Add person", "Add a team member"],
      ["Add leave", "Add time off"],
      ["Add holiday", "Add an app holiday"],
    ]) {
      await page.getByRole("button", { name: button, exact: true }).click();
      const dialog = page.getByRole("dialog", { name: title, exact: true });
      await expect(dialog).toBeVisible();
      await noOverflow(page);
      const box = await dialog.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      await page
        .getByRole("button", { name: "Close dialog", exact: true })
        .click();
      await expect(dialog).toHaveCount(0);
    }
    await nav(page, "Sprints & plans");
    await page.getByRole("button", { name: "New sprint", exact: true }).click();
    await noOverflow(page);
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.getByRole("button", { name: "Add an app", exact: true }).click();
    await expect(page.locator(".wizard-screen")).toBeVisible();
    await noOverflow(page);
    expect(
      (await page.locator(".wizard-screen").boundingBox())!.width,
    ).toBeCloseTo(
      await page.evaluate(() => document.documentElement.clientWidth),
      0,
    );
    await page
      .getByRole("button", { name: "Choose #328eaa", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Choose #328eaa", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await page.getByLabel("App name", { exact: true }).fill("Tablet setup");
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(page.locator(".form-error")).toContainText("Add at least one");
    await page.getByRole("button", { name: "Add person", exact: true }).click();
    await page
      .getByLabel("Person 1 name", { exact: true })
      .fill("Very long teammate name for tablet layout verification");
    await page.getByLabel("Person 1 role", { exact: true }).fill("Designer");
    await noOverflow(page);
    await page
      .getByRole("button", { name: /Remove Very long teammate/ })
      .click();
    await expect(page.getByLabel("Person 1 name", { exact: true })).toHaveCount(
      0,
    );
    await page
      .getByRole("button", { name: "Cancel setup", exact: true })
      .click();
    await expect(page.locator(".app-switch")).toContainText("QA App");
  });
}

test("feature priority, search, dates, sprint assignment, status, deletion and undo", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await nav(page, "Features");
  await page.getByRole("button", { name: "Add feature", exact: true }).click();
  await page
    .getByLabel("Feature title", { exact: true })
    .fill("Second feature");
  await page.getByLabel("Sprint estimation", { exact: true }).fill("0.25");
  await page.getByLabel("Main assignee: Sam", { exact: true }).check();
  await page.getByRole("button", { name: "Save feature", exact: true }).click();
  await confirmSchedulingReview(page);
  await expect(page.locator(".dialog .form-error")).toBeVisible();
  await page.getByLabel("Sprint estimation", { exact: true }).fill("0.5");
  await openFeatureSection(page, "Scheduling options");
  await page
    .getByLabel("Target delivery date", { exact: true })
    .fill(plus(start, 21));
  await openFeatureSection(page, "Scheduling options");
  await page
    .getByLabel("Start no earlier than", { exact: true })
    .fill(plus(start, 2));
  await page.getByRole("button", { name: /Assigned sprint/ }).click();
  await page.getByRole("option", { name: /^Sprint 1 ·/ }).click();
  await openFeatureSection(page, "Scheduling options");
  await page.getByLabel("Accept delivery date", { exact: true }).check();
  await openFeatureSection(page, "Details & completion");
  await page
    .getByLabel("Reference link or work-item ID", { exact: true })
    .fill("https://example.com/work");
  await page.getByRole("button", { name: "Save feature", exact: true }).click();
  await confirmSchedulingReview(page);
  await saved(page);
  let state = await read(request);
  const second = state.features.find((f) => f.title === "Second feature")!;
  expect(second).toMatchObject({
    sprintId: "s",
    committed: true,
    target: plus(start, 21),
    notBefore: plus(start, 2),
    priority: 0,
  });
  await expect(
    page.getByRole("link", {
      name: "Open reference for Second feature",
      exact: true,
    }),
  ).toHaveAttribute("href", "https://example.com/work");
  await page
    .getByRole("button", { name: "Move Second feature down", exact: true })
    .click();
  await confirmSchedulingReview(page);
  await expect(page.locator(".feature-main h3")).toHaveText([
    "First feature",
    "Second feature",
  ]);
  await page
    .getByRole("button", { name: "Move Second feature up", exact: true })
    .click();
  await confirmSchedulingReview(page);
  await expect(page.locator(".feature-main h3")).toHaveText([
    "Second feature",
    "First feature",
  ]);
  await page.getByLabel("Search features", { exact: true }).fill("Second");
  await expect(page.locator(".feature-item")).toHaveCount(1);
  await page.getByLabel("Search features", { exact: true }).fill("No match");
  await expect(
    page.getByRole("heading", { name: "No matching features", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Search features", { exact: true }).fill("");
  await page
    .getByRole("button", { name: "Edit Second feature", exact: true })
    .click();
  await openFeatureSection(page, "Scheduling options");
  await expect(page.getByLabel("Feature status", { exact: true })).toHaveCount(
    0,
  );
  await page
    .getByLabel("Start no earlier than", { exact: true })
    .fill(plus(start, 14));
  await page.getByRole("button", { name: "Save feature", exact: true }).click();
  await confirmSchedulingReview(page);
  await saved(page);
  state = await read(request);
  expect(schedule(state, start).features[second.id].start).toBe(
    plus(start, 15),
  );
  const secondRow = page.locator(".feature-item").filter({
    has: page.getByRole("heading", { name: "Second feature", exact: true }),
  });
  await expect(secondRow.locator(".status-pill")).toHaveText("Planned");
  await page
    .getByRole("button", { name: "Edit Second feature", exact: true })
    .click();
  await openFeatureSection(page, "Scheduling options");
  await page.getByLabel("Start no earlier than", { exact: true }).fill(start);
  await page.getByRole("button", { name: "Save feature", exact: true }).click();
  await confirmSchedulingReview(page);
  await saved(page);
  state = await read(request);
  const interval = schedule(state, start).features[second.id];
  expect(interval.start).toBe(plus(start, 1));
  await page.clock.setSystemTime(new Date(`${interval.start}T12:00:00Z`));
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(secondRow.locator(".status-pill")).toHaveText("In progress");
  const unchanged = await (await request.get("/api/state")).json();
  await page.clock.setSystemTime(
    new Date(`${plus(interval.end!, 1)}T12:00:00Z`),
  );
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(secondRow.locator(".status-pill")).toHaveText("Done");
  expect(await (await request.get("/api/state")).json()).toEqual(unchanged);
  await page
    .getByRole("button", { name: "Edit Second feature", exact: true })
    .click();
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "Delete feature", exact: true })
    .click();
  await confirmSchedulingReview(page);
  await saved(page);
  await expect(page.locator(".feature-item")).toHaveCount(1);
  await page
    .getByRole("button", { name: "Undo last change", exact: true })
    .click();
  await expect(page.locator(".feature-item")).toHaveCount(2);
  await nav(page, "Sprints & plans");
  await page
    .getByRole("button", {
      name: "Remove Second feature from sprint",
      exact: true,
    })
    .click();
  await confirmSchedulingReview(page);
  await expect
    .poll(
      async () =>
        (await read(request)).features.find((f) => f.id === second.id)!
          .sprintId,
    )
    .toBeUndefined();
});

test("app picker and overview isolate teams, and global leave is shared", async ({
  page,
  request,
}) => {
  const state = fixture();
  state.apps.push({
    ...state.apps[0],
    id: "b",
    name: "Second app",
    weekends: [0, 6],
  });
  state.members.push({ ...state.members[0], id: "bm", appId: "b" });
  await seed(request, state);
  await page.goto("/");
  await nav(page, "Team & leave");
  await page.getByLabel("Search team", { exact: true }).fill("Sam");
  await select(page, "Current app", "Second app");
  await nav(page, "Team & leave");
  await expect(page.getByLabel("Search team", { exact: true })).toHaveValue("");
  await expect(page.locator(".person-card h3")).toHaveText(["Alex"]);
  await page.getByRole("button", { name: "Add leave", exact: true }).click();
  await page.getByLabel("Leave note", { exact: true }).fill("Shared leave");
  await page.getByRole("button", { name: "Save leave", exact: true }).click();
  await confirmSchedulingReview(page);
  await saved(page);
  await page.getByRole("button", { name: "Add person", exact: true }).click();
  await select(page, "Person source", "Sam");
  await page.getByLabel("Role / scope", { exact: true }).fill("Design");
  await page.getByRole("button", { name: "Save person", exact: true }).click();
  await confirmSchedulingReview(page);
  await saved(page);
  await page
    .getByRole("button", { name: "All apps overview", exact: true })
    .click();
  await expect(page.locator(".overview-card:not(.add-app-card)")).toHaveCount(
    2,
  );
  await page.locator(".overview-card").filter({ hasText: "QA App" }).click();
  await nav(page, "Team & leave");
  await expect(
    page.getByText("Full day · Shared leave", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Shared across 2 apps", { exact: true }),
  ).toHaveCount(2);
  expect((await read(request)).people).toHaveLength(2);
});

test("a failed save preserves team data and can be retried", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await nav(page, "Team & leave");
  await page.getByRole("button", { name: "Edit Alex", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Retry Alex");
  await page.route("**/api/state", async (route) => {
    if (route.request().method() === "PUT")
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "QA simulated save failure" }),
      });
    else await route.continue();
  });
  await page.getByRole("button", { name: "Save person", exact: true }).click();
  await confirmSchedulingReview(page);
  await expect(page.locator(".dialog .form-error")).toContainText(
    "QA simulated save failure",
  );
  expect((await read(request)).people[0].name).toBe("Alex");
  await expect(page.locator(".person-card h3").first()).toHaveText("Alex");
  await page.unroute("**/api/state");
  await page.getByRole("button", { name: "Save person", exact: true }).click();
  await confirmSchedulingReview(page);
  await saved(page);
  await expect(page.locator(".person-card h3").first()).toHaveText(
    "Retry Alex",
  );
});

for (const width of [768, 3840]) {
  test(`long app and member names remain inside the layout at ${width}px`, async ({
    page,
    request,
  }) => {
    const state = fixture();
    state.apps[0].name = "A long application name ".repeat(8).trim();
    state.people[0].name = "A long team member name ".repeat(8).trim();
    state.members[0].role =
      "Engineering and architecture across several delivery scopes";
    await seed(request, state);
    await page.setViewportSize({ width, height: 1024 });
    await page.goto("/");
    for (const name of [
      "Timeline",
      "Team & leave",
      "Sprints & plans",
      "App settings",
    ]) {
      await nav(page, name);
      await noOverflow(page);
    }
  });
}

test("undo restores saved sprint draft in editor, preview and export", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await nav(page, "Sprints & plans");
  await page
    .getByRole("button", { name: "Generate sprint plan", exact: true })
    .click();
  await page.getByRole("button", { name: "Edit text", exact: true }).click();
  await page
    .getByLabel("Sprint plan Markdown", { exact: true })
    .fill("# Draft one");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect
    .poll(async () => (await read(request)).sprints[0].draft)
    .toBe("# Draft one");
  await page
    .getByLabel("Sprint plan Markdown", { exact: true })
    .fill("# Draft two");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect
    .poll(async () => (await read(request)).sprints[0].draft)
    .toBe("# Draft two");
  await page
    .getByRole("button", { name: "Undo last change", exact: true })
    .click();
  await expect
    .poll(async () => (await read(request)).sprints[0].draft)
    .toBe("# Draft one");
  await expect(
    page.getByLabel("Sprint plan Markdown", { exact: true }),
  ).toHaveValue("# Draft one");
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(page.locator(".markdown")).toHaveText("Draft one");
  const dl = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export Markdown", exact: true })
    .click();
  const download = await dl;
  const { readFile } = await import("node:fs/promises");
  expect(await readFile((await download.path())!, "utf8")).toBe("# Draft one");
});

test("dragging a timeline feature changes priority and delivery order", async ({
  page,
  request,
}) => {
  const state = fixture();
  state.features.push({
    ...state.features[0],
    id: "f2",
    title: "Next feature",
    priority: 1,
    tasks: [{ ...state.features[0].tasks[0], id: "t2" }],
  });
  await seed(request, state);
  await page.goto("/");
  const rows = page.locator('.timeline-row-label[draggable="true"]');
  await expect(rows).toHaveCount(2);
  await rows.nth(1).dragTo(rows.nth(0));
  await confirmSchedulingReview(page);
  await expect
    .poll(
      async () =>
        (await read(request)).features.find((f) => f.id === "f2")!.priority,
    )
    .toBe(0);
  await expect(rows.first()).toContainText("Next feature");
  const after = await read(request);
  const forecast = schedule(after, start);
  expect(forecast.features.f2.end! <= forecast.features.f.start!).toBeTruthy();
});

for (const action of ["Save draft", "Finalize plan"]) {
  test(`failed save via ${action} keeps edited sprint text for retry`, async ({
    page,
    request,
  }) => {
    const state = fixture();
    state.sprints[0].draft = "# Saved original";
    await seed(request, state);
    await page.goto("/");
    await nav(page, "Sprints & plans");
    await page.getByRole("tab", { name: "Sprint plan", exact: true }).click();
    await page.getByRole("button", { name: "Edit text", exact: true }).click();
    await page
      .getByLabel("Sprint plan Markdown", { exact: true })
      .fill("# Keep my edits");
    await page.route("**/api/state", async (route) => {
      if (route.request().method() === "PUT")
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "QA simulated save failure" }),
        });
      else await route.continue();
    });
    await page.getByRole("button", { name: action, exact: true }).click();
    await expect(page.locator(".sprint-detail .form-error")).toContainText(
      "QA simulated save failure",
    );
    await expect(
      page.getByLabel("Sprint plan Markdown", { exact: true }),
    ).toHaveValue("# Keep my edits");
    expect((await read(request)).sprints[0].draft).toBe("# Saved original");
    await page.unroute("**/api/state");
    await page.getByRole("button", { name: action, exact: true }).click();
    await expect
      .poll(async () => {
        const sprint = (await read(request)).sprints[0];
        return action === "Save draft" ? sprint.draft : sprint.snapshot;
      })
      .toBe("# Keep my edits");
  });
}

for (const action of ["Save draft", "Finalize plan"]) {
  test(`pending ${action} protects the submitted text from further edits`, async ({
    page,
    request,
  }) => {
    await page.goto("/");
    await nav(page, "Sprints & plans");
    await page
      .getByRole("button", { name: "Generate sprint plan", exact: true })
      .click();
    await page.getByRole("button", { name: "Edit text", exact: true }).click();
    await page
      .getByLabel("Sprint plan Markdown", { exact: true })
      .fill("# Submitted text");
    await page.route("**/api/state", async (route) => {
      if (route.request().method() === "PUT")
        await new Promise((resolve) => setTimeout(resolve, 1200));
      await route.continue();
    });
    await page.getByRole("button", { name: action, exact: true }).click();
    await expect(
      page.getByLabel("Sprint plan Markdown", { exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Regenerate draft", exact: true }),
    ).toBeDisabled();
    await expect
      .poll(async () => {
        const sprint = (await read(request)).sprints[0];
        return action === "Save draft" ? sprint.draft : sprint.snapshot;
      })
      .toBe("# Submitted text");
    if (action === "Save draft")
      await expect(
        page.getByLabel("Sprint plan Markdown", { exact: true }),
      ).toBeEnabled();
    else
      await expect(page.locator(".markdown")).toContainText("Submitted text");
  });
}

for (const width of [744, 834]) {
  test(`portrait tablet ${width}px keeps a usable navigation rail and content frame`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1133 });
    await page.goto("/");
    await expect(page.locator(".timeline-grid")).toBeVisible();
    await timelineTouchTargets(page);
    const main = (await page.locator(".main-area").boundingBox())!;
    const rail = (await page.locator(".sidebar").boundingBox())!;
    expect(main.x).toBeCloseTo(rail.x + rail.width, 0);
    expect(main.width + rail.width).toBe(
      await page.evaluate(() => document.documentElement.clientWidth),
    );
    for (const button of await page.locator(".sidebar nav > button").all()) {
      const box = (await button.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
      await expect(button.locator("span")).toBeVisible();
      await button.click();
      await noOverflow(page);
    }
    await nav(page, "Team & leave");
    await page.getByRole("button", { name: "Add person", exact: true }).click();
    const save = page.getByRole("button", { name: "Save person", exact: true });
    expect((await save.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.getByRole("button", { name: "Add an app", exact: true }).click();
    expect(
      await page
        .locator(".wizard-aside")
        .evaluate((el) => el.getBoundingClientRect().height),
    ).toBeLessThan(240);
    await page.getByLabel("App name", { exact: true }).fill("Tablet app");
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page.getByRole("button", { name: "Add person", exact: true }).click();
    expect(
      (await page.getByLabel("Person 1 name", { exact: true }).boundingBox())!
        .width,
    ).toBeGreaterThan(240);
  });
}

test("layout remains usable across tablet and desktop breakpoint boundaries", async ({
  page,
}) => {
  test.setTimeout(60000);
  await page.goto("/");
  for (const width of [
    600, 601, 743, 744, 849, 850, 851, 899, 900, 901, 1024, 1050, 1051, 1150,
    1151, 1280, 1281, 1366, 1600, 1920, 2560, 3840,
  ]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const name of [
      "Timeline",
      "Team & leave",
      "Sprints & plans",
      "App settings",
    ]) {
      await nav(page, name);
      await noOverflow(page);
    }
    await nav(page, "Team & leave");
    for (const card of await page.locator(".person-card").all()) {
      expect(
        await card.evaluate((el) => el.scrollWidth - el.clientWidth),
        `card content overflows at ${width}px`,
      ).toBeLessThanOrEqual(1);
    }
    expect(
      (await page.locator(".page-content").boundingBox())!.width,
    ).toBeCloseTo((await page.locator(".main-area").boundingBox())!.width, 0);
  }
});

test("iPad mini landscape has touch-sized controls and a scrollable sidebar", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1133, height: 744 });
  await page.goto("/");
  await nav(page, "Team & leave");
  const add = page.getByRole("button", { name: "Add person", exact: true });
  expect((await add.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  const newApp = page.getByRole("button", { name: "Add an app", exact: true });
  expect((await newApp.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect(
    await page
      .locator(".sidebar")
      .evaluate((el) => getComputedStyle(el).overflowY),
  ).toBe("auto");
  await newApp.click();
  await expect(page.locator(".wizard-screen")).toBeVisible();
  await noOverflow(page);
  await page.getByRole("button", { name: "Cancel setup", exact: true }).click();
  await nav(page, "Timeline");
  await timelineTouchTargets(page);
});

test("large desktop fills the viewport with expanded and collapsed navigation", async ({
  page,
}) => {
  await page.goto("/");
  for (const width of [1920, 2560, 3840]) {
    await page.setViewportSize({ width, height: 1080 });
    for (const name of ["Collapse navigation", "Expand navigation"]) {
      const frame = (await page.locator(".app-shell").boundingBox())!;
      const main = (await page.locator(".main-area").boundingBox())!;
      const sidebar = (await page.locator(".sidebar").boundingBox())!;
      const viewport = await page.evaluate(
        () => document.documentElement.clientWidth,
      );
      expect(frame.x).toBeCloseTo(0, 0);
      expect(frame.width).toBeCloseTo(viewport, 0);
      expect(sidebar.x).toBeCloseTo(0, 0);
      expect(main.x).toBeCloseTo(sidebar.x + sidebar.width, 0);
      expect(main.x + main.width).toBeCloseTo(viewport, 0);
      await noOverflow(page);
      const toggle = page.getByRole("button", { name, exact: true });
      await toggle.focus();
      await page.keyboard.press("Enter");
    }
  }
});

test("new sprints skip the shared Saturday and retain Sunday–Friday cycles", async ({
  page,
  request,
}) => {
  const state = fixture();
  state.sprints[0] = {
    ...state.sprints[0],
    number: 49,
    start: "2027-01-03",
    end: "2027-01-15",
  };
  await seed(request, state);
  await page.goto("/");
  await nav(page, "Sprints & plans");
  for (const [number, from, to] of [
    [50, "2027-01-17", "2027-01-29"],
    [51, "2027-01-31", "2027-02-12"],
  ] as const) {
    await page.getByRole("button", { name: "New sprint", exact: true }).click();
    await expect(page.getByLabel("Sprint number", { exact: true })).toHaveValue(
      String(number),
    );
    await expect(page.getByLabel("Sprint starts", { exact: true })).toHaveValue(
      from,
    );
    await expect(page.getByLabel("Sprint ends", { exact: true })).toHaveValue(
      to,
    );
    if (number === 50) {
      await page.getByLabel("Sprint starts", { exact: true }).fill("");
      await page
        .getByRole("button", {
          name: "Apply app’s default duration",
          exact: true,
        })
        .click();
      await expect(page.locator(".dialog .form-error")).toContainText(
        "Choose a sprint start date first",
      );
      await page
        .getByLabel("Sprint starts", { exact: true })
        .fill("2027-01-16");
      await page
        .getByRole("button", {
          name: "Apply app’s default duration",
          exact: true,
        })
        .click();
      await expect(
        page.getByLabel("Sprint starts", { exact: true }),
      ).toHaveValue(from);
      await expect(page.getByLabel("Sprint ends", { exact: true })).toHaveValue(
        to,
      );
    }
    await page
      .getByRole("button", { name: "Save sprint", exact: true })
      .click();
    await confirmSchedulingReview(page);
    await saved(page);
  }
  await page.locator(".sprint-card").filter({ hasText: "Sprint 51" }).click();
  await page.getByRole("button", { name: "Edit sprint", exact: true }).click();
  await page.getByLabel("Sprint starts", { exact: true }).fill("2027-02-01");
  await page.getByLabel("Sprint ends", { exact: true }).fill("2027-02-10");
  await page.getByRole("button", { name: "Save sprint", exact: true }).click();
  await confirmSchedulingReview(page);
  await saved(page);
  expect((await read(request)).sprints.at(-1)).toMatchObject({
    start: "2027-02-01",
    end: "2027-02-10",
  });
});

test("wizard previews and saves the same shared-weekend sprint dates", async ({
  page,
  request,
}) => {
  await seed(request, emptyState);
  await page.goto("/");
  await page.getByLabel("App name", { exact: true }).fill("Calendar QA");
  await page
    .getByRole("button", { name: "Use example team", exact: true })
    .click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page
    .getByLabel("Override app weekends for this person", { exact: true })
    .nth(1)
    .check();
  const second = page.locator(".team-input-card").nth(1);
  await second
    .getByRole("button", { name: "Fri weekend", exact: true })
    .click();
  await second
    .getByRole("button", { name: "Sun weekend", exact: true })
    .click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByLabel("Planning starts", { exact: true }).fill("");
  await expect(
    page.getByLabel("Planning starts", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.locator(".form-error")).toContainText("Enter a valid date");
  await page.getByLabel("Planning starts", { exact: true }).fill("2026-10-10");
  await page.getByLabel("Plan in sprints", { exact: true }).check();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.locator(".info-box")).toContainText(
    "Oct 11, 2026 – Oct 23, 2026",
  );
  await select(page, "Default sprint length", "Custom duration");
  await page.getByLabel("Calendar days per sprint", { exact: true }).fill("");
  await expect(page.locator(".info-box")).toContainText(
    "Enter a valid planning date and duration",
  );
  await page.getByLabel("Calendar days per sprint", { exact: true }).fill("14");
  await expect(page.locator(".info-box")).toContainText(
    "Oct 11, 2026 – Oct 23, 2026",
  );
  await select(page, "Default sprint length", "2 weeks");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page
    .getByRole("button", { name: "Open my planner", exact: true })
    .click();
  await confirmSchedulingReview(page);
  await expect(page.locator(".sidebar")).toBeVisible();
  expect((await read(request)).sprints[0]).toMatchObject({
    start: "2026-10-11",
    end: "2026-10-23",
  });
});
