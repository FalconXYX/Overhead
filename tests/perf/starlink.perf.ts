// tests/perf/starlink.perf.ts — the main-thread frame budget with Starlink loaded at 60× (M9 steps 1 and 6; README
// section 9). Run by hand on a native arm64 laptop, never in CI: `npm run build && npm run perf -- starlink`.
// Gates: CPU 1×: ≥ 59 fps, overhead:frame p95 ≤ 6 ms, overhead:propagate p95 ≤ 10 ms; CPU 4×: ≥ 55 fps, p95 ≤ 16 ms.
// Writes test-results/perf/starlink-<n>x.json and trace-<n>x.json (gzip -9 the traces for the pull request).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "../e2e/fixtures";

declare global {
  interface Window {
    __perf?: { frame: number[]; propagate: number[]; since: number };
  }
}

const OUT_DIR = "test-results/perf";
const WINDOW_MS = 10_000;

const p95 = (xs: readonly number[]): number =>
  [...xs].sort((a, b) => a - b)[Math.floor(0.95 * xs.length)] ?? Number.NaN;
const p50 = (xs: readonly number[]): number =>
  [...xs].sort((a, b) => a - b)[Math.floor(0.5 * xs.length)] ?? Number.NaN;

for (const throttle of [1, 4] as const) {
  test(`Starlink loaded, 60x, CPU ${throttle}x`, async ({ browser, context, page }) => {
    await page.addInitScript(() => {
      const perf = { frame: [] as number[], propagate: [] as number[], since: 0 };
      window.__perf = perf;
      new PerformanceObserver((list) => {
        for (const e of list.getEntriesByName("overhead:frame")) perf.frame.push(e.duration);
        for (const e of list.getEntriesByName("overhead:propagate"))
          perf.propagate.push(e.duration);
      }).observe({ type: "measure" });
    });
    await page.goto("./?cam=synthetic-maunakea&t=2026-10-11T15:09:50Z");
    const gpu = await page.evaluate(() => {
      const gl = document.createElement("canvas").getContext("webgl2");
      const ext = gl?.getExtension("WEBGL_debug_renderer_info");
      return gl && ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : "none";
    });
    expect(gpu, "perf needs a GPU-backed WebGL context").not.toMatch(/SwiftShader|none/);

    // App-specific setup (step 1.3): Starlink on, panel closed, 60×, playing.
    await page.keyboard.press("l");
    const starlink = page.getByRole("checkbox", { name: "Starlink (about 11,100; loads 4.7 MB)" });
    await starlink.check();
    // M3's group status: "11,102 objects, elements fetched 2026-10-11 03:50 UTC" with the shared GP route.
    await expect(starlink).toHaveAccessibleDescription(/objects, elements fetched/, {
      timeout: 60_000,
    });
    // keyboard.ts ignores keys whose target is an input: l on the focused checkbox would do nothing.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press("l");
    await page.keyboard.press("]");
    await page.keyboard.press("]");
    const timeline = page.getByRole("region", { name: "Timeline" });
    await expect(timeline.getByRole("radio", { name: "60×" })).toBeChecked();
    await page.keyboard.press(" ");
    await expect(timeline.getByRole("button", { name: "Pause" })).toBeVisible();

    // [M9] A measurement is only worth something on the real layout: both maps with a real size, inside the
    // 1440 × 900 viewport (a map wider than the window means the page layout is broken).
    const maps = await page.evaluate(() =>
      ["sky", "ground"].map((id) => {
        const r = document.querySelector(`[data-map="${id}"]`)?.getBoundingClientRect();
        return { id, width: Math.round(r?.width ?? 0), height: Math.round(r?.height ?? 0) };
      }),
    );
    for (const m of maps) {
      const size = `the ${m.id} map is ${m.width} × ${m.height} CSS px`;
      expect(m.width * m.height, size).toBeGreaterThan(300 * 200);
      expect(m.width, size).toBeLessThanOrEqual(1440);
      expect(m.height, size).toBeLessThanOrEqual(900);
    }

    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: throttle }); // main thread only; workers run at full speed
    await page.evaluate(() => {
      window.__perf?.frame.splice(0); // empty in place: the observer holds this object (gotcha 11)
      window.__perf?.propagate.splice(0);
      if (window.__perf) window.__perf.since = performance.now();
    });
    mkdirSync(OUT_DIR, { recursive: true });
    await browser.startTracing(page, {
      path: `${OUT_DIR}/trace-${throttle}x.json`,
      screenshots: false, // 3.4 MB gzipped without, 24 MB with: GitHub's limit is 25 MB (gotcha 12)
    });
    await page.waitForTimeout(WINDOW_MS);
    // Read before stopTracing(): writing the trace stalls the page (gotcha 11).
    const perf = await page.evaluate(() => {
      const p = window.__perf ?? { frame: [], propagate: [], since: 0 };
      return {
        frame: [...p.frame],
        propagate: [...p.propagate],
        seconds: (performance.now() - p.since) / 1000,
      };
    });
    await browser.stopTracing();
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
    // [M9] Frames the compositor drew (step 6.4: close to one per overhead:frame). Far fewer means the page was not
    // being presented (a display asleep, a locked screen), and the frame times do not describe a visible page.
    const drawFrames =
      readFileSync(`${OUT_DIR}/trace-${throttle}x.json`, "utf8").match(/"name":"DrawFrame"/g)
        ?.length ?? 0;
    const result = {
      throttle,
      fps: perf.frame.length / perf.seconds,
      frameP50Ms: p50(perf.frame),
      frameP95Ms: p95(perf.frame),
      frameMaxMs: Math.max(...perf.frame),
      frames: perf.frame.length,
      framesOver20Ms: perf.frame.filter((d) => d > 20).length,
      drawFrames,
      maps,
      propagateP50Ms: p50(perf.propagate),
      propagateP95Ms: p95(perf.propagate),
      propagateSamples: perf.propagate.length,
      seconds: perf.seconds,
      // The line the pull request names: machine, browser and renderer.
      browser: `Chromium ${browser.version()}, launched from Node ${process.version} ${process.platform} ${process.arch}`,
      gpu,
    };
    writeFileSync(`${OUT_DIR}/starlink-${throttle}x.json`, JSON.stringify(result, null, 2));
    console.log(`starlink.perf ${throttle}x: ${JSON.stringify(result)}`);
    expect(
      drawFrames,
      "DrawFrame events in the trace, against overhead:frame",
    ).toBeGreaterThanOrEqual(0.9 * result.frames);
    expect(result.fps).toBeGreaterThanOrEqual(throttle === 1 ? 59 : 55);
    expect(result.frameP95Ms).toBeLessThanOrEqual(throttle === 1 ? 6 : 16);
    if (throttle === 1) expect(result.propagateP95Ms).toBeLessThanOrEqual(10);
  });
}
