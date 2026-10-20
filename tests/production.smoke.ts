import {
  confirmSchedulingReview,
  openFeatureSection,
} from "./helpers/ui-workflows";
import { test, expect, type Page } from "@playwright/test";
import { observeBrowser } from "../scripts/browser-observability";
import { populatedFixture, fixedToday } from "../scripts/maintenance-fixture";
const browserIssues = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  browserIssues.set(page, observeBrowser(page));
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

test("built application round trips leave metadata, person estimates, templates and commitment dates", async ({
  page,
  request,
}) => {
  await page.clock.install({ time: new Date(`${fixedToday}T10:00:00Z`) });
  const { revision } = await (await request.get("/api/state")).json();
  const state = populatedFixture();
  const write = await request.put("/api/state", { data: { revision, state } });
  expect(write.ok(), await write.text()).toBeTruthy();
  expect((await (await request.get("/api/state")).json()).state).toEqual(state);
  const document = await request.get("/");
  expect(document.ok()).toBeTruthy();
  expect(await document.text()).toMatch(/\/assets\/[^"']+\.js/);
  await page.goto("/");
  await page.getByRole("button", { name: /^Team & leave/ }).click();
  await page
    .getByRole("button", {
      name: "Edit leave for Sam, 2030-01-09 to 2030-01-10",
      exact: true,
    })
    .click();
  await page
    .getByLabel("Leave note", { exact: true })
    .fill("Built UI saved leave");
  await page.getByRole("button", { name: "Save leave", exact: true }).click();
  await confirmSchedulingReview(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.reload();
  await page.getByRole("button", { name: /^Team & leave/ }).click();
  await expect(page.getByText(/Built UI saved leave/)).toBeVisible();
  const saved = (await (await request.get("/api/state")).json()).state;
  expect(saved.leaves[0]).toEqual({
    ...state.leaves[0],
    note: "Built UI saved leave",
  });
  expect(saved.calendarTemplates).toEqual(state.calendarTemplates);
  expect(saved.features).toEqual(state.features);
  await page.getByRole("button", { name: /^Features / }).click();
  await page
    .getByRole("button", { name: "Edit Mixed person estimates", exact: true })
    .click();
  await expect(page.getByLabel("Alex estimate", { exact: true })).toHaveValue(
    "1",
  );
  await expect(page.getByLabel("Sam estimate", { exact: true })).toHaveValue(
    "3",
  );
  await page.getByLabel("Sam estimate", { exact: true }).fill("4");
  await openFeatureSection(page, "Scheduling options");
  await expect(
    page.getByLabel("Keep other delivery dates", { exact: true }),
  ).not.toBeChecked();
  await openFeatureSection(page, "Scheduling options");
  await page.getByLabel("Keep other delivery dates", { exact: true }).check();
  await page.getByRole("button", { name: "Save feature", exact: true }).click();
  await confirmSchedulingReview(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.reload();
  const reloaded = (await (await request.get("/api/state")).json()).state;
  expect(
    reloaded.features.find((f: { id: string }) => f.id === "mixed")
      .assigneeEstimates,
  ).toEqual([
    { personId: "p", unit: "sprints", value: 1 },
    { personId: "q", unit: "days", value: 4 },
  ]);
  expect(
    reloaded.features.find((f: { id: string }) => f.id === "long").commitment,
  ).toEqual(state.features[0].commitment);
  expect(
    reloaded.features.find((f: { id: string }) => f.id === "mixed")
      .doesntAffectOtherWork,
  ).toBe(true);
  expect(reloaded.calendarTemplates).toEqual(state.calendarTemplates);
  expect(reloaded.leaves[0].templateEntryId).toBe("entry");
});
