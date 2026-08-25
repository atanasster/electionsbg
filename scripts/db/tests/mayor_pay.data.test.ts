// Gate for `mayor_pay_ranking()` / `mayor_pay_by_obshtina()` (migration 186), behind
// /governance/mayor-pay and the /governance/:id stat tile.
//
// The trap these functions exist to avoid, and the one most likely to be
// reintroduced by a well-meaning "simplification": summing every declared
// income category for a mayor (rent, dividends, another employer) instead of
// reading the ONE "Годишна данъчна основа от трудови доходи" row. Both read as
// "the mayor's declared income" in a code review; only one is what the site
// audited against the source article actually reports. §1 re-derives the
// figure independently, per row, and would not catch a bug that summed
// consistently across every row — so it is paired with §2's *targeted* check
// on a person known (2026-08-25) to carry a second income row.
//
// Auto-skips ONLY when Postgres is down. `municipal_officials_table` /
// `declaration` / `declaration_income` are populated by chain steps that run
// on every `db:refresh`, so an empty result here is a corpus defect, not an
// unusual machine — every assertion below calls `assertBenchPresent()` first
// so a half-loaded corpus cannot pass any of them vacuously.

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, dbReachable, end } from "../lib/pg";
import { reportSkip } from "../../lib/report_skip";

const haveDb = await dbReachable();
const skip = !haveDb ? "Postgres unreachable" : false;
reportSkip(import.meta.url, skip);

afterAll(async () => {
  await end();
});

interface MayorPayRow {
  obshtina: string;
  name_bg: string;
  name_en: string | null;
  oblast_code: string | null;
  mayor_name: string;
  mayor_slug: string | null;
  declaration_id: string | null;
  fiscal_year: number | null;
  source_url: string | null;
  income_eur: string | null;
  population: number | null;
  income_per_1000_residents_eur: string | null;
}

const assertBenchPresent = async (): Promise<void> => {
  const [r] = await allRows<{ n: string }>(
    `SELECT count(*) AS n FROM municipal_officials_table
     WHERE role = 'mayor' AND is_sitting AND district IS NULL`,
  );
  assert.ok(
    Number(r.n) > 0,
    "no sitting city-wide mayors in municipal_officials_table — this gate would pass vacuously; run db:resolve:persons",
  );
};

test.skipIf(skip)(
  "the ranking covers most of the country, once per município",
  async () => {
    await assertBenchPresent();
    const rows = await allRows<MayorPayRow>(
      `SELECT * FROM mayor_pay_ranking(NULL)`,
    );
    // Bulgaria has 265 municipalities. Unlike municipal_fiscal (a fully-loaded
    // committed corpus), this reads LIVE declaration filings, so a handful of
    // sitting mayors legitimately have no FY on file yet — the floor is a
    // sanity check, not the exact count municipal_fiscal.data.test.ts asserts.
    assert.ok(
      rows.length >= 200 && rows.length <= 265,
      `mayor_pay_ranking returned ${rows.length} municipalities, expected 200-265`,
    );
    const codes = new Set(rows.map((r) => r.obshtina));
    assert.equal(
      codes.size,
      rows.length,
      "a município appears more than once — the district IS NULL / DISTINCT ON bench filter regressed",
    );
    // COALESCE(pd.name_bg, p.obshtina) means a broken place_dim join is
    // invisible in the type system — it silently prints the CODE instead of a
    // name. Catch it by asserting no name_bg equals its own obshtina code.
    for (const r of rows) {
      assert.notEqual(
        r.name_bg,
        r.obshtina,
        `${r.obshtina}: name_bg fell back to the raw code — place_dim join is not resolving this município`,
      );
    }
  },
);

test.skipIf(skip)(
  "income_eur is the labor-income row alone, never a sum across categories",
  async () => {
    await assertBenchPresent();
    const rows = await allRows<MayorPayRow>(
      `SELECT * FROM mayor_pay_ranking(NULL)`,
    );
    const withIncome = rows.filter((r) => r.declaration_id != null);
    assert.ok(
      withIncome.length > 0,
      "no ranked mayor resolved a declaration at all — the subject_ref/official_slug join broke",
    );
    // Re-derive independently: read the exact income row this declaration
    // carries under the canonical category, and require an exact match. A
    // regression that switched to summing every category would move this for
    // any município whose mayor declared more than one income row — which is
    // why the sample below is not filtered to single-row declarations.
    const sample = withIncome.slice(0, 40);
    for (const r of sample) {
      const [expected] = await allRows<{ eur_declarant: string | null }>(
        `SELECT eur_declarant FROM declaration_income
         WHERE declaration_id = $1
           AND category = 'Годишна данъчна основа от трудови доходи'`,
        [r.declaration_id],
      );
      const expectedEur =
        expected?.eur_declarant == null ? null : Number(expected.eur_declarant);
      const actualEur = r.income_eur == null ? null : Number(r.income_eur);
      if (expectedEur == null) {
        assert.equal(
          actualEur,
          null,
          `${r.obshtina}: declaration ${r.declaration_id} has no labor-income row, but income_eur is ${actualEur}`,
        );
      } else {
        assert.ok(
          actualEur != null && Math.abs(actualEur - expectedEur) < 0.01,
          `${r.obshtina}: income_eur ${actualEur} does not match the single labor-income row ${expectedEur} — looks like it is summing categories`,
        );
      }
    }
  },
);

