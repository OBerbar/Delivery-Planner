import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { fixedToday, maintenanceFixture } from "../scripts/maintenance-fixture";
import { observeBrowser } from "../scripts/browser-observability";
const errors = new WeakMap<Page, string[]>();
const expectedFailures = new WeakSet<Page>();
test.beforeEach(async ({ page, request }) => {
  errors.set(page, observeBrowser(page));
  await page.clock.install({ time: new Date(`${fixedToday}T10:00:00Z`) });
  const { revision } = await (await request.get("/api/state")).json();
  await request.put("/api/state", {
    data: { revision, state: maintenanceFixture() },
  });
  await page.goto("/");
});
test.afterEach(async ({ page }) =>
  expect(
    (errors.get(page) ?? []).filter(
      (v) =>
        !expectedFailures.has(page) ||
        (!v.includes("HTTP 409:") &&
          !v.includes("HTTP 503:") &&
          !v.includes("server responded with a status of 409") &&
          !v.includes("server responded with a status of 503")),
    ),
  ).toEqual([]),
);
async function start(page: Page) {
  await page
    .getByRole("button", { name: "What-if planning", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "What-if experiment", exact: true }),
  ).toBeVisible();
}
async function addLeave(page: Page) {
  await page.getByRole("button", { name: /^Team & leave/ }).click();
  await page.getByRole("button", { name: "Add leave", exact: true }).click();
  await page.getByLabel("Leave starts", { exact: true }).fill("2030-01-14");
  await page.getByLabel("Leave ends", { exact: true }).fill("2030-01-18");
  await page
    .getByLabel("Leave note", { exact: true })
    .fill("Experimental week away");
  await page.getByRole("button", { name: "Save leave", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}
test("temporary feature and leave edits make no writes; Apply persists once and normal Undo restores base", async ({
  page,
  request,
}) => {
  const before = await (await request.get("/api/state")).json();
  let writes = 0;
  page.on("request", (r) => {
    if (r.method() === "PUT" && r.url().endsWith("/api/state")) writes++;
  });
  await start(page);
  await page.getByRole("button", { name: "Add feature", exact: true }).click();
  await page
    .getByLabel("Feature title", { exact: true })
    .fill("Experimental feature");
  await page.getByLabel("Main assignee: Alex", { exact: true }).check();
  await page.getByLabel("Sprint estimation", { exact: true }).fill("0.5");
  await page.getByRole("button", { name: "Save feature", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await addLeave(page);
  const banner = page.getByRole("region", {
    name: "What-if experiment",
    exact: true,
  });
  await banner.locator("summary").click();
  await expect(banner).toContainText("Experimental feature");
  await expect(banner).toContainText("Five sprint delivery");
  await expect(banner).toContainText("Alex");
  expect(writes).toBe(0);
  expect(await (await request.get("/api/state")).json()).toEqual(before);
  await page
    .getByRole("button", { name: "Apply experiment", exact: true })
    .click();
  await expect(banner).toHaveCount(0);
  expect(writes).toBe(1);
  const applied = await (await request.get("/api/state")).json();
  expect(applied.revision).toBe(before.revision + 1);
  expect(applied.state.features).toHaveLength(3);
  expect(applied.state.leaves).toHaveLength(1);
  expect(applied.state.sprints).toEqual(before.state.sprints);
  expect(
    applied.state.features.find((f: { id: string }) => f.id === "long"),
  ).toEqual({ ...before.state.features[0], priority: 1 });
  await page
    .getByRole("button", { name: "Undo last change", exact: true })
    .click();
  await expect(page.locator(".notice")).toContainText("undone");
  expect((await (await request.get("/api/state")).json()).state).toEqual(
    before.state,
  );
  await page.reload();
  await expect(
    page.getByRole("region", { name: "What-if experiment", exact: true }),
  ).toHaveCount(0);
});
test("local undo and Discard preserve database and refresh newer changes from another tab", async ({
  page,
  request,
}) => {
  const before = await (await request.get("/api/state")).json();
  await start(page);
  await addLeave(page);
  await page
    .getByRole("button", { name: "Undo last change", exact: true })
    .click();
  await expect(
    page.getByText("Full day · Experimental week away", { exact: true }),
  ).toHaveCount(0);
  expect(await (await request.get("/api/state")).json()).toEqual(before);
  await addLeave(page);
  const external = structuredClone(before.state);
  external.apps[0].name = "Updated in another tab";
  expect(
    (
      await request.put("/api/state", {
        data: { revision: before.revision, state: external },
      })
    ).ok(),
  ).toBe(true);
  await page
    .getByRole("button", { name: "Discard experiment", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "What-if experiment", exact: true }),
  ).toHaveCount(0);
  expect((await (await request.get("/api/state")).json()).state).toEqual(
    external,
  );
  await expect(page.locator(".app-switch")).toContainText(
    "Updated in another tab",
  );
});
test("failed Apply retains draft for retry and stale Apply cannot overwrite newer data", async ({
  page,
  request,
}) => {
  expectedFailures.add(page);
  await start(page);
  await addLeave(page);
  let attempts = 0;
  await page.route("**/api/state", async (route) => {
    if (route.request().method() === "PUT" && ++attempts === 1)
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Synthetic retry" }),
      });
    else await route.continue();
  });
  await page
    .getByRole("button", { name: "Apply experiment", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("Synthetic retry");
  await expect(
    page.getByText("Full day · Experimental week away", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Apply experiment", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "What-if experiment", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Timeline", exact: true }).click();
  await start(page);
  await addLeave(page);
  const external = await (await request.get("/api/state")).json();
  external.state.apps[0].name = "Concurrent";
  await request.put("/api/state", { data: external });
  await page
    .getByRole("button", { name: "Apply experiment", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("another tab");
  await expect(
    page.getByRole("region", { name: "What-if experiment", exact: true }),
  ).toBeVisible();
  expect(
    (await (await request.get("/api/state")).json()).state.apps[0].name,
  ).toBe("Concurrent");
  await page
    .getByRole("button", { name: "Discard experiment", exact: true })
    .click();
});
test("experiment protects historical actions, labels plan and timeline exports, and warns before reload", async ({
  page,
  request,
  context,
}) => {
  await start(page);
  await addLeave(page);
  await page.getByRole("button", { name: /^Features/ }).click();
  await expect(
    page.getByRole("button", {
      name: "Refresh app commitment dates",
      exact: true,
    }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Sprints & plans", exact: true })
    .click();
  await page.getByRole("tab", { name: "Sprint plan", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Save new snapshot", exact: true }),
  ).toBeDisabled();
  const downloaded = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export Markdown", exact: true })
    .click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toContain("what-if");
  const { readFile } = await import("node:fs/promises");
  expect(await readFile((await download.path())!, "utf8")).toContain("WHAT-IF");
  await page.getByRole("button", { name: "App settings", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Export full backup", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByLabel("Restore backup", { exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Timeline", exact: true }).click();
  await context.addInitScript(() => {
    window.print = () => undefined;
  });
  const popup = page.waitForEvent("popup");
  await page
    .getByRole("button", { name: "Export timeline PDF", exact: true })
    .click();
  const preview = await popup;
  await expect(preview.locator(".print-page").first()).toContainText("WHAT-IF");
  await preview.close();
  const saved = await (await request.get("/api/state")).json();
  const warning = page.waitForEvent("dialog");
  const reloading = page.reload();
  const dialog = await warning;
  expect(dialog.type()).toBe("beforeunload");
  await dialog.accept();
  await reloading;
  await expect(
    page.getByRole("region", { name: "What-if experiment", exact: true }),
  ).toHaveCount(0);
  expect(await (await request.get("/api/state")).json()).toEqual(saved);
});
for (const [width, height] of [
  [744, 1133],
  [1133, 744],
  [1920, 1080],
  [3840, 2160],
]) {
  test(`What-if comparison is keyboard accessible and fits at ${width}px @a11y`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await start(page);
    await addLeave(page);
    const banner = page.getByRole("region", {
      name: "What-if experiment",
      exact: true,
    });
    await banner.locator("summary").focus();
    await page.keyboard.press("Space");
    await expect(banner).toContainText("7 calendar days later");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBeLessThanOrEqual(1);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({
      path: test.info().outputPath("experiment.png"),
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Discard experiment", exact: true })
      .click();
    await expect(banner).toHaveCount(0);
  });
}

test("shared-person leave changes both apps inside one temporary workspace", async ({
  page,
  request,
}) => {
  const state = maintenanceFixture();
  state.apps.push({ ...state.apps[0], id: "second", name: "Second Studio" });
  state.members.push({ ...state.members[0], id: "shared", appId: "second" });
  state.features.push({
    ...state.features[0],
    id: "second-feature",
    appId: "second",
    title: "Shared person delivery",
    priority: 2,
    sprintId: undefined,
    committed: false,
    commitment: undefined,
  });
  const { revision } = await (await request.get("/api/state")).json();
  await request.put("/api/state", { data: { revision, state } });
  await page.reload();
  const before = await (await request.get("/api/state")).json();
  await start(page);
  await addLeave(page);
  const banner = page.getByRole("region", {
    name: "What-if experiment",
    exact: true,
  });
  await banner.locator("summary").click();
  await expect(banner).toContainText("Second Studio");
  await expect(banner).toContainText("Shared person delivery");
  await page.getByRole("button", { name: /Current app/ }).click();
  await page
    .getByRole("option", { name: "Second Studio", exact: true })
    .click();
  await expect(banner).toBeVisible();
  await page.getByRole("button", { name: /^Team & leave/ }).click();
  await expect(
    page.getByText("Full day · Experimental week away", { exact: true }),
  ).toBeVisible();
  expect(await (await request.get("/api/state")).json()).toEqual(before);
  await page
    .getByRole("button", { name: "Discard experiment", exact: true })
    .click();
  expect(await (await request.get("/api/state")).json()).toEqual(before);
});
