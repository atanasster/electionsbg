// mp_tr_roles (migration 150) — the live replacement for parliament/mp-management/*.json.
// Plan: docs/plans/mp-tr-edges-pg-v1.md §4 Tier 1, revised by data-hub-lateral-edges-v1 §11.10.
//
//   npm run test:data
//
// The claim this file gates is NOT "the function returns rows". It is:
//
//   1. the role set is the SAME set the profile's own companies list shows (one page, two
//      blocks, one answer about one named person — tr-attribution-basis-v1 §0.2);
//   2. nothing published rests on a name the registry says belongs to more than one human;
//   3. what the static shards published and this does not is EXPLAINED, not merely absent.
//
// Requires Postgres + the person layer + a loaded tr_name_fold_people. Auto-skips only when
// Postgres is unreachable; it does NOT skip on an empty guard table or an unapplied 150 —
// those are states it exists to catch.

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { allRows, withClient, end } from "../lib/pg";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const SHARD_DIR = path.join(ROOT, "data/parliament/mp-management");

const one = async <T extends Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T> => (await allRows<T>(sql, params))[0];

const reachable = await allRows("SELECT 1")
  .then(() => true)
  .catch(() => false);
const skip = reachable ? false : "Postgres unreachable";

afterAll(async () => {
  await end();
});

/** Every (mpId, uic) pair the committed shards publish, or null when the tree is gone.
 *
 *  Read lazily and tolerated as absent ON PURPOSE: step 5 of this migration deletes the tree,
 *  and a reconciliation test that then fails would make the retirement look like a regression.
 *  What must NOT happen is the assertion passing vacuously while the tree is still there — so
 *  the absent branch says so out loud rather than returning an empty set. */
const shardPairs = (): Set<string> | null => {
  if (!fs.existsSync(SHARD_DIR)) return null;
  const out = new Set<string>();
  for (const f of fs.readdirSync(SHARD_DIR)) {
    if (!f.endsWith(".json")) continue;
    const j = JSON.parse(fs.readFileSync(path.join(SHARD_DIR, f), "utf8")) as {
      mpId: number;
      roles: { uic: string }[];
    };
    for (const r of j.roles) out.add(`${j.mpId}\t${r.uic}`);
  }
  return out;
};

test.skipIf(skip)("150 is applied and the function answers", async () => {
  const r = await one<{ n: string }>(
    `SELECT count(*) n FROM pg_proc WHERE proname = 'mp_tr_roles'`,
  );
  assert.equal(
    Number(r.n),
    1,
    "mp_tr_roles is absent — apply 150_mp_tr_roles.sql. The route degrades to null, so " +
      "the profile block simply vanishes rather than erroring; nothing else reports this.",
  );
  // An unknown id must be NULL, not an empty payload: the component renders nothing on null
  // and would render an empty card on `{roles: []}`. Probed at the route's own upper clamp
  // (9,999,999) rather than above it, so this covers a value /api/db/mp-management can bind.
  const miss = await one<{ r: unknown }>(`SELECT mp_tr_roles(9999999) AS r`);
  assert.equal(
    miss.r,
    null,
    "an unknown mp_id must yield NULL, not an empty payload",
  );
});

