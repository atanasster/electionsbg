// TS ↔ SQL parity gate for the contract risk index.
//
// WHY: the 13 risk checks now exist twice — in Postgres (contract_risk_cache,
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
// Skips (exit 0) only when Postgres is UNREACHABLE or contract_risk_cache is
// empty, matching the scripts/db/tests/*.data.test.ts convention — a machine with
// no database must not fail.
//
// ⚠️ A MISSING RELATION on a reachable database FAILS. That is deliberate, and it
// is the bug this file spent months hiding: the old skip predicate matched a bare
// `does not exist`, so a dropped risk_upheld_ocid (042's DROP … CASCADE) printed
// "skipped" and exited 0 against a fully loaded 407,693-row corpus. Reachability
// is now decided structurally by dbReachable(), not by matching an error string —
// see the comment on that helper before changing this.
//
// Where it runs: `npm run risk:parity` (full sample), the tail of `ai:test:all`,
// and — on a 2k sample — scripts/db/tests/risk_parity.data.test.ts, which rides
// `npm run test:data` and therefore `db:refresh`. A gate that has to be
// remembered is the failure mode this file is about, so prefer adding callers
// over enlarging this one.

import {
  computeProcurementRisk,
  type RiskScoreArgs,
} from "@/data/procurement/computeProcurementRisk";
import type { ProcurementContract } from "@/data/dataTypes";
import { pathToFileURL } from "node:url";
import { RISK_MASK_BITS, contractRiskFromMasks } from "@/lib/contractRiskMask";
import { allRows, dbReachable, end } from "../db/lib/pg";

// Bit order is the contract documented on contract_risk_cache (112). IMPORTED
// rather than copied: this harness is the only automated gate that compares the
// bit order against the DATABASE, so a private copy here would let the source
// renumber with every test still green — the decoder would then mis-label every
// chip and nothing would say so.
//
// The import now resolves, through contractRiskMask.ts, to RISK_MASK_BITS in
// src/lib/riskFlagCatalog.ts — the one declaration the two scorers, the decoder,
// the chip ledger and the published spec all read. What is left to keep in step
// by hand is the SQL, and scripts/risk/risk_catalog_sql_parity.test.ts holds 033,
// 041 and 112 to the same catalogue statically (no database needed). This file
// stays the gate for the half that one cannot check: whether the predicates
// actually COMPUTE what the numbers say, over real rows.
const CHECKS = RISK_MASK_BITS;

/** The literal order, asserted against the import so a renumber in the decoder
 *  fails HERE — the one place that also checks it against real rows. */
const EXPECTED_CHECK_ORDER = [
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
  "nkidMismatch",
] as const;

if (
  CHECKS.length !== EXPECTED_CHECK_ORDER.length ||
  CHECKS.some((c, i) => c !== EXPECTED_CHECK_ORDER[i])
) {
  throw new Error(
    `risk mask bit order changed: RISK_MASK_BITS is [${CHECKS.join(", ")}] but ` +
      `112_contract_risk_cache.sql documents [${EXPECTED_CHECK_ORDER.join(", ")}]. ` +
      `Renumbering re-maps every mask already stored — append, never reorder.`,
  );
}

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
  nkidByEik?: Record<string, string>;
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

export type ParityResult = {
  compared: number;
  mismatches: Map<string, number>;
  /** Rows on which each check was AVAILABLE, per SQL.
   *
   *  Reported beside the mismatch tally because a check that is unavailable on
   *  every sampled row prints a ✓ that proves NOTHING — the comparison only ever
   *  saw "both sides agree this is not evaluable". `shortTenderPeriod` is the
   *  live example: 112's own header records the tender-window columns as ~0%
   *  populated, so its ✓ has always been vacuous and nothing said so. */
  coverage: Map<string, number>;
  criDiff: number;
  scoreDiff: number;
  /** Rows where the SPA's mask DECODER disagrees with the TS scorer / SQL. */
  decoderDiff: number;
  examples: string[];
  /** True when contract_risk_cache is empty — nothing to compare, not a failure. */
  skipped: boolean;
};

