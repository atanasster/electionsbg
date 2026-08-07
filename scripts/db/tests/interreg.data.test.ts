// Gates for the Interreg corpus (migration 137) — plan §9.
//
// THE ONE THING TO UNDERSTAND BEFORE EDITING: `mergeFromStage`'s parity guard
// compares ROW COUNTS. Every failure this file exists to catch is invisible to
// it, because every one of them keeps the row count identical:
//   - place columns overwritten with NULL by a degraded cascade (measured:
//     1,469 → 1,270 placed, guard green);
//   - an operation total attributed to one partner;
//   - a budget_basis that disagrees with its own amount;
//   - a money aggregate summing across the operation↔partner join.
//
// Auto-skips ONLY when Postgres is down. An EMPTY table is a failure, not a
// skip: the loader is unconditional in db:refresh and reads a committed input.

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { allRows, dbReachable, end, withClient } from "../lib/pg";
import {
  haversineKm,
  GEO_CONFIRM_KM,
  ROSTER_CONFIRM_KM,
} from "../../funds/interreg/resolve_place";
import type { InterregIndex } from "../../funds/interreg/types";
import { INTERREG_PROGRAMMES } from "../../funds/interreg/programmes";
import { BUDGET_BASES, PLACE_BASES } from "../../funds/interreg/types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * The committed corpus, so the floors are what the loader's own INPUT holds
 * rather than a constant somebody has to remember to raise. §9.1 asks for
 * ">5% shrink fails"; a hand-set floor 20% below the measurement does not.
 */
const corpusIndex: InterregIndex = JSON.parse(
  fs.readFileSync(
    path.resolve(__dirname, "../../../data/funds/interreg/index.json"),
    "utf8",
  ),
);
const floor = (n: number): number => Math.floor(n * 0.95);

const haveDb = await dbReachable();
const skip = !haveDb ? "Postgres unreachable" : false;

afterAll(async () => {
  await end();
});

/** The Bulgarian predicate, spelled once. Country OR department — see
 *  `isBulgarianPartner`; testing only `country` would drop the second kind. */
const BG = `(p.country = 'Bulgaria' OR p.country_department = 'Bulgaria')`;

const one = async <T>(sql: string, params?: unknown[]): Promise<T> => {
  const rows = await allRows<T>(sql, params);
  assert.ok(rows.length, `no rows from: ${sql.slice(0, 80)}`);
  return rows[0];
};

// ── 1. Non-empty, non-shrinking ─────────────────────────────────────────────
test.skipIf(skip)("the corpus is present and not truncated", async () => {
  const r = await one<{ p: string; o: string; n: string; bg: string }>(
    `SELECT (SELECT count(*) FROM interreg_programmes) p,
            (SELECT count(*) FROM interreg_operations) o,
            (SELECT count(*) FROM interreg_partners) n,
            (SELECT count(*) FROM interreg_partners p WHERE ${BG}) bg`,
  ).catch(() => {
    throw new Error(
      "interreg tables are absent — run `npm run db:load:interreg:pg`",
    );
  });
  assert.equal(Number(r.p), INTERREG_PROGRAMMES.length);
  // Against the committed tree at §9.1's 5%, not against a constant: a 15%
  // corpus loss passed every hand-set floor, and the stage-merge parity guard
  // compares live against STAGE, so a corpus that shrank at ingest is exactly
  // what it cannot see.
  assert.ok(
    Number(r.o) >= floor(corpusIndex.operationCount),
    `${r.o} operations vs ${corpusIndex.operationCount} on disk`,
  );
  assert.ok(
    Number(r.n) >= floor(corpusIndex.partnerCount),
    `${r.n} partnerships vs ${corpusIndex.partnerCount} on disk`,
  );
  assert.ok(
    Number(r.bg) >= floor(corpusIndex.bgPartnerCount),
    `${r.bg} Bulgarian rows vs ${corpusIndex.bgPartnerCount} on disk`,
  );
});

