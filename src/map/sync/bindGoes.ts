// src/map/sync/bindGoes.ts — the GOES-West layer follows the clock (M7 step 5): bindGoesTime (README, one Time
// change per 10-minute step), bindGoesLayer (visibility and the tile-error fallback) and bindGoesDomainPoll
// (DescribeDomains every 5 min while the layer is on, plus the HEAD probe of the newest step). bindGoesLayer writes
// to the store from OpenLayers tileloaderror listeners and the poll from its own timer, never from a store listener
// on the slice it watches (binding rules 4 and 7).
import type BaseLayer from "ol/layer/Base";
import { unByKey } from "ol/Observable";
import type WMTS from "ol/source/WMTS";
import { shallow } from "zustand/vanilla/shallow";
import {
  GOES_STEP_MS,
  goesStepMs,
  isoUtcSeconds,
  mergeGoesIntervals,
  parseGoesDomain,
  removeGoesStep,
  type TimeInterval,
} from "../../domain/time";
import { selectGoesStepMs, selectGoesVisible } from "../../state/selectors";
import type { AppStore } from "../../state/store";
import { domainTextFromXml, goesDomainUrl, goesProbeUrl } from "../ground/layers/goes";

export const GOES_POLL_MS = 300_000;
/** Automatic one-step fallbacks in a row; the next failure sets data.goes.status to "error". */
export const GOES_MAX_FALLBACKS = 3;

/** setTime receives "YYYY-MM-DDThh:mm:00Z" once per 10-minute step (wire it to WMTS updateDimensions). */
export function bindGoesTime(store: AppStore, setTime: (iso: string) => void): () => void {
  return store.subscribe(
    selectGoesStepMs,
    (stepMs) => {
      if (stepMs !== null) setTime(isoUtcSeconds(stepMs));
    },
    { equalityFn: shallow, fireImmediately: true },
  );
}

/** Steps proved missing by a tile error. Shared by bindGoesLayer and bindGoesDomainPoll; one per map. */
export interface GoesSession {
  readonly missingStepsMs: Set<number>;
}
export const createGoesSession = (): GoesSession => ({ missingStepsMs: new Set() });

/** Time, visibility and the tile-error fallback for the GOES layer. */
export function bindGoesLayer(
  store: AppStore,
  layer: BaseLayer,
  source: WMTS,
  session: GoesSession,
): () => void {
  const stepByKey = new Map<string, number>(); // source key → step, for errors that arrive after a Time change
  let failuresInARow = 0;
  const unbindTime = bindGoesTime(store, (iso) => {
    source.updateDimensions({ Time: iso });
    stepByKey.set(source.getKey(), Date.parse(iso));
  });
  const keys = [
    source.on("tileloadend", (e) => {
      if (e.tile.key === source.getKey()) failuresInARow = 0;
    }),
    source.on("tileloaderror", (e) => {
      const stepMs = stepByKey.get(e.tile.key);
      if (stepMs === undefined || session.missingStepsMs.has(stepMs)) return;
      session.missingStepsMs.add(stepMs); // never requested again this session: OpenLayers keeps ERROR tiles
      const { data, actions } = store.getState();
      if (e.tile.key === source.getKey()) {
        failuresInARow += 1;
        if (failuresInARow > GOES_MAX_FALLBACKS) actions.setGoesStatus("error");
      }
      // The caption and the Time follow the store, so the caption never names a step that is not on screen.
      actions.setGoesDomain(removeGoesStep(data.goes.intervals, stepMs), data.goes.latestStepMs);
    }),
  ];
  // Hidden until a step exists: the source starts on the capabilities Default (Gotcha 2).
  const unbindVisible = store.subscribe(selectGoesVisible, (visible) => layer.setVisible(visible), {
    equalityFn: shallow,
    fireImmediately: true,
  });
  return () => {
    unbindTime();
    unbindVisible();
    unByKey(keys);
  };
}

export interface GoesPollDeps {
  /** Keep an arrow wrapper around the global fetch: a bare `fetch` stored on an object is an Illegal invocation. */
  fetchFn: (url: string, init: RequestInit) => Promise<Response>;
  nowMs: () => number;
}

