// The МЗ second-level roster's CORPUS invariants — the half of the gate that
// needs a database, split from src/lib/mzSecondLevelBodies.test.ts on the
// educationReferenceData pattern. That file holds everything decidable from the
// source alone; this one answers the two questions only the corpus can:
//
//   · does every row still LAND — i.e. is /awarder/:eik servable for it;
//   · does the corpus hold an МЗ second-level body this roster has not got;
//   · are the two retired EIKs really two halves of one institution's history,
//     which needs their contract DATES and so cannot be asked of the source.
//
// The second is the one that matters most, because it is what makes the roster's
// stated omissions self-retiring. Five РЗИ (Разград, Сливен, Шумен, Ямбол,
// Софийска област) are deliberately absent for having no procurement, and the
// roster's header argues that omission is safe BECAUSE this test fires the day
// one of them awards a contract. Until this file existed, that argument was a
// sentence rather than a gate.
//
// Plan: docs/plans/health-mz-bodies-search-v1.md (T4b).

import { test, describe, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, end } from "../lib/pg";
import { reportSkip } from "../../lib/report_skip";
import {
  MZ_SECOND_LEVEL_BODIES,
  MZ_SECOND_LEVEL_INSTITUTION_COUNT,
} from "@/lib/mzSecondLevelBodies";

/**
 * `false` when the corpus is here, otherwise the AUTHORED reason it is not.
 *
 * ⚠️ TWO STATES, TWO SENTENCES — this was one probe returning `false` for both,
 * under the single message „Postgres unreachable / contracts table absent". The
 * half such a message gets wrong is always the outage, which is the one warning
 * an operator is trained to ignore (`mp_arm_sql`'s header records it hiding a
 * two-day one). A server that is down wants the container started; a database
 * with no `contracts` wants the loader run, and the remedies are not the same.
 */
const corpusState = async (): Promise<string | false> => {
  try {
    const [t] = await allRows<{ ok: boolean }>(
      "SELECT to_regclass('public.contracts') IS NOT NULL AS ok",
    );
    return t?.ok
      ? false
      : "the contracts table is absent — run npm run db:load:pg";
  } catch (e) {
    return `Postgres unreachable (${(e as Error).message})`;
  }
};

const skip = await corpusState();
reportSkip(import.meta.url, skip);

afterAll(async () => {
  await end();
});

const EIKS = MZ_SECOND_LEVEL_BODIES.map((b) => b.eik);
const nameOf = (eik: string) =>
  MZ_SECOND_LEVEL_BODIES.find((b) => b.eik === eik)?.name ?? eik;

/** Everything `/awarder/:eik` needs to render something rather than the
 *  not-found branch — the same four arms `sector_members_land.data.test.ts`
 *  uses, restated here because that file enumerates SECTOR_DASHBOARDS members
 *  and this roster is deliberately not one of them. */
const LANDS_SQL = `
  SELECT
    m.eik,
    (institution_identity(m.eik) IS NOT NULL)                          AS institution,
    EXISTS (SELECT 1 FROM tr_companies t WHERE t.uic = m.eik)          AS tr,
    EXISTS (SELECT 1 FROM contracts c WHERE c.awarder_eik = m.eik)     AS awarder,
    EXISTS (SELECT 1 FROM contracts c WHERE c.contractor_eik = m.eik)  AS contractor
  FROM unnest($1::text[]) AS m(eik)`;

/** The corpus-side sweep for this family.
 *
 *  ⚠ IT IS NOT THE ROSTER AND CANNOT BE. The roster is curated by EIK precisely
 *  because a name sweep fails in both directions — see the roster's header — so
 *  this is a LOWER BOUND, and the reconcile below reads it as one: it asks only
 *  „is every swept EIK in the roster", never the converse.
 *
 *  ⚠ THE FOURTH ILIKE IS LOAD-BEARING — do not tidy it away as a near-duplicate
 *  of the third. `%обществено здраве%` does NOT match „обществе*ното* здраве", so
 *  without the РИОКОЗ pattern „Регионална инспекция за опазване и контрол на
 *  общественото здраве /РИОКОЗ/ - Бургас" (000053451) is invisible here.
 *  Measured: three patterns sweep 54 EIKs, four sweep 55.
 *
 *  What must NOT be added is an ACRONYM pattern. `%РЗИ%` matches „с. Бъ*рзи*я"
 *  and „Злати Те*рзи*ев"; `%ЦСМП%` matches „А*МЦСМП*", a private clinic. Those
 *  would make the sweep an upper bound too, and the reconcile would start
 *  demanding that unrelated bodies be added to the roster. */
