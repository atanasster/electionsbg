// КЗК procurement-appeals register (reg.cpc.bg, "Жалби по ЗОП"). The Комисия
// за защита на конкуренцията publishes every procurement complaint with its
// УНП — we join those onto the tender corpus (kzk_appeals table). This watcher
// tells the orchestrator when new complaints have landed so the (manual,
// headed-Playwright) ingest should re-run.
//
// Fingerprint = the current-year "Намерени са общо N жалби" total + a hash of
// the newest complaint numbers on page 1. It flips when a new complaint is
// filed. Cadence weekly — complaints land ~daily but the ingest is heavy
// (headed browser) and appeals move slowly enough that weekly is ample.
//
// NOTE: reg.cpc.bg is geo-gated (403 from non-BG egress) — the watcher must run
// from a Bulgarian connection, same as the CIK local-elections source. The
// re-ingest itself is MANUAL (see the process-watch-report mapping): run
// `npx tsx scripts/procurement/kzk_appeals.ts --year <YYYY> --apply` (a desktop
// browser window pops up). Full-history backfill stays behind `--backfill`.

import type { WatchSource, Fingerprint, WatchState } from "../types";
import { fetchText, sha256Short } from "../fingerprint";
// Share the register URL + UA with the scraper (single source of truth — see
// DUP note there). The scraper is import-safe (main-guarded).
import {
  LIST_URL as PAGE,
  UA as BROWSER_UA,
} from "../../procurement/kzk_appeals";

// "Намерени са общо 668 жалби по ЗОП за 2026 година." → 668
const extractTotal = (html: string): number | null => {
  const m = html.match(/Намерени са общо\s+([\d\s]+)\s+жалб[аи]/);
  if (!m) return null;
  const n = parseInt(m[1].replace(/\s+/g, ""), 10);
  return Number.isFinite(n) ? n : null;
};

// Newest complaint IDs on page 1, keyed on the Complaint.aspx?ID= anchor hrefs
// — the same thing the scraper keys on, so the fingerprint survives a КЗК change
// to the ВХР- number format (which would silently degrade a prefix-regex to
// total-only). The pager is newest-first, so these are the change signal.
const extractTopComplaints = (html: string): string[] =>
  Array.from(html.matchAll(/Complaint\.aspx\?ID=(\d+)/gi))
    .map((m) => m[1])
    .slice(0, 10);

export const kzkAppeals: WatchSource = {
  id: "kzk_appeals",
  label: "КЗК procurement-appeals register (жалби по ЗОП)",
  url: PAGE,
  cadence: "weekly",

  async fingerprint(): Promise<Fingerprint> {
    const html = await fetchText(PAGE, {
      headers: { "User-Agent": BROWSER_UA, "Accept-Language": "bg-BG,bg" },
    });
    if (!html)
      throw new Error("empty КЗК complaints page (BG egress required)");
    const total = extractTotal(html);
    const top = extractTopComplaints(html);
    if (total == null && top.length === 0) {
      throw new Error("КЗК complaints page markup not recognised");
    }
    const value = sha256Short(`${total ?? "?"}|${top.join(",")}`);
    return {
      value,
      detail: `${total ?? "?"} complaints this year, newest ${top[0] ?? "—"} (hash ${value})`,
      meta: { total: total ?? null, newest: top[0] ?? null },
    };
  },

  describe(prev: WatchState | null, curr: Fingerprint): string {
    if (!prev) return curr.detail;
    const p = (prev.meta?.total as number | undefined) ?? null;
    const cnow = (curr.meta?.total as number | undefined) ?? null;
    if (p != null && cnow != null && cnow !== p) {
      return `${cnow - p > 0 ? "+" : ""}${cnow - p} КЗК complaints (${p} → ${cnow}); newest ${curr.meta?.newest ?? "—"}`;
    }
    return `КЗК complaints changed; newest ${curr.meta?.newest ?? "—"}`;
  },
};
