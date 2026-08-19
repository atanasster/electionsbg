// PG-backed gate for the two-person declaration comparison (scripts/person/compare_declarations.ts).
//
// WHY THIS TEST. Every assertion here is a sentence the card would otherwise publish about
// two named living people. The gate's job is to refuse a comparison that reads as a fact and
// is an artifact of which FORM each person filed — so these are correctness tests about
// claims, not about formatting.
//
// The rules, each grounded in a corpus measurement recorded in the CLI's header:
//   - match on (period_year, form class), never year alone;
//   - `credit_limit` is neither an asset nor a debt;
//   - a co-owned property is declared WHOLE and must be weighted, not summed per co-owner;
//   - a metric whose rows are substantially unpriced leaves the comparison, and the total;
//   - a metric excluded only because it cannot be a ROW on this form stays IN the total;
//   - the debt figure is never dropped and never zeroed.
//
// Auto-skips when Postgres is down or the corpus is empty, like the other *.data.test.ts
// gates, so CI (no container) skips it.
//
//   npm run test:data

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, end } from "../lib/pg";
import {
  compareDeclarations,
  MAX_UNVALUED_SHARE,
} from "../../person/compare_declarations";
import { VERSUS_METRICS } from "../../posts/cardKit";
import { propertyKind, type PropertyKind } from "../../../src/lib/propertyKind";

/** The fixture pair the whole skill was designed against: Бойко Рашков and Иван Демерджиев.
 *  Both are MPs, so their slugs are stable `mp-*` ids rather than name-derived hashes. */
const RASHKOV = "mp-5254";
const DEMERDZHIEV = "mp-5104";

const reachable = async (): Promise<boolean> => {
  try {
    const [t] = await allRows<{ ok: boolean }>(
      "SELECT to_regclass('public.declaration_asset') IS NOT NULL AS ok",
    );
    if (!t?.ok) return false;
    // Every precondition the gate itself needs, not just the two tables: 090's helper
    // functions (the gate reads both), the income table, and the active/public-figure
    // predicate the serving layer gates on — a fixture person who is neither would make
    // every test skip-or-fail for a reason that is not the code's.
    const [fns] = await allRows<{ ok: boolean }>(
      `SELECT to_regproc('public.asset_share_multiplier') IS NOT NULL
          AND to_regproc('public.asset_row_ceiling_eur') IS NOT NULL
          AND to_regclass('public.declaration_income') IS NOT NULL AS ok`,
    );
    if (!fns?.ok) return false;
    const [c] = await allRows<{ n: string }>(
      `SELECT count(*) n FROM person
        WHERE slug IN ($1, $2) AND status = 'active' AND is_public_figure`,
      [RASHKOV, DEMERDZHIEV],
    );
    return Number(c.n) === 2;
  } catch {
    return false;
  }
};

const haveDb = await reachable();
const skip = haveDb ? false : "Postgres unreachable / fixture people absent";

afterAll(async () => {
  await end();
});

type Gate = {
  picked: { klass: string; yearA: number; yearB: number; office?: string };
  isLatestForBoth: boolean;
  droppedMetrics: {
    metric: string;
    slug: string;
    unvalued: number;
    rows: number;
  }[];
  inTotal: string[];
  inTotalNotShown: string[];
  totals: Record<
    string,
    { assetsEur: number; debtsEur: number; netEur: number }
  >;
};

test.skipIf(skip)(
  "picks the NEWEST common (year, class), which for the fixture is 2023/inventory",
  async () => {
    const { gate, card } = await compareDeclarations({
      slugA: RASHKOV,
      slugB: DEMERDZHIEV,
    });
    const g = gate as unknown as Gate;
    // NOT 2022/annual. Рашков filed an Entry and Демерджиев a Vacate covering 2023, so 2023
    // has a common INVENTORY class; `annual` only breaks a tie WITHIN a year. The plan
    // predicted 2022 and was wrong — this asserts the rule, not the prediction.
    assert.equal(g.picked.yearA, 2023);
    assert.equal(g.picked.yearB, 2023);
    assert.equal(g.picked.klass, "inventory");
    // Both sides must be on the same form, or the card is comparing two instruments.
    assert.equal(card.versus.left.formClass, card.versus.right.formClass);
    assert.equal(card.versus.left.formClass, "inventory");
    // 2023 is neither man's latest filing year, so the card has to say so.
    assert.equal(g.isLatestForBoth, false);
    assert.ok(
      card.yearNote && card.yearNote.length > 0,
      "a non-latest year must carry a note on the card",
    );
  },
);

test.skipIf(skip)(
  "refuses a year the two filed on different forms rather than pairing them",
  async () => {
    // 2023/annual is the genuinely asymmetric case: Рашков filed an annual covering 2023 and
    // Демерджиев did not (his 2023 filing is a Vacate). Forcing it must refuse rather than
    // pair an annual against an inventory. (An earlier draft named 2022/inventory, which
    // NEITHER man has — so it refused for the wrong reason and asserted nothing about the
    // class rule.)
    const [asym] = await allRows<{ n: string }>(
      `SELECT count(DISTINCT p.slug) n
         FROM declaration d JOIN person p USING (person_id)
        WHERE p.slug IN ($1, $2)
          AND COALESCE(d.fiscal_year, d.declaration_year) = 2023
          AND d.declaration_type = 'Annualy'`,
      [RASHKOV, DEMERDZHIEV],
    );
    assert.equal(
      Number(asym.n),
      1,
      "fixture assumes exactly one of the two filed a 2023 annual",
    );
    await assert.rejects(
      () =>
        compareDeclarations({
          slugA: RASHKOV,
          slugB: DEMERDZHIEV,
          year: 2023,
          klass: "annual",
        }),
      /no common \(year, form class\)/,
    );
  },
);

