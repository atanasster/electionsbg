// TS ↔ SQL parity gate for the contract risk index.
//
// WHY: the 12 risk checks now exist twice — in Postgres (contract_risk_cache,
// migration 112) and in TypeScript (computeProcurementRisk.ts, which still
// renders the chips). Two implementations of one rule WILL drift, and the drift
// is invisible: the browser column and the contract page quietly disagree about
// the same contract. This harness makes that drift loud.
//
// It is not hypothetical. The first version of 112 diverged on newFirmWinner
// because 033's foundedByEik payload was bounded to founded_date >= 2018-01-01
// while the SQL joined company_founded unbounded. Availability is decided
// per-CONTRACTOR, so the bound moved the DENOMINATOR: 30.2% of the corpus
// carried a different CRI on the two sides. Nothing caught it until this
// comparison was run — inspection had already passed it.
//
// Compares every component's available/fired bit AND the derived cri/score over
// a random sample of real contracts. Fails non-zero on any mismatch.
//
//   npx tsx scripts/procurement/risk_parity.harness.ts            # 20k sample
//   npx tsx scripts/procurement/risk_parity.harness.ts --n 120000
//   npx tsx scripts/procurement/risk_parity.harness.ts --seed 7
//
// Skips (exit 0) when Postgres is down or the cache is empty, matching the
// scripts/db/tests/*.data.test.ts convention — CI without a DB must not fail.

import {
  computeProcurementRisk,
  type RiskScoreArgs,
} from "@/data/procurement/computeProcurementRisk";
import type { ProcurementContract } from "@/data/dataTypes";
import { allRows, end } from "../db/lib/pg";

// Bit order is the contract documented on contract_risk_cache (112). Keep in
// step with it; appending is safe, renumbering is not.
const CHECKS = [
  "debarred",
  "mpConnected",
  "pepConnected",
  "awarderConcentration",
  "amendment",
  "annexGrowth",
  "newFirmWinner",
  "splitPurchase",
  "appealUpheld",
  "weakCompetition",
  "directAward",
  "shortTenderPeriod",
] as const;

const LEGAL_SUFFIX_RE =
  /\s*[„"„“(]?(ЕООД|ООД|ЕАД|АД|ЕТ|СД|КД|КДА|ДЗЗД|АДСИЦ|ООД-К|ЕООД-К)\.?[)"”]?\s*$/iu;

/** Same fold the SPA applies (useDebarred.tsx) — the TS side of the comparison
 *  must use the SPA's rule, not the SQL one, or the test proves nothing. */
