import type { Page } from "@playwright/test";

export async function openFeatureSection(
  page: Page,
  section: "Details & completion" | "Scheduling options" | "Optional tasks",
) {
  const summary = page
    .getByRole("dialog")
    .locator("summary", { hasText: section });
  if (
    await summary.evaluate(
      (element) => !(element.parentElement as HTMLDetailsElement).open,
    )
  ) {
    await summary.click();
  }
}

export async function confirmSchedulingReview(page: Page) {
  const review = page.getByRole("dialog", {
    name: "Review scheduling changes",
    exact: true,
  });
  if (await review.isVisible()) {
    await review
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
  }
}