test.skipIf(skip)(
  "a declared property never becomes a ROW on an annual card",
  async () => {
    // The class rule, asserted where it can actually bite. The fixture pair declare NO
    // real-estate rows on their 2022 annuals, so `real_estate` was being kept out by "nobody
    // declared it" rather than by the class rule — deleting the class filter left the old
    // test green. Here the subject has PRICED property on an annual filing, so the only
    // thing that can exclude it from the rows is the rule itself.
    //
    // Why the rule: measured over the 3,090 person-years where one person filed both forms
    // for the same period, the annual shows zero properties while the inventory shows some in
    // 1,568 of them — 50.7%. „0 имота" on an annual card is a coin flip about a named person.
    const [subject] = await allRows<{ slug: string; yr: number; n: string }>(
      `WITH rep AS (
         SELECT DISTINCT ON (d.person_id, COALESCE(d.fiscal_year, d.declaration_year))
                d.declaration_id, p.slug,
                COALESCE(d.fiscal_year, d.declaration_year) AS yr
           FROM declaration d JOIN person p USING (person_id)
          WHERE p.status = 'active' AND p.is_public_figure
            AND d.declaration_type = 'Annualy'
          ORDER BY d.person_id, 3, d.filed_at DESC NULLS LAST, d.declaration_id
       )
       SELECT rep.slug, rep.yr,
              count(*) FILTER (WHERE a.category = 'real_estate')::text AS n
         FROM rep JOIN declaration_asset a USING (declaration_id)
        GROUP BY rep.slug, rep.yr
       HAVING count(*) FILTER (WHERE a.category = 'real_estate'
                                 AND a.value_eur IS NOT NULL) > 0
          AND count(*) FILTER (WHERE a.value_eur IS NULL
                                 AND a.category <> 'credit_limit') = 0
        ORDER BY count(*) FILTER (WHERE a.category = 'real_estate') DESC, rep.slug
        LIMIT 1`,
    );
    assert.ok(subject, "no annual filing declares priced real estate");
    assert.ok(Number(subject.n) > 0);

    const [other] = await allRows<{ slug: string }>(
      `WITH rep AS (
         SELECT DISTINCT ON (d.person_id) d.declaration_id, p.slug
           FROM declaration d JOIN person p USING (person_id)
          WHERE p.status = 'active' AND p.is_public_figure
            AND d.declaration_type = 'Annualy'
            AND COALESCE(d.fiscal_year, d.declaration_year) = $1
            AND p.slug <> $2
            AND EXISTS (SELECT 1 FROM declaration_asset a
                         WHERE a.declaration_id = d.declaration_id
                           AND a.value_eur IS NOT NULL)
          ORDER BY d.person_id, d.filed_at DESC NULLS LAST, d.declaration_id
       )
       SELECT rep.slug FROM rep JOIN declaration_asset a USING (declaration_id)
        GROUP BY rep.slug
       HAVING count(*) FILTER (WHERE a.value_eur IS NULL
                                 AND a.category <> 'credit_limit') = 0
        ORDER BY rep.slug LIMIT 1`,
      [subject.yr, subject.slug],
    );
    assert.ok(other, `no clean counterpart filed an annual for ${subject.yr}`);

    const { gate, card } = await compareDeclarations({
      slugA: subject.slug,
      slugB: other.slug,
      year: subject.yr,
      klass: "annual",
    });
    const g = gate as unknown as Gate;
    assert.ok(
      !card.metrics.includes("real_estate"),
      "real_estate must never be a row on an annual card, declared or not",
    );
    // …and it is excluded as a ROW only, not as money — which is the pair of claims that
    // together stop the card publishing a partial total under a whole-estate caption.
    assert.ok(g.inTotalNotShown.includes("real_estate"));
  },
);

test.skipIf(skip)(
  "income never reaches an inventory card, and the metric table is the reason",
  async () => {
    // Zero of the 11,138 entry/vacate filings in the corpus carry an income table, so there
    // is no fixture that can exercise this dynamically — the rule can only be asserted
    // against the table that encodes it plus the gate's output. Both, so that neither the
    // table nor its use can drift alone.
    const [inv] = await allRows<{ n: string }>(
      `SELECT count(*)::text n
         FROM declaration d JOIN declaration_income i USING (declaration_id)
        WHERE d.declaration_type IN ('Entry', 'Vacate')`,
    );
    assert.equal(
      Number(inv.n),
      0,
      "an inventory filing now carries income — the annual-only rule needs re-deriving",
    );
    assert.deepEqual(
      [...VERSUS_METRICS.income.classes],
      ["annual"],
      "income must be annual-only in the metric table",
    );
    const { card } = await compareDeclarations({
      slugA: RASHKOV,
      slugB: DEMERDZHIEV,
      year: 2023,
      klass: "inventory",
    });
    assert.ok(!card.metrics.includes("income"));
  },
);

test.skipIf(skip)(
  "a substantially unpriced metric leaves the card AND the total, and is named in the basis",
  async () => {
    // Рашков's 2023 встъпителна lists 24 properties of which 19 carry no declared price, so
    // that table sums to €409 against Демерджиев's fully-priced €175,305 — a 428x gap that
    // does not exist. Publishing it is the defect; dropping it silently would be the next one.
    const { gate, card } = await compareDeclarations({
      slugA: RASHKOV,
      slugB: DEMERDZHIEV,
    });
    const g = gate as unknown as Gate;
    const re = g.droppedMetrics.find(
      (d) => d.metric === "real_estate" && d.slug === RASHKOV,
    );
    assert.ok(re, "real_estate must be dropped — 19 of 24 rows carry no price");
    assert.ok(re.unvalued / re.rows > MAX_UNVALUED_SHARE);
    assert.ok(!card.metrics.includes("real_estate"));
    assert.ok(
      !g.inTotal.includes("real_estate"),
      "unpriced money enters no total",
    );
    assert.match(
      card.basis,
      /без посочена цена/,
      "the basis must say WHY a category left the comparison",
    );
  },
);

/** The declared net for one representative annual filing, computed straight from
 *  `declaration_asset` on the SAME basis `person_wealth_year` uses — the ideal-part
 *  multiplier and the implausible-row ceiling on the assets, neither on the debts.
 *
 *  INDEPENDENT of the gate on purpose. The first cut of this file compared the card against
 *  `gate.totals`, which is built by its own arithmetic, so the two agreed by construction:
 *  halving the debt inside `buildSide`, or restoring the negative-net-worth defect, left all
 *  ten tests green while the published figure moved by six digits. */
