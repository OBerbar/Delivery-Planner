import {
  confirmSchedulingReview,
  openFeatureSection,
} from "./helpers/ui-workflows";
import { test, expect, type Page } from "@playwright/test";
import { emptyState } from "../src/lib/model";

const seed = {
  ...emptyState,
  apps: [
    {
      id: "a",
      name: "Estimate QA",
      color: "#7565db",
      weekends: [5, 6],
      planningStart: "2026-10-06",
      cadence: "2w",
      customDays: 14,
      terms: "",
      archived: false,
    },
  ],
  people: [
    { id: "p", name: "Alex", dailyHours: 8 },
    { id: "q", name: "Sam", dailyHours: 8 },
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
      role: "Design",
      allocation: 100,
      weekends: null,
    },
  ],
  features: [],
};

async function pick(page: Page, label: string, value: string) {
  await page.getByRole("button", { name: new RegExp(label) }).click();
  await page.getByRole("option", { name: value, exact: true }).click();
}
async function openFeature(page: Page, title: string) {
  await page.goto("/");
  await page.getByRole("button", { name: "Add feature", exact: true }).click();
  await page.getByLabel("Feature title", { exact: true }).fill(title);
  // These cases exercise sprint-unit conversions without creating sprint records.
  await pick(page, "Estimate unit", "Sprints");
  await page.getByLabel("Sprint estimation", { exact: true }).fill("1");
  await page
    .getByRole("button", { name: "Select all team", exact: true })
    .click();
}
async function saveFeature(page: Page) {
  await page.getByRole("button", { name: "Save feature", exact: true }).click();
  await confirmSchedulingReview(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
}
async function editFeature(page: Page, title: string) {
  await page.reload();
  await page.getByRole("button", { name: /^Features / }).click();
  await page
    .getByRole("button", { name: `Edit ${title}`, exact: true })
    .click();
}

test.beforeEach(async ({ page, request }) => {
  await page.clock.install({ time: new Date("2026-10-06T10:00:00Z") });
  const { revision } = await (await request.get("/api/state")).json();
  expect(
    (await request.put("/api/state", { data: { revision, state: seed } })).ok(),
  ).toBeTruthy();
});

test("person estimate mixed units survive optional tasks and saved reload", async ({
  page,
  request,
}) => {
  await openFeature(page, "Mixed estimate");
  await expect(
    page.getByRole("dialog", { name: "Add a feature", exact: true }),
  ).toContainText("1 sprint = 10 working days");
  await pick(page, "Estimate method", "Per person");
  await page.getByLabel("Alex estimate", { exact: true }).fill("1");
  await pick(page, "Sam estimate unit", "Working days");
  await page.getByLabel("Sam estimate", { exact: true }).fill("3");
  await openFeatureSection(page, "Optional tasks");
  await page.getByLabel("Add optional task breakdown", { exact: true }).check();
  await expect(page.getByLabel("Sam estimate", { exact: true })).toHaveValue(
    "3",
  );
  await openFeatureSection(page, "Optional tasks");
  await page
    .getByLabel("Add optional task breakdown", { exact: true })
    .uncheck();
  await expect(page.getByLabel("Sam estimate", { exact: true })).toHaveValue(
    "3",
  );
  await saveFeature(page);
  const saved = (await (await request.get("/api/state")).json()).state
    .features[0];
  expect(saved.assigneeEstimates).toEqual([
    { personId: "p", unit: "sprints", value: 1 },
    { personId: "q", unit: "days", value: 3 },
  ]);
  expect(saved.sprintEstimate).toBeUndefined();
  expect(saved.tasks).toEqual([]);
  expect(saved.estimateEffort).toEqual([
    { personId: "p", hours: 80 },
    { personId: "q", hours: 24 },
  ]);
  await editFeature(page, "Mixed estimate");
  await expect(page.getByLabel("Alex estimate", { exact: true })).toHaveValue(
    "1",
  );
  await expect(page.getByLabel("Sam estimate", { exact: true })).toHaveValue(
    "3",
  );
  await expect(
    page.getByRole("button", { name: /Sam estimate unit/ }),
  ).toContainText("Working days");
  await pick(page, "Sam estimate unit", "Sprints");
  await expect(page.getByLabel("Sam estimate", { exact: true })).toHaveValue(
    "0.3",
  );
  await page.getByLabel("Sam estimate", { exact: true }).fill("0.5");
  await saveFeature(page);
});

test("person estimate same working days apply to selected people and convert units", async ({
  page,
  request,
}) => {
  await openFeature(page, "Shared days");
  await page.getByLabel("Sprint estimation", { exact: true }).fill("1.5");
  await pick(page, "Estimate unit", "Working days");
  await expect(
    page.getByLabel("Working days estimation", { exact: true }),
  ).toHaveValue("15");
  await page.getByLabel("Working days estimation", { exact: true }).fill("2.5");
  await page.getByLabel("Main assignee: Sam", { exact: true }).uncheck();
  await page.getByLabel("Main assignee: Sam", { exact: true }).check();
  await saveFeature(page);
  let saved = (await (await request.get("/api/state")).json()).state
    .features[0];
  expect(saved.assigneeEstimates).toEqual([
    { personId: "p", unit: "days", value: 2.5 },
    { personId: "q", unit: "days", value: 2.5 },
  ]);
  await editFeature(page, "Shared days");
  await expect(
    page.getByLabel("Working days estimation", { exact: true }),
  ).toHaveValue("2.5");
  await pick(page, "Estimate method", "Per person");
  await page.getByLabel("Alex estimate", { exact: true }).fill("4");
  await pick(page, "Estimate method", "Same for everyone");
  await page.getByLabel("Working days estimation", { exact: true }).fill("6");
  await pick(page, "Estimate method", "Per person");
  await expect(page.getByLabel("Alex estimate", { exact: true })).toHaveValue(
    "6",
  );
  await expect(page.getByLabel("Sam estimate", { exact: true })).toHaveValue(
    "6",
  );
  await saveFeature(page);
  saved = (await (await request.get("/api/state")).json()).state.features[0];
  expect(
    saved.assigneeEstimates.every(
      (estimate: { value: number }) => estimate.value === 6,
    ),
  ).toBeTruthy();
});

test("person estimate validates amounts and retains selected person edits", async ({
  page,
}) => {
  await openFeature(page, "Validation");
  await pick(page, "Estimate method", "Per person");
  await page.getByLabel("Alex estimate", { exact: true }).fill("0");
  await page.getByRole("button", { name: "Save feature", exact: true }).click();
  await confirmSchedulingReview(page);
  await expect(page.getByRole("alert")).toContainText("0.5");
  await page.getByLabel("Alex estimate", { exact: true }).fill("0.5");
  await pick(page, "Sam estimate unit", "Working days");
  await page.getByLabel("Sam estimate", { exact: true }).fill("1001");
  await page.getByRole("button", { name: "Save feature", exact: true }).click();
  await confirmSchedulingReview(page);
  await expect(page.getByRole("alert")).toContainText("1000");
  await page.getByLabel("Sam estimate", { exact: true }).fill("0.25");
  await page.getByLabel("Main assignee: Sam", { exact: true }).uncheck();
  await expect(page.getByLabel("Sam estimate", { exact: true })).toHaveCount(0);
  await page
    .getByRole("button", { name: "Select all team", exact: true })
    .click();
  await expect(page.getByLabel("Sam estimate", { exact: true })).toHaveValue(
    "0.25",
  );
  await page.getByLabel("Sam estimate", { exact: true }).fill("");
  await page.getByRole("button", { name: "Save feature", exact: true }).click();
  await confirmSchedulingReview(page);
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("alert")).toBeVisible();
  await page.getByLabel("Sam estimate", { exact: true }).fill("0.25");
  await saveFeature(page);
});

for (const viewport of [
  { width: 375, height: 812 },
  { width: 744, height: 1133 },
]) {
  test(`person estimate rows fit ${viewport.width}px and controls remain usable`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await openFeature(page, "Responsive estimate");
    await pick(page, "Estimate method", "Per person");
    await pick(page, "Sam estimate unit", "Working days");
    await page.getByLabel("Sam estimate", { exact: true }).fill("3");
    const overflow = await page.evaluate(() => ({
      body: document.documentElement.scrollWidth - window.innerWidth,
      dialog: (() => {
        const el = document.querySelector('[role="dialog"]')!;
        return el.scrollWidth - el.clientWidth;
      })(),
    }));
    expect(overflow.body).toBeLessThanOrEqual(1);
    expect(overflow.dialog).toBeLessThanOrEqual(1);
    await saveFeature(page);
  });
}
