// Bulgaria tourism watcher. Fingerprints the two Eurostat datasets behind the
// /sector/tourism visitor tiles — tour_occ_nim (monthly nights → seasonality)
// and tour_occ_ninraw (nights by country of origin → source markets). Kept
// separate from eurostat.ts so a tourism release is named on its own; tourism
// occupancy data publishes ~monthly. Regenerate the served blob with
// `npm run data:tourism` (scripts/tourism/fetch_eurostat_tourism.ts).

import type { WatchSource, Fingerprint } from "../types";
import { fetchJson } from "../fingerprint";

interface EurostatResponse {
  updated?: string;
  extension?: { updated?: string };
}

const DATASETS: { code: string; query: string }[] = [
  { code: "tour_occ_nim", query: "geo=BG&nace_r2=I551&c_resid=FOR&unit=NR" },
  { code: "tour_occ_ninraw", query: "geo=BG&nace_r2=I551&unit=NR" },
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

export const eurostatTourism: WatchSource = {
  id: "eurostat_tourism",
  label:
    "Eurostat tourism (BG): nights by month & country of origin (tour_occ_nim, tour_occ_ninraw)",
  url: "https://ec.europa.eu/eurostat/databrowser/view/tour_occ_nim/default/table",
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