const declaredNetEur = async (slug: string, year: number): Promise<number> => {
  const [r] = await allRows<{ net: string }>(
    `WITH rep AS (
       SELECT DISTINCT ON (d.person_id) d.declaration_id
         FROM declaration d JOIN person p USING (person_id)
        WHERE p.slug = $1
          AND COALESCE(d.fiscal_year, d.declaration_year) = $2
          AND d.declaration_type = 'Annualy'
        ORDER BY d.person_id, d.filed_at DESC NULLS LAST, d.declaration_id
     )
     SELECT (
       COALESCE(SUM(a.value_eur * asset_share_multiplier(a.share, a.category)) FILTER (
         WHERE a.category NOT IN ('debt', 'credit_limit')
           AND a.value_eur <= asset_row_ceiling_eur()), 0)
       - COALESCE(SUM(a.value_eur) FILTER (WHERE a.category = 'debt'), 0)
     )::text AS net
       FROM rep JOIN declaration_asset a USING (declaration_id)`,
    [slug, year],
  );
  return Number(r.net);
};

/** The euro figure the card actually prints, parsed back off the spec. */
const publishedTotal = (v: string): number => Number(v.replace(/[^0-9-]/g, ""));

test.skipIf(skip)(
  "the PUBLISHED total is the declared net — including money that cannot be a row",
  async () => {
    // The assertion the whole file exists for: what the reader sees must be what the person
    // declared. It is checked against SQL, not against the gate's own totals.
    //
    // The subject is discovered, and must satisfy three things at once or the test cannot
    // discriminate: PRICED real-estate rows (money that is real, known, and excluded from an
    // annual card's ROWS by trap 2.4), a non-zero DEBT (so a wrong debt shows up), and NO
    // unpriced rows at all (so nothing is legitimately dropped and the expected net is the
    // person's whole declared position).
    const [subject] = await allRows<{ slug: string; yr: number }>(
      `WITH rep AS (
         SELECT DISTINCT ON (d.person_id, COALESCE(d.fiscal_year, d.declaration_year))
                d.declaration_id, p.slug,
                COALESCE(d.fiscal_year, d.declaration_year) AS yr
           FROM declaration d JOIN person p USING (person_id)
          WHERE p.status = 'active' AND p.is_public_figure
            AND d.declaration_type = 'Annualy'
            AND EXISTS (SELECT 1 FROM declaration_asset a
                         WHERE a.declaration_id = d.declaration_id
                           AND a.value_eur IS NOT NULL)
          ORDER BY d.person_id, 3, d.filed_at DESC NULLS LAST, d.declaration_id
       )
       SELECT rep.slug, rep.yr
         FROM rep JOIN declaration_asset a USING (declaration_id)
        GROUP BY rep.slug, rep.yr
       HAVING count(*) FILTER (WHERE a.category = 'real_estate'
                                 AND a.value_eur IS NOT NULL) > 0
          AND count(*) FILTER (WHERE a.value_eur IS NULL
                                 AND a.category <> 'credit_limit') = 0
          AND COALESCE(SUM(a.value_eur) FILTER (WHERE a.category = 'debt'), 0) > 0
        ORDER BY SUM(a.value_eur) FILTER (WHERE a.category = 'debt') DESC, rep.slug
        LIMIT 1`,
    );
    assert.ok(
      subject,
      "no annual filing has priced real estate, a debt and no unpriced rows — " +
        "the published-total assertion below would not discriminate",
    );

    // Any counterpart on the same year and form, also free of unpriced rows so neither side
    // triggers a drop.
    const [other] = await allRows<{ slug: string }>(
      `WITH rep AS (
         SELECT DISTINCT ON (d.person_id) d.declaration_id, p.slug
           FROM declaration d JOIN person p USING (person_id)
          WHERE p.status = 'active' AND p.is_public_figure
            AND d.declaration_type = 'Annualy'
            AND COALESCE(d.fiscal_year, d.declaration_year) = $1
            AND p.slug <> $2
            AND EXISTS (SELECT 1 FROM declaration_asset a
                         WHERE a.declaration_id = d.declaration_id
                           AND a.value_eur IS NOT NULL)
          ORDER BY d.person_id, d.filed_at DESC NULLS LAST, d.declaration_id
       )
       SELECT rep.slug FROM rep JOIN declaration_asset a USING (declaration_id)
        GROUP BY rep.slug
       HAVING count(*) FILTER (WHERE a.value_eur IS NULL
                                 AND a.category <> 'credit_limit') = 0
        ORDER BY rep.slug LIMIT 1`,
      [subject.yr, subject.slug],
    );
    assert.ok(other, `no clean counterpart filed an annual for ${subject.yr}`);

    const { gate, card } = await compareDeclarations({
      slugA: subject.slug,
      slugB: other.slug,
      year: subject.yr,
      klass: "annual",
    });
    const g = gate as unknown as Gate;
    assert.deepEqual(
      g.droppedMetrics,
      [],
      "fixture must trigger no unpriced drop",
    );

    // real_estate is money this person declared, is NOT a row on an annual card, and must
    // still be inside the printed total. Before the fix the card subtracted the WHOLE debt
    // from assets that omitted it — −1,251,250 € published against a declared −152,957 €.
    assert.ok(!card.metrics.includes("real_estate"));
    assert.ok(g.inTotalNotShown.includes("real_estate"));

    // The gate rounds each category's sum in SQL and adds the rounded figures; this check
    // rounds once at the end. That is worth at most half a euro per category, so the drift is
    // a few euro on any real filing (measured: €1 on €11.5m) — while the defects this exists
    // to catch move the figure by six digits. A tolerance, not an equality, and small enough
    // that it cannot hide one.
    const ROUNDING_SLACK_EUR = Object.keys(VERSUS_METRICS).length;
    for (const [side, slug] of [
      ["left", subject.slug],
      ["right", other.slug],
    ] as const) {
      const expected = await declaredNetEur(slug, subject.yr);
      const printed = publishedTotal(card.versus[side].total.value);
      assert.ok(
        Math.abs(printed - expected) <= ROUNDING_SLACK_EUR,
        `${slug}: the card prints ${printed} € but the declared net is ` +
          `${Math.round(expected)} €`,
      );
    }
    // And the fixture genuinely exercises both halves, or the equality above is cheap.
    assert.ok(
      g.totals[subject.slug].debtsEur > 0,
      "fixture debt is zero — inert",
    );
  },
);

