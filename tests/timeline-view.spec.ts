import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {
  populatedFixture,
  largeFixture,
  fixedToday,
} from "../scripts/maintenance-fixture";
import { observeBrowser } from "../scripts/browser-observability";
import { schedule } from "../src/lib/planning";

const issues = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  issues.set(page, observeBrowser(page));
  await page.clock.install({ time: new Date(`${fixedToday}T12:00:00Z`) });
});
test.afterEach(async ({ page }) => {
  expect(issues.get(page)).toEqual([]);
});

test("calendar-only absences collapse with keyboard, stay collapsed across groupings and reopen without saving", async ({
  page,
  request,
}) => {
  const state = populatedFixture();
  state.features = [];
  const { revision } = await (await request.get("/api/state")).json();
  expect(
    (await request.put("/api/state", { data: { revision, state } })).ok(),
  ).toBeTruthy();
  await page.goto("/");
  const before = await (await request.get("/api/state")).json();
  const timeline = page.getByRole("region", {
    name: "Delivery timeline",
    exact: true,
  });
  const collapse = page.getByRole("button", {
    name: "Collapse leaves and holidays",
    exact: true,
  });
  const bars = page.locator(".timeline-availability-bar");
  await expect(collapse).toHaveAttribute("aria-expanded", "true");
  await expect(collapse).toContainText("2 entries");
  await expect(bars).toHaveCount(2);
  await expect(bars.first()).toBeVisible();
  const expandedHeight = (await timeline.boundingBox())!.height;
  await collapse.focus();
  await page.keyboard.press("Space");
  const expand = page.getByRole("button", {
    name: "Expand leaves and holidays",
    exact: true,
  });
  await expect(expand).toBeFocused();
  await expect(expand).toHaveAttribute("aria-expanded", "false");
  await expect(bars.first()).toBeHidden();
  await expect(bars.last()).toBeHidden();
  expect(
    expandedHeight - (await timeline.boundingBox())!.height,
  ).toBeGreaterThanOrEqual(150);
  await page.getByRole("button", { name: "By person", exact: true }).click();
  await expect(expand).toHaveAttribute("aria-expanded", "false");
  await expect(bars.first()).toBeHidden();
  for (let week = 0; week < 3; week++) {
    await page.getByRole("button", { name: "Next week", exact: true }).click();
  }
  await expect(expand).toHaveCount(0);
  await page.getByRole("button", { name: "Today", exact: true }).click();
  await expect(expand).toHaveAttribute("aria-expanded", "false");
  await expand.focus();
  await page.keyboard.press("Enter");
  await expect(collapse).toHaveAttribute("aria-expanded", "true");
  await expect(bars.first()).toBeVisible();
  await expect(bars.last()).toBeVisible();
  await collapse.click();
  await page.reload();
  await expect(expand).toHaveAttribute("aria-expanded", "false");
  await expect(bars.first()).toBeHidden();
  expect(await (await request.get("/api/state")).json()).toEqual(before);
});

test("collapsing absence rows keeps forecast bars, personal shading and saved commitments unchanged @a11y", async ({
  page,
  request,
}) => {
  const state = populatedFixture();
  const { revision } = await (await request.get("/api/state")).json();
  expect(
    (await request.put("/api/state", { data: { revision, state } })).ok(),
  ).toBeTruthy();
  await page.goto("/");
  await page.getByRole("button", { name: "By person", exact: true }).click();
  const before = await (await request.get("/api/state")).json();
  const forecasts = await page.locator(".timeline-bar").evaluateAll((bars) =>
    bars.map((bar) => ({
      title: bar.getAttribute("title"),
      style: bar.getAttribute("style"),
    })),
  );
  await page
    .getByRole("button", { name: "Collapse leaves and holidays", exact: true })
    .click();
  await expect(page.locator(".timeline-availability-bar").first()).toBeHidden();
  const sam = page.locator('.timeline-track[data-person-id="q"]');
  await expect(
    sam.locator('.grid-cell.holiday[data-date="2030-01-14"]'),
  ).toHaveAttribute("title", /Winter break/);
  await expect(
    sam.locator('.grid-cell.leave[data-date="2030-01-09"]'),
  ).toHaveAttribute("title", /Appointment.*0.25 working day/);
  expect(
    await page.locator(".timeline-bar").evaluateAll((bars) =>
      bars.map((bar) => ({
        title: bar.getAttribute("title"),
        style: bar.getAttribute("style"),
      })),
    ),
  ).toEqual(forecasts);
  const after = await (await request.get("/api/state")).json();
  expect(after).toEqual(before);
  expect(schedule(after.state, fixedToday)).toEqual(
    schedule(before.state, fixedToday),
  );
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page
    .getByRole("button", { name: "Expand leaves and holidays", exact: true })
    .click();
  await expect(
    page.locator(".timeline-availability-bar").first(),
  ).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.locator(".timeline-bar").first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
});

