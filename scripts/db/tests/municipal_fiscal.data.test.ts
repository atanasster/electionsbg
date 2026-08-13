// Gate for the per-município fiscal corpus (migration 149) behind the „поети
// ангажименти" surfaces.
//
// The failure modes here are all 200s. In rough order of how badly they
// mislead:
//
//   1. WRONG NUMBER — the arrears sum drifts from the independently-parsed
//      national series. Both are МФ publications of one quantity, and they
//      agreed to the lev when this was built, so any gap is a defect rather
//      than a residual to explain away.
//   2. A VERDICT WE CANNOT SUPPORT — `meets_threshold` asserted on a partial
//      criteria set, or derived from a figure the ingest withheld. This one
//      names municipalities, which is what makes it the worst.
//   3. A LEGAL STATUS INFERRED FROM ARITHMETIC — `in_recovery_procedure`
//      tracking `meets_threshold` instead of the separate published list.
//   4. SILENT COVERAGE LOSS — a município stops resolving and simply vanishes.
//
// Auto-skips ONLY when Postgres is down. An empty table is a FAILURE, not a
// skip: the loader is unconditional in db:refresh and reads a committed input,
// so "no rows" means the chain broke rather than that this machine is unusual.
//
// That guarantee is per-GATE, not merely per-file. Several of these are
// count-zero or deepEqual-[] assertions, which an empty table satisfies
// trivially — so each calls `assertCorpusPresent()` first. Without it a
// half-loaded corpus turns four gates green while proving nothing, which is a
// worse state than a red file.

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { allRows, dbReachable, end } from "../lib/pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const haveDb = await dbReachable();
const skip = !haveDb ? "Postgres unreachable" : false;

afterAll(async () => {
  await end();
});

/** Guard for gates whose assertion an EMPTY table would satisfy trivially. */
const assertCorpusPresent = async (): Promise<void> => {
  const [r] = await allRows<{ n: string }>(
    `SELECT count(*) AS n FROM municipal_fiscal`,
  );
  assert.ok(
    Number(r.n) > 0,
    "municipal_fiscal is empty — this gate would pass vacuously; run db:load:municipal-fiscal:pg",
  );
};

test.skipIf(skip)("the corpus is loaded and complete per quarter", async () => {
  const rows = await allRows<{
    fiscal_year: number;
    quarter: number;
    n: string;
    distinct_mf: string;
  }>(
    `SELECT fiscal_year, quarter, count(*) AS n, count(DISTINCT mf_code) AS distinct_mf
     FROM municipal_fiscal GROUP BY 1,2 ORDER BY 1,2`,
  );
  assert.ok(
    rows.length > 0,
    "municipal_fiscal is empty — db:load:municipal-fiscal:pg did not run, or its input is missing",
  );
  for (const r of rows) {
    // 265 общини. Fewer means the crosswalk dropped somebody, which is silent
    // on every other check: the row simply is not there.
    assert.equal(
      Number(r.n),
      265,
      `${r.fiscal_year}-Q${r.quarter} has ${r.n} municipalities, expected 265`,
    );
    assert.equal(
      Number(r.distinct_mf),
      265,
      `${r.fiscal_year}-Q${r.quarter} has ${r.distinct_mf} distinct МФ codes for ${r.n} rows — two municipalities folded onto one`,
    );
  }
});