test.skipIf(skip)(
  "the debt figure is never dropped and never zeroed",
  async () => {
    // Dropping the debt metric for unpriced rows used to set debts = 0 and publish
    // net = assets — €185,616 of PRICED debt erased on one real pair. Understating a debt
    // OVERSTATES a person's wealth, the one direction an accountability figure must not fail
    // in, so an unpriced debt table costs the NET BASIS instead of the debt figure.
    //
    // The subject is DISCOVERED rather than hard-coded, because the pair the rest of this
    // file uses has all six debt rows priced — against which the exemption is unreachable and
    // the assertion would pass no matter what the code did.
    const [subject] = await allRows<{ slug: string; yr: number }>(
      `WITH rep AS (
         SELECT DISTINCT ON (d.person_id, COALESCE(d.fiscal_year, d.declaration_year))
                d.declaration_id, p.slug,
                COALESCE(d.fiscal_year, d.declaration_year) AS yr
           FROM declaration d JOIN person p USING (person_id)
          WHERE p.status = 'active' AND p.is_public_figure
            AND d.declaration_type = 'Annualy'
            -- Same valued-asset precondition REP_CTE applies, or this can pick a filing the
            -- gate would never choose as the representative.
            AND EXISTS (SELECT 1 FROM declaration_asset a
                         WHERE a.declaration_id = d.declaration_id
                           AND a.value_eur IS NOT NULL)
          ORDER BY d.person_id, 3, d.filed_at DESC NULLS LAST, d.declaration_id
       )
       SELECT rep.slug, rep.yr
         FROM rep JOIN declaration_asset a USING (declaration_id)
        WHERE a.category = 'debt'
        GROUP BY rep.slug, rep.yr
       HAVING count(*) FILTER (WHERE a.value_eur IS NULL)::numeric / count(*) > $1
        -- Highest unpriced RATIO, not the largest table: ordering by row count picked a
        -- candidate at 2/9 = 0.222 against a 0.2 threshold, one priced row from ceasing to
        -- qualify at all.
        ORDER BY count(*) FILTER (WHERE a.value_eur IS NULL)::numeric / count(*) DESC,
                 rep.slug
        LIMIT 1`,
      [MAX_UNVALUED_SHARE],
    );
    assert.ok(
      subject,
      "no filing in the corpus has a substantially unpriced debt table — " +
        "this rule is untestable and the assertion below would be vacuous",
    );

    // Any comparable counterpart filing the same year on the same form.
    const [other] = await allRows<{ slug: string }>(
      `WITH rep AS (
         SELECT DISTINCT ON (d.person_id) p.slug
           FROM declaration d JOIN person p USING (person_id)
          WHERE p.status = 'active' AND p.is_public_figure
            AND d.declaration_type = 'Annualy'
            AND COALESCE(d.fiscal_year, d.declaration_year) = $1
            AND p.slug <> $2
            AND EXISTS (SELECT 1 FROM declaration_asset a
                         WHERE a.declaration_id = d.declaration_id
                           AND a.value_eur IS NOT NULL)
          ORDER BY d.person_id, d.filed_at DESC NULLS LAST
       )
       SELECT slug FROM rep ORDER BY slug LIMIT 1`,
      [subject.yr, subject.slug],
    );
    assert.ok(other, `no counterpart filed an annual for ${subject.yr}`);

    // The NET basis is refused outright — a net over an unknown liability is a ceiling.
    await assert.rejects(
      () =>
        compareDeclarations({
          slugA: subject.slug,
          slugB: other.slug,
          year: subject.yr,
          klass: "annual",
          totalBasis: "net",
        }),
      /debt table is substantially unpriced/,
    );

    // …while the ASSETS basis, which does not depend on the debt figure, still publishes —
    // and the debt row survives, carrying its priced floor rather than being zeroed away.
    const { gate, card } = await compareDeclarations({
      slugA: subject.slug,
      slugB: other.slug,
      year: subject.yr,
      klass: "annual",
      totalBasis: "assets",
    });
    const g = gate as unknown as Gate;
    assert.ok(
      !g.droppedMetrics.some((d) => d.metric === "debt"),
      "debt is exempt from the unpriced drop",
    );
    assert.ok(
      card.metrics.includes("debt"),
      "the debt row must still be shown",
    );
  },
);

test.skipIf(skip)(
  "the net total is assets minus the WHOLE declared debt",
  async () => {
    const { gate, card } = await compareDeclarations({
      slugA: RASHKOV,
      slugB: DEMERDZHIEV,
    });
    const g = gate as unknown as Gate;
    assert.ok(card.metrics.includes("debt"));
    // Демерджиев's €332,304 of declared debt must be in his net, not silently absent.
    assert.ok(g.totals[DEMERDZHIEV].debtsEur > 0);
    assert.equal(
      Math.round(g.totals[DEMERDZHIEV].netEur),
      Math.round(
        g.totals[DEMERDZHIEV].assetsEur - g.totals[DEMERDZHIEV].debtsEur,
      ),
    );
  },
);

