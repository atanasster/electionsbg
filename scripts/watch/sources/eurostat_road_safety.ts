// Eurostat road-safety watcher — fingerprints the `sdg_11_40` (Road traffic
// deaths) publication timestamp. Drives the /sector/security "Пътна безопасност"
// outcome tile (the spend-vs-outcome pairing with МВР vehicle procurement).
//
// Downstream: run `npx tsx scripts/security/fetch_road_safety.ts` to re-fetch the
// national road-death series into data/security/road_safety.json (a small committed
// file, no bucket sync). Annual release, so `monthly` cadence is plenty.

import { createHash } from "crypto";
import type { WatchSource, Fingerprint, WatchState } from "../types";
import { fetchJson } from "../fingerprint";

interface EurostatResponse {
  updated?: string;
  extension?: { updated?: string };
}

const DATASET = "sdg_11_40";
// Minimum-cardinality slice that still returns the dataset's `updated` metadata.
const URL = `https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/${DATASET}?geo=BG&unit=NR&tra_infr=TOTAL&format=JSON&lang=EN&lastTimePeriod=1`;

export const eurostatRoadSafety: WatchSource = {
  id: "eurostat_road_safety",
  label: "Eurostat road safety (BG): пътни жертви (sdg_11_40)",
  url: `https://ec.europa.eu/eurostat/databrowser/view/${DATASET}/default/table`,
  cadence: "monthly",

  async fingerprint(): Promise<Fingerprint> {
    const data = await fetchJson<EurostatResponse>(URL);
    if (!data) return { value: "missing", detail: "fetch failed" };
    const updated = data.updated ?? data.extension?.updated ?? "";
    if (!updated)
      return { value: "no-updated", detail: "response missing updated field" };
    const value = createHash("sha256").update(updated).digest("hex");
    return {
      value,
      detail: `${DATASET} · update ${updated}`,
      meta: { updated },
    };
  },

  describe(prev: WatchState | null, curr: Fingerprint): string {
    if (!prev) return curr.detail;
    const prevU = (prev.meta?.updated as string | undefined) ?? "";
    const currU = (curr.meta?.updated as string | undefined) ?? "";
    if (prevU !== currU)
      return `Eurostat ${DATASET} republished (was ${prevU || "—"}) — run \`npx tsx scripts/security/fetch_road_safety.ts\` to refresh the /sector/security road-safety tile`;
    return curr.detail;
  },
};