test.skipIf(skip)(
  "year-end arrears reconcile against the national series",
  async () => {
    // data/_cache/arrears.json is parsed independently, from a different МФ
    // publication (the year-end Обобщена справка). Measured 2026-08-12: the
    // two agree to the lev for 2024 — 143,017,277 лв = €73.1m — so the
    // tolerance is tight and any drift is a finding about that year's workbook.
    const cache = JSON.parse(
      readFileSync(
        resolve(__dirname, "../../../data/_cache/arrears.json"),
        "utf8",
      ),
    ) as {
      annual: {
        year: number;
        suspect: boolean;
        breakdownEurM: { local: number | null };
      }[];
    };
    const national = new Map(
      cache.annual
        .filter((a) => !a.suspect && a.breakdownEurM.local != null)
        .map((a) => [a.year, a.breakdownEurM.local as number]),
    );

    const ours = await allRows<{ fiscal_year: number; eur_m: number }>(
      `SELECT fiscal_year, sum(arrears_eur)/1e6 AS eur_m
       FROM municipal_fiscal WHERE quarter = 4 GROUP BY 1 ORDER BY 1`,
    );
    assert.ok(ours.length > 0, "no year-end rows to reconcile");

    // `want` is stored to one decimal, so its true value is within ±0.05.
    // That rounding granularity IS the tolerance — anything looser is slack we
    // chose rather than precision the source imposed. An earlier draft used
    // max(0.1, want*0.001), which on this corpus never reaches the relative arm
    // (no year exceeds €95.6m) and, with `got` pre-rounded, opened a ±€0.15m
    // band: wide enough to hide 195 of the 265 municipalities entirely.
    const TOLERANCE_EUR_M = 0.05 + 1e-9;
    const skipped: number[] = [];
    let compared = 0;
    for (const r of ours) {
      const want = national.get(r.fiscal_year);
      if (want == null) {
        skipped.push(r.fiscal_year);
        continue;
      }
      compared++;
      const got = Number(r.eur_m);
      assert.ok(
        Math.abs(got - want) <= TOLERANCE_EUR_M,
        `${r.fiscal_year} year-end arrears: municipal sum €${got.toFixed(3)}m vs ` +
          `national series €${want}m (tolerance ±€${TOLERANCE_EUR_M.toFixed(2)}m)`,
      );
    }
    assert.ok(
      compared > 0,
      `no year overlapped the national series — the reconciliation never ran ` +
        `(year-end years in the corpus: ${ours.map((o) => o.fiscal_year).join(", ") || "none"})`,
    );
    // Skips are legitimate (2022 is `suspect` in arrears.json) but must be
    // VISIBLE: a backfill that lands four year-ends and reconciles one is not
    // the same gate, and silence would not distinguish them.
    if (skipped.length > 0) {
      console.warn(
        `[municipal_fiscal] year-end arrears not reconciled for ${skipped.join(", ")} — ` +
          "absent or flagged suspect in arrears.json",
      );
    }
  },
);

test.skipIf(skip)(
  "verdicts exist only at year-end and only where they are decidable",
  async () => {
    await assertCorpusPresent();
    const [bad] = await allRows<{ midyear: string; undecidable: string }>(
      `SELECT
         count(*) FILTER (
           WHERE quarter <> 4
             AND (criteria_met IS NOT NULL OR criteria_evaluable IS NOT NULL
                  OR meets_threshold IS NOT NULL)) AS midyear,
         -- TRUE requires three actually met (decisive by monotonicity);
         -- FALSE requires all six evaluable. Anything else must be NULL.
         count(*) FILTER (
           WHERE (meets_threshold IS TRUE
                  AND coalesce(array_length(criteria_met, 1), 0) < 3)
              OR (meets_threshold IS FALSE
                  AND coalesce(array_length(criteria_evaluable, 1), 0) < 6)) AS undecidable
       FROM municipal_fiscal`,
    );
    assert.equal(
      Number(bad.midyear),
      0,
      "a чл. 130а verdict on a non-year-end row — the criteria are annual by construction",
    );
    assert.equal(
      Number(bad.undecidable),
      0,
      "a verdict asserted beyond what the evaluated criteria support",
    );
  },
);

