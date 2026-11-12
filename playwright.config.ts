import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";

process.env.E2E_DATABASE_PATH ??= resolve("data", `e2e-${Date.now()}.sqlite`);
const port = process.env.E2E_PORT ?? "3100";
const origin = `http://127.0.0.1:${port}`;
export default defineConfig({
  testDir: "tests/e2e",
  workers: 1,
  fullyParallel: false,
  timeout: 45000,
  use: {
    baseURL: origin,
    browserName: "chromium",
    headless: true,
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  reporter: [["list"]],
  globalSetup: "./scripts/e2e-setup.ts",
});
