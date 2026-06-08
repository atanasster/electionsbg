// Owns the chat's in-browser model lifecycle: which provider answers, the
// download/load progress, what's cached on the device, and the storage readout.
// Lifted out of App so the in-composer ModelPicker and the chat share one source
// of truth. The deterministic HeuristicProvider is always the fallback — the
// chat never breaks while (or if) a model loads.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  isCached,
  removeFromCache,
  storageEstimate,
  type StorageEstimate,
} from "./cache";
import { MODELS, modelById, type ModelOption } from "./models";
import { OpenRouterProvider } from "./openrouter";
import { HeuristicProvider, type LLMProvider } from "./provider";
import { WebLLMProvider, webgpuSupported } from "./webllm";

const HAS_WEBGPU = webgpuSupported();

export type LoadPhase = "idle" | "loading" | "ready" | "error" | "unsupported";

export type LoadState = {
  phase: LoadPhase;
  pct: number;
  note: string;
  // true while loading weights that were already on the device (fast, no
  // download, no cancel needed) — lets the UI say "Loading (cached)" instead of
  // showing a scary multi-GB download bar.
  fromCache: boolean;
};

const IDLE: LoadState = { phase: "idle", pct: 0, note: "", fromCache: false };

// If the origin's storage holds less than this floor, no model weights can be
// present — so refresh() can answer "nothing downloaded" from the cheap Storage
// API alone and skip importing the ~6 MB web-llm module just to render cache
// badges. MUST stay safely under the SMALLEST on-device model's footprint:
// FunctionGemma is only ~157 MB (the old 300 MB floor predated it and wrongly
// reported it as not-cached — its weights land below 300 MB). The app keeps no
// service worker and React Query is in-memory, so a visitor who has downloaded
// nothing sits well under this — the optimization still fires for them.
const MIN_CACHED_MODEL_BYTES = 100 * 1024 * 1024;

// Remembers the last engine the user picked. Restored on the next visit so the
// composer pill doesn't silently snap back to the Basic engine. Only the
// no-cost engines (Basic, cloud) are auto-restored; an on-device model is left
// for the user to re-confirm via the picker before we spend time/VRAM loading
// its weights — see the restore effect below.
const SAVED_KEY = "naiasno.model.v1";

const persistChoice = (id: string) => {
  try {
    localStorage.setItem(SAVED_KEY, id);
  } catch {
    /* private mode / quota — non-fatal */
  }
};

export type ModelEngine = {
  provider: LLMProvider;
  providerId: string; // "rules" or a ModelOption.id
  load: LoadState;
  hasWebGPU: boolean;
  cached: Record<string, boolean>; // model id -> weights present on device
  storage: StorageEstimate;
  select: (id: string) => Promise<void>;
  cancel: () => void;
  remove: (id: string) => Promise<void>;
  refresh: () => Promise<void>;
};