test.skipIf(skip)(
  "`credit_limit` reaches neither the assets nor the debts",
  async () => {
    // 089's own note: a declared credit LINE is what the holder could draw, so subtracting it
    // asserts a debt nobody declared — and adding it asserts money nobody has. The serving
    // SQL excludes it from BOTH arms, and a `category != 'debt'` shortcut folds it into the
    // assets silently, which is the half the first draft of this test did not check.
    const [row] = await allRows<{ limit_eur: string; assets_eur: string }>(
      `WITH rep AS (
         SELECT DISTINCT ON (d.person_id) d.declaration_id
           FROM declaration d JOIN person p USING (person_id)
          WHERE p.slug = $1 AND COALESCE(d.fiscal_year, d.declaration_year) = 2022
            AND d.declaration_type = 'Annualy'
          ORDER BY d.person_id, d.filed_at DESC NULLS LAST, d.declaration_id
       )
       SELECT
         COALESCE(SUM(a.value_eur) FILTER (WHERE a.category = 'credit_limit'), 0)::text
           AS limit_eur,
         COALESCE(SUM(a.value_eur * asset_share_multiplier(a.share, a.category)) FILTER (
           WHERE a.category NOT IN ('debt', 'credit_limit')
             AND a.value_eur <= asset_row_ceiling_eur()), 0)::text AS assets_eur
         FROM rep JOIN declaration_asset a USING (declaration_id)`,
      [RASHKOV],
    );
    const limit = Number(row.limit_eur);
    assert.ok(
      limit > 0,
      "fixture assumes Рашков's 2022 annual carries a credit limit — it no longer does",
    );

    // allowThin because Демерджиев's fiscal-2022 annual trips the substance guard — this
    // test is about the credit-limit arithmetic on РАШКОВ's filing, not about whether the
    // two are comparable, and the guard would otherwise refuse before the maths runs.
    const { gate } = await compareDeclarations({
      slugA: RASHKOV,
      slugB: DEMERDZHIEV,
      year: 2022,
      klass: "annual",
      allowThin: true,
    });
    const t = (gate as unknown as Gate).totals[RASHKOV];
    // Not a debt…
    assert.equal(t.debtsEur, 0, "a credit limit is not a debt");
    // …and not an asset either. This is the assertion that bites: the expected figure is
    // computed in SQL with credit_limit excluded, so folding it in moves the gate's number
    // away from it by exactly the limit.
    assert.equal(
      Math.round(t.assetsEur),
      Math.round(Number(row.assets_eur)),
      `a credit limit of ${limit} € has leaked into the assets`,
    );
  },
);

test.skipIf(skip)(
  "a co-owned property is weighted by the ideal part, not counted once per co-owner",
  async () => {
    // Сметна палата table 1 col 11 states the WHOLE price on each co-owner's row, so a bare
    // SUM double-counts a jointly-held home. The gate must read the same weighted basis
    // person_wealth_year does, or /person and this card publish two net worths for one human.
    const rows = await allRows<{ slug: string; weighted: string; raw: string }>(
      `WITH rep AS (
         SELECT DISTINCT ON (d.person_id) d.declaration_id, p.slug
           FROM declaration d JOIN person p USING (person_id)
          WHERE p.slug = ANY($1::text[])
            AND COALESCE(d.fiscal_year, d.declaration_year) = 2023
            AND d.declaration_type IN ('Entry', 'Vacate')
          ORDER BY d.person_id, d.filed_at DESC NULLS LAST, d.declaration_id
       )
       SELECT rep.slug,
              SUM(a.value_eur * asset_share_multiplier(a.share, a.category))::text AS weighted,
              SUM(a.value_eur)::text AS raw
         FROM rep JOIN declaration_asset a USING (declaration_id)
        WHERE a.category NOT IN ('debt', 'credit_limit')
        GROUP BY rep.slug`,
      [[RASHKOV, DEMERDZHIEV]],
    );
    assert.ok(rows.length === 2, "both fixture filings must be present");

    const { gate } = await compareDeclarations({
      slugA: RASHKOV,
      slugB: DEMERDZHIEV,
    });
    const g = gate as unknown as Gate;
    // Counted, because the whole discriminating margin here is small and sits in the one
    // table the card DROPS: if those rows change, the weighted and unweighted sums converge
    // and the loop below silently asserts nothing.
    let discriminated = 0;
    for (const r of rows) {
      // The gate's assets are over the KNOWN categories only, so they cannot exceed the
      // whole filing's weighted sum — and must never reach the unweighted one when the two
      // differ, which is what a missing multiplier would look like.
      assert.ok(
        g.totals[r.slug].assetsEur <= Number(r.weighted) + 1,
        `${r.slug}: assets exceed the weighted total — multiplier not applied?`,
      );
      if (Number(r.raw) > Number(r.weighted) + 1) {
        discriminated += 1;
        assert.ok(
          g.totals[r.slug].assetsEur < Number(r.raw),
          `${r.slug}: assets match the UNWEIGHTED sum — a co-owned asset is double counted`,
        );
      }
    }
    assert.ok(
      discriminated > 0,
      "neither fixture filing declares an ideal part, so this test cannot tell a weighted " +
        "sum from an unweighted one — pick a subject that does",
    );
  },
);

test.skipIf(skip)("refuses to compare a person with themselves", async () => {
  await assert.rejects(
    () => compareDeclarations({ slugA: RASHKOV, slugB: RASHKOV }),
    /same person/,
  );
});

test.skipIf(skip)(
  "the property fold classifies the corpus, and `other` stays a tail",
  async () => {
    // The fold reads free text — 2,981 distinct spellings over 133,240 real-estate rows —
    // so its coverage is a property of the CORPUS and can only be checked here. `other` is a
    // real bucket (the register's own „други", plus rights and ancillary spaces), but if a
    // new spelling or a broken rule sent a real kind there it would show up as growth.
    const rows = await allRows<{ d: string; n: string }>(
      `SELECT lower(trim(description)) d, count(*)::text n
         FROM declaration_asset
        WHERE category = 'real_estate'
          AND description IS NOT NULL AND trim(description) <> ''
        GROUP BY 1`,
    );
    assert.ok(rows.length > 100, "real-estate descriptions not loaded?");

    const tally = new Map<PropertyKind, number>();
    let total = 0;
    for (const r of rows) {
      const n = Number(r.n);
      const k = propertyKind(r.d);
      tally.set(k, (tally.get(k) ?? 0) + n);
      total += n;
    }
    const share = (k: PropertyKind) => (tally.get(k) ?? 0) / total;

    // Measured 2026-08-16: other 3.1%. A ceiling well above it, so ordinary corpus drift
    // does not fail the build, but a rule that stopped firing does.
    assert.ok(
      share("other") < 0.08,
      `unclassified property descriptions are ${(share("other") * 100).toFixed(1)}% ` +
        `of rows (ceiling 8%) — a fold rule has probably stopped matching`,
    );
    // …and the four kinds that carry the corpus must each still carry a real share, or a
    // rule has silently collapsed into another.
    for (const k of ["farmland", "apartment", "house", "plot"] as const)
      assert.ok(
        share(k) > 0.05,
        `${k} fell to ${(share(k) * 100).toFixed(1)}% of rows — rule regression?`,
      );
  },
);

