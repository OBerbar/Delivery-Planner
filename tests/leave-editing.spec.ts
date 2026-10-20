import { confirmSchedulingReview } from "./helpers/ui-workflows";
import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
import { stateSchema, type PlannerState } from "../src/lib/model";
import { schedule, resources } from "../src/lib/planning";
import { observeBrowser } from "../scripts/browser-observability";

const start = "2030-01-06";
function fixture(): PlannerState {
  const state = stateSchema.parse({
    version: 1,
    apps: ["a", "b"].map((id) => ({
      id,
      name: id === "a" ? "Example QA" : "Other app",
      color: "#7565db",
      weekends: [5, 6],
      planningStart: start,
      cadence: "2w",
      customDays: 14,
      terms: "",
    })),
    people: [
      { id: "p", name: "Alex Morgan", dailyHours: 8 },
      { id: "q", name: "Jamie Parker", dailyHours: 6 },
    ],
    members: [
      {
        id: "m",
        appId: "a",
        personId: "p",
        role: "Backend",
        allocation: 100,
        weekends: null,
      },
      {
        id: "n",
        appId: "a",
        personId: "q",
        role: "Design",
        allocation: 100,
        weekends: null,
      },
      {
        id: "o",
        appId: "b",
        personId: "p",
        role: "Backend",
        allocation: 100,
        weekends: null,
      },
    ],
    features: ["a", "b"].map((appId, i) => ({
      id: `f${i}`,
      appId,
      title: `Delivery ${appId}`,
      description: "",
      completion: "",
      priority: 0,
      tasks: [
        {
          id: `t${i}`,
          title: "Implementation",
          personId: "p",
          scope: "Backend",
          hours: 80,
          status: "todo",
          dependsOn: [],
        },
      ],
      sprintId: appId === "a" ? "s" : undefined,
      committed: false,
    })),
    sprints: [
      {
        id: "s",
        appId: "a",
        number: 43,
        start,
        end: "2030-01-17",
        goal: "Deliver",
        notes: "",
        snapshot: "FINALIZED ORIGINAL TEXT",
        draft: "SAVED DRAFT",
      },
    ],
    calendarTemplates: [
      {
        id: "c",
        name: "Vacation template",
        entries: [
          {
            id: "ce",
            name: "Vacation",
            kind: "leave",
            start: "2030-01-07",
            end: "2030-01-08",
            hours: null,
          },
        ],
      },
    ],
    leaves: [
      {
        id: "l",
        personId: "p",
        start: "2030-01-07",
        end: "2030-01-08",
        hours: null,
        note: "Vacation",
        templateId: "c",
        templateEntryId: "ce",
      },
    ],
    holidays: [],
  });
  state.features[0].committed = true;
  state.features[0].commitment = {
    end: schedule(state, start).features.f0.end!,
    acceptedAt: start,
  };
  return state;
}
async function read(request: APIRequestContext) {
  return (await (await request.get("/api/state")).json()).state as PlannerState;
}
async function seed(request: APIRequestContext, state: PlannerState) {
  const { revision } = await (await request.get("/api/state")).json();
  expect(
    (await request.put("/api/state", { data: { revision, state } })).ok(),
  ).toBeTruthy();
}
async function open(page: Page) {
  await page.clock.setFixedTime(new Date(`${start}T12:00:00`));
  await page.goto("/");
  await page
    .locator(".sidebar nav")
    .getByRole("button", { name: /^Team & leave/ })
    .click();
}
const edit = (page: Page) =>
  page.getByRole("button", {
    name: "Edit leave for Alex Morgan, 2030-01-07 to 2030-01-08",
    exact: true,
  });
async function saved(page: Page) {
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".notice")).toContainText("Saved");
}

