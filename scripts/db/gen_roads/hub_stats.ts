// Pre-generate the /sector/roads hub's figures as one small committed JSON.
//
//   npm run db:gen-roads-hub-stats
//
// The roads pages compute everything client-side from the АПИ contract rows via
// buildRoadsModel. The hub must not: it would download ~3k rows and the 30 KB
// engine to draw four numbers. So this runs the SAME engine over the SAME rows
// (scripts/db/lib/roadsRows.ts) in Node and writes the few figures the hub
// shows. Plan: docs/plans/roads-hub-v1.md T3.
//
// ═══════════════════════════════════════════════════════════════════════════════
// ⚠️ ITS SLOT IN `db:refresh` IS IMMEDIATELY AFTER `db:gen-sector-stats`.
// It reads fund_projects (db:load:funds:pg), procurement_annexes
// (db:load:annexes:pg) and contract_risk_cache (db:load:pg), and the data gate
// compares its headline against sector_stats.json — so it must follow the
// generator that writes that file, or the two publish different vintages of
// one number on two pages a click apart.
//
// There is NO `:cloud` half: this writes a committed FILE that ships via
// `bucket:sync:paths -- roads/derived/hub_stats.json`.
// ═══════════════════════════════════════════════════════════════════════════════

import fs from "node:fs";
import path from "node:path";
import { allRows, end } from "../lib/pg";
import {
  missingRelations,
  isEmpty,
  warnSkip,
} from "../gen_procurement/preflight";
import { ROAD_ROWS_SQL } from "../lib/roadsRows";
import {
  ROADS_INHOUSE_CONTRACTORS,
  ROADS_SECTOR_EIKS,
} from "../../../src/lib/roadsReferenceData";
import { buildRoadsModel } from "../../../src/lib/roadAttributes";
import type { ProcurementContract } from "../../../src/data/dataTypes";
import type { RoadsHubStats } from "../../../src/data/roads/hubStats";
import {
  annexReasonCode,
  type AnnexReasonCode,
} from "../../../src/lib/annexReasons";

const ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../..",
);
const OUT = path.join(ROOT, "data/roads/derived/hub_stats.json");

/** Every relation a figure reads, and the db:refresh step that fills it. */
const INPUTS: Record<string, string> = {
  contracts: "db:load:pg",
  contract_risk_cache: "db:load:pg",
  procurement_annexes: "db:load:annexes:pg",
  fund_projects: "db:load:funds:pg",
};

/** The ×1.5 option cluster: current value = 1.5 × signing value, to ±0.005. */
const X15 = `signing_amount_eur > 0
  AND abs(amount_eur / signing_amount_eur - 1.5) < 0.005`;

/** A corridor needs this much € to be a finder entry. */
const INDEX_FLOOR_EUR = 10_000_000;

const num = (v: unknown): number => Number(v ?? 0);
const round = (v: number): number => Math.round(v);