/** Compare the TS scorer against contract_risk_cache over a deterministic
 *  sample. Returns the tally instead of exiting, so both the CLI below and the
 *  `test:data` wrapper can drive it. */
export const runParity = async ({
  n = 20000,
  seed = 42,
}: { n?: number; seed?: number } = {}): Promise<ParityResult> => {
  const empty = (skipped: boolean): ParityResult => ({
    compared: 0,
    mismatches: new Map(),
    coverage: new Map(),
    criDiff: 0,
    scoreDiff: 0,
    decoderDiff: 0,
    examples: [],
    skipped,
  });

  const [{ cached }] = await allRows<{ cached: number }>(
    `SELECT count(*)::int AS cached FROM contract_risk_cache`,
  );
  if (!cached) return empty(true);

  const [payloadRow] = await allRows<{ payload: Payload }>(
    `SELECT r AS payload FROM procurement_risk_indexes_cache`,
  );
  // Explicit, because the bare destructure this replaces failed with "Cannot
  // destructure property 'payload' of 'undefined'" — which reads as a code bug
  // rather than the one-command fix it actually is.
  if (!payloadRow)
    throw new Error(
      "procurement_risk_indexes_cache is empty — run " +
        "`REFRESH MATERIALIZED VIEW procurement_risk_indexes_cache;` " +
        "(or npm run db:refresh:risk) and re-run",
    );
  const { payload } = payloadRow;

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
    nkidByEik: new Map(Object.entries(payload.nkidByEik ?? {})),
    splitPurchaseByKey: new Map(
      (payload.splitPurchase ?? []).map((s) => [
        `${s.awarderEik}|${s.contractorEik}|${s.cpvDiv}|${s.year}`,
        s as never,
      ]),
    ),
    normalizeName,
  };

  // appealUpheld resolves against upheld_ocids (042) DIRECTLY, never through the
  // risk_upheld_ocid view. 042 recreates upheld_ocids with DROP MATERIALIZED VIEW
  // … CASCADE, and that cascade takes risk_upheld_ocid with it; only
  // rebuild_contract_risk_cache() puts it back. Reading the view here meant every
  // КЗК appeals ingest silently disarmed this gate until the next contracts
  // reload — and because a missing relation matched the skip predicate below, it
  // disarmed it GREEN.
  //
  // ⚠️ Absence must emit `false`, NOT NULL. The SQL side treats this check as
  // always available and simply never firing (112: `true AS a_appeal`, fired off
  // an empty view). A NULL would arrive at the scorer as `undefined`, which marks
  // the check UNAVAILABLE (`contract.appealUpheld !== undefined`) and would then
  // disagree with SQL on every row in the corpus.
  const [upheld] = await allRows<{ present: boolean }>(
    `SELECT to_regclass('public.upheld_ocids') IS NOT NULL AS present`,
  );
  // Not defensive padding: silently falling back to `false` here would re-arm the
  // exact disarm this block removes, so an unreadable probe must throw.
  if (upheld === undefined)
    throw new Error("upheld_ocids presence probe returned no row");
  const appealExpr = upheld.present
    ? `EXISTS (SELECT 1 FROM upheld_ocids u WHERE u.ocid = c.ocid)`
    : `false`;

  // Deterministic sample: hashtext is stable for a given seed, so a failure is
  // reproducible rather than a different slice every run.
  const rows = await allRows<Row>(
    `SELECT c.key, c.tag, c.awarder_eik, c.contractor_eik, c.contractor_name,
            c.amount_eur, c.signing_amount_eur, c.cpv, c.date, c.date_signed,
            c.number_of_tenderers, c.procurement_method,
            c.procurement_method_rationale,
            c.tender_period_start_date, c.tender_period_end_date,
            ${appealExpr} AS appeal_upheld,
            r.cri AS sql_cri, r.score AS sql_score,
            r.available_mask AS sql_available_mask, r.fired_mask AS sql_fired_mask
       FROM contracts c
       JOIN contract_risk_cache r ON r.key = c.key
      ORDER BY hashtext(c.key || $1::text)
      LIMIT $2`,
    [String(seed), n],
  );

  const mismatches = new Map<string, number>();
  const coverage = new Map<string, number>();
  let criDiff = 0;
  let scoreDiff = 0;
  let decoderDiff = 0;
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
      if (sqlA) coverage.set(name, (coverage.get(name) ?? 0) + 1);
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

    // THIRD side of the comparison: the SPA decoder. The browser no longer runs
    // computeProcurementRisk for contracts — it decodes these two masks
    // (src/lib/contractRiskMask.ts), so "TS agrees with SQL" no longer implies
    // "the page agrees with SQL".
    //
    // What this specifically covers is the decoder's own arithmetic — the shift
    // in bit(), the availableCount/firedCount tallies, the cri rounding. It does
    // NOT cover a renumbered or dropped check: the decoder and CHECKS read the
    // same RISK_MASK_BITS array, so they would move together and agree while both
    // being wrong. EXPECTED_CHECK_ORDER at the top of this file is the only guard
    // against that — do not remove it on the strength of this comparison.
    const dec = contractRiskFromMasks({
      riskFiredMask: row.sql_fired_mask,
      riskAvailableMask: row.sql_available_mask,
    });
    if (!dec) {
      decoderDiff++;
      if (examples.length < 8)
        examples.push(
          `    ${row.key} decoder: returned null for non-null masks`,
        );
    } else {
      const decByKey = new Map(dec.components.map((c) => [c.key as string, c]));
      for (const name of CHECKS) {
        const d = decByKey.get(name);
        const c = byKey.get(name);
        if (
          d?.available !== (c?.available ?? false) ||
          d?.fired !== (c?.fired ?? false)
        ) {
          decoderDiff++;
          if (examples.length < 8)
            examples.push(
              `    ${row.key} ${name}: decoder a=${d?.available} f=${d?.fired} · ts a=${c?.available} f=${c?.fired}`,
            );
          break;
        }
      }
      if (dec.cri !== row.sql_cri) {
        decoderDiff++;
        if (examples.length < 8)
          examples.push(
            `    ${row.key} cri: decoder=${dec.cri} · sql=${row.sql_cri}`,
          );
      }
    }
  }

  return {
    compared: rows.length,
    mismatches,
    coverage,
    criDiff,
    scoreDiff,
    decoderDiff,
    examples,
    skipped: false,
  };
};

