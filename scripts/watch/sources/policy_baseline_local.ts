// Non-Eurostat inputs to the tax-policy simulator baseline
// (data/budget/derived/policy_baseline.json), watched separately from the
// Eurostat datasets (see eurostat_policy.ts):
//
//   НОИ STATB bulletin   quarterly pension-size distribution + at-minimum
//                        counts → the минимална-пенсия (pension floor) lever.
//                        Filename is STATB{Q}{YYYY}.xls; a NEW quarter is a
//                        NEW filename, so the curated NOI_STATB_URL constant
//                        in run_policy_baseline.ts must be bumped each quarter.
//                        We probe both the current file (re-upload) and the
//                        NEXT quarter's URL (publication = bump the constant).
//   NSI open-data id=612 annual average wage by NACE-A21 activity × ownership
//                        → the teachers' 125%-of-average-wage lever's wage
//                        anchor. Stable URL; JSON-stat `updated` flips on a
//                        new annual release.
//
// Both map to the update-budget policy-baseline sub-step. The Eurostat teacher
// HEADCOUNT (educ_uoe_perp01) lives in eurostat_policy.ts instead.

import { createHash } from "crypto";
import type { WatchSource, Fingerprint, WatchState } from "../types";
import { fetchJson } from "../fingerprint";

const UA =
  "Mozilla/5.0 (compatible; electionsbg-budget/1.0; +https://electionsbg.com)";

// Keep in lockstep with NOI_STATB_URL in scripts/budget/run_policy_baseline.ts.
const STATB_QUARTER = 1;
const STATB_YEAR = 2026;
const statbUrl = (q: number, y: number): string =>
  `https://nssi.bg/wp-content/uploads/STATB${q}${y}.xls`;
const nextQuarter = (q: number, y: number): { q: number; y: number } =>
  q >= 4 ? { q: 1, y: y + 1 } : { q: q + 1, y };

const NSI_WAGES_URL =
  "https://www.nsi.bg/opendata/getopendata_json.php?l=en&id=612";

// nssi.bg occasionally drops the TLS connection on a HEAD probe, especially
// for a not-yet-published file (302 → socket close), so retry once before
// recording an error.
const probe = async (url: string): Promise<string> => {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, {
        method: "HEAD",
        headers: { "User-Agent": UA, Accept: "*/*" },
        redirect: "manual",
      });
      if (res.status !== 200) return `status:${res.status}`;
      const len = res.headers.get("content-length") ?? "?";
      const mod = res.headers.get("last-modified") ?? "?";
      return `${len}|${mod}`;
    } catch (e) {
      if (attempt === 1) return `err:${(e as Error).message.slice(0, 40)}`;
    }
  }
  return "err:unreachable";
};

// A probe signature is a real, published file only when it carries a numeric
// content-length. `status:*` (redirect/404) and `err:*` (socket flake) both
// mean "not confirmed present" — never treat them as a new bulletin.
const isRealFile = (sig: string | undefined): boolean =>
  /^\d+\|/.test(sig ?? "");

export const policyBaselineLocal: WatchSource = {
  id: "policy_baseline_local",
  label: "НОИ STATB пенсии + НСИ заплати (policy-baseline)",
  url: "https://nssi.bg/publikacii/statistika/pensii-statistika/",
  cadence: "weekly",

  async fingerprint(): Promise<Fingerprint> {
    const nx = nextQuarter(STATB_QUARTER, STATB_YEAR);
    const statbCurrent = await probe(statbUrl(STATB_QUARTER, STATB_YEAR));
    const statbNext = await probe(statbUrl(nx.q, nx.y));
    const nsi = await fetchJson<{ updated?: string }>(NSI_WAGES_URL);
    const nsiUpdated = nsi?.updated ?? "unreachable";

    const parts = {
      statb_current: statbCurrent,
      statb_next: statbNext,
      nsi_wages: nsiUpdated,
    };
    const value = createHash("sha256")
      .update(
        Object.keys(parts)
          .sort()
          .map((k) => `${k}=${parts[k as keyof typeof parts]}`)
          .join("|"),
      )
      .digest("hex")
      .slice(0, 16);
    const nextOut = isRealFile(statbNext) ? "PUBLISHED" : "not yet";
    return {
      value,
      detail:
        `STATB${STATB_QUARTER}/${STATB_YEAR} current · next quarter ${nextOut} · ` +
        `НСИ wages updated ${nsiUpdated}`,
      meta: { ...parts },
    };
  },

  describe(prev: WatchState | null, curr: Fingerprint): string {
    if (!prev) return curr.detail;
    const p = (prev.meta ?? {}) as Record<string, string>;
    const c = (curr.meta ?? {}) as Record<string, string>;
    const msgs: string[] = [];
    if (!isRealFile(p.statb_next) && isRealFile(c.statb_next)) {
      const nx = nextQuarter(STATB_QUARTER, STATB_YEAR);
      msgs.push(
        `НОИ STATB${nx.q}/${nx.y} published — bump NOI_STATB_URL in run_policy_baseline.ts, then re-run`,
      );
    }
    if (p.statb_current !== c.statb_current)
      msgs.push("НОИ STATB current file re-uploaded");
    if (p.nsi_wages !== c.nsi_wages)
      msgs.push(`НСИ wages new release (${c.nsi_wages})`);
    if (msgs.length === 0) return curr.detail;
    return `${msgs.join("; ")} — refresh the policy baseline (run_policy_baseline.ts)`;
  },
};
