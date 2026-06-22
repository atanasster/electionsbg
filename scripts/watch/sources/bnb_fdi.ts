// БНБ monthly FDI flows watcher.
//
// We fingerprint the same monthly FDI-by-investment-type export the
// `fetch_bnb_fdi.ts` ingest reads (an Excel-2003 SpreadsheetML file). A new
// reporting month advances the latest "YYYY-MM" period; БНБ also revises the
// prior couple of months with each release, so a full-content hash is the
// right sensitivity — any change at all means "re-ingest". Cadence: monthly
// (БНБ publishes ~the 17th–21st for the month two back).

import { createHash } from "crypto";
import type { WatchSource, Fingerprint, WatchState } from "../types";
import { fetchText } from "../fingerprint";

const SOURCE_PAGE =
  "https://www.bnb.bg/Statistics/StExternalSector/StDirectInvestments/StDIBulgaria/index.htm";
const DOWNLOAD_URL =
  `${SOURCE_PAGE}?FILTERSANDVALUES=FREQ=M;ACCOUNTING_ENTRY=NI;FLOW_STOCK_ENTRY=T;COUNTERPART_AREA=W1;UNIT_MEASURE=EUR;ACTIVITY_N=FDI_T` +
  `&download=true&pageId=544&series=670,1285,672,674,671&KEYFAMILY=FDI_BPM6&TRANSFORMATION=SDMX_TABLE`;

// Latest "YYYY-MM" period label present in the file.
const latestPeriod = (text: string): string | null => {
  const re = /\b(20\d{2})-(0[1-9]|1[0-2])\b/g;
  let m: RegExpExecArray | null;
  let max: string | null = null;
  while ((m = re.exec(text)) !== null) {
    if (max === null || m[0] > max) max = m[0];
  }
  return max;
};

export const bnbFdi: WatchSource = {
  id: "bnb_fdi",
  label: "BNB monthly FDI flows",
  url: SOURCE_PAGE,
  cadence: "monthly",

  async fingerprint(): Promise<Fingerprint> {
    const text = await fetchText(DOWNLOAD_URL);
    if (!text) throw new Error("БНБ FDI: empty download");
    const period = latestPeriod(text);
    const value = createHash("sha256").update(text).digest("hex");
    return {
      value,
      detail: period ? `latest ${period}` : "monthly FDI export",
      meta: { latestPeriod: period },
    };
  },

  describe(prev: WatchState | null, curr: Fingerprint): string {
    if (!prev) return curr.detail;
    const prevPeriod = prev.meta?.latestPeriod as string | undefined;
    const currPeriod = curr.meta?.latestPeriod as string | undefined;
    if (currPeriod && prevPeriod && currPeriod !== prevPeriod) {
      return `new month ${currPeriod} (was ${prevPeriod})`;
    }
    return `revised data · ${curr.detail}`;
  },
};
