import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { maintenanceFixture, fixedToday } from "../scripts/maintenance-fixture";
import { observeBrowser } from "../scripts/browser-observability";

function overviewFixture() {
  const state = maintenanceFixture();
  const feature = state.features[0];
  feature.title = "Checkout overview";
  feature.committed = false;
  delete feature.commitment;
  feature.assigneeIds = ["p", "q"];
  feature.assigneeEstimates = [
    { personId: "p", unit: "days", value: 2 },
    { personId: "q", unit: "days", value: 3 },
  ];
  delete feature.sprintEstimate;
  feature.estimateEffort = [
    { personId: "p", hours: 16 },
    { personId: "q", hours: 24 },
  ];
  feature.priority = 1;
  state.features = [
    {
      ...structuredClone(feature),
      id: "urgent",
      title: "Urgent fix",
      priority: 0,
      assigneeIds: ["p"],
      assigneeEstimates: [{ personId: "p", unit: "days", value: 1 }],
      estimateEffort: [{ personId: "p", hours: 8 }],
    },
    feature,
  ];
  state.leaves = [
    {
      id: "leave",
      personId: "q",
      start: "2030-01-08",
      end: "2030-01-08",
      hours: null,
      note: "Appointment",
    },
  ];
  return state;
}

test.beforeEach(async ({ page, request }) => {
  await page.clock.install({ time: new Date(`${fixedToday}T12:00:00Z`) });
  const { revision } = await (await request.get("/api/state")).json();
  expect(
    (
      await request.put("/api/state", {
        data: { state: overviewFixture(), revision },
      })
    ).ok(),
  ).toBe(true);
  await page.goto("/");
  await page.getByRole("button", { name: /^Features(?:\s|$)/ }).click();
});