const main = async () => {
  const r = await runParity({
    n: Number(arg("n") ?? 20000),
    seed: Number(arg("seed") ?? 42),
  });
  if (r.skipped) {
    console.log(
      "· contract_risk_cache is empty — run rebuild_contract_risk_cache(); skipping",
    );
    await end();
    return;
  }

  console.log(`→ parity over ${r.compared} contracts`);
  const uncovered: string[] = [];
  for (const name of CHECKS) {
    const m = r.mismatches.get(name) ?? 0;
    const cov = r.coverage.get(name) ?? 0;
    if (cov === 0) uncovered.push(name);
    // A check nobody could evaluate is reported as "—", never as ✓. Zero
    // mismatches over zero evaluable rows is agreement about nothing, and it is
    // the one result that looks identical to a real pass.
    const mark = cov === 0 ? "—" : m === 0 ? "✓" : "✗";
    console.log(
      `  ${mark} ${name.padEnd(22)} ${m} mismatch(es)   available on ${cov}/${r.compared}`,
    );
  }
  if (uncovered.length)
    console.log(
      `  ! NOT EXERCISED by this sample (available on 0 rows): ${uncovered.join(", ")}\n` +
        "    Their parity is unproven here — the static gate\n" +
        "    (scripts/risk/risk_catalog_sql_parity.test.ts) is what covers their constants.",
    );
  console.log(
    `  ${r.criDiff === 0 ? "✓" : "✗"} cri differs on ${r.criDiff} · score differs on ${r.scoreDiff}`,
  );
  console.log(
    `  ${r.decoderDiff === 0 ? "✓" : "✗"} SPA mask decoder differs on ${r.decoderDiff}`,
  );
  if (r.examples.length) {
    console.log("  examples:");
    for (const e of r.examples) console.log(e);
  }

  const failed =
    r.mismatches.size > 0 ||
    r.criDiff > 0 ||
    r.scoreDiff > 0 ||
    r.decoderDiff > 0;
  if (failed) {
    const worst = [...r.mismatches.entries()].sort((a, b) => b[1] - a[1])[0];
    if (worst) console.error(`  worst: ${worst[0]} (${worst[1]} mismatches)`);

    // appealUpheld is the ONE check compared live-against-cached: this harness
    // reads upheld_ocids as it is now, while fired_mask bit 8 was frozen at the
    // last rebuild_contract_risk_cache(). A КЗК ingest between the two makes them
    // disagree with no rule drift whatsoever, so name that before sending anyone
    // to diff two scorers that are identical.
    if (r.mismatches.has("appealUpheld")) {
      const [v] = await allRows<{ stub: boolean }>(
        `SELECT to_regclass('public.risk_upheld_ocid') IS NULL
                AND to_regclass('public.upheld_ocids') IS NOT NULL AS stub`,
      );
      console.error(
        "\n· appealUpheld mismatches are usually STALENESS, not drift — this " +
          "harness reads upheld_ocids live, fired_mask bit 8 is frozen at the " +
          "last rebuild. Run `SELECT rebuild_contract_risk_cache();` and re-run " +
          "before suspecting the scorers.",
      );
      if (v?.stub)
        console.error(
          "  ↳ risk_upheld_ocid is ABSENT while upheld_ocids exists — that is " +
            "exactly the state 042's DROP … CASCADE leaves behind, so the cache " +
            "is near-certainly stale rather than wrong.",
        );
    }
  }

  await end();
  if (failed) {
    console.error(
      "\n✗ TS and SQL disagree. One of computeProcurementRisk.ts or " +
        "112_contract_risk_cache.sql has drifted — fix the rule in BOTH, or the " +
        "browser and the risk column will show different numbers for the same row.",
    );
    process.exit(1);
  }
  console.log("✓ parity holds");
};

