// src/domain/orbits/index.ts — OMM handling, the packed sample layout, propagation into it, interpolation, visibility,
// ground tracks. GpGroup lands in M0, everything else from M3. Other modules import only this file.

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
export {
  createPropagationContext,
  type PropagationContext,
  SAMPLE_STRIDE,
  SampleField,
  writeSample,
} from "./sample";
export { trackLonLatDeg } from "./tracks";
export { isVisible, SUN_CUTOFF_DEG } from "./visibility";
