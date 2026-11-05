import AxeBuilder from "@axe-core/playwright";
import { observeBrowser } from "../scripts/browser-observability";
import { schedule } from "../src/lib/planning";
import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
import {
  occurrencesFixture,
  repeatedOccurrencesFixture,
} from "./occurrences-fixture";

const edit = (page: Page) =>
  page.getByRole("dialog", { name: "Edit feature", exact: true });
const bars = (page: Page) =>
  page.locator(
    ".timeline-track[data-track-feature-id] .timeline-bar:not(.task-bar)",
  );
async function pickSprint(page: Page, sprint: number) {
  await edit(page)
    .getByRole("button", { name: /Assigned sprint/ })
    .click();
  await page
    .getByRole("option", { name: new RegExp(`^Sprint ${sprint} ·`) })
    .click();
}
async function save(page: Page) {
  await edit(page)
    .getByRole("button", { name: "Save feature", exact: true })
    .click();
  const review = page.getByRole("dialog", {
    name: "Review scheduling changes",
    exact: true,
  });
  if (await review.isVisible())
    await review
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
  await expect(edit(page)).not.toBeVisible();
}

test.beforeEach(async ({ page, request }) => {
  await page.clock.install({ time: new Date("2030-01-06T12:00:00Z") });
  const { revision } = await (await request.get("/api/state")).json();
  expect(
    (
      await request.put("/api/state", {
        data: { state: occurrencesFixture(), revision },
      })
    ).ok(),
  ).toBe(true);
  await page.goto("/");
});

test("adds three independently sized sprint occurrences on one task row and reloads them", async ({
  page,
  request,
}) => {
  await bars(page).first().click();
  await edit(page)
    .getByRole("button", { name: "Add occurrence", exact: true })
    .click();
  await pickSprint(page, 2);
  await edit(page)
    .getByRole("spinbutton", { name: /^Working days estimation/ })
    .fill("1");
  await save(page);
  await expect(bars(page)).toHaveCount(2);
  await expect(
    page.locator(".timeline-track[data-track-feature-id]"),
  ).toHaveCount(1);
  await bars(page).last().click();
  await expect(
    edit(page).getByRole("spinbutton", { name: /^Working days estimation/ }),
  ).toHaveValue("1");
  await edit(page)
    .getByRole("button", { name: "Add occurrence", exact: true })
    .click();
  await pickSprint(page, 3);
  await edit(page)
    .getByRole("spinbutton", { name: /^Working days estimation/ })
    .fill("3");
  await save(page);
  await expect(bars(page)).toHaveCount(3);
  const saved = await (await request.get("/api/state")).json();
  expect(
    saved.state.features.map((f: any) => f.assigneeEstimates[0].value),
  ).toEqual([2, 1, 3]);
  expect(
    saved.state.features.map((f: any) => f.estimateEffort[0].hours),
  ).toEqual([16, 8, 24]);
  await page.reload();
  await expect(bars(page)).toHaveCount(3);
  await expect(
    page.locator(".timeline-track[data-track-feature-id]"),
  ).toHaveCount(1);
});

async function seed(
  page: Page,
  request: APIRequestContext,
  state = repeatedOccurrencesFixture(),
) {
  const { revision } = await (await request.get("/api/state")).json();
  expect(
    (await request.put("/api/state", { data: { state, revision } })).ok(),
  ).toBe(true);
  await page.reload();
}
async function selectOccurrence(page: Page, number: number) {
  await edit(page)
    .getByRole("button", { name: /Editing occurrence/ })
    .click();
  await page
    .getByRole("option", { name: new RegExp(`^Occurrence ${number} ·`) })
    .click();
}
test("switching occurrences preserves each accepted commitment", async ({
  page,
  request,
}) => {
  const state = repeatedOccurrencesFixture();
  state.features[0].committed = true;
  state.features[0].commitment = {
    end: "2030-01-18",
    acceptedAt: "2030-01-05",
  };
  state.features[1].committed = true;
  state.features[1].commitment = {
    end: "2030-02-01",
    acceptedAt: "2030-01-06",
  };
  await seed(page, request, state);
  await bars(page).first().click();
  await selectOccurrence(page, 2);
  const toggle = edit(page).getByRole("checkbox", {
    name: "Accept delivery date",
    exact: true,
  });
  await toggle.uncheck();
  await toggle.check();
  await save(page);
  const saved = await (await request.get("/api/state")).json();
  expect(saved.state.features.map((f: any) => f.commitment)).toEqual(
    state.features.map((f) => f.commitment),
  );
});

