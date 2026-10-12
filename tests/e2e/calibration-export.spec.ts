// tests/e2e/calibration-export.spec.ts — the still-image camera and the sensor controls (M4 section 5): the no-CORS
// image and its 60 s refresh, 404 as offline, the calibration and GeoPose exports, keyboard nudges with persistence,
// a rejected import, and the assisted pair flow. CFHT is mocked by the fixtures' routes; nothing leaves the machine.
import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { Ajv } from "ajv";
import type { CalibrationFileV1 } from "../../src/app/persist";
import { expect, type Guard, test } from "./fixtures";

const NIGHT = new Date("2026-10-11T08:00:00Z"); // 22:00 HST: the Nānā ao hatch is open
const NANAAO = "./?cam=cfht-nanaao";
const NANAAO_NAME = "CFHT Nānā ao all-sky (visible)";
const SCHEMA = JSON.parse(
  readFileSync(
    new URL("../../src/domain/camera/schemas/GeoPose.Basic.YPR.Schema.json", import.meta.url),
    "utf8",
  ),
) as object;

interface CameraEntry {
  id: string;
  defaults: Record<string, unknown>;
}
const NANAAO_DEFAULTS = (
  JSON.parse(
    readFileSync(new URL("../../public/data/cameras.json", import.meta.url), "utf8"),
  ) as CameraEntry[]
).find((c) => c.id === "cfht-nanaao")?.defaults;

/** Drops expected console errors before the shared guard checks them at teardown. Call at the end of the test. */
function allowConsoleErrors(guard: Guard, allowed: readonly RegExp[]): void {
  const rest = guard.consoleErrors.filter((m) => !allowed.some((re) => re.test(m)));
  guard.consoleErrors.splice(0, guard.consoleErrors.length, ...rest);
}

async function open(page: Page, url = NANAAO): Promise<void> {
  await page.clock.install({ time: NIGHT });
  await page.goto(url);
  await page.clock.runFor(1000);
}

async function openPanel(page: Page): Promise<void> {
  const toggle = page.getByRole("button", { name: "Calibration", exact: true });
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  await expect(page.getByRole("region", { name: "Calibration" })).toBeVisible();
}

async function downloadJson(page: Page, button: string): Promise<unknown> {
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: button, exact: true }).click(),
  ]);
  const path = await download.path();
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

const azimuth = (page: Page) => page.getByRole("spinbutton", { name: "Azimuth (°)" });
const nanaaoRadio = (page: Page) => page.getByRole("radio", { name: NANAAO_NAME });

test("no-CORS still image: cache-busted, Live, size notice, and a 60 s refresh", async ({
  page,
}) => {
  const requests: { url: string; headers: Record<string, string> }[] = [];
  await page.route("**/last_vis.png*", async (route) => {
    requests.push({ url: route.request().url(), headers: await route.request().allHeaders() });
    await route.fulfill({
      status: 200,
      path: new URL("../fixtures/gibs/tile.jpg", import.meta.url).pathname,
      contentType: "image/jpeg",
    });
  });
  await open(page);
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0]?.url).toMatch(/last_vis\.png\?t=\d+$/);
  expect(requests[0]?.headers).not.toHaveProperty("origin");
  await expect(nanaaoRadio(page)).toHaveAccessibleDescription(/Live/);
  await expect(
    page.getByText("Image is 256 × 256 px; the calibration assumes 1232 × 1232 px").first(),
  ).toBeVisible();

  await page.clock.fastForward(30_000);
  await page.clock.runFor(100);
  expect(requests).toHaveLength(1);
  await page.clock.fastForward(31_000);
  await page.clock.runFor(100);
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[1]?.url).not.toBe(requests[0]?.url);
});

test("a 404 image means offline, and the camera credit stays", async ({ page, guard }) => {
  await page.route("**/last_vis.png*", (route) => route.fulfill({ status: 404, body: "" }));
  await open(page);
  await expect(nanaaoRadio(page)).toHaveAccessibleDescription(/Offline/);
  await expect(page.getByRole("link", { name: "Nānā ao all-sky image © CFHT" })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("picker-offline.png"), fullPage: true });
  allowConsoleErrors(guard, [
    /^Failed to load resource: the server responded with a status of 404 \(Not Found\)$/,
    /^EncodingError: The source image cannot be decoded\.$/,
  ]);
});

