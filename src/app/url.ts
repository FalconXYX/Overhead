// src/app/url.ts — ?cam= and ?t= (M1 step 6; README URL and persistence), ?sel= (M3 step 12), ?demo=1 and shareUrl
// (M9 step 8). [Redesign] ?t= is a time in the recorded clip: a live camera never writes it, and main.tsx ignores it
// there.
import { shallow } from "zustand/vanilla/shallow";
import { isoUtcSeconds } from "../domain/time";
import { parseObjectId } from "../state/objectId";
import type { AppStore } from "../state/store";
import type { AppState, ObjectId } from "../state/types";

export interface UrlState {
  cam: string | null;
  tMs: number | null; // only an ISO 8601 UTC value ending in Z; anything else is null
  sel: ObjectId | null; // [M3] parsed by parseObjectId; anything else is null
  demo: boolean; // [M9] true only for ?demo=1
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
  const sel = params.get("sel");
  const tMs = t === null ? Number.NaN : parseIsoUtc(t);
  return {
    cam: cam === null || cam === "" ? null : cam,
    tMs: Number.isFinite(tMs) ? tMs : null,
    sel: sel === null ? null : parseObjectId(sel),
    demo: params.get("demo") === "1",
  };
}

/**
 * The view without the tour: "?cam=<id>", "&t=" in replay (the store's time, even while playing) except on a live
 * camera ([Redesign] live has no time controls), and "&sel=".
 */
function viewSearch(state: AppState): string {
  const { activeId } = state.camera;
  const cam = `?cam=${encodeURIComponent(activeId)}`;
  const live = state.camera.registry[activeId]?.kind === "youtube";
  const t =
    state.clock.mode === "replay" && !live ? `&t=${isoUtcSeconds(state.clock.simTimeMs)}` : "";
  const { selectedId } = state.selection;
  return `${cam}${t}${selectedId === null ? "" : `&sel=${selectedId}`}`;
}

/**
 * "?cam=<id>", plus "&t=<isoUtcSeconds>" in replay (never on a live camera), "&sel=<id>" while something is selected
 * and [M9] "&demo=1" while the tour runs. Colons are written raw (URLSearchParams would encode them); every ObjectId is otherwise letters and
 * digits.
 */
export function writeUrlState(state: AppState): string {
  return `${viewSearch(state)}${state.ui.demo.active ? "&demo=1" : ""}`;
}

/**
 * [M9] Absolute link to this view, resolved against href (the page's own URL; its query and hash are replaced): always
 * the current t in replay, even while playing, where the address bar's t is stale (M1 writes it only when paused);
 * none in live, so the link opens live; cam and sel when set; never demo.
 */
export function shareUrl(state: AppState, href: string): string {
  return new URL(viewSearch(state), href).href;
}

/**
 * Writes once now, then delayMs after the last discrete change (trailing debounce): camera, mode, pause,
 * every seek or step while paused, the selection and [M9] the tour starting or stopping. Never per tick while
 * playing, never on hover.
 */
export function startUrlSync(
  store: AppStore,
  write: (search: string) => void,
  delayMs = 250,
): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  write(writeUrlState(store.getState()));
  const unsubscribe = store.subscribe(
    (s) => [
      s.camera.activeId,
      s.clock.mode,
      s.clock.playing ? null : s.clock.simTimeMs,
      s.selection.selectedId,
      s.ui.demo.active, // [M9] exiting the tour removes &demo=1
    ],
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