test("adding from an edited unsaved occurrence books the edited effort for both runs", async ({
  page,
  request,
}) => {
  await bars(page).first().click();
  await edit(page)
    .getByRole("spinbutton", { name: /^Working days estimation/ })
    .fill("3");
  await edit(page)
    .getByRole("button", { name: "Add occurrence", exact: true })
    .click();
  await pickSprint(page, 2);
  await save(page);
  const saved = await (await request.get("/api/state")).json();
  expect(
    saved.state.features.map((f: any) => f.estimateEffort[0].hours),
  ).toEqual([24, 24]);
});

test("switching preserves drafts, updates only selected effort and shares the title", async ({
  page,
  request,
}) => {
  await seed(page, request);
  const before = await (await request.get("/api/state")).json();
  await bars(page).nth(1).click();
  await edit(page)
    .getByRole("spinbutton", { name: /^Working days estimation/ })
    .fill("1.5");
  await edit(page)
    .getByLabel("Feature title", { exact: true })
    .fill("Retest payments");
  await selectOccurrence(page, 1);
  await expect(
    edit(page).getByRole("spinbutton", { name: /^Working days estimation/ }),
  ).toHaveValue("2");
  await selectOccurrence(page, 2);
  await expect(
    edit(page).getByRole("spinbutton", { name: /^Working days estimation/ }),
  ).toHaveValue("1.5");
  await save(page);
  const saved = await (await request.get("/api/state")).json();
  expect(saved.state.features[0]).toEqual({
    ...before.state.features[0],
    title: "Retest payments",
  });
  expect(saved.state.features[2]).toEqual({
    ...before.state.features[2],
    title: "Retest payments",
  });
  expect(saved.state.features[1].estimateEffort[0].hours).toBe(12);
  expect(saved.state.sprints).toEqual(before.state.sprints);
});

test("Cancel, Escape and close discard occurrence drafts without saving", async ({
  page,
  request,
}) => {
  const before = await (await request.get("/api/state")).json();
  for (const action of ["Cancel", "Escape", "Close dialog"]) {
    await bars(page).first().click();
    await edit(page)
      .getByRole("button", { name: "Add occurrence", exact: true })
      .click();
    await pickSprint(page, 2);
    if (action === "Escape") {
      await edit(page).getByLabel("Feature title", { exact: true }).focus();
      await page.keyboard.press("Escape");
    } else
      await edit(page)
        .getByRole("button", { name: action, exact: true })
        .click();
    await expect(edit(page)).not.toBeVisible();
    expect(await (await request.get("/api/state")).json()).toEqual(before);
  }
});

test("deletes just the selected original occurrence and Undo restores the grouped row", async ({
  page,
  request,
}) => {
  await seed(page, request);
  const before = await (await request.get("/api/state")).json();
  await bars(page).first().click();
  page.once("dialog", (d) => d.dismiss());
  await edit(page)
    .getByRole("button", { name: "Delete occurrence", exact: true })
    .click();
  await expect(edit(page)).toBeVisible();
  expect(await (await request.get("/api/state")).json()).toEqual(before);
  page.once("dialog", (d) => d.accept());
  await edit(page)
    .getByRole("button", { name: "Delete occurrence", exact: true })
    .click();
  await expect(bars(page)).toHaveCount(2);
  await expect(
    page.locator(".timeline-track[data-track-feature-id]"),
  ).toHaveCount(1);
  const saved = await (await request.get("/api/state")).json();
  expect(saved.state.features).toEqual(before.state.features.slice(1));
  await page
    .getByRole("button", { name: "Undo last change", exact: true })
    .click();
  await expect(bars(page)).toHaveCount(3);
  expect((await (await request.get("/api/state")).json()).state).toEqual(
    before.state,
  );
});

