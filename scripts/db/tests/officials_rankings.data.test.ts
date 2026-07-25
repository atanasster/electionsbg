// The officials asset leaderboard (100_officials_rankings.sql) that replaces
// data/officials/assets-rankings.json on /officials/assets + the /governance tile.
// Plan: docs/plans/persons-pg-retirement-v1.md (Tier 0.1).
//
// These pin the three things that were actually WRONG while building it, because each
// failure was silent — the matview still populated, the page still rendered, the numbers
// were just quietly missing people:
//
//   1. The source list is not `official_%`. Restricting it to the three obvious sources
//      dropped every diplomat, MEP and president (Станишев, Бареков, every ambassador) —
//      227 people, 229 JSON rows. It must stay in lockstep with
//      OFFICIAL_DECLARATION_SOURCES in src/lib/officialSources.ts, which documents the
//      same bug costing 179 people their roles section.
//   2. is_exec/is_muni must be membership flags, not a single representative `source`:
//      504 people hold both an executive and a municipal post, and bucketing them by one
//      source under-reported the executive leaderboard by 212.
//   3. An INNER join to the wealth series deletes the 2,620 officials with no wealth row.
//      "Filed and declared nothing" is a reportable state, and 154 of them never filed
//      at all — see has_declaration.
//
// Counts quoted above are snapshots as of 2026-07; the assertions below are written as
// invariants or ceilings so a ±1 drift does not fail the suite.
//
// Auto-skips when Postgres is down or unloaded — like the other *.data.test.ts gates.
//
//   npm run test:data

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, end } from "../lib/pg";
import { OFFICIAL_DECLARATION_SOURCES } from "@/lib/officialSources";

const reachable = async (): Promise<boolean> => {
  try {
    const [t] = await allRows<{ ok: boolean }>(
      "SELECT to_regclass('public.officials_rankings_table') IS NOT NULL AS ok",
    );
    if (!t?.ok) return false;
    const [c] = await allRows<{ n: string }>(
      "SELECT count(*) n FROM officials_rankings_table",
    );
    return Number(c.n) > 0;
  } catch {
    return false;
  }
};

const haveDb = await reachable();
const skip = haveDb ? false : "Postgres unreachable / officials_rankings empty";

afterAll(async () => {
  await end();
});

// (1) The SQL source list mirrors officialSources.ts. If someone adds a dedicated
// person_source for a new officials category (the way president/mep/diplomat were added)
// and forgets the matview, that category silently vanishes from the leaderboard.
test.skipIf(skip)(
  "source list matches OFFICIAL_DECLARATION_SOURCES",
  async () => {
    const rows = await allRows<{ source: string }>(
      "SELECT DISTINCT source FROM officials_rankings_table ORDER BY source",
    );
    for (const { source } of rows) {
      assert.ok(
        OFFICIAL_DECLARATION_SOURCES.has(source),
        `matview emits source '${source}' which officialSources.ts does not consider an officials source`,
      );
    }
    // And the reverse: every TS-declared officials source that has roles in this DB must
    // reach the matview. This is the direction that caught the missing diplomats/MEPs.
    const present = await allRows<{ source: string }>(
      `SELECT DISTINCT r.source FROM person_role r
      WHERE r.source = ANY($1::text[])
        AND EXISTS (SELECT 1 FROM person p WHERE p.person_id = r.person_id)`,
      [[...OFFICIAL_DECLARATION_SOURCES]],
    );
    const emitted = new Set(rows.map((r) => r.source));
    for (const { source } of present) {
      assert.ok(
        emitted.has(source),
        `person_role has '${source}' officials but the matview emits none — the WHERE list in 100_officials_rankings.sql has drifted from officialSources.ts`,
      );
    }
  },
);