test.skipIf(skip)(
  "--same-role matches on the OFFICE, taking each side's own year in it",
  async () => {
    // The second comparison axis. Matching on the year asks what two lives looked like at
    // one moment; matching on the office asks what the estate of whoever holds THIS post
    // looks like — and there the year gap is the subject, not a confound.
    //
    // The fixture is the reason the axis exists: both men were interior minister, but never
    // in the same year, so the year-matched gate can never show them in the role. Рашков
    // filed an annual as minister in 2021, Демерджиев in 2022.
    // allowThin: this pair is the fixture for the OFFICE-matching mechanics, and it is also
    // the fixture for the substance guard that refuses it — see the thin-guard test below.
    // Exercising the axis needs the override; publishing it does not, which is the point.
    const { gate, card } = await compareDeclarations({
      slugA: RASHKOV,
      slugB: DEMERDZHIEV,
      sameRole: true,
      allowThin: true,
    });
    const g = gate as unknown as Gate;
    assert.match(g.picked.office ?? "", /вътрешните работи/i);
    assert.equal(g.picked.yearA, 2021);
    assert.equal(g.picked.yearB, 2022);
    // The form-class rule survives this axis: an annual and an entry/vacate measure
    // different things whichever years they come from.
    assert.equal(g.picked.klass, "annual");
    // NOT `left.formClass === right.formClass` — both are assigned from picked.klass, so
    // that comparison cannot fail whatever the gate does. Assert against the DECLARATION
    // TYPES the two filings actually carry, which is what the class is supposed to encode.
    const types = await allRows<{ slug: string; declaration_type: string }>(
      `SELECT p.slug, d.declaration_type
         FROM declaration d JOIN person p USING (person_id)
        WHERE (p.slug = $1 AND COALESCE(d.fiscal_year, d.declaration_year) = $3)
           OR (p.slug = $2 AND COALESCE(d.fiscal_year, d.declaration_year) = $4)`,
      [RASHKOV, DEMERDZHIEV, g.picked.yearA, g.picked.yearB],
    );
    assert.ok(types.length >= 2);
    for (const t of types.filter((r) => r.declaration_type !== "Other"))
      assert.equal(
        t.declaration_type,
        "Annualy",
        `${t.slug} contributed a ${t.declaration_type} filing to an annual-class card`,
      );

    // Differing years must be stated per side, and no shared year may head the card.
    assert.equal(card.year, undefined);
    assert.ok(card.kicker && /вътрешните работи/i.test(card.kicker));
    assert.equal(card.versus.left.periodYear, 2021);
    assert.equal(card.versus.right.periodYear, 2022);
    // …and the year-matched caveat must NOT appear, since it would be false here.
    assert.ok(
      card.yearNote && !/най-скорошната година/i.test(card.yearNote),
      "a role-matched card must not carry the year-matched note",
    );
  },
);

test.skipIf(skip)(
  "--same-role refuses a person whose filings state no office, naming the backfill",
  async () => {
    // The condition is CONSTRUCTED, because the corpus no longer contains it: the
    // 2026-08-17 backfill took filed_position to 100%, so no person is office-less any
    // more. This test used to find one, and its own assertion message predicted its
    // death („every person now has an office — this refusal is unreachable").
    //
    // The path is still live — three filings in the corpus carry an institution and an
    // EMPTY <Position>, because the register itself states none — and it is the refusal a
    // fresh clone hits before any backfill has run, so it must stay covered and must stay
    // actionable rather than a bare no.
    //
    // Mutate-and-restore rather than a rolled-back transaction: `compareDeclarations` takes
    // its own pooled connection and would not see an uncommitted write. Safe because
    // filed_position is fully re-derivable — `backfill_filed_position.ts --slug <slug>` —
    // and the restore is asserted below.
    const [victim] = await allRows<{ slug: string }>(
      `SELECT p.slug
         FROM person p JOIN declaration d USING (person_id)
        WHERE p.status = 'active' AND p.is_public_figure
          AND d.filed_position IS NOT NULL AND d.filed_institution IS NOT NULL
          AND d.declaration_type IN ('Annualy', 'Entry', 'Vacate')
          AND p.slug NOT IN ($1, $2)
          AND EXISTS (SELECT 1 FROM declaration_asset a
                       WHERE a.declaration_id = d.declaration_id
                         AND a.value_eur IS NOT NULL)
        GROUP BY p.slug ORDER BY p.slug LIMIT 1`,
      [RASHKOV, DEMERDZHIEV],
    );
    assert.ok(victim, "no person with a stated office to borrow");

    const saved = await allRows<{
      declaration_id: string;
      filed_position: string | null;
      filed_institution: string | null;
    }>(
      `SELECT d.declaration_id::text, d.filed_position, d.filed_institution
         FROM declaration d JOIN person p USING (person_id)
        WHERE p.slug = $1`,
      [victim.slug],
    );
    assert.ok(saved.length > 0);

    try {
      await allRows(
        `UPDATE declaration SET filed_position = NULL, filed_institution = NULL
          WHERE person_id = (SELECT person_id FROM person WHERE slug = $1)`,
        [victim.slug],
      );
      await assert.rejects(
        () =>
          compareDeclarations({
            slugA: RASHKOV,
            slugB: victim.slug,
            sameRole: true,
          }),
        // Actionable: the message must name the tool that fixes it, not merely refuse.
        /backfill_filed_position/,
      );
    } finally {
      for (const r of saved)
        await allRows(
          `UPDATE declaration SET filed_position = $2, filed_institution = $3
            WHERE declaration_id = $1::bigint`,
          [r.declaration_id, r.filed_position, r.filed_institution],
        );
    }

    // The restore is part of the test, not a hope.
    const after = await allRows<{ n: string }>(
      `SELECT count(*)::text n
         FROM declaration d JOIN person p USING (person_id)
        WHERE p.slug = $1 AND d.filed_position IS NOT NULL`,
      [victim.slug],
    );
    assert.equal(
      Number(after[0].n),
      saved.filter((r) => r.filed_position !== null).length,
      `${victim.slug}'s offices were not restored — re-run backfill_filed_position.ts --slug ${victim.slug} --apply`,
    );
  },
);

