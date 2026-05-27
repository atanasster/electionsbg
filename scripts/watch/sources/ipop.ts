// МРРБ IPOP execution feed watcher.
//
// Tracks the public CSV export at ipop.mrrb.bg/reports_projects_export.php
// — a daily-refreshed dump of all municipal projects funded by МРРБ
// (Инвестиционна програма за общински проекти) with per-project paid /
// submitted / awaiting amounts.
//
// The CSV is updated whenever MRRB processes new payments or receives
// new disbursement requests, so this fingerprint is highly mutable —
// expect daily re-uploads. Cadence: daily.
//
// HEAD probes the URL (returns content-length + last-modified per the
// nginx in front of the PHP). On change, operator re-runs
// `tsx scripts/budget/ipop/ingest.ts`.

import { createHash } from "crypto";
import type { WatchSource, Fingerprint, WatchState } from "../types";

const UA =
  "Mozilla/5.0 (compatible; electionsbg-budget-watch/1.0; " +
  "+https://electionsbg.com)";

export const IPOP_CSV_URL = "https://ipop.mrrb.bg/reports_projects_export.php";

export const ipop: WatchSource = {
  id: "ipop_mrrb",
  label: "МРРБ — ИПОП (Инвестиционна програма за общински проекти) изпълнение",
  url: "https://ipop.mrrb.bg/",
  cadence: "daily",

  async fingerprint(): Promise<Fingerprint> {
    try {
      const res = await fetch(IPOP_CSV_URL, {
        method: "HEAD",
        headers: { "User-Agent": UA, Accept: "*/*" },
        redirect: "follow",
      });
      if (res.status !== 200) {
        const value = `status:${res.status}`;
        return { value, detail: `HEAD ${res.status} from ipop.mrrb.bg` };
      }
      const len = res.headers.get("content-length") ?? "?";
      const mod = res.headers.get("last-modified") ?? "?";
      const value = createHash("sha256")
        .update(`${len}|${mod}`)
        .digest("hex")
        .slice(0, 16);
      return {
        value,
        detail: `IPOP CSV ${len} bytes · ${mod} · hash ${value}`,
        meta: { contentLength: len, lastModified: mod },
      };
    } catch (e) {
      const msg = (e as Error).message.slice(0, 80);
      return { value: `err:${msg}`, detail: `fetch failed: ${msg}` };
    }
  },

  describe(prev: WatchState | null, curr: Fingerprint): string {
    if (!prev) return curr.detail;
    if (prev.lastFingerprint === curr.value)
      return `${curr.detail} (no change)`;
    return `IPOP CSV re-uploaded — re-run \`tsx scripts/budget/ipop/ingest.ts\``;
  },
};
