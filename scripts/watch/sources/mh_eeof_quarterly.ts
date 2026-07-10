// МЗ "Финансови показатели на лечебни заведения за болнична помощ" — one XLSX per
// quarter, published under Наредба № 5 от 17 юни 2019 г. on the ministry's
// financial-standards page. Derived from the ЕЕОФ returns hospitals file.
//
// This is the only public source for a hospital's revenue, expense, total and
// OVERDUE liabilities, beds, occupancy, length of stay and cost per patient — the
// whole layer BELOW the НЗОК payment line. A flip = a new quarter landed → run
// update-nzok --eeof, then reload migration 051.
//
// The page also links the blank ЕЕОФ TEMPLATES ("ЕЕОФ …", "eeof_…") and the
// Наредба PDF; those are excluded so a template re-upload can't fingerprint as
// new data.

import { createHash } from "crypto";
import type { WatchSource, Fingerprint, WatchState } from "../types";

const URL =
  "https://www.mh.government.bg/bg/politiki/standart-za-finansovo-upravlenie-na-drzhavnite-lechebni-zavedeni/";
const UA = "electionsbg.com data pipeline";

/** Quarterly indicator workbooks, newest first by (year, quarter). */
const indicatorLinks = (
  html: string,
): { href: string; year: number; quarter: number }[] => {
  const ROMAN: Record<string, number> = { I: 1, II: 2, III: 3, IV: 4 };
  const out: { href: string; year: number; quarter: number }[] = [];
  for (const m of html.matchAll(
    /<a[^>]+href="([^"]+\.xlsx?)"[^>]*>([\s\S]*?)<\/a>/gi,
  )) {
    const href = m[1];
    const text = decodeURIComponent(m[2].replace(/<[^>]+>/g, "")).trim();
    if (!/Финансови\s+показатели/i.test(text)) continue;
    const q = text.match(/\b(IV|III|II|I)\s*-?\s*(?:то|ро|во)?\s*тримесечие/i);
    const y = text.match(/(20\d{2})\s*г/);
    if (!q || !y) continue;
    out.push({ href, year: Number(y[1]), quarter: ROMAN[q[1].toUpperCase()] });
  }
  return out.sort(
    (a, b) => b.year * 10 + b.quarter - (a.year * 10 + a.quarter),
  );
};

export const mhEeofQuarterly: WatchSource = {
  id: "mh_eeof_quarterly",
  label: "МЗ финансови показатели на болниците (ЕЕОФ, тримесечно)",
  url: URL,
  // `Cadence` has no "quarterly" member; monthly is the closest supported poll
  // rate and the fingerprint only flips when a new quarter is actually published.
  cadence: "monthly",

  async fingerprint(): Promise<Fingerprint> {
    const res = await fetch(URL, { headers: { "User-Agent": UA } });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${URL}`);
    const links = indicatorLinks(await res.text());
    if (!links.length)
      throw new Error(
        "mh_eeof_quarterly: no quarterly indicator workbook found; page layout may have changed",
      );
    const newest = links[0];
    const period = `${newest.year}-Q${newest.quarter}`;
    return {
      value: createHash("sha256").update(newest.href).digest("hex"),
      detail: `newest quarter: ${period} (${links.length} quarters listed)`,
      meta: { href: newest.href, period, count: links.length },
    };
  },

  describe(prev: WatchState | null, curr: Fingerprint): string {
    const period = (curr.meta?.period as string) ?? "?";
    if (!prev) return `first run · newest ЕЕОФ quarter ${period}`;
    const prevPeriod = (prev.meta?.period as string) ?? "?";
    return `new МЗ hospital-financials quarter: ${period} (was ${prevPeriod}) — run update-nzok --eeof`;
  },
};