test.skipIf(skip)(
  "--same-role refuses two people who never held the same office",
  async () => {
    // Offices are matched on the filing's own words with no abbreviation expansion, so this
    // under-matches rather than guessing — the refusal prints both people's offices.
    const [other] = await allRows<{ slug: string }>(
      `SELECT p.slug
         FROM person p JOIN declaration d USING (person_id)
        WHERE p.status = 'active' AND p.is_public_figure
          AND d.filed_position IS NOT NULL
          AND d.filed_institution NOT ILIKE '%вътрешните работи%'
          AND d.declaration_type IN ('Annualy', 'Entry', 'Vacate')
          AND EXISTS (SELECT 1 FROM declaration_asset a
                       WHERE a.declaration_id = d.declaration_id
                         AND a.value_eur IS NOT NULL)
          AND p.slug NOT IN ($1, $2)
        GROUP BY p.slug ORDER BY p.slug LIMIT 1`,
      [RASHKOV, DEMERDZHIEV],
    );
    assert.ok(other, "no third person with a stated office");
    await assert.rejects(
      () =>
        compareDeclarations({
          slugA: RASHKOV,
          slugB: other.slug,
          sameRole: true,
        }),
      /no office both people held/,
    );
  },
);

test.skipIf(skip)(
  "a role-matched card names the office even when both years coincide",
  async () => {
    // The branch that published a role comparison as an undescribed year comparison: the
    // header and the caveat were keyed on whether the two years happened to be equal, while
    // the per-side role is suppressed because the header is supposed to carry the office. So
    // on a coincident-year pair the office appeared NOWHERE and the year-matched caveat
    // printed. 3 of 30 sampled role-matched pairs take this branch.
    const [pair] = await allRows<{ a: string; b: string }>(
      `WITH rep AS (
         SELECT DISTINCT ON (d.person_id, COALESCE(d.fiscal_year, d.declaration_year),
                             CASE d.declaration_type WHEN 'Annualy' THEN 'annual'
                                                     ELSE 'inventory' END)
                p.slug,
                COALESCE(d.fiscal_year, d.declaration_year) AS yr,
                CASE d.declaration_type WHEN 'Annualy' THEN 'annual'
                                        ELSE 'inventory' END AS klass,
                lower(d.filed_position) AS pos, lower(d.filed_institution) AS inst
           FROM declaration d JOIN person p USING (person_id)
          WHERE p.status = 'active' AND p.is_public_figure
            AND d.declaration_type IN ('Annualy', 'Entry', 'Vacate')
            AND d.filed_position IS NOT NULL AND d.filed_institution IS NOT NULL
            AND EXISTS (SELECT 1 FROM declaration_asset a
                         WHERE a.declaration_id = d.declaration_id
                           AND a.value_eur IS NOT NULL)
          ORDER BY d.person_id, 2, 3, d.filed_at DESC NULLS LAST, d.declaration_id
       )
       SELECT min(slug) AS a, max(slug) AS b
         FROM rep GROUP BY yr, klass, pos, inst
        HAVING count(DISTINCT slug) = 2
        ORDER BY yr DESC LIMIT 1`,
    );
    assert.ok(pair, "no two people share an office, year and form class");

    const { gate, card } = await compareDeclarations({
      slugA: pair.a,
      slugB: pair.b,
      sameRole: true,
    });
    const g = gate as unknown as Gate;
    assert.equal(
      g.picked.yearA,
      g.picked.yearB,
      "fixture must have coincident years",
    );
    // The office must be findable on the card — in the header, since the per-side role is
    // deliberately suppressed on this axis.
    assert.ok(
      card.kicker,
      "a role-matched card must name the office in its header",
    );
    assert.equal(card.year, undefined);
    assert.equal(card.versus.left.role, undefined);
    // …and the year-matched caveat must not appear.
    assert.ok(
      !/най-скорошната година/i.test(card.yearNote ?? ""),
      "a role-matched card must not carry the year-matched caveat",
    );
  },
);

test.skipIf(skip)(
  "refuses a filing too thin to compare, and only when it would distort the card",
  async () => {
    // The defect this closes shipped a card. Демерджиев's fiscal-2022 annual and Рашков's
    // fiscal-2021 annual are the same FORM CLASS, both filed as interior minister, and so
    // passed every gate there was — but the first states one row (€31,404 cash, no bank at
    // all) while the same man's filing six months later states €452,192 including €160,755
    // of bank. The card published a 13x gap that is an artifact of a near-empty filing.
    //
    // Form class is necessary and not sufficient: two annuals can be formally matched and
    // substantively incomparable.
    await assert.rejects(
      () =>
        compareDeclarations({
          slugA: RASHKOV,
          slugB: DEMERDZHIEV,
          sameRole: true,
        }),
      /too thin to compare/,
    );

    // …and it names the numbers, because "too thin" is a claim the operator must be able to
    // check against the filings themselves.
    const err = await compareDeclarations({
      slugA: RASHKOV,
      slugB: DEMERDZHIEV,
      sameRole: true,
    }).catch((e: Error) => e.message);
    assert.match(err as string, new RegExp(DEMERDZHIEV));
    assert.match(err as string, /bank/);

    // --allow-thin is the deliberate override, for an operator who has read the filings.
    const { card } = await compareDeclarations({
      slugA: RASHKOV,
      slugB: DEMERDZHIEV,
      sameRole: true,
      allowThin: true,
    });
    assert.ok(card.versus.left.total.value);

    // The guard must NOT fire on the year-matched 2023 pair, where both sides are
    // substantial — over-refusing would make the whole gate useless.
    await assert.doesNotReject(() =>
      compareDeclarations({ slugA: RASHKOV, slugB: DEMERDZHIEV }),
    );
  },
);

