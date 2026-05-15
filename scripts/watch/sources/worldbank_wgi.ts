// World Bank Worldwide Governance Indicators — Bulgaria.
//
// WGI publishes all six indicators on the same annual schedule (~September).
// We fingerprint against Rule of Law (the canary) because it's the WGI series
// most prominently surfaced on /indicators, and the rest move together.
//
// Cadence "monthly" — annual upstream but the JSON API is cheap; checking
// roughly once a month guarantees we notice within ~30 days of the release.

import type { WatchSource, Fingerprint, WatchState } from "../types";
import { fetchJson } from "../fingerprint";

const INDICATOR = "GOV_WGI_RL.EST";
const URL = `https://api.worldbank.org/v2/country/BGR/indicator/${INDICATOR}?format=json&per_page=200&date=2005:2030&source=3`;

interface WbPoint {
  date: string;
  value: number | null;
}

const round3 = (n: number): string => (Math.round(n * 1000) / 1000).toFixed(3);

export const worldbankWgi: WatchSource = {
  id: "worldbank_wgi",
  label: "World Bank WGI (Bulgaria, Rule of Law canary)",
  url: URL,
  cadence: "monthly",

  async fingerprint(): Promise<Fingerprint> {
    const json = await fetchJson<[unknown, WbPoint[] | null]>(URL);
    const pts = (json?.[1] ?? []).filter(
      (p): p is { date: string; value: number } => typeof p.value === "number",
    );
    if (pts.length === 0) {
      throw new Error("WB API returned no usable WGI points");
    }
    pts.sort((a, b) => Number(a.date) - Number(b.date));
    const latest = pts[pts.length - 1];
    const latestVal = round3(latest.value);
    return {
      value: `${latest.date}:${latestVal}`,
      detail: `${pts.length} year(s) · latest ${latest.date} = ${latestVal} (Rule of Law)`,
      meta: {
        latestYear: Number(latest.date),
        latestValue: latest.value,
        count: pts.length,
      },
    };
  },

  describe(prev: WatchState | null, curr: Fingerprint): string {
    if (!prev) return curr.detail;
    if (prev.fingerprint === curr.value) return curr.detail;
    return `${curr.detail} — was ${prev.detail}`;
  },
};
