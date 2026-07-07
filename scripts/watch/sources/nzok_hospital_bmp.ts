// НЗОК per-hospital БМП (болнична медицинска помощ) monthly payments —
// nhif.bg/bg/hospitals/bmp/{year} lists one "Заплатени здравноосигурителни
// плащания за БМП по лечебни заведения" PDF per month (newest first), alongside
// the МИ / лекарствени-продукти siblings we ignore.
//
// We fingerprint the newest БМП-payments upload link. A flip = a new month's
// file landed → run update-nzok to rebuild data/budget/nzok/hospital_payments.json.

import { createHash } from "crypto";
import type { WatchSource, Fingerprint, WatchState } from "../types";

const BASE = "https://www.nhif.bg";
const UA = "electionsbg.com data pipeline";

const fetchHtml = async (url: string): Promise<string> => {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
};

/** Newest "здравноосигурителни плащания за БМП" PDF href on a bmp/{year} page
 *  (the page lists newest-first). Excludes the МИ / лекарствени-продукти
 *  siblings. Returns null when none found. */
const newestBmpLink = (html: string): string | null => {
  for (const m of html.matchAll(/href="(\/upload\/[^"]+\.pdf)"/gi)) {
    const decoded = decodeURIComponent(m[1]);
    if (
      /здравноосигурителни\s+плащания\s+за\s+БМП/i.test(decoded) &&
      !/МИ\b|лек[_\s]?прод|изделия/i.test(decoded)
    )
      return m[1];
  }
  return null;
};

/** Resolve the newest year that actually carries a БМП page. The current year's
 *  page exists mid-cycle; at a year boundary the new year may lag, so fall back
 *  one year. */
const resolveLatest = async (): Promise<{ link: string; year: number }> => {
  const now = new Date();
  for (const year of [now.getUTCFullYear(), now.getUTCFullYear() - 1]) {
    const html = await fetchHtml(`${BASE}/bg/hospitals/bmp/${year}`);
    const link = newestBmpLink(html);
    if (link) return { link, year };
  }
  throw new Error(
    "nzok_hospital_bmp: no БМП-payments PDF found; page layout may have changed",
  );
};

const monthOf = (link: string): string => {
  const m = decodeURIComponent(link).match(/(\d{1,2})\.(\d{4})/);
  return m ? `${m[2]}-${m[1].padStart(2, "0")}` : "?";
};

export const nzokHospitalBmp: WatchSource = {
  id: "nzok_hospital_bmp",
  label: "НЗОК болнични плащания по лечебни заведения (nhif.bg)",
  url: `${BASE}/bg/hospitals/bmp`,
  cadence: "monthly",

  async fingerprint(): Promise<Fingerprint> {
    const { link, year } = await resolveLatest();
    const value = createHash("sha256").update(link).digest("hex");
    const period = monthOf(link);
    return {
      value,
      detail: `newest БМП payments: ${period}`,
      meta: { link, year, period },
    };
  },

  describe(prev: WatchState | null, curr: Fingerprint): string {
    const period = (curr.meta?.period as string) ?? "?";
    if (!prev) return `first run · newest БМП payments ${period}`;
    const prevPeriod = (prev.meta?.period as string) ?? "?";
    return `new НЗОК hospital-payments file: ${period} (was ${prevPeriod}) — run update-nzok`;
  },
};