test("Export JSON downloads the active camera's calibration file", async ({ page }) => {
  await open(page);
  await page.keyboard.press("c");
  await expect(page.getByRole("region", { name: "Calibration" })).toBeVisible();
  const file = (await downloadJson(page, "Export JSON")) as CalibrationFileV1;
  expect(file.format).toBe("overhead.calibration");
  expect(file.version).toBe(1);
  expect(file.cameraId).toBe("cfht-nanaao");
  expect(NANAAO_DEFAULTS).toBeDefined();
  const { updatedAtMs: _a, ...expected } = NANAAO_DEFAULTS ?? {};
  const { updatedAtMs: _b, ...actual } = file.calibration;
  expect(actual).toEqual(expected);
});

test("Export GeoPose validates against the vendored schema", async ({ page }) => {
  await open(page);
  await openPanel(page);
  const pose = (await downloadJson(page, "Export GeoPose")) as {
    position: { lat: number; lon: number; h: number };
    angles: { yaw: number; pitch: number; roll: number };
  };
  const validate = new Ajv({ allErrors: true, strict: true }).compile(SCHEMA);
  expect(validate(pose), JSON.stringify(validate.errors)).toBe(true);
  expect(pose.angles.yaw).toBeCloseTo(-137.3, 9);
  expect(pose.angles.pitch).toBeCloseTo(-88.26, 9);
  expect(pose.angles.roll).toBeCloseTo(44.8, 9);
  expect(pose.position.lat).toBeCloseTo(19.8253, 9);
  expect(pose.position.lon).toBeCloseTo(-155.4689, 9);
  expect(pose.position.h).toBeCloseTo(4228.23, 9);
});

test("arrow keys nudge the pointing, the nudge survives a reload, and a locked fisheye turns roll", async ({
  page,
}) => {
  await open(page);
  await openPanel(page);
  const blur = () => page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await blur();
  await page.keyboard.press("ArrowRight");
  await expect(azimuth(page)).toHaveValue("227.35");

  await page.reload();
  await page.clock.runFor(1000);
  await openPanel(page);
  await expect(azimuth(page)).toHaveValue("227.35");

  await page.goto("./?cam=synthetic-maunakea");
  await page.clock.runFor(1000);
  await openPanel(page);
  await blur();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("spinbutton", { name: "Roll (°)" })).toHaveValue("-179.95");
  await expect(azimuth(page)).toBeDisabled();
  await page.keyboard.press("Shift+ArrowDown");
  await expect(page.getByRole("spinbutton", { name: "Altitude (°)" })).toHaveValue("89.50");
  await expect(azimuth(page)).toBeEnabled();
});

test("Import JSON rejects a file for another lens and leaves the calibration unchanged", async ({
  page,
}) => {
  await open(page);
  await openPanel(page);
  const before = await azimuth(page).inputValue();
  const foreign = {
    format: "overhead.calibration",
    version: 1,
    exportedAtMs: NIGHT.getTime(),
    cameraId: "cfht-nanaao",
    lens: "rectilinear",
    imageSize: { widthPx: 1232, heightPx: 1232 },
    frameTimeMs: null,
    calibration: NANAAO_DEFAULTS,
    pairs: [],
  };
  await page.getByLabel("Import JSON").setInputFiles({
    name: "foreign.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(foreign)),
  });
  await expect(
    page.getByRole("region", { name: "Calibration" }).locator('p[aria-live="polite"]'),
  ).toContainText(/lens "rectilinear"/);
  await expect(azimuth(page)).toHaveValue(before);
});

test("pair flow: four image points, each paired with its nearest catalogue object, then Fit", async ({
  page,
}) => {
  await open(page);
  await openPanel(page);
  const viewport = page.getByRole("region", { name: "Sky view" }).locator(".ol-viewport");
  const box = await viewport.boundingBox();
  expect(box).not.toBeNull();
  const { width, height } = box ?? { width: 0, height: 0 };
  const points = [
    [0.4, 0.4],
    [0.6, 0.4],
    [0.4, 0.6],
    [0.6, 0.6],
  ] as const;
  for (const [fx, fy] of points) {
    // A locator click scrolls the map back into view: opening the panel (and each pair) scrolls the page away from it.
    await viewport.click({ position: { x: width * fx, y: height * fy } });
    await page.clock.runFor(400); // past the double-click window: OpenLayers fires singleclick after it
    const nearest = page.getByRole("list", { name: "Nearest catalogue objects" });
    await expect(nearest).toBeVisible();
    await nearest.getByRole("button").first().click();
  }
  await expect(page.getByRole("button", { name: /^Remove / })).toHaveCount(4);
  const fit = page.getByRole("button", { name: "Fit", exact: true });
  await expect(fit).toBeEnabled();
  await fit.click();
  await expect(
    page.getByRole("region", { name: "Calibration" }).locator('p[aria-live="polite"]'),
  ).toHaveText(/^Fit (done|failed)/);
});