test.skipIf(skip)(
  "a verdict is never derived from a withheld figure",
  async () => {
    // A published ratio can outlive its own numerator: on a frozen quarter the
    // ingest nulls the level while the percentage survives. Evaluating that
    // criterion would be a verdict about a figure we withheld as
    // unattributable.
    await assertCorpusPresent();
    const rows = await allRows<{ obshtina: string; fiscal_year: number }>(
      `SELECT obshtina, fiscal_year FROM municipal_fiscal
       WHERE quarter = 4 AND suppressed_fields IS NOT NULL
         AND (
           (2 = ANY(criteria_evaluable) AND 'expenseObligations' = ANY(suppressed_fields))
        OR (3 = ANY(criteria_evaluable) AND 'commitments'        = ANY(suppressed_fields))
        OR (4 = ANY(criteria_evaluable) AND 'arrears'            = ANY(suppressed_fields))
         )
       LIMIT 5`,
    );
    assert.deepEqual(
      rows,
      [],
      "a criterion was evaluated from a level the ingest suppressed",
    );

    // The above scans Q4 rows with suppression, and today there are NONE — the
    // frozen quarter is Q3, so the gate currently proves nothing. Say so out
    // loud rather than let a green tick imply otherwise. The hazard is real and
    // measurable on the quarters that DO have it: a ratio outliving its own
    // numerator. When МФ's rolling window puts the frozen column on a Q4, the
    // gate above starts biting and this warning goes quiet.
    const [live] = await allRows<{
      q4_suppressed: string;
      ratio_outlives: string;
    }>(
      `SELECT
         count(*) FILTER (WHERE quarter = 4 AND suppressed_fields IS NOT NULL) AS q4_suppressed,
         count(*) FILTER (
           WHERE commitments_eur IS NULL AND commitments_pct IS NOT NULL) AS ratio_outlives
       FROM municipal_fiscal`,
    );
    assert.ok(
      Number(live.ratio_outlives) > 0,
      "no row has a ratio outliving its numerator — the suppression the loader " +
        "guards against is absent from the corpus, so that guard is untested",
    );
    if (Number(live.q4_suppressed) === 0) {
      console.warn(
        "[municipal_fiscal] no year-end row carries suppressed_fields, so the " +
          "withheld-figure gate is vacuous on this corpus (frozen quarter is not Q4). " +
          `${live.ratio_outlives} row(s) do show a ratio outliving its numerator.`,
      );
    }
  },
);

test.skipIf(skip)(
  "recovery status is not derivable from the criteria",
  async () => {
    // Meeting >=3 criteria OBLIGES a чл. 130д procedure; being IN one is a
    // separate administratively-recorded state. If the two matched everywhere,
    // the parser has probably wired one from the other — and the page would be
    // asserting a legal status from an arithmetic test.
    const [r] = await allRows<{
      in_recovery: string;
      threshold_true: string;
      recovery_without_verdict: string;
    }>(
      `SELECT
         count(*) FILTER (WHERE in_recovery_procedure) AS in_recovery,
         count(*) FILTER (WHERE meets_threshold IS TRUE) AS threshold_true,
         count(*) FILTER (WHERE in_recovery_procedure
                            AND meets_threshold IS DISTINCT FROM true) AS recovery_without_verdict
       FROM municipal_fiscal WHERE quarter = 4`,
    );
    assert.ok(
      Number(r.in_recovery) > 0,
      "no município is in a чл. 130д procedure — the recovery sheet was not parsed",
    );
    // The discriminating half: municipalities in a procedure that our partial
    // criteria set cannot convict. If this were 0, the flag would be
    // indistinguishable from a derived one.
    assert.ok(
      Number(r.recovery_without_verdict) > 0,
      "every município in a recovery procedure also has a TRUE verdict — " +
        "in_recovery_procedure may have been derived rather than read from the sheet",
    );

    // The plan's T3.2a asks for BOTH directions — also a município meeting the
    // threshold that is NOT in a procedure. That one is 0 today, and asserting
    // it would red the suite for a reason that is not a defect: with only three
    // of six criteria evaluable, a TRUE verdict needs all three met, which is a
    // high enough bar that everyone clearing it is already in a procedure. The
    // count is reported so the day it stops being 0 is visible, but it is not
    // an assertion — a gate that must fail today is not a gate.
    const [other] = await allRows<{ n: string }>(
      `SELECT count(*) AS n FROM municipal_fiscal
       WHERE quarter = 4 AND meets_threshold IS TRUE AND NOT in_recovery_procedure`,
    );
    console.warn(
      `[municipal_fiscal] ${r.recovery_without_verdict} município(s) in a чл. 130д ` +
        `procedure without a TRUE verdict; ${other.n} with a TRUE verdict and no procedure. ` +
        "The second is expected to be 0 while only 3 of 6 criteria are evaluable.",
    );
  },
);

