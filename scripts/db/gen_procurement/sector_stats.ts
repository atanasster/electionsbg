// Pre-generate the headline stat for the government-sector tiles (the
// /governance/sectors hub + the "featured sectors" strip on /procurement).
// Written as one small static file the tiles read — same pattern + serving path
// as hub_stats.json (committed + bucket-synced; the rest of procurement is
// PG-only).
//
// Keyed by the SAME scope key the frontend computes (useScopeWindow), so
// the sectors hub's scope control is live:
//   ns:<election>  — the selected parliament's tenure window
//   y:<year>       — one calendar year
//   all            — the full corpus
//
//   npm run db:gen-sector-stats   # reads PG (after db:refresh) + bespoke JSON
//
// Two kinds of metric, because "procurement € through the awarder" understates
// the sectors whose real money is a payout, not a contract:
//   - eur (procurement, windowed): the 11 sectors that spend via tenders —
//     roads, water, transport, social, edu, revenue, customs, administration,
//     defense, justice, culture. Summed per scope from `contracts`.
//   - eur (payout, annual): pension = ДОО fund pension outlay (funds.json),
//     health = НЗОК cash execution (nzok/execution_history.json), agri = ДФЗ CAP
//     paid (agri_payloads). These dwarf the sector's procurement line.
//   - score (annual): schools = national mean ДЗИ-по-БЕЛ success
//     (indicators.json series.dzi) — schools have no single procurement seat, so
//     the tile carries an outcome number instead of a €.
//   - count (annual): administration = total filled positions across the whole
//     state administration (budget/personnel.json) — headcount, not МЕУ's thin
//     procurement line.
// Annual figures track the scope's year for a y:<year> scope (falling back to
// the source's latest year), and show the latest year for ns/all — a parliament
// window spans several fiscal years, so "current scale" is the honest read.

import fs from "node:fs";
import path from "node:path";
import { allRows } from "../lib/pg";
import { API_EIK } from "../../../src/lib/roadAttributes";
import { NOI_EIK } from "../../../src/lib/noiBenchmarks";
import { MON_EIK } from "../../../src/lib/monBenchmarks";
import { NAP_EIK } from "../../../src/lib/napReferenceData";
import { CUSTOMS_EIK } from "../../../src/lib/customsReferenceData";
import { KULTURA_EIK } from "../../../src/lib/kulturaReferenceData";
import { WATER_SECTOR_EIKS } from "../../../src/lib/vikReferenceData";
import { DEFENSE_SECTOR_EIKS } from "../../../src/lib/defenseReferenceData";
import {
  VSS_EIK,
  VSS_ALIAS_EIKS,
  JUDICIAL_EIKS,
} from "../../../src/lib/vssReferenceData";

const ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../..",
);
const OUT = path.join(ROOT, "data/procurement/derived/sector_stats.json");
const ELECTIONS = path.join(ROOT, "src/data/json/elections.json");

const dash = (d: string): string => d.replace(/_/g, "-");
const readJson = <T>(p: string): T =>
  JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8")) as T;

// Procurement sectors: id (matches SECTOR_SCENES / sectorRegistry) → the awarder
// EIK-set whose contract € rolls up to that sector. health, agri and
// administration are NOT here — they carry a bespoke figure below (payout /
// headcount), the far more meaningful number than their thin procurement line.
const SECTOR_EIKS: Record<string, string[]> = {
  roads: [API_EIK],
  water: WATER_SECTOR_EIKS,
  transport: ["000695388"], // МТС
  social: [NOI_EIK],
  edu: [MON_EIK],
  revenue: [NAP_EIK],
  customs: [CUSTOMS_EIK],
  defense: DEFENSE_SECTOR_EIKS,
  justice: [VSS_EIK, ...VSS_ALIAS_EIKS, ...JUDICIAL_EIKS],
  culture: [KULTURA_EIK],
};

// Flattened (eik, sector) pairs for a single grouped query per scope.
const eikList: string[] = [];
const sectorList: string[] = [];
for (const [sector, eiks] of Object.entries(SECTOR_EIKS)) {
  for (const e of eiks) {
    eikList.push(e);
    sectorList.push(sector);
  }
}