const main = async () => {
  const t0 = Date.now();
  const missing = await missingRelations(Object.keys(INPUTS));
  if (missing.length) {
    warnSkip(
      "roads hub_stats",
      `missing relation(s): ${missing
        .map((m) => `${m} (${INPUTS[m]})`)
        .join(", ")}`,
      "Run the loader(s) named in brackets, or the whole chain: npm run db:refresh",
    );
    await end();
    process.exit(0);
  }
  if (await isEmpty("contracts")) {
    warnSkip(
      "roads hub_stats",
      "contracts is empty (db:load:pg)",
      "Load the procurement corpus first: npm run db:load:pg",
    );
    await end();
    process.exit(0);
  }

  const eiks = [...ROADS_SECTOR_EIKS];
  const rows = await allRows<ProcurementContract>(ROAD_ROWS_SQL, [eiks]);
  const m = buildRoadsModel(rows);

  const [proc] = await allRows<Record<string, string | null>>(
    `SELECT count(*) FILTER (WHERE consortium_role IS DISTINCT FROM 'member') n,
            sum(amount_eur) eur,
            count(DISTINCT contractor_eik) FILTER (
              WHERE consortium_role IS DISTINCT FROM 'member' AND amount_eur > 0) contractors,
            min(date) first_date, max(date) last_date
       FROM contracts WHERE tag = 'contract' AND awarder_eik = ANY($1)`,
    [eiks],
  );
  const [nat] = await allRows<{
    r: { singleBidExMembers?: number; bidKnownExMembers?: number };
  }>("SELECT national_competition(NULL, NULL) AS r");
  if (nat?.r?.bidKnownExMembers == null)
    throw new Error(
      "national_competition() lacks the ex-member keys — apply 167_national_competition.sql",
    );

  const inhouse = ROADS_INHOUSE_CONTRACTORS[0];
  const [inh] = await allRows<{ eur: string; n: string }>(
    `SELECT sum(amount_eur) eur, count(*) n FROM contracts
      WHERE tag = 'contract' AND awarder_eik = ANY($1) AND contractor_eik = $2`,
    [eiks, inhouse.eik],
  );

  const grades = await allRows<{ grade: string; n: string }>(
    `SELECT r.grade, count(*) n
       FROM contracts c JOIN contract_risk_cache r ON r.key = c.key
      WHERE c.tag = 'contract' AND c.awarder_eik = ANY($1)
        AND c.consortium_role IS DISTINCT FROM 'member'
        AND r.grade IS NOT NULL
      GROUP BY 1 ORDER BY 1`,
    [eiks],
  );

  const [opt] = await allRows<{ n: string; cur: string; growth: string }>(
    `SELECT count(*) n, sum(amount_eur) cur, sum(amount_eur - signing_amount_eur) growth
       FROM contracts WHERE tag = 'contract' AND awarder_eik = ANY($1) AND ${X15}`,
    [eiks],
  );
  // Each option contract counted ONCE, under its largest annex's own reason —
  // a contract with two annexes of different reasons must not be summed twice.
  const byReason = await allRows<{ reason: string; n: string; growth: string }>(
    `WITH x AS (
       SELECT key, amount_eur - signing_amount_eur growth FROM contracts
        WHERE tag = 'contract' AND awarder_eik = ANY($1) AND ${X15}),
     r AS (
       SELECT DISTINCT ON (x.key) x.key, x.growth,
              coalesce(a.change_reason, '') reason
         FROM x LEFT JOIN procurement_annexes a ON a.contract_key = x.key
        ORDER BY x.key, a.value_diff_eur DESC NULLS LAST)
     SELECT reason, count(*) n, sum(growth) growth FROM r GROUP BY 1 ORDER BY 3 DESC`,
    [eiks],
  );
  const [natOpt] = await allRows<{ n: string; growth: string }>(
    `SELECT count(*) n, sum(amount_eur - signing_amount_eur) growth
       FROM contracts WHERE tag = 'contract' AND ${X15}`,
  );

  const [eu] = await allRows<{ n: string; total: string; paid: string }>(
    `SELECT count(*) n, sum(total_eur) total, sum(paid_eur) paid
       FROM fund_projects WHERE beneficiary_eik = ANY($1)`,
    [eiks],
  );

  const peak = [...m.years].sort((a, b) => b.totalEur - a.totalEur)[0];

  const out: RoadsHubStats = {
    generatedAt: new Date().toISOString().slice(0, 10),
    firstDate: proc.first_date ?? null,
    lastDate: proc.last_date ?? null,
    procurement: {
      contracts: num(proc.n),
      eur: round(num(proc.eur)),
      contractors: num(proc.contractors),
      singleBid: m.rows.filter((r) => r.c.numberOfTenderers === 1).length,
      bidKnown: m.rows.filter((r) => r.c.numberOfTenderers != null).length,
      nationalSingleBid: num(nat.r.singleBidExMembers),
      nationalBidKnown: num(nat.r.bidKnownExMembers),
      directEur: round(m.directShare * m.totalEur),
      // The direct share's denominator includes this; the KPI says how much.
      unknownMethodEur: round(
        m.methods
          .filter((x) => x.bucket === "unknown")
          .reduce((t, x) => t + x.totalEur, 0),
      ),
      growthEur: round(m.years.reduce((s, y) => s + y.growthEur, 0)),
    },
    inhouse: {
      eik: inhouse.eik,
      eur: round(num(inh.eur)),
      contracts: num(inh.n),
    },
    riskGrades: Object.fromEntries(grades.map((g) => [g.grade, num(g.n)])),
    topCorridors: m.corridors.slice(0, 5).map((c) => ({
      corridor: c.corridor,
      eur: round(c.totalEur),
      contracts: c.contractCount,
    })),
    corridorIndex: m.corridors
      .filter((c) => c.totalEur >= INDEX_FLOOR_EUR)
      .map((c) => ({ corridor: c.corridor, eur: round(c.totalEur) })),
    regionIndex: m.regions.map((r) => ({
      region: r.region,
      eur: round(r.totalEur),
    })),
    peakYear: peak
      ? {
          year: peak.year,
          eur: round(peak.totalEur),
          growthEur: round(peak.growthEur),
        }
      : null,
    coverage: {
      refCoverageEur: Math.round(m.refCoverageEur * 1e4) / 1e4,
      perKmRows: m.rows.filter((r) => r.perKm).length,
    },
    annexOptions: {
      contracts: num(opt.n),
      currentEur: round(num(opt.cur)),
      growthEur: round(num(opt.growth)),
      byReason: [
        ...byReason
          .reduce((acc, r) => {
            // Several register strings can fold to one code; sum them.
            const code = annexReasonCode(r.reason || null);
            const a = acc.get(code) ?? { contracts: 0, growthEur: 0 };
            a.contracts += num(r.n);
            a.growthEur += num(r.growth);
            return acc.set(code, a);
          }, new Map<AnnexReasonCode, { contracts: number; growthEur: number }>())
          .entries(),
      ].map(([reason, a]) => ({
        reason,
        contracts: a.contracts,
        growthEur: round(a.growthEur),
      })),
      nationalContracts: num(natOpt.n),
      nationalGrowthEur: round(num(natOpt.growth)),
    },
    euFunds: {
      projects: num(eu.n),
      totalEur: round(num(eu.total)),
      paidEur: round(num(eu.paid)),
    },
  };

  // The engine and the SQL sum must agree — they read the same rows. A drift
  // here is a row-shape change in ROAD_ROWS_SQL, never a rounding difference.
  if (Math.abs(m.totalEur - num(proc.eur)) > 1)
    throw new Error(
      `engine €${m.totalEur} ≠ SQL €${proc.eur} — ROAD_ROWS_SQL has drifted from contracts`,
    );

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out) + "\n");
  console.log(
    `roads hub_stats: ${fs.statSync(OUT).size} B → ${path.relative(ROOT, OUT)} in ${(
      (Date.now() - t0) /
      1000
    ).toFixed(1)}s`,
  );
  await end();
  process.exit(0);
};

main().catch(async (e) => {
  console.error(e instanceof Error ? e.message : e);
  await end().catch(() => {});
  process.exit(1);
});
