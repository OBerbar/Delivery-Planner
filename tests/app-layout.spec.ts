import { confirmSchedulingReview } from "./helpers/ui-workflows";
import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { populatedFixture, fixedToday } from "../scripts/maintenance-fixture";
import { observeBrowser } from "../scripts/browser-observability";

const issues = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page, request }) => {
  issues.set(page, observeBrowser(page));
  await page.clock.install({ time: new Date(`${fixedToday}T12:00:00Z`) });
  const { revision } = await (await request.get("/api/state")).json();
  expect(
    (
      await request.put("/api/state", {
        data: { revision, state: populatedFixture() },
      })
    ).ok(),
  ).toBeTruthy();
});
test.afterEach(async ({ page }) => expect(issues.get(page)).toEqual([]));

for (const [width, height] of [
  [744, 1133],
  [1133, 744],
  [1920, 1080],
  [3840, 2160],
]) {
  test(`all screens omit the top bar and Timeline has no summary cards at ${width}px`, async ({
    page,
    request,
  }, testInfo) => {
    await page.setViewportSize({ width, height });
    await page.goto("/");
    const before = await (await request.get("/api/state")).json();
    for (const view of [
      "Timeline",
      "Features",
      "Team & leave",
      "Sprints & plans",
      "App settings",
      "All apps overview",
    ]) {
      await page
        .getByRole("button", { name: new RegExp(`^${view}(?:\\s|$)`) })
        .click();
      await expect(page.locator(".topbar, .breadcrumbs")).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "Backup", exact: true }),
      ).toHaveCount(0);
      await expect(page.locator(".stats-grid, .stat-card")).toHaveCount(0);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(
        page
          .locator("aside")
          .getByRole("button", { name: "Undo last change", exact: true }),
      ).toBeVisible();
      const main = (await page.locator(".main-area").boundingBox())!;
      const content = (await page.locator(".page-content").boundingBox())!;
      expect(content.y).toBeCloseTo(main.y, 0);
      expect(content.x).toBeCloseTo(main.x, 0);
      expect(content.width).toBeCloseTo(main.width, 0);
      expect(main.x + main.width).toBeCloseTo(
        await page.evaluate(() => document.documentElement.clientWidth),
        0,
      );
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - innerWidth,
        ),
      ).toBeLessThanOrEqual(1);
      if (["Timeline", "Team & leave", "Sprints & plans"].includes(view)) {
        await page.screenshot({
          path: testInfo.outputPath(
            `${view === "Timeline" ? "timeline" : view === "Team & leave" ? "team" : "sprints"}.png`,
          ),
          fullPage: true,
          animations: "disabled",
        });
      }
    }
    expect(await (await request.get("/api/state")).json()).toEqual(before);
  });
}

test("navigation Undo works from another screen and Settings exports the complete backup", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 744, height: 1133 });
  await page.goto("/");
  const undo = page
    .locator("aside")
    .getByRole("button", { name: "Undo last change", exact: true });
  await expect(undo).toBeDisabled();
  await page.getByRole("button", { name: "App settings", exact: true }).click();
  await page.getByLabel("App name", { exact: true }).fill("Updated Studio");
  await page
    .getByRole("button", { name: "Save settings", exact: true })
    .click();
  await confirmSchedulingReview(page);
  await expect(page.locator(".app-switch")).toContainText("Updated Studio");
  await page.getByRole("button", { name: "Timeline", exact: true }).click();
  await undo.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".app-switch")).toContainText("Maintenance Studio");
  await expect(undo).toBeDisabled();
  const target = (await undo.boundingBox())!;
  expect(target.height).toBeGreaterThanOrEqual(44);
  expect(target.width).toBeGreaterThanOrEqual(44);
  await page.getByRole("button", { name: "App settings", exact: true }).click();
  const downloaded = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export full backup", exact: true })
    .click();
  const backup = JSON.parse(
    await readFile((await (await downloaded).path())!, "utf8"),
  );
  expect(backup).toEqual(
    (await (await request.get("/api/state")).json()).state,
  );
  expect(backup).toEqual(populatedFixture());
});
