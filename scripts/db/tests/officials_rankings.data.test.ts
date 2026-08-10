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
// The ceiling ROSE from ~1,700 to ~1,853 in T0.1b, and that is the merge working as
// intended: collapsing 154 duplicate person rows means more refs now share one row, so
// more of them are not the representative. Correctness moved the opposite way.
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
      Number(orphans.n) <= 1900,
      `unaddressable officials refs grew to ${orphans.n} (~1,853 after T0.1b) — resolve an officials slug against person_role.ref, not this column`,
    );
  },
);

// has_declaration must stay CONSISTENT with the declaration table. It is currently true
// for every row: the 154 officials that looked like "no declaration on record" before
// T0.1b were not non-filers at all — they were the duplicate person rows, holding a role
// while their twin held the filings, and merging them dissolved the whole population.
// The column still earns its place (a newly appointed official who has not yet filed is a
// real state, and one worth reporting), so this asserts the invariant rather than the
// counts: has_declaration is false exactly when the person has no declaration.
test.skipIf(skip)(
  "has_declaration agrees with the declaration table",
  async () => {
    const [wrong] = await allRows<{ n: string }>(
      `SELECT count(*) n FROM officials_rankings_table o
         JOIN person p ON p.slug = o.slug
        WHERE o.has_declaration <> EXISTS (
          SELECT 1 FROM declaration d WHERE d.person_id = p.person_id)`,
    );
    assert.equal(
      Number(wrong.n),
      0,
      "has_declaration disagrees with whether the person actually has declarations",
    );
  },
);

// Per-person parity with the JSON this resource replaces. After T0.1b merged the duplicate
// officials person rows (migration 101), the tail is 11,415 exact matches + 1,293 0-vs-NULL
// (counted equal here) + 530 representative-filing differences (325 where PG uses a NEWER
// filing from another tier, 21 older, 184 same-year) and — the number that matters — ZERO
// true losses. Budgeted rather than exact so the explained tail passes, but a regression
// that turns 184 same-year mismatches into 1,840 trips it.
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
      mismatched <= 600,
      `net-worth parity regressed: ${mismatched} of ${compared} mismatched (known tail ~530)`,
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

// T0.1b: an official holding two posts is ONE person. The Сметна палата register writes
// one filing under one slug per institution, and load_declarations_pg drops the duplicate
// because source_url is UNIQUE — which used to leave the dropped slug with no register
// GUID, no gold-key union, and so a second person row carrying the role while the first
// carried the wealth. migration 101 keeps the dropped pairs so registerIdByRef can see
// them. Димитър Георгиев Тасков (Управител of two hospitals, one filing, entry Г4422) is
// the canonical case: he must be ONE person, and that person must have his net worth.
test.skipIf(skip)(
  "an official holding two posts is one person, with their wealth",
  async () => {
    const rows = await allRows<{ slug: string; net_worth_eur: string | null }>(
      `SELECT o.slug, o.net_worth_eur FROM officials_rankings_table o
      WHERE o.slug LIKE 'dimitr-georgiev-taskov%'`,
    );
    assert.equal(
      rows.length,
      1,
      `expected one leaderboard row, got ${rows.length}: ${rows.map((r) => r.slug).join(", ")} — the duplicate officials slugs have un-merged`,
    );
    assert.ok(
      rows[0].net_worth_eur !== null && Number(rows[0].net_worth_eur) > 0,
      "the merged official has no net worth — the role and the declarations are on different person rows again",
    );
  },
);

// The general invariant behind that case: no officials slug may be left without a register
// GUID purely because its filings were all written under another slug too. Zero is the
// only correct answer, and it is what keeps the parity tail's true-loss count at 0.
test.skipIf(skip)(
  "no officials ref is stranded without its filings",
  async () => {
    const [stranded] = await allRows<{ n: string }>(
      `SELECT count(*) n
       FROM (SELECT DISTINCT subject_ref FROM declaration_subject_alias) a
      WHERE NOT EXISTS (
        SELECT 1 FROM person_role r
          JOIN declaration d ON d.person_id = r.person_id
         -- split_part: since mp-party-affiliation-v1 T3 an MP's person_role.ref
         -- is '<mpId>:<ns>' while declaration_subject_alias still keys the bare
         -- mpId, so a bare equality strands every mp-tier alias here.
         WHERE split_part(r.ref, ':', 1) = a.subject_ref)`,
    );
    assert.equal(
      Number(stranded.n),
      0,
      `${stranded.n} officials slug(s) whose filings were all deduplicated away resolve to a person with no declarations — registerIdByRef is not seeing declaration_subject_alias`,
    );
  },
);

// The mirror-image case: a filing whose WINNING subject_ref resolves to nobody, while a
// ref that lost the source_url dedup does resolve. Phase 2's alias pass attaches it.
// Галя Стоянова Василева's 2025 filing landed under ref 4718 (carried by no mention) while
// she resolves through 5334, which truncated her wealth series at 2023.
test.skipIf(skip)("every declaration resolves to a person", async () => {
  const [n] = await allRows<{ n: string }>(
    "SELECT count(*) n FROM declaration WHERE person_id IS NULL",
  );
  assert.equal(
    Number(n.n),
    0,
    `${n.n} declaration(s) resolve to nobody — phase 2's declaration_subject_alias pass is not attaching filings whose winning ref has no mention`,
  );
});