// ── 2. No partner row carries the operation total ───────────────────────────
test.skipIf(skip)(
  "no partner carries its operation's whole total beside a funded sibling",
  async () => {
    // THE inversion: BSB00963's operation total is €1,419,207.76 and Малко
    // Търново's share €357,183.12 — storing the former puts ~4x the true money
    // on a 2,628-person municipality.
    const bad = await allRows<{ keep_id: number; partner_seq: number }>(
      `SELECT p.keep_id, p.partner_seq
         FROM interreg_partners p
         JOIN interreg_operations o USING (keep_id)
        WHERE o.total_budget_eur > 0
          AND o.partner_count > 1
          AND p.budget_eur = o.total_budget_eur
          AND EXISTS (SELECT 1 FROM interreg_partners q
                       WHERE q.keep_id = p.keep_id
                         AND q.partner_seq <> p.partner_seq
                         AND q.budget_eur > 0)`,
    );
    assert.equal(
      bad.length,
      0,
      `operation total on a partner: ${JSON.stringify(bad.slice(0, 5))}`,
    );
  },
);

test.skipIf(skip)(
  "partner budgets sum to at most the operation total, or the row says so",
  async () => {
    // keep.eu does NOT guarantee these reconcile — 68 of 1,954 exceed by
    // 2%-66%. The stored sum must simply equal what the rows actually hold.
    const r = await one<{ n: string }>(
      `SELECT count(*) n FROM interreg_operations o
        WHERE o.partner_budget_sum_eur IS DISTINCT FROM
              (SELECT sum(q.budget_eur) FROM interreg_partners q
                WHERE q.keep_id = o.keep_id AND q.budget_eur IS NOT NULL)`,
    );
    assert.equal(
      Number(r.n),
      0,
      "partner_budget_sum_eur disagrees with its rows",
    );
  },
);

// ── 3. Budget basis is exhaustive, exclusive and agrees with the amount ─────
test.skipIf(skip)(
  "budget_basis agrees with budget_eur, all three ways",
  async () => {
    const r = await one<{ bad: string; kinds: string }>(
      `SELECT count(*) FILTER (WHERE NOT (
              (budget_basis = 'published'      AND budget_eur IS NOT NULL AND budget_eur <> 0)
           OR (budget_basis = 'published_zero' AND budget_eur = 0)
           OR (budget_basis = 'unpublished'    AND budget_eur IS NULL))) bad,
            count(DISTINCT budget_basis) kinds
       FROM interreg_partners`,
    );
    assert.equal(Number(r.bad), 0, "a budget_basis disagrees with its amount");
    // All three states present, so the gate is not vacuous.
    assert.equal(Number(r.kinds), BUDGET_BASES.length);
  },
);

