// Gate for the dated FX conversion of foreign-currency declaration rows.
//
// WHAT IT PROTECTS. A USD/GBP/CHF asset row whose declarant left the „Равностойност" cell
// blank used to be stored with `amount` + `currency` and a NULL `value_eur`, and dropped out
// of every wealth aggregate silently — 462 rows over 163 people, 356 of them on filings
// person_wealth_year publishes. `excluded_asset_rows` reported 0 for all 280 affected
// person-years, which is worse than a wrong total: that field exists so a consumer can tell an
// incomplete total from a whole one, so a 0 there ASSERTS that nothing is missing.
//
// Those rows are now converted at the ECB reference rate for the end of the period the filing
// covers and stamped `value_basis = 'fx_ecb'`; anything still unvalued must be COUNTED.
// See docs/plans/declaration-fx-conversion-v1.md.
//
// THE INVERSION TRAP IS WHY THE ANCHOR ARM EXISTS. `1/0.9 = 1.11` and `0.9` are both plausible
// numbers, every row count reconciles either way, and near parity a tolerance band does not
// separate them: inverting USD 2016 moves it from +10.4% off the declarant median to +22.7%,
// and both sit inside any band loose enough to admit the real corpus. The hand-verified
// anchors are what actually catch a flipped or year-shifted table.
//
// Auto-skips when Postgres is down or the corpus is empty.
//
//   npm run test:data

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, end } from "../lib/pg";
import fxTable from "../../../data/declarations/fx_year_end.json";

const RATES = fxTable as Record<string, Record<string, number>>;

/** Hand-verified against the ECB's published euro reference rates for the last quoted day of
 *  each year, as EUR per ONE unit. These are the inversion / off-by-one-year guard: a table
 *  built the wrong way up, or shifted a year, fails here and nowhere else. */
const ANCHORS: Array<[string, string, number]> = [
  ["USD", "2019", 0.890155],
  ["USD", "2021", 0.882924],
  ["CHF", "2022", 1.015538],
  ["GBP", "2024", 1.206011],
];

/** Rates outside these bands are not "slightly off" — they are a different quantity (an
 *  inverted rate, a per-EUR quote, a scale error). */
const PLAUSIBLE: Record<string, [number, number]> = {
  USD: [0.6, 1.2],
  GBP: [1.0, 1.7],
  CHF: [0.55, 1.2],
};

/** The fixed-rate spellings, folded the way `asset_unit_norm` folds them. 'fx_ecb' on any of
 *  these would mean the dated table had swallowed a currency the peg owns. */
const FIXED_RATE_UNITS = [
  "BGN",
  "EUR",
  "ЕВРО",
  "ЕВРА",
  "ЕUR",
  "ВGN",
  "ЛВ",
  "ЛЕВ",
  "ЛЕВА",
  "ФЖХ",
];

const reachable = async (): Promise<boolean> => {
  try {
    const [t] = await allRows<{ ok: boolean }>(
      "SELECT to_regclass('public.declaration_asset') IS NOT NULL AS ok",
    );
    if (!t?.ok) return false;
    const [c] = await allRows<{ n: string }>(
      "SELECT count(*) n FROM declaration_asset",
    );
    return Number(c.n) > 0;
  } catch {
    return false;
  }
};

// A corpus that predates the backfill has value_basis NULL everywhere. That is a legitimate
// state — it serves exactly what it served before — but every assertion below would then pass
// vacuously. Skip with a DISTINCT reason, so "this corpus has no basis yet" can never read as
// "the rule is enforced".
const stamped = async (): Promise<boolean> => {
  const [c] = await allRows<{ n: string }>(
    "SELECT count(*) n FROM declaration_asset WHERE value_basis IS NOT NULL",
  );
  return Number(c.n) > 0;
};

const haveDb = await reachable();
const haveBasis = haveDb ? await stamped() : false;
const skip = !haveDb
  ? "Postgres unreachable / declaration_asset empty"
  : !haveBasis
    ? "declaration_asset.value_basis is entirely NULL — run scripts/declarations/backfill_asset_fx.ts --apply, then reload"
    : false;

afterAll(async () => {
  await end();
});

