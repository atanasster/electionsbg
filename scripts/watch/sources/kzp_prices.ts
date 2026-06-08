// КЗП "Колко струва" — euro-adoption retail-price open-data feed.
// kolkostruva.bg/opendata publishes one ZIP per day (all retail chains'
// individual selling prices for the 101-product consumer basket). The page
// lists the most recent ~14 days; the file for day D appears D+1 ~00:01.
//
// We fingerprint the newest advertised archive date. A flip = a fresh daily
// ZIP is available → run update-prices to ingest + rebuild data/prices/.

import { createHash } from "crypto";
import type { WatchSource, Fingerprint, WatchState } from "../types";

const PAGE_URL = "https://kolkostruva.bg/opendata";
const UA = "electionsbg.com data pipeline";

const fetchDates = async (): Promise<string[]> => {
  const res = await fetch(PAGE_URL, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${PAGE_URL}`);
  const html = await res.text();
  const dates = [
    ...html.matchAll(/opendata_files\/(\d{4}-\d{2}-\d{2})\.zip/g),
  ].map((m) => m[1]);
  return [...new Set(dates)].sort();
};

export const kzpPrices: WatchSource = {
  id: "kzp_prices",
  label: "КЗП Колко струва (retail prices, kolkostruva.bg)",
  url: PAGE_URL,
  cadence: "daily",

  async fingerprint(): Promise<Fingerprint> {
    const dates = await fetchDates();
    if (dates.length === 0)
      throw new Error(
        "kzp_prices: no opendata_files ZIP links found; portal layout may have changed",
      );
    const latest = dates[dates.length - 1];
    // Fingerprint the latest date — a new daily file flips it. The full list
    // is kept in meta so describe() can report exactly which day landed.
    const value = createHash("sha256").update(latest).digest("hex");
    return {
      value,
      detail: `latest ${latest} · ${dates.length} days advertised`,
      meta: { latest, dates },
    };
  },

  describe(prev: WatchState | null, curr: Fingerprint): string {
    const latest = (curr.meta?.latest as string) ?? "?";
    if (!prev) return `first run · latest ${latest}`;
    const prevLatest = (prev.meta?.latest as string) ?? "?";
    return `new daily price archive: ${latest} (was ${prevLatest})`;
  },
};
