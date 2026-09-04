// The two writers of `MunicipalIndexEntry.role`, held to the same answer (T2 / TEST-004).
//
// `scripts/officials/municipal.ts` computes the published role as it parses each filing;
// `scripts/officials/restamp_roles.ts` re-derives it offline from Postgres. They are two code
// paths writing one published field — the shape this repo gates with a recompute
// (declaration_filed_position.data.test.ts, tr_owner_share.data.test.ts) rather than with a
// comment — and the field says which office a named person holds, so a disagreement is a false
// statement about an individual rather than a drifted statistic.
//
// The assertion is that a dry-run restamp over the COMMITTED index reports zero pending
// changes. It goes red in both useful directions: the ingest stopped applying the rule (rows
// the restamp would now promote), and the corpus was restamped under a rule that has since
// been narrowed (rows it would now put back).
//
// Auto-skips with a STATE-SPECIFIC reason — Postgres unreachable, the muni declarations
// unloaded, or the corpus carrying no `filed_position` — because those three need three
// different remedies. The probe is tri-state rather than boolean; see the ⚠ on `reachable()`.
//
//   npm run test:data

import { test, afterAll } from "vitest";
import assert from "node:assert/strict";
import { allRows, end } from "../lib/pg";
import { reportSkip } from "../../lib/report_skip";
import { restampRoles } from "../../officials/restamp_roles";

/** ⚠ TRI-STATE, NOT A BOOLEAN, AND THE REASON IS THE POINT. A probe that answers `false` both
 *  when the server is down and when the table is empty forces ONE authored sentence onto two
 *  different worlds — and the half it gets wrong is always "Postgres unreachable", which
 *  `mp_arm_sql`'s header records as the string a real SQL bug hid behind for two days: "the one
 *  warning an operator is trained to ignore". The slash in the old message ("Postgres
 *  unreachable / no muni declarations loaded") was the conflation written out rather than
 *  fixed. `report_skip_coverage.test.ts` detects the shape structurally; the fix it names is
 *  this signature, with each state carrying its own remedy.
 *
 *  ⚠⚠ THE THIRD STATE IS THE ONE A FRESH CLONE IS IN, AND IT USED TO RUN THE ASSERTION.
 *  `restampRoles` reads `declaration.filed_position` / `filed_institution`, and its own header
 *  says those "are not in the declaration shards — the shard writers never persisted them":
 *  they arrive by crawl or by `scripts/db/ship_filed_position.ts`, never from `db:refresh`.
 *  `subject_ref` DOES come off the shards, so a database built the documented way has 6,343 of
 *  them and none of the columns this test depends on — and the old probe, counting
 *  `subject_ref`, reported "run it".
 *
 *  Measured on such a corpus: `restampRoles` reports 4 flips, demoting Раднево, Разград,
 *  Мъглиж and Макреш from mayor, each `filed "null" @ "null"` — the four municipalities T2
 *  exists for. `reconcileRole` returns the LISTING role whenever `statesPlainMayoralty(null)`
 *  is false, so every promotion silently reverts. The test then fails blaming the ingest, and
 *  the remedy in its own message — `restamp_roles.ts --apply` — writes those demotions into the
 *  committed `index.json`, republishing a claim about four named people that T2 withdrew.
 *  `--allow-partial` is no defence: the 95% floor guards rows with NO filing, and here all
 *  6,343 join.
 *
 *  So the probe tests the columns the ASSERTION reads, not the one that happens to be present.
 *
 *  ⚠ THE CATCH IS BRANCHED FOR THE SAME REASON THE CONTENT TEST IS. A bare `catch` reports a
 *  server that is up and missing 089 as "Postgres unreachable" — and `conflatedProbes` cannot
 *  see it, because that rule's exemption is satisfied by ANY `string` in the return type. Once
 *  a file is tri-state the structural gate is blind to it and only review is left. */
const reachable = async (): Promise<string | false> => {
  try {
    const [c] = await allRows<{ n: string; filed: string }>(
      `SELECT count(*) n,
              count(*) FILTER (WHERE filed_position IS NOT NULL) filed
         FROM declaration
        WHERE tier = 'muni' AND subject_ref IS NOT NULL`,
    );
    if (Number(c.n) === 0)
      return "no muni declaration carries a subject_ref — run npm run db:load:declarations:pg";
    if (Number(c.filed) === 0)
      return "declaration.filed_position is empty — it comes from a crawl or scripts/db/ship_filed_position.ts, never from db:refresh";
    return false;
  } catch (e) {
    // ⚠ THE SERVER BEING UP IS THE COMMON CASE FOR EVERY CODE BELOW. "applied, never loaded" is
    // a whole section of CLAUDE.md, so 42P01 here means a database holding the corpus and not
    // the migration — a different remedy from restarting a container.
    const code = (e as { code?: string }).code;
    if (code === "42P01")
      return "the declaration table does not exist — apply 089_declarations.sql to this database";
    if (code === "42501")
      return "no permission to read declaration — check the role this DATABASE_URL connects as";
    return "Postgres unreachable";
  }
};

// `reachable()` now returns the REASON, so the gate is the value itself — a `!skip` here would
// invert it and skip exactly when the corpus is fine.
const skip = await reachable();
reportSkip(import.meta.url, skip);
// ⚠ UNCONDITIONAL, like 224 of the 231 siblings. A guard here reads as leak-avoidance and is
// dead code twice over: Vitest does not run a file-level `afterAll` when every test is skipped
// (measured), and `end()` is `if (pool) …` — a no-op when no pool was ever opened, and
// idempotent besides. A guard keyed on the reason STRING would also stop matching the moment
// somebody rewords it, silently.
afterAll(async () => {
  await end();
});

test.skipIf(skip)(
  "the committed roster's published roles agree with the declarants' own filings",
  async () => {
    // Dry run: reads only. `--allow-partial` is deliberately NOT passed — a corpus whose
    // declarations are a different vintage from its shard tree cannot answer this question,
    // and the restamp's own 95% floor throws with that diagnosis rather than letting the
    // assertion pass on rows nobody checked.
    const pending = await restampRoles(false);
    assert.equal(
      pending,
      0,
      `${pending} municipal official(s) have a published role that disagrees with their own ` +
        "filed position. Either the ingest stopped applying scripts/officials/role_reconcile.ts, " +
        "or the rule changed since the corpus was stamped. Re-derive with " +
        "`npx tsx scripts/officials/restamp_roles.ts --apply`, then re-emit the shards and " +
        "reload — the command list is in that file's header.",
    );
  },
);