// ---------------------------------------------------------------------------
// 1. The rate table itself. No database needed — these run everywhere.
// ---------------------------------------------------------------------------
test("the FX table matches the hand-verified ECB anchors exactly", () => {
  for (const [ccy, year, expected] of ANCHORS) {
    assert.equal(RATES[ccy]?.[year], expected, `${ccy} ${year}`);
  }
});

test("every FX rate sits inside its currency's plausible band", () => {
  for (const [ccy, [lo, hi]] of Object.entries(PLAUSIBLE)) {
    const years = RATES[ccy];
    assert.ok(years, `no rates for ${ccy}`);
    for (const [year, rate] of Object.entries(years)) {
      assert.ok(
        rate > lo && rate < hi,
        `${ccy} ${year} = ${rate} is outside [${lo}, ${hi}] — inverted or mis-scaled`,
      );
    }
  }
});

// ---------------------------------------------------------------------------
// 2. THE INVARIANT THE AUDIT ASKED FOR. An unvalued money row is a hole in the total, and the
//    total has to say so.
// ---------------------------------------------------------------------------
test.skipIf(skip)(
  "every unvalued money row is counted in excluded_asset_rows",
  async () => {
    const rows = await allRows<{
      person_id: string;
      period_year: number;
      excluded: number;
      unvalued: string;
    }>(
      `WITH per_year AS (
         SELECT w.person_id, w.period_year, w.excluded_asset_rows AS excluded,
                count(*) FILTER (WHERE a.value_eur IS NULL AND a.amount IS NOT NULL)
                  AS unvalued
           FROM person_wealth_year w
           JOIN declaration_asset a ON a.declaration_id = w.declaration_id
          WHERE is_declared_holding(a.table_num)
          GROUP BY 1, 2, 3
       )
       SELECT * FROM per_year WHERE unvalued > 0 AND excluded < unvalued`,
    );
    assert.equal(
      rows.length,
      0,
      `${rows.length} person-year(s) publish a total with uncounted unvalued rows, e.g. ` +
        rows
          .slice(0, 5)
          .map(
            (r) =>
              `person ${r.person_id}/${r.period_year}: ${r.unvalued} unvalued, ${r.excluded} counted`,
          )
          .join("; "),
    );
  },
);

// NON-VACUITY for the assertion above: with nothing ever unvalued it would pass on an empty
// set and stop meaning anything. The residue is real — filings whose shard row set disagrees
// with a fresh parse, left uncorrected on purpose — and it must stay visible.
test.skipIf(skip)(
  "an unvalued residue still exists, counted rather than converted",
  async () => {
    const [c] = await allRows<{ n: string }>(
      `SELECT count(*) n FROM declaration_asset
        WHERE value_eur IS NULL AND amount IS NOT NULL AND currency IS NOT NULL`,
    );
    const n = Number(c.n);
    assert.ok(
      n > 0,
      "no unvalued money rows at all — the residue arm above is now vacuous",
    );
    // A residue that GROWS means the parser stopped converting something it used to.
    assert.ok(n < 50, `unvalued residue grew to ${n} rows (was 8)`);
  },
);

// ---------------------------------------------------------------------------
// 3. The basis column means what it says.
// ---------------------------------------------------------------------------
test.skipIf(skip)("every valued row carries a basis", async () => {
  const [c] = await allRows<{ n: string }>(
    `SELECT count(*) n FROM declaration_asset
      WHERE value_eur IS NOT NULL AND value_basis IS NULL`,
  );
  assert.equal(
    Number(c.n),
    0,
    `${c.n} valued row(s) have no value_basis — a euro figure nobody can attribute`,
  );
});

test.skipIf(skip)("only the declared basis vocabulary appears", async () => {
  const rows = await allRows<{ value_basis: string }>(
    "SELECT DISTINCT value_basis FROM declaration_asset WHERE value_basis IS NOT NULL",
  );
  const known = new Set(["equiv", "peg", "fx_ecb", "legacy"]);
  const unknown = rows.map((r) => r.value_basis).filter((b) => !known.has(b));
  assert.deepEqual(
    unknown,
    [],
    `unknown value_basis: ${unknown.join(", ")} — a typo, or a path nobody decided on`,
  );
});

