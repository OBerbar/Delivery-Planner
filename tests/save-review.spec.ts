import { test, expect } from "@playwright/test";
import { fixedToday, maintenanceFixture } from "../scripts/maintenance-fixture";

test.beforeEach(async ({ page, request }) => {
  await page.clock.install({ time: new Date(`${fixedToday}T10:00:00Z`) });
  const { revision } = await (await request.get("/api/state")).json();
  await request.put("/api/state", {
    data: { revision, state: maintenanceFixture() },
  });
  await page.goto("/");
});
test("delivery preview keeps leave draft and database untouched until confirmed", async ({
  page,
  request,
}) => {
  const original = await (await request.get("/api/state")).json();
  await page.getByRole("button", { name: /^Team & leave/ }).click();
  await page.getByRole("button", { name: "Add leave", exact: true }).click();
  await page.getByLabel("Leave starts", { exact: true }).fill("2030-01-14");
  await page.getByLabel("Leave ends", { exact: true }).fill("2030-01-18");
  await page
    .getByLabel("Leave note", { exact: true })
    .fill("Review before saving");
  await page.getByRole("button", { name: "Save leave", exact: true }).click();
  const review = page.getByRole("dialog", {
    name: "Review scheduling changes",
    exact: true,
  });
  await expect(review).toBeVisible();
  await expect(review).toContainText("Five sprint delivery");
  await expect(review).toContainText("Alex");
  await expect(review).toContainText("7 calendar days later");
  expect(await (await request.get("/api/state")).json()).toEqual(original);
  await review
    .getByRole("button", { name: "Keep editing", exact: true })
    .click();
  await expect(review).toHaveCount(0);
  await expect(page.getByLabel("Leave note", { exact: true })).toHaveValue(
    "Review before saving",
  );
  expect(await (await request.get("/api/state")).json()).toEqual(original);
  await page.getByRole("button", { name: "Save leave", exact: true }).click();
  await review
    .getByRole("button", { name: "Save changes", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const saved = await (await request.get("/api/state")).json();
  expect(saved.revision).toBe(original.revision + 1);
  expect(saved.state.leaves).toHaveLength(1);
  expect(saved.state.features).toEqual(original.state.features);
  expect(saved.state.sprints).toEqual(original.state.sprints);
});
test("Escape cancels review without losing the feature draft", async ({
  page,
  request,
}) => {
  const before = await (await request.get("/api/state")).json();
  await page.getByRole("button", { name: "Add feature", exact: true }).click();
  await page
    .getByLabel("Feature title", { exact: true })
    .fill("Competing scope");
  await page.getByLabel("Main assignee: Alex", { exact: true }).check();
  await page.getByRole("button", { name: "Save feature", exact: true }).click();
  await expect(
    page.getByRole("dialog", {
      name: "Review scheduling changes",
      exact: true,
    }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByLabel("Feature title", { exact: true })).toHaveValue(
    "Competing scope",
  );
  expect(await (await request.get("/api/state")).json()).toEqual(before);
});

test("an outdated server keeps the feature draft and blocks writes until retry on the current server", async ({
  page,
  request,
}) => {
  const before = await (await request.get("/api/state")).json();
  let writes = 0;
  page.on("request", (r) => {
    if (r.method() === "PUT" && r.url().endsWith("/api/state")) writes++;
  });
  await page.getByRole("button", { name: /^Features/ }).click();
  await page
    .getByRole("button", { name: "Edit Five sprint delivery", exact: true })
    .click();
  await page
    .getByLabel("Description", { exact: true })
    .fill("Draft survives outdated server");
  await page.route("**/api/health", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ status: "ok" }),
    }),
  );
  await page.getByRole("button", { name: "Save feature", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "Restart Delivery Studio",
  );
  await expect(page.getByLabel("Description", { exact: true })).toHaveValue(
    "Draft survives outdated server",
  );
  expect(writes).toBe(0);
  expect(await (await request.get("/api/state")).json()).toEqual(before);
  await page.unroute("**/api/health");
  await page.getByRole("button", { name: "Save feature", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(writes).toBe(1);
  expect(
    (await (await request.get("/api/state")).json()).state.features[0]
      .description,
  ).toBe("Draft survives outdated server");
});

test("parallel work previews reduced capacity with unchanged delivery dates before any save", async ({
  page,
  request,
}) => {
  const before = await (await request.get("/api/state")).json();
  await page.getByRole("button", { name: "Add feature", exact: true }).click();
  await page
    .getByLabel("Feature title", { exact: true })
    .fill("One parallel day");
  await page.getByLabel("Main assignee: Alex", { exact: true }).check();
  await page.getByRole("button", { name: /Estimate unit/ }).click();
  await page.getByRole("option", { name: "Working days", exact: true }).click();
  await page.getByLabel("Working days estimation", { exact: true }).fill("1");
  await page
    .getByRole("dialog")
    .locator("summary", { hasText: "Scheduling options" })
    .click();
  await page.getByLabel("Keep other delivery dates", { exact: true }).check();
  await page.getByRole("button", { name: "Save feature", exact: true }).click();
  const review = page.getByRole("dialog", {
    name: "Review scheduling changes",
    exact: true,
  });
  await expect(review).toBeVisible();
  await expect(review).toContainText("50 working days → 49 working days");
  await expect(review).toContainText("Alex");
  expect(await (await request.get("/api/state")).json()).toEqual(before);
  await review
    .getByRole("button", { name: "Keep editing", exact: true })
    .click();
  await expect(page.getByLabel("Feature title", { exact: true })).toHaveValue(
    "One parallel day",
  );
});
