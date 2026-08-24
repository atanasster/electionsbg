// МОН institution register (schools / kindergartens / ЦПЛР). Feeds TWO tiers of
// the awarder geo map, and the distinction between them is the whole reason this
// source's cadence is what it is.
//
// TIER R (indirect). The ЕИК→EKATTE crosswalk that geo-resolves school buyers is
// crawled from ri.mon.bg (Cloudflare-walled, headed Playwright — see
// scripts/procurement/mon_ri_crawl.ts + [[reference_mon_ri_register]]) and can't
// be fingerprinted directly. So we PROXY off the МОН OPEN-DATA register
// (data.egov.bg resource cac4d569), which IS reachable and lists the same
// institutions by НЕИСПУО code: when a school opens/closes/renames the set of
// НЕИСПУО codes shifts → re-crawl the crosswalk so new buyers resolve.
//
// TIER B (direct — and this is the part that is easy to miss). `fetchMonSchoolMap`
// in scripts/procurement/awarder_geo_map.ts calls `getResourceData` on the SAME
// resource id, through the same helper, on every build. So this fingerprint is not
// only a proxy for something else: it is the ONLY liveness probe for Tier B, and a
// 403 here means Tier B is down right now, not merely that the crosswalk may drift.
//
// That is not hypothetical. data.egov.bg 403'd this host from 2026-08-06 to
// 2026-08-22 and Tier B carried 92 placements forward unverified for 16 days. This
// source errored throughout — state froze at 2026-08-08 — and nobody connected the
// error to the geo map, because everything here named only mon_ri_crawl.
// See docs/plans/egov-tierb-block-v1.md.
//
// cadence: DAILY, and NOT for the reason the register changes — openings are rare
// and weekly was right for that. It is daily because of the Tier B role above: the
// ratchet in awarder_geo_overrides.test.ts only fires after MAX_UNAVAILABLE_DAYS,
// so without a fast probe an outage's first notice is that gate going red a
// fortnight later. One 2.2 MB POST/day, against an endpoint awarder_geo_map.ts
// already calls about that often — weighed deliberately, since this host's 403s
// look rate- or reputation-based rather than geographic, so the request rate is
// not free to raise without thinking about it.

import type { WatchSource, Fingerprint, WatchState } from "../types";
import { sha256Short } from "../fingerprint";
import { getResourceData } from "../../budget/lib/egov_api";

const MON_SCHOOL_RESOURCE = "cac4d569-529c-4209-b797-1cf5f69901f5";

interface MonMeta {
  institutions: number;
}

export const monRiRegister: WatchSource = {
  id: "mon_ri_register",
  // Names Tier B as well as the crawl, because on a 403 the daily report prints
  // this LABEL beside the error and nothing else — `describe()` never runs on the
  // error path (index.ts calls it only on the `changed` branch, inside the try).
  // A reader has to be able to tell from this one bullet that the awarder geo map
  // just lost a tier. Pinned by cadence.test.ts.
  label:
    "МОН регистър на институциите (Tier R crosswalk + Tier B на awarder geo)",
  url: "https://ri.mon.bg",
  cadence: "daily",
  // A register that changes when an institution opens or closes — genuinely
  // event-driven with no period to sample against, which is this field's own
  // canonical example. Not a way to silence the invariant: `daily` satisfies it
  // under every declaration except `daily` itself, so nothing is being dodged.
  publishes: "irregular",

  async fingerprint(): Promise<Fingerprint> {
    const rows = await getResourceData(MON_SCHOOL_RESOURCE);
    if (!rows.length) throw new Error("МОН register returned no rows");
    const header = rows[0].map((c) => String(c ?? ""));
    const idCol = header.findIndex((h) => /неиспуо/i.test(h));
    if (idCol < 0)
      throw new Error(
        `МОН register: no НЕИСПУО column in ${JSON.stringify(header).slice(0, 200)}`,
      );
    // Fingerprint the SET of НЕИСПУО codes — flips on any add/remove, not just a
    // row-count change (a swap of one closed + one opened would net to zero).
    const ids = rows
      .slice(1)
      .map((r) => String(r[idCol] ?? "").trim())
      .filter(Boolean)
      .sort();
    const meta: MonMeta = { institutions: ids.length };
    return {
      value: sha256Short(ids.join("|")),
      detail: `${ids.length} institutions`,
      meta: { ...meta },
    };
  },

  describe(prev: WatchState | null, curr: Fingerprint): string {
    if (!prev) return curr.detail;
    const p = (prev.meta ?? {}) as Partial<MonMeta>;
    const c = (curr.meta ?? {}) as Partial<MonMeta>;
    // "No prior count" is not "no change": with `?? 0` a state file carrying no
    // meta renders the whole register as today's additions — "4512 institutions
    // (+4512)". Inert today (the live state file has meta), reachable if one is
    // ever hand-written or migrated.
    if (p.institutions == null) return curr.detail;
    const d = (c.institutions ?? 0) - (p.institutions ?? 0);
    const delta =
      d > 0 ? ` (+${d})` : d < 0 ? ` (${d})` : ` (roster changed, net 0)`;
    // ⚠ Points at the runbook rather than quoting a command chain. An earlier
    // draft of this line ended `… && npm run procurement:ingest`, which is
    // ACTIVELY WRONG as a standalone instruction: a bare ingest re-runs base
    // normalization, which recomputes `amountEur = toEur(amount)` and drops the
    // post-annex current-value fold (~€1.75bn) — silently, at exit 0, with the
    // euro-peg canary still green because it checks `signingAmountEur ??
    // amountEur`. The full chain is five more steps; a watcher line cannot carry
    // it, and half-quoting it is worse than naming where it lives.
    return (
      `${curr.detail}${delta} — re-crawl the Tier R crosswalk: ` +
      `npx tsx scripts/procurement/mon_ri_crawl.ts (headed Playwright, ~1 min), ` +
      `then npx tsx scripts/procurement/awarder_geo_map.ts. Tier B reads this ` +
      `register directly. To reach by_settlement the map needs an ingest — run ` +
      `the FULL current-value chain from the update-procurement skill, never a ` +
      `bare procurement:ingest, which resets amountEur to the signing value`
    );
  },
};
