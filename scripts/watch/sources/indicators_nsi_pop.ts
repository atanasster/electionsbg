// НСИ — annual population timeseries per municipality. The source file is
// updated annually (usually late spring) with a new yearly sheet appended.
// We fingerprint the file's content directly — small (~350 KB), no auth.

import { createHash } from "crypto";
import type { WatchSource, Fingerprint, WatchState } from "../types";

const FILE_URL =
  "https://www.nsi.bg/sites/default/files/files/data/timeseries/Pop_6.1.1_Pop_DR.xlsx";
const UA = "electionsbg.com data pipeline";

const fetchBuffer = async (url: string): Promise<Buffer> => {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok)
    throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  return Buffer.from(await res.arrayBuffer());
};

export const indicatorsNsiPop: WatchSource = {
  id: "indicators_nsi_pop",
  label: "НСИ: население по общини (timeseries XLSX)",
  url: FILE_URL,
  cadence: "daily",

  async fingerprint(): Promise<Fingerprint> {
    const buf = await fetchBuffer(FILE_URL);
    const value = createHash("sha256").update(buf).digest("hex");
    return {
      value,
      detail: `${buf.length} bytes`,
      meta: { byteLength: buf.length },
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