test.skipIf(skip)(
  "the person layer is populated — every assertion below is vacuous without this",
  async () => {
    // ORDERED FIRST, and load-bearing. Each later test counts DIVERGENCES or VIOLATIONS, and
    // every one of those counts is 0 on an empty person layer: no MPs, no roles, nothing to
    // disagree. So on a database where db:resolve:persons has never run, the whole file would
    // go green while asserting nothing — the same failure class tr_name_fold_people.data
    // .test.ts documents for its own assertion 2. The floors are deliberately far below
    // today's values (2,122 MPs / 456k folds) so ordinary churn does not trip them.
    const r = await one<{ mps: string; folds: string; served: string }>(
      `SELECT (SELECT count(DISTINCT split_part(ref, ':', 1))
                 FROM person_role WHERE source = 'mp')            AS mps,
              (SELECT count(*) FROM tr_name_fold_people)          AS folds,
              (SELECT count(*) FROM person_role
                WHERE source IN ('tr','ngo')
                  AND confidence IN ('exact_id','high','manual')) AS served`,
    );
    assert.ok(
      Number(r.mps) > 1_000,
      `only ${r.mps} MPs in person_role — run db:resolve:persons. Every assertion in this ` +
        `file counts violations, and zero rows means zero violations.`,
    );
    assert.ok(
      Number(r.folds) > 100_000,
      `tr_name_fold_people holds ${r.folds} folds — run db:load:tr-name-fold-people:pg. ` +
        `With it empty every fold reads as unmeasured and nothing is published at all.`,
    );
    assert.ok(
      Number(r.served) > 10_000,
      `only ${r.served} gated tr/ngo roles exist corpus-wide; this file cannot discriminate.`,
    );
  },
);

test.skipIf(skip)(
  "the published set EQUALS what the profile itself serves (082's companies ∪ ngos)",
  async () => {
    // THE anti-drift gate, and the reason this is a function over person_role rather than a
    // table. If the two diverge, one profile page shows a company in the management block that
    // its own lists omit (or vice versa) — two claims about one named person, on one screen.
    //
    // ⚠️ IT COMPARES AGAINST 082's ACTUAL PAYLOAD, not against a restatement of this
    // function's predicate. The first cut of this test rebuilt `person_role … source IN
    // ('tr','ngo') AND confidence IN (…)` on the right-hand side — the same clause the
    // function uses — so it could not fail: it asserted the query equals itself. Reading
    // `person_by_slug` makes the yardstick independent.
    //
    // ⚠️ AND IT COMPARES AGAINST THE UNION. 082 splits the set — `companies` is source 'tr',
    // `ngos` is source 'ngo' — while this function returns it whole. Measured, 616 of 1,966
    // role rows are ngo-sourced, so comparing against `companies` alone reports a 31.3%
    // "divergence" that is really a partition difference.
    const r = await one<{ n: string; served: string }>(
      `WITH mps AS (
         SELECT DISTINCT split_part(ref, ':', 1)::int AS mp_id, person_id
           FROM person_role WHERE source = 'mp'
       ),
       slugs AS (
         SELECT m.mp_id, pe.slug FROM mps m JOIN person pe ON pe.person_id = m.person_id
       ),
       fn AS (
         SELECT m.mp_id, jsonb_array_elements(mp_tr_roles(m.mp_id) -> 'roles') ->> 'uic' AS uic
           FROM mps m WHERE mp_tr_roles(m.mp_id) IS NOT NULL
       ),
       profile AS (
         SELECT s.mp_id,
                jsonb_array_elements(
                  COALESCE(p.r -> 'companies', '[]'::jsonb) ||
                  COALESCE(p.r -> 'ngos', '[]'::jsonb)) ->> 'eik' AS uic
           FROM slugs s
           CROSS JOIN LATERAL (SELECT person_by_slug(s.slug) AS r) p
          WHERE p.r IS NOT NULL
       )
       SELECT (SELECT count(*) FROM (
                 (SELECT DISTINCT mp_id, uic FROM fn
                  EXCEPT SELECT DISTINCT mp_id, uic FROM profile)
                 UNION ALL
                 (SELECT DISTINCT mp_id, uic FROM profile
                  EXCEPT SELECT DISTINCT mp_id, uic FROM fn)
               ) d) AS n,
              (SELECT count(*) FROM fn) AS served`,
    );
    // Guard against the whole comparison going vacuous — two empty sets are also equal.
    assert.ok(
      Number(r.served) > 500,
      `only ${r.served} role rows served; the equality below would pass on an empty set`,
    );
    assert.equal(
      Number(r.n),
      0,
      `${r.n} (mp, company) pairs differ between mp_tr_roles and what person_by_slug serves ` +
        `on the same profile. One page would show two different answers.`,
    );
  },
  300_000,
);