interface SectorVal {
  kind: "eur" | "score" | "count";
  value: number;
}
type ScopeStats = Record<string, SectorVal>;

// ---- bespoke annual series (year → value) + latest ------------------------

const seriesLatest = (byYear: Record<number, number>): number => {
  const ys = Object.keys(byYear).map(Number);
  return ys.length ? byYear[Math.max(...ys)] : 0;
};

// Pension: ДОО fund pension outlay per fiscal year.
const funds = readJson<{
  years?: Array<{
    fiscalYear: number;
    totals?: {
      pensions?: { amountEur?: number };
      expenditure?: { amountEur?: number };
    };
  }>;
}>("data/budget/noi/funds.json");
const pensionByYear: Record<number, number> = {};
for (const y of funds.years ?? []) {
  const v =
    y.totals?.pensions?.amountEur ?? y.totals?.expenditure?.amountEur ?? 0;
  if (v) pensionByYear[y.fiscalYear] = v;
}

// НЗОК: cash-execution B1 outlay. The monthly feed is cumulative-YTD; take the
// last point per year, and treat the latest full year (month 12) as "current".
const nzok = readJson<{
  points?: Array<{ year: number; month: number; expenditureEur: number }>;
}>("data/budget/nzok/execution_history.json");
const nzokLastPt: Record<number, { month: number; expenditureEur: number }> =
  {};
for (const p of nzok.points ?? []) {
  const cur = nzokLastPt[p.year];
  if (!cur || p.month > cur.month) nzokLastPt[p.year] = p;
}
const nzokByYear: Record<number, number> = {};
let nzokLatestYear = 0;
for (const [y, p] of Object.entries(nzokLastPt)) {
  nzokByYear[Number(y)] = p.expenditureEur;
  if (p.month === 12 && Number(y) > nzokLatestYear) nzokLatestYear = Number(y);
}
const nzokLatest = nzokLatestYear
  ? nzokByYear[nzokLatestYear]
  : seriesLatest(nzokByYear);

// Schools: national mean ДЗИ-по-БЕЛ success across oblasti, per year. Unweighted
// oblast mean — good enough for a tile headline (no per-oblast cohort sizes here).
const indicators = readJson<{
  series?: { dzi?: Record<string, Array<{ year: number; value: number }>> };
}>("data/indicators.json");
const dzi = indicators.series?.dzi ?? {};
const dziSum: Record<number, number> = {};
const dziN: Record<number, number> = {};
for (const series of Object.values(dzi)) {
  for (const pt of series) {
    dziSum[pt.year] = (dziSum[pt.year] ?? 0) + pt.value;
    dziN[pt.year] = (dziN[pt.year] ?? 0) + 1;
  }
}
const dziByYear: Record<number, number> = {};
for (const y of Object.keys(dziSum).map(Number)) {
  dziByYear[y] = dziSum[y] / dziN[y];
}

// Administration: total filled positions across the whole state administration
// (the "Доклад за състоянието на администрацията" щатна численост, filled), per
// year — a far more meaningful "administration" figure than МЕУ's thin
// procurement line. `filled` ≈ actual employees; years without it (2017) are
// skipped so they fall back to the latest.
const personnel = readJson<{
  national?: Record<string, { positions?: { filled?: number | null } }>;
}>("data/budget/personnel.json");
const adminByYear: Record<number, number> = {};
for (const [y, rec] of Object.entries(personnel.national ?? {})) {
  const filled = rec.positions?.filled;
  if (filled) adminByYear[Number(y)] = filled;
}

// ДФЗ CAP paid per financial year — filled from PG in main() before any scope
// is computed (scopeStats closes over it).
const agriByYear: Record<number, number> = {};

// pick the year's value for a y:<year> scope, else the source's latest.
const pick = (
  byYear: Record<number, number>,
  year: number | null,
  latest: number,
): number => (year != null && byYear[year] != null ? byYear[year] : latest);

// ---------------------------------------------------------------------------

