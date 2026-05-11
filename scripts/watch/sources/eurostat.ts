// Eurostat macro indicator metadata. We watch a single representative
// dataset (HICP — monthly inflation, code prc_hicp_manr) since the Eurostat
// release calendar tends to refresh related macro datasets together. The
// metadata endpoint returns a small JSON with `Updated` and `Extracted`
// timestamps.

import type { WatchSource, Fingerprint, WatchState } from "../types";
import { fetchJson } from "../fingerprint";

// JSON-stat for the HICP monthly-annual-rate dataset, filtered to BG and the
// single most recent period. We only need the `updated` field; the rest of
// the payload is incidental. `time=YYYYMmm` returns HTTP 400 if the value
// doesn't match a published period; `lastTimePeriod=1` always returns the
// freshest one without needing to track which month we're on.
const URL =
  "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/prc_hicp_manr?geo=BG&format=JSON&lang=EN&lastTimePeriod=1";

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
