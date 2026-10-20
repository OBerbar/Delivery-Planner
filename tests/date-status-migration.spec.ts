import { expect, test } from "@playwright/test";
import { maintenanceFixture } from "../scripts/maintenance-fixture";
import { observeBrowser } from "../scripts/browser-observability";

test("first opening legacy work persists its planning date once and keeps Done after next-day reload without editing", async ({
  page,
  request,
}) => {
  const issues = observeBrowser(page);
  await page.clock.install({ time: new Date("2030-01-07T12:00:00Z") });
  const state = maintenanceFixture();
  state.features = [state.features[0]];
  delete state.features[0].planningFrom;
  state.features[0].estimateEffort = [{ personId: "p", hours: 8 }];
  const current = await (await request.get("/api/state")).json();
  expect(
    (
      await request.put("/api/state", {
        data: { revision: current.revision, state },
      })
    ).ok(),
  ).toBe(true);
  const before = await (await request.get("/api/state")).json();

  await page.goto("/");
  const feature = page.locator(".timeline-bar", {
    hasText: "Five sprint delivery",
  });
  await expect(feature).toContainText("In progress");
  const firstDates = (await feature.getAttribute("aria-label"))!.split(
    " · ",
  )[0];
  const migrated = await (await request.get("/api/state")).json();
  expect(migrated).toEqual({
    revision: before.revision + 1,
    state: {
      ...before.state,
      features: [{ ...before.state.features[0], planningFrom: "2030-01-07" }],
    },
  });

  await page.clock.fastForward(86_400_000);
  await expect(feature).toContainText("Done");
  await page.reload();
  await expect(feature).toContainText("Done");
  expect((await feature.getAttribute("aria-label"))!.split(" · ")[0]).toBe(
    firstDates,
  );
  expect(await (await request.get("/api/state")).json()).toEqual(migrated);
  expect(issues).toEqual([]);
});
