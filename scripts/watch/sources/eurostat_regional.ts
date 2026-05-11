// Eurostat regional (NUTS 3) indicator watcher. Fingerprints the 3 NUTS3
// datasets rendered on /municipality/<oblast> and the demographics map.
// Kept separate from `eurostat.ts` so the watch report can name a regional
// release independently — the regional series publish on a slower cadence
// (annual, typically Feb–Mar) than the macro quarterly datasets.

import { createHash } from "crypto";
import type { WatchSource, Fingerprint, WatchState } from "../types";
import { fetchJson } from "../fingerprint";

interface EurostatResponse {
  updated?: string;
  extension?: { updated?: string };
}

// Datasets to fingerprint must match those fetched by
// scripts/regional/fetch_eurostat.ts. Each query is the minimum-cardinality
// slice that still returns the dataset's `updated` metadata — we only need
// the publication timestamp, not values.
const DATASETS: { code: string; query: string }[] = [
  { code: "nama_10r_3gdp", query: "geo=BG311&unit=EUR_HAB&freq=A" },
  { code: "nama_10r_3popgdp", query: "geo=BG311&unit=THS&freq=A" },
  { code: "demo_r_gind3", query: "geo=BG311&indic_de=CNMIGRATRT&freq=A" },
];

const buildUrl = (code: string, query: string): string =>
  `https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/${code}?${query}&format=JSON&lang=EN&lastTimePeriod=1`;

const fetchUpdated = async (code: string, query: string): Promise<string> => {
  const data = await fetchJson<EurostatResponse>(buildUrl(code, query));
  if (!data) throw new Error(`empty Eurostat response for ${code}`);
  const updated = data.updated ?? data.extension?.updated ?? "";
  if (!updated)
    throw new Error(`Eurostat ${code} response missing updated field`);
  return updated;
};

export const eurostatRegional: WatchSource = {
  id: "eurostat_regional",
  label: "Eurostat regional (BG): 3 NUTS3 datasets",
  url: "https://ec.europa.eu/eurostat/databrowser/view/nama_10r_3gdp/default/table",
  // Annual releases — daily is excessive but the existing infra runs all
  // sources together, so we accept the small extra cost. The fingerprint
  // is stable between releases so consecutive runs are no-ops.
  cadence: "monthly",

  async fingerprint(): Promise<Fingerprint> {
    const entries: Record<string, string> = {};
    for (const d of DATASETS) {
      entries[d.code] = await fetchUpdated(d.code, d.query);
    }
    const serialised = Object.keys(entries)
      .sort()
      .map((k) => `${k}:${entries[k]}`)
      .join("|");
    const value = createHash("sha256").update(serialised).digest("hex");
    const latest = Object.values(entries).sort().pop() ?? "";
    return {
      value,
      detail: `${DATASETS.length} datasets · latest update ${latest}`,
      meta: { datasets: entries, latest },
    };
  },

  describe(prev: WatchState | null, curr: Fingerprint): string {
    if (!prev) return curr.detail;
    const prevDatasets = (prev.meta?.datasets ?? {}) as Record<string, string>;
    const currDatasets = (curr.meta?.datasets ?? {}) as Record<string, string>;
    const changed: string[] = [];
    for (const code of Object.keys(currDatasets).sort()) {
      if (prevDatasets[code] !== currDatasets[code]) {
        changed.push(`${code} ${currDatasets[code]}`);
      }
    }
    if (changed.length === 0) return curr.detail;
    return `new release · ${changed.join(", ")}`;
  },
};
