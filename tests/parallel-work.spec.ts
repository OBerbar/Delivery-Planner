import {
  openFeatureSection,
  confirmSchedulingReview,
} from "./helpers/ui-workflows";
import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
import { populatedFixture, fixedToday } from "../scripts/maintenance-fixture";
import { observeBrowser } from "../scripts/browser-observability";
import { schedule } from "../src/lib/planning";
import { reservationId, type PlannerState } from "../src/lib/model";

const label = "Keep other delivery dates",
  issues = new WeakMap<Page, string[]>();
async function read(request: APIRequestContext) {
  return (await (await request.get("/api/state")).json()).state as PlannerState;
}
async function createDraft(page: Page) {
  await page.getByRole("button", { name: "Add feature", exact: true }).click();
  await openFeatureSection(page, "Scheduling options");
  await expect(page.getByLabel(label, { exact: true })).not.toBeChecked();
  await page
    .getByLabel("Feature title", { exact: true })
    .fill("One-day parallel feature");
  await page.getByRole("button", { name: /Estimate unit/ }).click();
  await page.getByRole("option", { name: "Working days", exact: true }).click();
  await page.getByLabel("Working days estimation", { exact: true }).fill("1");
  await page.getByLabel("Main assignee: Alex", { exact: true }).check();
  await page.getByRole("button", { name: /Assigned sprint/ }).click();
  await page.getByRole("option", { name: /Sprint 1/ }).click();
  await page.getByLabel(label, { exact: true }).focus();
  await page.keyboard.press("Space");
  await expect(page.getByLabel(label, { exact: true })).toBeChecked();
}
async function save(page: Page) {
  await page.getByRole("button", { name: "Save feature", exact: true }).click();
  await confirmSchedulingReview(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
}
async function edit(page: Page) {
  await page.getByRole("button", { name: /^Features(?:\s|$)/ }).click();
  await page
    .getByRole("button", { name: "Edit One-day parallel feature", exact: true })
    .click();
}
function allocation(state: PlannerState) {
  const result = schedule(state, fixedToday);
  return {
    end: result.features.original.end,
    booked: result.tasks[reservationId("original", "p")].days.reduce(
      (n, d) => n + d.hours,
      0,
    ),
  };
}
test.beforeEach(async ({ page, request }) => {
  issues.set(page, observeBrowser(page));
  await page.clock.install({ time: new Date(`${fixedToday}T10:00:00Z`) });
  const state = populatedFixture();
  state.apps[0].weekends = [5, 6];
  state.apps[0].planningStart = fixedToday;
  state.sprints[0].start = fixedToday;
  state.leaves = [];
  state.holidays = [];
  state.features = [
    {
      ...state.features[0],
      id: "original",
      title: "Five-day delivery",
      priority: 0,
      tasks: [],
      sprintEstimate: undefined,
      assigneeIds: ["p"],
      assigneeEstimates: [{ personId: "p", unit: "days", value: 5 }],
      estimateEffort: [{ personId: "p", hours: 40 }],
      commitment: { end: "2030-01-10", acceptedAt: fixedToday },
    },
  ];
  const { revision } = await (await request.get("/api/state")).json();
  expect(
    (await request.put("/api/state", { data: { revision, state } })).ok(),
  ).toBe(true);
});
test.afterEach(async ({ page }) => expect(issues.get(page)).toEqual([]));
for (const [width, height] of [
  [744, 1133],
  [1133, 744],
  [1920, 1080],
  [3840, 2160],
]) {
  test(`parallel work create edit cancel reload undo and capacity accounting at ${width}px`, async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width, height });
    await page.goto("/");
    const before = await read(request);
    await createDraft(page);
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    expect(await read(request)).toEqual(before);
    await createDraft(page);
    await save(page);
    let state = await read(request);
    expect(state.features[0]).toHaveProperty("doesntAffectOtherWork", true);
    expect(allocation(state)).toEqual({ end: "2030-01-10", booked: 32 });
    expect(
      state.features.find((f) => f.id === "original")!.estimateEffort,
    ).toEqual([{ personId: "p", hours: 40 }]);
    expect(state.sprints[0].snapshot).toBe(before.sprints[0].snapshot);
    await edit(page);
    await expect(page.getByLabel(label, { exact: true })).toBeChecked();
    await page.getByLabel(label, { exact: true }).uncheck();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(
      page.getByText(/4 working days allocated/).first(),
    ).toBeVisible();
    expect((await read(request)).features[0]).toHaveProperty(
      "doesntAffectOtherWork",
      true,
    );
    await edit(page);
    await page.getByLabel(label, { exact: true }).uncheck();
    await save(page);
    expect(allocation(await read(request))).toEqual({
      end: "2030-01-13",
      booked: 40,
    });
    await page
      .getByRole("button", { name: "Undo last change", exact: true })
      .click();
    await expect
      .poll(async () => allocation(await read(request)))
      .toEqual({ end: "2030-01-10", booked: 32 });
    await page.reload();
    await edit(page);
    await expect(page.getByLabel(label, { exact: true })).toBeChecked();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page
      .getByRole("button", { name: "Sprints & plans", exact: true })
      .click();
    await expect(
      page.getByRole("columnheader", { name: "Reassigned", exact: true }),
    ).toBeVisible();
    await expect(
      page.locator(".resource-table tbody tr").first(),
    ).toContainText("1 working day");
    await page
      .getByRole("button", { name: "Generate sprint plan", exact: true })
      .click();
    await expect(
      page.getByText(/1 working day capacity reassigned/).first(),
    ).toBeVisible();
    state = await read(request);
    expect(state.sprints[0].snapshot).toBe(before.sprints[0].snapshot);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBeLessThanOrEqual(1);
  });
}
test("failed and pending feature saves retain the checked draft and prevent duplicate submissions", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await createDraft(page);
  const before = await read(request);
  let calls = 0,
    release = () => {};
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/state", async (route) => {
    if (route.request().method() !== "PUT") return route.continue();
    calls++;
    if (calls === 1)
      return route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Synthetic save failed; retry" }),
      });
    await pending;
    await route.continue();
  });
  try {
    await page
      .getByRole("button", { name: "Save feature", exact: true })
      .click();
    await confirmSchedulingReview(page);
    await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
      "Synthetic save failed",
    );
    await expect(page.getByLabel(label, { exact: true })).toBeChecked();
    const observed = issues.get(page)!;
    expect(
      observed.some((message) =>
        /^HTTP 503: PUT .*\/api\/state$/.test(message),
      ),
    ).toBe(true);
    issues.set(
      page,
      observed.filter(
        (message) =>
          !/^HTTP 503: PUT .*\/api\/state$/.test(message) &&
          !/^Console error: Failed to load resource: the server responded with a status of 503/.test(
            message,
          ),
      ),
    );
    expect(await read(request)).toEqual(before);
    await page
      .getByRole("button", { name: "Save feature", exact: true })
      .click();
    await confirmSchedulingReview(page);
    await expect(
      page.getByRole("button", { name: "Save feature", exact: true }),
    ).toBeDisabled();
    await expect(page.getByLabel(label, { exact: true })).toBeDisabled();
    expect(calls).toBe(2);
    release();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(allocation(await read(request))).toEqual({
      end: "2030-01-10",
      booked: 32,
    });
    expect(calls).toBe(2);
  } finally {
    release();
  }
});
