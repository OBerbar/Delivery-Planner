import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { maintenanceFixture, fixedToday } from "../scripts/maintenance-fixture";
import { observeBrowser } from "../scripts/browser-observability";
import { confirmSchedulingReview } from "./helpers/ui-workflows";
import { repeatedOccurrencesFixture } from "./occurrences-fixture";

for (const [name, width, height] of [
  ["desktop", 1440, 1000],
  ["iPad portrait", 744, 1133],
  ["iPad landscape", 1133, 744],
] as const) {
  test(`${name}: backlog moves preserve data, release capacity, cancel, reload and undo @a11y`, async ({
    page,
    request,
  }, testInfo) => {
    const issues = observeBrowser(page);
    await page.setViewportSize({ width, height });
    await page.clock.install({ time: new Date(`${fixedToday}T12:00:00Z`) });
    const state = maintenanceFixture();
    const { revision } = await (await request.get("/api/state")).json();
    expect(
      (await request.put("/api/state", { data: { state, revision } })).ok(),
    ).toBe(true);
    await page.goto("/");
    await page.getByRole("button", { name: /^Features(?:\s|$)/ }).click();
    await page
      .getByRole("button", {
        name: `Move ${state.features[0].title} to backlog`,
        exact: true,
      })
      .click();
    const review = page.getByRole("dialog", {
      name: "Review scheduling changes",
      exact: true,
    });
    await expect(review).toBeVisible();
    await review
      .getByRole("button", { name: "Keep editing", exact: true })
      .click();
    await expect
      .poll(async () => (await (await request.get("/api/state")).json()).state)
      .toEqual(state);
    await page
      .getByRole("button", {
        name: `Move ${state.features[0].title} to backlog`,
        exact: true,
      })
      .click();
    await expect(review).toBeVisible();
    await confirmSchedulingReview(page);
    await expect(
      page.getByText("Saved.", { exact: false }).first(),
    ).toBeVisible();
    const parked = await (await request.get("/api/state")).json();
    expect(parked.state.features[0]).toEqual({
      ...state.features[0],
      placement: "backlog",
    });
    expect(parked.state.sprints).toEqual(state.sprints);
    await page
      .getByRole("button", { name: "Backlog features", exact: true })
      .focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("button", { name: state.features[0].title, exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: state.features[0].title, exact: true })
      .click();
    const overview = page.getByRole("dialog", {
      name: "Feature overview",
      exact: true,
    });
    await expect(
      overview.getByText(/does not reserve capacity/i),
    ).toBeVisible();
    await expect(
      overview.getByRole("button", { name: "View on timeline", exact: true }),
    ).toBeDisabled();
    await page.keyboard.press("Escape");
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({
      path: testInfo.outputPath(`backlog-${width}.png`),
      fullPage: true,
    });
    await page.getByRole("button", { name: "Timeline", exact: true }).click();
    await expect(
      page.locator('.timeline-bar[data-feature-id="long"]'),
    ).toHaveCount(0);
    await expect(
      page.locator('.timeline-bar[data-feature-id="mixed"]').first(),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Undo last change", exact: true })
      .click();
    await expect(
      page.locator('.timeline-bar[data-feature-id="long"]').first(),
    ).toBeVisible();
    await expect
      .poll(async () => (await (await request.get("/api/state")).json()).state)
      .toEqual(state);
    await page.getByRole("button", { name: /^Features(?:\s|$)/ }).click();
    await page
      .getByRole("button", {
        name: `Move ${state.features[0].title} to backlog`,
        exact: true,
      })
      .click();
    await expect(review).toBeVisible();
    await confirmSchedulingReview(page);
    await expect(
      page.getByRole("button", {
        name: `Move ${state.features[0].title} to backlog`,
        exact: true,
      }),
    ).toHaveCount(0);
    await page.reload();
    await page.getByRole("button", { name: /^Features(?:\s|$)/ }).click();
    await page
      .getByRole("button", { name: "Backlog features", exact: true })
      .click();
    await page
      .getByRole("button", {
        name: `Move ${state.features[0].title} to timeline`,
        exact: true,
      })
      .click();
    await expect(review).toBeVisible();
    await confirmSchedulingReview(page);
    await expect(
      page.getByRole("button", {
        name: `Move ${state.features[0].title} to timeline`,
        exact: true,
      }),
    ).toHaveCount(0);
    await expect
      .poll(
        async () =>
          (await (await request.get("/api/state")).json()).state.features[0],
      )
      .toEqual({
        ...state.features[0],
        placement: "timeline",
      });
    expect(issues).toEqual([]);
  });
}

test("create in backlog, validate and edit placement without scheduling until saved", async ({
  page,
  request,
}, testInfo) => {
  await page.clock.install({ time: new Date(`${fixedToday}T12:00:00Z`) });
  const state = maintenanceFixture();
  const { revision } = await (await request.get("/api/state")).json();
  await request.put("/api/state", { data: { state, revision } });
  await page.goto("/");
  await page.getByRole("button", { name: /^Features(?:\s|$)/ }).click();
  await page
    .getByRole("button", { name: "Backlog features", exact: true })
    .click();
  await expect(
    page.getByText("Your backlog is empty", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Add feature", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "Add a feature",
    exact: true,
  });
  await expect(dialog.getByRole("button", { name: /Placement/ })).toContainText(
    "Backlog",
  );
  await dialog.getByRole("checkbox", { name: /Alex/ }).check();
  await dialog
    .getByRole("button", { name: "Save feature", exact: true })
    .click();
  await expect(dialog.getByText(/required/i).first()).toBeVisible();
  await dialog
    .getByLabel("Feature title", { exact: true })
    .fill("Later reporting");
  await dialog.getByRole("checkbox", { name: /Alex/ }).check();
  await page.screenshot({
    path: testInfo.outputPath("backlog-create.png"),
    fullPage: true,
  });
  await dialog
    .getByRole("button", { name: "Save feature", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  const saved = await (await request.get("/api/state")).json();
  expect(saved.state.features[0]).toMatchObject({
    title: "Later reporting",
    placement: "backlog",
    assigneeIds: ["p"],
  });
  await page
    .getByRole("button", { name: "Edit Later reporting", exact: true })
    .click();
  const editor = page.getByRole("dialog", {
    name: "Edit feature",
    exact: true,
  });
  await editor.getByRole("button", { name: /Placement/ }).click();
  await page.getByRole("option", { name: "Timeline", exact: true }).click();
  await editor.getByLabel("Feature title", { exact: true }).focus();
  await page.keyboard.press("Escape");
  await expect(editor).not.toBeVisible();
  expect(await (await request.get("/api/state")).json()).toEqual(saved);
  await page
    .getByRole("button", { name: "Timeline features", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: `Edit ${state.features[0].title}`,
      exact: true,
    })
    .click();
  await expect(editor.getByRole("button", { name: /Placement/ })).toContainText(
    "Timeline",
  );
  await editor
    .getByRole("button", { name: "Save feature", exact: true })
    .click();
  await expect(editor).not.toBeVisible();
  const legacySaved = await (await request.get("/api/state")).json();
  expect(
    legacySaved.state.features.find(
      (feature: { id: string }) => feature.id === "long",
    ),
  ).toEqual(
    saved.state.features.find(
      (feature: { id: string }) => feature.id === "long",
    ),
  );
});

test("priority arrows move between visible timeline features across parked features", async ({
  page,
  request,
}) => {
  await page.clock.install({ time: new Date(`${fixedToday}T12:00:00Z`) });
  const state = maintenanceFixture();
  state.features[1].priority = 2;
  state.features.splice(1, 0, {
    ...structuredClone(state.features[0]),
    id: "parked",
    title: "Parked work",
    priority: 1,
    placement: "backlog",
    committed: false,
    commitment: undefined,
  });
  const { revision } = await (await request.get("/api/state")).json();
  await request.put("/api/state", { data: { state, revision } });
  await page.goto("/");
  await page.getByRole("button", { name: /^Features(?:\s|$)/ }).click();
  await page
    .getByRole("button", {
      name: "Move Mixed person estimates up",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("dialog", {
      name: "Review scheduling changes",
      exact: true,
    }),
  ).toBeVisible();
  await confirmSchedulingReview(page);
  await expect(page.locator(".feature-item h3").first()).toHaveText(
    "Mixed person estimates",
  );
});

test("occurrence placement and drafts survive switching runs in What-if Apply and Discard", async ({
  page,
  request,
}) => {
  await page.clock.install({ time: new Date(`${fixedToday}T12:00:00Z`) });
  const state = repeatedOccurrencesFixture();
  const { revision } = await (await request.get("/api/state")).json();
  await request.put("/api/state", { data: { state, revision } });
  await page.goto("/");
  const before = await (await request.get("/api/state")).json();
  for (const apply of [false, true]) {
    await page.getByRole("button", { name: "Timeline", exact: true }).click();
    await page
      .getByRole("button", { name: "What-if planning", exact: true })
      .click();
    await page.locator('.timeline-bar[data-feature-id="long"]').first().click();
    const editor = page.getByRole("dialog", {
      name: "Edit feature",
      exact: true,
    });
    await editor.getByRole("button", { name: /Placement/ }).click();
    await page.getByRole("option", { name: "Backlog", exact: true }).click();
    await editor
      .getByLabel("Description", { exact: true })
      .fill("Updated first occurrence");
    await editor.getByRole("button", { name: /Editing occurrence/ }).click();
    await page.getByRole("option", { name: /^Occurrence 2/ }).click();
    await expect(
      editor.getByRole("button", { name: /Placement/ }),
    ).toContainText("Backlog");
    await editor
      .getByLabel("Description", { exact: true })
      .fill("Updated second occurrence");
    await editor
      .getByRole("button", { name: "Save feature", exact: true })
      .click();
    await expect(editor).not.toBeVisible();
    await expect(page.locator(".timeline-bar")).toHaveCount(0);
    expect(await (await request.get("/api/state")).json()).toEqual(before);
    await page
      .getByRole("button", {
        name: apply ? "Apply experiment" : "Discard experiment",
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("region", { name: "What-if experiment", exact: true }),
    ).toHaveCount(0);
    if (!apply) {
      await expect(
        page.locator('.timeline-bar[data-feature-id="long"]').first(),
      ).toBeVisible();
      expect(await (await request.get("/api/state")).json()).toEqual(before);
    }
  }
  const after = await (await request.get("/api/state")).json();
  expect(after.revision).toBe(before.revision + 1);
  expect(after.state.features).toEqual(
    state.features.map((feature, index) => ({
      ...feature,
      placement: "backlog",
      description:
        index === 0
          ? "Updated first occurrence"
          : index === 1
            ? "Updated second occurrence"
            : feature.description,
    })),
  );
  expect(after.state.sprints).toEqual(state.sprints);
});
