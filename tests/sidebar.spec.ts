import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { populatedFixture, fixedToday } from "../scripts/maintenance-fixture";
import { observeBrowser } from "../scripts/browser-observability";

const issues = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page, request }) => {
  issues.set(page, observeBrowser(page));
  const time = new Date(`${fixedToday}T12:00:00Z`);
  // install starts a running clock; pausing at that same instant races elapsed
  // time under browser load. Advance an empty page to the intended fixed time.
  await page.clock.install({ time: new Date(time.getTime() - 60 * 60 * 1000) });
  await page.clock.pauseAt(time);
  await page.mouse.move(700, 500);
  const state = populatedFixture();
  state.apps.push({ ...state.apps[0], id: "second", name: "Second Studio" });
  const { revision } = await (await request.get("/api/state")).json();
  expect(
    (await request.put("/api/state", { data: { revision, state } })).ok(),
  ).toBeTruthy();
});
test.afterEach(async ({ page }) => expect(issues.get(page)).toEqual([]));

test("navigation starts expanded, collapses after three idle seconds and reopens explicitly", async ({
  page,
  request,
}) => {
  await page.goto("/");
  const before = await (await request.get("/api/state")).json();
  const collapse = page.getByRole("button", {
    name: "Collapse navigation",
    exact: true,
  });
  await expect(collapse).toBeVisible();
  await expect(collapse).toHaveAttribute("aria-expanded", "true");
  await page.clock.runFor(2999);
  await expect(collapse).toBeVisible();
  await page.clock.runFor(1);
  const expand = page.getByRole("button", {
    name: "Expand navigation",
    exact: true,
  });
  await expect(expand).toBeVisible();
  await expect(expand).toHaveAttribute("aria-expanded", "false");
  await expand.focus();
  await page.keyboard.press("Enter");
  await expect(collapse).toBeVisible();
  await collapse.click();
  await expect(expand).toBeVisible();
  expect(await (await request.get("/api/state")).json()).toEqual(before);
});

test("pointer and keyboard focus protect navigation until interaction leaves", async ({
  page,
}) => {
  await page.goto("/");
  const collapse = page.getByRole("button", {
    name: "Collapse navigation",
    exact: true,
  });
  await page.locator("aside").hover();
  await page.clock.runFor(4000);
  await expect(collapse).toBeVisible();
  await page.mouse.move(700, 500);
  await page.clock.runFor(2999);
  await expect(collapse).toBeVisible();
  await page.clock.runFor(1);
  const expand = page.getByRole("button", {
    name: "Expand navigation",
    exact: true,
  });
  await expand.focus();
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Timeline", exact: true }).focus();
  await page.clock.runFor(4000);
  await expect(collapse).toBeVisible();
  await page.getByRole("heading", { level: 1 }).click();
  await page.mouse.move(700, 500);
  await page.clock.runFor(3000);
  await expect(expand).toBeVisible();
});

test("collapsed app picker stays open while choosing and updates the current app", async ({
  page,
  request,
}) => {
  await page.goto("/");
  const before = await (await request.get("/api/state")).json();
  await page.getByRole("button", { name: /Current app/ }).click();
  await page
    .getByRole("option", { name: "Second Studio", exact: true })
    .hover();
  await page.clock.runFor(4000);
  await expect(
    page.getByRole("button", { name: "Collapse navigation", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.clock.runFor(300);
  await expect(page.locator(".sidebar-app-popover")).toHaveCount(0);
  // FocusScope restores the trigger on a frame after the closing portal unmounts.
  await page.clock.runFor(32);
  await expect(page.getByRole("button", { name: /Current app/ })).toBeFocused();
  await page.getByRole("heading", { level: 1 }).click();
  await page.mouse.move(700, 500);
  await page.clock.runFor(3000);
  const expand = page.getByRole("button", {
    name: "Expand navigation",
    exact: true,
  });
  await expect(expand).toBeVisible();
  await page.getByRole("button", { name: /Current app/ }).click();
  await page
    .getByRole("option", { name: "Second Studio", exact: true })
    .hover();
  await page.clock.runFor(4000);
  await expect(
    page.getByRole("option", { name: "Second Studio", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("option", { name: "Second Studio", exact: true })
    .click();
  await expect(page.locator(".app-switch")).toContainText("Second Studio");
  await page.getByRole("button", { name: "App settings", exact: true }).click();
  await expect(page.getByLabel("App name", { exact: true })).toHaveValue(
    "Second Studio",
  );
  expect(await (await request.get("/api/state")).json()).toEqual(before);
});

for (const [width, height] of [
  [744, 1133],
  [1133, 744],
  [1920, 1080],
  [3840, 2160],
]) {
  test(`icon navigation remains usable with no page overflow at ${width}px @a11y`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height });
    await page.goto("/");
    await expect(
      page.getByRole("button", { name: "Collapse navigation", exact: true }),
    ).toBeVisible();
    const expanded = (await page.locator("aside").boundingBox())!;
    await page.clock.runFor(3000);
    await expect(
      page.getByRole("button", { name: "Expand navigation", exact: true }),
    ).toBeVisible();
    const collapsed = (await page.locator("aside").boundingBox())!;
    expect(collapsed.width).toBeLessThan(expanded.width);
    expect(collapsed.width).toBeGreaterThanOrEqual(60);
    for (const name of [
      "Features 2",
      "Team & leave 2",
      "Sprints & plans",
      "App settings",
      "All apps overview",
      "Timeline",
    ]) {
      const target = page.getByRole("button", { name, exact: true });
      await expect(target).toBeVisible();
      await expect(target).toHaveAttribute("title", name);
      const box = (await target.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
      await target.click();
      await expect(target).toHaveAttribute("aria-current", "page");
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - innerWidth,
        ),
      ).toBeLessThanOrEqual(1);
      expect(
        (await page.locator(".page-content").boundingBox())!.width,
      ).toBeCloseTo((await page.locator(".main-area").boundingBox())!.width, 0);
    }
    await expect(
      page
        .locator("aside")
        .getByRole("button", { name: "Undo last change", exact: true }),
    ).toBeDisabled();
    await expect(
      page
        .locator("aside")
        .getByRole("button", { name: "Add an app", exact: true }),
    ).toBeVisible();
    await page.clock.resume();
    expect(
      (await new AxeBuilder({ page }).include("aside").analyze()).violations,
    ).toEqual([]);
    await page.screenshot({
      path: testInfo.outputPath("collapsed-navigation.png"),
      fullPage: true,
      animations: "disabled",
    });
    await page.getByRole("button", { name: "Add an app", exact: true }).click();
    await expect(page.getByLabel("App name", { exact: true })).toBeVisible();
  });
}
