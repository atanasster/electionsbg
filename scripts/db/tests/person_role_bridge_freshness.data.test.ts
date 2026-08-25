// How far the CORPUS has moved under the licences on file — the drift measurement that
// `person_resolve.data.test.ts` used to report, misleadingly, as red roles.
// Plan: docs/plans/person-role-unlicensed-bridge-v1.md (step 5).
//
// THE DIVISION OF LABOUR, and why these are two gates rather than one.
//
// `person_resolve.data.test.ts` asks "was this attribution licensed WHEN IT WAS MADE?" — a
// stored fact, time-invariant, and a hard failure when it is not. This file asks "do those
// licences still rest on premises that hold TODAY?" — inherently time-dependent, because the
// footprint is measured over `tr_officers` / `tr_person_roles`, which `db:load:tr:pg`
// TRUNCATEs and reloads on its own schedule.
//
// Conflating the two is exactly what went wrong: the old gate computed the second and
// reported it as the first, so an ordinary TR refresh two days after a resolve turned 443
// correctly-licensed roles into "unlicensed attributions" and the gate sat red — not flaky,
// not stale, just answering a question it could not answer. A red-by-default gate is a gate
// nobody reads, on the defamation-sensitive invariant of the whole TR layer.
//
// ⚠️ SO THIS ONE IS DELIBERATELY HARD TO TURN RED, AND ALWAYS LOUD. It prints the drift on
// every run whether or not it fails, because the number is the point; the threshold exists
// only to say "the person layer is now too far behind to trust", not "somebody registered a
// company". Those are different events and the measured distribution below separates them
// cleanly.
//
//   npm run test:data

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, end } from "../lib/pg";
import { FOOTPRINT_CAP } from "../../person/bridgeB";
import { reportSkip } from "../../lib/report_skip";

// The share of the non-Bridge-A layer whose licence premise ("this fold holds at most
// FOOTPRINT_CAP companies, so it is plausibly one person") no longer holds.
//
// ⚠️ ARGUED FROM THE DATA, NOT CHOSEN TO BE GREEN. Measured 2026-08-25, two days and one
// `db:load:tr:pg` after the last resolve: 82,247 people in the layer, 687 of them drifted
// upward, and **63 crossed the cap** — 0.077%. The drift is overwhelmingly benign: 642 of the
// 687 gained exactly ONE company, which is a person registering a firm, not a namesake
// problem. Crossing the CAP is the precise event that invalidates a licence's premise, which
// is why the threshold is on that and not on the drift count.
//
// What 1% makes TRUE: 2,129 people currently sit exactly AT the cap, so one new filing decays
// each. One TR load moved ~3% of them. Reaching 822 people (1%) therefore takes on the order
// of a dozen loads — roughly a fortnight of daily refreshes. So the gate says: "a person
// layer may run about two weeks behind its licensing inputs; past that, re-resolve." That is
// an honest maximum staleness for a layer whose rebuild is a 37-minute operator action plus a
// documented repair chain, and it leaves 13x headroom today rather than pinning the current
// state as acceptable.
const STALE_SHARE_MAX = 0.01;

const reachable = async (): Promise<boolean> => {
  try {
    const [t] = await allRows<{ ok: boolean }>(
      `SELECT to_regclass('public.person_role') IS NOT NULL
          AND to_regclass('public.tr_person_roles') IS NOT NULL
          AND to_regclass('public.company_politicians') IS NOT NULL AS ok`,
    );
    if (!t?.ok) return false;
    const [c] = await allRows<{ n: string }>(
      "SELECT count(*) n FROM person_role WHERE source IN ('tr', 'ngo')",
    );
    return Number(c.n) > 0;
  } catch {
    return false;
  }
};

const haveDb = await reachable();
const skip = haveDb
  ? false
  : "Postgres unreachable / no tr-ngo roles to measure";
reportSkip(import.meta.url, skip);

afterAll(async () => {
  await end();
});