// (2) Membership flags, not a representative source. Anyone holding both kinds of post
// must be true on BOTH flags — that is the whole reason the flags exist.
test.skipIf(skip)(
  "is_exec/is_muni reflect every role held, not just one",
  async () => {
    const [dual] = await allRows<{ n: string }>(
      `SELECT count(*) n FROM officials_rankings_table WHERE is_exec AND is_muni`,
    );
    assert.ok(
      Number(dual.n) > 0,
      "no one is flagged as both exec and muni — the flags have collapsed to the representative source",
    );

    // Every person with an executive-side role is is_exec, regardless of which post won
    // the representative tiebreak.
    const [leaked] = await allRows<{ n: string }>(
      `SELECT count(*) n FROM person p
       JOIN officials_rankings_table o ON o.slug = p.slug
      WHERE EXISTS (
              SELECT 1 FROM person_role r
               WHERE r.person_id = p.person_id AND r.source <> 'official_muni'
                 AND r.source = ANY($1::text[]))
        AND NOT o.is_exec`,
      [[...OFFICIAL_DECLARATION_SOURCES]],
    );
    assert.equal(
      Number(leaked.n),
      0,
      "officials holding an executive-side post are not flagged is_exec",
    );
  },
);

// (3) Officials who filed without valued assets stay on the roster with a NULL figure.
// An INNER join to person_wealth_year would drop them entirely.
test.skipIf(skip)(
  "officials who declared no valued assets are kept, not dropped",
  async () => {
    const [n] = await allRows<{ n: string }>(
      "SELECT count(*) n FROM officials_rankings_table WHERE net_worth_eur IS NULL",
    );
    assert.ok(
      Number(n.n) > 0,
      "no NULL-wealth officials — the wealth join has become INNER and silently dropped them",
    );
  },
);

// Pagination determinism: slug is the tiebreak buildOrder appends, so it must be unique.
// A duplicate makes a page boundary non-deterministic and can repeat or skip a row.
test.skipIf(skip)("slug is unique (the paging tiebreak)", async () => {
  const [dupes] = await allRows<{ n: string }>(
    `SELECT count(*) n FROM (
       SELECT slug FROM officials_rankings_table GROUP BY slug HAVING count(*) > 1) x`,
  );
  assert.equal(
    Number(dupes.n),
    0,
    "duplicate slugs break deterministic pagination",
  );
});

// The §6 privacy gate. This currently passes trivially — every officials source is
// public_default=true — which is exactly when a missing assertion is most dangerous: it
// keeps passing right up until a resolver run parks someone in status='review'.
test.skipIf(skip)("the §6 privacy gate is applied", async () => {
  const [n] = await allRows<{ n: string }>(
    `SELECT count(*) n FROM officials_rankings_table o
       JOIN person p ON p.slug = o.slug
      WHERE p.status <> 'active' OR NOT p.is_public_figure`,
  );
  assert.equal(
    Number(n.n),
    0,
    "non-public / in-review persons reached the public leaderboard",
  );
});

// official_slug is the representative ref only — one per person — so it is NOT a lookup
// key and the registry deliberately does not expose it as a filter. This pins the known
// ceiling so the lossiness cannot silently grow, and documents that it is intentional.
test.skipIf(skip)(
  "unaddressable officials refs stay within the known ceiling",
  async () => {
    const [orphans] = await allRows<{ n: string }>(
      `SELECT count(*) n FROM (
       SELECT DISTINCT r.ref FROM person_role r
        WHERE r.source = ANY($1::text[])
          AND NOT EXISTS (
            SELECT 1 FROM officials_rankings_table o WHERE o.official_slug = r.ref)
     ) x`,
      [[...OFFICIAL_DECLARATION_SOURCES]],
    );
    assert.ok(
      Number(orphans.n) <= 1800,
      `unaddressable officials refs grew to ${orphans.n} (was ~1,700) — resolve an officials slug against person_role.ref, not this column`,
    );
  },
);

// has_declaration must actually separate the two NULL-net-worth populations. If it ever
// becomes all-true, the 154 non-filers have silently merged into "declared nothing".
test.skipIf(skip)(
  "has_declaration separates non-filers from zero-asset filers",
  async () => {
    const [row] = await allRows<{ filed: string; never_filed: string }>(
      `SELECT count(*) FILTER (WHERE has_declaration)      AS filed,
            count(*) FILTER (WHERE NOT has_declaration)  AS never_filed
       FROM officials_rankings_table WHERE net_worth_eur IS NULL`,
    );
    assert.ok(
      Number(row.filed) > 0 && Number(row.never_filed) > 0,
      `has_declaration no longer distinguishes the two NULL populations (filed=${row.filed}, never_filed=${row.never_filed})`,
    );
  },
);

