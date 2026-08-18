// procurement_award_criteria (164) — the ЗОП чл. 70 award-criterion lens.
//
// Four properties this gate holds, each of which has a silent failure mode:
//
//  1. The buckets PARTITION the window. A criterion string that matched no
//     branch would vanish from the split, so every bar would still render and
//     simply add up to less than the corpus.
//  2. The semicolon-joined values land in `combined`, not `meat`. A naive
//     LIKE '%качество%' pulls them into MEAT and overstates the headline share
//     by ~600 tenders — the exact defect the bucket function is written to avoid.
//  3. The award_method DOMAIN is closed. Seven values exist today; an eighth
//     arriving in a future ingest must surface as `other`, never merge into
//     "not stated" (plan §6e).
//  4. The no-call predicate is NOT 037's list. They differ in both directions,
//     and reusing 037's would silently drop 2,229 criterion-bearing tenders and
//     keep three criterion-less types in the denominator (plan §10b).
//
// Auto-skips when Postgres is down or the tender corpus carries no criterion —
// like the other *.data.test.ts gates.
//
//   npm run test:data

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, dbReachable, end } from "../lib/pg";
import { AWARD_CRITERION_BUCKETS } from "../../../src/data/procurement/useAwardCriteria";

type Row = {
  total: number;
  price: number;
  meat: number;
  lcc: number;
  combined: number;
  other: number;
  unknown: number;
  year?: string;
  contractType?: string;
};
type Payload = {
  firstYear: string;
  coverage: {
    total: number;
    competitive: number;
    noCall: number;
    preCriterionTenders: number;
  };
  byYear: Row[];
  byType: Row[];
};

const haveDb = await dbReachable();
const criteriaLoaded =
  haveDb &&
  Number(
    (
      await allRows<{ n: string }>(
        "SELECT count(*) n FROM tenders WHERE award_method IS NOT NULL",
      ).catch(() => [{ n: "0" }])
    )[0]?.n ?? 0,
  ) > 0;
const skip = !haveDb
  ? "Postgres unreachable"
  : !criteriaLoaded
    ? "tender corpus carries no award_method"
    : false;

const payload = async (): Promise<Payload> =>
  (await allRows<{ r: Payload }>("SELECT procurement_award_criteria() AS r"))[0]
    .r;

afterAll(async () => {
  await end();
});

test.skipIf(skip)(
  "the split reconciles to the corpus, not just to itself",
  async () => {
    // `procurement_award_criterion_bucket` ends in ELSE 'other', so summing the
    // six buckets back to `total` is an identity — it cannot fail while the ELSE
    // exists. The observation worth making is against INDEPENDENT ground truth:
    // both breakdowns must reconcile to a count taken straight from `tenders`.
    const p = await payload();
    assert.ok(p.byYear.length > 0, "byYear is empty");

    const [gt] = await allRows<{ n: string }>(
      `SELECT count(*) n FROM tenders
       WHERE NOT procurement_no_call_procedure(procedure_type)
         AND left(publication_date, 4) >= '2020'`,
    );
    const byYear = p.byYear.reduce((a, r) => a + r.total, 0);
    const byType = p.byType.reduce((a, r) => a + r.total, 0);
    assert.equal(
      byYear,
      Number(gt.n),
      "byYear does not sum to the competitive corpus — rows are being dropped between the table and the split",
    );
    assert.equal(
      byType,
      byYear,
      "byType and byYear disagree. They render identically under one legend, so two different denominators would print two MEAT shares of the same name with nothing on screen to tell them apart",
    );
    assert.equal(
      byYear,
      p.coverage.competitive,
      "the coverage counter disagrees with the rows it claims to count",
    );
    assert.equal(
      p.coverage.competitive +
        p.coverage.noCall +
        p.coverage.preCriterionTenders,
      p.coverage.total,
      "coverage does not partition — a NULL procedure_type would do this, which is why procurement_no_call_procedure COALESCEs to false",
    );
  },
);

test.skipIf(skip)(
  "a NULL procedure_type stays inside the partition",
  async () => {
    // `IN` is three-valued, so a bare `p_type IN (…)` returns NULL here and the row
    // satisfies neither no_call nor NOT no_call — it leaves the partition entirely.
    // There are 0 such rows today; this asserts the guard, not the data.
    const [r] = await allRows<{ v: boolean | null }>(
      "SELECT procurement_no_call_procedure(NULL) AS v",
    );
    assert.equal(
      r.v,
      false,
      "procurement_no_call_procedure(NULL) must be false, not NULL — otherwise a tender with no recorded procedure_type silently leaves the coverage split",
    );
  },
);

