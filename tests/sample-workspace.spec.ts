import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { maintenanceFixture } from "../scripts/maintenance-fixture";
import { observeBrowser } from "../scripts/browser-observability";
import { emptyState } from "../src/lib/model";

// Catch any sample operation reaching the real workspace, including restores,
// experiment Apply/Discard and resets. All server data here is synthetic.
test("sample edits, experiments, restore, undo and reset never access the saved workspace", async ({
  page,
  request,
}) => {
  const original = maintenanceFixture();
  original.apps[0].name = "Keep my saved workspace";
  const { revision } = await (await request.get("/api/state")).json();
  expect(
    (
      await request.put("/api/state", { data: { revision, state: original } })
    ).ok(),
  ).toBeTruthy();
  const before = await (await request.get("/api/state")).json();
  const errors = observeBrowser(page);
  const apiRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/"))
      apiRequests.push(
        request.method() + " " + new URL(request.url()).pathname,
      );
  });
  await page.goto("/?sample=1&desktop=1");
  await expect(
    page.getByRole("region", { name: "Sample workspace", exact: true }),
  ).toBeVisible({ timeout: 5000 });
  await expect(
    page.getByRole("heading", { name: "Timeline", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Quit Delivery Studio", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "What-if planning", exact: true })
    .click();
  await page.getByRole("button", { name: "Add feature", exact: true }).click();
  await page
    .getByLabel("Feature title", { exact: true })
    .fill("Urgent sample request");
  await page.getByLabel("Main assignee: Sam Rivera", { exact: true }).check();
  await page.getByLabel("Working days estimation", { exact: true }).fill("2");
  await page.getByRole("button", { name: "Save feature", exact: true }).click();
  const experiment = page.getByRole("region", {
    name: "What-if experiment",
    exact: true,
  });
  await experiment.locator("summary").click();
  await expect(experiment).toContainText("Checkout");
  await expect(experiment).toContainText("calendar days later");
  await page
    .getByRole("button", { name: "Apply experiment", exact: true })
    .click();
  await expect(experiment).toHaveCount(0);
  await expect(page.locator(".notice")).toContainText("sample");
  await page
    .getByRole("button", { name: "Undo last change", exact: true })
    .click();
  await page
    .getByRole("button", { name: "What-if planning", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Discard experiment", exact: true })
    .click();
  await expect(experiment).toHaveCount(0);
  await page.getByRole("button", { name: "App settings", exact: true }).click();
  page.once("dialog", (dialog) => dialog.accept());
  const replacement = structuredClone(original);
  replacement.apps[0].name = "Restored inside sample only";
  await page.getByLabel("Restore backup", { exact: true }).setInputFiles({
    name: "fictional-backup.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(replacement)),
  });
  const review = page.getByRole("dialog", {
    name: "Review scheduling changes",
    exact: true,
  });
  if (await review.isVisible())
    await review
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
  await expect(page.locator(".app-switch")).toContainText(
    "Restored inside sample only",
  );
  const reset = page.getByRole("button", { name: "Reset sample", exact: true });
  page.once("dialog", (dialog) => dialog.dismiss());
  await reset.click();
  await expect(page.locator(".app-switch")).toContainText(
    "Restored inside sample only",
  );
  page.once("dialog", (dialog) => dialog.accept());
  await reset.click();
  await expect(page.locator(".app-switch")).toContainText("Northstar");
  await page.reload();
  await expect(page.locator(".app-switch")).toContainText("Northstar");
  expect(apiRequests).toEqual([]);
  expect(await (await request.get("/api/state")).json()).toEqual(before);
  expect(errors).toEqual([]);
});

test("sample opens in a separate tab, fits desktop and tablets, and returns to the saved planner @a11y", async ({
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
  const before = await (await request.get("/api/state")).json();
  await page.goto("/");
  await page.getByRole("button", { name: "App settings", exact: true }).click();
  const link = page.getByRole("link", {
    name: "Try sample workspace (opens a new tab)",
    exact: true,
  });
  await page
    .getByLabel("App name", { exact: true })
    .fill("Unsaved personal draft stays here");
  const preferences = await page.evaluate(() => Object.entries(localStorage));
  await expect(link).toHaveAttribute("target", "_blank");
  await link.focus();
  const popup = page.waitForEvent("popup");
  await page.keyboard.press("Enter");
  const sample = await popup;
  const errors = observeBrowser(sample);
  const banner = sample.getByRole("region", {
    name: "Sample workspace",
    exact: true,
  });
  for (const viewport of [
    { width: 1920, height: 1080 },
    { width: 744, height: 1133 },
    { width: 1133, height: 744 },
    { width: 375, height: 812 },
  ]) {
    await sample.setViewportSize(viewport);
    // On phones the established expanded navigation overlays the content.
    // Close it through the real control before measuring the visible banner.
    if (viewport.width <= 600) {
      const collapse = sample.getByRole("button", {
        name: "Collapse navigation",
        exact: true,
      });
      if (await collapse.isVisible()) await collapse.click();
    }
    await expect(banner).toBeVisible();
    const bannerBox = await banner.boundingBox();
    const navigationBox = await sample
      .getByRole("complementary", { name: "Workspace navigation", exact: true })
      .boundingBox();
    expect(bannerBox!.x).toBeGreaterThanOrEqual(
      navigationBox!.x + navigationBox!.width,
    );
    await expect(
      banner.getByRole("button", { name: "Reset sample", exact: true }),
    ).toBeVisible();
    expect(
      await sample.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBeLessThanOrEqual(1);
  }
  await sample.setViewportSize({ width: 744, height: 1133 });
  expect((await new AxeBuilder({ page: sample }).analyze()).violations).toEqual(
    [],
  );
  const guideOpened = sample.waitForEvent("popup");
  await banner
    .getByRole("link", {
      name: "First-plan walkthrough (opens a new tab)",
      exact: true,
    })
    .click();
  const guide = await guideOpened;
  await expect(
    guide.getByRole("heading", {
      name: "Try your first delivery decision",
      exact: true,
    }),
  ).toBeVisible();
  await expect(guide.locator("article img")).toHaveCount(5);
  await expect
    .poll(() =>
      guide
        .locator("article img")
        .evaluateAll((images) =>
          images.every(
            (image) =>
              (image as HTMLImageElement).complete &&
              (image as HTMLImageElement).naturalWidth > 0,
          ),
        ),
    )
    .toBeTruthy();
  await guide
    .getByRole("navigation", { name: "Guide navigation", exact: true })
    .getByRole("link", { name: "Download and installation", exact: true })
    .click();
  await expect(
    guide.getByRole("heading", {
      name: "Download and start Delivery Studio",
      exact: true,
    }),
  ).toBeVisible();
  await expect
    .poll(() =>
      guide
        .locator("article img")
        .evaluateAll(
          (images) =>
            images.length === 1 &&
            images.every(
              (image) => (image as HTMLImageElement).naturalWidth > 0,
            ),
        ),
    )
    .toBeTruthy();
  await guide
    .getByRole("navigation", { name: "Guide navigation", exact: true })
    .getByRole("link", { name: "First-plan walkthrough", exact: true })
    .click();
  await guide
    .getByRole("link", { name: "Back to sample", exact: true })
    .click();
  await expect(
    guide.getByRole("region", { name: "Sample workspace", exact: true }),
  ).toBeVisible();
  await guide.close();
  await expect(banner).toBeVisible();
  await banner
    .getByRole("link", { name: "Open my saved planner", exact: true })
    .click();
  await expect(banner).toHaveCount(0);
  await expect(page.getByLabel("App name", { exact: true })).toHaveValue(
    "Unsaved personal draft stays here",
  );
  expect(await page.evaluate(() => Object.entries(localStorage))).toEqual(
    preferences,
  );
  expect(await (await request.get("/api/state")).json()).toEqual(before);
  expect(errors).toEqual([]);
  await sample.close();
});

test("a first-time visitor can explore and reset without populating the empty saved workspace", async ({
  page,
  request,
}) => {
  const { revision } = await (await request.get("/api/state")).json();
  expect(
    (
      await request.put("/api/state", { data: { revision, state: emptyState } })
    ).ok(),
  ).toBeTruthy();
  const before = await (await request.get("/api/state")).json();
  await page.goto("/");
  await expect(
    page.getByRole("link", {
      name: "Try sample workspace (opens a new tab)",
      exact: true,
    }),
  ).toBeVisible();
  await page.goto("/?sample=1");
  await page.getByRole("button", { name: "App settings", exact: true }).click();
  await page
    .getByLabel("App name", { exact: true })
    .fill("Unsaved sample draft");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Reset sample", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Timeline", exact: true }),
  ).toBeVisible();
  expect(await (await request.get("/api/state")).json()).toEqual(before);
  await page
    .getByRole("link", { name: "Open my saved planner", exact: true })
    .click();
  await expect(page.getByLabel("App name", { exact: true })).toHaveValue("");
  expect(await (await request.get("/api/state")).json()).toEqual(before);
});
