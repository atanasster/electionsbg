// НЗОК clinical-activity files — the monthly "Брой отчетени дейности по
// КП/АПр/КПр и брой ЗОЛ" reports listed at nhif.bg/bg/hospitalcare-report/
// activities/{year}. Each year carries 12 monthly XLSX (cases + insured persons
// per pathway per hospital).
//
// This is the case-mix corpus behind the health pack's activity tile + the
// pathway-internal cases-per-bed outlier. A flip = a new month landed → run
// update-nzok --activities, then reload migration 053.

import { createHash } from "crypto";
import type { WatchSource, Fingerprint, WatchState } from "../types";
import { BG_MONTHS } from "../../nzok/bg_months";

const BASE = "https://nhif.bg/bg/hospitalcare-report/activities";
const UA = "electionsbg.com data pipeline";

/** Newest (year, month) case-count file present across the current + previous
 *  calendar year. The href basenames are opaque /upload/NNNN/… paths, so the
 *  anchor caption ("… за <месец> <year> г.") is the key. */
const newestFile = async (): Promise<{
  year: number;
  month: number;
  href: string;
} | null> => {
  const nowY = new Date().getUTCFullYear();
  let best: { year: number; month: number; href: string } | null = null;
  for (const year of [nowY, nowY - 1]) {
    const res = await fetch(`${BASE}/${year}`, {
      headers: { "User-Agent": UA },
    });
    if (!res.ok) continue;
    const html = await res.text();
    const re = /<a[^>]*href="(\/upload\/[^"]*\.xlsx)"[^>]*>([\s\S]*?)<\/a>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html))) {
      const text = m[2]
        .replace(/<[^>]+>/g, "")
        .replace(/\s+/g, " ")
        .trim();
      if (!/Брой\s+отчетени\s+дейности|Брой\s+случаи/i.test(text)) continue;
      const mo = Object.keys(BG_MONTHS).find((mn) =>
        new RegExp(`за\\s+${mn}\\s+${year}`, "i").test(text),
      );
      if (!mo) continue;
      const month = BG_MONTHS[mo];
      if (!best || year * 100 + month > best.year * 100 + best.month)
        best = { year, month, href: m[1] };
    }
  }
  return best;
};

export const nzokActivities: WatchSource = {
  id: "nzok_activities",
  label: "НЗОК — брой случаи и ЗОЛ по клинични пътеки (месечно)",
  url: `${BASE}/${new Date().getUTCFullYear()}`,
  cadence: "monthly",

  async fingerprint(): Promise<Fingerprint> {
    const newest = await newestFile();
    if (!newest)
      throw new Error(
        "nzok_activities: no monthly activity file found; page layout may have changed",
      );
    const period = `${newest.year}-${String(newest.month).padStart(2, "0")}`;
    return {
      value: createHash("sha256").update(newest.href).digest("hex"),
      detail: `newest activity file: ${period}`,
      meta: { href: newest.href, period },
    };
  },

  describe(prev: WatchState | null, curr: Fingerprint): string {
    const period = (curr.meta?.period as string) ?? "?";
    if (!prev) return `first run · newest activity file ${period}`;
    const prevPeriod = (prev.meta?.period as string) ?? "?";
    return `new НЗОК activity file: ${period} (was ${prevPeriod}) — run update-nzok --activities`;
  },
};
