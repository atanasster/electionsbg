// КФН (Financial Supervision Commission) private-pension statistics watcher —
// the quarterly ZIP that drives the /pensions "private funds" tile (pillars 2 & 3
// net assets + insured per fund).
//
// Unlike the НОИ files, the КФН ZIP has an UNPREDICTABLE URL — an upload
// year/month subdirectory plus a varying "-1"/"-2" suffix, e.g.
//   https://www.fsc.bg/wp-content/uploads/2025/08/statistics_2025_q2-1.zip
// and the ZIP links live on per-year sub-pages, not the landing page. So we
// GET the statistics index and fingerprint the set of year sub-page links it
// lists (…/statistics/YYYY-N/); a new year/quarter sub-page appearing flips the
// watcher. On a flip, download the ZIP from the newest sub-page into
// raw_data/budget/kfn/ and run scripts/budget/kfn/__write_funds.ts.

import { createHash } from "crypto";
import type { WatchSource, Fingerprint, WatchState } from "../types";

const UA =
  "Mozilla/5.0 (compatible; electionsbg-budget-watch/1.0; " +
  "+https://electionsbg.com)";

const INDEX_URL = "https://www.fsc.bg/en/social-insurance-activity/statistics/";

/** Pull the distinct per-year statistics sub-page paths (…/statistics/YYYY-N/)
 *  from the index HTML — a new year/quarter sub-page appearing is the signal. */
const extractYearPages = (html: string): string[] => {
  const links = new Set<string>();
  const re = /\/social-insurance-activity\/statistics\/(20\d{2}-\d)\/?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) links.add(m[1]);
  return [...links].sort();
};

export const kfnPensions: WatchSource = {
  id: "kfn_pensions",
  label: "КФН — частни пенсионни фондове (тримесечни данни)",
  url: INDEX_URL,
  cadence: "weekly",

  async fingerprint(): Promise<Fingerprint> {
    let pages: string[] = [];
    let error: string | null = null;
    try {
      const res = await fetch(INDEX_URL, {
        headers: { "User-Agent": UA, Accept: "text/html" },
      });
      if (!res.ok) {
        error = `status:${res.status}`;
      } else {
        pages = extractYearPages(await res.text());
      }
    } catch (e) {
      error = `err:${(e as Error).message.slice(0, 40)}`;
    }
    const value = createHash("sha256")
      .update(error ?? pages.join("|"))
      .digest("hex")
      .slice(0, 16);
    return {
      value,
      detail: error
        ? `КФН statistics page unreachable (${error}) · hash ${value}`
        : `${pages.length} КФН statistics period(s) listed ` +
          `(${pages.join(", ")}) · hash ${value}`,
      meta: { pages, error },
    };
  },

  describe(prev: WatchState | null, curr: Fingerprint): string {
    if (!prev) return curr.detail;
    const prevPages = new Set((prev.meta?.pages as string[]) ?? []);
    const currPages = (curr.meta?.pages as string[]) ?? [];
    const added = currPages.filter((p) => !prevPages.has(p));
    if (added.length > 0)
      return (
        `${added.length} new КФН statistics period(s): ${added.join(", ")} ` +
        `— download the ZIP from that sub-page into raw_data/budget/kfn/ and ` +
        `run tsx scripts/budget/kfn/__write_funds.ts`
      );
    return `${curr.detail} (no change)`;
  },
};