const scopeStats = async (
  from: string | null,
  to: string | null,
  year: number | null,
): Promise<ScopeStats> => {
  // Windowed procurement € per sector, one grouped query. Sargable COALESCE
  // bounds (string date compares) so the date index is used.
  const rows = (await allRows(
    `SELECT m.sector AS sector, COALESCE(ROUND(SUM(c.amount_eur)), 0)::float8 AS eur
       FROM contracts c
       JOIN (SELECT unnest($3::text[]) AS eik, unnest($4::text[]) AS sector) m
         ON c.awarder_eik = m.eik
      WHERE c.tag = 'contract'
        AND c.date >= COALESCE($1, '0000')
        AND c.date <  COALESCE($2, '9999')
      GROUP BY m.sector`,
    [from, to, eikList, sectorList],
  )) as { sector: string; eur: number }[];

  const out: ScopeStats = {};
  for (const s of Object.keys(SECTOR_EIKS)) out[s] = { kind: "eur", value: 0 };
  for (const r of rows) out[r.sector] = { kind: "eur", value: r.eur };

  // Bespoke payouts / score.
  out.pension = {
    kind: "eur",
    value: pick(pensionByYear, year, seriesLatest(pensionByYear)),
  };
  out.health = { kind: "eur", value: pick(nzokByYear, year, nzokLatest) };
  out.agri = {
    kind: "eur",
    value: pick(agriByYear, year, seriesLatest(agriByYear)),
  };
  out.schools = {
    kind: "score",
    value: pick(dziByYear, year, seriesLatest(dziByYear)),
  };
  out.administration = {
    kind: "count",
    value: pick(adminByYear, year, seriesLatest(adminByYear)),
  };
  return out;
};

const main = async (): Promise<void> => {
  const t0 = Date.now();

  // ДФЗ CAP paid, per financial year, from the precomputed overview payloads.
  const agriRows = (await allRows(
    "SELECT key, (payload->'headline'->>'totalEur')::float8 AS eur FROM agri_payloads WHERE kind = 'overview' AND key ~ '^[0-9]{4}$'",
    [],
  )) as { key: string; eur: number }[];
  for (const r of agriRows) agriByYear[Number(r.key)] = r.eur;

  // Fail loud if a bespoke source came back empty — an all-zero tile is a
  // silent data bug (a moved JSON field, an unloaded agri_payloads table), not
  // a legitimate "0". The procurement sectors can legitimately be 0 in a narrow
  // scope, so they aren't checked here.
  const bespoke: [string, Record<number, number>][] = [
    ["pension (funds.json)", pensionByYear],
    ["health (nzok execution_history.json)", nzokByYear],
    ["agri (agri_payloads)", agriByYear],
    ["schools (indicators dzi)", dziByYear],
    ["administration (personnel.json)", adminByYear],
  ];
  for (const [label, series] of bespoke) {
    if (Object.keys(series).length === 0)
      console.warn(`  ⚠ sector_stats: ${label} produced no data`);
  }

  const elections = JSON.parse(fs.readFileSync(ELECTIONS, "utf8")) as Array<{
    name: string;
  }>;
  const yearRows = (await allRows(
    "SELECT DISTINCT left(date,4) AS y FROM contracts WHERE date >= '2011' ORDER BY y",
    [],
  )) as { y: string }[];

  const out: Record<string, ScopeStats> = {};
  out["all"] = await scopeStats(null, null, null);
  for (let i = 0; i < elections.length; i++) {
    const from = dash(elections[i].name);
    const to = i > 0 ? dash(elections[i - 1].name) : null;
    out[`ns:${elections[i].name}`] = await scopeStats(from, to, null);
  }
  for (const { y } of yearRows) {
    const year = Number(y);
    if (!Number.isFinite(year)) continue;
    out[`y:${year}`] = await scopeStats(
      `${year}-01-01`,
      `${year + 1}-01-01`,
      year,
    );
  }

  fs.writeFileSync(OUT, JSON.stringify(out, null, 0) + "\n");
  console.log(
    `sector_stats: ${Object.keys(out).length} scope(s) → ${path.relative(ROOT, OUT)} in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
  );
  process.exit(0);
};

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
