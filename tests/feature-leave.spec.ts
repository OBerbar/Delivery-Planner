import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { maintenanceFixture, fixedToday } from "../scripts/maintenance-fixture";
import { observeBrowser } from "../scripts/browser-observability";
const issues = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page, request }) => {
  issues.set(page, observeBrowser(page));
  await page.clock.install({ time: new Date(`${fixedToday}T12:00:00Z`) });
  const state = maintenanceFixture();
  state.features = [state.features[1]];
  state.features[0].estimateEffort = [
    { personId: "p", hours: 80 },
    { personId: "q", hours: 80 },
  ];
  state.leaves = [
    {
      id: "p-leave",
      personId: "p",
      start: "2030-01-08",
      end: "2030-01-10",
      hours: null,
      note: "Vacation",
    },
    {
      id: "q-leave",
      personId: "q",
      start: "2030-01-10",
      end: "2030-01-10",
      hours: null,
      note: "Personal day",
    },
    {
      id: "partial",
      personId: "p",
      start: "2030-01-11",
      end: "2030-01-11",
      hours: 2,
      note: "Appointment",
    },
  ];
  const { revision } = await (await request.get("/api/state")).json();
  expect(
    (await request.put("/api/state", { data: { revision, state } })).ok(),
  ).toBeTruthy();
});
test.afterEach(async ({ page }) => expect(issues.get(page)).toEqual([]));
const trigger = (page: Page) =>
  page.getByRole("button", {
    name: "Leave details for Mixed person estimates",
    exact: true,
  });

test("continuous feature leave includes member weekends and selected holidays with truthful details", async ({
  page,
  request,
}, testInfo) => {
  const saved = await (await request.get("/api/state")).json();
  saved.state.apps[0].weekends = [5, 6];
  saved.state.members[0].weekends = [0, 6];
  saved.state.leaves = [
    {
      id: "continuous",
      personId: "p",
      start: "2030-01-11",
      end: "2030-01-15",
      hours: null,
      note: "Continuous vacation",
    },
  ];
  saved.state.holidays = [
    {
      id: "selected",
      appId: "a",
      date: "2030-01-14",
      name: "Personal holiday",
      personIds: ["p"],
    },
  ];
  expect((await request.put("/api/state", { data: saved })).ok()).toBeTruthy();
  const before = await (await request.get("/api/state")).json();
  await page.goto("/");
  const row = page.locator('.timeline-track[data-track-feature-id="mixed"]');
  for (const [date, coverage] of [
    ["2030-01-11", "full"],
    ["2030-01-12", "full"],
    ["2030-01-13", "partial"],
    ["2030-01-14", "partial"],
    ["2030-01-15", "partial"],
  ]) {
    const cell = row.locator(`[data-date="${date}"]`);
    await expect(cell).toHaveClass(new RegExp(`feature-leave-${coverage}`));
    await expect(cell).toHaveAttribute("title", /Continuous vacation/);
    expect(
      await cell.evaluate((element) => {
        const style = getComputedStyle(element);
        return (
          style.backgroundImage !== "none" ||
          style.backgroundColor !== "rgba(0, 0, 0, 0)"
        );
      }),
    ).toBe(true);
  }
  await expect(row.locator('[data-date="2030-01-13"]')).toHaveAttribute(
    "title",
    /Alex:.*Weekend/,
  );
  await expect(row.locator('[data-date="2030-01-14"]')).toHaveAttribute(
    "title",
    /Holiday: Personal holiday/,
  );
  await expect(row.locator('[data-date="2030-01-16"]')).not.toHaveClass(
    /feature-leave-/,
  );
  for (const [width, height] of [
    [744, 1133],
    [1133, 744],
    [1920, 1080],
    [3840, 2160],
  ]) {
    await page.setViewportSize({ width, height });
    await trigger(page).click();
    const dialog = page.getByRole("dialog", {
      name: "Feature leave details",
      exact: true,
    });
    await expect(dialog).toContainText("Jan 13, 2030");
    await expect(dialog).toContainText("Weekend");
    await expect(dialog).toContainText("Holiday: Personal holiday");
    await expect(dialog).toContainText(
      "0 working days calendar capacity remaining",
    );
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await page.screenshot({
      path: testInfo.outputPath(`continuous-leave-details-${width}.png`),
    });
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(trigger(page)).toBeFocused();
    await page.screenshot({
      path: testInfo.outputPath(`continuous-leave-timeline-${width}.png`),
    });
  }
  await page
    .getByRole("button", { name: "Collapse leaves and holidays", exact: true })
    .click();
  await expect(row.locator('[data-date="2030-01-13"]')).toHaveClass(
    /feature-leave-partial/,
  );
  expect(await (await request.get("/api/state")).json()).toEqual(before);
});

