// `npm run db:gen-water-hub-stats` → data/water/derived/hub_stats.json, the
// /water hub's KPI band, operator rail, finder index and band figures
// (docs/plans/water-hub-v1.md T2). The shape is WaterHubStats
// (src/data/water/hubStats.ts).
//
// Inputs are Postgres (contracts, fund_beneficiaries, national_competition())
// AND two committed water artifacts — water_stats.json (НСИ) and
// flood_maintenance.json (the riverbed topic) — so the hub reads one object.
// Its slot in db:refresh is after db:gen-sector-stats (KPI 1 must equal
// sector_stats.json all.water) and after db:gen-water-flood (the riverbed
// figure is READ from that file, never recomputed, so the two cannot disagree).
//
// The function split runs the SAME classifier the /water tiles run
// (buildVikModelFromAggregates over awarder_group_model) rather than restating
// the CPV mapping in SQL (G21).

import fs from "node:fs";
import path from "node:path";
import { allRows, end } from "../lib/pg";
import {
  missingRelations,
  isEmpty,
  warnSkip,
} from "../gen_procurement/preflight";
import {
  WATER_OPERATORS,
  WATER_OPERATOR_TYPES,
  WATER_SECTOR_EIKS,
  VIK_HOLDING_EIK,
  operatorByEik,
} from "../../../src/lib/vikReferenceData";
import { buildVikModelFromAggregates } from "../../../src/lib/vikAttributes";
import type { GroupModelPayload } from "../../../src/lib/awarderModel";
import type { WaterHubStats } from "../../../src/data/water/hubStats";
import { CREDIT_TITLE, LOAN_TITLE } from "../../water/water_titles";

const ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../..",
);
const OUT = path.join(ROOT, "data/water/derived/hub_stats.json");
const WATER_STATS = path.join(ROOT, "data/water/water_stats.json");
const FLOOD = path.join(ROOT, "data/water/flood_maintenance.json");

/** Every relation a figure reads, and the db:refresh step that fills it. */
const INPUTS: Record<string, string> = {
  contracts: "db:load:pg",
  fund_beneficiaries: "db:load:funds:pg",
};

/** How many operators the evidence rail shows. */
const RAIL = 5;

const num = (v: unknown): number => Number(v ?? 0);
const round = (v: number): number => Math.round(v);

