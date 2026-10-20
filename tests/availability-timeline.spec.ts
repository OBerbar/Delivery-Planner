import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
import { emptyState } from "../src/lib/model";

const seed = {
  ...emptyState,
  apps: [
    {
      id: "calendar-app",
      name: "Availability QA",
      color: "#7565db",
      weekends: [0, 6],
      planningStart: "2026-10-08",
      cadence: "2w",
      customDays: 14,
      terms: "",
      archived: false,
    },
  ],
  people: [
    { id: "alex", name: "Alex", dailyHours: 8 },
    { id: "sam", name: "Sam", dailyHours: 8 },
  ],
  members: [
    {
      id: "alex-member",
      appId: "calendar-app",
      personId: "alex",
      role: "Backend",
      allocation: 100,
      weekends: null,
    },
    {
      id: "sam-member",
      appId: "calendar-app",
      personId: "sam",
      role: "Design",
      allocation: 100,
      weekends: null,
    },
  ],
  holidays: [
    {
      id: "holiday-1",
      appId: "calendar-app",
      date: "2026-10-12",
      name: "Autumn break",
      personIds: ["alex"],
    },
    {
      id: "holiday-2",
      appId: "calendar-app",
      date: "2026-10-13",
      name: "Autumn break",
      personIds: ["alex"],
    },
  ],
  leaves: [
    {
      id: "leave",
      personId: "sam",
      start: "2026-10-15",
      end: "2026-10-16",
      hours: 3,
      note: "Family appointment",
    },
  ],
  features: [],
};

async function load(
  page: Page,
  request: APIRequestContext,
  features: object[] = [],
) {
  await page.clock.install({ time: new Date("2026-10-08T10:00:00Z") });
  const { revision } = await (await request.get("/api/state")).json();
  expect(
    (
      await request.put("/api/state", {
        data: { revision, state: { ...seed, features } },
      })
    ).ok(),
  ).toBeTruthy();
  await page.goto("/");
}

test("calendar-only timeline shows named holiday ranges and partial leave in both groupings", async ({
  page,
  request,
}) => {
  await load(page, request);
  const holiday = page.getByRole("img", {
    name: /Holiday: Autumn break.*Alex.*2026-10-12.*2026-10-13/,
  });
  const leave = page.getByRole("img", {
    name: /Leave: Family appointment.*Sam.*2026-10-15.*2026-10-16.*0.375 working day off per day/,
  });
  await expect(holiday).toHaveCount(1);
  await expect(leave).toHaveCount(1);
  await expect(holiday).toBeVisible();
  await expect(leave).toBeVisible();
  await leave.focus();
  await expect(leave).toBeFocused();
  await leave.click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "By person", exact: true }).click();
  await expect(holiday).toBeVisible();
  await expect(leave).toBeVisible();
  await page.getByRole("button", { name: "By feature", exact: true }).click();
  await expect(holiday).toBeVisible();
});

test("selected holiday shades only its person and work remains editable", async ({
  page,
  request,
}) => {
  await load(page, request, [
    {
      id: "feature",
      appId: "calendar-app",
      title: "Working feature",
      description: "",
      completion: "",
      priority: 0,
      committed: false,
      link: "",
      tasks: [
        {
          id: "alex-task",
          title: "Alex work",
          personId: "alex",
          scope: "Backend",
          hours: 80,
          status: "todo",
          dependsOn: [],
        },
        {
          id: "sam-task",
          title: "Sam work",
          personId: "sam",
          scope: "Design",
          hours: 80,
          status: "todo",
          dependsOn: [],
        },
      ],
    },
  ]);
  await page.getByRole("button", { name: "By person", exact: true }).click();
  const alex = page.locator('.timeline-track[data-person-id="alex"]');
  const sam = page.locator('.timeline-track[data-person-id="sam"]');
  await expect(
    alex.locator('.grid-cell.holiday[data-date="2026-10-12"]'),
  ).toHaveCount(1);
  await expect(
    sam.locator('.grid-cell.holiday[data-date="2026-10-12"]'),
  ).toHaveCount(0);
  await expect(alex.locator('[data-date="2026-10-12"]')).toHaveAttribute(
    "title",
    /Autumn break/,
  );
  await expect(sam.locator('[data-date="2026-10-15"]')).toHaveAttribute(
    "title",
    /Family appointment.*0.375 working day/,
  );
  await page.getByRole("button", { name: "By feature", exact: true }).click();
  await page
    .getByRole("button", { name: "Expand Working feature", exact: true })
    .click();
  await expect(
    page.locator(
      '.timeline-track:not([data-person-id]) .grid-cell.holiday[data-date="2026-10-12"]',
    ),
  ).toHaveCount(0);
  await expect(
    alex.locator('.grid-cell.holiday[data-date="2026-10-12"]'),
  ).toHaveCount(1);
  await expect(
    sam.locator('.grid-cell.holiday[data-date="2026-10-12"]'),
  ).toHaveCount(0);
  await page
    .locator(".timeline-row-title")
    .filter({ hasText: "Alex work" })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByLabel("Feature title", { exact: true })).toHaveValue(
    "Working feature",
  );
});

test("tablet availability stays inside timeline and six-month range remains scrollable", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 744, height: 1133 });
  await load(page, request);
  await expect(
    page.getByRole("img", { name: /Leave: Family appointment/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Timeline range/ }).click();
  await expect(
    page.getByRole("option", { name: "6 months", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("option", { name: "7 months", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("option", { name: "6 months", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /Timeline range/ }),
  ).toContainText("6 months");
  const metrics = await page.evaluate(() => {
    const timeline = document.querySelector(".timeline-scroll")!;
    return {
      body: document.documentElement.scrollWidth - window.innerWidth,
      scroll: timeline.scrollWidth - timeline.clientWidth,
    };
  });
  expect(metrics.body).toBeLessThanOrEqual(1);
  expect(metrics.scroll).toBeGreaterThan(0);
  await page.locator(".timeline-scroll").evaluate((el) => {
    el.scrollLeft = 240;
  });
  await expect
    .poll(() =>
      page.locator(".timeline-scroll").evaluate((el) => el.scrollLeft),
    )
    .toBeGreaterThan(0);
});