const browserIssues = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page, request }) => {
  browserIssues.set(page, observeBrowser(page));
  await seed(request, fixture());
});
test.afterEach(async ({ page }, testInfo) => {
  const issues = browserIssues.get(page) ?? [];
  const simulatedFailure =
    testInfo.title ===
    "unsuccessful save retains draft for retry and undo restores original leave";
  const expectedFailure = (issue: string) =>
    simulatedFailure &&
    (issue === "HTTP 500: PUT http://127.0.0.1:4312/api/state" ||
      issue ===
        "Console error: Failed to load resource: the server responded with a status of 500 (Internal Server Error)");
  expect(
    issues.filter((issue) => !expectedFailure(issue)),
    "Unexpected browser/network errors",
  ).toEqual([]);
});

test("existing leave opens prefilled and edits one record, preserving provenance after reload", async ({
  page,
  request,
}) => {
  await open(page);
  await edit(page).click();
  await expect(
    page.getByRole("dialog", { name: "Edit time off" }),
  ).toBeVisible();
  await expect(page.getByLabel("Leave starts", { exact: true })).toHaveValue(
    "2030-01-07",
  );
  await expect(page.getByLabel("Leave ends", { exact: true })).toHaveValue(
    "2030-01-08",
  );
  await expect(
    page.getByLabel("Full-day leave", { exact: true }),
  ).toBeChecked();
  await expect(page.getByLabel("Leave note", { exact: true })).toHaveValue(
    "Vacation",
  );
  await page.getByLabel("Leave ends", { exact: true }).fill("2030-01-10");
  await page.getByLabel("Leave note", { exact: true }).fill("Updated vacation");
  await page.getByRole("button", { name: "Save leave", exact: true }).click();
  await confirmSchedulingReview(page);
  await saved(page);
  expect((await read(request)).leaves).toEqual([
    { ...fixture().leaves[0], end: "2030-01-10", note: "Updated vacation" },
  ]);
  await page.reload();
  await page
    .locator(".sidebar nav")
    .getByRole("button", { name: /^Team & leave/ })
    .click();
  await page
    .getByRole("button", {
      name: "Edit leave for Alex Morgan, 2030-01-07 to 2030-01-10",
      exact: true,
    })
    .click();
  await expect(page.getByLabel("Leave note", { exact: true })).toHaveValue(
    "Updated vacation",
  );
});

test("leave edit recalculates both apps, resources and risk while retaining saved plans and commitment", async ({
  page,
  request,
}) => {
  const previous = fixture(),
    before = schedule(previous, start);
  await open(page);
  await edit(page).click();
  await page.getByLabel("Leave ends", { exact: true }).fill("2030-01-10");
  await page.getByRole("button", { name: "Save leave", exact: true }).click();
  await confirmSchedulingReview(page);
  await saved(page);
  const next = await read(request),
    after = schedule(next, start);
  for (const id of ["f0", "f1"])
    expect(after.features[id].end! > before.features[id].end!).toBeTruthy();
  expect(resources(next, next.sprints[0], after)[0].available).toBe(
    resources(previous, previous.sprints[0], before)[0].available - 16,
  );
  expect(after.features.f0.commitmentDelayed).toBeTruthy();
  expect(next.features[0].commitment).toEqual(previous.features[0].commitment);
  expect(next.sprints).toEqual(previous.sprints);
  await page
    .locator(".sidebar nav")
    .getByRole("button", { name: /^Sprints & plans/ })
    .click();
  await expect(
    page.locator(".resource-table tbody tr").first().locator("td"),
  ).toHaveText([
    "Alex Morgan",
    "6 working days",
    "10 working days",
    "6 working days",
    "0 working days",
  ]);
  await expect(page.locator(".sprint-feature-row")).toContainText(
    "2 calendar days later",
  );
  await page
    .locator(".sidebar nav")
    .getByRole("button", { name: /^Timeline/ })
    .click();
  await expect(
    page.getByRole("img", { name: /Vacation.*Alex Morgan.*10/ }).first(),
  ).toBeVisible();
});

