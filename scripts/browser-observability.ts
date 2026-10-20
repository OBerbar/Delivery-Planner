import type { Page } from "@playwright/test";

export function observeBrowser(page: Page) {
  const issues: string[] = [];
  page.on("pageerror", (error) => issues.push(`Page error: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error")
      issues.push(`Console error: ${message.text()}`);
  });
  page.on("requestfailed", (request) => {
    issues.push(
      `Failed request: ${request.method()} ${request.url()} (${request.failure()?.errorText})`,
    );
  });
  page.on("response", (response) => {
    if (response.status() >= 400)
      issues.push(
        `HTTP ${response.status()}: ${response.request().method()} ${response.url()}`,
      );
  });
  return issues;
}
