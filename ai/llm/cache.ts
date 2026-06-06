// On-device model-cache utilities over @mlc-ai/web-llm's IndexedDB cache backend
// + the Storage API. These power the picker's "downloaded" badges, the
// remove-to-free-space action, and the storage readout.
//
// The cache backend web-llm uses is selected by appConfig.useIndexedDBCache, so
// EVERY cache call must pass the SAME appConfig the model was loaded with —
// otherwise hasModelInCache/delete look in the wrong store and report nothing.
// buildAppConfig() is the single source of truth (shared with webllm.ts).
//
// web-llm is imported lazily (it's a large module): nothing here pulls it in
// until the picker panel is first opened.

import type { AppConfig } from "@mlc-ai/web-llm";
import type { ModelOption } from "./models";

// The appConfig used to load a model. Custom (HF-hosted) models carry their own
// model_list in model.appConfig; prebuilt ones use web-llm's. We force the
// IndexedDB cache backend: the Cache API can't follow HF's Xet CDN redirect
// (cas-bridge.xethub.hf.co) that large shards come through — Cache.add() throws
// and aborts the load. getCacheBackend() reads appConfig.cacheBackend, so every
// cache call (hasModelInCache / delete) MUST go through here to look in the same
// store the weights load into.
export const buildAppConfig = async (
  model: ModelOption,
): Promise<AppConfig> => {
  const webllm = await import("@mlc-ai/web-llm");
  const base = model.appConfig ?? webllm.prebuiltAppConfig;
  return { ...base, cacheBackend: "indexeddb" };
};

// Are this model's weights fully present in the on-device cache? Best-effort:
// any failure (no IndexedDB, model not in the appConfig's model_list) reports
// "not cached" rather than throwing.
export const isCached = async (model: ModelOption): Promise<boolean> => {
  try {
    const webllm = await import("@mlc-ai/web-llm");
    return await webllm.hasModelInCache(model.id, await buildAppConfig(model));
  } catch {
    return false;
  }
};

// Delete every cached artifact (weights + wasm + config) for this model. Used by
// the "remove to free space" action and to reclaim partial shards after a
// cancelled download.
export const removeFromCache = async (model: ModelOption): Promise<void> => {
  const webllm = await import("@mlc-ai/web-llm");
  await webllm.deleteModelAllInfoInCache(model.id, await buildAppConfig(model));
};

export type StorageEstimate = { usage: number; quota: number } | null;

// Best-effort on-device storage usage (bytes). null when the browser doesn't
// expose the Storage API (Safari private mode, older browsers).
export const storageEstimate = async (): Promise<StorageEstimate> => {
  try {
    if (typeof navigator === "undefined" || !navigator.storage?.estimate)
      return null;
    const { usage = 0, quota = 0 } = await navigator.storage.estimate();
    return { usage, quota };
  } catch {
    return null;
  }
};