// ── 4. No money aggregate crosses the operation↔partner join ───────────────
test.skipIf(skip)(
  "no shipped function sums an operation total by a place or beneficiary",
  async () => {
    // The `procurement_payloads.data.test.ts` idiom: read the bodies rather
    // than trusting review. Summing total_budget_eur grouped by ekatte/obshtina/
    // eik is always wrong — that is the €2m-on-a-€300k-partner inversion,
    // arrived at in SQL instead of in the parser.
    const fns = await allRows<{ name: string; body: string }>(
      `SELECT p.proname AS name, pg_get_functiondef(p.oid) AS body
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          -- prokind 'f' only: pg_get_functiondef ERRORS on an aggregate
          -- ("array_agg" is an aggregate function), which would make this gate
          -- fail for a reason that has nothing to do with what it checks.
          AND p.prokind = 'f'
          AND pg_get_functiondef(p.oid) ILIKE '%interreg_%'`,
    );
    // DECLARE VACUITY. The serving functions land at T3.1; until then this
    // gate has nothing to read, and a gate that passes because it found
    // nothing must not read as "checked and clean".
    if (!fns.length) {
      console.warn(
        "  interreg gate 4: no interreg_* function exists yet (T3.1) — " +
          "this gate is vacuous until interreg_by_place/by_eik ship",
      );
      return;
    }
    for (const f of fns) {
      const body = f.body.replace(/\s+/g, " ").toLowerCase();
      const sumsTotal = /sum\s*\(\s*[a-z_]*\.?total_budget_eur/.test(body);
      const groupsByPlace = /(ekatte|obshtina|oblast|\beik\b)/.test(body);
      assert.ok(
        !(sumsTotal && groupsByPlace),
        `${f.name} sums interreg_operations.total_budget_eur alongside a ` +
          `place/beneficiary column — money must never cross that join`,
      );
    }
  },
);

// ── 5. EKATTE is never invented ─────────────────────────────────────────────
test.skipIf(skip)(
  "every stored place is real and completely stated",
  async () => {
    // 68134 (София) is the ONE legitimate orphan: settlements.json models the
    // capital as its 24 district shards. Asserted as an exact exemption set so a
    // NEW orphan still fails — ekatte_index.json carries 15 others.
    // place_dim (117) is the canonical settlement dimension — it carries the
    // two settlements the EKATTE master omits (68134 София, 63183 Рудник), so
    // there is no exemption list to maintain and a NEW orphan simply fails.
    const orphans = await allRows<{ ekatte: string; n: string }>(
      `SELECT p.ekatte, count(*) n FROM interreg_partners p
        WHERE p.ekatte IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM place_dim d
                           WHERE d.kind = 'settlement' AND d.code = p.ekatte)
        GROUP BY 1 ORDER BY 1`,
    );
    assert.deepEqual(
      orphans,
      [],
      `EKATTE unknown to place_dim: ${JSON.stringify(orphans)}`,
    );

    // "as CODES", not merely non-NULL. 17 rows once carried oblast 'PDV-00' —
    // the shard code settlements.json spells for гр. Пловдив, which place_dim
    // normalises to PDV and which place_dim itself cannot resolve.
    const unresolved = await allRows<{ kind: string; code: string; n: string }>(
      `SELECT 'oblast' kind, p.oblast code, count(*) n FROM interreg_partners p
        WHERE p.oblast IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM place_dim d WHERE d.kind='oblast' AND d.code=p.oblast)
        GROUP BY 2
       UNION ALL
       SELECT 'obshtina', p.obshtina, count(*) FROM interreg_partners p
        WHERE p.obshtina IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM place_dim d WHERE d.kind='obshtina' AND d.code=p.obshtina)
        GROUP BY 2`,
    );
    assert.deepEqual(
      unresolved,
      [],
      `a placed row carries a code place_dim cannot resolve: ${JSON.stringify(unresolved)}`,
    );

    const r = await one<{
      basis_mismatch: string;
      incomplete: string;
      bad_basis: string;
    }>(
      `SELECT count(*) FILTER (WHERE (ekatte IS NULL) <> (place_basis IS NULL)) basis_mismatch,
            count(*) FILTER (WHERE ekatte IS NOT NULL
                               AND (obshtina IS NULL OR oblast IS NULL)) incomplete,
            count(*) FILTER (WHERE place_basis IS NOT NULL
                               AND place_basis <> ALL($1::text[])) bad_basis
       FROM interreg_partners`,
      [PLACE_BASES],
    );
    assert.equal(
      Number(r.basis_mismatch),
      0,
      "place_basis must be set iff ekatte is",
    );

    // §9.5's geo clause — the ONLY assertion in this file that says a placement
    // is CORRECT rather than merely stated. resolve_place enforces it at
    // resolution time, but 137's own comment is explicit that the stage-merge
    // writes these columns unconditionally, so a relaxed constant or a stage
    // built without re-confirmation both land silently.
    const placed = await allRows<{
      ekatte: string;
      place_basis: string;
      lat: number;
      lng: number;
      loc: string | null;
    }>(
      `SELECT p.ekatte, p.place_basis, p.lat, p.lng, d.loc
         FROM interreg_partners p
         LEFT JOIN place_dim d ON d.kind = 'settlement' AND d.code = p.ekatte
        WHERE p.ekatte IS NOT NULL AND p.lat IS NOT NULL AND d.loc IS NOT NULL`,
    );
    assert.ok(
      placed.length > 1_000,
      `only ${placed.length} placed rows carry a point`,
    );
    const far = placed.filter((row) => {
      // place_dim publishes `loc` as "lng,lat" — note the order.
      const [lng, lat] = row.loc!.split(",").map(Number);
      // The roster arm gets the wider ceiling: a municipality's territory
      // legitimately extends well beyond its seat.
      const max =
        row.place_basis === "roster" ? ROSTER_CONFIRM_KM : GEO_CONFIRM_KM;
      return haversineKm(row.lat, row.lng, lat, lng) > max;
    });
    assert.deepEqual(
      far.map((f) => `${f.ekatte}/${f.place_basis}`),
      [],
      "a placement contradicts its own published point",
    );
    // The forward direction. 22 rows once carried an ekatte with no municipality,
    // invisible to §6's ranking and passing 137's IFF CHECK.
    assert.equal(
      Number(r.incomplete),
      0,
      "a placed row lacks its obshtina/oblast",
    );
    assert.equal(
      Number(r.bad_basis),
      0,
      "an unknown place_basis value is stored",
    );
  },
);

// ── 6. Placement floor, split by period ────────────────────────────────────
test.skipIf(skip)("placement clears its floor in BOTH periods", async () => {
  const rows = await allRows<{
    period: string;
    rows: string;
    placed: string;
    money_all: string | null;
    money_placed: string | null;
  }>(
    `SELECT o.period,
            count(*) rows,
            count(p.ekatte) placed,
            sum(p.budget_eur) money_all,
            sum(p.budget_eur) FILTER (WHERE p.ekatte IS NOT NULL) money_placed
       FROM interreg_partners p JOIN interreg_operations o USING (keep_id)
      WHERE ${BG} GROUP BY 1`,
  );
  assert.equal(rows.length, 2, "both periods must be present");
  for (const r of rows) {
    // Split by period so a regression in the harder tier — 2014-2020 has NO
    // identity column at all — cannot hide behind the easier one.
    const byRows = Number(r.placed) / Number(r.rows);
    const byMoney = Number(r.money_placed ?? 0) / Number(r.money_all ?? 1);
    assert.ok(
      byRows >= 0.9,
      `${r.period}: ${(100 * byRows).toFixed(1)}% of rows placed`,
    );
    assert.ok(
      byMoney >= 0.9,
      `${r.period}: ${(100 * byMoney).toFixed(1)}% of money placed`,
    );
  }
});

// ── 7. EIK hygiene, and the period asymmetry itself ────────────────────────
test.skipIf(skip)(
  "EIK coverage matches the template's own limits",
  async () => {
    const rows = await allRows<{ period: string; n: string; with_eik: string }>(
      `SELECT o.period, count(*) n, count(p.eik) with_eik
       FROM interreg_partners p JOIN interreg_operations o USING (keep_id)
      WHERE ${BG} GROUP BY 1`,
    );
    // Without this the destructure below throws a TypeError on an empty corpus —
    // a failure, but for a reason that says nothing about EIK coverage.
    assert.deepEqual(
      rows.map((r) => r.period).sort(),
      ["2014-2020", "2021-2027"],
      "both periods must be present",
    );
    const by = Object.fromEntries(rows.map((r) => [r.period, r]));

    // 2014-2020's template has no identity column. Asserted at EXACTLY zero, so a
    // future keep.eu change that starts supplying them is noticed rather than
    // silently absorbed into Tier L.
    assert.equal(
      Number(by["2014-2020"].with_eik),
      0,
      "2014-2020 must carry no EIK",
    );

    // ≥80%, measured 81.4% (336/413). The 87% an earlier draft used counted the
    // RAW beneficiary_id field — 413 minus the 54 literal "N.a." rows — not the
    // parsed column, so a gate set there goes red for the wrong reason.
    const share = Number(by["2021-2027"].with_eik) / Number(by["2021-2027"].n);
    assert.ok(
      share >= 0.8,
      `2021-2027 EIK coverage ${(100 * share).toFixed(1)}%`,
    );

    const bad = await one<{ n: string }>(
      `SELECT count(*) n FROM interreg_partners WHERE eik IS NOT NULL AND eik !~ '^[0-9]{9}$'`,
    );
    // The ЕГН guard: a 10-digit value could be a legacy BULSTAT or a personal id.
    assert.equal(Number(bad.n), 0, "a non-9-digit EIK is stored");
  },
);

// ── 8. Namespace disjointness ──────────────────────────────────────────────
test.skipIf(skip)("Interreg and ИСУН identifiers never collide", async () => {
  // Different monitoring systems (Jems vs ИСУН 2020), so this should hold by
  // construction — which is exactly why it is worth asserting.
  const r = await one<{ n: string }>(
    `SELECT count(*) n FROM interreg_operations o
       JOIN fund_projects f ON f.contract_number = o.operation_id`,
  );
  assert.equal(
    Number(r.n),
    0,
    "an operation_id collides with a fund_projects contract",
  );
});

// ── 9. No cross-corpus double count (partial by construction) ──────────────
test.skipIf(skip)(
  "no operation is also an ИСУН project for the same EIK",
  async () => {
    const dupes = await allRows<{ eik: string; title: string }>(
      `SELECT p.eik, o.title_en AS title
       FROM interreg_partners p
       JOIN interreg_operations o USING (keep_id)
       JOIN fund_projects f ON f.beneficiary_eik = p.eik
      WHERE p.eik IS NOT NULL
        AND o.start_date IS NOT NULL
        AND f.total_eur IS NOT NULL AND p.budget_eur IS NOT NULL
        AND abs(f.total_eur - p.budget_eur) <= p.budget_eur * 0.01
        AND lower(regexp_replace(f.title, '[^[:alnum:]]', '', 'g'))
          = lower(regexp_replace(o.title_en, '[^[:alnum:]]', '', 'g'))`,
    );
    assert.equal(
      dupes.length,
      0,
      `cross-corpus duplicate: ${JSON.stringify(dupes.slice(0, 3))}`,
    );

    // THE GATE REPORTS ITS OWN PARTIALITY. It can only cover Tier L, because a
    // 2014-2020 row has no EIK to join on — and that is two thirds of the money.
    const cover = await one<{ total: string; with_eik: string }>(
      `SELECT count(*) total, count(p.eik) with_eik
       FROM interreg_partners p WHERE ${BG}`,
    );
    const uncovered = Number(cover.total) - Number(cover.with_eik);
    assert.ok(
      uncovered > 0,
      "expected Tier P rows this gate cannot cover — if zero, the period " +
        "asymmetry has changed and gate 7 should have caught it first",
    );
  },
);

// ── 10. Period fence ───────────────────────────────────────────────────────
test.skipIf(skip)("nothing outside the two ingested periods", async () => {
  const rows = await allRows<{ period: string }>(
    `SELECT DISTINCT period FROM interreg_operations ORDER BY 1`,
  );
  assert.deepEqual(
    rows.map((r) => r.period),
    ["2014-2020", "2021-2027"],
  );
});

// ── 11. Programme admission ────────────────────────────────────────────────
test.skipIf(skip)("every programme is in the curated register", async () => {
  // The FK makes this structural, so this asserts the OTHER direction: the
  // register's own rows are all present, including the two that yield zero
  // operations. A missing row and a zero row mean opposite things.
  const rows = await allRows<{ code: string }>(
    `SELECT code FROM interreg_programmes ORDER BY 1`,
  );
  assert.deepEqual(
    rows.map((r) => r.code).sort(),
    INTERREG_PROGRAMMES.map((p) => p.code).sort(),
  );
  const empty = await allRows<{ code: string }>(
    `SELECT g.code FROM interreg_programmes g
      WHERE NOT EXISTS (SELECT 1 FROM interreg_operations o WHERE o.programme_code = g.code)
      ORDER BY 1`,
  );
  assert.deepEqual(
    empty.map((r) => r.code),
    ["INTERREG-BGRS-2127", "INTERREG-ESPON-2127"],
    "the set of programmes keep.eu holds nothing for has changed",
  );
});

// ── 12. The place lookup rides its index ───────────────────────────────────
test.skipIf(skip)("the Bulgarian place lookup is an index scan", async () => {
  // The canonical predicate is an OR over two columns, and an OR does not imply
  // either arm — so a partial index carrying `country = 'Bulgaria'` would be
  // unusable by the very query that must use it. Measured at T2.1: it planned a
  // Seq Scan. This is what keeps that from coming back.
  const plan = await allRows<{ "QUERY PLAN": string }>(
    `EXPLAIN SELECT count(*), sum(p.budget_eur) FROM interreg_partners p
      WHERE p.ekatte = '68134' AND ${BG}`,
  );
  const text = plan.map((r) => r["QUERY PLAN"]).join("\n");
  assert.ok(
    /Index Scan|Bitmap Index Scan/.test(text),
    `place lookup does not use an index:\n${text}`,
  );
});

// ── 13. fund_payloads is untouched ─────────────────────────────────────────
test.skipIf(skip)("nothing was written into fund_payloads", async () => {
  // A shortcut into that table would be SILENTLY DELETED by the next
  // db:load:funds:pg — its stage merge runs an unscoped anti-join DELETE — and
  // that loader's parity guard would still pass.
  const r = await one<{ n: string }>(
    `SELECT count(*) n FROM fund_payloads WHERE kind ILIKE 'interreg%'`,
  );
  assert.equal(
    Number(r.n),
    0,
    "an interreg-* payload kind exists and will be deleted",
  );
});

// ── 14. Placed inside the programme's own eligible area ────────────────────
test.skipIf(skip)(
  "placements stay mostly inside their programme's area",
  async () => {
    // BOUNDED, not zero. A partner may legitimately sit outside — the measured
    // 8.5% is dominated by Sofia-based national bodies (БЧК, ГДПБЗН-МВР, БАН)
    // leading border projects, which is real. Zero would be the wrong assertion;
    // unbounded would make the gate decoration.
    // NUTS3 comes from place_dim (117), which now carries it — the reason the
    // first draft of this gate had to read settlements.json off disk.
    const rows = await allRows<{
      ekatte: string;
      nuts3: string | null;
      partner_name: string;
      code: string;
      eligible_nuts: string[];
    }>(
      `SELECT p.ekatte, d.nuts3, p.partner_name, g.code, g.eligible_nuts
         FROM interreg_partners p
         JOIN interreg_operations o USING (keep_id)
         JOIN interreg_programmes g ON g.code = o.programme_code
         LEFT JOIN place_dim d ON d.kind = 'settlement' AND d.code = p.ekatte
        WHERE ${BG} AND p.ekatte IS NOT NULL AND g.eligible_nuts IS NOT NULL`,
    );
    // PREFIX, not equality: the Black Sea programmes declare NUTS2 (BG34) while
    // the land borders declare NUTS3, and a settlement carries NUTS3.
    let checked = 0;
    const outside: string[] = [];
    for (const row of rows) {
      if (!row.nuts3) continue;
      checked++;
      if (!row.eligible_nuts.some((a) => row.nuts3!.startsWith(a)))
        outside.push(`${row.partner_name} (${row.code}, ${row.nuts3})`);
    }
    assert.ok(
      checked > 500,
      `only ${checked} rows checked — the join is broken`,
    );
    const share = outside.length / checked;
    // §9.14 asks for the bound PLUS the list, so a failure names the rows.
    assert.ok(
      share < 0.2,
      `${(100 * share).toFixed(1)}% placed outside their area:\n  ` +
        outside.slice(0, 10).join("\n  "),
    );
  },
);

// ── 15. The serving functions answer for BULGARIA only ─────────────────────
test.skipIf(skip)(
  "interreg_by_eik does not serve a foreign national id",
  async () => {
    // `eik` holds whatever national id keep.eu published, for EVERY country — the
    // column is a namespace, not an identity. 321 distinct foreign values are
    // exactly 9 digits, which is the route's only gate, and two collide with a
    // live tr_companies.uic: 204426451 (a Georgian arts centre) and 204911337.
    // Without the country predicate, /company/204426451 publishes a Georgian
    // body's Interreg budget under a Bulgarian company's name — which is
    // `feedback_name_match_not_identity` arrived at through a shared id namespace
    // instead of a shared name.
    const rows = await allRows<{ eik: string; n: string }>(
      `SELECT p.eik, count(*) n FROM interreg_partners p
      WHERE p.eik IS NOT NULL AND NOT (${BG}) AND p.eik ~ '^[0-9]{9}$'
      GROUP BY 1 ORDER BY 2 DESC LIMIT 5`,
    );
    if (rows.length === 0) return; // no foreign 9-digit id in the corpus today
    for (const r of rows) {
      const got = await one<{ r: { partnerCount: number; budgetEur: number } }>(
        `SELECT interreg_by_eik($1) AS r`,
        [r.eik],
      );
      assert.equal(
        got.r.partnerCount,
        0,
        `interreg_by_eik('${r.eik}') serves ${got.r.partnerCount} foreign row(s) ` +
          `(€${got.r.budgetEur}) — a non-Bulgarian national id in the EIK namespace`,
      );
    }
  },
);

// ── 16. The operation list is ordered, and the LIMIT keeps the right rows ───
test.skipIf(skip)(
  "the operation list is the true top-N, in order",
  async () => {
    // Two independent things, and the first draft got the first one wrong in a way
    // no output could show: the jsonb_agg ORDER BY named `budgetEur`, a key the
    // object does not carry (it is `localBudgetEur`), so both sort expressions
    // were constant NULL and the ordering was inert. Output stayed descending only
    // because tuplesort short-circuits on already-sorted input — an accident, not
    // a guarantee.
    const LIMIT = 100;
    const got = await one<{
      r: { operations: { keepId: number; localBudgetEur: number | null }[] };
    }>(`SELECT interreg_by_place('68134', NULL, ${LIMIT}) AS r`);
    const ops = got.r.operations;
    assert.ok(ops.length > 1, "Sofia should return many operations");

    for (const o of ops)
      assert.ok(
        "localBudgetEur" in o,
        `an operation lacks localBudgetEur: ${JSON.stringify(o)}`,
      );

    let prev = Number.POSITIVE_INFINITY;
    let seenNull = false;
    for (const o of ops) {
      if (o.localBudgetEur === null) {
        seenNull = true;
        continue;
      }
      assert.ok(!seenNull, "a published budget follows an unpublished one");
      assert.ok(
        o.localBudgetEur <= prev,
        `not descending: ${o.localBudgetEur} follows ${prev}`,
      );
      prev = o.localBudgetEur;
    }

    // And the LIMIT kept the right N — derived independently of the function.
    const want = await allRows<{ keep_id: number }>(
      `SELECT p.keep_id FROM interreg_partners p
      WHERE p.ekatte = '68134' AND ${BG}
      GROUP BY p.keep_id
      ORDER BY SUM(p.budget_eur) DESC NULLS LAST, p.keep_id
      LIMIT ${LIMIT}`,
    );
    assert.deepEqual(
      new Set(ops.map((o) => o.keepId)),
      new Set(want.map((r) => r.keep_id)),
      "the returned set is not the true top-N",
    );
  },
);

// ── 17. localBudgetBasis tells the truth about a mixed group ───────────────
test.skipIf(skip)(
  "a place+operation group mixing bases reports 'partial'",
  async () => {
    // SYNTHETIC, and that is the point: no group in today's corpus mixes published
    // with unpublished at this grain, so the branch that matters most is the one
    // real data cannot exercise. It is reachable — budget_basis is not a
    // programme-level property; INTERREG-BSB-1420 carries both across its 46
    // Bulgarian rows — and reporting 'published' for such a group would assert a
    // figure is complete when a sibling partner's budget is simply unknown.
    //
    // Rolled back, so it never touches the corpus.
    await withClient(async (c) => {
      const q = async <T>(sql: string, params?: unknown[]): Promise<T[]> =>
        (await c.query(sql, params as never)).rows as T[];
      await c.query("BEGIN");
      try {
        await run(q);
      } finally {
        await c.query("ROLLBACK");
      }
    });

    async function run(
      q: <T>(sql: string, params?: unknown[]) => Promise<T[]>,
    ): Promise<void> {
      const seed = await q<{
        keep_id: number;
        ekatte: string;
        max_seq: number;
      }>(
        `SELECT keep_id, ekatte, max(partner_seq) max_seq
         FROM interreg_partners
        WHERE ekatte IS NOT NULL AND budget_basis = 'published'
          AND (country = 'Bulgaria' OR country_department = 'Bulgaria')
        GROUP BY 1, 2 ORDER BY keep_id LIMIT 1`,
      );
      assert.ok(seed.length === 1, "no published+placed row to seed from");
      const { keep_id, ekatte, max_seq } = seed[0];

      const basisOf = async (): Promise<string> => {
        const r = await q<{ b: string }>(
          `SELECT (o->>'localBudgetBasis') b
           FROM jsonb_array_elements(interreg_by_place($1, NULL, 500)->'operations') o
          WHERE (o->>'keepId')::int = $2`,
          [ekatte, keep_id],
        );
        return r[0]?.b ?? "(absent)";
      };
      assert.equal(await basisOf(), "published");

      // Add an unpublished sibling in the same place, on the same operation.
      await q(
        `INSERT INTO interreg_partners
         (keep_id, partner_seq, is_lead, country, partner_name,
          budget_eur, budget_basis, ekatte, place_basis)
       VALUES ($1, $2, false, 'Bulgaria', 'TEST unpublished sibling',
               NULL, 'unpublished', $3, 'roster')`,
        [keep_id, Number(max_seq) + 1000, ekatte],
      );
      assert.equal(
        await basisOf(),
        "partial",
        "a group with known AND unknown money must not claim 'published'",
      );

      // An all-unpublished group must be NULL money, never €0 — €0 is a published
      // fact (published_zero) and this is an absence.
      await q(
        `UPDATE interreg_partners SET budget_basis = 'unpublished', budget_eur = NULL
        WHERE keep_id = $1 AND ekatte = $2`,
        [keep_id, ekatte],
      );
      const r = await q<{ basis: string; eur: number | null }>(
        `SELECT (o->>'localBudgetBasis') basis, (o->>'localBudgetEur')::float eur
         FROM jsonb_array_elements(interreg_by_place($1, NULL, 500)->'operations') o
        WHERE (o->>'keepId')::int = $2`,
        [ekatte, keep_id],
      );
      assert.equal(r[0].basis, "unpublished");
      assert.equal(r[0].eur, null, "an unpublished group must be NULL, not 0");
    }
  },
);

// ── 18. The operation list drops nothing the aggregate counted ─────────────
test.skipIf(skip)(
  "when everything fits, the list sums to the headline",
  async () => {
    // The functions' four inner JOINs (operations, programmes) can silently drop
    // an operation whose programme_code was evicted, while the headline aggregate
    // — which reads `rows` alone — still counts it. One assertion catches that, a
    // dropped join, and any future rewrite that starts crossing the grain.
    const places = await allRows<{ obshtina: string }>(
      `SELECT obshtina FROM interreg_partners p
      WHERE obshtina IS NOT NULL AND ${BG}
      GROUP BY 1 HAVING count(DISTINCT keep_id) BETWEEN 2 AND 40
      ORDER BY 1 LIMIT 25`,
    );
    assert.ok(places.length > 0, "no municipality to check");
    for (const { obshtina } of places) {
      const got = await one<{
        r: {
          budgetEur: number;
          operationCount: number;
          operations: { localBudgetEur: number | null }[];
        };
      }>(`SELECT interreg_by_place(NULL, $1, 100) AS r`, [obshtina]);
      const { budgetEur, operationCount, operations } = got.r;
      assert.equal(
        operations.length,
        operationCount,
        `${obshtina}: ${operationCount} counted, ${operations.length} listed`,
      );
      const summed = operations.reduce(
        (a, o) => a + (o.localBudgetEur ?? 0),
        0,
      );
      assert.ok(
        Math.abs(summed - budgetEur) < 0.01,
        `${obshtina}: list sums to €${summed}, headline says €${budgetEur}`,
      );
    }
  },
);

// ── 19. Every obshtina code the corpus uses passes the route's gate ────────
test.skipIf(skip)(
  "the route regex admits every placed obshtina code",
  async () => {
    // The generalisable form of functions/db_routes.interreg.test.js. That file
    // pins today's four shapes without a database; this one fails when a NEW code
    // shape lands in the corpus and the route would 400 it — which is exactly how
    // SFO_CITY (272 of 1,469 placed rows, the largest place in the corpus) was
    // 400ing while every other municipality answered fine.
    const ROUTE_RE = /^([A-Z]{3}\d{2}|S\d{4}|SFO_CITY)$/;
    const codes = await allRows<{ obshtina: string; n: string }>(
      `SELECT p.obshtina, count(*) n FROM interreg_partners p
      WHERE p.obshtina IS NOT NULL AND ${BG} GROUP BY 1`,
    );
    assert.ok(codes.length > 0, "no placed obshtina codes");
    const rejected = codes.filter((c) => !ROUTE_RE.test(c.obshtina));
    assert.deepEqual(
      rejected,
      [],
      `the route would 400 these placed codes: ${rejected
        .map((c) => `${c.obshtina} (${c.n} rows)`)
        .join(", ")}`,
    );
  },
);

// ── The stage-merge semantics the parity guard cannot see ──────────────────
test.skipIf(skip)("the loader left no stage table behind", async () => {
  const rows = await allRows<{ relname: string }>(
    `SELECT relname FROM pg_class WHERE relname LIKE 'interreg%stage'`,
  );
  assert.deepEqual(
    rows.map((r) => r.relname),
    [],
    "an interreg stage table survived",
  );
});

test.skipIf(skip)(
  "the changelog recorded the corpus under its own source",
  async () => {
    const r = await one<{ rows_total: number | string }>(
      `SELECT rows_total FROM ingest_batches
      WHERE source = 'interreg_partner' ORDER BY id DESC LIMIT 1`,
    );
    const live = await one<{ n: string }>(
      `SELECT count(*) n FROM interreg_partners`,
    );
    // rows_total is int4 (a JS number through node-postgres) and count(*) is
    // int8 (a string), so compare the values rather than the representations.
    assert.equal(
      Number(r.rows_total),
      Number(live.n),
      "the last batch's rows_total is stale",
    );
  },
);
