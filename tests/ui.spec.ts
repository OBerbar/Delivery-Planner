import {
  confirmSchedulingReview,
  openFeatureSection,
} from "./helpers/ui-workflows";
import { test, expect } from "@playwright/test";
import { emptyState, today, stateSchema } from "../src/lib/model";
import { schedule } from "../src/lib/planning";
import { prepareSprintEstimate } from "../src/lib/estimation";
const seed = {
  ...emptyState,
  apps: [
    {
      id: "a",
      name: "Test App",
      color: "#7565db",
      weekends: [5, 6],
      planningStart: "2026-10-06",
      cadence: "2w",
      customDays: 14,
      terms: "",
      archived: false,
    },
  ],
  people: [{ id: "p", name: "Alex", dailyHours: 8 }],
  members: [
    {
      id: "m",
      appId: "a",
      personId: "p",
      role: "Backend",
      allocation: 100,
      weekends: null,
    },
  ],
  features: [
    {
      id: "f",
      appId: "a",
      title: "First feature",
      description: "",
      completion: "",
      priority: 0,
      tasks: [
        {
          id: "t",
          title: "API",
          personId: "p",
          scope: "Backend",
          hours: 8,
          status: "todo",
          dependsOn: [],
        },
      ],
      sprintId: "s",
      committed: false,
      link: "",
    },
  ],
  sprints: [
    {
      id: "s",
      appId: "a",
      number: 1,
      start: "2026-10-06",
      end: "2026-10-19",
      goal: "Test delivery",
      notes: "",
      snapshot: null,
    },
  ],
};
test.beforeEach(async ({ request }) => {
  const r = await request.get("/api/state");
  const { revision } = await r.json();
  const save = await request.put("/api/state", {
    data: { revision, state: seed },
  });
  expect(save.ok()).toBeTruthy();
});
test("commitment control stays checked while its save is pending", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Sprints & plans", exact: true })
    .click();
  await page.route("**/api/state", async (route) => {
    if (route.request().method() === "PUT")
      await new Promise((r) => setTimeout(r, 500));
    await route.continue();
  });
  await page.getByLabel("Committed", { exact: true }).check();
  await expect(page.getByLabel("Committed", { exact: true })).toBeChecked();
});
test("two months fit while six months scroll", async ({ page }) => {
  await page.goto("/");
  await page.locator(".timeline-grid").waitFor();
  await expect
    .poll(() =>
      page
        .locator(".timeline-scroll")
        .evaluate((el) => el.scrollWidth - el.clientWidth),
    )
    .toBeLessThanOrEqual(1);
  await page.getByRole("button", { name: /Timeline range/ }).click();
  await page.getByRole("option", { name: "6 months", exact: true }).click();
  await expect
    .poll(() =>
      page
        .locator(".timeline-scroll")
        .evaluate((el) => el.scrollWidth - el.clientWidth),
    )
    .toBeGreaterThan(1000);
});
test("manual plan edits survive tab navigation", async ({ page }) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Sprints & plans", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Generate sprint plan", exact: true })
    .click();
  await page.getByRole("button", { name: "Edit text", exact: true }).click();
  await page
    .getByLabel("Sprint plan Markdown")
    .fill("My manually edited plan.");
  await page
    .getByRole("tab", { name: "Scope & capacity", exact: true })
    .click();
  await page.getByRole("tab", { name: "Sprint plan", exact: true }).click();
  await expect(page.getByLabel("Sprint plan Markdown")).toHaveValue(
    "My manually edited plan.",
  );
});
test("undo refreshes settings fields", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "App settings", exact: true }).click();
  await page.getByLabel("App name", { exact: true }).fill("Renamed App");
  await page
    .getByRole("button", { name: "Save settings", exact: true })
    .click();
  await confirmSchedulingReview(page);
  await expect(page.locator(".app-switch")).toContainText("Renamed App");
  await page
    .getByRole("button", { name: "Undo last change", exact: true })
    .click();
  await expect(page.locator(".app-switch")).toContainText("Test App");
  await expect(page.getByLabel("App name", { exact: true })).toHaveValue(
    "Test App",
  );
});
test("retries an initial database request before onboarding", async ({
  page,
}) => {
  let attempts = 0;
  await page.route("**/api/state", async (route) => {
    if (route.request().method() === "GET" && attempts++ === 0)
      await route.fulfill({ status: 500, body: "temporary startup error" });
    else await route.continue();
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", {
      name: "Timeline",
    }),
  ).toBeVisible();
});
test("new-app wizard shares a person and saves updated global working hours", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Add an app", exact: true }).click();
  await page.getByLabel("App name").fill("Another App");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Add person", exact: true }).click();
  await page.getByRole("button", { name: /Person 1 source/ }).click();
  await page.getByRole("option", { name: "Alex", exact: true }).click();
  await page.getByLabel("Person 1 role").fill("Designer");
  await page.getByLabel("Person 1 hours per day").fill("4");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByLabel("Plan in sprints", { exact: true }).check();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: /Default sprint length/ }).click();
  await page
    .getByRole("option", { name: "1 calendar month", exact: true })
    .click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page
    .getByRole("button", { name: "Open my planner", exact: true })
    .click();
  await confirmSchedulingReview(page);
  await expect(
    page.getByRole("heading", {
      name: "Timeline",
    }),
  ).toBeVisible();
  const { state } = await (await request.get("/api/state")).json();
  expect(state.people).toHaveLength(1);
  expect(state.people[0].dailyHours).toBe(4);
  expect(state.members).toHaveLength(2);
  expect(state.apps[1].cadence).toBe("month");
});
test("an edited draft can be saved and survives reload", async ({ page }) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Sprints & plans", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Generate sprint plan", exact: true })
    .click();
  await page.getByRole("button", { name: "Edit text", exact: true }).click();
  await page.getByLabel("Sprint plan Markdown").fill("A saved planning draft.");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Saved");
  await page.reload();
  await page
    .getByRole("button", { name: "Sprints & plans", exact: true })
    .click();
  await page.getByRole("tab", { name: "Sprint plan", exact: true }).click();
  await expect(page.locator(".markdown")).toContainText(
    "A saved planning draft.",
  );
});