// 'fx_ecb' MEANS "the declarant did not state this". If it lands on a currency the peg owns,
// the column stops being able to answer the only question it exists for.
test.skipIf(skip)("fx_ecb never lands on a fixed-rate currency", async () => {
  const rows = await allRows<{ currency: string; n: string }>(
    `SELECT currency, count(*) n FROM declaration_asset
        WHERE value_basis = 'fx_ecb'
          AND upper(regexp_replace(coalesce(currency, ''), '[^[:alnum:]]', '', 'g'))
              = ANY($1::text[])
        GROUP BY 1`,
    [FIXED_RATE_UNITS],
  );
  assert.deepEqual(
    rows,
    [],
    `fx_ecb applied to a peg currency: ${rows.map((r) => `${r.currency}×${r.n}`).join(", ")}`,
  );
});

// ---------------------------------------------------------------------------
// 4. CALIBRATION — and note the `value_basis = 'equiv'` filter, which is the whole point. The
//    comparison is against what DECLARANTS computed for the same currency-year; including our
//    own converted rows would calibrate the table against itself and pass by construction.
//    25% is chosen against a measured maximum gap of 10.4% (USD 2016).
// ---------------------------------------------------------------------------
const DECLARANT_MEDIANS = `
  SELECT upper(btrim(a.currency)) AS ccy,
         COALESCE(d.fiscal_year, d.declaration_year) AS yr,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY a.value_eur / a.amount) AS med
    FROM declaration_asset a
    JOIN declaration d USING (declaration_id)
   WHERE a.value_basis = 'equiv' AND a.amount > 0 AND a.value_eur IS NOT NULL
     AND a.category IN ('bank', 'cash')
   GROUP BY 1, 2
  HAVING count(*) >= 20`;

test.skipIf(skip)(
  "converted rates agree with the declarants' own arithmetic",
  async () => {
    const rows = await allRows<{
      ccy: string;
      yr: number;
      rate: string;
      med: string;
      compared: string;
    }>(
      `WITH declarant AS (${DECLARANT_MEDIANS}),
       ours AS (
         SELECT upper(btrim(a.currency)) AS ccy,
                COALESCE(d.fiscal_year, d.declaration_year) AS yr,
                a.value_eur / a.amount AS rate
           FROM declaration_asset a JOIN declaration d USING (declaration_id)
          WHERE a.value_basis = 'fx_ecb' AND a.amount > 0
       )
       SELECT DISTINCT o.ccy, o.yr, o.rate::text AS rate, x.med::text AS med,
              count(*) OVER () ::text AS compared
         FROM ours o JOIN declarant x ON x.ccy = o.ccy AND x.yr = o.yr
        WHERE abs(o.rate - x.med) / x.med > 0.25`,
    );
    assert.equal(
      rows.length,
      0,
      `converted at a rate the declarants disagree with: ` +
        rows
          .map((r) => `${r.ccy} ${r.yr}: ours ${r.rate} vs median ${r.med}`)
          .join("; "),
    );
  },
);

// Non-vacuity for the arm above — it joins on (currency, year), so a table that stopped
// producing fx_ecb rows, or a median set that went empty, satisfies it with zero comparisons.
test.skipIf(skip)("the calibration arm actually compares rows", async () => {
  const [c] = await allRows<{ n: string }>(
    `WITH declarant AS (${DECLARANT_MEDIANS})
       SELECT count(*) n
         FROM declaration_asset a
         JOIN declaration d USING (declaration_id)
         JOIN declarant x ON x.ccy = upper(btrim(a.currency))
                         AND x.yr = COALESCE(d.fiscal_year, d.declaration_year)
        WHERE a.value_basis = 'fx_ecb' AND a.amount > 0`,
  );
  assert.ok(
    Number(c.n) > 100,
    `only ${c.n} converted rows had a declarant median to compare against — the calibration arm is near-vacuous`,
  );
});

