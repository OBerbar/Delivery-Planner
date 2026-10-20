import { test, expect, type Page } from "@playwright/test";
import { maintenanceFixture } from "../scripts/maintenance-fixture";
import { observeBrowser } from "../scripts/browser-observability";
import { timelinePreferencesKey } from "../src/lib/view-preferences";
import { displayDate, schedule } from "../src/lib/planning";

const issues = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page, request }) => {
  issues.set(page, observeBrowser(page));
  await page.clock.install({ time: new Date("2030-01-06T23:59:00Z") });
  await page.clock.pauseAt(new Date("2030-01-06T23:59:50Z"));
  const state = maintenanceFixture();
  state.features = [
    {
      ...state.features[0],
      id: "automatic",
      title: "Automatic delivery",
      committed: false,
      commitment: undefined,
      tasks: [
        {
          id: "first",
          title: "First day",
          personId: "p",
          scope: "Backend",
          hours: 8,
          status: "todo",
          dependsOn: [],
        },
        {
          id: "second",
          title: "Second day",
          personId: "p",
          scope: "Backend",
          hours: 8,
          status: "todo",
          dependsOn: ["first"],
        },
      ],
    },
    {
      ...state.features[1],
      id: "reservation",
      title: "Reservation",
      assigneeIds: ["q"],
      assigneeEstimates: [{ personId: "q", unit: "days", value: 1 }],
      estimateEffort: [{ personId: "q", hours: 8 }],
    },
  ];
  const { revision } = await (await request.get("/api/state")).json();
  expect(
    (await request.put("/api/state", { data: { revision, state } })).ok(),
  ).toBe(true);
});
test.afterEach(async ({ page }) => expect(issues.get(page)).toEqual([]));

test("feature and subtask editors explain automatic status and offer no manual status or actual dates", async ({
  page,
}) => {
  await page.goto("/");
  for (const title of ["Reservation", "Automatic delivery"]) {
    await page.locator(".timeline-row-title", { hasText: title }).click();
    const dialog = page.getByRole("dialog");
    await dialog.locator("summary", { hasText: "Scheduling options" }).click();
    await expect(
      dialog.getByRole("button", { name: /Feature status|Task \d+ status/ }),
    ).toHaveCount(0);
    await expect(dialog.locator("input[type=date]")).toHaveCount(2);
    await expect(
      dialog.getByText(/Status follows scheduled dates automatically/),
    ).toBeVisible();
    await expect(
      dialog.getByLabel(/actual start|actual end|unblock date/i),
    ).toHaveCount(0);
    await page.keyboard.press("Escape");
  }
});

test("midnight updates inclusive feature and subtask status without shifting dates or saving", async ({
  page,
  request,
}) => {
  await page.goto("/");
  const before = await (await request.get("/api/state")).json();
  await page
    .getByRole("button", { name: "Expand Automatic delivery", exact: true })
    .click();
  const feature = page.locator(".timeline-bar", {
    hasText: "Automatic delivery",
  });
  const first = page.locator(".task-bar", { hasText: "First day" });
  const second = page.locator(".task-bar", { hasText: "Second day" });
  await expect(feature).toContainText("Planned");
  await expect(first).toContainText("Planned");
  const dates = (await feature.getAttribute("aria-label"))!.split(" · ")[0];
  await page.clock.fastForward(10_100);
  await expect(feature).toContainText("In progress");
  await expect(first).toContainText("In progress");
  await expect(second).toContainText("Planned");
  await page.clock.fastForward(86_400_000);
  await expect(feature).toContainText("In progress");
  await expect(first).toContainText("Done");
  await expect(second).toContainText("In progress");
  await page.clock.fastForward(86_400_000);
  await expect(feature).toContainText("Done");
  await expect(second).toContainText("Done");
  expect((await feature.getAttribute("aria-label"))!.split(" · ")[0]).toBe(
    dates,
  );
  await page.reload();
  await expect(feature).toContainText("Done");
  expect((await feature.getAttribute("aria-label"))!.split(" · ")[0]).toBe(
    dates,
  );
  await page.getByRole("button", { name: /^Features(?:\s|$)/ }).click();
  await expect(
    page
      .locator(".feature-item", { hasText: "Automatic delivery" })
      .locator(".status-pill"),
  ).toHaveText("Done");
  expect(await (await request.get("/api/state")).json()).toEqual(before);
});

test("a saved blocked timeline filter remains selected and automatic filters remain available", async ({
  page,
}) => {
  await page.addInitScript(
    (key) =>
      localStorage.setItem(
        key,
        JSON.stringify({ version: 1, status: "blocked" }),
      ),
    timelinePreferencesKey("a"),
  );
  await page.goto("/");
  const filter = page.getByRole("button", { name: /Filter by status/ });
  await expect(filter).toContainText("Blocked");
  await expect(page.locator(".timeline-filter-empty")).toBeVisible();
  await filter.click();
  await expect(
    page.getByRole("option", { name: "Blocked", exact: true }),
  ).toHaveCount(1);
  await page.getByRole("option", { name: "Planned", exact: true }).click();
  await expect(
    page.locator(".timeline-bar", { hasText: "Automatic delivery" }),
  ).toBeVisible();
});

