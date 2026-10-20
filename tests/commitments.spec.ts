import {
  openFeatureSection,
  confirmSchedulingReview,
} from "./helpers/ui-workflows";
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
      id: "a",
      name: "Commitment QA",
      color: "#7565db",
      weekends: [0, 6],
      planningStart: "2026-10-12",
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
  sprints: [
    {
      id: "s",
      appId: "a",
      number: 1,
      start: "2026-10-12",
      end: "2026-10-23",
      goal: "Long delivery",
      notes: "",
      snapshot: "Original finalized plan",
    },
  ],
  features: [
    {
      id: "f",
      planningFrom: "2026-10-06",
      appId: "a",
      title: "Five sprint delivery",
      description: "",
      completion: "",
      priority: 0,
      tasks: [],
      sprintEstimate: 5,
      assigneeIds: ["p"],
      estimateEffort: [{ personId: "p", hours: 400 }],
      status: "todo",
      committed: false,
      sprintId: "s",
      link: "",
    },
  ],
};

async function persisted(request: APIRequestContext) {
  return (await (await request.get("/api/state")).json()).state;
}
async function write(request: APIRequestContext, state: unknown) {
  const { revision } = await (await request.get("/api/state")).json();
  expect(
    (await request.put("/api/state", { data: { revision, state } })).ok(),
  ).toBeTruthy();
}
async function sprints(page: Page) {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Sprints & plans", exact: true })
    .click();
}
async function features(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /^Features / }).click();
}

test.beforeEach(async ({ page, request }) => {
  await page.clock.install({ time: new Date("2026-10-06T10:00:00Z") });
  await write(request, seed);
});

// Catches treating the assigned starting sprint as a delivery deadline, and
// accepting a new commitment before the saved effort has been scheduled.
test("five-sprint delivery accepts its full forecast and leave causes seven calendar days of risk", async ({
  page,
  request,
}) => {
  await sprints(page);
  await page.getByLabel("Committed", { exact: true }).check();
  await expect(page.getByRole("status")).toContainText("Saved");
  const accepted = await persisted(request);
  expect(accepted.features[0].commitment).toEqual({
    end: "2026-12-18",
    acceptedAt: "2026-10-06",
  });
  await expect(page.locator(".sprint-card")).not.toContainText("At risk");
  await expect(page.locator(".sprint-feature-row")).toContainText(
    "Accepted delivery: Dec 18, 2026",
  );

  await write(request, {
    ...accepted,
    leaves: [
      {
        id: "l",
        personId: "p",
        start: "2026-10-19",
        end: "2026-10-23",
        hours: null,
        note: "One week away",
      },
    ],
  });
  await page.reload();
  await page
    .getByRole("button", { name: "Sprints & plans", exact: true })
    .click();
  await expect(page.locator(".sprint-card")).toContainText("At risk");
  await expect(page.locator(".sprint-feature-row")).toContainText(
    "Forecast: Dec 25, 2026",
  );
  await expect(page.locator(".sprint-feature-row")).toContainText(
    "7 calendar days later",
  );
  expect((await persisted(request)).features[0].commitment.end).toBe(
    "2026-12-18",
  );

  await page
    .getByRole("button", {
      name: "Refresh sprint commitment dates",
      exact: true,
    })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Commitment dates refreshed",
  );
  await expect(page.locator(".sprint-card")).not.toContainText("At risk");
  const refreshed = await persisted(request);
  expect(refreshed.features[0].commitment.end).toBe("2027-01-01");
  expect(refreshed.features[0].estimateEffort).toEqual([
    { personId: "p", hours: 400 },
  ]);
  expect(refreshed.sprints[0].snapshot).toBe("Original finalized plan");
});

