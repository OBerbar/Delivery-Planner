import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { maintenanceFixture } from "../scripts/maintenance-fixture";
import { observeBrowser } from "../scripts/browser-observability";
import { schedule } from "../src/lib/planning";

const issues = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page, request }) => {
  issues.set(page, observeBrowser(page));
  await page.clock.install({ time: new Date("2030-01-07T12:00:00Z") });
  const state = maintenanceFixture();
  state.features[0].title = "Blocked example";
  delete state.features[0].estimateEffort;
  state.features[0].tasks = [
    {
      id: "first",
      title: "First task",
      personId: "p",
      scope: "Backend",
      hours: 8,
      status: "todo",
      dependsOn: [],
    },
    {
      id: "second",
      title: "Second task",
      personId: "p",
      scope: "Backend",
      hours: 8,
      status: "todo",
      dependsOn: ["first"],
    },
  ];
  const { revision } = await (await request.get("/api/state")).json();
  expect(
    (await request.put("/api/state", { data: { state, revision } })).ok(),
  ).toBe(true);
  await page.goto("/");
});
test.afterEach(async ({ page }) => expect(issues.get(page)).toEqual([]));

const featureBar = (page: Page) =>
  page.locator('.timeline-bar[data-feature-id="long"]:not(.task-bar)');
async function edit(page: Page) {
  await featureBar(page).first().click();
  return page.getByRole("dialog", { name: "Edit feature", exact: true });
}

test("estimate-only features retain scope and accepted dates, and PDF shows the blocker in both views", async ({
  page,
  context,
  request,
}) => {
  const state = maintenanceFixture();
  state.features[0].title = "Blocked example";
  const { revision } = await (await request.get("/api/state")).json();
  expect(
    (await request.put("/api/state", { data: { state, revision } })).ok(),
  ).toBe(true);
  await page.reload();
  const before = await (await request.get("/api/state")).json();
  const dialog = await edit(page);
  await dialog
    .getByRole("checkbox", { name: "Feature blocked", exact: true })
    .check();
  await dialog
    .getByRole("button", { name: "Save feature", exact: true })
    .click();
  await expect(featureBar(page)).toContainText("Blocked");
  const saved = await (await request.get("/api/state")).json();
  expect(saved.state).toEqual({
    ...before.state,
    features: before.state.features.map((feature: { id: string }) =>
      feature.id === "long" ? { ...feature, blocked: true } : feature,
    ),
  });
  await context.addInitScript(() => {
    window.print = () => {};
  });
  const popup = page.waitForEvent("popup");
  await page
    .getByRole("button", { name: "Export timeline PDF", exact: true })
    .click();
  const preview = await popup;
  await preview.waitForLoadState("domcontentloaded");
  for (const view of ["By feature timeline", "By person timeline"]) {
    const svg = preview.getByRole("img", { name: view, exact: true });
    const bar = svg.locator('g[data-feature-id="long"]');
    await expect(bar.locator("title")).toContainText("Blocked");
    await expect(bar.locator("rect").first()).toHaveAttribute(
      "fill",
      "#ad3045",
    );
  }
  expect(await (await request.get("/api/state")).json()).toEqual(saved);
  await preview.close();
});

