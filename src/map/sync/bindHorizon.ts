// src/map/sync/bindHorizon.ts — the terrain horizon per camera (M6 steps 7 and 9, README section 5 "Horizon"):
// bindHorizonWorker runs horizon.worker for the active camera and stores each profile with setHorizon;
// bindSkyHorizon hands the active camera's profile to the sky map's skyline.
import { shallow } from "zustand/vanilla/shallow";
import { selectHorizonProfileDeg } from "../../state/selectors";
import type { AppStore } from "../../state/store";
import type { CameraSite } from "../../state/types";
import type { HorizonIn, HorizonOut } from "../../workers/protocol";

/** What bindHorizonWorker uses from a Worker. A real Worker and a plain-object fake both satisfy it. */
export interface HorizonWorkerLike {
  postMessage(message: HorizonIn): void;
  terminate(): void;
  onmessage: ((e: MessageEvent<HorizonOut>) => void) | null;
}

const createHorizonWorker = (): HorizonWorkerLike =>
  new Worker(new URL("../../workers/horizon.worker.ts", import.meta.url), { type: "module" });

/** The fields of a site that the profile depends on (z0 = DEM ground + mastM). */
const sameHorizonSite = (a: CameraSite, b: CameraSite): boolean =>
  a.latDeg === b.latDeg && a.lonDeg === b.lonDeg && a.mastM === b.mastM;

/**
 * Sends `compute` for the active camera when its data.horizon entry is missing, idle or error (an error is retried
 * only when the camera is selected again); a loading or ready entry is reused, except when the active camera keeps
 * its id but its site's latDeg, lonDeg or mastM changes (local-replay loading another camera's clip). Only the
 * latest request per camera is stored. The worker is created on the first compute. The cleanup terminates it and
 * sets the entries it left loading back to idle, so a StrictMode remount computes them again.
 */
export function bindHorizonWorker(
  store: AppStore,
  createWorker: () => HorizonWorkerLike = createHorizonWorker,
): () => void {
  let worker: HorizonWorkerLike | null = null;
  let lastRequestId = 0;
  /** Camera id → its request in flight; removed when the reply lands. */
  const pending = new Map<string, number>();

  const onMessage = (e: MessageEvent<HorizonOut>): void => {
    const msg = e.data;
    if (msg.type === "progress") return; // the store has no field for it
    if (pending.get(msg.cameraId) !== msg.requestId) return; // superseded by a later request
    pending.delete(msg.cameraId);
    const { setHorizon } = store.getState().actions;
    if (msg.type === "done") {
      // The transferred array is stored as is: it is never written again.
      setHorizon(msg.cameraId, {
        status: "ready",
        profileDeg: msg.profileDeg,
        imagerySources: msg.imagerySources,
      });
    } else {
      // A warning, not an error: the geometric horizon still works (the e2e guard fails only on errors).
      console.warn(`Terrain horizon for ${msg.cameraId} unavailable: ${msg.message}`);
      setHorizon(msg.cameraId, { status: "error" });
    }
  };

  const compute = (cameraId: string, site: CameraSite): void => {
    if (worker === null) {
      worker = createWorker();
      worker.onmessage = onMessage;
    }
    lastRequestId += 1;
    pending.set(cameraId, lastRequestId);
    store
      .getState()
      .actions.setHorizon(cameraId, { status: "loading", profileDeg: null, imagerySources: [] });
    worker.postMessage({
      type: "compute",
      requestId: lastRequestId,
      cameraId,
      latDeg: site.latDeg,
      lonDeg: site.lonDeg,
      mastM: site.mastM,
    });
  };

  const unsubscribe = store.subscribe(
    (s) => [s.camera.activeId, s.camera.registry[s.camera.activeId]?.site ?? null] as const,
    ([id, site], [prevId, prevSite]) => {
      if (site === null) return; // not in the registry (yet)
      // With fireImmediately the first call gets the same tuple twice, so this is false then.
      const siteMoved =
        id === prevId && prevSite !== null && site !== prevSite && !sameHorizonSite(site, prevSite);
      const status = store.getState().data.horizon[id]?.status ?? "idle";
      if (!siteMoved && (status === "loading" || status === "ready")) return;
      compute(id, site);
    },
    { equalityFn: shallow, fireImmediately: true },
  );

  return () => {
    unsubscribe();
    worker?.terminate();
    worker = null;
    const { data, actions } = store.getState();
    for (const id of pending.keys()) {
      if (data.horizon[id]?.status === "loading") actions.setHorizon(id, { status: "idle" });
    }
    pending.clear();
  };
}

/** Calls sky.setHorizonProfile with the active camera's profile (null: none) now and whenever it changes. */
export function bindSkyHorizon(
  store: AppStore,
  sky: { setHorizonProfile(profileDeg: Float32Array | null): void },
): () => void {
  return store.subscribe(
    selectHorizonProfileDeg,
    (profileDeg) => sky.setHorizonProfile(profileDeg),
    {
      equalityFn: shallow,
      fireImmediately: true,
    },
  );
}