test.skipIf(skip)(
  "no NAME-MATCHED role rests on a shared or unmeasured fold",
  async () => {
    // Zero is the passing value, and the `linkBasis` split is load-bearing rather than a
    // refinement. The guard exists to stop name DISCOVERY on an ambiguous name; it says
    // nothing about a company a curated register put on this person.
    //
    // ⚠️ WHY 'declared' IS EXEMPT, measured. The first cut of this assertion counted every
    // role and failed on 5 — Станислав Владимиров's читалище, Петър Кънев's two companies,
    // Мюмюн Мюмюн's, Надежда Йорданова's — all `confidence='exact_id'` and all in
    // person_company_bridge_a. Those came from declared interests / ИВСС чл.175а, i.e. the
    // person's OWN filing named the EIK; refusing them because a stranger shares the name
    // would drop exactly the holdings the transparency registers exist to publish. Bridge A
    // is still not a confirmed identity (the officer row inside the register-sourced company
    // link is a name match — 148), which is why the payload labels it rather than hiding it.
    //
    // What must stay zero is the OTHER arm: a company found by name alone, on a name the
    // registry says belongs to more than one human. That is the 410-pair claim the static
    // shards made and the rest of the site retracted.
    const r = await one<{ shared: string; unmeasured: string }>(
      `WITH mps AS (
         SELECT DISTINCT split_part(ref, ':', 1)::int AS mp_id, person_id
           FROM person_role WHERE source = 'mp'
       ), roles AS (
         SELECT m.person_id,
                jsonb_array_elements(mp_tr_roles(m.mp_id) -> 'roles') AS r
           FROM mps m WHERE mp_tr_roles(m.mp_id) IS NOT NULL
       )
       SELECT count(*) FILTER (WHERE pe.fold_people_n > 1)     AS shared,
              count(*) FILTER (WHERE pe.fold_people_n IS NULL) AS unmeasured
         FROM roles
         JOIN person pe ON pe.person_id = roles.person_id
        WHERE roles.r ->> 'linkBasis' = 'name_match'`,
    );
    assert.equal(
      Number(r.shared),
      0,
      `${r.shared} name-matched roles sit on a fold the registry says holds 2+ people. ` +
        `That is the claim the static shards made for 410 pairs and the site retracted.`,
    );
    assert.equal(
      Number(r.unmeasured),
      0,
      `${r.unmeasured} name-matched roles sit on an UNMEASURED fold. Unmeasured is not ` +
        `unique — treating it as unique is the fail-open direction (148's three-state note).`,
    );
  },
  120_000,
);

test.skipIf(skip)(
  "the declared exemption is narrow — it does not swallow the guard",
  async () => {
    // The exemption above is only safe while `declared` stays small and register-sourced. If a
    // future change started labelling name-discovered companies 'declared', the assertion above
    // would keep passing while the guard did nothing. So: bound the exempt population, and
    // require every exempt role to be reachable from person_company_bridge_a.
    const r = await one<{ exempt: string; unbacked: string }>(
      `WITH mps AS (
         SELECT DISTINCT split_part(ref, ':', 1)::int AS mp_id, person_id
           FROM person_role WHERE source = 'mp'
       ), roles AS (
         SELECT m.person_id,
                jsonb_array_elements(mp_tr_roles(m.mp_id) -> 'roles') AS r
           FROM mps m WHERE mp_tr_roles(m.mp_id) IS NOT NULL
       )
       SELECT count(*) FILTER (WHERE roles.r ->> 'linkBasis' = 'declared') AS exempt,
              count(*) FILTER (WHERE roles.r ->> 'linkBasis' = 'declared'
                                 AND NOT EXISTS (
                                   SELECT 1 FROM person_company_bridge_a ba
                                    WHERE ba.person_id = roles.person_id
                                      AND ba.uic = roles.r ->> 'uic')) AS unbacked
         FROM roles`,
    );
    assert.equal(
      Number(r.unbacked),
      0,
      `${r.unbacked} roles are labelled 'declared' without a person_company_bridge_a row — ` +
        `the label has drifted from the view that defines it.`,
    );
    // Bridge A is ~766 pairs corpus-wide; the MP slice of it cannot plausibly exceed a few
    // hundred. A jump past this means 'declared' has started absorbing name matches.
    assert.ok(
      Number(r.exempt) < 500,
      `${r.exempt} roles are exempt as 'declared' — Bridge A is ~766 pairs across the WHOLE ` +
        `corpus, so an MP-only slice this large means the label is absorbing name matches.`,
    );
  },
  120_000,
);