for (const viewport of [
  { width: 744, height: 1133 },
  { width: 1133, height: 744 },
  { width: 1920, height: 1080 },
  { width: 3840, height: 2160 },
]) {
  test(`month dates and sprint headers stay fixed while timeline scrolls at ${viewport.width}px`, async ({
    page,
    request,
  }, testInfo) => {
    await page.setViewportSize(viewport);
    const state = largeFixture();
    state.features = state.features.slice(0, 40);
    state.leaves = [
      {
        id: "scroll-leave",
        personId: "person-0",
        start: "2030-01-09",
        end: "2030-01-10",
        hours: null,
        note: "Winter leave",
      },
    ];
    const { revision } = await (await request.get("/api/state")).json();
    expect(
      (await request.put("/api/state", { data: { revision, state } })).ok(),
    ).toBeTruthy();
    await page.goto("/");
    await page.getByRole("button", { name: /Timeline range/ }).click();
    await page.getByRole("option", { name: "6 months", exact: true }).click();
    // Stabilize the surrounding frame; the independent navigation idle timer
    // must not move the whole chart while sticky positions are measured.
    const collapseNavigation = page.getByRole("button", {
      name: "Collapse navigation",
      exact: true,
    });
    if (await collapseNavigation.isVisible()) await collapseNavigation.click();
    await expect(
      page.getByRole("button", { name: "Expand navigation", exact: true }),
    ).toBeVisible();
    const timeline = page.getByRole("region", {
      name: "Delivery timeline",
      exact: true,
    });
    await timeline.evaluate((el) =>
      // Native page scrolling uses whole pixels; use the nearest attainable offset.
      window.scrollTo(
        0,
        Math.round(window.scrollY + el.getBoundingClientRect().top),
      ),
    );
    await expect
      .poll(async () => (await timeline.boundingBox())!.y)
      .toBeCloseTo(0, 0);
    const monthDates = page.locator(".timeline-date-head");
    const sprints = page.locator(".sprint-bands");
    const corner = page.locator(".timeline-label-head");
    const labels = page.locator(".timeline-body-labels");
    const toggle = page.getByRole("button", {
      name: "Collapse leaves and holidays",
      exact: true,
    });
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    const target = (await toggle.boundingBox())!;
    expect(target.height).toBeGreaterThanOrEqual(44);
    expect(target.width).toBeGreaterThanOrEqual(44);
    const initial = {
      dates: (await monthDates.boundingBox())!,
      sprints: (await sprints.boundingBox())!,
      corner: (await corner.boundingBox())!,
      labels: (await labels.boundingBox())!,
    };
    const scroll = await timeline.evaluate((el) => {
      el.scrollTop = 600;
      el.scrollLeft = 400;
      return {
        top: el.scrollTop,
        left: el.scrollLeft,
        height: el.clientHeight,
        viewport: window.innerHeight,
      };
    });
    expect(scroll.top).toBeGreaterThan(300);
    expect(scroll.left).toBeGreaterThan(0);
    expect(scroll.height).toBeLessThan(scroll.viewport);
    await expect
      .poll(async () => (await monthDates.boundingBox())!.y)
      .toBeCloseTo(initial.dates.y, 0);
    expect((await sprints.boundingBox())!.y).toBeCloseTo(initial.sprints.y, 0);
    expect((await corner.boundingBox())!.y).toBeCloseTo(initial.corner.y, 0);
    expect((await corner.boundingBox())!.x).toBeCloseTo(initial.corner.x, 0);
    expect((await labels.boundingBox())!.x).toBeCloseTo(initial.labels.x, 0);
    expect((await monthDates.boundingBox())!.x).toBeCloseTo(
      initial.dates.x - scroll.left,
      0,
    );
    expect(
      await monthDates.evaluate((el) => {
        const rect = el.getBoundingClientRect();
        const scrollRect = el
          .closest(".timeline-scroll")!
          .getBoundingClientRect();
        const leftLabel = document
          .querySelector(".timeline-label-head")!
          .getBoundingClientRect();
        return el.contains(
          document.elementFromPoint(
            Math.max(scrollRect.left, leftLabel.right) + 20,
            rect.top + 15,
          ),
        );
      }),
    ).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("frozen-headers.png") });
    await toggle.click();
    await expect(
      page.getByRole("button", {
        name: "Expand leaves and holidays",
        exact: true,
      }),
    ).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator(".timeline-availability-bar")).toBeHidden();
    const beforeKeyboard = await timeline.evaluate((el) => el.scrollTop);
    await timeline.focus();
    await page.keyboard.press("PageDown");
    await expect
      .poll(() => timeline.evaluate((el) => el.scrollTop))
      .toBeGreaterThan(beforeKeyboard);
    await page.screenshot({
      path: testInfo.outputPath("collapsed-absences.png"),
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      ),
    ).toBeLessThanOrEqual(1);
  });
}

