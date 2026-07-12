// Re-aggregate the riverbed-maintenance corpus to a [from, to) scope window,
// client-side — so the /water flood tile (KPIs, oblast choropleth, top awarders,
// by-year, top contracts) honours the page's ?pscope like every other pack,
// instead of being frozen whole-corpus. Pure + deterministic (€ desc with a
// stable id tiebreak), mirroring the precomputed aggregates in
// scripts/water/write_flood_maintenance.ts.

import { scopeByWindow } from "@/data/procurement/useAwarderContracts";
import { NAPOITELNI_EIK } from "@/lib/vikReferenceData";
import type {
  FloodAwarder,
  FloodContract,
  FloodContractRow,
  FloodOblast,
  FloodYear,
} from "@/data/water/useFloodMaintenance";

export interface FloodModel {
  totalEur: number;
  contractCount: number;
  awarderCount: number;
  napoitelniEur: number;
  napoitelniCount: number;
  byYear: FloodYear[];
  byOblast: FloodOblast[];
  topAwarders: FloodAwarder[];
  topContracts: FloodContract[];
}

export const buildFloodModel = (
  rows: FloodContractRow[],
  from: string | null,
  to: string | null,
): FloodModel => {
  const scoped = scopeByWindow(rows, from, to);

  let totalEur = 0;
  let napoitelniEur = 0;
  let napoitelniCount = 0;
  const awarderSet = new Set<string>();
  const byYear = new Map<number, { eur: number; count: number }>();
  const byOblast = new Map<string, { eur: number; count: number }>();
  const byAwarder = new Map<
    string,
    { name: string; eur: number; count: number }
  >();

  for (const r of scoped) {
    totalEur += r.eur;
    awarderSet.add(r.awarderEik);
    if (r.awarderEik === NAPOITELNI_EIK) {
      napoitelniEur += r.eur;
      napoitelniCount += 1;
    }
    const yr = Number(r.date.slice(0, 4));
    if (Number.isInteger(yr) && yr >= 1900) {
      const y = byYear.get(yr) ?? { eur: 0, count: 0 };
      y.eur += r.eur;
      y.count += 1;
      byYear.set(yr, y);
    }
    if (r.oblast) {
      const o = byOblast.get(r.oblast) ?? { eur: 0, count: 0 };
      o.eur += r.eur;
      o.count += 1;
      byOblast.set(r.oblast, o);
    }
    const a = byAwarder.get(r.awarderEik) ?? {
      name: r.awarderName,
      eur: 0,
      count: 0,
    };
    a.eur += r.eur;
    a.count += 1;
    byAwarder.set(r.awarderEik, a);
  }

  const topAwarders: FloodAwarder[] = [...byAwarder.entries()]
    .map(([eik, v]) => ({ eik, name: v.name, eur: v.eur, count: v.count }))
    .sort((a, b) => b.eur - a.eur || a.eik.localeCompare(b.eik))
    .slice(0, 15);

  // Already € desc, key tiebreak from the source order — but re-sort defensively
  // (scopeByWindow preserves order, so top-N stays correct after filtering).
  const topContracts: FloodContract[] = scoped
    .slice()
    .sort((a, b) => b.eur - a.eur || a.key.localeCompare(b.key))
    .slice(0, 12)
    .map((r) => ({
      key: r.key,
      title: r.title,
      awarderEik: r.awarderEik,
      awarderName: r.awarderName,
      contractorEik: "",
      contractorName: "",
      eur: r.eur,
      date: r.date,
    }));

  return {
    totalEur,
    contractCount: scoped.length,
    awarderCount: awarderSet.size,
    napoitelniEur,
    napoitelniCount,
    byYear: [...byYear.entries()]
      .map(([year, v]) => ({ year, eur: v.eur, count: v.count }))
      .sort((a, b) => a.year - b.year),
    byOblast: [...byOblast.entries()]
      .map(([code, v]) => ({ code, eur: v.eur, count: v.count }))
      .sort((a, b) => b.eur - a.eur || a.code.localeCompare(b.code)),
    topAwarders,
    topContracts,
  };
};