test.skipIf(skip)(
  "every shard pair is either reproduced or explained by the guard",
  async () => {
    const pairs = shardPairs();
    if (pairs === null) {
      // The tree is retired (step 5). Nothing to reconcile — say so rather than pass silently.
      console.warn(
        "[mp_tr_roles] data/parliament/mp-management/ is absent — reconciliation skipped. " +
          "That is expected once the shard family is retired.",
      );
      return;
    }
    const rows = await allRows<{ mp_id: number; uic: string }>(
      `WITH mps AS (
         SELECT DISTINCT split_part(ref, ':', 1)::int AS mp_id, person_id
           FROM person_role WHERE source = 'mp'
       )
       SELECT m.mp_id, jsonb_array_elements(mp_tr_roles(m.mp_id) -> 'roles') ->> 'uic' AS uic
         FROM mps m WHERE mp_tr_roles(m.mp_id) IS NOT NULL`,
    );
    const served = new Set(rows.map((r) => `${r.mp_id}\t${r.uic}`));
    const dropped = [...pairs].filter((p) => !served.has(p));

    // Every dropped pair must be attributable to the guard or to the person layer refusing
    // the person entirely — never to this function losing rows it should have kept.
    const explained = await one<{ n: string }>(
      `WITH mps AS (
         SELECT DISTINCT split_part(ref, ':', 1)::int AS mp_id, person_id
           FROM person_role WHERE source = 'mp'
       ), d AS (
         SELECT split_part(p, E'\\t', 1)::int AS mp_id, split_part(p, E'\\t', 2) AS uic
           FROM unnest($1::text[]) AS p
       )
       SELECT count(*) n FROM d
        LEFT JOIN mps m ON m.mp_id = d.mp_id
        LEFT JOIN person pe ON pe.person_id = m.person_id
       WHERE m.mp_id IS NULL                      -- MP has no person row at all
          OR pe.fold_people_n IS DISTINCT FROM 1  -- shared or unmeasured fold
          OR NOT EXISTS (                         -- or Bridge A/B never minted this company
               SELECT 1 FROM person_role r
                WHERE r.person_id = m.person_id AND r.source IN ('tr','ngo') AND r.ref = d.uic)`,
      [dropped],
    );
    assert.equal(
      Number(explained.n),
      dropped.length,
      `${dropped.length - Number(explained.n)} of ${dropped.length} dropped shard pairs are ` +
        `NOT explained by the guard — those are rows this migration lost rather than refused.`,
    );
    // Report the split so a reviewer sees the size of the behaviour change rather than
    // inferring it. Not an assertion: the numbers move with every re-resolve.
    console.info(
      `[mp_tr_roles] shard pairs ${pairs.size} · served ${served.size} · ` +
        `dropped ${dropped.length} (all explained)`,
    );
  },
  180_000,
);

