// НЗОК per-hospital monthly payments — nhif.bg/bg/hospitals/bmp/{year} lists
// THREE payment PDFs per month (newest first), one per money stream:
//
//   БМП  болнична медицинска помощ
//   ЛП   лекарствени продукти, прилагани в условията на БМП
//   МИ   медицински изделия, прилагани в БМП
//
// A hospital's НЗОК income is their sum (migration 050), so all three are
// ingested and all three must be watched. Fingerprinting only the БМП link — as
// this source originally did — meant a freshly published ЛП or МИ month never
// triggered a refresh, and the drugs/devices corpora would silently go stale
// behind an up-to-date БМП one.
//
// A flip on ANY stream = a new month's file landed → run update-nzok.

import { createHash } from "crypto";
import type { WatchSource, Fingerprint, WatchState } from "../types";
import {
  bmpPaymentLinks,
  drugsPaymentLinks,
  devicesPaymentLinks,
} from "../../nzok/lib/bmp_links";

const BASE = "https://www.nhif.bg";
const UA = "electionsbg.com data pipeline";

const STREAMS = [
  { key: "bmp", links: bmpPaymentLinks },
  { key: "drugs", links: drugsPaymentLinks },
  { key: "devices", links: devicesPaymentLinks },
] as const;

const fetchHtml = async (url: string): Promise<string> => {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
};

const monthOf = (link: string): string => {
  const m = decodeURIComponent(link).match(/(\d{1,2})\.(\d{4})/);
  return m ? `${m[2]}-${m[1].padStart(2, "0")}` : "?";
};

/** Newest link per stream. Resolve the newest year that actually carries a page:
 *  the current year's exists mid-cycle, but at a year boundary it may lag, so
 *  fall back one year. The БМП stream is the anchor — it is the one report
 *  published for every month, so a page without it is not yet usable. */
const resolveLatest = async (): Promise<{
  links: Record<string, string>;
  periods: Record<string, string>;
  year: number;
}> => {
  const now = new Date();
  for (const year of [now.getUTCFullYear(), now.getUTCFullYear() - 1]) {
    const html = await fetchHtml(`${BASE}/bg/hospitals/bmp/${year}`);
    const links: Record<string, string> = {};
    const periods: Record<string, string> = {};
    for (const { key, links: pick } of STREAMS) {
      const l = pick(html)[0];
      if (l) {
        links[key] = l;
        periods[key] = monthOf(l);
      }
    }
    if (links.bmp) return { links, periods, year };
  }
  throw new Error(
    "nzok_hospital_bmp: no БМП-payments PDF found; page layout may have changed",
  );
};

export const nzokHospitalBmp: WatchSource = {
  id: "nzok_hospital_bmp",
  label: "НЗОК болнични плащания по лечебни заведения — БМП/ЛП/МИ (nhif.bg)",
  url: `${BASE}/bg/hospitals/bmp`,
  cadence: "monthly",

  async fingerprint(): Promise<Fingerprint> {
    const { links, periods, year } = await resolveLatest();
    // Hash the three links together, in a fixed stream order, so any one of them
    // advancing flips the fingerprint.
    const value = createHash("sha256")
      .update(STREAMS.map(({ key }) => `${key}=${links[key] ?? ""}`).join("\n"))
      .digest("hex");
    const detail = STREAMS.map(
      ({ key }) => `${key} ${periods[key] ?? "—"}`,
    ).join(" · ");
    return {
      value,
      detail: `newest payments: ${detail}`,
      meta: { links, periods, year },
    };
  },

  describe(prev: WatchState | null, curr: Fingerprint): string {
    const periods = (curr.meta?.periods as Record<string, string>) ?? {};
    const fmt = (p: Record<string, string>) =>
      STREAMS.map(({ key }) => `${key} ${p[key] ?? "—"}`).join(" · ");
    if (!prev) return `first run · newest payments ${fmt(periods)}`;
    const prevPeriods = (prev.meta?.periods as Record<string, string>) ?? {};
    const moved = STREAMS.filter(
      ({ key }) => periods[key] !== prevPeriods[key],
    ).map(
      ({ key }) => `${key} ${prevPeriods[key] ?? "—"}→${periods[key] ?? "—"}`,
    );
    return `new НЗОК hospital-payment file(s): ${moved.join(", ") || fmt(periods)} — run update-nzok`;
  },
};