test("feature name opens read-only overview with effort, dates and constraints without a commitment", async ({
  page,
  request,
}) => {
  const issues = observeBrowser(page);
  const before = await (await request.get("/api/state")).json();
  const trigger = page.getByRole("button", {
    name: "Checkout overview",
    exact: true,
  });
  await trigger.click();
  const dialog = page.getByRole("dialog", {
    name: "Feature overview",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByText("Jan 7, 2030", { exact: true }).first(),
  ).toBeVisible();
  await expect(
    dialog.getByText("Jan 10, 2030", { exact: true }).first(),
  ).toBeVisible();
  await expect(dialog).toContainText("4 calendar days");
  await expect(
    dialog.getByRole("heading", {
      name: "What shapes this forecast?",
      exact: true,
    }),
  ).toBeVisible();
  await expect(dialog).toContainText("Urgent fix");
  await expect(dialog).toContainText("Appointment");
  await expect(dialog).toContainText("Sam determines delivery");
  await expect(
    dialog.getByRole("region", { name: "Alex effort and dates", exact: true }),
  ).toContainText("2 working days");
  await expect(
    dialog.getByRole("region", { name: "Sam effort and dates", exact: true }),
  ).toContainText("3 working days");
  await expect(
    dialog.getByRole("figure", {
      name: "Person delivery timeline",
      exact: true,
    }),
  ).toBeVisible();
  await dialog
    .getByRole("button", { name: "Edit feature", exact: true })
    .focus();
  await page.keyboard.press("Tab");
  await expect(
    dialog.getByRole("button", { name: "Close dialog", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(
    dialog.getByRole("button", { name: "Edit feature", exact: true }),
  ).toBeFocused();
  expect(await (await request.get("/api/state")).json()).toEqual(before);
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
  expect(await (await request.get("/api/state")).json()).toEqual(before);
  expect(issues).toEqual([]);
});

test("pencil and overview Edit feature retain editing and cancel without changing records", async ({
  page,
  request,
}) => {
  const before = await (await request.get("/api/state")).json();
  await page
    .getByRole("button", { name: "Edit Checkout overview", exact: true })
    .click();
  let editor = page.getByRole("dialog", { name: "Edit feature", exact: true });
  await expect(editor.getByLabel("Feature title", { exact: true })).toHaveValue(
    "Checkout overview",
  );
  await editor.getByRole("button", { name: "Cancel", exact: true }).click();
  await page
    .getByRole("button", { name: "Checkout overview", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Feature overview", exact: true })
    .getByRole("button", { name: "Edit feature", exact: true })
    .click();
  editor = page.getByRole("dialog", { name: "Edit feature", exact: true });
  await expect(editor).toBeVisible();
  await expect(editor.getByLabel("Feature title", { exact: true })).toHaveValue(
    "Checkout overview",
  );
  await expect
    .poll(() =>
      editor.evaluate((element) => element.contains(document.activeElement)),
    )
    .toBe(true);
  await editor
    .getByLabel("Feature title", { exact: true })
    .fill("Unsaved change");
  await page.keyboard.press("Escape");
  await expect(editor).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "Checkout overview", exact: true }),
  ).toBeFocused();
  expect(await (await request.get("/api/state")).json()).toEqual(before);
});

test("View on timeline reveals and focuses the feature despite saved filters", async ({
  page,
  request,
}) => {
  const before = await (await request.get("/api/state")).json();
  await page.getByRole("button", { name: "Timeline", exact: true }).click();
  await page.getByRole("button", { name: /Filter by status/ }).click();
  await page.getByRole("option", { name: "Done", exact: true }).click();
  await expect(
    page.locator('.timeline-bar[data-feature-id="long"]'),
  ).toHaveCount(0);
  await page.getByRole("button", { name: /^Features(?:\s|$)/ }).click();
  await page
    .getByRole("button", { name: "Checkout overview", exact: true })
    .click();
  await page
    .getByRole("button", { name: "View on timeline", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const bar = page.locator(
    '.timeline-bar[data-feature-id="long"]:not(.task-bar)',
  );
  await expect(bar).toBeVisible();
  await expect(bar).toBeFocused();
  await expect(
    page.getByRole("button", { name: /Filter by status/ }),
  ).toContainText("All statuses");
  expect(await (await request.get("/api/state")).json()).toEqual(before);
});

for (const [name, width, height] of [
  ["desktop", 1440, 1000],
  ["iPad portrait", 744, 1133],
  ["iPad landscape", 1133, 744],
  ["phone", 390, 844],
] as const) {
  test(`${name}: shared whole-team summary expands by keyboard, is accessible and fits @a11y`, async ({
    page,
    request,
  }) => {
    const issues = observeBrowser(page);
    await page.setViewportSize({ width, height });
    const state = overviewFixture();
    state.features[1].assigneeEstimates![1].value = 2;
    state.features[1].estimateEffort![1].hours = 16;
    const { revision } = await (await request.get("/api/state")).json();
    await request.put("/api/state", { data: { state, revision } });
    await page.reload();
    await page.getByRole("button", { name: /^Features(?:\s|$)/ }).click();
    const before = await (await request.get("/api/state")).json();
    await page
      .getByRole("button", { name: "Checkout overview", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Feature overview",
      exact: true,
    });
    await expect(dialog).toContainText(
      "2 working days each · whole team · 2 people",
    );
    const summary = dialog.locator("summary", {
      hasText: "Per-person breakdown",
    });
    await expect(
      dialog.getByRole("region", {
        name: "Alex effort and dates",
        exact: true,
      }),
    ).toBeHidden();
    await summary.focus();
    await expect(summary).toBeFocused();
    await page.keyboard.press("Space");
    await expect(
      dialog.getByRole("region", {
        name: "Alex effort and dates",
        exact: true,
      }),
    ).toBeVisible();
    await expect(dialog).toContainText(
      "Alex and Sam determine delivery together",
    );
    const constraints = dialog.getByRole("region", {
      name: "Forecast constraints",
      exact: true,
    });
    await expect(
      constraints.getByText("Sets delivery date", { exact: true }),
    ).toHaveCount(2);
    for (const person of ["Alex", "Sam"]) {
      await expect(
        constraints
          .getByRole("region", {
            name: `${person} forecast constraints`,
            exact: true,
          })
          .locator(":scope > details"),
      ).toHaveAttribute("open", "");
    }
    expect(
      (await new AxeBuilder({ page }).include('[role="dialog"]').analyze())
        .violations,
    ).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `test-results/feature-overview-${width}x${height}.png`,
    });
    await page.keyboard.press("Space");
    await expect(
      dialog.getByRole("region", {
        name: "Alex effort and dates",
        exact: true,
      }),
    ).toBeHidden();
    await dialog
      .getByRole("button", { name: "Close overview", exact: true })
      .click();
    await expect(dialog).not.toBeVisible();
    expect(await (await request.get("/api/state")).json()).toEqual(before);
    expect(issues).toEqual([]);
  });
}

test("shows accepted risk and Ignore leave while excluding that leave from constraints", async ({
  page,
  request,
}) => {
  const state = overviewFixture();
  state.features[1].ignoreLeave = true;
  state.features[1].committed = true;
  state.features[1].commitment = { end: "2030-01-07", acceptedAt: fixedToday };
  const { revision } = await (await request.get("/api/state")).json();
  await request.put("/api/state", { data: { state, revision } });
  await page.reload();
  await page.getByRole("button", { name: /^Features(?:\s|$)/ }).click();
  await page
    .getByRole("button", { name: "Checkout overview", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Feature overview",
    exact: true,
  });
  await expect(dialog).toContainText("Ignore leave: On");
  await expect(dialog).toContainText("Accepted delivery: Jan 7, 2030");
  await expect(dialog).toContainText("At risk");
  await expect(dialog).toContainText("Urgent fix");
  await expect(
    dialog.getByRole("region", { name: "Forecast constraints", exact: true }),
  ).not.toContainText("Appointment");
});

test("unscheduled work has warnings and no invented finish or delivery determiner", async ({
  page,
  request,
}) => {
  const state = overviewFixture();
  state.features[1].tasks = [
    {
      id: "cycle",
      title: "Cycle task",
      personId: "p",
      scope: "Backend",
      hours: 8,
      status: "todo",
      dependsOn: ["cycle"],
    },
  ];
  const { revision } = await (await request.get("/api/state")).json();
  await request.put("/api/state", { data: { state, revision } });
  await page.reload();
  await page.getByRole("button", { name: /^Features(?:\s|$)/ }).click();
  const before = await (await request.get("/api/state")).json();
  await page
    .getByRole("button", { name: "Checkout overview", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Feature overview",
    exact: true,
  });
  await expect(dialog).toContainText("Dependency cycle");
  await expect(dialog).toContainText("Delivery is not fully scheduled");
  await expect(dialog).not.toContainText("Alex determines delivery");
  const constraints = dialog.getByRole("region", {
    name: "Forecast constraints",
    exact: true,
  });
  await expect(
    constraints.getByText("Prevents a complete forecast", { exact: true }),
  ).toBeVisible();
  await expect(
    constraints.getByText("Sets delivery date", { exact: true }),
  ).toHaveCount(0);
  await expect(
    dialog.getByRole("figure", {
      name: "Person delivery timeline",
      exact: true,
    }),
  ).toContainText(
    "A complete timeline appears when all work has scheduled dates",
  );
  await dialog
    .getByRole("button", { name: "View on timeline", exact: true })
    .click();
  await expect(
    page.locator('button.unscheduled[data-feature-id="long"]'),
  ).toBeFocused();
  expect(await (await request.get("/api/state")).json()).toEqual(before);
});

test("completed legacy work retains historical dates without inventing recorded allocation or current causes", async ({
  page,
  request,
}) => {
  const state = overviewFixture();
  state.features[1].status = "done";
  state.features[1].actualStart = "2029-12-03";
  state.features[1].actualEnd = "2029-12-05";
  const { revision } = await (await request.get("/api/state")).json();
  await request.put("/api/state", { data: { state, revision } });
  await page.reload();
  await page.getByRole("button", { name: /^Features(?:\s|$)/ }).click();
  await page
    .getByRole("button", { name: "Checkout overview", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Feature overview",
    exact: true,
  });
  await expect(dialog).toContainText("Dec 3, 2029");
  await expect(dialog).toContainText("Dec 5, 2029");
  await expect(dialog).toContainText("Not recorded");
  await expect(dialog).toContainText("Historical causes are not reconstructed");
});

test("What-if overview uses temporary forecasts without saving", async ({
  page,
  request,
}) => {
  const before = await (await request.get("/api/state")).json();
  await page.getByRole("button", { name: "Timeline", exact: true }).click();
  await page
    .getByRole("button", { name: "What-if planning", exact: true })
    .click();
  await page.getByRole("button", { name: /^Features(?:\s|$)/ }).click();
  await page
    .getByRole("button", { name: "Checkout overview", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Feature overview",
    exact: true,
  });
  await expect(dialog).toContainText("What-if forecast");
  expect(await (await request.get("/api/state")).json()).toEqual(before);
  await dialog
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
});

test("whole-team summary preserves equal saved estimates when allocations produce different effort", async ({
  page,
  request,
}) => {
  const state = overviewFixture();
  state.members[1].allocation = 50;
  state.features[1].assigneeEstimates = [
    { personId: "p", unit: "days", value: 5 },
    { personId: "q", unit: "days", value: 5 },
  ];
  state.features[1].estimateEffort = [
    { personId: "p", hours: 40 },
    { personId: "q", hours: 20 },
  ];
  const { revision } = await (await request.get("/api/state")).json();
  await request.put("/api/state", { data: { state, revision } });
  await page.reload();
  await page.getByRole("button", { name: /^Features(?:\s|$)/ }).click();
  await page
    .getByRole("button", { name: "Checkout overview", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Feature overview",
    exact: true,
  });
  await expect(dialog).toContainText(
    "5 working days each · whole team · 2 people",
  );
  await dialog.locator("summary", { hasText: "Per-person breakdown" }).click();
  const sam = dialog.getByRole("region", {
    name: "Sam effort and dates",
    exact: true,
  });
  await expect(sam).toContainText("50% allocation");
  await expect(sam).toContainText("Saved estimate5 working days");
  await expect(sam).toContainText("Estimated effort2.5 working days");
});

for (const [name, width, height] of [
  ["desktop", 1440, 1000],
  ["iPad portrait", 744, 1133],
  ["iPad landscape", 1133, 744],
  ["phone", 390, 844],
] as const) {
  test(`${name}: compact forecast prioritizes delivery and keeps weekends in read-only details @a11y`, async ({
    page,
    request,
  }) => {
    const issues = observeBrowser(page);
    await page.setViewportSize({ width, height });
    const state = overviewFixture();
    state.features[1].assigneeEstimates![1].value = 6;
    state.features[1].estimateEffort![1].hours = 48;
    state.holidays = [
      {
        id: "winter",
        appId: "a",
        date: "2030-01-09",
        name: "Winter break",
        personIds: ["q"],
      },
    ];
    const { revision } = await (await request.get("/api/state")).json();
    expect(
      (await request.put("/api/state", { data: { state, revision } })).ok(),
    ).toBe(true);
    await page.reload();
    await page.getByRole("button", { name: /^Features(?:\s|$)/ }).click();
    const before = await (await request.get("/api/state")).json();
    await page
      .getByRole("button", { name: "Checkout overview", exact: true })
      .click();
    const constraints = page.getByRole("region", {
      name: "Forecast constraints",
      exact: true,
    });
    await expect(
      constraints.getByText("Sam sets delivery on Jan 16, 2030.", {
        exact: true,
      }),
    ).toBeVisible();
    const people = constraints.locator(".forecast-person");
    await expect(people.first()).toHaveAttribute(
      "aria-label",
      "Sam forecast constraints",
    );
    const sam = constraints.getByRole("region", {
      name: "Sam forecast constraints",
      exact: true,
    });
    await expect(
      sam.getByText("Sets delivery date", { exact: true }),
    ).toBeVisible();
    await expect(
      sam.getByText("Leave: Appointment", { exact: true }),
    ).toBeVisible();
    await expect(
      sam.getByText("Holiday: Winter break", { exact: true }),
    ).toBeVisible();
    await expect(
      constraints.getByText("Ignore leave: Off", { exact: true }),
    ).toHaveCount(0);
    await expect(
      constraints.getByText("Keep other delivery dates: Off", { exact: true }),
    ).toHaveCount(0);
    await expect(
      constraints.getByText("Competing work", { exact: true }),
    ).toHaveCount(0);
    await expect(
      constraints.getByText("Calendar constraints", { exact: true }),
    ).toHaveCount(0);
    await expect(constraints.getByText(/Start restriction:/)).toHaveCount(0);
    await expect(sam.getByText("Weekend", { exact: true })).toBeHidden();
    await expect(
      sam.getByText("App planning starts", { exact: true }),
    ).toBeHidden();
    const details = sam.locator("summary", {
      hasText: "View scheduling details",
    });
    await details.focus();
    await page.keyboard.press("Enter");
    await expect(sam.getByText("Weekend", { exact: true })).toBeVisible();
    await expect(
      sam.getByText("2 weekend days", { exact: true }),
    ).toBeVisible();
    await expect(
      sam.getByText("App planning starts", { exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: `test-results/forecast-details-${width}x${height}.png`,
    });
    await details.focus();
    await page.keyboard.press("Space");
    await expect(sam.getByText("Weekend", { exact: true })).toBeHidden();
    const alex = constraints.getByRole("region", {
      name: "Alex forecast constraints",
      exact: true,
    });
    await expect(alex.getByText("Urgent fix", { exact: true })).toBeHidden();
    await alex.locator(":scope > details > summary").click();
    await expect(alex.getByText("Urgent fix", { exact: true })).toBeVisible();
    await expect(alex.getByText(/1 working day booked/).first()).toBeVisible();
    await alex
      .locator("summary", { hasText: "View scheduling details" })
      .click();
    await expect(
      alex.getByText("Capacity unavailable", { exact: true }),
    ).toBeVisible();
    expect(
      (await new AxeBuilder({ page }).include('[role="dialog"]').analyze())
        .violations,
    ).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await sam.locator(":scope > details > summary").click();
    await expect(
      sam.getByText("Leave: Appointment", { exact: true }),
    ).toBeHidden();
    await sam.locator(":scope > details > summary").click();
    await constraints.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `test-results/forecast-summary-${width}x${height}.png`,
    });
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Checkout overview", exact: true }),
    ).toBeFocused();
    expect(await (await request.get("/api/state")).json()).toEqual(before);
    expect(issues).toEqual([]);
  });
}

test("forecast summary keeps controlling dependencies and explicit start restrictions visible", async ({
  page,
  request,
}) => {
  const state = overviewFixture();
  state.features[0].tasks = [
    {
      id: "fix-task",
      title: "Repair payments",
      personId: "p",
      scope: "Backend",
      hours: 8,
      status: "todo",
      dependsOn: [],
    },
  ];
  state.features[1].tasks = [
    {
      id: "checkout-task",
      title: "Test checkout",
      personId: "q",
      scope: "Design",
      hours: 8,
      status: "todo",
      dependsOn: ["fix-task"],
    },
  ];
  const { revision } = await (await request.get("/api/state")).json();
  expect(
    (await request.put("/api/state", { data: { state, revision } })).ok(),
  ).toBe(true);
  await page.reload();
  await page.getByRole("button", { name: /^Features(?:\s|$)/ }).click();
  await page
    .getByRole("button", { name: "Checkout overview", exact: true })
    .click();
  let constraints = page.getByRole("region", {
    name: "Forecast constraints",
    exact: true,
  });
  await expect(
    constraints.getByText("Waiting for Urgent fix", { exact: true }),
  ).toBeVisible();
  await expect(
    constraints.getByText("Repair payments · Alex", { exact: true }),
  ).toBeVisible();
  await expect(
    constraints.getByText("Can follow from Jan 8, 2030", { exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  state.features[1].notBefore = "2030-01-10";
  const saved = await (await request.get("/api/state")).json();
  expect(
    (
      await request.put("/api/state", {
        data: { state, revision: saved.revision },
      })
    ).ok(),
  ).toBe(true);
  await page.reload();
  await page.getByRole("button", { name: /^Features(?:\s|$)/ }).click();
  await page
    .getByRole("button", { name: "Checkout overview", exact: true })
    .click();
  constraints = page.getByRole("region", {
    name: "Forecast constraints",
    exact: true,
  });
  await expect(
    constraints.getByText("Start restriction: Jan 10, 2030", { exact: true }),
  ).toBeVisible();
  await expect(
    constraints.getByText("Waiting for Urgent fix", { exact: true }),
  ).toHaveCount(0);
  await expect(
    constraints.getByText(
      "No competing feature bookings reduced this person’s scheduling capacity.",
      { exact: true },
    ),
  ).toHaveCount(0);
});
