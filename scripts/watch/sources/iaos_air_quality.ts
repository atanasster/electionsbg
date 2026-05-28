// ИАОС air-quality watcher (data.egov.bg).
//
// ИАОС publishes quarterly per-pollutant CSVs on the data.egov.bg portal.
// The PM10 + PM2.5 dataset pages list resources tagged with the quarter
// they cover. We fingerprint the set of resource UUIDs on both dataset
// pages — when a new quarter lands, ИАОС adds a new resource and the
// fingerprint flips.
//
// Downstream `update-air-quality` (scripts/air/build_index.ts) re-reads
// the latest resource per pollutant, refreshes the per-município station
// index, and ships it. Cadence: weekly — quarterly publication, but a
// week's check window catches mid-quarter corrections (which do happen).

import { createHash } from "crypto";
import type { WatchSource, Fingerprint } from "../types";
import { fetchText } from "../fingerprint";

// PM10 dataset page lists the rotating quarterly resources for PM10.
// ИАОС publishes all pollutants on the same quarterly cadence — when a
// new PM10 quarter lands, PM2.5 / NO2 / CO drop alongside it — so PM10
// is enough as the canonical signal. The build script in
// scripts/air/build_index.ts independently locates the per-pollutant
// resource UUIDs at run-time.
const DATASETS = {
  pm10: "https://data.egov.bg/data/view/e3cccc25-6127-4b46-bc12-71ce068b35fe",
};

const RESOURCE_RE =
  /<a\s+href="(?:https?:\/\/data\.egov\.bg)?\/data\/resourceView\/([a-f0-9-]{36})"/g;

const extractResourceIds = (html: string): string[] => {
  const ids = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = RESOURCE_RE.exec(html)) !== null) ids.add(m[1]);
  return [...ids].sort();
};

export const iaosAirQuality: WatchSource = {
  id: "iaos_air_quality",
  label: "ИАОС air quality (data.egov.bg)",
  url: DATASETS.pm10,
  cadence: "weekly",

  async fingerprint(): Promise<Fingerprint> {
    const all: { pollutant: string; ids: string[] }[] = [];
    for (const [pollutant, url] of Object.entries(DATASETS)) {
      const html = await fetchText(url);
      if (!html) continue;
      all.push({ pollutant, ids: extractResourceIds(html) });
    }
    const joined = all
      .map((a) => `${a.pollutant}=${a.ids.join(",")}`)
      .join("|");
    const value = createHash("sha256").update(joined).digest("hex");
    const totalResources = all.reduce((s, a) => s + a.ids.length, 0);
    const detail = all
      .map((a) => `${a.pollutant.toUpperCase()} ${a.ids.length} res`)
      .join(" · ");
    return {
      value,
      detail: `${totalResources} total resources · ${detail}`,
      meta: { perPollutant: all },
    };
  },
};