test("saves blocked across reload, filters and both timeline views while retaining forecasts and tasks", async ({
  page,
  request,
}) => {
  const before = await (await request.get("/api/state")).json();
  const dialog = await edit(page);
  const toggle = dialog.getByRole("checkbox", {
    name: "Feature blocked",
    exact: true,
  });
  await expect(toggle).not.toBeChecked();
  await toggle.focus();
  await page.keyboard.press("Space");
  await expect(toggle).toBeChecked();
  await dialog
    .getByRole("button", { name: "Save feature", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(featureBar(page)).toContainText("Blocked");
  await expect(featureBar(page)).toHaveCSS(
    "background-color",
    "rgb(173, 48, 69)",
  );
  const saved = await (await request.get("/api/state")).json();
  expect(saved.revision).toBe(before.revision + 1);
  expect(saved.state.features[0].blocked).toBe(true);
  expect(schedule(saved.state, "2030-01-07")).toEqual(
    schedule(before.state, "2030-01-07"),
  );
  expect(saved.state.sprints).toEqual(before.state.sprints);
  expect(saved.state.features[0].tasks).toEqual(before.state.features[0].tasks);
  expect(saved.state.features[0].estimateEffort).toEqual(
    before.state.features[0].estimateEffort,
  );
  expect(saved.state.features[0].commitment).toEqual(
    before.state.features[0].commitment,
  );
  await page
    .getByRole("button", { name: "Expand Blocked example", exact: true })
    .click();
  await expect(page.locator(".task-bar").first()).not.toContainText("Blocked");
  await page.getByRole("button", { name: /Filter by status/ }).click();
  await page.getByRole("option", { name: "Blocked", exact: true }).click();
  await expect(page.locator(".timeline-bar:not(.task-bar)")).toHaveCount(1);
  await page.reload();
  await expect(
    page.getByRole("button", { name: /Filter by status/ }),
  ).toContainText("Blocked");
  await expect(featureBar(page)).toContainText("Blocked");
  await page.getByRole("button", { name: "By person", exact: true }).click();
  await expect(featureBar(page).first()).toContainText("Blocked");
  await expect(featureBar(page).first()).toHaveCSS(
    "background-color",
    "rgb(173, 48, 69)",
  );
  await page.getByRole("button", { name: /^Features(?:\s|$)/ }).click();
  const badge = page
    .locator(".feature-item", { hasText: "Blocked example" })
    .locator(".status-pill");
  await expect(badge).toHaveText("Blocked");
  await expect(badge).toHaveCSS("color", "rgb(173, 48, 69)");
});

test("Cancel and Escape discard toggles, clearing restores automatic status, and Undo reverses it", async ({
  page,
  request,
}) => {
  const before = await (await request.get("/api/state")).json();
  for (const action of ["Cancel", "Escape"]) {
    const dialog = await edit(page);
    await dialog
      .getByRole("checkbox", { name: "Feature blocked", exact: true })
      .check();
    if (action === "Escape") await page.keyboard.press("Escape");
    else
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    expect(await (await request.get("/api/state")).json()).toEqual(before);
  }
  let dialog = await edit(page);
  await dialog
    .getByRole("checkbox", { name: "Feature blocked", exact: true })
    .check();
  await dialog
    .getByRole("button", { name: "Save feature", exact: true })
    .click();
  await expect(featureBar(page)).toContainText("Blocked");
  await page.clock.setSystemTime(new Date("2030-03-05T12:00:00Z"));
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(featureBar(page)).toContainText("Blocked");
  dialog = await edit(page);
  await dialog
    .getByRole("checkbox", { name: "Feature blocked", exact: true })
    .uncheck();
  await dialog
    .getByRole("button", { name: "Save feature", exact: true })
    .click();
  await expect(featureBar(page)).toContainText("Done");
  await page
    .getByRole("button", { name: "Undo last change", exact: true })
    .click();
  await expect(featureBar(page)).toContainText("Blocked");
});

for (const [label, width, height] of [
  ["desktop", 1440, 1000],
  ["iPad portrait", 744, 1133],
  ["iPad landscape", 1133, 744],
] as const) {
  test(`${label}: toggle focus, validation recovery and blocked colors remain usable @a11y`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    const dialog = await edit(page);
    const toggle = dialog.getByRole("checkbox", {
      name: "Feature blocked",
      exact: true,
    });
    await toggle.focus();
    await expect(toggle).toBeFocused();
    await page.keyboard.press("Space");
    await expect(toggle).toBeChecked();
    await dialog.getByLabel("Feature title", { exact: true }).fill("");
    await dialog
      .getByRole("button", { name: "Save feature", exact: true })
      .click();
    await expect(dialog).toBeVisible();
    await expect(toggle).toBeChecked();
    await dialog
      .getByLabel("Feature title", { exact: true })
      .fill("Blocked example");
    expect(
      (await new AxeBuilder({ page }).include('[role="dialog"]').analyze())
        .violations,
    ).toEqual([]);
    await page.screenshot({
      path: `test-results/feature-blocked-${width}x${height}-editor.png`,
    });
    await dialog
      .getByRole("button", { name: "Save feature", exact: true })
      .click();
    await expect(featureBar(page)).toContainText("Blocked");
    await expect(page.locator(".legend-blocked")).toBeVisible();
    await expect(page.locator("[data-entering], [data-exiting]")).toHaveCount(
      0,
    );
    // React Aria retains validation announcements for seven seconds. Let them
    // finish before scanning the saved page after its editor has been removed.
    await page.clock.fastForward(8000);
    await expect(
      page.locator('[data-live-announcer] [role="img"]'),
    ).toHaveCount(0, { timeout: 10000 });
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({
      path: `test-results/feature-blocked-${width}x${height}-timeline.png`,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
}
