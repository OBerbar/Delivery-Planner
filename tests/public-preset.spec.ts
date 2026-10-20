import { test, expect } from "@playwright/test";
import { emptyState } from "../src/lib/model";
import { maintenanceFixture } from "../scripts/maintenance-fixture";

test("example setup saves fictional people and neutral terms without replacing existing work", async ({
  page,
  request,
}) => {
  const original = maintenanceFixture();
  original.apps[0].name = "Owner workspace";
  original.apps[0].terms = "Keep these custom owner terms.";
  const initial = await request.get("http://127.0.0.1:4313/api/state");
  const { revision } = await initial.json();
  expect(
    (
      await request.put("http://127.0.0.1:4313/api/state", {
        data: { revision, state: original },
      })
    ).ok(),
  ).toBeTruthy();
  await page.goto("/");
  await page.getByRole("button", { name: "Add an app", exact: true }).click();
  await page.getByLabel("App name", { exact: true }).fill("My next product");
  const preset = page.getByRole("button", {
    name: "Use example team",
    exact: true,
  });
  await expect(preset).toBeVisible({ timeout: 5000 });
  await preset.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("App name", { exact: true })).toHaveValue(
    "My next product",
  );
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByLabel("Person 1 name", { exact: true })).toHaveValue(
    "Alex Morgan",
  );
  await expect(page.getByLabel("Person 6 role", { exact: true })).toHaveValue(
    "Design",
  );
  await page.getByLabel("Person 1 name", { exact: true }).fill("My developer");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByLabel("Plan in sprints", { exact: true }).check();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByLabel("General terms for sprint plans")).toHaveValue(
    /Review changes to scope, priorities, and availability before accepting new delivery dates/,
  );
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page
    .getByRole("button", { name: "Open my planner", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Timeline", exact: true }),
  ).toBeVisible();
  await page.reload();
  const saved = (
    await (await request.get("http://127.0.0.1:4313/api/state")).json()
  ).state;
  expect(
    saved.apps.find((app: { id: string }) => app.id === original.apps[0].id),
  ).toEqual(original.apps[0]);
  expect(saved.people.slice(0, original.people.length)).toEqual(
    original.people,
  );
  expect(saved.features).toEqual(original.features);
  expect(
    saved.sprints.find(
      (sprint: { id: string }) => sprint.id === original.sprints[0].id,
    ),
  ).toEqual(original.sprints[0]);
  expect(
    saved.people
      .slice(original.people.length)
      .map((person: { name: string }) => person.name),
  ).toEqual([
    "My developer",
    "Sam Rivera",
    "Jordan Lee",
    "Taylor Quinn",
    "Casey Brooks",
    "Jamie Parker",
  ]);
  expect(saved.apps[1].name).toBe("My next product");
});

test("example setup suggests a neutral project name and remains usable on tablets", async ({
  page,
  request,
}) => {
  const { revision } = await (
    await request.get("http://127.0.0.1:4313/api/state")
  ).json();
  expect(
    (
      await request.put("http://127.0.0.1:4313/api/state", {
        data: { revision, state: emptyState },
      })
    ).ok(),
  ).toBeTruthy();
  await page.goto("/");
  for (const viewport of [
    { width: 744, height: 1133 },
    { width: 1133, height: 744 },
    { width: 1920, height: 1080 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(
      page.getByRole("button", { name: "Use example team", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
  }
  await page
    .getByRole("button", { name: "Use example team", exact: true })
    .click();
  await expect(page.getByLabel("App name", { exact: true })).toHaveValue(
    "Northstar",
  );
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByLabel("Person 6 name", { exact: true })).toHaveValue(
    "Jamie Parker",
  );
});