// Reachability is decided STRUCTURALLY (dbReachable = can `SELECT 1` round-trip),
// never by matching an error string. The predicate this replaces was a regex, and
// regexes cannot express the boundary that matters here: `database "x" does not
// exist` is "no database" while `relation "x" does not exist` is a broken install,
// and they differ by one noun. The old one matched both, which is how a
// cascade-dropped view printed "skipped" against a fully loaded corpus. A regex
// also needs extending for every driver phrasing (`SASL: … client password must be
// a string`, `no pg_hba.conf entry`, `EAI_AGAIN`, socket `ENOENT`) and silently
// stops matching under a non-English lc_messages.
//
// With the probe first, the boundary is positional: a failure BEFORE it is no
// database; every failure after it is real and must surface.
const run = async () => {
  if (!(await dbReachable())) {
    console.log("· parity harness skipped (no database reachable)");
    await end().catch(() => {});
    return;
  }
  await main();
};

// Only when run as a script. runParity() is imported by
// scripts/db/tests/risk_parity.data.test.ts, and without this guard that import
// would also start the CLI — including its process.exit(1), which would take the
// whole vitest run down instead of failing one test.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  run().catch(async (e) => {
    console.error(
      "✗ risk_parity harness failed:",
      e instanceof Error ? e.message : String(e),
    );
    await end().catch(() => {});
    process.exit(1);
  });
}