test.skipIf(skip)("every obshtina resolves in place_dim", async () => {
  // Run workbook -> dimension, never the reverse: place_dim holds 295 obshtina
  // rows against Bulgaria's 265 municipalities, so the other direction reports
  // 30 phantom failures. Sofia is the synthetic SOF00 and joins on
  // governance_code rather than code.
  await assertCorpusPresent();
  const rows = await allRows<{ obshtina: string }>(
    `SELECT DISTINCT mf.obshtina
     FROM municipal_fiscal mf
     WHERE NOT EXISTS (
       SELECT 1 FROM place_dim pd
       WHERE pd.kind = 'obshtina'
         AND coalesce(pd.governance_code, pd.code) = mf.obshtina)
     ORDER BY 1`,
  );
  assert.deepEqual(
    rows.map((r) => r.obshtina),
    [],
    "obshtina codes with no place_dim row — they render unlabelled",
  );
});

test.skipIf(skip)("the three stocks nest as a reported tendency", async () => {
  // commitments >= obligations >= arrears holds conceptually but the three
  // are measured on different bases, so a município can legitimately violate
  // it. Asserted as a SHARE, not per row: a jump means the column mapping
  // moved, not that one município is unusual.
  await assertCorpusPresent();
  const [r] = await allRows<{ n: string; violations: string }>(
    `SELECT count(*) AS n,
              count(*) FILTER (
                WHERE commitments_eur IS NOT NULL
                  AND expense_obligations_eur IS NOT NULL
                  AND commitments_eur < expense_obligations_eur) AS violations
       FROM municipal_fiscal`,
  );
  const share = Number(r.violations) / Math.max(Number(r.n), 1);
  assert.ok(
    share < 0.1,
    `${(share * 100).toFixed(1)}% of rows have commitments below obligations — ` +
      "expected well under 10%; a jump means the column mapping moved",
  );
});

test.skipIf(skip)("the serving functions answer", async () => {
  const [byObshtina] = await allRows<{ payload: unknown }>(
    `SELECT municipal_fiscal_by_obshtina('SOF00') AS payload`,
  );
  assert.ok(
    byObshtina.payload,
    "municipal_fiscal_by_obshtina returned nothing for Sofia",
  );

  const ranked = await allRows<{ obshtina: string }>(
    `SELECT obshtina FROM municipal_fiscal_ranking(NULL, 10)`,
  );
  assert.ok(ranked.length > 0, "municipal_fiscal_ranking returned no rows");

  // A NULL limit means UNBOUNDED, matching open_calls_list. GREATEST/LEAST
  // ignore NULLs, so the obvious clamp silently collapses this to one row.
  const unbounded = await allRows<{ obshtina: string }>(
    `SELECT obshtina FROM municipal_fiscal_ranking(NULL, NULL)`,
  );
  // Comparing against the 10-row call only catches the collapse-to-1 bug. The
  // sound form is equality with the actual year-end population: at 265 rows
  // every limit (NULL, the 300 default, the 1000 ceiling) returns the same
  // count, so a "bigger than 10" assertion would pass on a broken clamp too.
  const [pop] = await allRows<{ n: string }>(
    `SELECT count(*) AS n FROM municipal_fiscal
     WHERE quarter = 4
       AND fiscal_year = (SELECT max(fiscal_year) FROM municipal_fiscal WHERE quarter = 4)`,
  );
  assert.equal(
    unbounded.length,
    Number(pop.n),
    `a NULL limit returned ${unbounded.length} of ${pop.n} year-end rows — NULL must mean unbounded`,
  );
  assert.equal(ranked.length, 10, "an explicit limit was not honoured");

  const [national] = await allRows<{ payload: Record<string, unknown> }>(
    `SELECT municipal_fiscal_national() AS payload`,
  );
  const p = national.payload;
  assert.ok(p, "municipal_fiscal_national returned nothing");
  // Each total must be reported WITH the count behind it, or a suppressed
  // column publishes as a collapse rather than as unknown.
  for (const k of [
    "commitments_eur",
    "expense_obligations_eur",
    "arrears_eur",
  ]) {
    assert.ok(k in p, `national payload is missing ${k}`);
    assert.ok(
      `${k.replace(/_eur$/, "")}_n` in p,
      `national payload reports ${k} without its row count`,
    );
  }
  // NULL must not be counted as false — that would publish "0 municipalities
  // meet the threshold" beside a non-zero recovery count.
  for (const k of [
    "meets_threshold_n",
    "below_threshold_n",
    "threshold_unknown_n",
  ]) {
    assert.ok(k in p, `national payload is missing ${k}`);
  }
});