for (const viewport of [
  { width: 744, height: 1133 },
  { width: 1133, height: 744 },
  { width: 1920, height: 1080 },
  { width: 3840, height: 2160 },
]) {
  test(`timeline uses the browser height and reaches the viewport top at ${viewport.width}px`, async ({
    page,
    request,
  }, testInfo) => {
    await page.setViewportSize(viewport);
    const state = largeFixture();
    const { revision } = await (await request.get("/api/state")).json();
    expect(
      (await request.put("/api/state", { data: { revision, state } })).ok(),
    ).toBeTruthy();
    await page.goto("/");
    const before = await (await request.get("/api/state")).json();
    const chart = page.getByRole("region", {
      name: "Delivery timeline",
      exact: true,
    });
    const first = (await chart.boundingBox())!;
    expect(first.height).toBeGreaterThan(viewport.height * 0.9);
    expect(first.height).toBeLessThan(viewport.height);
    await chart.evaluate((el) =>
      // Native page scrolling uses whole pixels; use the nearest attainable offset.
      window.scrollTo(
        0,
        Math.round(window.scrollY + el.getBoundingClientRect().top),
      ),
    );
    await expect
      .poll(async () => (await chart.boundingBox())!.y)
      .toBeCloseTo(0, 0);
    expect((await chart.boundingBox())!.height).toBeCloseTo(
      viewport.height - 24,
      0,
    );
    await chart.evaluate((el) => {
      el.scrollTop = 600;
    });
    await expect
      .poll(
        async () =>
          (await page.locator(".timeline-date-head").boundingBox())!.y,
      )
      .toBeCloseTo(0, 0);
    await expect
      .poll(async () => (await page.locator(".sprint-bands").boundingBox())!.y)
      .toBeCloseTo(108, 0);
    await page.screenshot({ path: testInfo.outputPath("viewport-height.png") });
    const smallerHeight = Math.max(500, Math.round(viewport.height / 2));
    await page.setViewportSize({
      width: viewport.width,
      height: smallerHeight,
    });
    await expect
      .poll(async () => (await chart.boundingBox())!.height)
      .toBeCloseTo(smallerHeight - 24, 0);
    await page.setViewportSize(viewport);
    await expect
      .poll(async () => (await chart.boundingBox())!.height)
      .toBeCloseTo(first.height, 0);
    await page.getByRole("button", { name: "By person", exact: true }).click();
    await expect(page.locator(".timeline-track[data-person-id]")).toHaveCount(
      15,
    );
    expect((await chart.boundingBox())!.height).toBeLessThan(viewport.height);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      ),
    ).toBeLessThanOrEqual(1);
    expect(await (await request.get("/api/state")).json()).toEqual(before);
  });
}

test("timeline without visible absences omits the collapse control", async ({
  page,
  request,
}) => {
  const state = populatedFixture();
  state.leaves = [];
  state.holidays = [];
  const { revision } = await (await request.get("/api/state")).json();
  expect(
    (await request.put("/api/state", { data: { revision, state } })).ok(),
  ).toBeTruthy();
  await page.goto("/");
  await expect(page.locator(".timeline-bar").first()).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: /(?:Collapse|Expand) leaves and holidays/,
    }),
  ).toHaveCount(0);
});
