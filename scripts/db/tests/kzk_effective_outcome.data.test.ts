// `kzk_effective_outcome(outcome, status)` (042) — the derived answer for
// `отказано производство`, КЗК's refusal to open proceedings at all.
//
// ⚠️ THE INVARIANT THIS FILE EXISTS FOR IS "NEVER STORED", and no other gate can
// see it. The function's header argues at length that an `UPDATE kzk_appeals SET
// outcome = …` would land 1,661 rows in the bucket migration 131 reserves for the
// ~2,098 irreplaceable hand-seeded ones — and that
// kzk_appeals_provenance.data.test.ts would STAY GREEN through it, because its
// floor is a `>=`. An argument in a comment is not a gate. This is the gate.
//
// The sibling kzk_effective_suspension has kzk_suspension.data.test.ts for the
// same reason; this is its twin.
//
//   npm run test:data

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, dbReachable, end } from "../lib/pg";
import { reportSkip } from "../../lib/report_skip";

const haveDb = await dbReachable();
const appealsLoaded =
  haveDb &&
  Number(
    (
      await allRows<{ n: string }>("SELECT count(*) n FROM kzk_appeals").catch(
        () => [{ n: "0" }],
      )
    )[0]?.n ?? 0,
  ) > 0;
const skip = !haveDb
  ? "Postgres unreachable"
  : !appealsLoaded
    ? "kzk_appeals is empty — run the КЗК intake crawl first"
    : false;
reportSkip(import.meta.url, skip);

afterAll(async () => {
  await end();
});

test.skipIf(skip)("the function exists", async () => {
  const [r] = await allRows<{ ok: string }>(
    "SELECT to_regprocedure('kzk_effective_outcome(text,text)')::text AS ok",
  );
  assert.ok(
    r?.ok,
    "kzk_effective_outcome is MISSING — apply 042_kzk_appeals.sql. Without it " +
      "1,661 refused proceedings render as a blank outcome.",
  );
});

test.skipIf(skip)(
  "the derived value is NEVER stored — 131's provenance rule stays intact",
  async () => {
    // The whole point. A stored `отказана` would carry no decision_act_no and so
    // would be indistinguishable from a hand-seeded row, inflating the protected
    // population and freezing those rows against every future matcher fix.
    const [r] = await allRows<{ n: string }>(
      "SELECT count(*) n FROM kzk_appeals WHERE outcome = 'отказана'",
    );
    assert.equal(
      Number(r.n),
      0,
      `${r.n} row(s) have 'отказана' STORED in kzk_appeals.outcome. It is derived ` +
        "at query time by kzk_effective_outcome() and must never be written — a " +
        "stored copy has no decision_act_no, so partitionByProvenance() reads it " +
        "as one of the ~2,098 irreplaceable hand-seeded rows. Recover from a " +
        "restore point; do NOT simply delete the value, because a writer that " +
        "produced it will produce it again.",
    );
  },
);

test.skipIf(skip)("a stored outcome WINS over the status", async () => {
  // 12 appeals carry both a refusal status and a hand-seeded merits outcome
  // (9 уважена, 3 отхвърлена). Either the status is stale or the seeding was
  // wrong; either way the human's answer is kept, the same precedence
  // kzk_effective_suspension uses. Asserted as a property, not a count, so a
  // corpus refresh that changes the 12 does not fail this.
  const rows = await allRows<{ outcome: string; eff: string }>(
    `SELECT outcome, kzk_effective_outcome(outcome, status) AS eff
       FROM kzk_appeals
      WHERE outcome IS NOT NULL AND status ~* 'отказано'`,
  );
  assert.ok(
    rows.length > 0,
    "no appeal carries BOTH a refusal status and a stored outcome — the COALESCE " +
      "precedence is untested here. If the corpus really has none, this test is " +
      "vacuous and should be re-pointed rather than deleted.",
  );
  for (const r of rows)
    assert.equal(
      r.eff,
      r.outcome,
      `kzk_effective_outcome overwrote a stored outcome (${r.outcome} → ${r.eff}). ` +
        "The stored value must always win; only a NULL is filled from the status.",
    );
});

test.skipIf(skip)(
  "it fills exactly the refused proceedings, and nothing else",
  async () => {
    const [r] = await allRows<{
      refused: string;
      derived: string;
      other_derived: string;
    }>(
      `SELECT count(*) FILTER (WHERE status ~* 'отказано')             AS refused,
              count(*) FILTER (WHERE outcome IS NULL
                               AND kzk_effective_outcome(outcome, status) = 'отказана')
                                                                       AS derived,
              count(*) FILTER (WHERE status !~* 'отказано'
                               AND outcome IS NULL
                               AND kzk_effective_outcome(outcome, status) IS NOT NULL)
                                                                       AS other_derived
         FROM kzk_appeals`,
    );
    assert.ok(
      Number(r.refused) > 0,
      "no appeal carries 'отказано производство' — the derivation is untested here.",
    );
    assert.equal(
      Number(r.other_derived),
      0,
      `${r.other_derived} appeal(s) gained an outcome from a status that is NOT a ` +
        "refusal. The CASE must match 'отказано' and nothing else — a looser " +
        "pattern would publish a verdict КЗК never reached.",
    );
    // Every refused appeal without a stored outcome must get the derived one:
    // refused = derived + (those that already had one and keep it).
    const [c] = await allRows<{ n: string }>(
      `SELECT count(*) n FROM kzk_appeals
        WHERE status ~* 'отказано' AND outcome IS NOT NULL`,
    );
    assert.equal(
      Number(r.derived) + Number(c.n),
      Number(r.refused),
      "the refused population does not partition into derived + already-stored — " +
        "some refused appeal is getting neither.",
    );
  },
);

test.skipIf(skip)(
  "the derived value cannot reach anything that counts upholds",
  async () => {
    // `отказана` must never be scored as a merits uphold: upheld_ocids feeds the
    // contract Corruption Risk Index, which grades named procurement procedures.
    const [r] = await allRows<{ n: string }>(
      `SELECT count(*) n FROM kzk_appeals
        WHERE kzk_effective_outcome(outcome, status) = 'отказана'
          AND outcome = 'уважена'`,
    );
    assert.equal(
      Number(r.n),
      0,
      "a refused proceeding is being reported as an uphold — the COALESCE order " +
        "has been inverted.",
    );

    // And the serving view agrees with the base table on upholds, i.e. the
    // derived column did not displace any merits verdict.
    const [v] = await allRows<{ raw: string; served: string }>(
      `SELECT (SELECT count(*) FROM kzk_appeals WHERE outcome = 'уважена') AS raw,
              (SELECT count(*) FROM kzk_appeals_list WHERE outcome = 'уважена') AS served`,
    );
    assert.equal(
      v.served,
      v.raw,
      `kzk_appeals_list publishes ${v.served} upholds against ${v.raw} stored. The ` +
        "effective outcome must only ever FILL a null, never replace a verdict.",
    );
  },
);

test.skipIf(skip)("the serving view publishes the derived value", async () => {
  // Mutation check: without it every assertion above is satisfied by a view that
  // simply never adopted the function.
  const [r] = await allRows<{ n: string }>(
    "SELECT count(*) n FROM kzk_appeals_list WHERE outcome = 'отказана'",
  );
  assert.ok(
    Number(r.n) > 0,
    "kzk_appeals_list publishes no 'отказана' — the view is still selecting the " +
      "RAW outcome column, so 1,661 refused proceedings render blank on " +
      "/procurement/appeals. Re-apply 042_kzk_appeals.sql.",
  );
});
