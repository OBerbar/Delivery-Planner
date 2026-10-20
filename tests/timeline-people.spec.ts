import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { populatedFixture, fixedToday } from "../scripts/maintenance-fixture";
import { observeBrowser } from "../scripts/browser-observability";

const issues = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  issues.set(page, observeBrowser(page));
  await page.clock.install({ time: new Date(`${fixedToday}T12:00:00Z`) });
});
test.afterEach(async ({ page }) => expect(issues.get(page)).toEqual([]));

for (const [width, height] of [
  [744, 1133],
  [1133, 744],
  [1920, 1080],
  [3840, 1600],
]) {
  test(`overlaps and multiple tasks stay in one person row at ${width}px`, async ({
    page,
    request,
  }, testInfo) => {
    await page.setViewportSize({ width, height });
    const state = populatedFixture();
    state.leaves = [];
    state.holidays = [];
    state.features[0].tasks = [
      {
        id: "part1",
        title: "First piece",
        personId: "p",
        scope: "Build",
        hours: 2,
        status: "todo",
        dependsOn: [],
      },
      {
        id: "part2",
        title: "Second piece",
        personId: "p",
        scope: "Build",
        hours: 2,
        status: "todo",
        dependsOn: [],
      },
      {
        id: "design",
        title: "Design",
        personId: "q",
        scope: "Design",
        hours: 8,
        status: "todo",
        dependsOn: ["part1"],
      },
    ];
    state.features[1].assigneeIds = ["p"];
    state.features[1].assigneeEstimates = [
      { personId: "p", unit: "days", value: 0.5 },
    ];
    state.features[1].estimateEffort = [{ personId: "p", hours: 4 }];
    state.features.push({
      ...state.features[1],
      id: "blocked",
      title: "Waiting approval",
      priority: 2,
      status: "blocked",
      tasks: [
        {
          id: "waiting",
          title: "Unresolved approval dependency",
          personId: "p",
          scope: "Backend",
          hours: 4,
          status: "todo",
          dependsOn: ["waiting"],
        },
      ],
    });
    const { revision } = await (await request.get("/api/state")).json();
    expect(
      (await request.put("/api/state", { data: { revision, state } })).ok(),
    ).toBeTruthy();
    await page.goto("/");
    await page.getByRole("button", { name: "By person", exact: true }).click();
    const alex = page.locator('.timeline-track[data-person-id="p"]');
    const sam = page.locator('.timeline-track[data-person-id="q"]');
    await expect(alex).toHaveCount(1);
    await expect(alex.locator(".timeline-bar")).toHaveCount(2);
    await expect(alex.locator(".unscheduled")).toHaveCount(1);
    const boxes = await alex
      .locator(".timeline-bar, .unscheduled")
      .evaluateAll((bars) =>
        bars.map((bar) => {
          const b = bar.getBoundingClientRect();
          return { top: b.top, bottom: b.bottom };
        }),
      );
    expect(new Set(boxes.map((b) => b.top)).size).toBe(3);
    for (const box of boxes)
      expect(box.bottom - box.top).toBeGreaterThanOrEqual(40);
    const row = (await alex.boundingBox())!;
    expect(
      boxes.every(
        (box) => box.top >= row.y && box.bottom <= row.y + row.height,
      ),
    ).toBe(true);
    const samBox = (await sam.boundingBox())!;
    expect(samBox.y).toBeCloseTo(row.y + row.height, 0);
    const canvasBox = (await page.locator(".timeline-canvas").boundingBox())!;
    await expect(page.locator(".dependency-lines > path")).toHaveCount(1);
    const arrow = await page
      .locator(".dependency-lines > path")
      .getAttribute("d");
    expect(arrow).toContain(` V ${samBox.y - canvasBox.y + 36} `);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      ),
    ).toBeLessThanOrEqual(1);
    await page.screenshot({ path: testInfo.outputPath(`people-${width}.png`) });
    for (const title of [
      "Five sprint delivery",
      "Mixed person estimates",
      "Waiting approval",
    ]) {
      const bar = alex.getByRole("button", { name: new RegExp(title) });
      await bar.focus();
      await page.keyboard.press("Enter");
      await expect(
        page.getByLabel("Feature title", { exact: true }),
      ).toHaveValue(title);
      await page.keyboard.press("Escape");
      await expect(page.locator('[role="dialog"]')).toHaveCount(0);
    }
  });
}

test("one row per app member holds multiple features, keeps personal dates and opens the chosen feature without saving @a11y", async ({
  page,
  request,
}) => {
  const state = populatedFixture();
  state.people.push(
    { id: "idle", name: "Taylor", dailyHours: 8 },
    { id: "other", name: "Outside member", dailyHours: 8 },
  );
  state.members.push({
    ...state.members[0],
    id: "idle-member",
    personId: "idle",
  });
  const { revision } = await (await request.get("/api/state")).json();
  expect(
    (await request.put("/api/state", { data: { revision, state } })).ok(),
  ).toBeTruthy();
  await page.goto("/");
  const before = await (await request.get("/api/state")).json();
  await page.getByRole("button", { name: "By person", exact: true }).click();
  await expect(page.locator(".timeline-track[data-person-id]")).toHaveCount(3);
  const alex = page.locator('.timeline-track[data-person-id="p"]');
  const sam = page.locator('.timeline-track[data-person-id="q"]');
  await expect(alex).toHaveCount(1);
  await expect(sam).toHaveCount(1);
  await expect(
    page.locator(".timeline-row-title").filter({ hasText: "Taylor" }),
  ).toContainText("No assigned features");
  await expect(page.locator(".timeline-grid")).not.toContainText(
    "Outside member",
  );
  await page.getByRole("button", { name: /Timeline range/ }).click();
  await page.getByRole("option", { name: "6 months", exact: true }).click();
  await expect(alex.locator(".timeline-bar")).toHaveCount(2);
  await expect(sam.locator(".timeline-bar")).toHaveCount(1);
  const alexMixed = alex.getByRole("button", {
    name: /Mixed person estimates/,
  });
  const samMixed = sam.getByRole("button", { name: /Mixed person estimates/ });
  expect(await alexMixed.getAttribute("title")).not.toEqual(
    await samMixed.getAttribute("title"),
  );
  await expect(
    sam.locator('.grid-cell.leave[data-date="2030-01-09"]'),
  ).toHaveAttribute("title", /Appointment/);
  await page
    .getByRole("button", { name: "Collapse leaves and holidays", exact: true })
    .click();
  await expect(alex.locator(".timeline-bar")).toHaveCount(2);
  await samMixed.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Feature title", { exact: true })).toHaveValue(
    "Mixed person estimates",
  );
  await page.keyboard.press("Escape");
  await expect(page.locator('[role="dialog"]')).toHaveCount(0);
  const accessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(accessibility.violations).toEqual([]);
  await page.getByRole("button", { name: "By feature", exact: true }).click();
  await expect(
    page.locator('.timeline-row-label[draggable="true"]'),
  ).toHaveCount(2);
  await page.getByRole("button", { name: "By person", exact: true }).click();
  await expect(alex).toHaveCount(1);
  expect(await (await request.get("/api/state")).json()).toEqual(before);
});