// ---------------------------------------------------------------------------
// 5. person_wealth_year reports the imputed share, and the conversion actually moved it.
// ---------------------------------------------------------------------------
test.skipIf(skip)(
  "person_wealth_year's imputed columns match a re-derivation from the rows",
  async () => {
    // A DIRECT re-derivation rather than a proxy. The first cut asserted "imputed rows imply
    // a non-zero imputed total", which is not true of the corpus: two declarants wrote a
    // literal 0 in the amount cell, so their converted row is worth exactly €0 and the
    // person-year correctly reports one imputed row and no imputed money. Re-deriving both
    // columns catches the drift that proxy was reaching for — a filter applied to one arm and
    // not the other — without the false positive.
    const rows = await allRows<{
      person_id: string;
      period_year: number;
      stored_rows: number;
      derived_rows: string;
      stored_eur: string;
      derived_eur: string;
    }>(
      `WITH derived AS (
         SELECT w.person_id, w.period_year,
                count(*) FILTER (WHERE a.value_basis = 'fx_ecb') AS derived_rows,
                round(COALESCE(SUM(
                  CASE WHEN a.category = 'credit_limit' THEN 0
                       WHEN a.category = 'debt' THEN -a.value_eur
                       WHEN a.value_eur > asset_row_ceiling_eur() THEN 0
                       ELSE a.value_eur * asset_share_multiplier(a.share, a.category) END
                ) FILTER (WHERE a.value_basis = 'fx_ecb'), 0)) AS derived_eur,
                w.imputed_asset_rows AS stored_rows, w.imputed_eur AS stored_eur
           FROM person_wealth_year w
           JOIN declaration_asset a ON a.declaration_id = w.declaration_id
          WHERE is_declared_holding(a.table_num)
          GROUP BY w.person_id, w.period_year, w.imputed_asset_rows, w.imputed_eur
       )
       SELECT person_id, period_year, stored_rows, derived_rows::text AS derived_rows,
              stored_eur::text AS stored_eur, derived_eur::text AS derived_eur
         FROM derived
        WHERE stored_rows <> derived_rows OR stored_eur <> derived_eur
        LIMIT 10`,
    );
    assert.equal(
      rows.length,
      0,
      `imputed columns disagree with the rows they summarise: ` +
        rows
          .map(
            (r) =>
              `person ${r.person_id}/${r.period_year}: stored ${r.stored_rows}r/€${r.stored_eur} vs derived ${r.derived_rows}r/€${r.derived_eur}`,
          )
          .join("; "),
    );
  },
);

// Non-vacuity: the re-derivation above compares nothing if no person-year has an imputed row.
test.skipIf(skip)(
  "some person-years actually report imputed rows",
  async () => {
    const [r] = await allRows<{ py: string; imp: string }>(
      `SELECT count(*) py, sum(imputed_asset_rows) imp
         FROM person_wealth_year WHERE imputed_asset_rows > 0`,
    );
    assert.ok(
      Number(r.py) > 100,
      `only ${r.py} person-year(s) report an imputed row`,
    );
    assert.ok(Number(r.imp) > 0, "no imputed rows counted at all");
  },
);

// MUTATION CHECK. Every assertion above is satisfiable by a matview that never converted
// anything, if the corpus happened to hold no foreign rows. Assert the totals MOVE.
test.skipIf(skip)(
  "the totals would be materially smaller without the conversion",
  async () => {
    const [r] = await allRows<{
      published: string;
      without_fx: string;
      moved: string;
    }>(
      `SELECT round(sum(net_eur))::text AS published,
              round(sum(net_eur) - sum(imputed_eur))::text AS without_fx,
              count(*) FILTER (WHERE imputed_eur <> 0)::text AS moved
         FROM person_wealth_year`,
    );
    assert.ok(
      Number(r.moved) > 100,
      `only ${r.moved} person-years moved — the conversion is barely doing anything`,
    );
    assert.ok(
      Math.abs(Number(r.published) - Number(r.without_fx)) > 1_000_000,
      `conversion moves only €${Math.abs(Number(r.published) - Number(r.without_fx))}`,
    );
  },
);

// The defect in its original shape: a published person-year whose net worth had the WRONG
// SIGN because its foreign rows were dropped. Владимир Табутов 2023 was published at
// −€121,331 (declared net liabilities) against a true +€504,142. A sign flip is the proof the
// conversion changed a published CLAIM and not merely a magnitude.
test.skipIf(skip)(
  "conversion flips at least one published net worth back to its true sign",
  async () => {
    const [c] = await allRows<{ n: string }>(
      `SELECT count(*) n FROM person_wealth_year
        WHERE imputed_eur <> 0 AND sign(net_eur) <> sign(net_eur - imputed_eur)`,
    );
    assert.ok(
      Number(c.n) > 0,
      "no person-year changed sign — the wrong-sign case this test exists for is unrepresented",
    );
  },
);
