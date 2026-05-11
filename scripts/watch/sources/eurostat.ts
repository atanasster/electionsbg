// Eurostat macro indicator metadata. We watch a single representative
// dataset (HICP — monthly inflation, code prc_hicp_manr) since the Eurostat
// release calendar tends to refresh related macro datasets together. The
// metadata endpoint returns a small JSON with `Updated` and `Extracted`
// timestamps.

import type { WatchSource, Fingerprint, WatchState } from "../types";
import { fetchJson } from "../fingerprint";

// JSON-stat metadata for the HICP monthly-annual-rate dataset. Filtered to
// BG to keep payload tiny — we only need the `updated` field.
const URL =
  "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/prc_hicp_manr?geo=BG&format=JSON&lang=EN&time=2026M04";

interface EurostatResponse {
  updated?: string;
  extension?: { updated?: string };
}

export const eurostat: WatchSource = {
  id: "eurostat",
  label: "Eurostat HICP (BG)",
  url: URL,
  cadence: "monthly",

  async fingerprint(): Promise<Fingerprint> {
    const data = await fetchJson<EurostatResponse>(URL);
    if (!data) throw new Error("empty Eurostat response");
    const updated = data.updated ?? data.extension?.updated ?? "";
    if (!updated) throw new Error("Eurostat response missing updated field");
    return {
      value: updated,
      detail: `last updated ${updated}`,
      meta: { updated },
    };
  },

  describe(prev: WatchState | null, curr: Fingerprint): string {
    if (!prev) return curr.detail;
    return `new release · ${curr.detail} (was ${prev.fingerprint})`;
  },
};
