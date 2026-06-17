// ЦАИС ЕОП open-data feed (storage.eop.bg) — the daily buckets that drive the
// procurement gap-fill AND the buyer geo-enrichment in /update-procurement.
//
// This is a DIFFERENT upstream than `egov_procurement` (data.egov.bg АОП OCDS
// "обявления"). Each `open-data-YYYY-MM-DD/` bucket carries three files we use,
// all published together:
//   - flat "договори" — the contracts superset (gap-fills ~900 small buyers the
//     OCDS export omits; scripts/procurement/ingest_eop.ts);
//   - flat "поръчки" — tenders incl. `executionPlaceNuts` (buyer→oblast geo,
//     scripts/procurement/build_tender_oblast_map.ts);
//   - OCDS "обявления" — party addresses (buyer→settlement geo,
//     scripts/procurement/build_ocds_party_geo.ts).
// One fingerprint (the договори HEAD) is a valid freshness proxy for all three —
// they share the bucket + publication cadence. We watch it so the daily report
// flags fresh publication days, triggering the incremental ingest + geo refresh.
//
// There is no top-level bucket listing (the root ListBucket is 403), so we
// fingerprint by probing the most recent days directly: each day is its own
// bucket `open-data-YYYY-MM-DD/`, and HEAD on the договори object returns 200 +
// Content-Length on a published day (403/404 when the day isn't published — the
// feed is sparse: no weekend/holiday publications). Hashing the recent
// (day, length) set flips the fingerprint when a new day appears OR an existing
// day is republished with different content.

import type { WatchSource, Fingerprint, WatchState } from "../types";
import { sha256Short } from "../fingerprint";

const EOP_BASE = "https://storage.eop.bg";
// How many trailing days to probe. 12 comfortably spans a weekend + holiday gap
// so we always see the latest published day even after a quiet stretch.
const LOOKBACK_DAYS = 12;

const dogovoriUrl = (day: string): string => {
  const [y, m, d] = day.split("-");
  const key = `Автоматично генерирани данни за договори, публикувани в ЦАИС ЕОП на ${d}.${m}.${y}.json`;
  return `${EOP_BASE}/open-data-${day}/${encodeURIComponent(key)}`;
};

const recentDays = (n: number): string[] => {
  const out: string[] = [];
  const now = Date.now();
  for (let i = 0; i < n; i++) {
    out.push(new Date(now - i * 86_400_000).toISOString().slice(0, 10));
  }
  return out;
};

interface DayProbe {
  day: string;
  len: number;
}

// HEAD a single day's договори object. Returns its Content-Length when
// published (200), or null when not (403/404). Throws only on unexpected status
// so a real outage surfaces rather than reading as "nothing published".
const probeDay = async (day: string): Promise<DayProbe | null> => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20_000);
  try {
    const res = await fetch(dogovoriUrl(day), {
      method: "HEAD",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; electionsbg-watch/1.0; +https://electionsbg.com)",
      },
      signal: ctrl.signal,
    });
    if (res.status === 403 || res.status === 404) return null;
    if (!res.ok) throw new Error(`HEAD ${day} → ${res.status}`);
    const len = Number(res.headers.get("content-length") ?? "0");
    return { day, len };
  } finally {
    clearTimeout(timer);
  }
};

export const eopProcurement: WatchSource = {
  id: "eop_procurement",
  label:
    "ЦАИС ЕОП open data (storage.eop.bg — договори + поръчки + OCDS обявления)",
  url: EOP_BASE,
  cadence: "daily",

  async fingerprint(): Promise<Fingerprint> {
    const probes = (
      await Promise.all(recentDays(LOOKBACK_DAYS).map((d) => probeDay(d)))
    ).filter((p): p is DayProbe => p !== null);
    if (probes.length === 0) {
      throw new Error(
        `no published ЦАИС ЕОП day in the last ${LOOKBACK_DAYS} days`,
      );
    }
    probes.sort((a, b) => (a.day < b.day ? 1 : -1)); // newest first
    const latestDay = probes[0].day;
    const value = sha256Short(probes.map((p) => `${p.day}:${p.len}`).join(","));
    return {
      value,
      detail: `latest published day ${latestDay}; ${probes.length}/${LOOKBACK_DAYS} recent days published, hash ${value}`,
      meta: { latestDay, days: probes },
    };
  },

  describe(prev: WatchState | null, curr: Fingerprint): string {
    if (!prev) return curr.detail;
    const currDays = (curr.meta?.days as DayProbe[] | undefined) ?? [];
    const prevDays = (prev.meta?.days as DayProbe[] | undefined) ?? [];
    const prevByDay = new Map(prevDays.map((p) => [p.day, p.len]));
    const fresh = currDays.filter((p) => !prevByDay.has(p.day));
    const republished = currDays.filter(
      (p) => prevByDay.has(p.day) && prevByDay.get(p.day) !== p.len,
    );
    const parts: string[] = [];
    if (fresh.length)
      parts.push(
        `${fresh.length} new publication day(s) (latest ${(curr.meta?.latestDay as string) ?? "?"})`,
      );
    if (republished.length)
      parts.push(`${republished.length} republished day(s)`);
    if (parts.length === 0) return `${curr.detail} (no new days)`;
    return (
      parts.join("; ") +
      " — run the incremental EOP gap-fill + geo refresh in /update-procurement"
    );
  },
};