test("sprint and status filters apply to occurrences and Features keeps one shared entry", async ({
  page,
  request,
}) => {
  await seed(page, request);
  await page.getByRole("button", { name: /Filter by sprint/ }).click();
  await page.getByRole("option", { name: "Sprint 2", exact: true }).click();
  await expect(bars(page)).toHaveCount(1);
  await expect(bars(page)).toHaveAttribute("data-feature-id", "second");
  await page
    .getByRole("button", { name: "Reset filters", exact: true })
    .click();
  await expect(bars(page)).toHaveCount(3);
  await page.clock.setSystemTime(new Date("2030-01-23T12:00:00Z"));
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(bars(page).first()).toContainText("Done");
  await expect(bars(page).last()).toContainText("Planned");
  await page.getByRole("button", { name: /Filter by status/ }).click();
  await page.getByRole("option", { name: "Done", exact: true }).click();
  await expect(bars(page)).toHaveCount(2);
  await page.getByRole("button", { name: /^Features(?:\s|$)/ }).click();
  await expect(
    page.getByRole("button", { name: "Features 1", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".feature-item")).toHaveCount(1);
  await expect(page.locator(".feature-occurrence-list > article")).toHaveCount(
    3,
  );
});

for (const [label, width, height] of [
  ["desktop", 1440, 1000],
  ["iPad portrait", 744, 1133],
  ["iPad landscape", 1133, 744],
] as const) {
  test(`${label}: occurrence controls support keyboard, validation and responsive layout @a11y`, async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width, height });
    await seed(page, request);
    const issues = observeBrowser(page);
    await bars(page).nth(1).click();
    const add = edit(page).getByRole("button", {
      name: "Add occurrence",
      exact: true,
    });
    await add.focus();
    await expect(add).toBeFocused();
    await page.keyboard.press("Enter");
    await pickSprint(page, 3);
    const estimate = edit(page).getByRole("spinbutton", {
      name: /^Working days estimation/,
    });
    await estimate.fill("0");
    await edit(page)
      .getByRole("button", { name: "Save feature", exact: true })
      .click();
    await expect(edit(page).getByRole("alert")).toBeVisible();
    await estimate.fill("0.5");
    expect(
      (await new AxeBuilder({ page }).include('[role="dialog"]').analyze())
        .violations,
    ).toEqual([]);
    await edit(page)
      .getByLabel("Feature title", { exact: true })
      .scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `test-results/occurrences-${width}x${height}-editor.png`,
    });
    await save(page);
    await expect(bars(page)).toHaveCount(4);
    await page.screenshot({
      path: `test-results/occurrences-${width}x${height}-timeline.png`,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(issues).toEqual([]);
  });
}

test("new occurrences can explicitly record a past sprint without moving earlier runs", async ({
  page,
  request,
}) => {
  await expect(bars(page).first()).toBeVisible();
  await page.clock.setSystemTime(new Date("2030-02-10T12:00:00Z"));
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await bars(page).first().click();
  await edit(page)
    .getByRole("button", { name: "Add occurrence", exact: true })
    .click();
  await pickSprint(page, 2);
  await save(page);
  const saved = await (await request.get("/api/state")).json();
  expect(saved.state.features[0].planningFrom).toBe("2030-01-06");
  expect(saved.state.features[1].planningFrom).toBe("2030-01-21");
  const forecast = schedule(saved.state, "2030-02-10");
  expect(forecast.features[saved.state.features[1].id].start).toBe(
    "2030-01-21",
  );
  await expect(bars(page).last()).toContainText("Done");
});

test("saving several drafts cleans dependencies on a removed breakdown", async ({
  page,
  request,
}) => {
  const state = repeatedOccurrencesFixture();
  state.features[0].tasks = [
    {
      id: "first-task",
      title: "First pass",
      personId: "p",
      scope: "Backend",
      hours: 16,
      status: "todo",
      dependsOn: [],
    },
  ];
  state.features[1].tasks = [
    {
      id: "second-task",
      title: "Next pass",
      personId: "p",
      scope: "Backend",
      hours: 8,
      status: "todo",
      dependsOn: ["first-task"],
    },
  ];
  await seed(page, request, state);
  await bars(page).first().click();
  await edit(page)
    .getByRole("checkbox", { name: "Add optional task breakdown", exact: true })
    .uncheck();
  await selectOccurrence(page, 2);
  await save(page);
  const saved = await (await request.get("/api/state")).json();
  expect(saved.state.features[0].tasks).toEqual([]);
  expect(saved.state.features[1].tasks[0].dependsOn).toEqual([]);
});

test("unsaved repeat deletion removes its draft and saving keeps the original unchanged", async ({
  page,
  request,
}) => {
  const before = await (await request.get("/api/state")).json();
  await bars(page).first().click();
  await edit(page)
    .getByRole("button", { name: "Add occurrence", exact: true })
    .click();
  page.once("dialog", (d) => d.accept());
  await edit(page)
    .getByRole("button", { name: "Delete occurrence", exact: true })
    .click();
  await expect(
    edit(page).getByRole("spinbutton", { name: /^Working days estimation/ }),
  ).toHaveValue("2");
  await save(page);
  const saved = await (await request.get("/api/state")).json();
  expect(saved.state).toEqual(before.state);
});

test("What-if occurrence additions remain temporary until applied", async ({
  page,
  request,
}) => {
  const before = await (await request.get("/api/state")).json();
  await page
    .getByRole("button", { name: "What-if planning", exact: true })
    .click();
  await bars(page).first().click();
  await edit(page)
    .getByRole("button", { name: "Add occurrence", exact: true })
    .click();
  await pickSprint(page, 2);
  await save(page);
  await expect(bars(page)).toHaveCount(2);
  expect(await (await request.get("/api/state")).json()).toEqual(before);
  await page
    .getByRole("button", { name: "Discard experiment", exact: true })
    .click();
  await expect(bars(page)).toHaveCount(1);
  expect(await (await request.get("/api/state")).json()).toEqual(before);
});
