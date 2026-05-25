// НАП "Годишен отчет за дейността" watcher (nra.bg). The Bulgarian National
// Revenue Agency publishes its annual report once a year (early March of
// year T+1, approved by Council of Ministers). The PDF contains:
//   – Table 3: declared VAT by КИД-2008 sector → data/budget/revenue_breakdown/vat/
//   – Tables 8/10 + narrative: PIT by income type → data/budget/revenue_breakdown/pit/
//   – Table 9: employment-PIT by КИД-2008 sector
//
// Fingerprint = sha256(HEAD signatures across all curated NAP_ANNUAL_REPORTS).
// Each signature is `${content-length}|${last-modified}` for one report URL.
// A flip means nra.bg re-uploaded the PDF — re-run the ingest. Adding rows
// to the catalogue (new year published) naturally moves the fingerprint too.
//
// Cadence is weekly. Reports publish at most once a year (March of T+1).

import { createHash } from "crypto";
import { Agent } from "undici";
import { NAP_ANNUAL_REPORTS } from "../../budget/nap_annual";
import type { WatchSource, Fingerprint, WatchState } from "../types";

const UA =
  "Mozilla/5.0 (compatible; electionsbg-budget-watch/1.0; " +
  "+https://electionsbg.com)";

// nra.bg ships an incomplete TLS chain on its WebSphere portal; node's
// default fetch refuses with UNABLE_TO_VERIFY_LEAF_SIGNATURE. We use a
// tolerant undici agent that disables chain verification — acceptable for
// probing public PDF metadata (no secrets, and we already verify content
// equality via Content-Length + ETag rather than the transport).
// Also use a 1-byte Range GET because the server is unreliable on HEAD.
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
    if (res.status !== 200 && res.status !== 206) {
      await res.arrayBuffer().catch(() => undefined);
      return `err:${res.status}`;
    }
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

export const napAnnual: WatchSource = {
  id: "nap_annual",
  label: "НАП — Годишен отчет за дейността",
  url: "https://nra.bg/wps/portal/nra/za-nap/osnovni-dokumenti/Godishni-otcheti-za-deynostta-na-NAP",
  cadence: "weekly",

  async fingerprint(): Promise<Fingerprint> {
    const years = Object.keys(NAP_ANNUAL_REPORTS)
      .map((y) => parseInt(y, 10))
      .sort((a, b) => a - b);
    const signatures: Record<string, string> = {};
    for (const year of years) {
      signatures[String(year)] = await probe(NAP_ANNUAL_REPORTS[year]);
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
        ` — run scripts/budget/run_nap_annual.ts`
      );
    }
    if (changed.length > 0) {
      return (
        `${changed.length} report(s) re-uploaded: ${changed.join(", ")}` +
        ` — re-run scripts/budget/run_nap_annual.ts --refresh`
      );
    }
    if (removed.length > 0) {
      return `${removed.length} year(s) removed from catalogue: ${removed.join(", ")}`;
    }
    return `${curr.detail} (signatures unchanged)`;
  },
};
