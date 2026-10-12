// Re-aggregate the riverbed-maintenance corpus to a [from, to) scope window,
// client-side — so the /water flood tile (KPIs, oblast choropleth, top awarders,
// by-year, top contracts) honours the page's ?pscope like every other pack,
// instead of being frozen whole-corpus. Pure + deterministic (€ desc with a
// stable id tiebreak), mirroring the precomputed aggregates in
// scripts/water/write_flood_maintenance.ts — EXCEPT `byOblast`, which here
// deliberately leaves out the national-scope awarders (W3) while the file's
// precomputed copy (read by nothing) still includes them.

import { scopeByWindow } from "@/data/procurement/useAwarderContracts";
import { NAPOITELNI_EIK, USYA_EIK } from "@/lib/vikReferenceData";
import type {
  FloodAwarder,
  FloodContract,
  FloodContractRow,
  FloodOblast,
  FloodYear,
} from "@/data/water/useFloodMaintenance";

/** Riverbed awarders whose works are NATIONAL in scope, so their HQ seat (all
 *  Sofia) is not where the money went (docs/plans/water-hub-v1.md W3 / D2). On
 *  the 2026-10-12 corpus they put €124M of Sofia's €153M choropleth figure there
 *  (81%), €103M of it Напоителни системи alone. They stay in every total and in the awarder
 *  list; only the oblast map leaves them out and states their € beside it.
 *  A curated list: the rule is „a national body", which no column records. */
export const FLOOD_NATIONAL_AWARDERS: Readonly<Record<string, string>> = {
  [NAPOITELNI_EIK]: "Напоителни системи ЕАД",
  [USYA_EIK]: "ДП „Управление и стопанисване на язовири“",
  "000649348": "Национална електрическа компания ЕАД",
  "831909905": "Министерство на земеделието и храните",
  "000695388": "Министерство на транспорта и съобщенията",
  "000695089": "Агенция „Пътна инфраструктура“",
  "831901762": "Изпълнителна агенция по околна среда",
  // Seated in Ruse, but its dredging is the whole Bulgarian Danube fairway.
  "000513106": "ИА „Проучване и поддържане на река Дунав“",
};

export interface FloodModel {
  totalEur: number;
  contractCount: number;
  awarderCount: number;
  napoitelniEur: number;
  napoitelniCount: number;
  byYear: FloodYear[];
  /** Oblast spend EXCLUDING the national-scope awarders (W3). */
  byOblast: FloodOblast[];
  /** What the national-scope awarders spent — off the map, stated beside it. */
  nationalEur: number;
  nationalCount: number;
  /** Which national awarders contributed in this window, € desc — so the note
   *  names the bodies actually behind the figure. */
  nationalAwarders: { eik: string; name: string; eur: number }[];
  /** Neither on the map nor national: the awarder's seat did not resolve. */
  unplacedEur: number;
  unplacedCount: number;
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
  let nationalEur = 0;
  let nationalCount = 0;
  const nationalByEik = new Map<string, number>();
  let unplacedEur = 0;
  let unplacedCount = 0;
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
    if (r.awarderEik in FLOOD_NATIONAL_AWARDERS) {
      nationalEur += r.eur;
      nationalCount += 1;
      nationalByEik.set(
        r.awarderEik,
        (nationalByEik.get(r.awarderEik) ?? 0) + r.eur,
      );
    } else if (r.oblast) {
      const o = byOblast.get(r.oblast) ?? { eur: 0, count: 0 };
      o.eur += r.eur;
      o.count += 1;
      byOblast.set(r.oblast, o);
    } else {
      unplacedEur += r.eur;
      unplacedCount += 1;
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
    nationalEur,
    nationalCount,
    nationalAwarders: [...nationalByEik.entries()]
      .map(([eik, eur]) => ({
        eik,
        name: FLOOD_NATIONAL_AWARDERS[eik],
        eur,
      }))
      .sort((a, b) => b.eur - a.eur || a.eik.localeCompare(b.eik)),
    unplacedEur,
    unplacedCount,
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
