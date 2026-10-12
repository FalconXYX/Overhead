// Calibration panel star pairs and fit (M4 step 14, items 1, 4 and 5): catalogue targets at the frame time, the
// 3 nearest, the click rule, the panel's fit run with holdouts, applyFit alignment and "Compare lens models".
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  astroTimeAt,
  BODY_STRIDE,
  computeBodies,
  makeObserver,
  type StarRow,
} from "../../src/domain/astro";
import {
  type AcceptanceReport,
  type Calibration,
  createCameraModel,
  distortionValid,
  projectAzAltDeg,
} from "../../src/domain/camera";
import { wrap180 } from "../../src/domain/geo";
import { initialState } from "../../src/state/initialState";
import { createAppStore } from "../../src/state/store";
import type { PlanetId, StarId, StarPair, StillImageCamera } from "../../src/state/types";
import {
  acceptanceChecklist,
  acceptanceMinAltDeg,
  CALIBRATION_STAR_MAG_LIMIT,
  type CatalogTarget,
  catalogTargetsAt,
  compareLensModels,
  countFitPairs,
  FISHEYE_LENSES,
  fitResultText,
  nearestTargets,
  PAIR_CLICK_RADIUS_SCREEN_PX,
  type PanelFitInput,
  type PanelFitSuccess,
  type ProjectedTarget,
  pairClick,
  pairOrder,
  pendingPointText,
  projectTargets,
  runPanelFit,
  targetFallbackName,
  targetsById,
} from "../../src/ui/calibrationPairs";
import { mulberry32 } from "../helpers/random";
import { committedCameras } from "../helpers/store";

const SEED = 20261011;
const T = Date.parse("2026-10-11T08:00:00Z"); // 22:00 HST: Saturn at about 60° (M4 step 18)
const ROWS = JSON.parse(
  readFileSync(new URL("../../public/data/stars.json", import.meta.url), "utf8"),
) as StarRow[];
const cameras = committedCameras();
const nanaao = cameras["cfht-nanaao"] as StillImageCamera;
const { widthPx: W, heightPx: H } = nanaao.imageSize;

const near = (actual: number, expected: number, tol: number): void => {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tol);
};

const pair = (
  imagePx: readonly [number, number],
  targetId: StarId | PlanetId,
  role: StarPair["role"] = "fit",
  residualPx: number | null = null,
): StarPair => ({ imagePx, targetId, role, residualPx, rejected: false });

const targets = catalogTargetsAt(ROWS, nanaao.site, T);
const byId = targetsById(targets);

/**
 * Clicks made through a truth calibration with ±0.5 px of seeded noise per axis: `fit` named stars spread in
 * azimuth at alt ≥ 25°, then 3 named holdout stars and Saturn as the holdout planet.
 */
function syntheticPairs(truth: Calibration, fitCount: number): StarPair[] {
  const model = createCameraModel({
    lens: nanaao.lens,
    calibration: truth,
    widthPx: W,
    heightPx: H,
  });
  const rand = mulberry32(SEED);
  const uv = new Float64Array(2);
  const click = (t: CatalogTarget): [number, number] => {
    if (!projectAzAltDeg(model, t.azDeg, t.altDeg, uv, 0))
      throw new Error(`${t.name} not in frame`);
    return [(uv[0] ?? 0) + rand() - 0.5, (uv[1] ?? 0) + rand() - 0.5];
  };
  const high = targets
    .filter((t) => t.kind === "star" && t.named && t.altDeg >= 25)
    .sort((a, b) => a.azDeg - b.azDeg);
  const step = Math.floor(high.length / (fitCount + 3));
  const chosen = Array.from({ length: fitCount + 3 }, (_, i) => high[i * step] as CatalogTarget);
  const saturn = byId.get("planet:Saturn") as CatalogTarget;
  return [
    ...chosen.slice(0, fitCount).map((t) => pair(click(t), t.id, "fit")),
    ...chosen.slice(fitCount).map((t) => pair(click(t), t.id, "holdout")),
    pair(click(saturn), saturn.id, "holdout"),
  ];
}