test("feature leave backgrounds explain partial and total absence without changing records or status colors", async ({
  page,
  request,
}) => {
  const before = await (await request.get("/api/state")).json();
  await page.goto("/");
  const row = page.locator('.timeline-track[data-track-feature-id="mixed"]');
  await expect(
    row.locator('.feature-leave-partial[data-date="2030-01-08"]'),
  ).toHaveAttribute("title", /Alex: Leave: Vacation.*Sam: Available/);
  await expect(
    row.locator('.feature-leave-full[data-date="2030-01-10"]'),
  ).toHaveAttribute("title", /All unavailable/);
  await expect(
    row.locator('.feature-leave-partial[data-date="2030-01-11"]'),
  ).toHaveAttribute(
    "title",
    /0.25 working day off per day.*0.75 working day calendar capacity remaining/,
  );
  await expect(
    row.locator('.feature-leave-partial[data-date="2030-01-12"]'),
  ).toHaveCount(0);
  await expect(row.locator(".timeline-bar.status-todo")).toHaveCount(1);
  await page
    .getByRole("button", { name: "Collapse leaves and holidays", exact: true })
    .click();
  await expect(row.locator(".feature-leave-full")).toHaveCount(1);
  await trigger(page).focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", {
    name: "Feature leave details",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Jan 8, 2030 – Jan 9, 2030");
  await expect(dialog).toContainText("Full day off");
  await expect(dialog).toContainText("0.25 working day off per day");
  await expect(dialog).toContainText("Sam");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger(page)).toBeFocused();
  expect(await (await request.get("/api/state")).json()).toEqual(before);
  await row.locator(".timeline-bar").click();
  await expect(
    page.getByRole("dialog", { name: "Edit feature", exact: true }),
  ).toBeVisible();
});

test("person mode and expanded task shading remain intact; future window has no misleading leave indicator", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Expand Mixed person estimates", exact: true })
    .click();
  await expect(
    page.locator(
      '.timeline-track[data-person-id="p"] .grid-cell.leave[data-date="2030-01-08"]',
    ),
  ).toHaveCount(1);
  await page.getByRole("button", { name: "By person", exact: true }).click();
  await expect(trigger(page)).toHaveCount(0);
  await expect(
    page.locator(
      '.timeline-track[data-person-id="p"] .grid-cell.leave[data-date="2030-01-08"]',
    ),
  ).toHaveCount(1);
  await page.getByRole("button", { name: "By feature", exact: true }).click();
  for (let i = 0; i < 4; i++)
    await page.getByRole("button", { name: "Next week", exact: true }).click();
  await expect(trigger(page)).toHaveCount(0);
});

for (const [width, height] of [
  [744, 1133],
  [1133, 744],
  [1920, 1080],
  [3840, 2160],
]) {
  test(`leave details support tablet/desktop layout and keyboard at ${width}px @a11y`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height });
    await page.goto("/");
    const bounds = await trigger(page).boundingBox();
    expect(bounds!.width).toBeGreaterThanOrEqual(44);
    expect(bounds!.height).toBeGreaterThanOrEqual(44);
    await trigger(page).click();
    const dialog = page.getByRole("dialog", {
      name: "Feature leave details",
      exact: true,
    });
    await expect(dialog).toBeVisible();
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBeLessThanOrEqual(1);
    const box = await dialog.boundingBox();
    expect(box!.width).toBeLessThanOrEqual(width);
    await page.screenshot({
      path: testInfo.outputPath(`feature-leave-${width}.png`),
    });
    await page
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    await expect(trigger(page)).toBeFocused();
  });
}

test("What-if calendar drafts shade feature rows and Discard restores the saved calendar without writes", async ({
  page,
  request,
}) => {
  await page.goto("/");
  const before = await (await request.get("/api/state")).json();
  let writes = 0;
  page.on("request", (r) => {
    if (r.method() === "PUT" && r.url().endsWith("/api/state")) writes++;
  });
  await page
    .getByRole("button", { name: "What-if planning", exact: true })
    .click();
  await page.getByRole("button", { name: /^Team & leave/ }).click();
  await page.getByRole("button", { name: "Add leave", exact: true }).click();
  await page.getByLabel("Leave starts", { exact: true }).fill("2030-01-14");
  await page.getByLabel("Leave ends", { exact: true }).fill("2030-01-14");
  await page
    .getByLabel("Leave note", { exact: true })
    .fill("Experimental leave");
  await page.getByRole("button", { name: "Save leave", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: /^Timeline(?:\s|$)/ }).click();
  const cell = page.locator(
    '[data-track-feature-id="mixed"] [data-date="2030-01-14"]',
  );
  await expect(cell).toHaveClass(/feature-leave-partial/);
  await expect(cell).toHaveAttribute("title", /Experimental leave/);
  await page
    .getByRole("button", { name: "Discard experiment", exact: true })
    .click();
  await expect(cell).not.toHaveClass(/feature-leave-/);
  expect(writes).toBe(0);
  expect(await (await request.get("/api/state")).json()).toEqual(before);
});
