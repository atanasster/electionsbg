// МОН institution register (schools / kindergartens / ЦПЛР). The ЕИК→EKATTE
// crosswalk that geo-resolves school/kindergarten procurement buyers is crawled
// from ri.mon.bg (Cloudflare-walled, headed Playwright — see
// scripts/procurement/mon_ri_crawl.ts + [[reference_mon_ri_register]]) and can't
// be fingerprinted directly. So we proxy off the МОН OPEN-DATA register
// (data.egov.bg resource cac4d569), which IS reachable and lists the same
// institutions by НЕИСПУО code: when a school opens/closes/renames the set of
// НЕИСПУО codes shifts → re-crawl the crosswalk (mon_ri_crawl) so new buyers
// resolve. EIK↔EKATTE is otherwise very stable, so this fires rarely.
// cadence: weekly — the register changes at the pace of school openings.

import type { WatchSource, Fingerprint, WatchState } from "../types";
import { sha256Short } from "../fingerprint";
import { getResourceData } from "../../budget/lib/egov_api";

const MON_SCHOOL_RESOURCE = "cac4d569-529c-4209-b797-1cf5f69901f5";

interface MonMeta {
  institutions: number;
}

export const monRiRegister: WatchSource = {
  id: "mon_ri_register",
  label: "МОН регистър на институциите (schools/kindergartens)",
  url: "https://ri.mon.bg",
  cadence: "weekly",

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
    const d = (c.institutions ?? 0) - (p.institutions ?? 0);
    const delta =
      d > 0 ? ` (+${d})` : d < 0 ? ` (${d})` : ` (roster changed, net 0)`;
    return `${curr.detail}${delta} — re-crawl mon_ri_crawl to refresh the ЕИК→EKATTE crosswalk`;
  },
};
