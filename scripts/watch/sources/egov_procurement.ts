// data.egov.bg АОП (Агенция по обществени поръчки) — public-procurement
// open-data dataset. АОП publishes fortnightly OCDS-standard bundles, one
// dataset per period. The /update-procurement skill consumes these.
//
// We fingerprint page 1 of the org's dataset listing — newest-first by
// upload, so a new fortnight publishes by shifting the top of the list. Same
// pattern as egov_commerce. The CKAN-style /api endpoints on data.egov.bg
// are broken (return success:false), so we fall back to HTML parsing.

import type { WatchSource, Fingerprint, WatchState } from "../types";
import { fetchText, sha256Short } from "../fingerprint";

const AOP_ORG_ID = 502;
const PAGE = `https://data.egov.bg/data?org%5B0%5D=${AOP_ORG_ID}&page=1`;

export const egovProcurement: WatchSource = {
  id: "egov_procurement",
  label: "data.egov.bg АОП (Агенция по обществени поръчки)",
  url: PAGE,
  cadence: "weekly",

  async fingerprint(): Promise<Fingerprint> {
    const html = await fetchText(PAGE);
    if (!html) throw new Error("empty АОП dataset listing");
    const uuids = Array.from(html.matchAll(/\/data\/view\/([0-9a-f-]{36})/gi))
      .map((m) => m[1])
      .filter((u, i, arr) => arr.indexOf(u) === i);
    if (uuids.length === 0) {
      throw new Error("АОП dataset listing yielded zero dataset UUIDs");
    }
    const value = sha256Short(uuids.join(","));
    return {
      value,
      detail: `${uuids.length} datasets on page 1, hash ${value}`,
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
    return `${newOnes.length} new fortnight bundle(s) on top: ${newOnes.slice(0, 3).join(", ")}`;
  },
};
