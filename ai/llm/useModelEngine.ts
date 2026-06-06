// Owns the chat's in-browser model lifecycle: which provider answers, the
// download/load progress, what's cached on the device, and the storage readout.
// Lifted out of App so the in-composer ModelPicker and the chat share one source
// of truth. The deterministic HeuristicProvider is always the fallback — the
// chat never breaks while (or if) a model loads.

import { useCallback, useMemo, useRef, useState } from "react";
import {
  isCached,
  removeFromCache,
  storageEstimate,
  type StorageEstimate,
} from "./cache";
import { MODELS, modelById, type ModelOption } from "./models";
import { HeuristicProvider, type LLMProvider } from "./provider";
import { TransformersJsProvider } from "./transformersjs";
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
    const entries = await Promise.all(
      MODELS.filter((m) => m.ready).map(
        async (m) => [m.id, await isCached(m)] as const,
      ),
    );
    setCached(Object.fromEntries(entries));
    setStorage(await storageEstimate());
  }, []);

  // Tear down any loading/loaded model and revert the chat to the rules engine.
  const teardown = useCallback(() => {
    active.current?.dispose();
    active.current = null;
    inFlight.current = null;
    setProvider(heuristic);
    setProviderId("rules");
    setLoad(IDLE);
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
        return;
      }
      const model = modelById(id);
      if (!model) return;
      if (!HAS_WEBGPU) {
        setProvider(heuristic);
        setLoad({ ...IDLE, phase: "unsupported" });
        return;
      }
      const fromCache = await isCached(model);
      if (token !== switchSeq.current) return; // switched again during the check
      const p =
        model.runtime === "transformersjs"
          ? new TransformersJsProvider(model)
          : new WebLLMProvider(model);
      if (p instanceof WebLLMProvider) active.current = p;
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