/** An MP who actually HOLDS roles, chosen at run time.
 *
 *  ⚠️ NOT A HARD-CODED ID. The first cut pinned `3101`, which holds ZERO roles — so the plan
 *  never reached `cos` → `tr_person_roles` → `tr_companies` → `bridge_a` at all and the
 *  "ceiling" bounded the cheapest possible call (71 buffers, not the 866 its comment claimed).
 *  A budget measured on an empty payload cannot catch a regression in the payload. Picking the
 *  busiest MP at run time also survives a re-resolve moving ids around. */
const busiestMp = async (): Promise<number> =>
  Number(
    (
      await one<{ m: string }>(
        `WITH mps AS (
           SELECT DISTINCT split_part(ref, ':', 1)::int AS m FROM person_role WHERE source='mp'
         )
         SELECT m FROM mps
          ORDER BY jsonb_array_length(
            COALESCE(mp_tr_roles(m) -> 'roles', '[]'::jsonb)) DESC, m
          LIMIT 1`,
      )
    ).m,
  );

/** Worst single-node buffer count in an EXPLAIN plan.
 *
 *  Counts `read=` as well as `hit=`: on a cold cache the same work shows up as reads, and a
 *  hit-only regex would let a cold run slip under the ceiling (and, worse, let the
 *  discrimination test below FAIL for the wrong reason). */
const worstBuffers = (text: string): number =>
  Math.max(
    ...[...text.matchAll(/shared (?:hit=(\d+))?\s*(?:read=(\d+))?/g)].map(
      (m) => Number(m[1] ?? 0) + Number(m[2] ?? 0),
    ),
    0,
  );

test.skipIf(skip)(
  "one profile's payload stays inside its buffer budget",
  async () => {
    // The ceiling exists because the pre-index body was 10,274 buffers for ONE profile — the
    // whole cost being `split_part(ref,':',1)` scanning every mp row. Measured on the busiest
    // MP (a real payload, not an empty one), so it bounds what a reader actually pays for.
    const mp = await busiestMp();
    const plan = await allRows<{ "QUERY PLAN": string }>(
      `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) SELECT mp_tr_roles(${mp})`,
    );
    const worst = worstBuffers(plan.map((r) => r["QUERY PLAN"]).join("\n"));
    assert.ok(
      worst > 0,
      `no buffer counts in the plan for mp ${mp} — the regex or EXPLAIN format changed, and ` +
        `a ceiling that reads 0 passes unconditionally`,
    );
    assert.ok(
      worst < 6_000,
      `mp_tr_roles(${mp}) touched ${worst} buffers (budget 6,000). The usual cause is ` +
        `idx_person_role_mp_id missing — 150 creates it, and without it this is 10,274+.`,
    );
  },
);

test.skipIf(skip)(
  "the buffer ceiling still discriminates",
  async () => {
    // A ceiling that cannot fail is not a gate. Drop the index inside a rolled-back
    // transaction and assert the same call blows the budget.
    //
    // ⚠️ ONE PINNED CLIENT, NOT `allRows`. allRows goes through the POOL, so BEGIN, DROP INDEX
    // and ROLLBACK can each land on a DIFFERENT connection — which autocommits the DROP and
    // permanently removes a serving index from whatever DATABASE_URL names, the Cloud SQL
    // proxy included. person_connections.data.test.ts uses withClient for exactly this reason.
    const mp = await busiestMp();
    let worst = 0;
    await withClient(async (c) => {
      await c.query("BEGIN");
      try {
        await c.query("DROP INDEX idx_person_role_mp_id");
        const plan = await c.query(
          `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) SELECT mp_tr_roles(${mp})`,
        );
        worst = worstBuffers(
          plan.rows
            .map((r: Record<string, string>) => r["QUERY PLAN"])
            .join("\n"),
        );
      } finally {
        await c.query("ROLLBACK");
      }
    });
    assert.ok(
      worst > 8_000,
      `without idx_person_role_mp_id the call touched only ${worst} buffers — the ceiling ` +
        `above is no longer measuring the index it was written for.`,
    );
  },
  60_000,
);
