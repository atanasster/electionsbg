// Per-ministry program-budget execution reports — each first-level spending
// unit publishes its own "Отчет за изпълнението на програмния бюджет" on its
// own site. The minfin.bg consolidated report WAF-blocks automated clients,
// so these per-ministry reports are the viable source for ministry-grain
// executed-vs-amended numbers (the budget pillar's main user-facing data).
//
// Fingerprint = sha256(HEAD signatures across all curated EXECUTION_REPORTS).
// Each signature is `${content-length}|${last-modified}` for one ministry's
// URL. When ANY ministry publishes a new version of its report, the
// fingerprint flips and `/update-budget` should re-ingest.
//
// `format: "manual-pdf"` entries (WAF-blocked ministries like МВР/МФ) are
// excluded — they're operator-fetched out of band, so a watcher can't probe
// them. Adding/removing rows from EXECUTION_REPORTS naturally moves the
// fingerprint too, which is what we want: a curation change is a publication
// change from the pipeline's perspective.
//
// Cadence is weekly. Ministries publish at most a few times a year (full-year
// + semi-annual + sometimes quarterly), so weekly polling is overkill in
// quiet periods — but cheap (7 HEAD requests) and surfaces drift quickly.

import { createHash } from "crypto";
import { EXECUTION_REPORTS } from "../../budget/fetch_sources";
import type { WatchSource, Fingerprint, WatchState } from "../types";

const UA =
  "Mozilla/5.0 (compatible; electionsbg-budget-watch/1.0; " +
  "+https://electionsbg.com)";

// HEAD-probe one URL. Returns `${content-length}|${last-modified}` on 2xx,
// `err:<status>` on a non-2xx response, or `err:<message>` on a network
// failure. Per-URL failures are absorbed into the fingerprint as-is so a
// single ministry going temporarily down doesn't fail the whole watcher run.
const probe = async (url: string): Promise<string> => {
  try {
    const res = await fetch(encodeURI(url), {
      method: "HEAD",
      headers: { "User-Agent": UA, Accept: "*/*" },
      redirect: "follow",
    });
    if (!res.ok) return `err:${res.status}`;
    const len = res.headers.get("content-length") ?? "?";
    const mod = res.headers.get("last-modified") ?? "?";
    return `${len}|${mod}`;
  } catch (e) {
    return `err:${(e as Error).message.slice(0, 40)}`;
  }
};

export const ministryExecutionReports: WatchSource = {
  id: "ministry_execution_reports",
  label: "Per-ministry execution reports (програмен бюджет)",
  url: "various — see scripts/budget/fetch_sources.ts:EXECUTION_REPORTS",
  cadence: "weekly",

  async fingerprint(): Promise<Fingerprint> {
    const fetchable = EXECUTION_REPORTS.filter(
      (r) => r.format !== "manual-pdf",
    );
    const signatures: Record<string, string> = {};
    for (const r of fetchable) {
      const key = `${r.adminId}-${r.fiscalYear}`;
      signatures[key] = await probe(r.url);
    }
    // Sort keys for stable hash regardless of EXECUTION_REPORTS order.
    const sortedKeys = Object.keys(signatures).sort();
    const value = createHash("sha256")
      .update(sortedKeys.map((k) => `${k}=${signatures[k]}`).join("|"))
      .digest("hex")
      .slice(0, 16);
    return {
      value,
      detail: `${sortedKeys.length} report(s), hash ${value}`,
      meta: { signatures },
    };
  },

  describe(prev: WatchState | null, curr: Fingerprint): string {
    if (!prev) return curr.detail;
    const prevSigs = (prev.meta?.signatures as Record<string, string>) ?? {};
    const currSigs = (curr.meta?.signatures as Record<string, string>) ?? {};
    const changed: string[] = [];
    for (const [id, sig] of Object.entries(currSigs)) {
      if (prevSigs[id] !== sig) changed.push(id);
    }
    if (changed.length === 0) return `${curr.detail} (signatures unchanged)`;
    const head = changed
      .slice(0, 3)
      .map((id) => id.replace(/^admin-ministerstvoto-na-/, ""))
      .join(", ");
    return (
      `${changed.length} report(s) updated: ${head}` +
      `${changed.length > 3 ? "…" : ""} — run /update-budget`
    );
  },
};
