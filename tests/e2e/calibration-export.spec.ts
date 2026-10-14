// tests/e2e/calibration-export.spec.ts — the sensor controls (M4 section 5), [Redesign] in "Camera alignment
// (advanced)" on the paused recorded clip (reduced motion): the calibration and GeoPose exports, keyboard nudges with
// persistence, a rejected import, and the assisted pair flow. The still image (CFHT Nānā ao) is gone from the site.
import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { Ajv } from "ajv";
import type { CalibrationFileV1 } from "../../src/app/persist";
import { CLIP_ID, clipReady, expect, focusBody, openAlignment, test } from "./fixtures";

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
/** The clip camera runs as its source camera, the Subaru StarCam: its defaults, with no stream delay. */
const SUBARU_DEFAULTS = (
  JSON.parse(
    readFileSync(new URL("../../public/data/cameras.json", import.meta.url), "utf8"),
  ) as CameraEntry[]
).find((c) => c.id === "subaru-starcam")?.defaults;

test.use({ reducedMotion: "reduce" });

async function open(page: Page): Promise<void> {
  await page.goto("./");
  await clipReady(page, "paused");
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
const altitude = (page: Page) => page.getByRole("spinbutton", { name: "Altitude (°)" });
const announcement = (page: Page) =>
  page
    .getByRole("region", { name: "Camera alignment (advanced)" })
    .locator('p[aria-live="polite"]');

test("Export JSON downloads the clip camera's calibration file", async ({ page }) => {
  await open(page);
  await openAlignment(page);
  const file = (await downloadJson(page, "Export JSON")) as CalibrationFileV1;
  expect(file.format).toBe("overhead.calibration");
  expect(file.version).toBe(1);
  expect(file.cameraId).toBe(CLIP_ID);
  expect(SUBARU_DEFAULTS).toBeDefined();
  const { updatedAtMs: _a, ...defaults } = SUBARU_DEFAULTS ?? {};
  const expected = { ...defaults, streamDelayMs: 0 };
  const { updatedAtMs: _b, ...actual } = file.calibration;
  // importCalibration normalises the roll through wrap180: compare every field to 1e-9.
  expect(Object.keys(actual).sort()).toEqual(Object.keys(expected).sort());
  for (const [key, value] of Object.entries(expected)) {
    const got = (actual as Record<string, unknown>)[key];
    if (typeof value === "number") expect(got, key).toBeCloseTo(value, 9);
    else expect(got, key).toEqual(value);
  }
});

test("Export GeoPose validates against the vendored schema", async ({ page }) => {
  await open(page);
  await openAlignment(page);
  const pose = (await downloadJson(page, "Export GeoPose")) as {
    position: { lat: number; lon: number; h: number };
    angles: { yaw: number; pitch: number; roll: number };
  };
  const validate = new Ajv({ allErrors: true, strict: true }).compile(SCHEMA);
  expect(validate(pose), JSON.stringify(validate.errors)).toBe(true);
  // yaw = 90° − az, pitch = −alt, roll = roll; h = heightM + geoidSepM.
  expect(pose.angles.yaw).toBeCloseTo(90 - 81.2322, 9);
  expect(pose.angles.pitch).toBeCloseTo(-19.6185, 9);
  expect(pose.angles.roll).toBeCloseTo(0.7698, 9);
  expect(pose.position.lat).toBeCloseTo(19.82552, 9);
  expect(pose.position.lon).toBeCloseTo(-155.47587, 9);
  expect(pose.position.h).toBeCloseTo(4148 + 24.32, 9);
});

test("arrow keys nudge the pointing, and the nudge survives a reload", async ({ page }) => {
  await open(page);
  await openAlignment(page);
  await focusBody(page);
  await page.keyboard.press("ArrowRight");
  await expect(azimuth(page)).toHaveValue("81.28");
  await page.keyboard.press("Shift+ArrowDown");
  await expect(altitude(page)).toHaveValue("19.12");

  await page.reload();
  await clipReady(page, "paused");
  await openAlignment(page);
  await expect(azimuth(page)).toHaveValue("81.28");
  await expect(altitude(page)).toHaveValue("19.12");
  // Reset brings the defaults back.
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await page.getByRole("button", { name: "Confirm reset" }).click();
  await expect(azimuth(page)).toHaveValue("81.23");
});

test("Import JSON rejects a file for another lens and leaves the calibration unchanged", async ({
  page,
}) => {
  await open(page);
  await openAlignment(page);
  const before = await azimuth(page).inputValue();
  const foreign = {
    format: "overhead.calibration",
    version: 1,
    exportedAtMs: Date.parse("2026-10-11T08:00:00Z"),
    cameraId: CLIP_ID,
    lens: "fisheye-equidistant",
    imageSize: { widthPx: 3840, heightPx: 2160 },
    frameTimeMs: null,
    calibration: { ...SUBARU_DEFAULTS, streamDelayMs: 0 },
    pairs: [],
  };
  await page.getByLabel("Import JSON").setInputFiles({
    name: "foreign.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(foreign)),
  });
  await expect(announcement(page)).toContainText(/lens "fisheye-equidistant"/);
  await expect(azimuth(page)).toHaveValue(before);
});

test("pair flow: four image points, each paired with its nearest catalogue object, then Fit", async ({
  page,
}) => {
  await open(page);
  await openAlignment(page);
  const viewport = page.getByRole("region", { name: "Sky view" }).locator(".ol-viewport");
  const box = await viewport.boundingBox();
  expect(box).not.toBeNull();
  const { width, height } = box ?? { width: 0, height: 0 };
  const points = [
    [0.35, 0.35],
    [0.65, 0.35],
    [0.35, 0.65],
    [0.65, 0.65],
  ] as const;
  for (const [fx, fy] of points) {
    // A locator click scrolls the map back into view if a pair scrolled the page away from it. OpenLayers fires
    // singleclick once its double-click window has passed: the list appearing is that click, so the next map click
    // can never pair with this one into a double click.
    await viewport.click({ position: { x: width * fx, y: height * fy } });
    const nearest = page.getByRole("list", { name: "Nearest catalogue objects" });
    await expect(nearest).toBeVisible();
    await nearest.getByRole("button").first().click();
  }
  await expect(page.getByRole("button", { name: /^Remove / })).toHaveCount(4);
  const fit = page.getByRole("button", { name: "Fit", exact: true });
  await expect(fit).toBeEnabled();
  await fit.click();
  await expect(announcement(page)).toHaveText(/^Fit (done|failed)/);
});
