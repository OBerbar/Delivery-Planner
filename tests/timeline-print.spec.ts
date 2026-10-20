import { test, expect, type Page } from "@playwright/test";
import {
  populatedFixture,
  largeFixture,
  fixedToday,
} from "../scripts/maintenance-fixture";
import { observeBrowser } from "../scripts/browser-observability";
const issues = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page, context, request }) => {
  issues.set(page, observeBrowser(page));
  context.on("page", (p) => {
    const found = observeBrowser(p);
    p.on("close", () => issues.get(page)!.push(...found));
  });
  await context.addInitScript(() => {
    window.print = () => {
      document.documentElement.dataset.printCalls = String(
        Number(document.documentElement.dataset.printCalls ?? 0) + 1,
      );
    };
  });
  await page.clock.install({ time: new Date(`${fixedToday}T10:00:00Z`) });
  const { revision } = await (await request.get("/api/state")).json();
  expect(
    (
      await request.put("/api/state", {
        data: { revision, state: populatedFixture() },
      })
    ).ok(),
  ).toBe(true);
});
test.afterEach(async ({ page }) => expect(issues.get(page)).toEqual([]));

for (const [width, height] of [
  [744, 1133],
  [1133, 744],
  [1920, 1080],
]) {
  test(`vertically compact feature PDF has only title labels and smaller rows at ${width}px`, async ({
    page,
    request,
  }, testInfo) => {
    await page.setViewportSize({ width, height });
    await page.goto("/");
    await page.getByRole("button", { name: "By person", exact: true }).click();
    if (width === 1920)
      await page
        .getByRole("button", { name: "What-if planning", exact: true })
        .click();
    const before = await (await request.get("/api/state")).json();
    const button = page.getByRole("button", {
      name: "Export compact features PDF",
      exact: true,
    });
    await expect(button).toBeVisible();
    const box = (await button.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.width).toBeGreaterThanOrEqual(44);
    await button.focus();
    await expect(button).toBeFocused();
    const opened = page.waitForEvent("popup");
    await page.keyboard.press("Enter");
    const preview = await opened;
    await expect(
      preview.getByRole("heading", {
        name: "By feature · Compact",
        exact: true,
      }),
    ).toHaveCount(1);
    await expect(
      preview.locator('[data-person-id], [data-view="people"]'),
    ).toHaveCount(0);
    const rows = await preview.locator("[data-row-id]").evaluateAll((nodes) =>
      nodes.map((node) => ({
        labels: Array.from(node.querySelectorAll(":scope > text"))
          .map((text) => text.textContent)
          .join(" "),
        height: Number(
          node.querySelector(":scope > rect")!.getAttribute("height"),
        ),
      })),
    );
    expect(rows).toEqual([
      { labels: "Five sprint delivery", height: 28 },
      { labels: "Mixed person estimates", height: 28 },
    ]);
    if (width === 1920)
      await expect(preview.locator(".print-page-header h1")).toContainText(
        "WHAT-IF",
      );
    await expect(
      preview.locator('[data-day-kind="leave"]').first(),
    ).toBeVisible();
    await expect(preview.locator("html")).toHaveAttribute(
      "data-print-calls",
      "1",
    );
    await preview
      .getByRole("button", { name: "Print / Save PDF", exact: true })
      .click();
    await expect(preview.locator("html")).toHaveAttribute(
      "data-print-calls",
      "2",
    );
    await page.screenshot({
      path: testInfo.outputPath("compact-toolbar.png"),
      fullPage: true,
    });
    await preview.screenshot({
      path: testInfo.outputPath("compact-preview.png"),
      fullPage: true,
    });
    const closed = preview.waitForEvent("close");
    await preview
      .getByRole("button", { name: "Close preview", exact: true })
      .click();
    await closed;
    await expect(
      page.getByRole("button", { name: "By person", exact: true }),
    ).toHaveClass("selected");
    expect(await (await request.get("/api/state")).json()).toEqual(before);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBeLessThanOrEqual(1);
  });
}