const SWEEP_SQL = `
  SELECT DISTINCT awarder_eik AS eik
    FROM contracts
   WHERE tag = 'contract'
     AND (awarder_name ILIKE '%спешна медицинска помощ%'
       OR awarder_name ILIKE '%регионална здравна инспекц%'
       OR awarder_name ILIKE '%обществено здраве%'
       OR awarder_name ILIKE '%опазване и контрол на общественото здраве%')`;

describe.skipIf(skip)("МЗ second-level roster — every row lands", () => {
  test("every EIK has a servable /awarder page", async () => {
    // Non-vacuity first: every assertion below is satisfied by an empty roster.
    assert.ok(EIKS.length > 50, `only ${EIKS.length} bodies enumerated`);

    const rows = await allRows<{
      eik: string;
      institution: boolean;
      tr: boolean;
      awarder: boolean;
      contractor: boolean;
    }>(LANDS_SQL, [EIKS]);
    const deadEnds = rows
      .filter((r) => !(r.institution || r.tr || r.awarder || r.contractor))
      .map(
        (r) =>
          `${r.eik} ${nameOf(r.eik)} — no institution, no ТР row, no contracts ` +
          `either side: /awarder/${r.eik} dead-ends, so it must come out of the ` +
          `roster (membersIndex RULE 1: every search row must land)`,
      );
    assert.deepEqual(
      deadEnds.sort(),
      [],
      "roster rows whose awarder page dead-ends",
    );
    // `unnest` returns one row per input element, so a length equality here
    // cannot fail. What CAN go wrong is the roster carrying an EIK twice — the
    // unit gate asserts that from the source, so this asserts the set actually
    // probed, which is the thing this query depends on.
    assert.deepEqual(
      rows.map((r) => r.eik).sort(),
      [...EIKS].sort(),
      "LANDS_SQL probed a different EIK set than the roster",
    );
  });
});