test("a sprint estimate needs no tasks and new shared work explains its delay", async ({
  page,
  request,
}) => {
  const { revision } = await (await request.get("/api/state")).json();
  const state = {
    ...seed,
    features: [],
    people: [...seed.people, { id: "q", name: "Sam", dailyHours: 8 }],
    members: [
      ...seed.members,
      { ...seed.members[0], id: "n", personId: "q", role: "Design" },
    ],
  };
  expect(
    (await request.put("/api/state", { data: { revision, state } })).ok(),
  ).toBeTruthy();
  await page.goto("/");
  await page.getByRole("button", { name: "Add feature", exact: true }).click();
  await expect(
    page.getByLabel("Sprint estimation", { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Task 1 title", { exact: true })).toHaveCount(0);
  await page
    .getByLabel("Feature title", { exact: true })
    .fill("Checkout - Phase 1");
  await page.getByLabel("Sprint estimation", { exact: true }).fill("5");
  await page
    .getByRole("button", { name: "Select all team", exact: true })
    .click();
  await page.getByRole("button", { name: "Save feature", exact: true }).click();
  await confirmSchedulingReview(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const before = (await (await request.get("/api/state")).json()).state;
  expect(before.features[0]).toMatchObject({
    tasks: [],
    sprintEstimate: 5,
    assigneeIds: ["p", "q"],
  });
  const originalDate = schedule(before, today()).features[before.features[0].id]
    .end;
  await page.getByRole("button", { name: "Add feature", exact: true }).click();
  await page.getByLabel("Feature title", { exact: true }).fill("Billing setup");
  await page.getByLabel("Sprint estimation", { exact: true }).fill("0.5");
  await page.getByLabel("Main assignee: Alex", { exact: true }).check();
  await page.getByRole("button", { name: "Save feature", exact: true }).click();
  await confirmSchedulingReview(page);
  await expect(page.locator(".impact-panel")).toContainText("Billing setup");
  await expect(page.locator(".impact-panel")).toContainText("Alex");
  await expect(page.locator(".impact-panel")).toContainText("7 days later");
  const after = (await (await request.get("/api/state")).json()).state;
  expect(after.features[0].title).toBe("Billing setup");
  expect(
    schedule(after, today()).features[before.features[0].id].end! >
      originalDate!,
  ).toBeTruthy();
  await page.getByRole("button", { name: "By person", exact: true }).click();
  await expect(
    page.locator(".timeline-row-title").filter({ hasText: "Sam" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Undo last change", exact: true })
    .click();
  await expect(
    page.locator(".timeline-row-title").filter({ hasText: "Billing setup" }),
  ).toHaveCount(0);
});

test("main assignee validation and optional breakdown can be used without making tasks mandatory", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Add feature", exact: true }).click();
  await page
    .getByLabel("Feature title", { exact: true })
    .fill("Simple feature");
  await page.getByLabel("Sprint estimation", { exact: true }).fill("0");
  await page.getByRole("button", { name: "Save feature", exact: true }).click();
  await confirmSchedulingReview(page);
  await expect(page.getByRole("dialog")).toContainText("between 0.5 and 100");
  await page.getByLabel("Sprint estimation", { exact: true }).fill("0.5");
  await page.getByRole("button", { name: "Save feature", exact: true }).click();
  await confirmSchedulingReview(page);
  await expect(page.getByRole("dialog")).toContainText(
    "Select at least one main assignee",
  );
  await page.getByLabel("Main assignee: Alex", { exact: true }).check();
  await openFeatureSection(page, "Optional tasks");
  await page.getByLabel("Add optional task breakdown", { exact: true }).check();
  await expect(page.getByLabel("Task 1 title", { exact: true })).toBeVisible();
  await openFeatureSection(page, "Optional tasks");
  await page
    .getByLabel("Add optional task breakdown", { exact: true })
    .uncheck();
  await expect(page.getByLabel("Task 1 title", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Save feature", exact: true }).click();
  await confirmSchedulingReview(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: /^Features / }).click();
  await page
    .getByRole("button", { name: "Edit Simple feature", exact: true })
    .click();
  await expect(
    page.getByLabel("Sprint estimation", { exact: true }),
  ).toHaveValue("0.5");
  await expect(
    page.getByLabel("Main assignee: Alex", { exact: true }),
  ).toBeChecked();
  await page.getByLabel("Sprint estimation", { exact: true }).fill("1.5");
  await page.getByRole("button", { name: "Save feature", exact: true }).click();
  await confirmSchedulingReview(page);
  const { state } = await (await request.get("/api/state")).json();
  expect(
    state.features.find((f: { title: string }) => f.title === "Simple feature")
      .sprintEstimate,
  ).toBe(1.5);
});

test("switching optional breakdown off and back on preserves saved tasks and actual dates", async ({
  page,
  request,
}) => {
  const { revision } = await (await request.get("/api/state")).json();
  const tasks = [
    {
      ...seed.features[0].tasks[0],
      status: "done",
      actualStart: "2026-10-01",
      actualEnd: "2026-10-02",
    },
    {
      ...seed.features[0].tasks[0],
      id: "u",
      title: "Validation",
      dependsOn: ["t"],
    },
  ];
  const state = { ...seed, features: [{ ...seed.features[0], tasks }] };
  expect(
    (await request.put("/api/state", { data: { revision, state } })).ok(),
  ).toBeTruthy();
  await page.goto("/");
  await page.getByRole("button", { name: /^Features / }).click();
  await page
    .getByRole("button", { name: "Edit First feature", exact: true })
    .click();
  await openFeatureSection(page, "Optional tasks");
  await page
    .getByLabel("Add optional task breakdown", { exact: true })
    .uncheck();
  await openFeatureSection(page, "Optional tasks");
  await page.getByLabel("Add optional task breakdown", { exact: true }).check();
  await expect(page.getByLabel("Task 1 title", { exact: true })).toHaveValue(
    "API",
  );
  await expect(page.getByLabel("Task 2 title", { exact: true })).toHaveValue(
    "Validation",
  );
  await page.getByRole("button", { name: "Save feature", exact: true }).click();
  await confirmSchedulingReview(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const saved = (await (await request.get("/api/state")).json()).state;
  expect(saved.features[0].tasks).toEqual(tasks);
});

test("a dependency on an estimated feature waits for all its main assignees", async ({
  page,
  request,
}) => {
  const { revision } = await (await request.get("/api/state")).json();
  const state = {
    ...seed,
    people: [...seed.people, { id: "q", name: "Sam", dailyHours: 8 }],
    members: [
      ...seed.members,
      { ...seed.members[0], id: "n", personId: "q", role: "Design" },
    ],
  };
  const feature = prepareSprintEstimate(
    stateSchema.parse(state),
    {
      ...seed.features[0],
      id: "checkout",
      title: "Checkout",
      tasks: [],
      sprintEstimate: 1,
      assigneeIds: ["p", "q"],
    },
    today(),
  );
  const next = { ...state, features: [feature] };
  expect(
    (await request.put("/api/state", { data: { revision, state: next } })).ok(),
  ).toBeTruthy();
  await page.goto("/");
  await page.getByRole("button", { name: "Add feature", exact: true }).click();
  await page.getByLabel("Feature title", { exact: true }).fill("Follow-up");
  await openFeatureSection(page, "Optional tasks");
  await page.getByLabel("Add optional task breakdown", { exact: true }).check();
  await page.getByLabel("Task 1 title", { exact: true }).fill("Follow-up task");
  const dependency = page.getByLabel(
    "Checkout · feature delivery (all main assignees)",
    { exact: true },
  );
  await expect(dependency).toBeVisible();
  await dependency.check();
  await page.getByRole("button", { name: "Save feature", exact: true }).click();
  await confirmSchedulingReview(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const saved = (await (await request.get("/api/state")).json()).state;
  const followUp = saved.features.find(
    (f: { title: string }) => f.title === "Follow-up",
  );
  expect(followUp.tasks[0].dependsOnFeatures).toEqual(["checkout"]);
  const forecast = schedule(saved, today());
  expect(
    forecast.features[followUp.id].start! > forecast.features.checkout.end!,
  ).toBeTruthy();
});
