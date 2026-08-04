// Tier 3 (Postgres-native) — the cross-source duplication gate for the contracts corpus.
//
// FOUR feeds, distinguished by `release_id` prefix: `ocds-` (АОП OCDS export), `aop-legacy-`
// (АОП annual CSV), `eop-` (ЦАИС ЕОП flat договори), `rop-` (РОП). Each splits a contract's
// value across its OWN view of the supplier set, so rows from two feeds can never be summed —
// the corpus over-states whenever one contract appears in both.
//
// ── WHAT CHANGED, AND WHY BOTH HALVES HAD TO MOVE TOGETHER ─────────────────────────────────
//
// This file used to classify rows as `eop-` vs `NOT LIKE 'eop-%'` and group them on
// (УНП, contract_id, tag). Both halves were wrong, and fixing either alone makes things worse:
//
//   - The TWO-FEED model cannot express `aop`↔`rop` or `aop`↔`ocds` at all, since neither side
//     is `eop-`. Measured before the fix: the gate saw 5 of 129 groups on its own key.
//   - The KEY is the reason it saw so few. `contract_id` differs across feeds on ~99% of real
//     twins (0/46 on aop↔eop, 0/26 on eop↔ocds, 0/6 on aop↔ocds), because the feeds use
//     different numbering systems — `aop:32038` vs `eop:СОА21-ДГ55-32` is one contract.
//
// Widening the FEED model while keeping the old key would have turned this gate permanently red
// with ~124 `aop`+`rop` groups that are NOT duplicates: aop and rop are the one pair that shares
// contract numbering, and a buyer reusing a number across many framework call-offs looks
// identical to a duplicate under that key. Only 4 of the 124 share both a total and a signing
// date. See docs/plans/procurement-cross-source-dedup-v2.md §2.2.
//
// So the gating test below keys on IDENTITY E — (УНП, contractor, rounded €, signing date, tag)
// — the same identity `scripts/procurement/cross_source.ts` reconciles on, and identity A is
// kept as a separate BOUNDED test that reports rather than demands zero.
//
//   npm run test:data
//
// Requires the Postgres store; auto-skips when Postgres is unreachable or the contracts table is
// absent, like invariants_pg.data.test.ts.

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, end } from "../lib/pg";

const reachable = async (): Promise<boolean> => {
  try {
    await allRows("SELECT 1");
    const [t] = await allRows<{ ok: boolean }>(
      "SELECT to_regclass('public.contracts') IS NOT NULL AS ok",
    );
    return !!t?.ok;
  } catch {
    return false;
  }
};

const haveDb = await reachable();
const skip = haveDb ? false : "Postgres unreachable / contracts table absent";

afterAll(async () => {
  await end();
});

// The four-way feed classification, matching `feedOf()` in scripts/procurement/content_key.ts.
// `aop` is the fallback rather than a prefix test, for the same reason it is there: the legacy
// CSV is the only generator that has changed its prefix shape, and an unrecognised row belongs
// with the legacy pile rather than in a silent fifth bucket.
const FEED_SQL = `CASE WHEN release_id LIKE 'ocds-%' THEN 'ocds'
                       WHEN release_id LIKE 'eop-%'  THEN 'eop'
                       WHEN release_id LIKE 'rop-%'  THEN 'rop'
                       ELSE 'aop' END`;

interface MixedRow {
  unp: string;
  contractor_eik: string;
  amt: string;
  ds: string;
  feeds: string;
  rows: number;
  contract_ids: string;
  eur: number;
}