const normalizeName = (raw: string): string => {
  let s = raw.normalize("NFC").trim();
  s = s.replace(/[„"„“”""''`’‘()]/g, "");
  s = s.replace(LEGAL_SUFFIX_RE, "");
  s = s.replace(/\s+/g, " ").trim();
  return s.toLocaleLowerCase("bg");
};

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

type Payload = {
  debarred?: { entries?: { name?: string }[] };
  concentration?: {
    entries?: { awarderEik?: string; contractorEik?: string }[];
  };
  mpConnected?: { eik?: string }[];
  pepConnectedEiks?: string[];
  cpvCompetition?: {
    structuralSingleBidShare?: number;
    divisions?: { division?: string; singleBidShare?: number }[];
  };
  cpvBidderMedians?: Record<string, number>;
  foundedByEik?: Record<string, string>;
  splitPurchase?: {
    awarderEik?: string;
    contractorEik?: string;
    cpvDiv?: string;
    year?: string;
  }[];
};

type Row = {
  key: string;
  tag: string;
  awarder_eik: string | null;
  contractor_eik: string | null;
  contractor_name: string | null;
  amount_eur: number | null;
  signing_amount_eur: number | null;
  cpv: string | null;
  date: string | null;
  date_signed: string | null;
  number_of_tenderers: number | null;
  procurement_method: string | null;
  procurement_method_rationale: string | null;
  tender_period_start_date: string | null;
  tender_period_end_date: string | null;
  appeal_upheld: boolean | null;
  sql_cri: number;
  sql_score: number;
  sql_available_mask: number;
  sql_fired_mask: number;
};

const main = async () => {
  const n = Number(arg("n") ?? 20000);
  const seed = Number(arg("seed") ?? 42);

  const [{ cached }] = await allRows<{ cached: number }>(
    `SELECT count(*)::int AS cached FROM contract_risk_cache`,
  );
  if (!cached) {
    console.log(
      "· contract_risk_cache is empty — run rebuild_contract_risk_cache(); skipping",
    );
    await end();
    return;
  }

  const [{ payload }] = await allRows<{ payload: Payload }>(
    `SELECT r AS payload FROM procurement_risk_indexes_cache`,
  );

  // Rebuild exactly the maps the SPA hooks build from this payload.
  const args: RiskScoreArgs = {
    debarredByName: new Map(
      (payload.debarred?.entries ?? [])
        .filter((d) => d.name)
        .map((d) => [normalizeName(d.name as string), d as never]),
    ),
    concentrationByPair: new Map(
      (payload.concentration?.entries ?? []).map((e) => [
        `${e.awarderEik}|${e.contractorEik}`,
        e as never,
      ]),
    ),
    mpConnectedEiks: new Map(
      (payload.mpConnected ?? []).map((m) => [m.eik as string, true]),
    ),
    pepConnectedEiks: new Set(payload.pepConnectedEiks ?? []),
    cpvSingleBidShare: new Map(
      (payload.cpvCompetition?.divisions ?? []).map((d) => [
        d.division as string,
        d.singleBidShare as number,
      ]),
    ),
    structuralSingleBidShare: payload.cpvCompetition?.structuralSingleBidShare,
    cpvBidderMedian: new Map(
      Object.entries(payload.cpvBidderMedians ?? {}).map(([k, v]) => [
        k,
        Number(v),
      ]),
    ),
    foundedByEik: new Map(Object.entries(payload.foundedByEik ?? {})),
    splitPurchaseByKey: new Map(
      (payload.splitPurchase ?? []).map((s) => [
        `${s.awarderEik}|${s.contractorEik}|${s.cpvDiv}|${s.year}`,
        s as never,
      ]),
    ),
    normalizeName,
  };

  // Deterministic sample: hashtext is stable for a given seed, so a failure is
  // reproducible rather than a different slice every run.
  const rows = await allRows<Row>(
    `SELECT c.key, c.tag, c.awarder_eik, c.contractor_eik, c.contractor_name,
            c.amount_eur, c.signing_amount_eur, c.cpv, c.date, c.date_signed,
            c.number_of_tenderers, c.procurement_method,
            c.procurement_method_rationale,
            c.tender_period_start_date, c.tender_period_end_date,
            EXISTS (SELECT 1 FROM risk_upheld_ocid u WHERE u.ocid = c.ocid) AS appeal_upheld,
            r.cri AS sql_cri, r.score AS sql_score,
            r.available_mask AS sql_available_mask, r.fired_mask AS sql_fired_mask
       FROM contracts c
       JOIN contract_risk_cache r ON r.key = c.key
      ORDER BY hashtext(c.key || $1::text)
      LIMIT $2`,
    [String(seed), n],
  );

  const mismatches = new Map<string, number>();
  let criDiff = 0;
  let scoreDiff = 0;
  const examples: string[] = [];

  for (const row of rows) {
    const contract: ProcurementContract = {
      tag: row.tag,
      awarderEik: row.awarder_eik ?? "",
      contractorEik: row.contractor_eik ?? "",
      contractorName: row.contractor_name ?? "",
      amountEur: row.amount_eur ?? undefined,
      signingAmountEur: row.signing_amount_eur ?? undefined,
      cpv: row.cpv ?? undefined,
      date: row.date ?? undefined,
      dateSigned: row.date_signed ?? undefined,
      numberOfTenderers: row.number_of_tenderers ?? undefined,
      procurementMethod: row.procurement_method ?? undefined,
      procurementMethodRationale: row.procurement_method_rationale ?? undefined,
      tenderPeriodStartDate: row.tender_period_start_date ?? undefined,
      tenderPeriodEndDate: row.tender_period_end_date ?? undefined,
      appealUpheld: row.appeal_upheld ?? undefined,
    } as ProcurementContract;

    const ts = computeProcurementRisk(contract, args);
    const byKey = new Map(ts.components.map((c) => [c.key as string, c]));

    for (let bit = 0; bit < CHECKS.length; bit++) {
      const name = CHECKS[bit];
      const sqlA = ((row.sql_available_mask >> bit) & 1) === 1;
      const sqlF = ((row.sql_fired_mask >> bit) & 1) === 1;
      const c = byKey.get(name);
      const tsA = c?.available ?? false;
      const tsF = c?.fired ?? false;
      if (sqlA !== tsA || sqlF !== tsF) {
        mismatches.set(name, (mismatches.get(name) ?? 0) + 1);
        if (examples.length < 8)
          examples.push(
            `    ${row.key} ${name}: sql a=${sqlA} f=${sqlF} · ts a=${tsA} f=${tsF}`,
          );
      }
    }
    if (ts.cri !== row.sql_cri) criDiff++;
    if (ts.score !== row.sql_score) scoreDiff++;
  }

  console.log(`→ parity over ${rows.length} contracts (seed ${seed})`);
  const bad = [...mismatches.entries()].sort((a, b) => b[1] - a[1]);
  for (const name of CHECKS) {
    const m = mismatches.get(name) ?? 0;
    console.log(
      `  ${m === 0 ? "✓" : "✗"} ${name.padEnd(22)} ${m} mismatch(es)`,
    );
  }
  console.log(
    `  ${criDiff === 0 ? "✓" : "✗"} cri differs on ${criDiff} · score differs on ${scoreDiff}`,
  );
  if (examples.length) {
    console.log("  examples:");
    for (const e of examples) console.log(e);
  }

  await end();
  if (bad.length || criDiff || scoreDiff) {
    console.error(
      "\n✗ TS and SQL disagree. One of computeProcurementRisk.ts or " +
        "112_contract_risk_cache.sql has drifted — fix the rule in BOTH, or the " +
        "browser and the risk column will show different numbers for the same row.",
    );
    process.exit(1);
  }
  console.log("✓ parity holds");
};

main().catch(async (e) => {
  const msg = e instanceof Error ? e.message : String(e);
  // No DB (CI, fresh clone) → skip rather than fail, per the data-test convention.
  if (/ECONNREFUSED|does not exist|role .* does not exist/i.test(msg)) {
    console.log(`· parity harness skipped (${msg})`);
    await end().catch(() => {});
    return;
  }
  console.error("✗ risk_parity harness failed:", msg);
  await end().catch(() => {});
  process.exit(1);
});
