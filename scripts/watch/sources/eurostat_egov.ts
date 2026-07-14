// Eurostat e-government watcher — the isoc_ciegi_ac dataset ("e-government
// activities of individuals", indicator I_IUGOV1) behind the digital-government
// tile on /sector/administration. Fingerprints the dataset's `updated` metadata
// (geo-independent, so one BG query catches every release); when it flips,
// /update-administration re-fetches data/administration/egov.json.
//
// Separate from the `eurostat` macro watcher (which maps to /update-macro) so
// this release maps cleanly to /update-administration. Monthly cadence —
// Eurostat publishes this once a year, so anything faster is just polling.

import { createHash } from "crypto";
import type { WatchSource, Fingerprint, WatchState } from "../types";
import { fetchJson } from "../fingerprint";

interface EurostatResponse {
  updated?: string;
  extension?: { updated?: string };
}

const URL =
  "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/" +
  "isoc_ciegi_ac?geo=BG&indic_is=I_IUGOV1&unit=PC_IND&ind_type=IND_TOTAL&freq=A" +
  "&format=JSON&lang=EN&lastTimePeriod=1";

export const eurostatEgov: WatchSource = {
  id: "eurostat_egov",
  label: "Eurostat e-government (isoc_ciegi_ac)",
  url: "https://ec.europa.eu/eurostat/databrowser/view/isoc_ciegi_ac/default/table",
  cadence: "monthly",

  async fingerprint(): Promise<Fingerprint> {
    const data = await fetchJson<EurostatResponse>(URL);
    const updated = data?.updated ?? data?.extension?.updated ?? "";
    if (!updated)
      throw new Error("Eurostat isoc_ciegi_ac missing updated field");
    const value = createHash("sha256")
      .update(updated)
      .digest("hex")
      .slice(0, 16);
    return {
      value,
      detail: `isoc_ciegi_ac updated ${updated}`,
      meta: { updated },
    };
  },

  describe(prev: WatchState | null, curr: Fingerprint): string {
    if (!prev) return curr.detail;
    return `Eurostat e-gov: new release (${curr.meta?.updated}) — run /update-administration to refresh egov.json`;
  },
};
