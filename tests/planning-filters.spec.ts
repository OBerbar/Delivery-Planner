import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { maintenanceFixture, fixedToday } from "../scripts/maintenance-fixture";
import { observeBrowser } from "../scripts/browser-observability";

function fixture() {
  const state = maintenanceFixture();
  state.sprints.push({
    ...state.sprints[0],
    id: "s2",
    number: 2,
    start: "2030-01-21",
    end: "2030-02-01",
    snapshot: null,
  });
  const original = state.features[0];
  state.features = [
    {
      ...original,
      id: "accepted",
      title: "Accepted work",
      sprintEstimate: undefined,
      assigneeEstimates: [{ personId: "p", unit: "days", value: 2 }],
      estimateEffort: [{ personId: "p", hours: 16 }],
      commitment: { end: "2030-01-08", acceptedAt: fixedToday },
    },
    {
      ...original,
      id: "risk",
      title: "Risk work",
      priority: 1,
      assigneeIds: ["q"],
      sprintId: "s2",
      sprintEstimate: undefined,
      assigneeEstimates: [{ personId: "q", unit: "days", value: 3 }],
      estimateEffort: [{ personId: "q", hours: 24 }],
      commitment: { end: "2030-01-07", acceptedAt: fixedToday },
    },
    {
      ...original,
      id: "blocked",
      title: "Blocked backlog",
      priority: 2,
      sprintId: undefined,
      blocked: true,
      committed: false,
      commitment: undefined,
      sprintEstimate: undefined,
      assigneeEstimates: [{ personId: "p", unit: "days", value: 1 }],
      estimateEffort: [{ personId: "p", hours: 8 }],
    },
    {
      ...original,
      id: "other",
      title: "Other backlog",
      priority: 3,
      assigneeIds: ["q"],
      sprintId: undefined,
      committed: false,
      commitment: undefined,
      sprintEstimate: undefined,
      assigneeEstimates: [{ personId: "q", unit: "days", value: 1 }],
      estimateEffort: [{ personId: "q", hours: 8 }],
    },
  ];
  return state;
}

test("legacy saved filters migrate and selections remain separate per app", async ({
  page,
  request,
}) => {
  const state = fixture();
  state.apps.push({ ...state.apps[0], id: "b", name: "Second app" });
  state.members.push({ ...state.members[0], id: "b-person", appId: "b" });
  state.features.push({
    ...state.features[2],
    id: "b-work",
    appId: "b",
    title: "Second app work",
    priority: 4,
  });
  const { revision } = await (await request.get("/api/state")).json();
  expect(
    (await request.put("/api/state", { data: { state, revision } })).ok(),
  ).toBe(true);
  await page.evaluate(() =>
    localStorage.setItem(
      "sprint-studio:timeline:v1:a",
      JSON.stringify({
        version: 1,
        person: "p",
        sprint: "unassigned",
        status: "blocked",
        risk: "unaccepted",
      }),
    ),
  );
  await page.reload();
  await page.getByRole("button", { name: /^Features(?:\s|$)/ }).click();
  await expect(page.locator(".feature-item")).toHaveCount(1);
  await expect(page.locator(".feature-item")).toContainText("Blocked backlog");
  await expect
    .poll(() =>
      page.evaluate(() =>
        JSON.parse(localStorage.getItem("sprint-studio:timeline:v1:a")!),
      ),
    )
    .toMatchObject({
      version: 2,
      person: ["p"],
      sprint: ["unassigned"],
      status: ["blocked"],
      risk: ["unaccepted"],
    });
  await page.getByRole("button", { name: /Current app/ }).click();
  await page.getByRole("option", { name: "Second app", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /Filter by person/ }),
  ).toContainText("All people");
  await expect(
    page.getByRole("button", { name: /Filter by status/ }),
  ).toContainText("All statuses");
  await page.getByRole("button", { name: /Current app/ }).click();
  await page
    .getByRole("option", { name: "Maintenance Studio", exact: true })
    .click();
  await page.getByRole("button", { name: /^Features(?:\s|$)/ }).click();
  await expect(page.locator(".feature-item")).toHaveCount(1);
  await expect(page.locator(".feature-item")).toContainText("Blocked backlog");
});

