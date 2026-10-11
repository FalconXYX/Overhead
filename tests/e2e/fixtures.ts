// tests/e2e/fixtures.ts — every spec imports `test` and `expect` from here.
import { test as base, expect } from "@playwright/test";

export const APP_ORIGIN = "http://localhost:4173";

export interface Guard {
  consoleErrors: string[];
  pageErrors: string[];
  blockedRequests: string[];
}

export const test = base.extend<{ guard: Guard }>({
  guard: [
    async ({ context, page }, use) => {
      const guard: Guard = { consoleErrors: [], pageErrors: [], blockedRequests: [] };
      // Register the catch-all FIRST: Playwright tries matching routes in reverse registration
      // order, so mocks added later (M1+) run before it.
      await context.route("**/*", (route) => {
        const url = route.request().url();
        if (new URL(url).origin === APP_ORIGIN) return route.fallback();
        guard.blockedRequests.push(url);
        return route.abort("blockedbyclient");
      });
      page.on("console", (message) => {
        if (message.type() === "error") guard.consoleErrors.push(message.text());
      });
      page.on("pageerror", (error) => guard.pageErrors.push(error.message));
      await use(guard);
      expect(guard.blockedRequests, "requests to third parties").toEqual([]);
      expect(guard.pageErrors, "uncaught exceptions").toEqual([]);
      expect(guard.consoleErrors, "console errors").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
