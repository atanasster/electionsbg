// Eurostat tour_occ_ninat — ANNUAL nights spent at tourist accommodation, Bulgaria. Since
// 2026-10-22 it feeds `annualNights` in data/tourism/visitors.json (the „Нощувки по години"
// tile on /sector/tourism), written by the same `npm run data:tourism` as the monthly
// series. It keeps its own watcher rather than joining eurostat_tourism.ts because it
// publishes once a year on its own calendar: a flip re-runs that one fetch.
//
// The fingerprint is the latest YEAR plus Bulgaria's VALUE for it. Eurostat's `updated` stamp is
// dataset-wide — any country's revision moves it — so it rides in the detail line only, or
// another country's revision would re-run the fetch for nothing. A new year, or a revision to
// Bulgaria's own figure, flips it.

import type { WatchSource, Fingerprint } from "../types";
import { fetchJson } from "../fingerprint";

export const NINAT_URL =
  "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/tour_occ_ninat" +
  "?geo=BG&nace_r2=I551-I553&unit=NR&c_resid=TOTAL&lastTimePeriod=1&format=JSON&lang=EN";

interface EurostatResponse {
  updated?: string;
  extension?: { updated?: string };
  dimension?: { time?: { category?: { index?: Record<string, number> } } };
  value?: Record<string, number>;
}

/** A response → its fingerprint. Throws on a response with no `updated` or no period: an
 *  error page parsed as JSON must never read as „unchanged". */
export const ninatFingerprint = (
  data: EurostatResponse | null,
): Fingerprint => {
  if (!data) throw new Error("empty Eurostat response for tour_occ_ninat");
  const updated = data.updated ?? data.extension?.updated ?? "";
  const periods = Object.keys(
    data.dimension?.time?.category?.index ?? {},
  ).sort();
  const latest = periods.at(-1) ?? "";
  if (!updated)
    throw new Error("Eurostat tour_occ_ninat missing updated field");
  if (!/^\d{4}$/.test(latest))
    throw new Error(
      `Eurostat tour_occ_ninat: no annual period (${JSON.stringify(periods)})`,
    );
  // The query pins every other dimension, so the one cell is Bulgaria's total for that year.
  const bg = data.value?.["0"];
  if (typeof bg !== "number")
    throw new Error("Eurostat tour_occ_ninat: no BG value for the latest year");
  return {
    value: `tour_occ_ninat:${latest}:${bg}`,
    detail: `latest year ${latest} · BG ${bg.toLocaleString("en")} nights · updated ${updated}`,
  };
};

export const eurostatTourismAnnual: WatchSource = {
  id: "eurostat_tourism_annual",
  label: "Eurostat tourism (BG): annual nights spent (tour_occ_ninat)",
  url: "https://ec.europa.eu/eurostat/databrowser/view/tour_occ_ninat/default/table",
  // Annual series, revised in the autumn (2025 landed 2026-10-12); monthly probing is ample.
  cadence: "monthly",
  publishes: "annual",
  async fingerprint(): Promise<Fingerprint> {
    return ninatFingerprint(await fetchJson<EurostatResponse>(NINAT_URL));
  },
};
