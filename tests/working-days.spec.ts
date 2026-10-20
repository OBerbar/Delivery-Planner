import {
  confirmSchedulingReview,
  openFeatureSection,
} from "./helpers/ui-workflows";
import { test, expect } from "@playwright/test";
import { maintenanceFixture, fixedToday } from "../scripts/maintenance-fixture";
test("sprint goals follow feature progress and generated scope stays blank without subtasks", async ({
  page,
  request,
}) => {
  const state = maintenanceFixture();
  state.features = [state.features[0]];
  state.features[0].estimateEffort![0].hours = 200;
  state.sprints.push(
    {
      ...state.sprints[0],
      id: "s2",
      number: 2,
      start: "2030-01-21",
      end: "2030-02-01",
    },
    {
      ...state.sprints[0],
      id: "s3",
      number: 3,
      start: "2030-02-04",
      end: "2030-02-15",
    },
  );
  const { revision } = await (await request.get("/api/state")).json();
  expect(
    (await request.put("/api/state", { data: { revision, state } })).ok(),
  ).toBe(true);
  await page.reload();
  await page.getByRole("button", { name: /^Sprints & plans/ }).click();
  await expect(page.locator(".goal-text")).toHaveText(
    "Start Five sprint delivery",
  );
  await page.locator(".sprint-card").nth(1).click();
  await expect(page.locator(".goal-text")).toHaveText(
    "Proceed with Five sprint delivery",
  );
  await page.locator(".sprint-card").nth(2).click();
  await expect(page.locator(".goal-text")).toHaveText("Five sprint delivery");
  await page.getByRole("tab", { name: "Sprint plan", exact: true }).click();
  await expect(page.locator(".markdown.plan-print").first()).toContainText(
    "Saved draft",
  );
  await page
    .getByRole("button", { name: "Regenerate draft", exact: true })
    .click();
  await page.getByRole("button", { name: "Edit text", exact: true }).click();
  const editor = page.getByLabel("Sprint plan Markdown", { exact: true });
  await expect(editor).toHaveValue(
    /\*\*Sprint Goal\*\*\n___\n- Five sprint delivery\n/,
  );
  await expect(editor).toHaveValue(
    /\*\*Web Frontend & Full stack\*\*\n\n\*\*Backend\*\*\n\n\*\*Mobile\*\*\n\n/,
  );
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await (await request.get("/api/state")).json()).state.sprints[2].draft,
    )
    .toMatch(/- Five sprint delivery/);
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export Markdown", exact: true })
    .click();
  expect((await download).suggestedFilename()).toMatch(/\.md$/);
  const saved = (await (await request.get("/api/state")).json()).state;
  expect(saved.sprints[2].snapshot).toBe(state.sprints[2].snapshot);
  expect(saved.features).toEqual(state.features);
});
test.beforeEach(async ({ page, request }) => {
  await page.clock.install({ time: new Date(`${fixedToday}T12:00:00Z`) });
  const { revision } = await (await request.get("/api/state")).json();
  await request.put("/api/state", {
    data: { revision, state: maintenanceFixture() },
  });
  await page.goto("/");
});
test("scope objectives use real subtasks and stop repeating a task after its finishing sprint", async ({
  page,
  request,
}) => {
  const state = maintenanceFixture();
  state.features = [state.features[0]];
  state.features[0].tasks = [
    {
      id: "api",
      title: "API implementation",
      personId: "p",
      scope: "BE",
      hours: 200,
      status: "todo",
      dependsOn: [],
    },
    {
      id: "mobile",
      title: "Mobile screen",
      personId: "q",
      scope: "Mobile",
      hours: 8,
      status: "todo",
      dependsOn: [],
    },
  ];
  state.sprints.push({
    ...state.sprints[0],
    id: "s2",
    number: 2,
    start: "2030-01-21",
    end: "2030-02-01",
  });
  const { revision } = await (await request.get("/api/state")).json();
  expect(
    (await request.put("/api/state", { data: { revision, state } })).ok(),
  ).toBe(true);
  await page.reload();
  await page.getByRole("button", { name: /^Sprints & plans/ }).click();
  await page
    .getByRole("button", { name: "Generate sprint plan", exact: true })
    .click();
  const plan = page.locator(".markdown.plan-print").first();
  await expect(plan).toContainText("Five sprint delivery — API implementation");
  await expect(plan).toContainText("Five sprint delivery — Mobile screen");
  await page.locator(".sprint-card").nth(1).click();
  await page
    .getByRole("button", { name: "Generate sprint plan", exact: true })
    .click();
  await expect(plan).toContainText("Five sprint delivery — API implementation");
  await expect(plan).not.toContainText("Mobile screen");
  expect((await (await request.get("/api/state")).json()).revision).toBe(
    revision + 1,
  );
});
test("day-based leave input stores accurate effort and plan exports named dates without hour ledgers", async ({
  page,
  request,
}) => {
  await page.getByRole("button", { name: /^Team & leave/ }).click();
  await page.getByRole("button", { name: "Add leave", exact: true }).click();
  await page.getByLabel("Full-day leave", { exact: true }).uncheck();
  await expect(
    page.getByLabel("Days off per day", { exact: true }),
  ).toHaveValue("0.5");
  await page.getByLabel("Leave starts", { exact: true }).fill("2030-01-08");
  await page.getByLabel("Leave ends", { exact: true }).fill("2030-01-09");
  await page.getByLabel("Leave note", { exact: true }).fill("Appointment");
  await page.getByRole("button", { name: "Save leave", exact: true }).click();
  const review = page.getByRole("dialog", {
    name: "Review scheduling changes",
    exact: true,
  });
  if (await review.count())
    await page
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(
    (await (await request.get("/api/state")).json()).state.leaves[0].hours,
  ).toBe(4);
  await page.getByRole("button", { name: /^Sprints & plans/ }).click();
  await expect(page.locator(".resource-table")).not.toContainText(/\d+h/);
  await page
    .getByRole("button", { name: "Generate sprint plan", exact: true })
    .click();
  await expect(page.locator(".markdown.plan-print").first()).toContainText(
    "Alex is on leave",
  );
});