// ⚠️ IT DOES NOT NEED `bridge_footprint`, AND THAT IS DELIBERATE. The stored baseline is
// preferred when present — it is what the resolver actually measured — but it is NULL on
// every database until the next resolve (081 ships no backfill), and a drift gate that could
// not run until then would leave the signal this whole plan is about carried by nothing.
//
// The fallback is sound rather than a guess: both name-based bridges attach the WHOLE
// footprint they measured, so a person's stored distinct EIK count IS the footprint the
// resolver saw. Verified at plan §1.4 — across all 82,247 people in the layer the stored
// count stops dead at FOOTPRINT_CAP and no person exceeds it, which is only possible if every
// attachment was capped.
//
// ⚠️ THE BASELINE COUNTS CURATED REFS TOO, and an earlier version of this file excluded them
// on the reasoning that "Bridge A is not footprint-capped, so including them would inflate the
// baseline". That is backwards for the population it touches. `BRIDGE_B_CTE`'s footprint is
// `count(DISTINCT uic) FROM hits`, and `hits` joins `tr_person_roles` on the fold with NO
// curated filter — so the number the cap was compared against is the WHOLE FOLD, curated
// companies included, which is exactly what `cur` computes. Subtracting them from one side
// only compares two different populations. Measured over the 2,023 people holding at least one
// curated ref: the whole-ref count equals the current fold for 1,962 of them and the
// curated-excluded count equals it for ZERO — so the exclusion manufactured 952 of the 1,639
// drifts the first version reported, 58% of the total.
//
// The curated set is still used, for MEMBERSHIP rather than counting: a person whose every ref
// is curated holds no footprint licence at all (they are pure Bridge A, which has no cap), so
// they are not in the population this gate measures. That is the `HAVING` below.
const DRIFT_SQL = `
  WITH curated AS (
    SELECT eik FROM magistrate_company WHERE eik IS NOT NULL AND NOT eik_ambiguous
    UNION SELECT eik FROM company_politicians
  ),
  base AS (
    -- ⚠️ ::int ON EVERY COUNT. count() is bigint, and node-postgres hands bigint back as a
    -- STRING to avoid precision loss — so cur > baseline in JS would be a LEXICOGRAPHIC
    -- compare. "11" > "5" is FALSE, which silently dropped precisely the WIDEST drifters from
    -- the report: the gate printed 2 -> 7 as the worst case while a 5 -> 11 sat unreported.
    -- Nothing failed, because the threshold coerces numerically — only the number this gate
    -- exists to publish was wrong, and it degrades further as the layer ages.
    SELECT r.person_id,
           count(DISTINCT r.ref)::int                  AS derived,
           max(r.bridge_footprint) FILTER (WHERE r.bridge IN ('B', 'V'))::int AS stored
      FROM person_role r
     WHERE r.source IN ('tr', 'ngo')
     GROUP BY r.person_id
    -- Membership, not counting: a person with no non-curated ref is pure Bridge A, which
    -- carries no footprint licence, so there is nothing here to measure the freshness of.
    HAVING count(*) FILTER (
             WHERE NOT EXISTS (SELECT 1 FROM curated c WHERE c.eik = r.ref)) > 0
  ),
  fold AS (
    -- ⚠️ COUNTED OVER tr_person_roles FOR BOTH BRIDGES. Correct for B by construction — its
    -- footprint CTE joins that table. For V the stored footprint was capped over tr_officers
    -- instead (resolve_persons.ts says so at the Tier-V INSERT). The two agree on all 544,754
    -- folds today, verified 2026-08-25 with 0 disagreeing, which is precisely why a divergence
    -- would surface HERE as unexplained drift rather than as an error. If they ever part, split
    -- this CTE by bridge.
    SELECT name_fold, count(DISTINCT uic)::int AS cur
      FROM tr_person_roles GROUP BY name_fold
  )
  SELECT b.person_id, p.slug, p.display_name,
         COALESCE(b.stored, b.derived) AS baseline,
         b.derived                     AS derived,
         b.stored IS NOT NULL          AS from_stored,
         COALESCE(f.cur, 0)            AS cur,
         -- The over-cap predicate, computed HERE as well as in JS. Not redundancy: the
         -- baseline is cap-bounded by construction, so a JS filter accidentally reading it
         -- instead of cur is identically zero in every corpus state and passes every other
         -- assertion in this file. Two independent computations of one predicate, in two
         -- languages, is what makes that swap visible — the JS set must equal this flag.
         COALESCE(f.cur, 0) > $1       AS over_cap
    FROM base b
    JOIN person p USING (person_id)
    LEFT JOIN fold f ON f.name_fold = p.name_fold`;