for (const [width, height] of [
  [744, 1133],
  [1133, 744],
  [1920, 1080],
]) {
  test(`feature-only PDF uses a compact Feature column and preserves the current view at ${width}px`, async ({
    page,
    request,
  }, testInfo) => {
    await page.setViewportSize({ width, height });
    await page.goto("/");
    await page.getByRole("button", { name: "By person", exact: true }).click();
    if (width === 1920)
      await page
        .getByRole("button", { name: "What-if planning", exact: true })
        .click();
    const before = await (await request.get("/api/state")).json();
    const button = page.getByRole("button", {
      name: "Export features PDF",
      exact: true,
    });
    await expect(button).toBeVisible();
    const box = (await button.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
    await button.focus();
    await expect(button).toBeFocused();
    const opened = page.waitForEvent("popup");
    await page.keyboard.press("Enter");
    const preview = await opened;
    await expect(preview.locator(".print-page")).toHaveCount(1);
    await expect(
      preview.getByRole("heading", { name: "By feature", exact: true }),
    ).toHaveCount(1);
    await expect(
      preview.locator("svg text").filter({ hasText: /^Feature$/ }),
    ).toHaveCount(1);
    await expect(
      preview.locator('[data-view="people"], [data-person-id]'),
    ).toHaveCount(0);
    await expect(preview.locator("body")).not.toContainText("By person");
    if (width === 1920)
      await expect(preview.locator(".print-page-header h1")).toContainText(
        "WHAT-IF",
      );
    await expect(preview.locator('[data-row-id="long"]')).toHaveCount(1);
    await expect(preview.locator('[data-row-id="mixed"]')).toHaveCount(1);
    const labelWidth = await preview
      .locator('[data-row-id="long"] > rect')
      .first()
      .getAttribute("width");
    expect(Number(labelWidth)).toBeLessThan(210);
    await expect(
      preview.locator('[data-day-kind="leave"]').first(),
    ).toBeVisible();
    await expect(preview.locator("html")).toHaveAttribute(
      "data-print-calls",
      "1",
    );
    await preview
      .getByRole("button", { name: "Print / Save PDF", exact: true })
      .click();
    await expect(preview.locator("html")).toHaveAttribute(
      "data-print-calls",
      "2",
    );
    await page.screenshot({
      path: testInfo.outputPath("feature-export-toolbar.png"),
      fullPage: true,
    });
    await preview.screenshot({
      path: testInfo.outputPath("features-pdf-preview.png"),
      fullPage: true,
    });
    const closed = preview.waitForEvent("close");
    await preview
      .getByRole("button", { name: "Close preview", exact: true })
      .click();
    await closed;
    await expect(
      page.getByRole("button", { name: "By person", exact: true }),
    ).toHaveClass("selected");
    expect(await (await request.get("/api/state")).json()).toEqual(before);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBeLessThanOrEqual(1);
  });
}

for (const [width, height] of [
  [744, 1133],
  [1133, 744],
  [1920, 1080],
  [3840, 2160],
]) {
  test(`timeline PDF includes both views and shaded time off without absence rows at ${width}px`, async ({
    page,
    request,
  }, testInfo) => {
    await page.setViewportSize({ width, height });
    await page.goto("/");
    await page.getByRole("button", { name: "By person", exact: true }).click();
    await page
      .getByRole("button", {
        name: "Collapse leaves and holidays",
        exact: true,
      })
      .click();
    const before = await (await request.get("/api/state")).json();
    const button = page.getByRole("button", {
      name: "Export timeline PDF",
      exact: true,
    });
    const box = (await button.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
    const opened = page.waitForEvent("popup");
    await button.focus();
    await page.keyboard.press("Enter");
    const preview = await opened;
    await expect(preview.locator(".print-page")).toHaveCount(2);
    await expect(
      preview.getByRole("heading", { name: "By feature", exact: true }),
    ).toHaveCount(1);
    await expect(
      preview.getByRole("heading", { name: "By person", exact: true }),
    ).toHaveCount(1);
    await expect(preview.locator('[data-row-id="long"]')).toHaveCount(1);
    await expect(preview.locator('[data-person-id="q"]')).toHaveCount(1);
    await expect(
      preview.locator('[data-day-kind="leave"]').first(),
    ).toBeVisible();
    await expect(
      preview.locator('[data-day-kind="holiday"]').first(),
    ).toBeVisible();
    await expect(
      preview.locator('[data-day-kind="weekend"]').first(),
    ).toBeVisible();
    await expect(
      preview.locator(
        ".timeline-availability-bar,.timeline-availability-label,.print-absence-row",
      ),
    ).toHaveCount(0);
    await expect(preview.locator("html")).toHaveAttribute(
      "data-print-calls",
      "1",
    );
    await preview
      .getByRole("button", { name: "Print / Save PDF", exact: true })
      .click();
    await expect(preview.locator("html")).toHaveAttribute(
      "data-print-calls",
      "2",
    );
    await preview.screenshot({
      path: testInfo.outputPath("timeline-pdf-preview.png"),
      fullPage: true,
    });
    await preview.close();
    await expect(
      page.getByRole("button", {
        name: "Expand leaves and holidays",
        exact: true,
      }),
    ).toHaveAttribute("aria-expanded", "false");
    await expect(
      page.getByRole("button", { name: "By person", exact: true }),
    ).toHaveClass("selected");
    expect(await (await request.get("/api/state")).json()).toEqual(before);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBeLessThanOrEqual(1);
  });
}

for (const exportName of [
  "Export timeline PDF",
  "Export features PDF",
  "Export compact features PDF",
]) {
  test(`${exportName}: blocked popup explains recovery and export succeeds after retry`, async ({
    page,
  }) => {
    await page.goto("/");
    await page.evaluate(() => {
      (
        window as typeof window & { originalOpen: typeof window.open }
      ).originalOpen = window.open;
      window.open = () => null;
    });
    await page.getByRole("button", { name: exportName, exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("Allow pop-ups");
    await expect(page.getByRole("alert")).toContainText(exportName);
    await page.evaluate(() => {
      window.open = (
        window as typeof window & { originalOpen: typeof window.open }
      ).originalOpen;
    });
    const opened = page.waitForEvent("popup");
    await page.getByRole("button", { name: exportName, exact: true }).click();
    const preview = await opened;
    await expect(preview.locator(".print-page")).toHaveCount(
      exportName === "Export timeline PDF" ? 2 : 1,
    );
    await expect(page.getByRole("alert")).toHaveCount(0);
    const closed = preview.waitForEvent("close");
    await preview
      .getByRole("button", { name: "Close preview", exact: true })
      .click();
    await closed;
    expect(preview.isClosed()).toBe(true);
  });
}

test("@pdf-file compact feature-only PDF packs titles and preserves wrapped long names without clipping", async ({
  page,
  request,
}, testInfo) => {
  const state = largeFixture();
  state.features = state.features.slice(0, 24);
  state.features.forEach((feature, i) => {
    feature.title = `Feature ${i}`;
  });
  state.features[0].title = "W".repeat(250);
  state.features[0].blocked = true;
  const { revision } = await (await request.get("/api/state")).json();
  expect(
    (await request.put("/api/state", { data: { revision, state } })).ok(),
  ).toBe(true);
  await page.goto("/");
  const opened = page.waitForEvent("popup");
  await page
    .getByRole("button", { name: "Export compact features PDF", exact: true })
    .click();
  const preview = await opened;
  await expect(preview.locator(".print-page")).toHaveCount(3);
  await expect(preview.locator("[data-row-id]")).toHaveCount(24);
  await expect(preview.locator("[data-person-id]")).toHaveCount(0);
  const layout = await preview.locator("[data-row-id]").evaluateAll((nodes) =>
    nodes.map((node) => {
      const background = node.querySelector<SVGRectElement>(":scope > rect")!;
      const bottom =
        Number(background.getAttribute("y")) +
        Number(background.getAttribute("height"));
      const labels = Array.from(
        node.querySelectorAll<SVGTextElement>(":scope > text"),
      ).map((text) => {
        const box = text.getBBox();
        return { right: box.x + box.width, bottom: box.y + box.height };
      });
      return { bottom, labels };
    }),
  );
  for (const row of layout)
    for (const label of row.labels) {
      expect(label.right).toBeLessThanOrEqual(180);
      expect(label.bottom).toBeLessThanOrEqual(row.bottom);
    }
  await preview.screenshot({
    path: testInfo.outputPath("compact-long-titles.png"),
    fullPage: true,
  });
  const pdf = await preview.pdf({
    path: testInfo.outputPath("compact-features.pdf"),
    preferCSSPageSize: true,
    printBackground: true,
  });
  expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  expect(
    Math.max(
      ...[...pdf.toString("latin1").matchAll(/\/Count\s+(\d+)/g)].map((m) =>
        Number(m[1]),
      ),
    ),
  ).toBe(3);
  await preview.close();
});

test("@pdf-file feature-only six-month PDF preserves long labels, blocked work and A4 pagination", async ({
  page,
  request,
}, testInfo) => {
  const state = populatedFixture();
  state.features[0].title = "W".repeat(250);
  state.features[0].blocked = true;
  const { revision } = await (await request.get("/api/state")).json();
  expect(
    (await request.put("/api/state", { data: { revision, state } })).ok(),
  ).toBe(true);
  await page.goto("/");
  await page.getByRole("button", { name: /Timeline range/ }).click();
  await page.getByRole("option", { name: "6 months", exact: true }).click();
  const opened = page.waitForEvent("popup");
  await page
    .getByRole("button", { name: "Export features PDF", exact: true })
    .click();
  const preview = await opened;
  await expect(preview.locator(".print-page")).toHaveCount(3);
  await expect(preview.locator('[data-row-id="long"]')).toHaveCount(3);
  await expect(preview.locator('[data-view="people"]')).toHaveCount(0);
  await expect(preview.locator("body")).toContainText("Blocked");
  const layout = await preview.evaluate(() => ({
    labels: Array.from(
      document.querySelectorAll<SVGTextElement>("[data-row-id] > text"),
    ).map((t) => {
      const box = t.getBBox();
      return box.x + box.width;
    }),
    overflows: Array.from(document.querySelectorAll(".print-page")).map(
      (p) =>
        p.querySelector("svg")!.getBoundingClientRect().bottom -
        p.getBoundingClientRect().bottom,
    ),
  }));
  expect(Math.max(...layout.labels)).toBeLessThanOrEqual(180);
  expect(Math.max(...layout.overflows)).toBeLessThanOrEqual(1);
  const pdf = await preview.pdf({
    path: testInfo.outputPath("six-month-features.pdf"),
    preferCSSPageSize: true,
    printBackground: true,
  });
  expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  const content = pdf.toString("latin1");
  const box = content.match(
    /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/,
  )!;
  expect(Number(box[1])).toBeCloseTo(841.89, 0);
  expect(Number(box[2])).toBeCloseTo(595.28, 0);
  expect(
    Math.max(
      ...[...content.matchAll(/\/Count\s+(\d+)/g)].map((m) => Number(m[1])),
    ),
  ).toBe(3);
  await preview.close();
});

test("@pdf-file six-month export generates actual A4 landscape PDF pages with all work and repeated headings", async ({
  page,
  request,
}, testInfo) => {
  const state = largeFixture();
  state.apps[0].name = "Studio & Partners";
  state.leaves = [
    {
      id: "pdf-leave",
      personId: "person-0",
      start: "2030-01-09",
      end: "2030-01-10",
      hours: null,
      note: "Winter leave",
    },
  ];
  state.holidays = [
    {
      id: "pdf-holiday",
      appId: "a",
      date: "2030-01-14",
      name: "Winter break",
      personIds: ["person-1"],
    },
  ];
  state.features[0].title =
    "A very long feature title with <safe> text and international names — محمد عبدالله";
  const { revision } = await (await request.get("/api/state")).json();
  expect(
    (await request.put("/api/state", { data: { revision, state } })).ok(),
  ).toBe(true);
  await page.goto("/");
  await page.getByRole("button", { name: /Timeline range/ }).click();
  await page.getByRole("option", { name: "6 months", exact: true }).click();
  const opened = page.waitForEvent("popup");
  await page
    .getByRole("button", { name: "Export timeline PDF", exact: true })
    .click();
  const preview = await opened;
  await expect(preview.locator(".print-page").first()).toBeVisible();
  const count = await preview.locator(".print-page").count();
  expect(count).toBeGreaterThan(6);
  expect(await preview.locator('[data-row-id="feature-99"]').count()).toBe(3);
  await expect(preview.locator(".print-page .print-page-header")).toHaveCount(
    count,
  );
  expect(
    await preview.locator("[data-person-id]").count(),
  ).toBeGreaterThanOrEqual(45);
  const pdf = await preview.pdf({
    path: testInfo.outputPath("six-month-timeline.pdf"),
    preferCSSPageSize: true,
    printBackground: true,
  });
  expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  const content = pdf.toString("latin1");
  const box = content.match(
    /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/,
  )!;
  expect(Number(box[1])).toBeCloseTo(841.89, 0);
  expect(Number(box[2])).toBeCloseTo(595.28, 0);
  const counts = [...content.matchAll(/\/Count\s+(\d+)/g)].map((m) =>
    Number(m[1]),
  );
  expect(Math.max(...counts)).toBe(count);
  await preview.close();
});

test("long app, feature and person names remain inside their printed columns and pages", async ({
  page,
  request,
}) => {
  const state = populatedFixture();
  state.apps[0].name = "W".repeat(250);
  state.features[0].title = "W".repeat(250);
  state.people[0].name = "W".repeat(250);
  const { revision } = await (await request.get("/api/state")).json();
  const saved = await request.put("/api/state", { data: { revision, state } });
  expect(saved.ok(), await saved.text()).toBe(true);
  await page.goto("/");
  const opened = page.waitForEvent("popup");
  await page
    .getByRole("button", { name: "Export timeline PDF", exact: true })
    .click();
  const preview = await opened;
  await expect(preview.locator(".print-page").first()).toBeVisible();
  const layout = await preview.evaluate(() => ({
    labels: Array.from(
      document.querySelectorAll<SVGTextElement>("[data-row-id] > text"),
    ).map((t) => {
      const box = t.getBBox();
      return box.x + box.width;
    }),
    pageOverflows: Array.from(document.querySelectorAll(".print-page")).map(
      (p) =>
        p.querySelector("svg")!.getBoundingClientRect().bottom -
        p.getBoundingClientRect().bottom,
    ),
  }));
  expect(Math.max(...layout.labels)).toBeLessThanOrEqual(180);
  expect(Math.max(...layout.pageOverflows)).toBeLessThanOrEqual(1);
  await preview.close();
});
