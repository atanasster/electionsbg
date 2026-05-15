// BNB domestic government securities (ДЦК) auction archive watcher.
//
// We fingerprint the set of auction-page links on the year index for the
// current calendar year (and the previous one when we're in the early
// boundary weeks of January). A new auction shows up as a new link; a
// re-run / correction would also flip the fingerprint. The downstream
// `fetch_bnb_auctions.ts` re-scrapes the whole archive when invoked, so
// even an upstream correction to an older auction is picked up.
//
// Cadence: weekly. BNB holds ~1–2 auctions per month and publishes results
// within hours of each event; a 7-day check window catches them without
// hammering bnb.bg.

import { createHash } from "crypto";
import type { WatchSource, Fingerprint, WatchState } from "../types";
import { fetchText } from "../fingerprint";

const BASE =
  "https://www.bnb.bg/FiscalAgent/FAGSAuctions/FAAuctionResults/index.htm";

const indexUrl = (year: number): string => `${BASE}?forYear=${year}`;

// Extract auction-page IDs (FA_AR_YYYYMMDD_*) from a year-index HTML page.
// BNB renders the links bare (`href="FA_AR_..."`) without a leading slash, so
// we match on the bare token rather than requiring a path separator.
const parseAuctionIds = (html: string): string[] => {
  const ids = new Set<string>();
  const re = /href="[^"]*?(FA_AR_[0-9_A-Z]+_BG)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) ids.add(m[1]);
  return [...ids].sort();
};

// "FA_AR_20260511_A1_BG" → "2026-05-11"
const idToDate = (id: string): string | null => {
  const m = /^FA_AR_(\d{4})(\d{2})(\d{2})/.exec(id);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
};

export const bnbAuctions: WatchSource = {
  id: "bnb_auctions",
  label: "BNB domestic ДЦК auctions",
  url: BASE,
  cadence: "weekly",

  async fingerprint(): Promise<Fingerprint> {
    // Cover the current calendar year + the previous one. The overlap
    // window catches auctions held in late December that the index for
    // the new year wouldn't show.
    const now = new Date();
    const thisYear = now.getUTCFullYear();
    const years = [thisYear - 1, thisYear];

    const allIds: string[] = [];
    for (const y of years) {
      const html = await fetchText(indexUrl(y));
      if (!html) continue;
      allIds.push(...parseAuctionIds(html));
    }
    const sorted = [...new Set(allIds)].sort();

    const value = createHash("sha256").update(sorted.join("|")).digest("hex");
    const latestId = sorted[sorted.length - 1];
    const latestDate = latestId ? idToDate(latestId) : null;
    const detail = `${sorted.length} auction(s) in ${years[0]}-${years[1]}${
      latestDate ? ` · latest ${latestDate}` : ""
    }`;
    return {
      value,
      detail,
      meta: { ids: sorted, latestDate, count: sorted.length },
    };
  },

  describe(prev: WatchState | null, curr: Fingerprint): string {
    if (!prev) return curr.detail;
    const prevIds = (prev.meta?.ids as string[] | undefined) ?? [];
    const currIds = (curr.meta?.ids as string[] | undefined) ?? [];
    const prevSet = new Set(prevIds);
    const added = currIds.filter((id) => !prevSet.has(id));
    if (added.length === 0) return curr.detail;
    const dates = added
      .map(idToDate)
      .filter((d): d is string => d !== null)
      .slice(-5);
    return `${added.length} new auction(s) since ${prev.lastChanged.slice(
      0,
      10,
    )} (latest: ${dates.join(", ")})`;
  },
};
