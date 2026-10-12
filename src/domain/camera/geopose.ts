// src/domain/camera/geopose.ts — OGC GeoPose 1.0 Basic-YPR (21-056r11) export, import and validation. [M4]
//
// Convention (docs/DECISIONS.md, "GeoPose"):
// - R = Rz(yaw)·Ry(pitch)·Rx(roll) from ENU, row-major. Its columns are the body axes in ENU:
//   x = optical axis F, y = image-left, z = image-up, where image-right = cos ρ R̂ − sin ρ Û and
//   image-up = sin ρ R̂ + cos ρ Û, with R̂ = (cos A₀, −sin A₀, 0) and Û = (−sin h₀ sin A₀, −sin h₀ cos A₀, cos h₀).
// - Export uses yaw = wrap180(90 − az), pitch = −alt, roll = wrap180(roll). A zenith fisheye exports (90, −90, roll).
// - h is ellipsoidal: callers pass site.heightM + site.geoidSepM.
// - flipX is not part of the pose: a mirror is not a rotation.
// - Round-trip tests compare rotation matrices or reprojected pixels, not raw angles (angles are ambiguous at pitch −90).
// - The vendored schema is never fetched at runtime or in CI (schemas/PROVENANCE.md). ajv compiles on first call, so
//   bundles that never validate (the propagation worker) stay free of ajv (gotcha G9).
// - [M9] ajv is loaded with a dynamic import() on that first call (M9 step 7), so it is its own chunk, fetched only
//   when something validates: the app's startup chunk no longer carries it. validateGeoPose is therefore async.

import type { ValidateFunction } from "ajv"; // types only: ajv itself is imported on first use
import { wrap180, wrap360 } from "../geo";
import type { Calibration } from "./lens";
import schema from "./schemas/GeoPose.Basic.YPR.Schema.json" with { type: "json" };

/** OGC GeoPose 1.0 Basic-YPR (21-056r11), keys from the vendored schema. */
export interface GeoPoseBasicYpr {
  position: { lat: number; lon: number; h: number }; // h: metres above the WGS-84 ellipsoid
  angles: { yaw: number; pitch: number; roll: number }; // degrees
}

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
/** Below this horizontal length of the optical axis the pose is treated as looking straight up (or down). */
const VERTICAL_EPS = 1e-9;

/** sin and cos of an angle in degrees, exact at multiples of 90° (Math.cos(π/2) is 6.1e-17, gotcha G1). */
function sinCosDeg(deg: number, out: Float64Array, offset: number): void {
  const r = deg % 360;
  if (r % 90 === 0) {
    const q = (((r / 90) % 4) + 4) % 4; // 0, 1, 2 or 3 quarter turns
    out[offset] = q === 1 ? 1 : q === 3 ? -1 : 0;
    out[offset + 1] = q === 0 ? 1 : q === 2 ? -1 : 0;
    return;
  }
  const a = deg * D2R;
  out[offset] = Math.sin(a);
  out[offset + 1] = Math.cos(a);
}

const sc = new Float64Array(6);

/** R = Rz(yaw)·Ry(pitch)·Rx(roll) from ENU (row-major). Round-trip tests compare these matrices. */
export function geoPoseRotation(
  yawDeg: number,
  pitchDeg: number,
  rollDeg: number,
  out: Float64Array = new Float64Array(9),
): Float64Array {
  sinCosDeg(yawDeg, sc, 0);
  sinCosDeg(pitchDeg, sc, 2);
  sinCosDeg(rollDeg, sc, 4);
  const sy = sc[0] ?? 0;
  const cy = sc[1] ?? 1;
  const sp = sc[2] ?? 0;
  const cp = sc[3] ?? 1;
  const sr = sc[4] ?? 0;
  const cr = sc[5] ?? 1;
  out[0] = cy * cp;
  out[1] = cy * sp * sr - sy * cr;
  out[2] = cy * sp * cr + sy * sr;
  out[3] = sy * cp;
  out[4] = sy * sp * sr + cy * cr;
  out[5] = sy * sp * cr - cy * sr;
  out[6] = -sp;
  out[7] = cp * sr;
  out[8] = cp * cr;
  return out;
}

/** The GeoPose angles of a calibration: (90, −90, roll) when zenith-locked, else (90 − az, −alt, roll), wrapped. */
function poseAngles(c: Calibration, zenithLocked: boolean): GeoPoseBasicYpr["angles"] {
  return zenithLocked
    ? { yaw: 90, pitch: -90, roll: wrap180(c.rollDeg) }
    : { yaw: wrap180(90 - c.azDeg), pitch: -c.altDeg, roll: wrap180(c.rollDeg) };
}

