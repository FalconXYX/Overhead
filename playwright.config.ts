import { defineConfig, devices } from "@playwright/test";

const ci = !!process.env.CI;
const perf = process.env.PERF === "1";

export default defineConfig({
  testDir: "tests",
  testMatch: perf ? "perf/**/*.perf.ts" : "e2e/**/*.spec.ts",
  forbidOnly: ci,
  retries: 0,
  // [M9] Perf runs one test at a time: parallel pages would share the GPU and the CPU being measured.
  workers: ci || perf ? 1 : undefined,
  ...(perf ? { timeout: 180_000 } : {}),
  reporter: ci ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://localhost:4173/Overhead/",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      // [M9] Under PERF=1: Chrome for Testing in new headless mode on the GPU (the default headless shell renders
      // WebGL on SwiftShader, gotcha 1), at 1440 × 900 and DPR 2. The e2e project is unchanged.
      use: perf
        ? {
            ...devices["Desktop Chrome"],
            channel: "chromium",
            headless: true,
            viewport: { width: 1440, height: 900 },
            deviceScaleFactor: 2,
            // [M9] Playwright's own trace (DOM snapshots and a screencast) would run inside the measured window.
            trace: "off",
          }
        : { ...devices["Desktop Chrome"], headless: true },
    },
  ],
  webServer: {
    // [M9] PERF_OUTDIR=dist-dev serves the development build (commits.perf.ts). A reused server keeps serving what it
    // was started with, so stop any running `npm run preview` first.
    command: `npx vite preview --port 4173 --strictPort --outDir ${process.env.PERF_OUTDIR ?? "dist"}`,
    url: "http://localhost:4173/Overhead/",
    reuseExistingServer: !ci,
    timeout: 30_000,
  },
});