test.skipIf(skip)(
  "the thin guard does NOT fire when money merely moved and no category vanished",
  async () => {
    // The signal that isolates the conjunction. Mutating the lost-category requirement away
    // left every other assertion green, because the fixture pair trips the ratio and the
    // shortfall too — so this test exists to be the one that fails.
    //
    // The subject holds a small fraction of what they declared nearby, with a shortfall far
    // over the floor, and yet nothing vanished: their money genuinely moved. Refusing them
    // would make the guard fire on ordinary wealth changes.
    const [subject] = await allRows<{ slug: string; yr: number }>(
      `WITH m AS (
         SELECT d.declaration_id, d.person_id,
                COALESCE(d.fiscal_year, d.declaration_year) AS yr,
                COALESCE(SUM(a.value_eur) FILTER (
                  WHERE a.category IN ('bank','cash','investment','security','receivable')), 0) AS money,
                COALESCE(array_agg(DISTINCT a.category) FILTER (
                  WHERE a.category IN ('bank','cash','investment','security','receivable')), '{}') AS cats
           FROM declaration d LEFT JOIN declaration_asset a USING (declaration_id)
          WHERE d.declaration_type = 'Annualy'
          GROUP BY 1,2,3
         HAVING COALESCE(SUM(a.value_eur) FILTER (WHERE a.value_eur IS NOT NULL), 0) > 0
       ), j AS (
         SELECT m.person_id, m.yr, m.money, max(o.money) AS peer,
                bool_or(EXISTS (SELECT 1 FROM unnest(o.cats) c
                                 WHERE NOT (m.cats @> ARRAY[c]))) AS lost_any
           FROM m JOIN m o ON o.person_id = m.person_id
                          AND o.declaration_id <> m.declaration_id
                          AND abs(o.yr - m.yr) <= 2
          GROUP BY 1,2,3
       )
       SELECT p.slug, j.yr
         FROM j JOIN person p USING (person_id)
        WHERE p.status = 'active' AND p.is_public_figure
          AND j.money < 0.25 * j.peer
          AND j.peer - j.money >= 50000
          AND NOT j.lost_any
        ORDER BY j.peer - j.money DESC LIMIT 1`,
    );
    assert.ok(
      subject,
      "no filing has a large shortfall with no vanished category — this test cannot " +
        "discriminate and the conjunction is untested",
    );

    // A substantial counterpart filing the same year, so only the subject is in question.
    const [other] = await allRows<{ slug: string }>(
      `WITH m AS (
         SELECT d.declaration_id, d.person_id, p.slug,
                COALESCE(SUM(a.value_eur) FILTER (
                  WHERE a.category IN ('bank','cash','investment','security','receivable')), 0) AS money
           FROM declaration d JOIN person p USING (person_id)
           LEFT JOIN declaration_asset a USING (declaration_id)
          WHERE d.declaration_type = 'Annualy'
            AND COALESCE(d.fiscal_year, d.declaration_year) = $1
            AND p.status = 'active' AND p.is_public_figure AND p.slug <> $2
          GROUP BY 1,2,3
         HAVING COALESCE(SUM(a.value_eur) FILTER (WHERE a.value_eur IS NOT NULL), 0) > 0
       )
       SELECT slug FROM m ORDER BY money DESC LIMIT 1`,
      [subject.yr, subject.slug],
    );
    assert.ok(other, `no counterpart filed an annual for ${subject.yr}`);

    await assert.doesNotReject(
      () =>
        compareDeclarations({
          slugA: subject.slug,
          slugB: other.slug,
          year: subject.yr,
          klass: "annual",
        }),
      "the guard fired on a filing where money moved but nothing vanished",
    );
  },
);

test.skipIf(skip)(
  "the thin guard needs all three signals, not any one of them",
  async () => {
    // Each signal alone misfires, which is why the rule is a conjunction. Measured on the
    // fixture pair's own history: Рашков's 2018 filing holds 3.7% of its neighbours and is
    // fine (his money genuinely fell, nothing vanished), and his 2015 filing lost a category
    // with money at 88% and is also fine. Corpus-wide the ratio alone fires on 13.10% of
    // filings and all three together on 3.24%.
    const [counts] = await allRows<{
      ratio_only: string;
      all_three: string;
    }>(
      `WITH m AS (
         SELECT d.declaration_id, d.person_id,
                COALESCE(d.fiscal_year, d.declaration_year) AS yr,
                COALESCE(SUM(a.value_eur) FILTER (
                  WHERE a.category IN ('bank','cash','investment','security','receivable')), 0) AS money,
                COALESCE(array_agg(DISTINCT a.category) FILTER (
                  WHERE a.category IN ('bank','cash','investment','security','receivable')), '{}') AS cats
           FROM declaration d LEFT JOIN declaration_asset a USING (declaration_id)
          WHERE d.declaration_type IN ('Annualy','Entry','Vacate')
          GROUP BY 1,2,3
         HAVING COALESCE(SUM(a.value_eur) FILTER (WHERE a.value_eur IS NOT NULL), 0) > 0
       ), j AS (
         SELECT m.declaration_id, m.money, max(o.money) AS peer,
                bool_or(EXISTS (SELECT 1 FROM unnest(o.cats) c
                                 WHERE NOT (m.cats @> ARRAY[c]))) AS lost_any
           FROM m JOIN m o ON o.person_id = m.person_id
                          AND o.declaration_id <> m.declaration_id
                          AND abs(o.yr - m.yr) <= 2
          GROUP BY 1, 2
       )
       SELECT count(*) FILTER (WHERE money < 0.25 * peer)::text AS ratio_only,
              count(*) FILTER (WHERE money < 0.25 * peer AND lost_any
                                 AND peer - money >= 50000)::text AS all_three
         FROM j WHERE peer > 0`,
    );
    const ratioOnly = Number(counts.ratio_only);
    const allThree = Number(counts.all_three);
    assert.ok(
      allThree > 0,
      "the guard never fires — it cannot be protecting anything",
    );
    assert.ok(
      allThree < ratioOnly / 3,
      `the extra two signals barely narrow the ratio test (${allThree} vs ${ratioOnly}) — ` +
        `the conjunction is not doing the work its comment claims`,
    );
  },
);
