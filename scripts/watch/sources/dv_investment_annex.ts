// State Budget Law — Investment Program for Municipal Projects watcher.
// Tracks the curated PDF annexes promulgated in Държавен вестник
// (Приложение № 3 към чл. 113 of ЗДБРБ 2025; similar Чл. 107 in 2024).
//
// dv.parliament.bg/DVPics/{YYYY}/{issue}/{file}.pdf — opaque URLs that
// change every year, so the catalogue is hand-curated in
// scripts/budget/investment_program/__write_program.ts (the SOURCES map).
// This watcher HEADs each known URL; a re-upload (size or mtime change)
// surfaces as `changed`. Adding a new year to the catalogue triggers
// `added`, prompting the operator to fetch the PDF into raw_data/ and
// re-run scripts/budget/investment_program/__write_program.ts.
//
// Cadence: weekly. The annex publishes once per fiscal year (March of T-1)
// — weekly probes are cheap enough that we don't bother throttling.

import { createHash } from "crypto";
import type { WatchSource, Fingerprint, WatchState } from "../types";

const UA =
  "Mozilla/5.0 (compatible; electionsbg-budget-watch/1.0; " +
  "+https://electionsbg.com)";

// Hand-curated list of annex URLs by fiscal year. Mirrors the SOURCES map
// in scripts/budget/investment_program/__write_program.ts — keep both in
// sync when adding a new year (the watcher detects re-uploads; the
// __write_program SOURCES map tells the ingest where to read from).
export const INVESTMENT_ANNEX_URLS: Record<number, string> = {
  2025: "https://dv.parliament.bg/DVPics/2025/26_25/1619.pdf",
};

const probe = async (url: string): Promise<string> => {
  try {
    const res = await fetch(url, {
      method: "HEAD",
      headers: { "User-Agent": UA, Accept: "*/*" },
      redirect: "follow",
    });
    if (res.status !== 200) return `status:${res.status}`;
    const len = res.headers.get("content-length") ?? "?";
    const mod = res.headers.get("last-modified") ?? "?";
    const etag = res.headers.get("etag") ?? "?";
    return `${len}|${mod}|${etag}`;
  } catch (e) {
    return `err:${(e as Error).message.slice(0, 40)}`;
  }
};

export const dvInvestmentAnnex: WatchSource = {
  id: "dv_investment_annex",
  label: "ДВ — Инвестиционна програма за общински проекти (Приложение III)",
  url: "https://dv.parliament.bg/",
  cadence: "weekly",

  async fingerprint(): Promise<Fingerprint> {
    const years = Object.keys(INVESTMENT_ANNEX_URLS)
      .map((y) => parseInt(y, 10))
      .sort((a, b) => a - b);
    const signatures: Record<string, string> = {};
    for (const year of years) {
      signatures[String(year)] = await probe(INVESTMENT_ANNEX_URLS[year]);
    }
    const sortedKeys = Object.keys(signatures).sort();
    const value = createHash("sha256")
      .update(sortedKeys.map((k) => `${k}=${signatures[k]}`).join("|"))
      .digest("hex")
      .slice(0, 16);
    const latest = years[years.length - 1];
    return {
      value,
      detail: `${years.length} annex(es) tracked · latest ${latest} · hash ${value}`,
      meta: { signatures, latestYear: latest },
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
      if (prevSigs[year] != null && prevSigs[year] !== sig) changed.push(year);
    }
    if (added.length > 0) {
      return (
        `${added.length} new annex year(s) added to catalogue: ${added.join(", ")}` +
        ` — fetch PDF to raw_data/budget/investment_program/, then run /update-budget`
      );
    }
    if (changed.length > 0) {
      return (
        `${changed.length} annex(es) re-uploaded: ${changed.join(", ")} ` +
        `— re-fetch and re-run /update-budget`
      );
    }
    if (removed.length > 0) {
      return `${removed.length} annex year(s) removed from catalogue: ${removed.join(", ")}`;
    }
    return `${curr.detail} (no change)`;
  },
};