// Per-person parity with the JSON this resource replaces. The T0.1 reconciliation found
// 11,415 exact matches and a tail of explained differences (PG picks a newer filing from
// another tier; 0-vs-NULL; and 106 real losses from duplicate officials slugs the person
// resolver has not merged). Budgeted rather than exact so the known tail passes, but a
// regression that turns 183 same-year mismatches into 1,830 trips it.
const RANKINGS_JSON = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../data/officials/assets-rankings.json",
);
const haveJson = (() => {
  try {
    readFileSync(RANKINGS_JSON);
    return true;
  } catch {
    return false;
  }
})();

test.skipIf(skip || !haveJson)(
  "per-person net-worth parity with assets-rankings.json stays within budget",
  async () => {
    const json = JSON.parse(readFileSync(RANKINGS_JSON, "utf-8")) as {
      topOfficials: {
        slug: string;
        netWorthEur?: number | null;
        latestDeclarationYear?: number;
      }[];
    };
    const refs = await allRows<{ ref: string; slug: string }>(
      `SELECT r.ref, p.slug FROM person_role r
         JOIN person p USING (person_id)
        WHERE r.source = ANY($1::text[])`,
      [[...OFFICIAL_DECLARATION_SOURCES]],
    );
    const refToPerson = new Map(refs.map((r) => [r.ref, r.slug]));
    const board = await allRows<{ slug: string; net_worth_eur: string | null }>(
      "SELECT slug, net_worth_eur FROM officials_rankings_table",
    );
    const pg = new Map(board.map((r) => [r.slug, r.net_worth_eur]));

    // Collapse the JSON to one row PER PERSON first, newest declaration year winning.
    // 998 people appear under more than one officials slug, and PG holds a single
    // figure per human — comparing every slug would count each older duplicate as a
    // mismatch and measure the JSON's duplication rather than a parity regression.
    const bestByPerson = new Map<
      string,
      { netWorthEur?: number | null; latestDeclarationYear?: number }
    >();
    for (const row of json.topOfficials) {
      const person = refToPerson.get(row.slug);
      if (!person) continue;
      const prev = bestByPerson.get(person);
      if (
        !prev ||
        (row.latestDeclarationYear ?? 0) > (prev.latestDeclarationYear ?? 0)
      )
        bestByPerson.set(person, row);
    }

    let compared = 0;
    let mismatched = 0;
    for (const [person, row] of bestByPerson) {
      const v = pg.get(person);
      if (v === undefined) continue;
      compared++;
      const jn = row.netWorthEur ?? 0;
      if (v === null) {
        if (jn !== 0) mismatched++;
        continue;
      }
      if (Math.abs(Number(v) - jn) > 0.01) mismatched++;
    }
    assert.ok(
      compared > 10_000,
      `parity check compared only ${compared} people`,
    );
    assert.ok(
      mismatched <= 700,
      `net-worth parity regressed: ${mismatched} of ${compared} mismatched (known tail ~635)`,
    );
  },
);

// The leaderboard's headline sort must be index-backed, not a seq scan + heapsort. The
// DESC index was initially NULLS FIRST while the query is DESC NULLS LAST, and the
// planner silently ignored it (9.6ms -> 0.14ms once they matched).
test.skipIf(skip)("the default leaderboard sort uses an index", async () => {
  const plan = await allRows<{ "QUERY PLAN": string }>(
    `EXPLAIN SELECT slug, net_worth_eur FROM officials_rankings_table
      WHERE is_exec ORDER BY net_worth_eur DESC NULLS LAST, slug LIMIT 50`,
  );
  const text = plan.map((r) => r["QUERY PLAN"]).join("\n");
  // "Index Only Scan" also counts — it is the better plan, and the covering index
  // (net_worth_eur, slug) legitimately produces it.
  assert.ok(
    /Index (Only )?Scan/.test(text) && !/Seq Scan/.test(text),
    `default sort is not index-backed:\n${text}`,
  );
});
