import { test, expect } from "@playwright/test";
import { maintenanceFixture } from "../scripts/maintenance-fixture";

test("managed quit can be cancelled and requires explicit confirmation without changing saved plans", async ({
  page,
  request,
}) => {
  const { revision } = await (await request.get("/api/state")).json();
  expect(
    (
      await request.put("/api/state", {
        data: { revision, state: maintenanceFixture() },
      })
    ).ok(),
  ).toBeTruthy();
  await page.route("**/api/runtime", (route) =>
    route.fulfill({ json: { managed: true, quitToken: "synthetic-token" } }),
  );
  let quits = 0;
  await page.route("**/api/quit", (route) => {
    expect(route.request().headers()["x-delivery-studio-token"]).toBe(
      "synthetic-token",
    );
    quits++;
    return route.fulfill({ json: { stopping: true } });
  });
  await page.route("**/api/health", (route) =>
    quits ? route.abort("connectionrefused") : route.continue(),
  );
  await page.goto("/?desktop=1");
  const quit = page.getByRole("button", {
    name: "Quit Delivery Studio",
    exact: true,
  });
  await expect(quit).toBeVisible();
  const before = (await request.get("/api/state")).json();
  page.once("dialog", (dialog) => dialog.dismiss());
  await quit.click();
  expect(quits).toBe(0);
  await expect(quit).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await quit.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Delivery Studio stopped", exact: true }),
  ).toBeVisible();
  expect(quits).toBe(1);
  await expect((await request.get("/api/state")).json()).resolves.toEqual(
    await before,
  );
  await expect(page.locator("#planner-app")).toHaveAttribute("inert", "");
});

test("a server that remains running after quit shows a recoverable error", async ({
  page,
}) => {
  await page.route("**/api/runtime", (route) =>
    route.fulfill({ json: { managed: true, quitToken: "failure-token" } }),
  );
  await page.route("**/api/quit", (route) =>
    route.fulfill({ json: { stopping: true } }),
  );
  await page.goto("/?desktop=1");
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "Quit Delivery Studio", exact: true })
    .click();
  await expect(
    page.getByText("Delivery Studio is still running. Try quitting again.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Delivery Studio stopped", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator("#planner-app")).not.toHaveAttribute("inert", "");
  await expect(
    page.getByRole("button", { name: "Quit Delivery Studio", exact: true }),
  ).toBeEnabled();
});
