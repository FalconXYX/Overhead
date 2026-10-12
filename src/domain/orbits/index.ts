// src/domain/orbits/index.ts — OMM handling, the packed sample layout, propagation into it, interpolation, visibility,
// ground tracks. GpGroup lands in M0, everything else from M3. Other modules import only this file.

// [M9] Starlink culling for the 10 Hz sample (cull.ts).
export {
  CULL_RANGE_KM,
  CULL_SLICES,
  CULL_SPEED_KM_S,
  type CullState,
  createCullState,
  cullLimitKm,
  resetCullState,
  writeCulledSample,
} from "./cull";
// [M8] The incoming check (incoming.ts).
export {
  collectIncoming,
  INCOMING_MIN_ALT_DEG,
  INCOMING_STEP_MS,
  INCOMING_STEPS,
  type IncomingHit,
  incomingEtaSec,
} from "./incoming";
export { type InterpMode, interpModeForRate, interpolateEnuKm, sunlitAt } from "./interpolate";
export {
  appendGroup,
  type CatalogEntry,
  elementAgeDays,
  GP_GROUPS,
  type GpGroup,
  type GpMeta,
  type GroupMask,
  ISS_NORAD_ID,
  parseGpFile,
  STALE_ELEMENTS_DAYS,
} from "./omm";
// [M5] Passes and in-frame spans (passes.ts): scripts/find-passes.ts and the tour (M9).
export { type FrameSpan, findPasses, frameSpans, type Pass } from "./passes";
export {
  createPropagationContext,
  type PropagationContext,
  SAMPLE_STRIDE,
  SampleField,
  writeSample,
} from "./sample";
export { trackLonLatDeg } from "./tracks";
export {
  belowSkyCutoff,
  isVisible,
  SKY_CUTOFF_GEOMETRIC_DEG,
  SUN_CUTOFF_DEG,
} from "./visibility";
