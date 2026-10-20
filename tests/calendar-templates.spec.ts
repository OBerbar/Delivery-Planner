import { confirmSchedulingReview } from "./helpers/ui-workflows";
import { test, expect, type Page } from "@playwright/test";
import { emptyState } from "../src/lib/model";

const seed = {
  ...emptyState,
  apps: [
    {
      id: "a",
      name: "Calendar QA",
      color: "#7565db",
      weekends: [5, 6],
      planningStart: "2026-10-06",
      cadence: "2w",
      customDays: 14,
      terms: "",
      archived: false,
    },
  ],
  people: [
    { id: "p", name: "Alex", dailyHours: 8 },
    { id: "q", name: "Sam", dailyHours: 8 },
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
  ],
};
async function pick(page: Page, label: string, value: string) {
  await page.getByRole("button", { name: new RegExp(label) }).click();
  await page.getByRole("option", { name: value, exact: true }).click();
}
async function team(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /^Team & leave/ }).click();
}
async function createTemplate(page: Page) {
  await page
    .getByRole("button", { name: "New calendar template", exact: true })
    .click();
  await page
    .getByLabel("Template name", { exact: true })
    .fill("Winter calendar");
  await page.getByLabel("Entry 1 name", { exact: true }).fill("Winter holiday");
  await page.getByLabel("Entry 1 starts", { exact: true }).fill("2026-10-11");
  await page.getByLabel("Entry 1 ends", { exact: true }).fill("2026-10-12");
  await page
    .getByRole("button", { name: "Add calendar entry", exact: true })
    .click();
  await page.getByLabel("Entry 2 name", { exact: true }).fill("Appointment");
  await pick(page, "Entry 2 kind", "Leave");
  await page.getByLabel("Entry 2 full-day leave", { exact: true }).uncheck();
  await page
    .getByLabel("Entry 2 days off per day", { exact: true })
    .fill("0.25");
  await page.getByLabel("Entry 2 starts", { exact: true }).fill("2026-10-13");
  await page.getByLabel("Entry 2 ends", { exact: true }).fill("2026-10-13");
  await page
    .getByRole("button", { name: "Save template", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}
test.beforeEach(async ({ page, request }) => {
  await page.clock.install({ time: new Date("2026-10-06T10:00:00Z") });
  const { revision } = await (await request.get("/api/state")).json();
  expect(
    (await request.put("/api/state", { data: { revision, state: seed } })).ok(),
  ).toBeTruthy();
});

test("template is inert until applied to selected people and repeated apply is deduplicated", async ({
  page,
  request,
}) => {
  await team(page);
  await createTemplate(page);
  let state = (await (await request.get("/api/state")).json()).state;
  expect(state.leaves).toEqual([]);
  expect(state.holidays).toEqual([]);
  await page
    .getByRole("button", { name: "Apply Winter calendar", exact: true })
    .click();
  await expect(
    page.getByLabel("Apply calendar to: Alex", { exact: true }),
  ).toBeChecked();
  await page.getByLabel("Apply calendar to: Sam", { exact: true }).uncheck();
  await page
    .getByRole("button", { name: "Apply calendar", exact: true })
    .click();
  await confirmSchedulingReview(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  state = (await (await request.get("/api/state")).json()).state;
  expect(state.holidays).toHaveLength(2);
  expect(
    state.holidays.every(
      (h: { personIds: string[] }) => h.personIds.join() === "p",
    ),
  ).toBeTruthy();
  expect(state.leaves).toHaveLength(1);
  expect(state.leaves[0]).toMatchObject({
    personId: "p",
    hours: 2,
    note: "Appointment",
  });
  await page
    .getByRole("button", { name: "Apply Winter calendar", exact: true })
    .click();
  await page.getByLabel("Apply calendar to: Sam", { exact: true }).uncheck();
  await page
    .getByRole("button", { name: "Apply calendar", exact: true })
    .click();
  await confirmSchedulingReview(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  state = (await (await request.get("/api/state")).json()).state;
  expect(state.holidays).toHaveLength(2);
  expect(state.leaves).toHaveLength(1);
  await page
    .getByRole("button", { name: "Edit Winter calendar", exact: true })
    .click();
  await page
    .getByLabel("Template name", { exact: true })
    .fill("Updated calendar");
  await page
    .getByRole("button", { name: "Remove entry 2", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Save template", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Delete Updated calendar", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Apply Updated calendar", exact: true }),
  ).toHaveCount(0);
  state = (await (await request.get("/api/state")).json()).state;
  await expect
    .poll(
      async () =>
        (await (await request.get("/api/state")).json()).state.calendarTemplates
          .length,
    )
    .toBe(0);
  state = (await (await request.get("/api/state")).json()).state;
  expect(state.calendarTemplates).toHaveLength(0);
  expect(state.holidays).toHaveLength(2);
  expect(state.leaves).toHaveLength(1);
});

test("templates explain invalid dates and require selected members", async ({
  page,
}) => {
  await team(page);
  await page
    .getByRole("button", { name: "New calendar template", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Save template", exact: true })
    .click();
  await expect(page.getByRole("alert")).toBeVisible();
  await page.getByLabel("Template name", { exact: true }).fill("Dates");
  await page.getByLabel("Entry 1 name", { exact: true }).fill("Holiday");
  await page.getByLabel("Entry 1 starts", { exact: true }).fill("2026-10-12");
  await page.getByLabel("Entry 1 ends", { exact: true }).fill("2026-10-11");
  await page
    .getByRole("button", { name: "Save template", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(/end.*start/i);
  await page.getByLabel("Entry 1 ends", { exact: true }).fill("2026-10-12");
  await page
    .getByRole("button", { name: "Save template", exact: true })
    .click();
  await page.getByRole("button", { name: "Apply Dates", exact: true }).click();
  await page
    .getByRole("button", { name: "Clear selection", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Apply calendar", exact: true })
    .click();
  await confirmSchedulingReview(page);
  await expect(page.getByRole("alert")).toContainText(/select.*person/i);
  await page
    .getByRole("button", { name: "Select all members", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Apply calendar", exact: true })
    .click();
  await confirmSchedulingReview(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("one-off selected holidays clean up when their member is removed while whole-app holidays and personal leave stay", async ({
  page,
  request,
}) => {
  await team(page);
  await page.getByRole("button", { name: "Add holiday", exact: true }).click();
  await expect(
    page.getByLabel("Whole app holiday", { exact: true }),
  ).toBeChecked();
  await page
    .getByLabel("Holiday name", { exact: true })
    .fill("Whole team holiday");
  await page.getByRole("button", { name: "Save holiday", exact: true }).click();
  await confirmSchedulingReview(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Add holiday", exact: true }).click();
  await page.getByLabel("Holiday name", { exact: true }).fill("Local holiday");
  await page.getByLabel("Whole app holiday", { exact: true }).uncheck();
  await page.getByLabel("Holiday applies to: Sam", { exact: true }).uncheck();
  await page.getByRole("button", { name: "Save holiday", exact: true }).click();
  await confirmSchedulingReview(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.locator(".availability-row").filter({ hasText: "Local holiday" }),
  ).toContainText("Alex");
  await page.getByRole("button", { name: "Add leave", exact: true }).click();
  await page.getByRole("button", { name: "Save leave", exact: true }).click();
  await confirmSchedulingReview(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Edit Alex", exact: true }).click();
  await page
    .getByRole("button", { name: "Remove from app", exact: true })
    .click();
  await confirmSchedulingReview(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const state = (await (await request.get("/api/state")).json()).state;
  expect(state.holidays).toHaveLength(1);
  expect(state.holidays[0]).toMatchObject({ name: "Whole team holiday" });
  expect(state.holidays[0].personIds).toBeUndefined();
  expect(state.leaves).toHaveLength(1);
  expect(state.people).toHaveLength(2);
});

test("template range, partial hours and empty entry validation recover after correction", async ({
  page,
}) => {
  await team(page);
  await page
    .getByRole("button", { name: "New calendar template", exact: true })
    .click();
  await page
    .getByLabel("Template name", { exact: true })
    .fill("Range validation");
  await page.getByLabel("Entry 1 name", { exact: true }).fill("Leave period");
  await page.getByLabel("Entry 1 starts", { exact: true }).fill("2026-10-06");
  await page.getByLabel("Entry 1 ends", { exact: true }).fill("2027-10-07");
  await page
    .getByRole("button", { name: "Save template", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("366");
  await page.getByLabel("Entry 1 ends", { exact: true }).fill("2026-10-07");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await pick(page, "Entry 1 kind", "Leave");
  await page.getByLabel("Entry 1 full-day leave", { exact: true }).uncheck();
  await page.getByLabel("Entry 1 days off per day", { exact: true }).fill("2");
  await page
    .getByRole("button", { name: "Save template", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("1");
  await page.getByLabel("Entry 1 days off per day", { exact: true }).fill("0");
  await page
    .getByRole("button", { name: "Save template", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("0.01");
  await page.getByLabel("Entry 1 full-day leave", { exact: true }).check();
  await expect(
    page.getByLabel("Entry 1 days off per day", { exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Remove entry 1", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Save template", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("at least one");
  await page
    .getByRole("button", { name: "Add calendar entry", exact: true })
    .click();
  await page.getByLabel("Entry 1 name", { exact: true }).fill("Restored entry");
  await page
    .getByRole("button", { name: "Save template", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

for (const width of [375, 744]) {
  test(`calendar entry controls fit ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1133 });
    await team(page);
    await createTemplate(page);
    await page
      .getByRole("button", { name: "Edit Winter calendar", exact: true })
      .click();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      ),
    ).toBeLessThanOrEqual(1);
    expect(
      await page
        .getByRole("dialog")
        .evaluate((el) => el.scrollWidth - el.clientWidth),
    ).toBeLessThanOrEqual(1);
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page
      .getByRole("button", { name: "Apply Winter calendar", exact: true })
      .click();
    await page.getByLabel("Apply calendar to: Sam", { exact: true }).uncheck();
    await page
      .getByRole("button", { name: "Apply calendar", exact: true })
      .click();
    await confirmSchedulingReview(page);
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
}
