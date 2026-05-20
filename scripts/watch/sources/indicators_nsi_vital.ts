// НСИ — births + deaths + internal-migration timeseries per municipality.
// The three XLSX feed the `naturalIncrease` and `netMigration` indicators.
// Updated annually (usually late spring) with a new year appended. The
// population denominator is fingerprinted separately by indicators_nsi_pop.
// We hash all three files' content together — small, no auth.

import { createHash } from "crypto";
import type { WatchSource, Fingerprint, WatchState } from "../types";

const FILES = [
  "https://www.nsi.bg/sites/default/files/files/data/timeseries/Pop_1.2.1._birth_DR.xlsx",
  "https://www.nsi.bg/sites/default/files/files/data/timeseries/Pop_2.1._mortality_DR.xlsx",
  "https://www.nsi.bg/sites/default/files/files/data/timeseries/Pop_5.1_Migration_DR.xlsx",
];
const UA = "electionsbg.com data pipeline";

const fetchBuffer = async (url: string): Promise<Buffer> => {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok)
    throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  return Buffer.from(await res.arrayBuffer());
};

export const indicatorsNsiVital: WatchSource = {
  id: "indicators_nsi_vital",
  label: "НСИ: раждания, умирания и миграция по общини (timeseries XLSX)",
  url: FILES[0],
  cadence: "daily",

  async fingerprint(): Promise<Fingerprint> {
    const buffers = await Promise.all(FILES.map(fetchBuffer));
    const hash = createHash("sha256");
    let byteLength = 0;
    for (const buf of buffers) {
      hash.update(buf);
      byteLength += buf.length;
    }
    return {
      value: hash.digest("hex"),
      detail: `${byteLength} bytes`,
      meta: { byteLength },
    };
  },

  describe(prev: WatchState | null, curr: Fingerprint): string {
    if (!prev) return curr.detail;
    const prevLen = (prev.meta?.byteLength ?? 0) as number;
    const currLen = (curr.meta?.byteLength ?? 0) as number;
    if (prevLen === currLen) return curr.detail;
    const delta = currLen - prevLen;
    return `file size ${prevLen} → ${currLen} (${delta >= 0 ? "+" : ""}${delta})`;
  },
};
