// Food price-level watcher (BG). Fingerprints the Eurostat dataset behind the
// /consumption/eu "food vs the EU" tile — prc_ppp_ind_1 (price level indices,
// EU27=100), the foodPli block written into data/macro_peers.json by
// scripts/macro/fetch_food_pli.ts. Kept separate from eurostat.ts /
// eurostat_policy.ts so a PLI release is named on its own; PPP price levels
// publish annually (typically June).

import type { WatchSource, Fingerprint } from "../types";
import { fetchJson } from "../fingerprint";

interface EurostatResponse {
  updated?: string;
  extension?: { updated?: string };
}

// Any valid single-cell slice carries the dataset-level `updated` timestamp.
const URL_ =
  "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/prc_ppp_ind_1" +
  "?indic_ppp=PLI_EU27_2020&geo=BG&ppp_cat18=A010101&format=JSON&lang=EN&lastTimePeriod=1";

export const eurostatFoodPli: WatchSource = {
  id: "eurostat_food_pli",
  label:
    "Eurostat food price levels (BG): PPP price level indices (prc_ppp_ind_1)",
  url: "https://ec.europa.eu/eurostat/databrowser/product/view/prc_ppp_ind_1",
  cadence: "monthly",

  async fingerprint(): Promise<Fingerprint> {
    const data = await fetchJson<EurostatResponse>(URL_);
    if (!data) throw new Error("empty Eurostat response for prc_ppp_ind_1");
    const updated = data.updated ?? data.extension?.updated ?? "";
    if (!updated)
      throw new Error("Eurostat prc_ppp_ind_1 missing updated field");
    return {
      value: `prc_ppp_ind_1:${updated}`,
      detail: `PLI updated ${updated}`,
    };
  },
};