test.skipIf(skip)(
  "the server emits exactly the buckets the tile knows how to draw",
  async () => {
    // The tile maps AWARD_CRITERION_BUCKETS to coloured segments. A seventh
    // bucket added to the SQL CASE would be counted in `total` but never drawn,
    // so every bar would render short with nothing erroring.
    const rows = await allRows<{ b: string }>(
      "SELECT DISTINCT procurement_award_criterion_bucket(award_method) AS b FROM tenders",
    );
    const drawn = new Set<string>(AWARD_CRITERION_BUCKETS);
    for (const { b } of rows) {
      assert.ok(
        drawn.has(b),
        `SQL emits bucket "${b}" which the tile does not draw. Add it to AWARD_CRITERION_BUCKETS (and give it a colour in BUCKET_CLASS)`,
      );
    }
  },
);

test.skipIf(skip)(
  "the semicolon-joined criteria land in `combined`, never in `meat`",
  async () => {
    // Ground truth straight from the corpus, independent of the function.
    const [t] = await allRows<{ n: string }>(
      `SELECT count(*) n FROM tenders
       WHERE award_method LIKE '%;%'
         AND NOT procurement_no_call_procedure(procedure_type)
         AND left(publication_date, 4) >= '2020'`,
    );
    const p = await payload();
    const combined = p.byYear.reduce((a, r) => a + r.combined, 0);
    assert.equal(
      combined,
      Number(t.n),
      "combined bucket disagrees with the corpus — the semicolon test is not " +
        "running first, so joined values are being absorbed into a single-criterion bucket",
    );
    assert.ok(
      combined > 0,
      "no combined rows at all — the fixture is not exercising this",
    );
  },
);

test.skipIf(skip)(
  "the award_method domain is closed — an 8th value would surface as `other`",
  async () => {
    const rows = await allRows<{ award_method: string | null }>(
      "SELECT DISTINCT award_method FROM tenders",
    );
    const known = new Set([
      "Най-ниска цена",
      "Оптимално съотношение качество/цена",
      "Разходи",
      "Оптимално съотношение качество/цена; Най-ниска цена",
      "Най-ниска цена; Разходи",
      "Оптимално съотношение качество/цена; Разходи",
    ]);
    const unexpected = rows
      .map((r) => r.award_method)
      .filter((v): v is string => v != null && !known.has(v));
    assert.deepEqual(
      unexpected,
      [],
      "a new award_method value appeared. Add it to procurement_award_criterion_bucket() " +
        "in 164 AND to this list — until then it is counted as `other`, which is visible " +
        "but unlabelled on the tile",
    );

    const p = await payload();
    const other = [...p.byYear, ...p.byType].reduce((a, r) => a + r.other, 0);
    assert.equal(
      other,
      0,
      "`other` is non-zero while the domain check passed — the bucket function and " +
        "this test disagree about what the known values are",
    );
  },
);

test.skipIf(skip)(
  "the no-call predicate is this function's own, not 037's",
  async () => {
    // 037's list includes „Покана до определени лица" (0.0% blank — it ALWAYS
    // carries a criterion) and omits three types that carry none. Reusing it
    // would be wrong in both directions; assert the divergence explicitly so a
    // future "consolidation" cannot quietly adopt the contracts-side list.
    const [invited] = await allRows<{ n: string }>(
      "SELECT count(*) n FROM tenders WHERE procedure_type = 'Покана до определени лица'",
    );
    assert.ok(
      Number(invited.n) > 0,
      "fixture: expected some „Покана до определени лица" + '" tenders',
    );
    const [excluded] = await allRows<{ v: boolean }>(
      "SELECT procurement_no_call_procedure('Покана до определени лица') AS v",
    );
    assert.equal(
      excluded.v,
      false,
      '„Покана до определени лица" is being treated as no-call. It is 0.0% blank — ' +
        "excluding it drops criterion-bearing tenders from the denominator (plan §10b)",
    );

    // …and the four that genuinely carry no criterion ARE excluded.
    for (const pt of [
      "Договаряне без предварително обявление",
      "Пряко договаряне",
      "Договаряне без предварителна покана за участие",
      "Договаряне без публикуване на обявление за поръчка",
    ]) {
      const [r] = await allRows<{ v: boolean }>(
        "SELECT procurement_no_call_procedure($1) AS v",
        [pt],
      );
      assert.equal(r.v, true, `${pt} should be excluded as no-call`);
    }
  },
);

test.skipIf(skip)(
  "byYear is floored at the year the field starts, and says how much it dropped",
  async () => {
    const p = await payload();
    const earliest = p.byYear.map((r) => r.year ?? "").sort()[0];
    assert.ok(
      earliest >= p.firstYear,
      `byYear starts at ${earliest}, before firstYear ${p.firstYear} — rendering the ` +
        "pre-ЦАИС years draws a data-availability cliff as a policy change (plan §1b)",
    );
    assert.ok(
      p.coverage.preCriterionTenders > 0,
      "preCriterionTenders is 0 — the floor is dropping nothing, so either the corpus " +
        "changed or the counter is not measuring what it claims",
    );
  },
);