test("a six-hour workday uses fractional days for leave and whole days for optional tasks after reload", async ({
  page,
  request,
}) => {
  const state = maintenanceFixture();
  state.people[0].dailyHours = 6;
  state.features = [
    {
      ...state.features[0],
      committed: false,
      commitment: undefined,
      estimateEffort: [{ personId: "p", hours: 12 }],
    },
  ];
  const { revision } = await (await request.get("/api/state")).json();
  expect(
    (await request.put("/api/state", { data: { revision, state } })).ok(),
  ).toBe(true);
  await page.reload();
  await page.getByRole("button", { name: /^Team & leave/ }).click();
  await page.getByRole("button", { name: "Add leave", exact: true }).click();
  await page.getByLabel("Full-day leave", { exact: true }).uncheck();
  await page.getByLabel("Leave starts", { exact: true }).fill("2030-01-08");
  await page.getByLabel("Leave ends", { exact: true }).fill("2030-01-08");
  await page.getByLabel("Days off per day", { exact: true }).fill("1.1");
  await page.getByRole("button", { name: "Save leave", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("between 0.01 and 1");
  await page.getByLabel("Days off per day", { exact: true }).fill("0.5");
  await page.getByRole("button", { name: "Save leave", exact: true }).click();
  await confirmSchedulingReview(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(
    (await (await request.get("/api/state")).json()).state.leaves[0].hours,
  ).toBe(3);
  await page.getByRole("button", { name: /^Features/ }).click();
  await page
    .getByRole("button", { name: "Edit Five sprint delivery", exact: true })
    .click();
  await openFeatureSection(page, "Optional tasks");
  await page.getByLabel("Add optional task breakdown", { exact: true }).check();
  await page.getByLabel("Task 1 title", { exact: true }).fill("Two day task");
  await expect(
    page.getByLabel("Task 1 remaining days", { exact: true }),
  ).toHaveValue("1");
  await page.getByLabel("Task 1 remaining days", { exact: true }).fill("2");
  await page.getByRole("button", { name: "Save feature", exact: true }).click();
  await confirmSchedulingReview(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(
    (await (await request.get("/api/state")).json()).state.features[0].tasks[0]
      .hours,
  ).toBe(12);
  await page.reload();
  await page.getByRole("button", { name: /^Features/ }).click();
  await page
    .getByRole("button", { name: "Edit Five sprint delivery", exact: true })
    .click();
  await expect(
    page.getByLabel("Task 1 remaining days", { exact: true }),
  ).toHaveValue("2");
});

test("editing an older leave note preserves its saved amount after a person's workday was shortened", async ({
  page,
  request,
}) => {
  const state = maintenanceFixture();
  state.people[0].dailyHours = 6;
  state.leaves = [
    {
      id: "legacy",
      personId: "p",
      start: "2030-01-08",
      end: "2030-01-08",
      hours: 8,
      note: "Original absence",
    },
  ];
  const { revision } = await (await request.get("/api/state")).json();
  expect(
    (await request.put("/api/state", { data: { revision, state } })).ok(),
  ).toBe(true);
  await page.reload();
  await page.getByRole("button", { name: /^Team & leave/ }).click();
  await page
    .getByRole("button", {
      name: "Edit leave for Alex, 2030-01-08 to 2030-01-08",
      exact: true,
    })
    .click();
  await expect(
    page.getByLabel("Days off per day", { exact: true }),
  ).toHaveValue("1.333333");
  await page
    .getByLabel("Leave note", { exact: true })
    .fill("Corrected explanation");
  await page.getByRole("button", { name: "Save leave", exact: true }).click();
  await confirmSchedulingReview(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect((await (await request.get("/api/state")).json()).state.leaves).toEqual(
    [{ ...state.leaves[0], note: "Corrected explanation" }],
  );
});

test("the minimum partial leave is accepted for a fractional daily-hours setting", async ({
  page,
  request,
}) => {
  const state = maintenanceFixture();
  state.people[0].dailyHours = 7.2;
  const { revision } = await (await request.get("/api/state")).json();
  expect(
    (await request.put("/api/state", { data: { revision, state } })).ok(),
  ).toBe(true);
  await page.reload();
  await page.getByRole("button", { name: /^Team & leave/ }).click();
  await page.getByRole("button", { name: "Add leave", exact: true }).click();
  await page.getByLabel("Full-day leave", { exact: true }).uncheck();
  await page.getByLabel("Days off per day", { exact: true }).fill("0.01");
  await page.getByRole("button", { name: "Save leave", exact: true }).click();
  await confirmSchedulingReview(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(
    (await (await request.get("/api/state")).json()).state.leaves[0].hours,
  ).toBeCloseTo(0.072, 10);
});