// Catches silently inventing baselines for legacy committed records on saves.
test("legacy commitments stay missing until an explicit per-feature refresh", async ({
  page,
  request,
}) => {
  await write(request, {
    ...seed,
    features: [{ ...seed.features[0], committed: true }],
  });
  await features(page);
  await expect(page.locator(".feature-item")).toContainText(
    "Accept commitment dates",
  );
  await page
    .getByRole("button", { name: "Edit Five sprint delivery", exact: true })
    .click();
  await openFeatureSection(page, "Details & completion");
  await page
    .getByLabel("Description", { exact: true })
    .fill("Updated description");
  await page.getByRole("button", { name: "Save feature", exact: true }).click();
  await confirmSchedulingReview(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect((await persisted(request)).features[0].commitment).toBeUndefined();
  await page
    .getByRole("button", {
      name: "Refresh commitment date for Five sprint delivery",
      exact: true,
    })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Commitment dates refreshed",
  );
  expect((await persisted(request)).features[0].commitment.end).toBe(
    "2026-12-18",
  );
  await page.reload();
  await page.getByRole("button", { name: /^Features / }).click();
  await expect(page.locator(".feature-item")).toContainText(
    "Accepted delivery: Dec 18, 2026",
  );
});

// Catches false success / lost accepted dates when an explicit refresh fails.
test("failed app refresh retains its baseline and can be retried", async ({
  page,
  request,
}) => {
  await write(request, {
    ...seed,
    features: [
      {
        ...seed.features[0],
        committed: true,
        commitment: { end: "2026-12-11", acceptedAt: "2026-10-05" },
      },
    ],
  });
  await features(page);
  await page.route("**/api/state", async (route) => {
    if (route.request().method() === "PUT") {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "Refresh failed. Try again." }),
      });
    } else await route.continue();
  });
  await page
    .getByRole("button", { name: "Refresh app commitment dates", exact: true })
    .click();
  await expect(page.getByRole("alert").first()).toContainText("Refresh failed");
  expect((await persisted(request)).features[0].commitment.end).toBe(
    "2026-12-11",
  );
  await page.unroute("**/api/state");
  await page
    .getByRole("button", { name: "Refresh app commitment dates", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Commitment dates refreshed",
  );
  expect((await persisted(request)).features[0].commitment.end).toBe(
    "2026-12-18",
  );
});

// Catches confusing an optional target with accepted delivery risk.
test("target warnings remain visible without marking the sprint commitment at risk", async ({
  page,
  request,
}) => {
  await write(request, {
    ...seed,
    features: [
      {
        ...seed.features[0],
        committed: true,
        target: "2026-10-23",
        commitment: { end: "2026-12-18", acceptedAt: "2026-10-06" },
      },
    ],
  });
  await sprints(page);
  await expect(
    page.locator(".sprint-feature-row .inline-warning"),
  ).toBeVisible();
  await expect(page.locator(".sprint-card")).not.toContainText("At risk");
  await page.getByLabel("Committed", { exact: true }).uncheck();
  await expect(page.getByRole("status")).toContainText("Saved");
  expect((await persisted(request)).features[0].commitment).toBeUndefined();
});