/** intervals without every step a tile error proved missing this session. */
function withoutMissing(
  intervals: readonly TimeInterval[],
  session: GoesSession,
): readonly TimeInterval[] {
  let out = intervals;
  for (const stepMs of session.missingStepsMs) out = removeGoesStep(out, stepMs);
  return out;
}

/** The larger step; null counts as lower than any step (both null stays null). */
function maxStepMs(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.max(a, b);
}

/**
 * DescribeDomains once when layers.goesIr turns on, then every GOES_POLL_MS while it stays on; nothing while it is
 * off. A newer newest step is confirmed by a HEAD probe of tile 0/0/0 (200 and layer-time-actual equal to the step);
 * otherwise the newest step falls back one listed step, without a second probe, and the next poll probes again.
 */
export function bindGoesDomainPoll(
  store: AppStore,
  session: GoesSession,
  deps: GoesPollDeps,
): () => void {
  let controller: AbortController | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let inFlight: AbortSignal | null = null; // the start whose poll is running
  let warned = false;

  /** The step the HEAD probe confirms: newest, or the listed step before it. */
  async function confirmStepMs(
    newestMs: number,
    draft: readonly TimeInterval[],
    signal: AbortSignal,
  ): Promise<number | null> {
    try {
      const res = await deps.fetchFn(goesProbeUrl(newestMs), {
        method: "HEAD",
        cache: "no-store",
        signal,
      });
      if (res.status === 200 && res.headers.get("layer-time-actual") === isoUtcSeconds(newestMs))
        return newestMs;
    } catch {
      // A network error counts as a miss; an abort is caught by the caller's signal check.
    }
    return goesStepMs(newestMs - GOES_STEP_MS, draft, null);
  }

  async function poll(signal: AbortSignal): Promise<void> {
    // A restart gets a new signal, so an aborted poll never blocks it.
    if (inFlight === signal) return;
    inFlight = signal;
    try {
      const { data, actions } = store.getState();
      if (data.goes.status === "idle") actions.setGoesStatus("loading");
      const res = await deps.fetchFn(goesDomainUrl(deps.nowMs()), { cache: "no-store", signal });
      if (!res.ok) throw new Error(`GOES-West DescribeDomains: HTTP ${res.status}`);
      const domain = domainTextFromXml(await res.text());
      if (domain === null) throw new Error("GOES-West DescribeDomains: no <Domain>");
      const next = parseGoesDomain(domain);
      const draft = withoutMissing(
        mergeGoesIntervals(store.getState().data.goes.intervals, next),
        session,
      );
      const newestMs = draft[draft.length - 1]?.[1] ?? null;
      const latestMs = store.getState().data.goes.latestStepMs;
      const confirmedMs =
        newestMs !== null && (latestMs === null || newestMs > latestMs)
          ? await confirmStepMs(newestMs, draft, signal)
          : latestMs;
      if (signal.aborted) return;
      // Re-read: a tile error may have dropped a step during the awaits.
      const goes = store.getState().data.goes;
      const merged = withoutMissing(mergeGoesIntervals(goes.intervals, next), session);
      actions.setGoesDomain(merged, maxStepMs(goes.latestStepMs, confirmedMs));
      actions.setGoesStatus("ready"); // also clears a tile-guard error
    } catch (error) {
      if (signal.aborted) return;
      if (!warned) {
        warned = true;
        console.warn("GOES-West availability poll failed; retrying on the next poll", error);
      }
      // Keep showing what is known; the next poll is the only retry.
      const { data, actions } = store.getState();
      if (data.goes.intervals.length === 0) actions.setGoesStatus("error");
    } finally {
      if (inFlight === signal) inFlight = null;
    }
  }

  function stop(): void {
    if (timer !== null) clearInterval(timer);
    timer = null;
    controller?.abort();
    controller = null;
  }

  function start(): void {
    stop();
    const started = new AbortController();
    controller = started;
    void poll(started.signal);
    timer = setInterval(() => void poll(started.signal), GOES_POLL_MS);
  }

  const unsubscribe = store.subscribe(
    (s) => s.layers.goesIr,
    (on) => (on ? start() : stop()),
    { equalityFn: shallow, fireImmediately: true },
  );
  return () => {
    unsubscribe();
    stop();
  };
}