const fitInput = (pairs: readonly StarPair[], start: Calibration): PanelFitInput => ({
  lens: nanaao.lens,
  widthPx: W,
  heightPx: H,
  start,
  pairs,
  targets: byId,
  fitK1: true,
  fitTilt: true,
});

const truth = nanaao.defaults;
const start: Calibration = {
  ...truth,
  rollDeg: wrap180(truth.rollDeg + 3),
  focalPx: truth.focalPx * 1.02,
};

describe("catalogTargetsAt", () => {
  it("lists every star with V ≤ 4 (brightest first) and the six planets, never the Sun or Moon", () => {
    const bright = ROWS.filter((r) => r[2] <= CALIBRATION_STAR_MAG_LIMIT).length;
    expect(targets).toHaveLength(bright + 6);
    expect(targets[0]).toMatchObject({
      id: "star:2491",
      name: "Sirius",
      kind: "star",
      named: true,
    });
    expect(targets.slice(-6).map((t) => t.id)).toEqual([
      "planet:Mercury",
      "planet:Venus",
      "planet:Mars",
      "planet:Jupiter",
      "planet:Saturn",
      "planet:Uranus",
    ]);
    expect(targets.some((t) => (t.id as string) === "sun" || (t.id as string) === "moon")).toBe(
      false,
    );
  });

  it("names unnamed stars 'HR n' and marks them unnamed", () => {
    const unnamed = targets.find((t) => t.kind === "star" && !t.named);
    expect(unnamed?.name).toMatch(/^HR \d+$/);
    expect(unnamed?.name).toBe(targetFallbackName(unnamed?.id ?? "star:0"));
    expect(targetFallbackName("planet:Saturn")).toBe("Saturn");
    expect(targetFallbackName("star:7001")).toBe("HR 7001");
  });

  it("puts Polaris at az 0.592°, alt 20.151° at 2026-10-10T08:00Z (M2's fixture, ± 0.01°)", () => {
    const polaris = targetsById(
      catalogTargetsAt(ROWS, nanaao.site, Date.parse("2026-10-10T08:00:00Z")),
    ).get("star:424");
    near(wrap180(polaris?.azDeg ?? Number.NaN), 0.592, 0.01);
    near(polaris?.altDeg ?? Number.NaN, 20.151, 0.01);
  });

  it("gives the planets computeBodies' apparent az/alt", () => {
    const bodies = new Float64Array(8 * BODY_STRIDE);
    computeBodies(astroTimeAt(T), makeObserver(nanaao.site), bodies);
    const saturn = byId.get("planet:Saturn");
    expect(saturn?.azDeg).toBe(bodies[6 * BODY_STRIDE]);
    expect(saturn?.altDeg).toBe(bodies[6 * BODY_STRIDE + 1]);
    expect(saturn?.altDeg ?? 0).toBeGreaterThan(55); // about 60° at 22:00 HST in mid-October
  });

  it("works on planets alone before the catalogue loads", () => {
    expect(catalogTargetsAt([], nanaao.site, T).map((t) => t.kind)).toEqual(
      Array(6).fill("planet"),
    );
  });
});

