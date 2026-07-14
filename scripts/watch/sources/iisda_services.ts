// Административен регистър (ИИСДА) services-register watcher. Fingerprints the
// per-tier total counts of administrative services (the `totalCount` the
// register renders server-side on each /adm_services/services/from_* page). When
// a tier's total moves — a service added, merged or retired — the fingerprint
// flips and /update-administration re-scrapes the catalogue + reloads the
// admin_services PG table.
//
// Weekly cadence — the register changes slowly.

import { createHash } from "crypto";
import type { WatchSource, Fingerprint, WatchState } from "../types";

const BASE = "https://iisda.government.bg/adm_services/services";
const UA =
  "Mozilla/5.0 (compatible; electionsbg-watch/1.0; +https://electionsbg.com)";

const TIERS = [
  "from_central_administrations",
  "from_special_territorial_administrations",
  "from_regional_administrations",
  "from_municipality_administrations",
] as const;

const fetchTotal = async (tier: string): Promise<number> => {
  const res = await fetch(`${BASE}/${tier}`, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${tier}`);
  const html = await res.text();
  const m = html.match(/id="totalCount"[^>]*>(\d+)/);
  return m ? Number(m[1]) : 0;
};

export const iisdaServices: WatchSource = {
  id: "iisda_services",
  label: "Административен регистър — услуги (IISDA)",
  url: `${BASE}/from_all_administrations`,
  cadence: "weekly",

  async fingerprint(): Promise<Fingerprint> {
    const counts: Record<string, number> = {};
    for (const tier of TIERS) counts[tier] = await fetchTotal(tier);
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    const serialised = Object.keys(counts)
      .sort()
      .map((k) => `${k}=${counts[k]}`)
      .join("|");
    const value = createHash("sha256")
      .update(serialised)
      .digest("hex")
      .slice(0, 16);
    return {
      value,
      detail: `${total} services across ${TIERS.length} tiers, hash ${value}`,
      meta: { counts, total },
    };
  },

  describe(prev: WatchState | null, curr: Fingerprint): string {
    if (!prev) return curr.detail;
    const prevTotal = (prev.meta?.total as number) ?? 0;
    const currTotal = (curr.meta?.total as number) ?? 0;
    const delta = currTotal - prevTotal;
    return (
      `Услуги: ${currTotal} total (${delta >= 0 ? "+" : ""}${delta}) — ` +
      `run /update-administration to re-scrape the catalogue + reload admin_services`
    );
  },
};
