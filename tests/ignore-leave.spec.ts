import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { maintenanceFixture, fixedToday } from "../scripts/maintenance-fixture";
import { observeBrowser } from "../scripts/browser-observability";
import {
  openFeatureSection,
  confirmSchedulingReview,
} from "./helpers/ui-workflows";
import { schedule } from "../src/lib/planning";

for (const [name, width, height] of [
  ["desktop", 1440, 1000],
  ["iPad portrait", 744, 1133],
  ["iPad landscape", 1133, 744],
] as const) {
  test(`${name}: ignore leave toggles with keyboard, validates, saves, reloads and cancels @a11y`, async ({
    page,
    request,
  }) => {
    const issues = observeBrowser(page);
    await page.setViewportSize({ width, height });
    await page.clock.install({ time: new Date(`${fixedToday}T12:00:00Z`) });
    const state = maintenanceFixture();
    state.features = [state.features[0]];
    state.leaves = [
      {
        id: "l",
        personId: "p",
        start: "2030-01-07",
        end: "2030-01-08",
        hours: null,
        note: "Away",
      },
    ];
    const { revision } = await (await request.get("/api/state")).json();
    expect(
      (await request.put("/api/state", { data: { state, revision } })).ok(),
    ).toBe(true);
    await page.goto("/");
    const edit = async () => {
      await page
        .locator('.timeline-bar[data-feature-id="long"]')
        .first()
        .click();
      await openFeatureSection(page, "Scheduling options");
      return page.getByRole("dialog", { name: "Edit feature", exact: true });
    };
    let dialog = await edit();
    const toggle = () =>
      dialog.getByRole("checkbox", { name: "Ignore leave", exact: true });
    await expect(toggle()).not.toBeChecked();
    await toggle().focus();
    await expect(toggle()).toBeFocused();
    await page.keyboard.press("Space");
    await expect(toggle()).toBeChecked();
    await dialog.getByLabel("Feature title", { exact: true }).fill("");
    await dialog
      .getByRole("button", { name: "Save feature", exact: true })
      .click();
    await expect(dialog.getByText(/required/i).first()).toBeVisible();
    await expect(toggle()).toBeChecked();
    await dialog
      .getByLabel("Feature title", { exact: true })
      .fill(state.features[0].title);
    expect(
      (await new AxeBuilder({ page }).include('[role="dialog"]').analyze())
        .violations,
    ).toEqual([]);
    await toggle().scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `test-results/ignore-leave-${width}x${height}.png`,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await dialog
      .getByRole("button", { name: "Save feature", exact: true })
      .click();
    await confirmSchedulingReview(page);
    await expect(dialog).not.toBeVisible();
    const saved = await (await request.get("/api/state")).json();
    expect(saved.state.features[0].ignoreLeave).toBe(true);
    expect(saved.state.features[0].estimateEffort).toEqual(
      state.features[0].estimateEffort,
    );
    expect(saved.state.features[0].commitment).toEqual(
      state.features[0].commitment,
    );
    expect(schedule(saved.state, fixedToday).features.long.end).toBe(
      "2030-03-15",
    );
    await page.reload();
    dialog = await edit();
    await expect(toggle()).toBeChecked();
    await toggle().uncheck();
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    expect(await (await request.get("/api/state")).json()).toEqual(saved);
    dialog = await edit();
    await expect(toggle()).toBeChecked();
    await toggle().uncheck();
    await dialog
      .getByRole("button", { name: "Save feature", exact: true })
      .click();
    await confirmSchedulingReview(page);
    await expect(dialog).not.toBeVisible();
    const cleared = await (await request.get("/api/state")).json();
    expect(cleared.state.features[0].ignoreLeave).toBe(false);
    expect(schedule(cleared.state, fixedToday).features.long.end).toBe(
      "2030-03-19",
    );
    await page
      .getByRole("button", { name: "Undo last change", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (await (await request.get("/api/state")).json()).state.features[0]
            .ignoreLeave,
      )
      .toBe(true);
    expect(issues).toEqual([]);
  });
}

test("new features can ignore leave before their first save", async ({
  page,
  request,
}) => {
  await page.clock.install({ time: new Date(`${fixedToday}T12:00:00Z`) });
  const state = maintenanceFixture();
  state.features = [];
  const { revision } = await (await request.get("/api/state")).json();
  await request.put("/api/state", { data: { state, revision } });
  await page.goto("/");
  await page.getByRole("button", { name: "Add feature", exact: true }).click();
  await page
    .getByLabel("Feature title", { exact: true })
    .fill("Leave independent feature");
  await page.getByLabel("Main assignee: Alex", { exact: true }).check();
  await openFeatureSection(page, "Scheduling options");
  await page
    .getByRole("checkbox", { name: "Ignore leave", exact: true })
    .check();
  await page.getByRole("button", { name: "Save feature", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(
    (await (await request.get("/api/state")).json()).state.features[0]
      .ignoreLeave,
  ).toBe(true);
});
