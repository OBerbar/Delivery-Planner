import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { delayFixture, fixedToday } from "../scripts/delay-fixture";
import { observeBrowser } from "../scripts/browser-observability";
const issues = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page, request }) => {
  issues.set(page, observeBrowser(page));
  await page.clock.install({ time: new Date(`${fixedToday}T10:00:00Z`) });
  const { revision } = await (await request.get("/api/state")).json();
  expect(
    (
      await request.put("/api/state", {
        data: { revision, state: delayFixture() },
      })
    ).ok(),
  ).toBe(true);
});
test.afterEach(async ({ page }) => expect(issues.get(page)).toEqual([]));
for (const [width, height] of [
  [744, 1133],
  [1133, 744],
  [1920, 1080],
  [3840, 2160],
]) {
  test(`why delayed explains person feature and weekend across planning screens at ${width}px`, async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width, height });
    await page.goto("/");
    const before = await (await request.get("/api/state")).json();
    await page.getByRole("button", { name: /^Features(?:\s|$)/ }).click();
    await expect(
      page.getByText(
        "Forecast exceeds the accepted commitment by 3 calendar days",
        { exact: true },
      ),
    ).toBeVisible();
    const trigger = page.getByLabel("Why delayed? Five-day delivery", {
      exact: true,
    });
    await trigger.focus();
    await page.keyboard.press("Enter");
    const details = page.locator(".delay-explanation[open]");
    await expect(
      details.getByRole("heading", { name: "Alex", exact: true }),
    ).toBeVisible();
    await expect(
      details.getByRole("heading", { name: "Sam", exact: true }),
    ).toHaveCount(0);
    await expect(details).toContainText("Urgent fix");
    await expect(details).toContainText("1 working day booked");
    await expect(details).toContainText("Jan 11, 2030 – Jan 12, 2030");
    await expect(details).toContainText("original schedule");
    await trigger.press("Space");
    await expect(details).toHaveCount(0);
    await page
      .getByRole("button", { name: "Sprints & plans", exact: true })
      .click();
    await page
      .getByLabel("Why delayed? Five-day delivery", { exact: true })
      .click();
    await expect(page.locator(".delay-explanation[open]")).toContainText(
      "Urgent fix",
    );
    await page.getByRole("button", { name: /^Timeline(?:\s|$)/ }).click();
    await page
      .getByRole("button", {
        name: "Why delayed? Five-day delivery",
        exact: true,
      })
      .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Urgent fix");
    await expect(dialog).toContainText("Jan 13, 2030");
    expect(
      (await new AxeBuilder({ page }).include('[role="dialog"]').analyze())
        .violations,
    ).toEqual([]);
    const box = await dialog.boundingBox();
    expect(box!.width).toBeLessThanOrEqual(width);
    const region = dialog.getByRole("region", {
      name: "Delay explanation details",
    });
    await region.focus();
    if (height === 744) {
      await region.press("End");
      await expect
        .poll(() =>
          dialog
            .locator('[data-slot="modal-body"]')
            .evaluate((el) => el.scrollTop),
        )
        .toBeGreaterThan(0);
    }
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await page.getByRole("button", { name: "By person", exact: true }).click();
    await page.getByRole("button", { name: /Five-day delivery.*Alex/ }).click();
    await expect(dialog).toContainText("Accepted delivery");
    await dialog
      .getByLabel("Why delayed? Five-day delivery", { exact: true })
      .click();
    await expect(dialog).toContainText("Urgent fix");
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    expect(await (await request.get("/api/state")).json()).toEqual(before);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBeLessThanOrEqual(1);
  });
}
test("refreshing a commitment removes obsolete delay explanations and undo restores them", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /^Features(?:\s|$)/ }).click();
  await page
    .getByLabel("Why delayed? Five-day delivery", { exact: true })
    .click();
  await expect(page.locator(".delay-explanation[open]")).toContainText(
    "Urgent fix",
  );
  await page
    .getByRole("button", {
      name: "Refresh commitment date for Five-day delivery",
      exact: true,
    })
    .click();
  await expect(
    page.getByLabel("Why delayed? Five-day delivery", { exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Undo last change", exact: true })
    .click();
  await page
    .getByLabel("Why delayed? Five-day delivery", { exact: true })
    .click();
  await expect(page.locator(".delay-explanation[open]")).toContainText(
    "Urgent fix",
  );
});
test("a leave-only delay shows its calendar instead of blaming unrelated team work", async ({
  page,
  request,
}) => {
  const state = delayFixture();
  state.features.shift();
  state.leaves = [
    {
      id: "leave",
      personId: "p",
      start: fixedToday,
      end: fixedToday,
      hours: null,
      note: "Annual leave",
    },
  ];
  const { revision } = await (await request.get("/api/state")).json();
  expect(
    (await request.put("/api/state", { data: { revision, state } })).ok(),
  ).toBe(true);
  await page.goto("/");
  await page.getByRole("button", { name: /^Features(?:\s|$)/ }).click();
  await page
    .getByLabel("Why delayed? Five-day delivery", { exact: true })
    .click();
  const details = page.locator(".delay-explanation[open]");
  await expect(details).toContainText("Annual leave");
  await expect(details).toContainText("No competing feature bookings");
  await expect(details).not.toContainText("Urgent fix");
  state.leaves[0].end = "2035-01-07";
  const nextRevision = (await (await request.get("/api/state")).json())
    .revision;
  expect(
    (
      await request.put("/api/state", {
        data: { revision: nextRevision, state },
      })
    ).ok(),
  ).toBe(true);
  await page.reload();
  await page.getByRole("button", { name: /^Features(?:\s|$)/ }).click();
  await page
    .getByLabel("Why delayed? Five-day delivery", { exact: true })
    .click();
  await expect(page.locator(".delay-explanation[open]")).toContainText(
    "five-year forecast horizon",
  );
  await expect(page.locator(".delay-explanation[open]")).toContainText(
    "Annual leave",
  );
  await expect(page.locator(".delay-explanation[open]")).toContainText(
    "Delivery cannot currently be forecast",
  );
});
