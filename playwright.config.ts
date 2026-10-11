import { defineConfig, devices } from "@playwright/test";

const ci = !!process.env.CI;
const perf = process.env.PERF === "1";

export default defineConfig({
  testDir: "tests",
  testMatch: perf ? "perf/**/*.perf.ts" : "e2e/**/*.spec.ts",
  forbidOnly: ci,
  retries: 0,
  workers: ci ? 1 : undefined,
  reporter: ci ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://localhost:4173/overhead/",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], headless: true },
    },
  ],
  webServer: {
    command: "npx vite preview --port 4173 --strictPort",
    url: "http://localhost:4173/overhead/",
    reuseExistingServer: !ci,
    timeout: 30_000,
  },
});
