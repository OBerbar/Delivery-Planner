import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { populatedFixture, fixedToday } from "../scripts/maintenance-fixture";
import { observeBrowser } from "../scripts/browser-observability";
import { schedule } from "../src/lib/planning";
import { timelinePreferencesKey } from "../src/lib/view-preferences";

const issues = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page, request }) => {
  issues.set(page, observeBrowser(page));
  await page.clock.install({ time: new Date(`${fixedToday}T12:00:00Z`) });
  const state = populatedFixture();
  state.features[1].doesntAffectOtherWork = true;
  for (const status of ["done", "doing", "blocked"] as const) {
    state.features.push({
      ...state.features[1],
      id: status,
      title: `${status} delivery`,
      priority: state.features.length,
      doesntAffectOtherWork: false,
      assigneeIds: ["q"],
      assigneeEstimates: [{ personId: "q", unit: "days", value: 1 }],
      estimateEffort: [{ personId: "q", hours: 8 }],
      status,
      ...(status === "done"
        ? { actualStart: "2030-01-03", actualEnd: "2030-01-04" }
        : {}),
      ...(status === "doing"
        ? { status: "done", actualStart: "2030-01-05", actualEnd: "2030-01-07" }
        : {}),
      ...(status === "blocked" ? { unblockDate: "2030-01-10" } : {}),
    });
  }
  const { revision } = await (await request.get("/api/state")).json();
  expect(
    (await request.put("/api/state", { data: { revision, state } })).ok(),
  ).toBeTruthy();
});
test.afterEach(async ({ page }) => expect(issues.get(page)).toEqual([]));
async function select(page: Page, label: string, option: string) {
  await page.getByRole("button", { name: new RegExp(label) }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

test("view, window, collapse and all display filters survive reload without saving planning data", async ({
  page,
  request,
}) => {
  await page.goto("/");
  const before = await (await request.get("/api/state")).json();
  await page.getByRole("button", { name: "By person", exact: true }).click();
  await page.getByRole("button", { name: "Week", exact: true }).click();
  await select(page, "Timeline range", "6 months");
  await page.getByRole("button", { name: "Next week", exact: true }).click();
  await page
    .getByRole("button", { name: "Collapse leaves and holidays", exact: true })
    .click();
  await select(page, "Filter by person", "Sam");
  await select(page, "Filter by sprint", "No assigned sprint");
  await select(page, "Filter by status", "Planned");
  await select(page, "Filter by risk", "No accepted date");
  await page.reload();
  await expect(
    page.getByRole("button", { name: "By person", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("button", { name: "Week", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("button", { name: /Timeline range/ }),
  ).toContainText("6 months");
  await expect(
    page.getByRole("button", { name: /Filter by person/ }),
  ).toContainText("Sam");
  await expect(
    page.getByRole("button", { name: /Filter by sprint/ }),
  ).toContainText("No assigned sprint");
  await expect(
    page.getByRole("button", { name: /Filter by status/ }),
  ).toContainText("Planned");
  await expect(
    page.getByRole("button", { name: /Filter by risk/ }),
  ).toContainText("No accepted date");
  await expect(
    page.getByRole("button", {
      name: "Expand leaves and holidays",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator(".week-bands")).toContainText("Jan 13");
  await expect(page.locator('.timeline-track[data-person-id="q"]')).toHaveCount(
    1,
  );
  await expect(page.locator('.timeline-track[data-person-id="p"]')).toHaveCount(
    0,
  );
  expect(await (await request.get("/api/state")).json()).toEqual(before);
  expect(schedule(before.state, fixedToday)).toEqual(
    schedule(
      (await (await request.get("/api/state")).json()).state,
      fixedToday,
    ),
  );
});

test("filters combine, preserve personal shading and reset empty matches without modifying forecasts", async ({
  page,
  request,
}) => {
  await page.goto("/");
  const before = await (await request.get("/api/state")).json();
  await page.getByRole("button", { name: "By person", exact: true }).click();
  await select(page, "Filter by person", "Sam");
  await select(page, "Filter by status", "Planned");
  const sam = page.locator('.timeline-track[data-person-id="q"]');
  await expect(sam.locator(".timeline-bar")).toHaveCount(2);
  await expect(
    sam.locator('.grid-cell.leave[data-date="2030-01-09"]'),
  ).toHaveAttribute("title", /Appointment/);
  await expect(
    sam.locator('.grid-cell.holiday[data-date="2030-01-14"]'),
  ).toHaveAttribute("title", /Winter break/);
  await select(page, "Filter by risk", "At risk");
  await expect(
    page.getByText("No features match these filters.", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Reset filters", exact: true })
    .click();
  await expect(
    page.getByText("No features match these filters.", { exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".timeline-track[data-person-id]")).toHaveCount(2);
  await expect(sam.locator(".timeline-bar")).toHaveCount(3);
  expect(await (await request.get("/api/state")).json()).toEqual(before);
});

test("status labels, parallel pattern and accepted date marker remain readable and keyboard accessible @a11y", async ({
  page,
}) => {
  await page.goto("/");
  await select(page, "Timeline range", "6 months");
  await page
    .getByRole("button", { name: "Previous week", exact: true })
    .click();
  for (const [status, label] of [
    ["todo", "Planned"],
    ["doing", "In progress"],
    ["done", "Done"],
  ]) {
    await expect(
      page.locator(`.timeline-bar.status-${status}`).first(),
    ).toContainText(label);
  }
  await expect(page.locator(".timeline-bar.parallel-work")).toContainText(
    "Parallel",
  );
  const marker = page.getByRole("img", {
    name: "Five sprint delivery: accepted delivery date 2030-03-08",
    exact: true,
  });
  await expect(marker).toBeVisible();
  await marker.focus();
  await expect(marker).toBeFocused();
  await expect(page.locator(".timeline-footer")).toContainText("Accepted date");
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.getByRole("button", { name: "By person", exact: true }).click();
  await expect(marker).toHaveCount(0);
});

test("malformed or denied storage falls back to a usable timeline", async ({
  page,
}) => {
  await page.addInitScript((key) => {
    try {
      localStorage.setItem(
        key,
        '{"version":1,"start":"2030-02-30","zoom":"hour","months":"99"}',
      );
    } catch {
      /* The following reload deliberately denies storage access. */
    }
  }, timelinePreferencesKey("a"));
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Month", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".week-bands")).toContainText("Jan 6");
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new DOMException("Denied", "SecurityError");
      },
    });
  });
  await page.reload();
  await page.getByRole("button", { name: "By person", exact: true }).click();
  await select(page, "Filter by person", "Sam");
  await expect(page.locator('.timeline-track[data-person-id="q"]')).toHaveCount(
    1,
  );
});

for (const [width, height] of [
  [744, 1133],
  [1133, 744],
  [1920, 1080],
  [3840, 2160],
]) {
  test(`timeline filters and labels fit at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height });
    await page.goto("/");
    await select(page, "Filter by status", "In progress");
    await page
      .getByRole("button", { name: "Reset filters", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: /Filter by person/ }),
    ).toBeVisible();
    await expect(page.locator(".timeline-bar.status-doing")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBeLessThanOrEqual(1);
    await page.screenshot({
      path: testInfo.outputPath(`timeline-refinements-${width}.png`),
    });
  });
}