test.skipIf(skip)(
  "Несебър (BGS15): income_eur is the labor-income row alone, not the multi-row sum",
  async () => {
    // The migration's own named motivating example (186 header): this
    // declaration also carries a ~51,129 EUR rental-income row for the
    // declarant. Несебър ranks well outside the top of the per-1000 sort
    // (163rd of 261, measured 2026-08-25), so the generic sample above — which
    // reads the ranking's own top rows — does not happen to cover it.
    const [row] = await allRows<MayorPayRow>(
      `SELECT * FROM mayor_pay_ranking(NULL) x WHERE obshtina = 'BGS15'`,
    );
    assert.ok(row, "Несебър (BGS15) is missing from the ranking entirely");
    assert.ok(
      row.income_eur != null,
      "Несебър's mayor has no income_eur — the declaration/category join broke",
    );
    assert.ok(
      Number(row.income_eur) < 65_000,
      `Несебър income_eur is ${row.income_eur} — expected ~61,038 (the labor-income row alone); ` +
        `a figure this high looks like it summed in the ~51,129 EUR rental-income row too`,
    );
  },
);

test.skipIf(skip)(
  "mayor_pay_by_obshtina's rank/ranked_count match an independent re-derivation",
  async () => {
    await assertBenchPresent();
    const rows = await allRows<MayorPayRow>(
      `SELECT * FROM mayor_pay_ranking(NULL)`,
    );
    const ranked = rows
      .filter((r) => r.income_per_1000_residents_eur != null)
      .sort(
        (a, b) =>
          Number(b.income_per_1000_residents_eur) -
          Number(a.income_per_1000_residents_eur),
      );
    // A município with a computable ratio AND one without, so both branches of
    // `mayor_pay_by_obshtina`'s CASE (rank vs. null) get exercised.
    const withRatio = rows.find((r) => r.income_per_1000_residents_eur != null);
    const withoutRatio = rows.find(
      (r) => r.income_per_1000_residents_eur == null,
    );
    assert.ok(withRatio, "no ranked município has a computable ratio at all");
    for (const sample of [withRatio, withoutRatio].filter(
      (r): r is MayorPayRow => r != null,
    )) {
      const [{ r }] = await allRows<{
        r: MayorPayRow & { rank: number | null; ranked_count: number };
      }>(`SELECT mayor_pay_by_obshtina($1) AS r`, [sample.obshtina]);
      assert.equal(
        r.ranked_count,
        ranked.length,
        `${sample.obshtina}: ranked_count ${r.ranked_count} != the independently counted peer set ${ranked.length}`,
      );
      if (sample.income_per_1000_residents_eur == null) {
        assert.equal(
          r.rank,
          null,
          `${sample.obshtina}: has no ratio but got a rank`,
        );
      } else {
        const wantRank =
          ranked.findIndex((x) => x.obshtina === sample.obshtina) + 1;
        assert.equal(
          r.rank,
          wantRank,
          `${sample.obshtina}: rank ${r.rank} != independently derived ${wantRank}`,
        );
      }
    }
  },
);

test.skipIf(skip)(
  "a município with two concurrent sitting-mayor listings is refused, not guessed",
  async () => {
    // See 186's header: PAZ20 and RSE04 (measured 2026-08-25) each briefly carry
    // two "sitting, no district" mayor listings with a real Annualy Кмет 2025
    // filing apiece, and nothing on the roster says which is current. The
    // function drops such municipalities rather than picking one by string
    // sort — this pins the refusal so a future change that reintroduces a
    // tie-break guess fails here instead of shipping a wrong name silently.
    const rows = await allRows<MayorPayRow>(
      `SELECT * FROM mayor_pay_ranking(NULL) WHERE obshtina IN ('PAZ20','RSE04')`,
    );
    assert.deepEqual(
      rows,
      [],
      "an ambiguous município (two candidates each with a valid filing) was resolved to one row instead of refused",
    );
  },
);

test.skipIf(skip)(
  "the per-1000-residents ratio is null iff either input is, and arithmetically correct otherwise",
  async () => {
    await assertBenchPresent();
    const rows = await allRows<MayorPayRow>(
      `SELECT * FROM mayor_pay_ranking(NULL)`,
    );
    for (const r of rows) {
      const income = r.income_eur == null ? null : Number(r.income_eur);
      const pop = r.population;
      const ratio =
        r.income_per_1000_residents_eur == null
          ? null
          : Number(r.income_per_1000_residents_eur);
      if (income == null || pop == null || pop <= 0) {
        assert.equal(
          ratio,
          null,
          `${r.obshtina}: ratio is ${ratio} despite income=${income}, population=${pop} — a missing input must not silently become a number`,
        );
      } else {
        const want = (income / pop) * 1000;
        assert.ok(
          ratio != null && Math.abs(ratio - want) < 0.01,
          `${r.obshtina}: ratio ${ratio} != income/population*1000 (${want})`,
        );
      }
    }
  },
);

test.skipIf(skip)(
  "Sofia resolves through the governance_code bridge, like municipal_fiscal",
  async () => {
    const [row] = await allRows<{ r: MayorPayRow | null }>(
      `SELECT mayor_pay_by_obshtina('SFO_CITY') AS r`,
    );
    assert.ok(row.r, "mayor_pay_by_obshtina('SFO_CITY') returned no row");
    assert.equal(row.r!.obshtina, "SFO_CITY");
    assert.ok(
      row.r!.population != null && row.r!.population > 1_000_000,
      `Sofia's population resolved as ${row.r!.population} — the obshtina_population join (via place_dim.governance_code) is not bridging SFO_CITY -> SOF00`,
    );
  },
);

test.skipIf(skip)(
  "an unknown obshtina returns null, not an error or a fabricated row",
  async () => {
    const [row] = await allRows<{ r: MayorPayRow | null }>(
      `SELECT mayor_pay_by_obshtina('NOPE99') AS r`,
    );
    assert.equal(row.r, null);
  },
);