const main = async () => {
  const t0 = Date.now();
  const missing = await missingRelations(Object.keys(INPUTS));
  if (missing.length) {
    warnSkip(
      "water hub_stats",
      `missing relation(s): ${missing.map((m) => `${m} (${INPUTS[m]})`).join(", ")}`,
      "Run the loader(s) named in brackets, or the whole chain: npm run db:refresh",
    );
    await end();
    process.exit(0);
  }
  if (await isEmpty("contracts")) {
    warnSkip(
      "water hub_stats",
      "contracts is empty (db:load:pg)",
      "Load the procurement corpus first: npm run db:load:pg",
    );
    await end();
    process.exit(0);
  }
  for (const f of [WATER_STATS, FLOOD])
    if (!fs.existsSync(f)) {
      warnSkip(
        "water hub_stats",
        `${path.relative(ROOT, f)} is missing`,
        "It is committed — restore it from git",
      );
      await end();
      process.exit(0);
    }

  const eiks = [...WATER_SECTOR_EIKS];

  const [proc] = await allRows<Record<string, string | null>>(
    `SELECT sum(amount_eur) eur,
            count(*) FILTER (WHERE consortium_role IS DISTINCT FROM 'member') n,
            count(*) FILTER (WHERE consortium_role IS DISTINCT FROM 'member'
                               AND number_of_tenderers = 1) single,
            count(*) FILTER (WHERE consortium_role IS DISTINCT FROM 'member'
                               AND number_of_tenderers IS NOT NULL) known,
            min(date) first_date
       FROM contracts WHERE tag = 'contract' AND awarder_eik = ANY($1)`,
    [eiks],
  );
  const [through] = await allRows<{ max: string | null }>(
    `SELECT max(date) AS max FROM contracts
      WHERE tag = 'contract' AND date ~ '^[12][0-9]{3}-'`,
  );
  const [nat] = await allRows<{
    r: { singleBidExMembers?: number; bidKnownExMembers?: number };
  }>("SELECT national_competition(NULL, NULL) AS r");
  if (nat?.r?.bidKnownExMembers == null)
    throw new Error(
      "national_competition() lacks the ex-member keys — apply 167_national_competition.sql",
    );

  const byOperator = await allRows<{ eik: string; eur: string; n: string }>(
    `SELECT awarder_eik eik, sum(amount_eur) eur,
            count(*) FILTER (WHERE consortium_role IS DISTINCT FROM 'member') n
       FROM contracts WHERE tag = 'contract' AND awarder_eik = ANY($1)
      GROUP BY 1 ORDER BY sum(amount_eur) DESC NULLS LAST, 1`,
    [eiks],
  );

  const [intra] = await allRows<Record<string, string | null>>(
    `SELECT sum(amount_eur) eur, count(*) n,
            sum(amount_eur) FILTER (WHERE contractor_eik = $2 AND ${LOAN_TITLE}) loan_eur,
            count(*) FILTER (WHERE contractor_eik = $2 AND ${LOAN_TITLE}) loan_n,
            sum(amount_eur) FILTER (WHERE contractor_eik = awarder_eik) self_eur,
            count(*) FILTER (WHERE contractor_eik = awarder_eik) self_n
       FROM contracts
      WHERE tag = 'contract' AND awarder_eik = ANY($1) AND contractor_eik = ANY($1)`,
    [eiks, VIK_HOLDING_EIK],
  );
  const [credit] = await allRows<{ eur: string | null; n: string }>(
    `SELECT sum(amount_eur) eur, count(*) n FROM contracts
      WHERE tag = 'contract' AND awarder_eik = ANY($1)
        AND NOT (contractor_eik = ANY($1)) AND ${CREDIT_TITLE}`,
    [eiks],
  );

  const [gm] = await allRows<{ r: GroupModelPayload }>(
    "SELECT awarder_group_model($1, NULL, NULL) AS r",
    [eiks],
  );
  const model = buildVikModelFromAggregates(gm.r);

  const [eu] = await allRows<Record<string, string | null>>(
    `SELECT count(*) beneficiaries, sum(contract_count) projects,
            sum(contracted_eur) contracted, sum(paid_eur) paid
       FROM fund_beneficiaries WHERE eik = ANY($1)`,
    [eiks],
  );

  const stats = JSON.parse(fs.readFileSync(WATER_STATS, "utf8")) as {
    latestYear: number | null;
    years: {
      year: number;
      rationingPct: number | null;
      connectedWaterPct: number | null;
      wasteTreatmentPct: number | null;
    }[];
  };
  const latest = stats.years.find((y) => y.year === stats.latestYear) ?? null;
  const flood = JSON.parse(fs.readFileSync(FLOOD, "utf8")) as {
    totalEur: number;
    contractCount: number;
    corpusThrough?: string;
  };

  const operatorRows = WATER_OPERATORS.filter((o) =>
    WATER_OPERATOR_TYPES.includes(o.type),
  );

  const out: WaterHubStats = {
    corpusThrough: (through.max ?? "").slice(0, 10),
    procurement: {
      eur: round(num(proc.eur)),
      contracts: num(proc.n),
      singleBid: num(proc.single),
      bidKnown: num(proc.known),
      nationalSingleBid: num(nat.r.singleBidExMembers),
      nationalBidKnown: num(nat.r.bidKnownExMembers),
      firstDate: proc.first_date ?? null,
    },
    register: {
      eiks: eiks.length,
      operators: operatorRows.length,
      liveOperators: operatorRows.filter((o) => !o.status).length,
    },
    // OPERATORS only — Напоителни, ДП УСЯ and the holding parent are sector
    // bodies, and the rail's heading names operators (G11).
    topOperators: byOperator
      .filter((o) => {
        const type = operatorByEik(o.eik)?.type;
        return !!type && WATER_OPERATOR_TYPES.includes(type);
      })
      .slice(0, RAIL)
      .map((o) => ({
        eik: o.eik,
        name: operatorByEik(o.eik)?.name ?? o.eik,
        eur: round(num(o.eur)),
        contracts: num(o.n),
      })),
    operatorIndex: byOperator.map((o) => ({
      eik: o.eik,
      eur: round(num(o.eur)),
    })),
    functions: model.categories.map((c) => ({
      id: c.id,
      eur: round(c.totalEur),
    })),
    intraGroup: {
      eur: round(num(intra.eur)),
      contracts: num(intra.n),
      loansToHoldingEur: round(num(intra.loan_eur)),
      loansToHoldingContracts: num(intra.loan_n),
      selfEur: round(num(intra.self_eur)),
      selfContracts: num(intra.self_n),
    },
    credits: { eur: round(num(credit.eur)), contracts: num(credit.n) },
    euFunds: {
      beneficiaries: num(eu.beneficiaries),
      projects: num(eu.projects),
      contractedEur: round(num(eu.contracted)),
      paidEur: round(num(eu.paid)),
    },
    services: latest
      ? {
          year: latest.year,
          rationingPct: latest.rationingPct,
          connectedWaterPct: latest.connectedWaterPct,
          wasteTreatmentPct: latest.wasteTreatmentPct,
        }
      : null,
    riverbed: {
      eur: flood.totalEur,
      contracts: flood.contractCount,
      corpusThrough: flood.corpusThrough ?? null,
    },
  };

  // The classifier and the SQL sum read the same rows; a drift here is a
  // payload-shape change in awarder_group_model. awarder_group_model rounds each
  // byCpv row to the euro, so up to €0.5 per row is rounding, not drift.
  const fnTotal = out.functions.reduce((s, f) => s + f.eur, 0);
  if (Math.abs(fnTotal - out.procurement.eur) > gm.r.byCpv.length / 2 + 1)
    throw new Error(
      `function split €${fnTotal} ≠ headline €${out.procurement.eur} — awarder_group_model has drifted from contracts`,
    );

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out) + "\n");
  console.log(
    `water hub_stats: ${fs.statSync(OUT).size} B → ${path.relative(ROOT, OUT)} in ${(
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