test("full and partial leave, person and note can change without changing template", async ({
  page,
  request,
}) => {
  await open(page);
  await edit(page).click();
  await page.getByLabel("Full-day leave", { exact: true }).uncheck();
  await expect(
    page.getByLabel("Days off per day", { exact: true }),
  ).toHaveValue("0.5");
  await page.getByLabel("Days off per day", { exact: true }).fill("0.25");
  await page.getByRole("button", { name: /Person taking leave/ }).click();
  await page.getByRole("option", { name: "Jamie Parker", exact: true }).click();
  await page.getByLabel("Leave starts", { exact: true }).fill("2030-01-09");
  await page.getByLabel("Leave ends", { exact: true }).fill("2030-01-09");
  await page
    .getByLabel("Leave note", { exact: true })
    .fill("Design appointment");
  await page.getByRole("button", { name: "Save leave", exact: true }).click();
  await confirmSchedulingReview(page);
  await saved(page);
  const next = await read(request);
  expect(next.leaves).toEqual([
    {
      ...fixture().leaves[0],
      personId: "q",
      start: "2030-01-09",
      end: "2030-01-09",
      hours: 2,
      note: "Design appointment",
    },
  ]);
  expect(next.calendarTemplates).toEqual(fixture().calendarTemplates);
  await page
    .getByRole("button", {
      name: "Edit leave for Jamie Parker, 2030-01-09 to 2030-01-09",
      exact: true,
    })
    .click();
  await expect(
    page.getByLabel("Full-day leave", { exact: true }),
  ).not.toBeChecked();
  await expect(
    page.getByLabel("Days off per day", { exact: true }),
  ).toHaveValue("0.333333");
  await page.getByLabel("Full-day leave", { exact: true }).check();
  await expect(
    page.getByLabel("Days off per day", { exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Save leave", exact: true }).click();
  await confirmSchedulingReview(page);
  await saved(page);
  expect((await read(request)).leaves[0].hours).toBeNull();
});

test("cancel, Escape and close discard edited drafts", async ({
  page,
  request,
}) => {
  await open(page);
  for (const close of ["cancel", "escape", "close"]) {
    await edit(page).click();
    await page.getByLabel("Leave note", { exact: true }).fill("Not saved");
    if (close === "escape") await page.keyboard.press("Escape");
    else
      await page
        .getByRole("button", {
          name: close === "cancel" ? "Cancel" : "Close dialog",
          exact: true,
        })
        .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect((await read(request)).leaves).toEqual(fixture().leaves);
  }
});

test("invalid dates and partial hours keep editor open without saving", async ({
  page,
  request,
}) => {
  await open(page);
  await edit(page).click();
  await page.getByLabel("Leave ends", { exact: true }).fill("2030-01-06");
  await page.getByRole("button", { name: "Save leave", exact: true }).click();
  await confirmSchedulingReview(page);
  await expect(page.locator(".dialog .form-error")).toContainText("Leave end");
  await page.getByLabel("Leave ends", { exact: true }).fill("2030-01-08");
  await page.getByLabel("Full-day leave", { exact: true }).uncheck();
  for (const value of ["0", "2"]) {
    await page.getByLabel("Days off per day", { exact: true }).fill(value);
    await page.getByRole("button", { name: "Save leave", exact: true }).click();
    await confirmSchedulingReview(page);
    await expect(page.locator(".dialog .form-error")).toBeVisible();
    expect((await read(request)).leaves).toEqual(fixture().leaves);
  }
});

test("unsuccessful save retains draft for retry and undo restores original leave", async ({
  page,
  request,
}) => {
  await open(page);
  await edit(page).click();
  await page
    .getByLabel("Leave note", { exact: true })
    .fill("Retry this change");
  let fail = true;
  await page.route("**/api/state", async (route) => {
    if (route.request().method() === "PUT" && fail) {
      fail = false;
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "Simulated save failure" }),
      });
    } else await route.continue();
  });
  await page.getByRole("button", { name: "Save leave", exact: true }).click();
  await confirmSchedulingReview(page);
  await expect(page.locator(".dialog .form-error")).toContainText(
    "Simulated save failure",
  );
  await expect(page.getByLabel("Leave note", { exact: true })).toHaveValue(
    "Retry this change",
  );
  expect((await read(request)).leaves).toEqual(fixture().leaves);
  await page.getByRole("button", { name: "Save leave", exact: true }).click();
  await confirmSchedulingReview(page);
  await saved(page);
  await page
    .getByRole("button", { name: "Undo last change", exact: true })
    .click();
  await expect
    .poll(async () => (await read(request)).leaves)
    .toEqual(fixture().leaves);
});

