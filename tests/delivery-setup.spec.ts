import { test, expect, type Page } from "@playwright/test";
import { emptyState } from "../src/lib/model";

test.beforeEach(async ({ request }) => {
  const { revision } = await (await request.get("/api/state")).json();
  expect(
    (
      await request.put("/api/state", { data: { revision, state: emptyState } })
    ).ok(),
  ).toBeTruthy();
});
async function reachCalendar(page: Page) {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Use example team", exact: true })
    .click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
}

test("default delivery setup skips sprint configuration and saves a working-day feature", async ({
  page,
  request,
}) => {
  await reachCalendar(page);
  await expect(
    page.getByLabel("Plan in sprints", { exact: true }),
  ).not.toBeChecked();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Open my planner", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Default sprint length", { exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".review-card")).toContainText("Feature timeline");
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(
    page.getByLabel("Planning starts", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page
    .getByRole("button", { name: "Open my planner", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Delivery Studio logo", exact: true }),
  ).toBeVisible();
  await expect(page).toHaveTitle(/Delivery Studio/);
  await page.getByRole("button", { name: "Add feature", exact: true }).click();
  await expect(
    page.getByLabel("Working days estimation", { exact: true }),
  ).toHaveValue("1");
  await expect(page.getByLabel("Assigned sprint", { exact: true })).toHaveCount(
    0,
  );
  await page.getByLabel("Feature title", { exact: true }).fill("Checkout");
  await page.getByLabel("Main assignee: Alex Morgan", { exact: true }).check();
  await page.getByLabel("Working days estimation", { exact: true }).fill("3");
  await page.getByRole("button", { name: "Save feature", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.reload();
  const { state } = await (await request.get("/api/state")).json();
  expect(state.sprints).toEqual([]);
  expect(state.features[0].sprintId).toBeUndefined();
  expect(state.features[0].assigneeEstimates[0]).toMatchObject({
    unit: "days",
    value: 3,
  });
  expect(state.features[0].estimateEffort[0].hours).toBe(24);
});

test("sprint setup is an explicit option and retains cadence drafts when switched off", async ({
  page,
  request,
}) => {
  await reachCalendar(page);
  await page.getByLabel("Plan in sprints", { exact: true }).check();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: /Default sprint length/ }).click();
  await page.getByRole("option", { name: "3 weeks", exact: true }).click();
  await page.getByLabel("First sprint number", { exact: true }).fill("7");
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByLabel("Plan in sprints", { exact: true }).uncheck();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.locator(".review-card")).toContainText("Feature timeline");
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByLabel("Plan in sprints", { exact: true }).check();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(
    page.getByLabel("First sprint number", { exact: true }),
  ).toHaveValue("7");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page
    .getByRole("button", { name: "Open my planner", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Timeline", exact: true }),
  ).toBeVisible();
  const { state } = await (await request.get("/api/state")).json();
  expect(state.sprints).toHaveLength(1);
  expect(state.sprints[0].number).toBe(7);
  expect(state.apps[0].cadence).toBe("3w");
});