describe("nearest targets and the click rule", () => {
  const t = (id: StarId, name: string): CatalogTarget => ({
    id,
    name,
    kind: "star",
    named: true,
    azDeg: 0,
    altDeg: 45,
  });
  const projected: ProjectedTarget[] = [
    { target: t("star:1", "A"), uPx: 100, vPx: 100 },
    { target: t("star:2", "B"), uPx: 110, vPx: 100 },
    { target: t("star:3", "C"), uPx: 300, vPx: 300 },
    { target: t("star:4", "D"), uPx: 104, vPx: 103 },
  ];

  it("lists the 3 nearest in image pixels, nearest first", () => {
    const n = nearestTargets(projected, 101, 100);
    expect(n.map((x) => x.target.name)).toEqual(["A", "D", "B"]);
    near(n[0]?.distancePx ?? Number.NaN, 1, 1e-12);
    near(n[1]?.distancePx ?? Number.NaN, Math.hypot(3, 3), 1e-12);
  });

  it("ignores clicks outside the frame", () => {
    expect(pairClick(-0.1, 5, W, H, null, projected, 1)).toEqual({ kind: "ignore" });
    expect(pairClick(5, H + 0.1, W, H, [1, 1], projected, 1)).toEqual({ kind: "ignore" });
  });

  it("first click sets the point, even on a marker", () => {
    expect(pairClick(100, 100, W, H, null, projected, 1)).toEqual({
      kind: "add",
      uPx: 100,
      vPx: 100,
    });
  });

  it("with a point pending, a click within 6 screen px of a marker completes the pair", () => {
    expect(PAIR_CLICK_RADIUS_SCREEN_PX).toBe(6);
    expect(pairClick(98, 100, W, H, [50, 50], projected, 1)).toEqual({
      kind: "complete",
      targetId: "star:1",
    });
    // The nearest marker, D, is 6.4 image px away at 1 image px per screen px: a new pending point.
    expect(pairClick(100, 108, W, H, [50, 50], projected, 1)).toEqual({
      kind: "add",
      uPx: 100,
      vPx: 108,
    });
    // Zoomed out to 2 image px per screen px, D is 3.2 screen px away; the nearest marker wins.
    expect(pairClick(100, 108, W, H, [50, 50], projected, 2)).toEqual({
      kind: "complete",
      targetId: "star:4",
    });
  });

  it("projectTargets keeps only what projects", () => {
    const model = createCameraModel({
      lens: nanaao.lens,
      calibration: truth,
      widthPx: W,
      heightPx: H,
    });
    const out = projectTargets(model, targets);
    expect(out.length).toBeGreaterThan(100);
    expect(out.length).toBeLessThan(targets.length); // stars below the horizon are culled
    expect(out.every((p) => p.uPx >= 0 && p.uPx <= W && Number.isFinite(p.vPx))).toBe(true);
  });

  it("announces a pending point to 0.1 px", () => {
    expect(pendingPointText([612.4, 433])).toBe("Point set at u 612.4, v 433.0. Choose its star.");
  });
});

describe("pair table order", () => {
  it("keeps insertion order, or sorts by the last fit's pixel residual, largest first", () => {
    const pairs = [
      pair([0, 0], "star:1", "fit", 1),
      pair([0, 0], "star:2", "fit", null),
      pair([0, 0], "star:3", "holdout", 5),
      pair([0, 0], "star:4", "fit", Number.NaN),
      pair([0, 0], "star:5", "fit", 3),
    ];
    expect(pairOrder(pairs, false)).toEqual([0, 1, 2, 3, 4]);
    expect(pairOrder(pairs, true)).toEqual([2, 4, 0, 1, 3]);
    expect(countFitPairs(pairs)).toBe(4);
  });
});

