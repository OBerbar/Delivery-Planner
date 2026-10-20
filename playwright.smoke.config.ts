import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests",
  testMatch: "**/production.smoke.ts",
  workers: 1,
  retries: 0,
  outputDir: "test-results/production-smoke",
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:4314",
    browserName: "chromium",
    channel: "chrome",
    locale: "en-US",
    timezoneId: "UTC",
    reducedMotion: "reduce",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npm start",
    url: "http://127.0.0.1:4314",
    reuseExistingServer: false,
    timeout: 60000,
    env: {
      API_PORT: "4314",
      PLANNER_DATA_DIR: "test-results/production-database",
    },
  },
});