// Catches bulk acceptance rewriting completed history or non-committed work.
test("app refresh accepts unfinished commitments and preserves completed and uncommitted work", async ({
  page,
  request,
}) => {
  const completed = {
    ...seed.features[0],
    id: "completed",
    title: "Finished work",
    priority: 1,
    committed: true,
    status: "done",
    actualStart: "2026-10-01",
    actualEnd: "2026-10-02",
    commitment: { end: "2026-10-02", acceptedAt: "2026-10-01" },
  };
  const uncommitted = {
    ...seed.features[0],
    id: "uncommitted",
    title: "Other planned work",
    priority: 2,
  };
  await write(request, {
    ...seed,
    features: [
      { ...seed.features[0], committed: true },
      completed,
      uncommitted,
    ],
  });
  await features(page);
  await page
    .getByRole("button", { name: "Refresh app commitment dates", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Commitment dates refreshed",
  );
  const saved = await persisted(request);
  expect(saved.features[0].commitment.end).toBe("2026-12-18");
  expect(saved.features[1].commitment).toEqual(completed.commitment);
  expect(saved.features[2].commitment).toBeUndefined();
  await expect(
    page.getByRole("button", {
      name: "Refresh commitment date for Finished work",
      exact: true,
    }),
  ).toHaveCount(0);
});

// Catches a refresh accepting an unavailable forecast / erasing its old date.
test("unscheduled commitment explains the planning problem and rejects bulk refresh", async ({
  page,
  request,
}) => {
  await write(request, {
    ...seed,
    features: [
      {
        ...seed.features[0],
        committed: true,
        status: "blocked",
        tasks: [
          {
            id: "unavailable",
            title: "Unresolved dependency",
            personId: "p",
            scope: "Backend",
            hours: 8,
            status: "todo",
            dependsOn: ["unavailable"],
          },
        ],
        commitment: { end: "2026-12-18", acceptedAt: "2026-10-06" },
      },
    ],
  });
  await features(page);
  await expect(
    page.getByRole("button", {
      name: "Refresh commitment date for Five sprint delivery",
      exact: true,
    }),
  ).toBeDisabled();
  await expect(page.locator(".feature-item")).toContainText("Not scheduled");
  await page
    .getByRole("button", { name: "Refresh app commitment dates", exact: true })
    .click();
  await expect(page.getByRole("alert").first()).toContainText(
    "Five sprint delivery",
  );
  expect((await persisted(request)).features[0].commitment.end).toBe(
    "2026-12-18",
  );
});

// Catches overlapping acceptance writes while the previous save is pending.
test("commitment controls wait for the pending save", async ({
  page,
  request,
}) => {
  await write(request, {
    ...seed,
    features: [{ ...seed.features[0], committed: true }],
  });
  await features(page);
  let release: (() => void) | undefined;
  await page.route("**/api/state", async (route) => {
    if (route.request().method() === "PUT") {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    }
    await route.continue();
  });
  await page
    .getByRole("button", { name: "Refresh app commitment dates", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Refresh app commitment dates",
      exact: true,
    }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", {
      name: "Refresh commitment date for Five sprint delivery",
      exact: true,
    }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Sprints & plans", exact: true })
    .click();
  await expect(page.getByLabel("Committed", { exact: true })).toBeDisabled();
  await expect.poll(() => !!release).toBe(true);
  release?.();
  await expect(page.getByRole("status")).toContainText(
    "Commitment dates refreshed",
  );
  await expect(page.getByLabel("Committed", { exact: true })).toBeEnabled();
});

async function uploadBackup(
  page: Page,
  backup: unknown,
  reviewExpected = true,
) {
  await page.goto("/");
  await page.getByRole("button", { name: "App settings", exact: true }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByLabel("Restore backup", { exact: true }).setInputFiles({
    name: "commitments-backup.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(backup)),
  });
  const review = page.getByRole("dialog", {
    name: "Review scheduling changes",
    exact: true,
  });
  if (reviewExpected) {
    await expect(review).toBeVisible();
    await review
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
  } else {
    await expect(page.getByRole("status")).toContainText("Backup restored");
    await expect(review).toHaveCount(0);
  }
}

// Catches treating imported commitment records as freshly checked commitments,
// overwriting saved accepted dates during a restore into an uncommitted workspace.
test("backup restore preserves the complete saved commitment JSON and remains undoable", async ({
  page,
  request,
}) => {
  const previous = await persisted(request);
  const backup = {
    ...previous,
    leaves: [
      {
        id: "restored-leave",
        personId: "p",
        start: "2026-10-19",
        end: "2026-10-23",
        hours: null,
        note: "Backup leave",
      },
    ],
    features: [
      {
        ...previous.features[0],
        committed: true,
        commitment: { end: "2026-12-11", acceptedAt: "2026-09-30" },
      },
      {
        ...previous.features[0],
        id: "restored-feature",
        title: "Imported delivery",
        priority: 1,
        committed: true,
        commitment: { end: "2027-03-01", acceptedAt: "2026-09-29" },
      },
    ],
  };
  await uploadBackup(page, backup);
  await expect(page.getByRole("status")).toContainText("Backup restored");
  expect(await persisted(request)).toEqual(backup);
  await page.reload();
  await page.getByRole("button", { name: /^Features / }).click();
  await expect(
    page.locator(".feature-item").filter({ hasText: "Five sprint delivery" }),
  ).toContainText("Accepted on Sep 30, 2026");

  // Restore again through the actual upload flow to verify the history entry
  // retained the previous state; reloading intentionally clears in-memory undo.
  await write(request, previous);
  await page.reload();
  await page.getByRole("button", { name: "App settings", exact: true }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByLabel("Restore backup", { exact: true }).setInputFiles({
    name: "commitments-backup.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(backup)),
  });
  const review = page.getByRole("dialog", {
    name: "Review scheduling changes",
    exact: true,
  });
  await expect(review).toBeVisible();
  await review
    .getByRole("button", { name: "Save changes", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Backup restored");
  await page
    .getByRole("button", { name: "Undo last change", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Last change undone");
  expect(await persisted(request)).toEqual(previous);
});

// Catches rejecting valid legacy committed backups because blocked/completed
// records cannot accept a new forecast, or silently creating missing baselines.
test("backup restore accepts blocked completed and planned legacy commitments without inventing dates", async ({
  page,
  request,
}) => {
  const previous = await persisted(request);
  const backup = {
    ...previous,
    features: [
      { ...previous.features[0], committed: true, status: "blocked" },
      {
        ...previous.features[0],
        id: "restored-done",
        title: "Completed legacy delivery",
        priority: 1,
        committed: true,
        status: "done",
        actualStart: "2026-09-28",
        actualEnd: "2026-09-29",
      },
      {
        ...previous.features[0],
        id: "restored-planned",
        title: "Planned legacy delivery",
        priority: 2,
        committed: true,
      },
    ],
  };
  await uploadBackup(page, backup, false);
  await expect(page.getByRole("status")).toContainText("Backup restored");
  expect(await persisted(request)).toEqual(backup);
  await page.reload();
  await page.getByRole("button", { name: /^Features / }).click();
  await expect(page.locator(".commitment-missing")).toHaveCount(3);
  await expect(
    page.locator(".feature-item").filter({ hasText: "Five sprint delivery" }),
  ).toContainText("Planned");
  await expect(
    page
      .locator(".feature-item")
      .filter({ hasText: "Completed legacy delivery" }),
  ).toContainText("Done");
});

// Catches losing an accepted baseline when commitment is toggled off and back
// on in the same unsaved editor session, which is no commitment change.
test("unsaved off-on commitment toggle preserves the previously accepted baseline", async ({
  page,
  request,
}) => {
  const accepted = { end: "2026-12-11", acceptedAt: "2026-09-30" };
  await write(request, {
    ...seed,
    features: [{ ...seed.features[0], committed: true, commitment: accepted }],
  });
  await features(page);
  await page
    .getByRole("button", { name: "Edit Five sprint delivery", exact: true })
    .click();
  await openFeatureSection(page, "Scheduling options");
  await page.getByLabel("Accept delivery date", { exact: true }).uncheck();
  await openFeatureSection(page, "Scheduling options");
  await page.getByLabel("Accept delivery date", { exact: true }).check();
  await page.getByRole("button", { name: "Save feature", exact: true }).click();
  await confirmSchedulingReview(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect((await persisted(request)).features[0].commitment).toEqual(accepted);
  await expect(page.locator(".feature-item")).toContainText(
    "Accepted on Sep 30, 2026",
  );
});

// Catches undersized refresh touch targets on tablet layouts.
test("commitment refresh remains tappable at 744 and 1133 tablet widths", async ({
  page,
  request,
}) => {
  await write(request, {
    ...seed,
    features: [
      {
        ...seed.features[0],
        committed: true,
        commitment: { end: "2026-12-11", acceptedAt: "2026-09-30" },
      },
    ],
  });
  await features(page);
  for (const width of [744, 1133]) {
    await page.setViewportSize({ width, height: 1000 });
    const refresh = page.getByRole("button", {
      name: "Refresh commitment date for Five sprint delivery",
      exact: true,
    });
    await expect(refresh).toBeVisible();
    expect((await refresh.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    await refresh.click();
    await expect(page.getByRole("status")).toContainText(
      "Commitment dates refreshed",
    );
    expect((await persisted(request)).features[0].commitment.end).toBe(
      "2026-12-18",
    );
  }
});
