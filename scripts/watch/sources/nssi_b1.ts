// NOI (Национален осигурителен институт) monthly B1 cash-execution watcher.
//
// nssi.bg publishes per-fund B1 files at the predictable URL
//   https://www.nssi.bg/wp-content/uploads/B1_{YYYY}_{MM}_{FUND}.xls
// where FUND is one of 5500 (ДОО — main fund), 5591 (Учителски пенсионен
// фонд) or 5592 (Гарантирани вземания на работниците и служителите). Files
// roll out monthly; year-end ("_12_") is the full-year cumulative report.
//
// The fingerprint covers the most recent two fiscal years × all 3 funds ×
// month 12 — the bare minimum to surface a yearly drop or a corrected
// re-upload of the prior year. A flip means the operator should manually
// download the new B1 files into raw_data/budget/noi/ and re-run
// scripts/budget/noi/__write_funds.ts, then stamp `update-noi`.
//
// HEAD-only probing: nssi.bg returns 200 on HEAD even when GET redirects
// (302) to the homepage. The size+modified signature is enough to detect
// re-uploads without transferring the 1.5-1.8 MB body.

import { createHash } from "crypto";
import type { WatchSource, Fingerprint, WatchState } from "../types";

const UA =
  "Mozilla/5.0 (compatible; electionsbg-budget-watch/1.0; " +
  "+https://electionsbg.com)";

const FUNDS = ["5500", "5591", "5592"] as const;
// Years to track: the previous and current fiscal year, full-year files
// (month 12). Older years are static — adding them to the watch fingerprint
// would just bloat state/watch/nssi_b1.json without surfacing real change.
const trackedYears = (): number[] => {
  const cy = new Date().getUTCFullYear();
  return [cy - 1, cy];
};

const probe = async (url: string): Promise<string> => {
  try {
    const res = await fetch(url, {
      method: "HEAD",
      headers: { "User-Agent": UA, Accept: "*/*" },
      redirect: "manual",
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

export const nssiB1: WatchSource = {
  id: "nssi_b1",
  label: "НОИ — месечни B1 отчети по фондове (ДОО, УчПФ, ГВРС)",
  url: "https://www.nssi.bg/budjet-i-finansi/otkrito-upravlenie/otcheti-i-balansi/",
  cadence: "weekly",

  async fingerprint(): Promise<Fingerprint> {
    const years = trackedYears();
    const signatures: Record<string, string> = {};
    for (const year of years) {
      for (const fund of FUNDS) {
        const key = `${year}-12-${fund}`;
        const url = `https://www.nssi.bg/wp-content/uploads/B1_${year}_12_${fund}.xls`;
        signatures[key] = await probe(url);
      }
    }
    const sortedKeys = Object.keys(signatures).sort();
    const value = createHash("sha256")
      .update(sortedKeys.map((k) => `${k}=${signatures[k]}`).join("|"))
      .digest("hex")
      .slice(0, 16);
    const reachable = sortedKeys.filter(
      (k) =>
        !signatures[k].startsWith("status:") &&
        !signatures[k].startsWith("err:"),
    );
    return {
      value,
      detail:
        `${reachable.length}/${sortedKeys.length} B1 file(s) reachable ` +
        `· tracking ${years.join(", ")} × ${FUNDS.length} funds · hash ${value}`,
      meta: { signatures, years },
    };
  },

  describe(prev: WatchState | null, curr: Fingerprint): string {
    if (!prev) return curr.detail;
    const prevSigs = (prev.meta?.signatures as Record<string, string>) ?? {};
    const currSigs = (curr.meta?.signatures as Record<string, string>) ?? {};
    const added: string[] = [];
    const removed: string[] = [];
    const changed: string[] = [];
    for (const k of Object.keys(currSigs)) {
      if (!(k in prevSigs)) {
        if (
          !currSigs[k].startsWith("status:") &&
          !currSigs[k].startsWith("err:")
        ) {
          added.push(k);
        }
        continue;
      }
      if (
        prevSigs[k] !== currSigs[k] &&
        !currSigs[k].startsWith("status:") &&
        !currSigs[k].startsWith("err:")
      ) {
        changed.push(k);
      }
    }
    for (const k of Object.keys(prevSigs)) {
      if (!(k in currSigs)) removed.push(k);
    }
    if (added.length > 0) {
      return (
        `${added.length} new B1 file(s): ${added.join(", ")} — manually ` +
        `download to raw_data/budget/noi/, then run /update-noi`
      );
    }
    if (changed.length > 0) {
      return (
        `${changed.length} B1 file(s) re-uploaded: ${changed.join(", ")} ` +
        `— re-download and re-run /update-noi`
      );
    }
    if (removed.length > 0) {
      return `${removed.length} previously-tracked file(s) no longer reachable: ${removed.join(", ")}`;
    }
    return `${curr.detail} (no change)`;
  },
};