test("returning focus and visibility refreshes automatic status without a save", async ({
  page,
  request,
}) => {
  await page.goto("/");
  const before = await (await request.get("/api/state")).json();
  const feature = page.locator(".timeline-bar", {
    hasText: "Automatic delivery",
  });
  await expect(feature).toContainText("Planned");
  await page.clock.setSystemTime(new Date("2030-01-07T12:00:00Z"));
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(feature).toContainText("In progress");
  await page.clock.setSystemTime(new Date("2030-01-09T12:00:00Z"));
  await page.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange")),
  );
  await expect(feature).toContainText("Done");
  expect(await (await request.get("/api/state")).json()).toEqual(before);
});

test("unscheduled work shows Planned independently of its scheduling warning", async ({
  page,
  request,
}) => {
  const { state, revision } = await (await request.get("/api/state")).json();
  state.features[0].tasks[0].dependsOn = ["second"];
  expect(
    (await request.put("/api/state", { data: { state, revision } })).ok(),
  ).toBe(true);
  await page.goto("/");
  await expect(page.locator(".unscheduled").first()).toContainText("Planned");
  await page.getByRole("button", { name: /^Features(?:\s|$)/ }).click();
  const feature = page.locator(".feature-item", {
    hasText: "Automatic delivery",
  });
  await expect(feature.locator(".status-pill")).toHaveText("Planned");
  await expect(feature.locator(".inline-warning")).toBeVisible();
});

test("legacy backup restore reviews the same automatic dates that are saved", async ({
  page,
  request,
}) => {
  await page.goto("/");
  const { state } = await (await request.get("/api/state")).json();
  const backup = structuredClone(state);
  for (const feature of backup.features) delete feature.planningFrom;
  backup.features[0].tasks[0].status = "blocked";
  backup.features[0].tasks[0].hours = 16;
  await page.getByRole("button", { name: /^App settings(?:\s|$)/ }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByLabel("Restore backup", { exact: true }).setInputFiles({
    name: "legacy.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(backup)),
  });
  const review = page.getByRole("dialog", {
    name: "Review scheduling changes",
  });
  await expect(
    review.locator("article", { hasText: "Automatic delivery" }),
  ).toContainText("Jan 8, 2030 → Jan 9, 2030");
  await review
    .getByRole("button", { name: "Save changes", exact: true })
    .click();
  await expect(page.locator(".notice")).toContainText("Backup restored");
  const saved = (await (await request.get("/api/state")).json()).state;
  expect(saved.features[0].tasks[0].status).toBe("blocked");
  expect(saved.features[0].planningFrom).toBe("2030-01-06");
  expect(
    displayDate(schedule(saved, "2030-01-06").features.automatic.end),
  ).toBe("Jan 9, 2030");
});

test("person aggregate stays Planned when unscheduled work remains after its known dates", async ({
  page,
  request,
}) => {
  const { state, revision } = await (await request.get("/api/state")).json();
  state.features[0].tasks[1].dependsOn = ["second"];
  expect(
    (await request.put("/api/state", { data: { state, revision } })).ok(),
  ).toBe(true);
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Timeline", exact: true }),
  ).toBeVisible();
  await page.clock.setSystemTime(new Date("2030-01-09T12:00:00Z"));
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.getByRole("button", { name: "By person", exact: true }).click();
  const aggregate = page.locator(
    '.timeline-track[data-person-id="p"] .timeline-bar',
    { hasText: "Automatic delivery" },
  );
  await expect(aggregate).toContainText("Planned");
  await expect(aggregate).toHaveAttribute(
    "aria-label",
    /Jan 7, 2030 – Jan 7, 2030.*Planned.*(cycle|dependency)/i,
  );
  await page.getByRole("button", { name: /^Features(?:\s|$)/ }).click();
  await expect(
    page
      .locator(".feature-item", { hasText: "Automatic delivery" })
      .locator(".status-pill"),
  ).toHaveText("Planned");
});

for (const warning of ["target", "commitment"] as const) {
  test(`${warning} delay warnings preserve scheduled timeline status and filters`, async ({
    page,
    request,
  }) => {
    const { state, revision } = await (await request.get("/api/state")).json();
    if (warning === "target") state.features[0].target = "2030-01-07";
    else {
      state.features[0].committed = true;
      state.features[0].commitment = {
        end: "2030-01-07",
        acceptedAt: "2030-01-06",
      };
    }
    expect(
      (await request.put("/api/state", { data: { state, revision } })).ok(),
    ).toBe(true);
    await page.goto("/");
    const feature = page.locator('.timeline-bar[data-feature-id="automatic"]');
    for (const [date, status] of [
      ["2030-01-07", "In progress"],
      ["2030-01-09", "Done"],
    ]) {
      await page.clock.setSystemTime(new Date(`${date}T12:00:00Z`));
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await page.getByRole("button", { name: /Filter by status/ }).click();
      await page.getByRole("option", { name: status, exact: true }).click();
      await expect(feature).toContainText(status);
      if (date === "2030-01-07")
        await expect(feature).toHaveAttribute("aria-label", /Forecast exceeds/);
      await page.getByRole("button", { name: /^Features(?:\s|$)/ }).click();
      const card = page.locator(".feature-item", {
        hasText: "Automatic delivery",
      });
      await expect(card.locator(".status-pill")).toHaveText(status);
      if (date === "2030-01-07")
        await expect(card.locator(".inline-warning")).toBeVisible();
      await page.getByRole("button", { name: /^Timeline(?:\s|$)/ }).click();
    }
  });
}