/** The drift rows, computed ONCE. Both tests read the same aggregate — 1.36M rows grouped and
 *  joined to ~82k people, ~2.7 GB of reads with a temp spill — and running it per test paid
 *  that twice for one answer. A memoized promise also guarantees the two tests reason about
 *  the SAME snapshot, which matters here: a concurrent db:load:tr:pg between them would
 *  otherwise let the connectivity test vouch for numbers the threshold never saw. */
let cached: Promise<Row[]> | null = null;
const driftRows = (): Promise<Row[]> =>
  (cached ??= allRows<Row>(DRIFT_SQL, [FOOTPRINT_CAP]));

type Row = {
  person_id: string;
  slug: string;
  display_name: string;
  baseline: number;
  derived: number;
  from_stored: boolean;
  over_cap: boolean;
  cur: number;
};

test.skipIf(skip)(
  "the licences on file still rest on premises that hold",
  async () => {
    const rows = await driftRows();
    assert.ok(rows.length > 0, "no licensed people to measure");

    const drifted = rows.filter((r) => r.cur > r.baseline);
    const overCap = rows.filter((r) => r.cur > FOOTPRINT_CAP);
    // The cross-check described at the `over_cap` column. A disagreement means the metric is
    // reading a different column from the one the predicate names — most plausibly `baseline`,
    // which can never exceed the cap, so the gate would report 0% for ever while green.
    assert.deepEqual(
      overCap.map((r) => r.person_id).sort(),
      rows
        .filter((r) => r.over_cap)
        .map((r) => r.person_id)
        .sort(),
      "the over-cap metric disagrees with the same predicate evaluated in SQL — check it " +
        "reads `cur` (the current fold) and not `baseline` (which is cap-bounded by " +
        "construction and can never trip it).",
    );
    const share = overCap.length / rows.length;
    const worst = [...drifted]
      .sort((a, b) => b.cur - b.baseline - (a.cur - a.baseline))
      .slice(0, 5);
    // COUNTED, not `.some()`. A partially-stamped corpus is the normal state DURING a
    // resolve's repair chain, and one stamped row claiming "stored" for the whole run would
    // misdescribe 82,246 derived ones.
    const stored = rows.filter((r) => r.from_stored).length;
    const basis =
      stored === rows.length
        ? "stored bridge_footprint"
        : stored === 0
          ? "DERIVED from the attached footprint (no resolve has stamped bridge yet)"
          : `MIXED — ${stored.toLocaleString()} stored, ${(
              rows.length - stored
            ).toLocaleString()} derived`;

    // Printed on EVERY run, pass or fail. The number is the deliverable; the threshold is
    // only the point at which it stops being informational.
    console.log(
      `  licence freshness — baseline: ${basis}\n` +
        `    ${rows.length.toLocaleString()} licensed people; ` +
        `${drifted.length.toLocaleString()} drifted upward; ` +
        `${overCap.length.toLocaleString()} now over FOOTPRINT_CAP=${FOOTPRINT_CAP} ` +
        `(${(share * 100).toFixed(3)}%, threshold ${(STALE_SHARE_MAX * 100).toFixed(1)}%)\n` +
        (worst.length
          ? `    widest drift: ${worst
              .map((w) => `${w.slug} ${w.baseline}→${w.cur}`)
              .join(", ")}`
          : "    no drift"),
    );

    assert.ok(
      share <= STALE_SHARE_MAX,
      `${overCap.length} of ${rows.length} licensed people (${(share * 100).toFixed(2)}%) ` +
        `now sit above FOOTPRINT_CAP=${FOOTPRINT_CAP}, past the ${(
          STALE_SHARE_MAX * 100
        ).toFixed(
          1,
        )}% ceiling. ⚠️ THIS IS NOT A RESOLVER BUG AND THE ROLES ARE NOT WRONG — ` +
        `every one was attached inside the cap; the TR corpus has moved underneath them since. ` +
        `The person layer is too far behind its licensing inputs to trust: run ` +
        `\`npm run db:resolve:persons\` and its repair chain (CLAUDE.md, "A LOCAL ` +
        `db:resolve:persons is never one command"). Do NOT widen FOOTPRINT_CAP to clear this ` +
        `— the cap is calibrated, and raising it changes whose companies get published.`,
    );
  },
);