// TRIAGED, PERMANENTLY UNRESOLVABLE GROUPS — `${unp}/${contractor_eik}`.
//
// An entry means a human looked at both feeds and found no 1:1 correspondence a script may act
// on. It is NOT a suppression for "not got round to it": anything the reconciliation pass CAN
// resolve is resolved there, and this list is asserted to be exhaustive AND minimal below, so a
// stale entry fails as loudly as a new mix.
//
// The 12 fall into exactly the two shapes the pass refuses (plan §5.3b / §5.4):
//   AMBIGUOUS — a feed contributed more than one row to the identity-E group, so the two sides
//     cannot be paired 1:1. Acting anyway would collapse N rows onto M survivors and guess.
//   BLOCKED — the sides pair, but a §5.2 precondition fails: the supplier sets differ, or some
//     row on one side has no twin. Evicting a side on a partial match is what orphaned rows in
//     earlier attempts.
const ACCEPTED_CONFLICTS = new Map<string, string>([
  [
    "01071-2020-0009/177441542",
    // AMBIGUOUS, and the clearest example of why the rule exists: ЦАИС published four call-offs
    // ("Договор № 878/879/880/881") at the same procedure, supplier, amount and date, against
    // two aop rows. Nothing in the data says which corresponds to which, and 4 against 2 means
    // two of them correspond to nothing at all.
    "eop×4 (Договор № 878..881) vs aop×2 — no 1:1 correspondence exists",
  ],
  [
    "05568-2021-0001/107544354",
    "eop×2 vs aop×1 — the eop side carries two rows with one identity E",
  ],
  [
    "00589-2022-0052/103318710",
    "eop×2 vs aop×1 — the eop side carries two rows with one identity E",
  ],
  [
    "02378-2023-0001/203540174",
    "eop×2 vs aop×1 — the eop side carries two rows with one identity E",
  ],
  [
    "00339-2025-0039/128591001",
    "eop×2 vs ocds×1 — the eop side carries two rows with one identity E",
  ],
  [
    "00053-2026-0001/204293638",
    // Both rows sit at €0.00 in Postgres: 087 moved the joint award's value onto the carrier and
    // zeroed the members. €0 is a real amount for identity E (a member row), not a missing one.
    "eop×2 vs ocds×1, both consortium members zeroed by 087 — no 1:1 correspondence",
  ],
  [
    "00053-2026-0001/181527965",
    "eop×2 vs ocds×1, both consortium members zeroed by 087 — no 1:1 correspondence",
  ],
  [
    "02023-2023-0001/113580690",
    // BLOCKED. aop:118779 holds one row; eop:118827 holds two, and the supplier sets differ.
    // This is the pair the parse-time `f:` net once orphaned (see content_key.ts) — €4.14m that
    // simply vanished when a bogus survivor was accepted.
    "supplier sets differ: aop:118779 (1 row) vs eop:118827 (2 rows)",
  ],
  [
    "00303-2020-0018/837068124",
    // BLOCKED, and the most instructive of the five: identical supplier sets, totals agreeing to
    // €1.19 — and still refused, because only one of aop:317's two rows has a twin. Evicting a
    // side on a partial match is exactly the shape that destroyed rows before.
    "same supplier set and totals to €1.19, but only 1 of aop:317's 2 rows is matched",
  ],
  [
    "00994-2016-0001/102227154",
    "aop:2 (2 rows) vs rop:2 (1 row) — aop holds two call-offs under one number",
  ],
  [
    "00994-2016-0001/121578346",
    "supplier sets differ: aop:3 (2 suppliers) vs rop:3 (1)",
  ],
  [
    "00640-2015-0014/121814067",
    "supplier sets differ: aop:80-09-73 (2 suppliers) vs rop:80-09-73 (1)",
  ],
]);

const idOf = (r: MixedRow): string => `${r.unp}/${r.contractor_eik}`;

// IDENTITY E — the gating key. Synthetic `obed-` consortium carriers are excluded: 087 mints
// them inside Postgres from whichever feed's rows are present, so they inherit a mix rather than
// cause one. Rows missing any component of the identity are excluded too, because a row with no
// amount or no signing date must never be grouped with one that has them — Postgres GROUP BY
// treats NULLs as equal, which silently counts two unknowns as a match.
const MIXED_SQL = `
  WITH b AS (
    SELECT ${FEED_SQL} AS feed, unp, contract_id, tag, contractor_eik, amount_eur,
           round(amount_eur::numeric, 0) AS amt,
           substring(date_signed FROM 1 FOR 10) AS ds
      FROM contracts
     WHERE contractor_eik NOT LIKE 'obed-%'
       AND COALESCE(unp, '') <> '' AND COALESCE(contractor_eik, '') <> ''
       AND amount_eur IS NOT NULL AND COALESCE(date_signed, '') <> ''
  )
  SELECT unp, contractor_eik, amt::text AS amt, ds,
         array_to_string(array_agg(DISTINCT feed ORDER BY feed), '+') AS feeds,
         count(*)::int AS rows,
         array_to_string(array_agg(DISTINCT contract_id), ' | ') AS contract_ids,
         COALESCE(sum(amount_eur), 0)::float8 AS eur
    FROM b
   GROUP BY unp, contractor_eik, amt, ds, tag
  HAVING count(DISTINCT feed) > 1
   ORDER BY amt DESC`;