describe("runPanelFit", () => {
  const pairs = syntheticPairs(truth, 14);

  it("recovers Nānā ao from roll + 3° and f × 1.02 and passes the acceptance", () => {
    const outcome = runPanelFit(fitInput(pairs, start));
    expect(outcome.ok).toBe(true);
    const ok = outcome as PanelFitSuccess;
    expect(ok.residualPx).toHaveLength(pairs.length);
    expect(ok.residualDeg).toHaveLength(pairs.length);
    expect(ok.rejected).toHaveLength(pairs.length);
    expect(ok.fit.rmsDeg).toBeLessThan(0.1);
    expect(ok.fit.maxFitDeg).toBeLessThan(0.2);
    expect(ok.fit.maxHoldoutDeg ?? Number.NaN).toBeLessThan(0.2);
    expect(ok.report).toMatchObject({
      namedFitStars: 14,
      holdoutStars: 3,
      holdoutPlanets: 1,
      pass: true,
    });
    expect(ok.heldK1).toBe(false);
    expect(ok.heldTilt).toBe(false);
    // Holdouts are measured, never rejected; every residual is finite here.
    pairs.forEach((p, i) => {
      if (p.role === "holdout") expect(ok.rejected[i]).toBe(false);
      expect(Number.isFinite(ok.residualPx[i])).toBe(true);
    });
    const c = ok.calibration;
    const model = createCameraModel({ lens: nanaao.lens, calibration: c, widthPx: W, heightPx: H });
    expect(distortionValid(c.k1, c.k2, model.rMaxUnit)).toBe(true);
    near(c.focalPx, truth.focalPx, 2);
    expect(c.rmsDeg).toBe(ok.fit.rmsDeg);
    expect(fitResultText(outcome)).toMatch(
      /^Fit done: RMS \d+\.\d\d px, 0\.\d{3}°\. Acceptance: pass\.$/,
    );
  });

  it("needs 4 fit pairs; holdouts do not count", () => {
    const three = [...pairs.slice(0, 3), ...pairs.slice(14)];
    const outcome = runPanelFit(fitInput(three, start));
    expect(outcome).toEqual({
      ok: false,
      reason: "too-few-pairs",
      message: "Fit failed: fewer than 4 fit pairs.",
    });
    expect(fitResultText(outcome)).toBe("Fit failed: fewer than 4 fit pairs.");
  });

  it("names a target behind the camera with the current pointing", () => {
    const subaru = cameras["subaru-starcam"];
    if (subaru === undefined) throw new Error("subaru-starcam missing");
    const mk = (id: StarId, name: string, azDeg: number, altDeg: number): CatalogTarget => ({
      id,
      name,
      kind: "star",
      named: true,
      azDeg,
      altDeg,
    });
    const ts = [
      mk("star:1", "A", 80, 20),
      mk("star:2", "B", 85, 25),
      mk("star:3", "C", 75, 15),
      mk("star:4", "Behind", 261.2, 10),
    ];
    const outcome = runPanelFit({
      lens: subaru.lens,
      widthPx: 3840,
      heightPx: 2160,
      start: subaru.defaults,
      pairs: ts.map((t, i) => pair([1000 + 100 * i, 1000], t.id)),
      targets: targetsById(ts),
      fitK1: true,
      fitTilt: true,
    });
    expect(outcome).toEqual({
      ok: false,
      reason: "behind-camera",
      message:
        "Fit failed: Behind is behind the camera with the current pointing. Align roughly first.",
    });
  });

  it("holds k1 below 8 fit pairs, and a locked camera's tilt, and says so", () => {
    const five = [...pairs.slice(0, 5), ...pairs.slice(14)];
    const tilted = runPanelFit(fitInput(five, start));
    expect(tilted.ok && tilted.heldK1).toBe(true);
    expect(tilted.ok && tilted.heldTilt).toBe(false); // a tilted start always fits the full rotation
    expect(tilted.ok && tilted.calibration.k1).toBe(start.k1);
    expect(fitResultText(tilted)).toContain("Fewer than 8 fit pairs: k1 held.");

    const locked: Calibration = {
      ...start,
      azDeg: 0,
      altDeg: 90,
      rollDeg: wrap180(start.rollDeg - start.azDeg),
    };
    const lockedFive = runPanelFit(fitInput(five, locked));
    expect(lockedFive.ok).toBe(true);
    expect(lockedFive.ok && lockedFive.heldTilt).toBe(true);
    expect(lockedFive.ok && lockedFive.calibration.altDeg).toBe(90);
    expect(fitResultText(lockedFive)).toContain("Fewer than 8 fit pairs: k1 and the tilt held.");

    const eight = [...pairs.slice(0, 8), ...pairs.slice(14)];
    const free = runPanelFit(fitInput(eight, locked));
    expect(free.ok && !free.heldK1 && !free.heldTilt).toBe(true);
    expect(free.ok && free.calibration.altDeg).toBeLessThan(90); // the tilt was fitted
  });

  it("aligns applyFit's residuals and flags with calibrationUi.pairs in the store", () => {
    const store = createAppStore(initialState(T, "cfht-nanaao"));
    const { actions } = store.getState();
    actions.setRegistry({
      "synthetic-maunakea": cameras["synthetic-maunakea"] as NonNullable<
        (typeof cameras)["synthetic-maunakea"]
      >,
      "cfht-nanaao": nanaao,
    });
    actions.setFrameTimeMs(T);
    actions.importCalibration("cfht-nanaao", start);
    pairs.forEach((p, i) => {
      actions.addImagePoint(p.imagePx[0], p.imagePx[1]);
      actions.completePair(p.targetId);
      if (p.role === "holdout") actions.setPairRole(i, "holdout");
    });
    const s = store.getState();
    const stored = s.camera.calibration["cfht-nanaao"] as Calibration;
    const outcome = runPanelFit(fitInput(s.calibrationUi.pairs, stored));
    if (!outcome.ok) throw new Error(outcome.message);
    actions.applyFit(outcome.calibration, outcome.residualPx, outcome.rejected, outcome.fit);
    const after = store.getState();
    expect(after.calibrationUi.fit).toEqual(outcome.fit);
    expect(after.calibrationUi.pairs.map((p) => p.residualPx)).toEqual(outcome.residualPx);
    expect(after.calibrationUi.pairs.map((p) => p.rejected)).toEqual(outcome.rejected);
    const c = after.camera.calibration["cfht-nanaao"];
    expect(c?.focalPx).toBe(outcome.calibration.focalPx);
    expect(c?.rmsDeg).toBe(outcome.fit.rmsDeg);
  });
});