test("leave edit supports keyboard and tablet controls, blocking duplicate pending saves", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 744, height: 1133 });
  await open(page);
  const action = edit(page);
  const box = await action.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(box!.width).toBeGreaterThanOrEqual(44);
  await action.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("dialog", { name: "Edit time off" }),
  ).toBeVisible();
  await page.getByLabel("Leave note", { exact: true }).fill("One save");
  let puts = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/state", async (route) => {
    if (route.request().method() === "PUT") {
      puts++;
      await gate;
    }
    await route.continue();
  });
  await page.getByRole("button", { name: "Save leave", exact: true }).click();
  await confirmSchedulingReview(page);
  try {
    await expect.poll(() => puts).toBe(1);
    await expect(
      page.getByRole("button", { name: "Save leave", exact: true }),
    ).toBeDisabled();
    await page.keyboard.press("Enter");
    expect(puts).toBe(1);
  } finally {
    release();
  }
  await saved(page);
  expect((await read(request)).leaves).toHaveLength(1);
  await page.setViewportSize({ width: 1133, height: 744 });
  await page
    .getByRole("button", {
      name: "Edit leave for Alex Morgan, 2030-01-07 to 2030-01-08",
      exact: true,
    })
    .click();
  await expect(page.getByLabel("Leave note", { exact: true })).toHaveValue(
    "One save",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - innerWidth,
    ),
  ).toBeLessThanOrEqual(1);
});

test("two tabs reject a stale leave edit and recover by reopening the saved record", async ({
  page,
  context,
  request,
}) => {
  await open(page);
  const other = await context.newPage();
  const otherIssues = observeBrowser(other);
  try {
    await open(other);
    await edit(page).click();
    await edit(other).click();
    await page
      .getByLabel("Leave note", { exact: true })
      .fill("First tab saved");
    await page.getByRole("button", { name: "Save leave", exact: true }).click();
    await confirmSchedulingReview(page);
    await saved(page);
    await other
      .getByLabel("Leave note", { exact: true })
      .fill("Stale tab draft");
    await other
      .getByRole("button", { name: "Save leave", exact: true })
      .click();
    await confirmSchedulingReview(other);
    await expect(other.locator(".dialog .form-error")).toContainText(
      "changed in another tab",
    );
    await expect(other.getByLabel("Leave note", { exact: true })).toHaveValue(
      "Stale tab draft",
    );
    expect((await read(request)).leaves).toEqual([
      { ...fixture().leaves[0], note: "First tab saved" },
    ]);
    await other.getByRole("button", { name: "Cancel", exact: true }).click();
    await other.reload();
    await other
      .locator(".sidebar nav")
      .getByRole("button", { name: /^Team & leave/ })
      .click();
    await edit(other).click();
    await expect(other.getByLabel("Leave note", { exact: true })).toHaveValue(
      "First tab saved",
    );
    await other
      .getByLabel("Leave note", { exact: true })
      .fill("Second tab recovered");
    await other
      .getByRole("button", { name: "Save leave", exact: true })
      .click();
    await confirmSchedulingReview(other);
    await saved(other);
    expect((await read(request)).leaves).toEqual([
      { ...fixture().leaves[0], note: "Second tab recovered" },
    ]);
    expect(otherIssues).toContain(
      "HTTP 409: PUT http://127.0.0.1:4312/api/state",
    );
    expect(
      otherIssues.filter(
        (issue) =>
          issue !== "HTTP 409: PUT http://127.0.0.1:4312/api/state" &&
          issue !==
            "Console error: Failed to load resource: the server responded with a status of 409 (Conflict)",
      ),
      "Unexpected errors in the second tab",
    ).toEqual([]);
  } finally {
    await other.close();
  }
});
