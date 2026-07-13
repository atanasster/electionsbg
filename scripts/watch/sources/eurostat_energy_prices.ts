// Household energy-price watcher (BG). Fingerprints the Eurostat dataset behind
// the /sector/energy "what you pay" tile — nrg_pc_204 (household electricity).
// Kept separate from eurostat.ts / eurostat_regional.ts so a household-price
// release is named on its own; prices publish bi-annually (Apr / Oct).

import type { WatchSource, Fingerprint } from "../types";
import { fetchJson } from "../fingerprint";

interface EurostatResponse {
  updated?: string;
  extension?: { updated?: string };
}

const DATASETS: { code: string; query: string }[] = [
  {
    code: "nrg_pc_204",
    query:
      "geo=BG&siec=E7000&nrg_cons=KWH2500-4999&unit=KWH&tax=I_TAX&currency=EUR",
  },
];

const buildUrl = (code: string, query: string): string =>
  `https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/${code}?${query}&format=JSON&lang=EN&lastTimePeriod=1`;

const fetchUpdated = async (code: string, query: string): Promise<string> => {
  const data = await fetchJson<EurostatResponse>(buildUrl(code, query));
  if (!data) throw new Error(`empty Eurostat response for ${code}`);
  const updated = data.updated ?? data.extension?.updated ?? "";
  if (!updated) throw new Error(`Eurostat ${code} missing updated field`);
  return updated;
};

export const eurostatEnergyPrices: WatchSource = {
  id: "eurostat_energy_prices",
  label: "Eurostat energy prices (BG): household electricity (nrg_pc_204)",
  url: "https://ec.europa.eu/eurostat/databrowser/view/nrg_pc_204/default/table",
  cadence: "monthly",

  async fingerprint(): Promise<Fingerprint> {
    const parts: string[] = [];
    for (const d of DATASETS) {
      const updated = await fetchUpdated(d.code, d.query);
      parts.push(`${d.code}:${updated}`);
    }
    return { value: parts.join("|"), detail: parts.join(" · ") };
  },
};
