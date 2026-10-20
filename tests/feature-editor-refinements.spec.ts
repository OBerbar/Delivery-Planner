import { test, expect, type Page } from "@playwright/test";
import { fixedToday, maintenanceFixture } from "../scripts/maintenance-fixture";
import { observeBrowser } from "../scripts/browser-observability";

const issues = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page, request }) => {
  issues.set(page, observeBrowser(page));
  await page.clock.install({ time: new Date(`${fixedToday}T10:00:00Z`) });
  const { revision } = await (await request.get("/api/state")).json();
  expect(
    (
      await request.put("/api/state", {
        data: { revision, state: maintenanceFixture() },
      })
    ).ok(),
  ).toBe(true);
});
test.afterEach(async ({ page }) => expect(issues.get(page)).toEqual([]));

for (const [width, height] of [
  [744, 1133],
  [1133, 744],
  [1920, 1080],
]) {
  test(`feature editor keeps context and preserves disclosure drafts at ${width}px`, async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width, height });
    await page.goto("/");
    const before = await (await request.get("/api/state")).json();
    await page
      .getByRole("button", { name: "Add feature", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    const bounds = await dialog.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width + 1);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(height + 1);
    if (width >= 1133) {
      expect(bounds!.x).toBeGreaterThan(width * 0.3);
      expect(Math.abs(bounds!.x + bounds!.width - width)).toBeLessThanOrEqual(
        1,
      );
    }
    await expect(page.locator(".timeline-panel").first()).toBeVisible();
    await expect(
      dialog.getByLabel("Feature title", { exact: true }),
    ).toBeVisible();
    await expect(
      dialog.getByLabel("Main assignee: Alex", { exact: true }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: /Assigned sprint/ }),
    ).toBeVisible();
    await expect(
      dialog.getByLabel("Description", { exact: true }),
    ).toBeHidden();
    await expect(
      dialog.getByLabel("Keep other delivery dates", { exact: true }),
    ).toBeHidden();
    await expect(
      dialog.getByLabel("Accept delivery date", { exact: true }),
    ).toBeHidden();
    await dialog
      .locator("summary", { hasText: "Details & completion" })
      .click();
    await dialog
      .getByLabel("Description", { exact: true })
      .fill("Keep this unsaved scope");
    await dialog
      .locator("summary", { hasText: "Details & completion" })
      .click();
    await dialog
      .locator("summary", { hasText: "Details & completion" })
      .click();
    await expect(dialog.getByLabel("Description", { exact: true })).toHaveValue(
      "Keep this unsaved scope",
    );
    await dialog.locator("summary", { hasText: "Scheduling options" }).click();
    await dialog
      .getByLabel("Keep other delivery dates", { exact: true })
      .check();
    await dialog.getByLabel("Accept delivery date", { exact: true }).check();
    await dialog.locator("summary", { hasText: "Scheduling options" }).click();
    await dialog.locator("summary", { hasText: "Scheduling options" }).click();
    await expect(
      dialog.getByLabel("Keep other delivery dates", { exact: true }),
    ).toBeChecked();
    await expect(
      dialog.getByLabel("Accept delivery date", { exact: true }),
    ).toBeChecked();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Add feature", exact: true }),
    ).toBeFocused();
    expect(await (await request.get("/api/state")).json()).toEqual(before);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBeLessThanOrEqual(1);
  });
}

test("saved optional fields open automatically and invalid collapsed tasks reopen", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /^Features(?:\s|$)/ }).click();
  await page
    .getByRole("button", { name: "Edit Five sprint delivery", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Description", { exact: true })).toBeVisible();
  await expect(
    dialog.getByLabel("Completion conditions", { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByLabel("Accept delivery date", { exact: true }),
  ).toBeChecked();
  await dialog.locator("summary", { hasText: "Optional tasks" }).click();
  await dialog
    .getByLabel("Add optional task breakdown", { exact: true })
    .check();
  await dialog
    .getByLabel("Task 1 title", { exact: true })
    .fill("Draft task retained");
  await dialog.getByLabel("Task 1 remaining days", { exact: true }).fill("0");
  await dialog.locator("summary", { hasText: "Optional tasks" }).click();
  await dialog
    .getByRole("button", { name: "Save feature", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(
    dialog.getByLabel("Task 1 remaining days", { exact: true }),
  ).toBeVisible();
  await expect(dialog.getByLabel("Task 1 title", { exact: true })).toHaveValue(
    "Draft task retained",
  );
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
});

test("editor close controls and keyboard disclosure preserve modal focus", async ({
  page,
}) => {
  await page.goto("/");
  const trigger = page.getByRole("button", {
    name: "Add feature",
    exact: true,
  });
  await trigger.click();
  const dialog = page.getByRole("dialog");
  const summary = dialog.locator("summary", {
    hasText: "Details & completion",
  });
  await summary.focus();
  await page.keyboard.press("Space");
  await expect(dialog.getByLabel("Description", { exact: true })).toBeVisible();
  await page.keyboard.press("Space");
  await expect(dialog.getByLabel("Description", { exact: true })).toBeHidden();
  await dialog
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.mouse.click(8, 8);
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});
