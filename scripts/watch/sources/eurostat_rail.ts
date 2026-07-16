// Eurostat rail-ridership watcher — fingerprints the `rail_pa_total` (rail passengers
// transported) publication timestamp. Drives the /sector/transport rail subsidy-
// dependency tile: rail ridership is the denominator of "state subsidy per passenger".
//
// Downstream: run `npx tsx scripts/transport/fetch_rail_ridership.ts` to re-fetch the
// national rail passengers + passenger-km series into data/transport/rail_ridership.json
// (a small committed file, no bucket sync, no PG). Annual release, so `monthly` cadence
// is plenty. (The subsidy half of that tile rides the `budget_law` watcher → run
// scripts/transport/parse_rail_subsidy.ts; the COFOG GF04.5 EU-peer tile rides the
// existing `eurostat` gov_10a_exp watcher via scripts/macro/fetch_cofog.ts.)

import { createHash } from "crypto";
import type { WatchSource, Fingerprint, WatchState } from "../types";
import { fetchJson } from "../fingerprint";

interface EurostatResponse {
  updated?: string;
  extension?: { updated?: string };
}

const DATASET = "rail_pa_total";
// Minimum-cardinality slice that still returns the dataset's `updated` metadata.
const URL = `https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/${DATASET}?geo=BG&unit=THS_PAS&format=JSON&lang=EN&lastTimePeriod=1`;

export const eurostatRail: WatchSource = {
  id: "eurostat_rail",
  label: "Eurostat rail (BG): жп пътници (rail_pa_total)",
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
      return `Eurostat ${DATASET} republished (was ${prevU || "—"}) — run \`npx tsx scripts/transport/fetch_rail_ridership.ts\` to refresh the /sector/transport rail subsidy-per-passenger tile`;
    return curr.detail;
  },
};