test.beforeEach(async ({ page, request }) => {
  await page.clock.install({ time: new Date(`${fixedToday}T12:00:00Z`) });
  const { revision } = await (await request.get("/api/state")).json();
  expect(
    (
      await request.put("/api/state", { data: { state: fixture(), revision } })
    ).ok(),
  ).toBe(true);
  await page.goto("/");
});

for (const [name, width, height] of [
  ["desktop", 1440, 1000],
  ["iPad portrait", 744, 1133],
  ["iPad landscape", 1133, 744],
] as const) {
  test(`${name}: all four multi-select filters combine and persist between Timeline and Features @a11y`, async ({
    page,
    request,
  }) => {
    const issues = observeBrowser(page);
    await page.setViewportSize({ width, height });
    const before = await (await request.get("/api/state")).json();
    for (const [label, choices] of [
      ["Filter by person", ["Alex", "Sam"]],
      ["Filter by sprint", ["Sprint 1", "No assigned sprint"]],
      ["Filter by status", ["Planned", "Blocked"]],
      ["Filter by risk", ["At risk", "No accepted date"]],
    ] as const) {
      const trigger = page.getByRole("button", { name: new RegExp(label) });
      await trigger.click();
      const list = page.getByRole("listbox");
      await expect(list).toHaveAttribute("aria-multiselectable", "true");
      for (const choice of choices) {
        const option = list.getByRole("option", { name: choice, exact: true });
        await option.click();
        await expect(option).toHaveAttribute("aria-selected", "true");
      }
      await page.keyboard.press("Escape");
      await expect(trigger).toBeFocused();
    }
    await expect(
      page.locator(".timeline-row-label:not(.task-row)"),
    ).toHaveCount(2);
    await expect(page.locator(".timeline-row-label")).toContainText([
      "Blocked backlog",
      "Other backlog",
    ]);
    await page.getByRole("button", { name: /^Features(?:\s|$)/ }).click();
    await expect(page.locator(".feature-item")).toHaveCount(2);
    await expect(page.locator(".feature-item")).toContainText([
      "Blocked backlog",
      "Other backlog",
    ]);
    for (const field of ["person", "sprint", "status", "risk"])
      await expect(
        page.getByRole("button", { name: new RegExp(`Filter by ${field}`) }),
      ).toContainText("2 selected");
    await page.reload();
    await page.getByRole("button", { name: /^Features(?:\s|$)/ }).click();
    await expect(page.locator(".feature-item")).toHaveCount(2);
    await page
      .getByRole("textbox", { name: "Search features", exact: true })
      .fill("Blocked");
    await expect(page.locator(".feature-item")).toHaveCount(1);
    await page
      .getByRole("button", { name: "Reset filters", exact: true })
      .click();
    await expect(
      page.getByRole("textbox", { name: "Search features", exact: true }),
    ).toHaveValue("Blocked");
    await expect(page.locator(".feature-item")).toHaveCount(1);
    await page
      .getByRole("textbox", { name: "Search features", exact: true })
      .fill("");
    await expect(page.locator(".feature-item")).toHaveCount(4);
    const status = page.getByRole("button", { name: /Filter by status/ });
    await status.click();
    await page.getByRole("option", { name: "Blocked", exact: true }).click();
    await page.getByRole("option", { name: "Blocked", exact: true }).click();
    await page.keyboard.press("Escape");
    await expect(status).toContainText("All statuses");
    await expect(page.locator(".feature-item")).toHaveCount(4);
    await status.focus();
    await page.keyboard.press("Enter");
    const planned = page.getByRole("option", { name: "Planned", exact: true });
    await planned.focus();
    await page.keyboard.press("Space");
    await expect(planned).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Escape");
    await page
      .getByRole("button", { name: "Reset filters", exact: true })
      .click();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `test-results/planning-filters-${width}x${height}.png`,
      fullPage: true,
    });
    expect(await (await request.get("/api/state")).json()).toEqual(before);
    expect(issues).toEqual([]);
  });
}