/** yaw = wrap180(90 − azDeg), pitch = −altDeg, roll = wrap180(rollDeg); zenith fisheye → (90, −90, roll). */
export function toGeoPose(
  latDeg: number,
  lonDeg: number,
  ellipsoidHeightM: number,
  calibration: Calibration,
  zenithLocked: boolean,
): GeoPoseBasicYpr {
  return {
    position: { lat: latDeg, lon: lonDeg, h: ellipsoidHeightM },
    angles: poseAngles(calibration, zenithLocked),
  };
}

/**
 * The camera rotation of a calibration (the GeoPose matrix of toGeoPose's angles): columns F, image-left, image-up
 * in ENU. Internal to the camera module (the fit starts from it).
 */
export function calibrationRotation(
  calibration: Calibration,
  zenithLocked: boolean,
  out: Float64Array = new Float64Array(9),
): Float64Array {
  const a = poseAngles(calibration, zenithLocked);
  return geoPoseRotation(a.yaw, a.pitch, a.roll, out);
}

/**
 * Optical-axis azimuth, altitude and roll of a rotation matrix (row-major, columns F, image-left, image-up in ENU).
 * A vertical axis (|F_EN| < 1e-9) gives azDeg 0, altDeg ±90 and the roll about it, so any yaw folds into roll.
 * Internal to the camera module (fromGeoPose and the fit use it).
 */
export function rotationToAzAltRoll(m: Float64Array): {
  azDeg: number;
  altDeg: number;
  rollDeg: number;
} {
  const fE = m[0] ?? 0;
  const fN = m[3] ?? 0;
  const fU = m[6] ?? 0;
  const upE = m[2] ?? 0;
  const upN = m[5] ?? 0;
  const upU = m[8] ?? 0;
  const horiz = Math.hypot(fE, fN);
  if (horiz < VERTICAL_EPS) {
    // A₀ = 0: R̂ = E, Û = −N looking up (h₀ = 90), Û = +N looking down (h₀ = −90).
    const down = fU < 0;
    return {
      azDeg: 0,
      altDeg: down ? -90 : 90,
      rollDeg: Math.atan2(upE, down ? upN : -upN) * R2D,
    };
  }
  const az = Math.atan2(fE, fN);
  const alt = Math.atan2(fU, horiz);
  const sa = Math.sin(az);
  const ca = Math.cos(az);
  const sh = Math.sin(alt);
  const ch = Math.cos(alt);
  const upR = upE * ca - upN * sa; // up · R̂
  const upUhat = -upE * sh * sa - upN * sh * ca + upU * ch; // up · Û
  return { azDeg: wrap360(az * R2D), altDeg: alt * R2D, rollDeg: Math.atan2(upR, upUhat) * R2D };
}

const fromScratch = new Float64Array(9);

/** Inverse of toGeoPose, from the rotation matrix. At pitch ≈ −90: azDeg = 0, rollDeg = wrap180(roll + yaw − 90). */
export function fromGeoPose(pose: GeoPoseBasicYpr): {
  azDeg: number;
  altDeg: number;
  rollDeg: number;
} {
  const { yaw, pitch, roll } = pose.angles;
  return rotationToAzAltRoll(geoPoseRotation(yaw, pitch, roll, fromScratch));
}

/** validateGeoPose's answer. */
export type GeoPoseValidation =
  | { ok: true; pose: GeoPoseBasicYpr }
  | { ok: false; errors: string[] };

/** Compiled on first use (gotcha G9); [M9] a failed load (the ajv chunk did not arrive) is retried on the next call. */
let validator: Promise<ValidateFunction<GeoPoseBasicYpr>> | null = null;

async function compileValidator(): Promise<ValidateFunction<GeoPoseBasicYpr>> {
  // The named export: the default import fails under nodenext (TS2351).
  const { Ajv } = await import("ajv");
  return new Ajv({ allErrors: true, strict: true }).compile<GeoPoseBasicYpr>(schema);
}

/**
 * ajv (vendored schema, compiled on first call) plus lat ∈ [−90, 90], lon ∈ [−180, 180]. [M9] Async: the first call
 * loads ajv (M9 step 7). Rejects only when ajv cannot be loaded.
 */
export async function validateGeoPose(value: unknown): Promise<GeoPoseValidation> {
  validator ??= compileValidator().catch((error: unknown) => {
    validator = null;
    throw error;
  });
  const validate = await validator;
  if (!validate(value)) {
    return {
      ok: false,
      errors: (validate.errors ?? []).map(
        (e) => `${e.instancePath || "/"} ${e.message ?? "invalid"}`,
      ),
    };
  }
  // ajv's "number" already rejects NaN and Infinity. The schema has no ranges and allows extra properties.
  const errors: string[] = [];
  if (value.position.lat < -90 || value.position.lat > 90)
    errors.push("/position/lat must be in [-90, 90]");
  if (value.position.lon < -180 || value.position.lon > 180)
    errors.push("/position/lon must be in [-180, 180]");
  return errors.length === 0 ? { ok: true, pose: value } : { ok: false, errors };
}
