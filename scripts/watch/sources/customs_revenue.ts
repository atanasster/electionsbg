// Митническа хроника watcher (customs.bg). Агенция "Митници" publishes its
// annual report ("Българските митници през <YYYY> г.") once a year in March
// of year T+1. The PDF carries the excise / import-VAT / customs-duties
// breakdown that feeds data/budget/revenue_breakdown/customs/<year>.json.
//
// Fingerprint = sha256(HEAD signatures across all curated
// MITNICHESKA_HRONIKA_REPORTS). Each signature is `${content-length}|
// ${last-modified}` for one report URL. A flip means customs.bg re-uploaded
// the PDF (correction) — re-run the customs ingest. Adding/removing rows
// from the catalogue naturally moves the fingerprint too, which is the
// signal the operator added a newly-published year.
//
// Cadence is weekly. Reports publish at most once a year (March of T+1) so
// weekly polling is overkill in quiet periods — but cheap (a few HEAD
// requests) and surfaces drift quickly when a year is added.

import { createHash } from "crypto";
import { Agent } from "undici";
import { MITNICHESKA_HRONIKA_REPORTS } from "../../budget/customs_revenue";
import type { WatchSource, Fingerprint, WatchState } from "../types";

const UA =
  "Mozilla/5.0 (compatible; electionsbg-budget-watch/1.0; " +
  "+https://electionsbg.com)";

// customs.bg's WebSphere portal rejects HEAD on these PDF endpoints (resets
// the connection) and may also ship an incomplete TLS chain. We use a
// 1-byte Range GET on a permissive agent — `bytes=0-0` returns HTTP 206 with
// the full Content-Length + ETag headers but transfers ~1 byte. The agent
// disables cert-chain verification because we're probing public PDF metadata
// (no secrets exchanged; content equality already comes from Content-Length +
// ETag, not transport security).
const tolerantAgent = new Agent({ connect: { rejectUnauthorized: false } });

const probe = async (url: string): Promise<string> => {
  try {
    const res = await fetch(encodeURI(url), {
      method: "GET",
      headers: { "User-Agent": UA, Accept: "*/*", Range: "bytes=0-0" },
      redirect: "follow",
      // @ts-expect-error undici-specific dispatcher option, not in lib.dom.d.ts
      dispatcher: tolerantAgent,
    });
    // 206 (partial content) is the expected success path; 200 also accepted
    // for servers that ignore the Range header.
    if (res.status !== 200 && res.status !== 206) {
      await res.arrayBuffer().catch(() => undefined);
      return `err:${res.status}`;
    }
    // Content-Range carries the full body size for 206 ("bytes 0-0/N");
    // for 200 we use Content-Length directly.
    const contentRange = res.headers.get("content-range");
    const fullLen =
      contentRange && /\/(\d+)$/.exec(contentRange)?.[1]
        ? /\/(\d+)$/.exec(contentRange)![1]
        : (res.headers.get("content-length") ?? "?");
    const etag = res.headers.get("etag") ?? "?";
    const mod = res.headers.get("last-modified") ?? "?";
    await res.arrayBuffer().catch(() => undefined);
    return `${fullLen}|${etag}|${mod}`;
  } catch (e) {
    return `err:${(e as Error).message.slice(0, 40)}`;
  }
};

export const customsRevenue: WatchSource = {
  id: "customs_revenue",
  label: 'Агенция "Митници" — Митническа хроника annual reports',
  url: "https://customs.bg/wps/portal/agency/media-center/customs-chronicle",
  cadence: "weekly",

  async fingerprint(): Promise<Fingerprint> {
    const years = Object.keys(MITNICHESKA_HRONIKA_REPORTS)
      .map((y) => parseInt(y, 10))
      .sort((a, b) => a - b);
    const signatures: Record<string, string> = {};
    for (const year of years) {
      signatures[String(year)] = await probe(MITNICHESKA_HRONIKA_REPORTS[year]);
    }
    const sortedKeys = Object.keys(signatures).sort();
    const value = createHash("sha256")
      .update(sortedKeys.map((k) => `${k}=${signatures[k]}`).join("|"))
      .digest("hex")
      .slice(0, 16);
    const latestYear = years[years.length - 1];
    return {
      value,
      detail: `${sortedKeys.length} report(s) tracked · latest ${latestYear} · hash ${value}`,
      meta: { signatures, latestYear },
    };
  },

  describe(prev: WatchState | null, curr: Fingerprint): string {
    if (!prev) return curr.detail;
    const prevSigs = (prev.meta?.signatures as Record<string, string>) ?? {};
    const currSigs = (curr.meta?.signatures as Record<string, string>) ?? {};
    const added = Object.keys(currSigs).filter((k) => !(k in prevSigs));
    const removed = Object.keys(prevSigs).filter((k) => !(k in currSigs));
    const changed: string[] = [];
    for (const [year, sig] of Object.entries(currSigs)) {
      if (prevSigs[year] != null && prevSigs[year] !== sig) {
        changed.push(year);
      }
    }
    if (added.length > 0) {
      return (
        `${added.length} new year(s) added: ${added.join(", ")}` +
        ` — run scripts/budget/run_customs_revenue.ts`
      );
    }
    if (changed.length > 0) {
      return (
        `${changed.length} report(s) re-uploaded: ${changed.join(", ")}` +
        ` — re-run scripts/budget/run_customs_revenue.ts --refresh`
      );
    }
    if (removed.length > 0) {
      return `${removed.length} year(s) removed from catalogue: ${removed.join(", ")}`;
    }
    return `${curr.detail} (signatures unchanged)`;
  },
};
