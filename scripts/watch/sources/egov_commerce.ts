// data.egov.bg Commerce Registry (Търговски регистър) daily-filings dataset.
// The /update-connections skill consumes the bulk dumps from here; this
// watcher tells us when new daily files have been added.
//
// data.egov.bg's CKAN-style /api/3/action endpoints are broken (return
// success:false), and the SPA pages redirect away from deep links. So we
// fetch the dataset's listing page directly (the same one
// scripts/declarations/tr/fetch_dataset_index.ts walks for ingest) and use
// the first page's resource UUIDs as the fingerprint — when a new daily
// filing drops, page 1 shifts and the hash flips.

import type { WatchSource, Fingerprint, WatchState } from "../types";
import { fetchText, sha256Short } from "../fingerprint";

// Same UUID used by scripts/declarations/tr/fetch_dataset_index.ts.
const TR_DATASET_ID = "2df0c2af-e769-4397-be33-fcbe269806f3";
const PAGE = `https://data.egov.bg/organisation/dataset/${TR_DATASET_ID}?rpage=1`;

export const egovCommerce: WatchSource = {
  id: "egov_commerce",
  label: "data.egov.bg Commerce Registry (Търговски регистър)",
  url: PAGE,
  cadence: "weekly",

  async fingerprint(): Promise<Fingerprint> {
    const html = await fetchText(PAGE);
    if (!html) throw new Error("empty TR dataset page");
    // Extract the per-resource UUIDs from page 1. They're sorted newest-first
    // by data.egov.bg's UI, so any new daily drop shifts the list.
    const uuids = Array.from(
      html.matchAll(
        /\/organisation\/datasets\/resourceView\/([0-9a-f-]{36})/gi,
      ),
    )
      .map((m) => m[1])
      .filter((u, i, arr) => arr.indexOf(u) === i); // dedupe
    if (uuids.length === 0) {
      throw new Error("TR dataset page yielded zero resource UUIDs");
    }
    const value = sha256Short(uuids.join(","));
    return {
      value,
      detail: `${uuids.length} resources on page 1, hash ${value}`,
      meta: { topUuids: uuids.slice(0, 5), count: uuids.length },
    };
  },

  describe(prev: WatchState | null, curr: Fingerprint): string {
    if (!prev) return curr.detail;
    const prevTop = (prev.meta?.topUuids as string[] | undefined) ?? [];
    const currTop = (curr.meta?.topUuids as string[] | undefined) ?? [];
    const newOnes = currTop.filter((u) => !prevTop.includes(u));
    if (newOnes.length === 0)
      return `${curr.detail} (UUIDs rotated below the top)`;
    return `${newOnes.length} new resource(s) on top: ${newOnes.slice(0, 3).join(", ")}`;
  },
};