describe.skipIf(skip)("МЗ second-level roster — corpus reconcile", () => {
  test("the corpus holds no МЗ body this roster is missing", async () => {
    const swept = (await allRows<{ eik: string }>(SWEEP_SQL)).map((r) => r.eik);

    // The floor `sector_stats.data.test.ts` states for its own copy of this
    // sweep, and for its reason: a `> 10` floor would still pass after a reload
    // that lost 40 of them, leaving the comparison below measuring almost
    // nothing. 55 today.
    assert.ok(
      swept.length >= 40,
      `sweep found only ${swept.length} bodies (expected ~55) — the corpus, not ` +
        `the roster, is what to check first`,
    );

    // ⚠ THIS IS THE ASSERTION THE ROSTER'S OMISSIONS REST ON. Разград, Сливен,
    // Шумен, Ямбол and Софийска област have no РЗИ in the corpus and are left
    // out; the day one of them awards a contract, it appears here and this fires.
    // Renames land here too — the sweep keys on awarder_name.
    const missing = swept.filter((e) => !EIKS.includes(e)).sort();
    assert.deepEqual(
      missing,
      [],
      `the corpus has МЗ second-level awarders the roster does not list — add ` +
        `them to src/lib/mzSecondLevelBodies.ts (each needs a canonical ` +
        `acronym-led label and a universe): ${missing.join(", ")}`,
    );
  });

  test("the sweep still COVERS the roster, so the arm above is load-bearing", async () => {
    // The reconcile is one-directional by design, which means it cannot notice
    // the sweep getting NARROWER — and a narrower sweep is a weaker gate, not a
    // failure, so nothing else here would fire. Demonstrated: deleting the
    // РИОКОЗ ILIKE takes the sweep 55 → 54 and every other test in this file
    // stays green.
    //
    // So pin the coverage. `UNSWEEPABLE` is the escape hatch for a body the
    // corpus genuinely records under a name no pattern can match without also
    // matching „с. Бързия" — empty today, and an entry must carry its reason.
    const UNSWEEPABLE: readonly string[] = [];
    const swept = new Set(
      (await allRows<{ eik: string }>(SWEEP_SQL)).map((r) => r.eik),
    );
    const unswept = EIKS.filter(
      (e) => !swept.has(e) && !UNSWEEPABLE.includes(e),
    )
      .map((e) => `${e} ${nameOf(e)}`)
      .sort();
    assert.deepEqual(
      unswept,
      [],
      `roster bodies the sweep no longer finds — the corpus→roster reconcile is ` +
        `blind to these, so an ILIKE was probably narrowed or a name changed`,
    );
  });

  test("no roster EIK has left the corpus", async () => {
    const rows = await allRows<{ eik: string }>(
      `SELECT DISTINCT awarder_eik AS eik
         FROM contracts
        WHERE tag = 'contract' AND awarder_eik = ANY($1::text[])`,
      [EIKS],
    );
    const seen = new Set(rows.map((r) => r.eik));
    const gone = EIKS.filter((e) => !seen.has(e))
      .map((e) => `${e} ${nameOf(e)}`)
      .sort();
    // A body with no contracts is a row that renders but says nothing, and — for
    // the two retired РИОКОЗ EIKs, whose whole justification is the contracts
    // they carry — a row with no reason to exist.
    assert.deepEqual(gone, [], "roster EIKs with no contracts in the corpus");
  });

  test("the family is worth what a reader would be told, and is not the sector", async () => {
    // ⚠ The DISJOINTNESS is asserted in mzSecondLevelBodies.test.ts, not here.
    // It is decidable from the source, so putting it in a Postgres file only
    // means it stops running on a machine without a database — and this file's
    // first draft carried it under the comment "asserted from the corpus side",
    // which was simply false: it ran no query. What belongs here is the half the
    // source cannot answer — that the money the disjointness protects the sector
    // headline FROM is real and large.
    const [row] = await allRows<{ eur: string; n: string }>(
      `SELECT round(sum(amount_eur)::numeric)::text AS eur, count(*)::text AS n
         FROM contracts
        WHERE tag = 'contract' AND awarder_eik = ANY($1::text[])`,
      [EIKS],
    );
    // Reported rather than pinned — the corpus grows, and a hard € would fail
    // every reload for no reason. What is pinned is the ORDER of magnitude, so
    // that a reconcile which quietly dropped most of the family is visible here
    // as well as in the count above. €86.9m measured 2026-08-26.
    assert.ok(
      Number(row?.eur ?? 0) > 50_000_000,
      `the family is worth €${row?.eur} over ${row?.n} contracts — expected ` +
        `tens of millions; a collapse means the roster or the corpus moved`,
    );
  });

  test("institutions, not EIKs — and the retired pairs are why", async () => {
    // The count the reader-facing copy quotes. Asserted HERE too, against the
    // corpus, because the unit gate can only check the arithmetic: it cannot see
    // that both halves of each retired pair are real awarders, which is the whole
    // reason both halves ship.
    assert.equal(MZ_SECOND_LEVEL_INSTITUTION_COUNT, 53);
    const retired = MZ_SECOND_LEVEL_BODIES.filter((b) => b.retiredEikOf);
    // Deduped: two retired rows may legitimately point at ONE successor, and an
    // undeduped list would then fail the row-count check below on a correct
    // roster, reporting a corpus problem that does not exist.
    const pairs = [
      ...new Set(retired.flatMap((b) => [b.eik, b.retiredEikOf!])),
    ];
    // ⚠ `contracts.date` is TEXT, not a date, so `min`/`max` are STRING extrema
    // and the comparison below is a string compare. That is correct for ISO
    // `YYYY-MM-DD` and silently wrong for anything else, so the shape is asserted
    // rather than assumed — a malformed date would otherwise satisfy the
    // succession check by sorting early.
    const rows = await allRows<{ eik: string; first: string; last: string }>(
      `SELECT awarder_eik AS eik, min(date) AS first, max(date) AS last
         FROM contracts
        WHERE tag = 'contract' AND awarder_eik = ANY($1::text[])
        GROUP BY 1`,
      [pairs],
    );
    for (const r of rows)
      for (const d of [r.first, r.last])
        assert.match(
          d,
          /^\d{4}-\d{2}-\d{2}$/,
          `${r.eik} has a non-ISO date ${d}; the string comparison below cannot ` +
            `order it`,
        );
    assert.equal(
      rows.length,
      pairs.length,
      "a retired pair is not in the corpus",
    );
    const byEik = new Map(rows.map((r) => [r.eik, r]));
    for (const b of retired) {
      const old = byEik.get(b.eik)!;
      const now = byEik.get(b.retiredEikOf!)!;
      // The succession, not merely the existence of two rows. If the predecessor
      // is still filing after its successor started, they are two live bodies
      // rather than two halves of one history — and the institution count, which
      // subtracts one per retired row, would be wrong.
      assert.ok(
        old.last <= now.first,
        `${b.eik} (${b.name}) filed until ${old.last}, after its successor ` +
          `${b.retiredEikOf} began on ${now.first} — these are not predecessor ` +
          `and successor, so MZ_SECOND_LEVEL_INSTITUTION_COUNT over-subtracts`,
      );
    }
  });
});
