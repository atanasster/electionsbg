// Eurostat environment (waste/recycling) watcher — fingerprints the `cei_wm011`
// (recycling rate of municipal waste) publication timestamp. Drives the
// /sector/environment „Рециклиране спрямо целта на ЕС" tile.
//
// Downstream: run `npx tsx scripts/environment/fetch_waste.ts` to re-fetch the
// recycling-rate + waste-per-capita series (cei_wm011 + env_wasmun) into
// data/environment/waste.json (a small committed file, no bucket sync in dev, no PG;
// `bucket:sync data/environment/` for prod). Annual release, so `monthly` cadence is
// plenty. (The GF05 EU-peer tile rides the existing `eurostat` gov_10a_exp watcher via
// scripts/macro/fetch_cofog.ts; the air half rides the `iaos_air_quality` watcher.)

import { createHash } from "crypto";
import type { WatchSource, Fingerprint, WatchState } from "../types";
import { fetchJson } from "../fingerprint";

interface EurostatResponse {
  updated?: string;
  extension?: { updated?: string };
}

const DATASET = "cei_wm011";
// Minimum-cardinality slice that still returns the dataset's `updated` metadata.
const URL = `https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/${DATASET}?geo=BG&wst_oper=RCY&unit=PC&format=JSON&lang=EN&lastTimePeriod=1`;

export const eurostatEnv: WatchSource = {
  id: "eurostat_env",
  label: "Eurostat environment (BG): рециклиране на отпадъци (cei_wm011)",
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
      return `Eurostat ${DATASET} republished (was ${prevU || "—"}) — run \`npx tsx scripts/environment/fetch_waste.ts\` to refresh the /sector/environment recycling-vs-target tile`;
    return curr.detail;
  },
};
