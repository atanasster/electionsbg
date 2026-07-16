// Eurostat citizen digital-skills watcher — the isoc_sk_dskl_i21 dataset
// (Digital Skills Indicator 2.0, DESI human-capital pillar) behind the
// digital-skills band on /sector/administration. Fingerprints the dataset's
// `updated` metadata (geo-independent, so one BG query catches every release);
// when it flips, /update-administration re-fetches
// data/administration/digital_skills.json.
//
// Biennial cadence — Eurostat publishes this in odd years (2021/2023/2025), so
// polling faster is pointless; monthly is enough to notice the release promptly.

import { createHash } from "crypto";
import type { WatchSource, Fingerprint, WatchState } from "../types";
import { fetchJson } from "../fingerprint";

interface EurostatResponse {
  updated?: string;
  extension?: { updated?: string };
}

const URL =
  "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/" +
  "isoc_sk_dskl_i21?geo=BG&indic_is=I_DSK2_BAB&unit=PC_IND&ind_type=IND_TOTAL&freq=A" +
  "&format=JSON&lang=EN&lastTimePeriod=1";

export const eurostatDigitalSkills: WatchSource = {
  id: "eurostat_digital_skills",
  label: "Eurostat digital skills (isoc_sk_dskl_i21)",
  url: "https://ec.europa.eu/eurostat/databrowser/view/isoc_sk_dskl_i21/default/table",
  cadence: "monthly",

  async fingerprint(): Promise<Fingerprint> {
    const data = await fetchJson<EurostatResponse>(URL);
    const updated = data?.updated ?? data?.extension?.updated ?? "";
    if (!updated)
      throw new Error("Eurostat isoc_sk_dskl_i21 missing updated field");
    const value = createHash("sha256")
      .update(updated)
      .digest("hex")
      .slice(0, 16);
    return {
      value,
      detail: `isoc_sk_dskl_i21 updated ${updated}`,
      meta: { updated },
    };
  },

  describe(prev: WatchState | null, curr: Fingerprint): string {
    if (!prev) return curr.detail;
    return `Eurostat digital skills: new release (${curr.meta?.updated}) — run /update-administration to refresh digital_skills.json`;
  },
};
