// src/app/url.ts — ?cam= and ?t= (M1 step 6; README URL and persistence). M3 adds sel, M9 demo.
import { shallow } from "zustand/vanilla/shallow";
import { isoUtcSeconds } from "../domain/time";
import type { AppStore } from "../state/store";
import type { AppState } from "../state/types";

export interface UrlState {
  cam: string | null;
  tMs: number | null; // only an ISO 8601 UTC value ending in Z; anything else is null
}

/** Zone-less values are rejected, never guessed: Date.parse reads them as local time (Gotcha 11). */
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?Z$/;

/**
 * Epoch ms of an ISO 8601 UTC string, or NaN. Date.parse rolls day overflow forward (2026-02-30 → 2026-03-02, T24:00 →
 * the next day), so the value must also read back as written.
 */
function parseIsoUtc(t: string): number {
  if (!ISO_UTC.test(t)) return Number.NaN;
  const ms = Date.parse(t);
  return Number.isFinite(ms) && new Date(ms).toISOString().startsWith(t.slice(0, -1))
    ? ms
    : Number.NaN;
}

export function parseUrlState(search: string): UrlState {
  const params = new URLSearchParams(search); // decodes %3A
  const cam = params.get("cam");
  const t = params.get("t");
  const tMs = t === null ? Number.NaN : parseIsoUtc(t);
  return {
    cam: cam === null || cam === "" ? null : cam,
    tMs: Number.isFinite(tMs) ? tMs : null,
  };
}

/** "?cam=<id>", plus "&t=<isoUtcSeconds>" in replay; colons written raw (URLSearchParams would encode them). */
export function writeUrlState(state: AppState): string {
  const cam = `?cam=${encodeURIComponent(state.camera.activeId)}`;
  return state.clock.mode === "replay" ? `${cam}&t=${isoUtcSeconds(state.clock.simTimeMs)}` : cam;
}

/**
 * Writes once now, then delayMs after the last discrete change (trailing debounce): camera, mode, pause,
 * and every seek or step while paused. Never per tick while playing.
 */
export function startUrlSync(
  store: AppStore,
  write: (search: string) => void,
  delayMs = 250,
): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  write(writeUrlState(store.getState()));
  const unsubscribe = store.subscribe(
    (s) => [s.camera.activeId, s.clock.mode, s.clock.playing ? null : s.clock.simTimeMs],
    () => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        write(writeUrlState(store.getState()));
      }, delayMs);
    },
    { equalityFn: shallow },
  );
  return () => {
    unsubscribe();
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
}