test.skipIf(skip)(
  "no contract is carried by two feeds at once (identity E)",
  async () => {
    const all = await allRows<MixedRow>(MIXED_SQL);
    const rows = all.filter((r) => !ACCEPTED_CONFLICTS.has(idOf(r)));
    const total = rows.reduce((s, r) => s + Number(r.eur ?? 0), 0);
    assert.equal(
      rows.length,
      0,
      `${rows.length} identity-E group(s) span more than one feed, over-stating by ` +
        `€${total.toLocaleString("en-US", { maximumFractionDigits: 2 })}. Each feed splits the ` +
        `contract value across its own supplier set, so the two can never be summed.\n` +
        rows
          .slice(0, 8)
          .map(
            (r) =>
              `  ${r.unp} eik=${r.contractor_eik} €${r.amt} signed=${r.ds} ` +
              `[${r.feeds}] ${r.rows} rows — contract ids: ${r.contract_ids}`,
          )
          .join("\n") +
        `\n  Resolve with \`npm run proc:reconcile\` (dry run first). If the pass refuses them, ` +
        `it prints why — a genuinely unpairable group belongs in ACCEPTED_CONFLICTS with its ` +
        `reason, never deleted by hand. See docs/plans/procurement-cross-source-dedup-v2.md §5.`,
    );
  },
);

test.skipIf(skip)("every accepted conflict still exists", async () => {
  // Keeps the allowlist minimal. Once a conflict is resolved upstream, its entry must go, or it
  // silently licenses a future regression on that contract.
  //
  // This ties the list to the CURRENT corpus, so it also fires on a database whose corpus
  // predates the entries. That is the intended trade — an exhaustive list beats a permissive one
  // — but it makes the failure easy to misread, so the message says so.
  const live = new Set((await allRows<MixedRow>(MIXED_SQL)).map(idOf));
  const stale = [...ACCEPTED_CONFLICTS.keys()].filter((k) => !live.has(k));
  assert.deepEqual(
    stale,
    [],
    `ACCEPTED_CONFLICTS lists ${stale.length} group(s) that do not span two feeds in THIS ` +
      `database: ${stale.join(", ")}.\n` +
      `  If this database is behind (its corpus predates the entry), load the current corpus — ` +
      `do not edit the list.\n` +
      `  If it is current, the conflict is resolved: remove the entry, because a stale one ` +
      `licenses a future regression on that group.`,
  );
});

// ── Identity A — kept, bounded, NOT gated on zero ────────────────────────────────────────────

// The population that shares a contract NUMBER across feeds. It is dominated by `aop`+`rop`,
// which is the one pair whose numbering genuinely agrees — and it is overwhelmingly NOT
// duplication: a buyer reusing a contract number across framework call-offs, with the two feeds
// capturing different call-offs. `02724-2017-0021 / ПО-03-4` is the worked case: aop 7 rows /
// €4,149,034 against rop 5 rows / €103,571, spread over 12 distinct signing dates.
//
// So this is a CEILING, not a zero. Demanding zero would need a ~126-entry allowlist of
// non-duplicates and would destroy the "exhaustive AND minimal" property that makes the gate
// above meaningful. A ceiling still catches the thing worth catching: a NEW feed overlap, or an
// ingest that starts minting colliding numbers.
const IDENTITY_A_CEILING = 130; // measured 126 on 2026-08-04, post-reconcile

test.skipIf(skip)(
  "contract-number collisions across feeds stay within their known bound",
  async () => {
    const [r] = await allRows<{ n: string; detail: string }>(
      `WITH b AS (
         SELECT ${FEED_SQL} AS feed, unp, contract_id, tag
           FROM contracts
          WHERE contractor_eik NOT LIKE 'obed-%'
            AND COALESCE(unp, '') <> '' AND COALESCE(contract_id, '') <> ''
       ), g AS (
         SELECT unp, contract_id,
                array_to_string(array_agg(DISTINCT feed ORDER BY feed), '+') AS pair
           FROM b GROUP BY unp, contract_id, tag
         HAVING count(DISTINCT feed) > 1
       )
       SELECT count(*)::text AS n,
              (SELECT string_agg(pair || '=' || c, ', ' ORDER BY c DESC)
                 FROM (SELECT pair, count(*) c FROM g GROUP BY pair) x) AS detail
         FROM g`,
    );
    const n = Number(r.n);
    assert.ok(
      n <= IDENTITY_A_CEILING,
      `${n} (unp, contract_id) group(s) span more than one feed, above the ${IDENTITY_A_CEILING} ` +
        `ceiling — by pair: ${r.detail}.\n` +
        `  This population is mostly contract-number REUSE inside frameworks, not duplication, ` +
        `so it is bounded rather than driven to zero. A rise means either a new feed overlap or ` +
        `an ingest minting colliding numbers — investigate before raising the ceiling.`,
    );
  },
);

