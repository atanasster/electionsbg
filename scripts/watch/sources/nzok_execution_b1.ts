// НЗОК monthly B1 cash-execution report (fund 5600) — nhif.bg/bg/nzok/
// financial_report/quarter lists B1_{YYYY}_{MM}_5600.xls files (the "_33"
// sibling is a sub-account we ignore), newest first.
//
// We fingerprint the newest B1_*_5600.xls link. A flip = a new month's
// execution report landed → run update-nzok to rebuild
// data/budget/nzok/execution.json.

import { createHash } from "crypto";
import type { WatchSource, Fingerprint, WatchState } from "../types";

const PAGE_URL = "https://www.nhif.bg/bg/nzok/financial_report/quarter";
const UA = "electionsbg.com data pipeline";

export const nzokExecutionB1: WatchSource = {
  id: "nzok_execution_b1",
  label: "НЗОК касово изпълнение B1 (nhif.bg)",
  url: PAGE_URL,
  cadence: "monthly",

  async fingerprint(): Promise<Fingerprint> {
    const res = await fetch(PAGE_URL, { headers: { "User-Agent": UA } });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${PAGE_URL}`);
    const html = await res.text();
    // Plain fund-5600 monthly file (not the _33 sub-account). Newest first.
    const m = html.match(/\/upload\/[^"]*B1_(\d{4})_(\d{2})_5600\.xls/i);
    if (!m)
      throw new Error(
        "nzok_execution_b1: no B1_*_5600.xls link found; page layout may have changed",
      );
    const period = `${m[1]}-${m[2]}`;
    const value = createHash("sha256").update(m[0]).digest("hex");
    return {
      value,
      detail: `newest B1 execution: ${period}`,
      meta: { link: m[0], period },
    };
  },

  describe(prev: WatchState | null, curr: Fingerprint): string {
    const period = (curr.meta?.period as string) ?? "?";
    if (!prev) return `first run · newest B1 execution ${period}`;
    const prevPeriod = (prev.meta?.period as string) ?? "?";
    return `new НЗОК B1 execution report: ${period} (was ${prevPeriod}) — run update-nzok`;
  },
};
