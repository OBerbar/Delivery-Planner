import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { populatedFixture, fixedToday } from "../scripts/maintenance-fixture";
import { observeBrowser } from "../scripts/browser-observability";

const issues = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page, request }) => {
  issues.set(page, observeBrowser(page));
  const time = new Date(`${fixedToday}T12:00:00Z`);
  await page.clock.install({ time });
  await page.clock.pauseAt(time);
  const state = populatedFixture();
  state.apps.push({ ...state.apps[0], id: "second", name: "Second Studio" });
  const { revision } = await (await request.get("/api/state")).json();
  expect(
    (await request.put("/api/state", { data: { revision, state } })).ok(),
  ).toBe(true);
});
test.afterEach(async ({ page }) => expect(issues.get(page)).toEqual([]));

const logo = (page: Page) =>
  page.getByRole("button", { name: "Delivery Studio logo", exact: true });
async function toggle(page: Page) {
  for (let i = 0; i < 5; i++) await logo(page).click();
}

for (const [width, height] of [
  [744, 1133],
  [1133, 744],
  [1920, 1080],
]) {
  test(`stakeholder mode hides expanded work and person grouping reversibly at ${width}px`, async ({
    page,
    request,
  }, testInfo) => {
    await page.setViewportSize({ width, height });
    await page.goto("/");
    const before = await (await request.get("/api/state")).json();
    const expansion = page.getByRole("button", {
      name: "Expand Five sprint delivery",
      exact: true,
    });
    await expansion.click();
    await expect(page.locator(".timeline-row-label.child")).not.toHaveCount(0);
    for (let i = 0; i < 4; i++) await logo(page).click();
    await expect(logo(page)).toHaveAttribute("aria-pressed", "false");
    await expect(expansion).toBeVisible();
    await logo(page).click();
    await expect(logo(page)).toHaveAttribute("aria-pressed", "true");
    await expect(logo(page).locator(".brand-symbol")).toHaveCSS(
      "box-shadow",
      "rgb(255, 255, 255) 0px 0px 0px 2px",
    );
    await expect(
      page.getByRole("button", { name: "By person", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", {
        name: /^Expand (Five sprint delivery|Mixed person estimates)$/,
      }),
    ).toHaveCount(0);
    await expect(page.locator(".timeline-row-label.child")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "By feature", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await page.screenshot({
      path: testInfo.outputPath("stakeholder-active.png"),
      fullPage: true,
    });
    await toggle(page);
    await expect(expansion).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator(".timeline-row-label.child")).not.toHaveCount(0);
    await page.getByRole("button", { name: "By person", exact: true }).click();
    await expect(page.locator("[data-person-id]").first()).toBeVisible();
    const preferences = await page.evaluate(() =>
      localStorage.getItem("sprint-studio:timeline:v1:a"),
    );
    await toggle(page);
    await expect(page.locator("[data-person-id]")).toHaveCount(0);
    await page.getByRole("button", { name: "By feature", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "By feature", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await toggle(page);
    await expect(
      page.getByRole("button", { name: "By person", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      await page.evaluate(() =>
        localStorage.getItem("sprint-studio:timeline:v1:a"),
      ),
    ).toBe(preferences);
    expect(await (await request.get("/api/state")).json()).toEqual(before);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBeLessThanOrEqual(1);
  });
}

test("stakeholder mode persists across refresh and navigation, resets the click sequence, and supports a collapsed keyboard logo @a11y", async ({
  page,
  request,
}, testInfo) => {
  await page.goto("/");
  const before = await (await request.get("/api/state")).json();
  for (let i = 0; i < 4; i++) await logo(page).click();
  await page.clock.runFor(3001);
  await logo(page).click();
  await expect(logo(page)).toHaveAttribute("aria-pressed", "false");
  for (let i = 0; i < 4; i++) await logo(page).click();
  await expect(logo(page)).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await expect(logo(page)).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("button", { name: "By person", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: /Current app/ }).click();
  await page
    .getByRole("option", { name: "Second Studio", exact: true })
    .click();
  await expect(logo(page)).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("button", { name: "By person", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: /Current app/ }).click();
  await page
    .getByRole("option", { name: "Maintenance Studio", exact: true })
    .click();
  await page.getByRole("button", { name: /^Features \d/ }).click();
  await page.getByRole("button", { name: "Timeline", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "By person", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Collapse navigation", exact: true })
    .click();
  await expect(logo(page)).toBeVisible();
  const box = (await logo(page).boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
  await logo(page).focus();
  await expect(logo(page)).toBeFocused();
  await page.screenshot({
    path: testInfo.outputPath("stakeholder-rail-focus.png"),
    fullPage: true,
  });
  await page.clock.resume();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  for (let i = 0; i < 5; i++)
    await page.keyboard.press(i % 2 ? "Space" : "Enter");
  await expect(logo(page)).toHaveAttribute("aria-pressed", "false");
  await expect(
    page.getByRole("button", { name: "By person", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(logo(page)).toHaveAttribute("aria-pressed", "false");
  expect(await (await request.get("/api/state")).json()).toEqual(before);
});

test("denied session storage leaves stakeholder mode usable without changing saved work", async ({
  page,
  request,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(window, "sessionStorage", {
      get() {
        throw new DOMException("Storage denied", "SecurityError");
      },
    }),
  );
  await page.goto("/");
  const before = await (await request.get("/api/state")).json();
  await toggle(page);
  await expect(logo(page)).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("button", { name: "By person", exact: true }),
  ).toHaveCount(0);
  await toggle(page);
  await expect(
    page.getByRole("button", { name: "By person", exact: true }),
  ).toBeVisible();
  expect(await (await request.get("/api/state")).json()).toEqual(before);
});