// The measurement must keep DISCRIMINATING. A drift gate that reports zero because its two
// sides stopped lining up is worse than none: it reads as "the layer is current" for ever.
// Two ways that happens, and both have a real cause — the fold join silently missing (a
// `name_fold` normaliser change on either side), or the baseline collapsing to zero.
test.skipIf(skip)("the drift measurement is still connected", async () => {
  const rows = await driftRows();
  const joined = rows.filter((r) => r.cur > 0);
  assert.ok(
    joined.length > rows.length * 0.9,
    `only ${joined.length} of ${rows.length} licensed people join tr_person_roles on their ` +
      `name_fold. The measurement is comparing against nothing, so it will report zero drift ` +
      `whatever the corpus does — check translit_bg_latin has not changed on one side only.`,
  );
  // ⚠️ THE ASYMMETRY THAT MAKES THE METRIC READ `cur`. `baseline` is cap-bounded by
  // construction — both bridges refuse a fold above FOOTPRINT_CAP — so it can NEVER trip the
  // over-cap filter. That means a filter accidentally pointed at `baseline` instead of `cur`
  // yields share = 0 for ever, in every corpus state, and passes every other assertion in this
  // file. Stating the bound as an assertion makes that swap visibly always-zero rather than
  // quietly green, and it fails if the cap is ever NARROWED beneath the licences on file.
  // (Measured 2026-08-25: `cur > 5` is 63 people, `baseline > 5` is 0.)
  assert.ok(
    rows.every((r) => r.baseline >= 1 && r.baseline <= FOOTPRINT_CAP),
    `a licensed baseline is outside 1..${FOOTPRINT_CAP} — either the baseline query stopped ` +
      `measuring the attached footprint, or FOOTPRINT_CAP was narrowed beneath licences ` +
      `already issued.`,
  );
  // The two baselines must be the SAME QUANTITY, or COALESCE silently produces a column with
  // two meanings and a partially-stamped corpus compares apples to pears. This is exactly what
  // the curated-exclusion bug did: `stored` counts the whole fold, and the first version's
  // `derived` counted a curated-excluded subset, so the two would have diverged on the very
  // resolve this gate exists to survive. It is a no-op until something is stamped, and the
  // moment anything is it becomes the check that catches a re-divergence.
  const bothKnown = rows.filter((r) => r.from_stored);
  const disagree = bothKnown.filter((r) => r.baseline !== r.derived);
  assert.ok(
    disagree.length <= bothKnown.length * 0.02,
    `${disagree.length} of ${bothKnown.length} stamped people have a stored footprint that ` +
      `disagrees with the one derived from their attached rows (e.g. ${disagree
        .slice(0, 3)
        .map((d) => `${d.slug} stored=${d.baseline} derived=${d.derived}`)
        .join(
          ", ",
        )}). The two must measure the same thing, or COALESCE mixes two quantities ` +
      `in one column.`,
  );

  // TEST-001: the columns must arrive as NUMBERS. count() is bigint, which node-postgres
  // returns as a string, and `>` between two strings is lexicographic — the defect that hid
  // the widest drifters. A ::int dropped from the query is invisible to every assertion above,
  // because the threshold path coerces.
  assert.ok(
    rows.every(
      (r) => typeof r.cur === "number" && typeof r.baseline === "number",
    ),
    `drift columns arrived as ${typeof rows[0]?.cur}/${typeof rows[0]?.baseline}, not numbers. ` +
      `Restore the ::int casts: "11" > "5" is FALSE, so the widest drift is dropped from the ` +
      `report while nothing fails.`,
  );
  // Non-vacuity on the CURRENT side. "Some drift must exist" is the tempting assertion and it
  // is wrong: immediately after a resolve the drift is legitimately zero, and a gate that
  // demanded otherwise would fail on the one state everything here is working towards. What
  // must hold in every state is that the current fold is a MEASUREMENT — so it varies. A
  // constant on that side (a mis-edited aggregate, a join collapsed to a literal) reports the
  // corpus as unmoved for ever, and slipped past an earlier version of this assertion.
  const distinctCur = new Set(rows.map((r) => r.cur)).size;
  assert.ok(
    distinctCur > 1,
    `every licensed person's current fold is the same number (${rows[0]?.cur}) — the current ` +
      `side is a constant, not a count over tr_person_roles, so no corpus movement can ever ` +
      `register.`,
  );
});