test.skipIf(skip)(
  "the feed classification covers the whole corpus, all four feeds",
  async () => {
    // The gate is only as wide as its CASE expression. If a new generator ships a fifth prefix,
    // its rows silently join the `aop` bucket and every cross-source pair involving it becomes
    // invisible — the same failure as the two-feed model, one level down. So assert that each of
    // the four feeds is present and non-trivial, and that the classification partitions the
    // whole table (no row is unaccounted for).
    const rows = await allRows<{ feed: string; n: string }>(
      `SELECT ${FEED_SQL} AS feed, count(*)::text AS n FROM contracts GROUP BY 1 ORDER BY 1`,
    );
    const byFeed = new Map(rows.map((r) => [r.feed, Number(r.n)]));
    for (const f of ["ocds", "aop", "eop", "rop"])
      assert.ok(
        (byFeed.get(f) ?? 0) > 0,
        `feed '${f}' has no rows — either the corpus lost it, or its release_id prefix changed ` +
          `and its rows are now silently classified as 'aop'`,
      );
    const [t] = await allRows<{ n: string }>(
      "SELECT count(*)::text AS n FROM contracts",
    );
    assert.equal(
      [...byFeed.values()].reduce((s, n) => s + n, 0),
      Number(t.n),
      "the feed classification does not partition the contracts table",
    );
    // A prefix nobody models yet. `aop` is the deliberate fallback, so this cannot be caught by
    // the CASE — it has to be asked directly.
    const [u] = await allRows<{ n: string; sample: string | null }>(
      `SELECT count(*)::text AS n, min(release_id) AS sample FROM contracts
        WHERE release_id NOT LIKE 'ocds-%' AND release_id NOT LIKE 'eop-%'
          AND release_id NOT LIKE 'rop-%'  AND release_id NOT LIKE 'aop-%'`,
    );
    assert.equal(
      Number(u.n),
      0,
      `${u.n} row(s) carry an unmodelled release_id prefix (e.g. ${u.sample}) and are being ` +
        `classified as legacy 'aop'. Add the feed to feedOf() in content_key.ts, to FEED_RANK, ` +
        `and to this file's FEED_SQL — a feed the precedence order does not know cannot be ` +
        `reconciled.`,
    );
  },
);

test.skipIf(skip)(
  "the gate's key is complete on the affected population",
  async () => {
    // Guards the gate itself. Identity E needs a УНП, a contractor, an amount and a signing
    // date, so a row missing any of them is invisible to it. That is safe only while no such row
    // participates in a cross-source pair — assert it rather than assume it, since an ingest
    // that stopped populating `date_signed` would silently blind this file instead of failing it.
    //
    // ONE known exception, allowlisted by contract: 05962-2026-0001/240319, where the ЦАИС row
    // carries an EMPTY contractor_eik. No content net can pair an identity-less row, which is
    // precisely why it cannot be resolved — it is a permanent, structural blind spot, not drift.
    const [r] = await allRows<{ blind: string; sample: string | null }>(
      `SELECT count(*)::text AS blind,
              string_agg(DISTINCT a.unp || '/' || COALESCE(a.contract_id, '-'), ', ') AS sample
         FROM contracts a
        WHERE a.contractor_eik NOT LIKE 'obed-%'
          AND (COALESCE(a.unp, '') = '' OR COALESCE(a.contractor_eik, '') = ''
               OR a.amount_eur IS NULL OR COALESCE(a.date_signed, '') = '')
          AND COALESCE(a.unp, '') <> '05962-2026-0001'
          AND EXISTS (
            SELECT 1 FROM contracts b
             WHERE b.unp = a.unp
               AND COALESCE(b.contract_id, '') = COALESCE(a.contract_id, '')
               AND b.tag = a.tag
               AND (${FEED_SQL.replace(/release_id/g, "b.release_id")})
                   <> (${FEED_SQL.replace(/release_id/g, "a.release_id")})
          )`,
    );
    assert.equal(
      Number(r.blind),
      0,
      `${r.blind} cross-source row(s) lack a УНП, contractor, amount or signing date and are ` +
        `therefore invisible to the identity-E gate: ${r.sample}. Run ` +
        `scripts/procurement/backfill_unp.ts --apply, or widen the gate's key.`,
    );
  },
);