describe("acceptance checklist", () => {
  const report: AcceptanceReport = {
    namedFitStars: 12,
    rmsDeg: 0.041,
    maxFitDeg: 0.12,
    holdoutStars: 2,
    holdoutPlanets: 1,
    maxHoldoutDeg: 0.51,
    pass: false,
  };

  it("one line per threshold, with its count or value and the threshold", () => {
    expect(acceptanceMinAltDeg("fisheye-equidistant")).toBe(20);
    expect(acceptanceMinAltDeg("rectilinear")).toBe(10);
    expect(acceptanceChecklist("fisheye-equidistant", report)).toEqual([
      { text: "Named fit stars at altitude ≥ 20°: 12 (at least 10)", pass: true },
      { text: "Fit RMS: 0.041° (at most 0.25°)", pass: true },
      { text: "Largest fit error: 0.120° (at most 0.5°)", pass: true },
      { text: "Holdout stars at altitude ≥ 20°: 2 (at least 3)", pass: false },
      { text: "Holdout planets at altitude ≥ 20°: 1 (at least 1)", pass: true },
      { text: "Largest holdout error: 0.510° (at most 0.5°)", pass: false },
    ]);
  });

  it("a missing holdout or a NaN fails its line", () => {
    const lines = acceptanceChecklist("rectilinear", {
      ...report,
      rmsDeg: Number.NaN,
      maxHoldoutDeg: null,
    });
    expect(lines[0]?.text).toBe("Named fit stars at altitude ≥ 10°: 12 (at least 10)");
    expect(lines[1]).toEqual({ text: "Fit RMS: none (at most 0.25°)", pass: false });
    expect(lines[5]).toEqual({ text: "Largest holdout error: none (at most 0.5°)", pass: false });
  });
});

describe("compareLensModels", () => {
  it("fits every fisheye lens from the current calibration and leaves it alone", () => {
    const pairs = syntheticPairs(truth, 14);
    const input = fitInput(pairs, start);
    const before = JSON.stringify(input.start);
    const rows = compareLensModels(input);
    expect(rows.map((r) => r.lens)).toEqual(FISHEYE_LENSES);
    expect(JSON.stringify(input.start)).toBe(before);
    const equidistant = rows[0]?.outcome;
    expect(equidistant?.ok).toBe(true);
    if (!equidistant?.ok) return;
    expect(equidistant.fit.rmsDeg).toBeLessThan(0.1);
    // Orthographic cannot follow an equidistant all-sky lens (0.69–0.75° on the archived frames).
    const ortho = rows[3]?.outcome;
    expect(ortho === undefined || !ortho.ok || ortho.fit.rmsDeg > 3 * equidistant.fit.rmsDeg).toBe(
      true,
    );
  });
});