export const useModelEngine = (): ModelEngine => {
  const heuristic = useMemo(() => new HeuristicProvider(), []);
  const [provider, setProvider] = useState<LLMProvider>(heuristic);
  const [providerId, setProviderId] = useState("rules");
  const [load, setLoad] = useState<LoadState>(IDLE);
  const [cached, setCached] = useState<Record<string, boolean>>({});
  const [storage, setStorage] = useState<StorageEstimate>(null);

  // Each selection bumps the token; a stale in-flight init() (the user switched
  // again, or cancelled, mid-load) must not clobber the current banner.
  const switchSeq = useRef(0);
  // The WebLLM provider currently loading/loaded, so cancel/remove can dispose
  // its worker (hard-aborts the download, frees WebGPU buffers).
  const active = useRef<WebLLMProvider | null>(null);
  // What's loading right now + whether it was already cached, so cancel knows
  // whether to reclaim partial shards (fresh download) or leave them (cached).
  const inFlight = useRef<{ model: ModelOption; fromCache: boolean } | null>(
    null,
  );

  const refresh = useCallback(async () => {
    // storageEstimate() uses only navigator.storage — no web-llm import. Do it
    // first: if the device holds less than the smallest model, nothing can be
    // cached, so skip the per-model probe (and the ~6 MB web-llm import) entirely.
    // This is the common case — a visitor opening the picker who has never
    // downloaded a model. When the API is unavailable (null) we fall through to
    // the normal probe rather than guess.
    const est = await storageEstimate();
    setStorage(est);
    if (est && est.usage < MIN_CACHED_MODEL_BYTES) {
      setCached({});
      return;
    }
    const entries = await Promise.all(
      // cloud models have no on-device weights — skip the (web-llm-pulling) cache probe
      MODELS.filter((m) => m.ready && m.runtime !== "cloud").map(
        async (m) => [m.id, await isCached(m)] as const,
      ),
    );
    setCached(Object.fromEntries(entries));
  }, []);

  // Tear down any loading/loaded model and revert the chat to the rules engine.
  const teardown = useCallback(() => {
    active.current?.dispose();
    active.current = null;
    inFlight.current = null;
    setProvider(heuristic);
    setProviderId("rules");
    setLoad(IDLE);
    persistChoice("rules");
  }, [heuristic]);

  const select = useCallback(
    async (id: string) => {
      const token = ++switchSeq.current;
      active.current?.dispose();
      active.current = null;
      inFlight.current = null;
      setProviderId(id);
      if (id === "rules") {
        setProvider(heuristic);
        setLoad(IDLE);
        persistChoice("rules");
        return;
      }
      const model = modelById(id);
      if (!model) return;
      // Cloud models need no WebGPU and no download — select instantly.
      if (model.runtime === "cloud") {
        const p = new OpenRouterProvider(model);
        void p.init();
        setProvider(p);
        setLoad({ phase: "ready", pct: 100, note: "", fromCache: false });
        persistChoice(id);
        return;
      }
      if (!HAS_WEBGPU) {
        setProvider(heuristic);
        setLoad({ ...IDLE, phase: "unsupported" });
        return;
      }
      const fromCache = await isCached(model);
      if (token !== switchSeq.current) return; // switched again during the check
      const p = new WebLLMProvider(model);
      active.current = p;
      inFlight.current = { model, fromCache };
      setProvider(p); // usable immediately (falls back to rules while weights load)
      setLoad({ phase: "loading", pct: 0, note: "", fromCache });
      try {
        await p.init((pct, note) => {
          if (token === switchSeq.current)
            setLoad({ phase: "loading", pct, note, fromCache });
        });
        if (token === switchSeq.current) {
          inFlight.current = null;
          setLoad({ phase: "ready", pct: 100, note: "", fromCache: true });
          persistChoice(id);
          void refresh();
        }
      } catch (e) {
        if (token === switchSeq.current) {
          inFlight.current = null;
          setLoad({
            phase: "error",
            pct: 0,
            note: e instanceof Error ? e.message : String(e),
            fromCache,
          });
        }
      }
    },
    [heuristic, refresh],
  );

  const cancel = useCallback(() => {
    ++switchSeq.current; // invalidate the in-flight init
    const pending = inFlight.current;
    teardown();
    // A cancelled FRESH download leaves partial shards in IndexedDB — drop them
    // so a half-finished model doesn't silently squat on disk. A cancelled
    // load of an already-cached model keeps its (complete) weights.
    if (pending && !pending.fromCache) {
      void removeFromCache(pending.model)
        .then(refresh)
        .catch(() => {});
    }
  }, [teardown, refresh]);

  const remove = useCallback(
    async (id: string) => {
      const model = modelById(id);
      if (!model) return;
      if (providerId === id) {
        ++switchSeq.current;
        teardown();
      }
      try {
        await removeFromCache(model);
      } finally {
        await refresh();
      }
    },
    [providerId, teardown, refresh],
  );

  // NB: refresh() is deliberately NOT called on mount. It pulls in the ~6 MB
  // web-llm module (hasModelInCache needs it), and most visitors only ever use
  // the rules engine — so we keep it off the page-load critical path and let the
  // picker call refresh() the first time its panel opens.

  // Restore the remembered engine once on mount so a refresh doesn't snap the
  // composer pill back to Basic. Cloud models restore immediately (no download,
  // no WebGPU, no web-llm import). An on-device model restores ONLY if its
  // weights are already on the device — gating on isCached() means a refresh
  // re-loads a cached model fast (no network) but never kicks off a surprise
  // multi-GB download for a model the user removed since last visit. "rules" is
  // already the default.
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(SAVED_KEY);
    } catch {
      /* private mode — nothing to restore */
    }
    if (!saved || saved === "rules") return;
    const m = modelById(saved);
    if (!m?.ready) return;
    if (m.runtime === "cloud") {
      void select(saved);
      return;
    }
    // On-device: the isCached probe pulls in web-llm, but only for a visitor who
    // previously downloaded a model — they already opted into that cost. Skip if
    // the user picked another engine while the probe was in flight.
    if (m.runtime === "webllm" && HAS_WEBGPU) {
      const seq = switchSeq.current;
      void isCached(m).then((present) => {
        if (present && switchSeq.current === seq) void select(saved);
      });
    }
  }, [select]);

  return {
    provider,
    providerId,
    load,
    hasWebGPU: HAS_WEBGPU,
    cached,
    storage,
    select,
    cancel,
    remove,
    refresh,
  };
};
