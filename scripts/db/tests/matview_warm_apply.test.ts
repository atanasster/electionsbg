// The MIRROR IMAGE of migration_drop_dependents.data.test.ts.
//
// That gate catches "a migration DESTROYS an object another migration owns". This one catches
// the inverse: **a migration CREATES an object in a form that can only ever apply to a fresh
// database.** `CREATE MATERIALIZED VIEW IF NOT EXISTS x` is a no-op the moment `x` exists, so
// unless something drops it, an edit to its body reaches a fresh clone and NOTHING else —
// while every loader that `REFRESH`es it keeps reporting a current timestamp and current row
// counts over the old definition. No row count moves. No error is raised anywhere.
//
// ══════════════════════════════════════════════════════════════════════════════════════
// WHY THIS EXISTS. Four matviews over the TR tables — officer_name_counts (008),
// owner_name_counts (019), company_person_roles (022), company_officer_counts (071) — were
// declared IF NOT EXISTS and propagated anyway, BY ACCIDENT: 003_tr_search.sql's
// `DROP TABLE … CASCADE` deleted them on every db:load:tr:pg, and the loader re-applies
// 008/019/022 later in the same run. Removing that CASCADE (it was also deleting three
// matviews nothing recreated) took the accident away and would have frozen all four bodies on
// every warm database, prod included. Caught in review of that commit, 2026-08-10.
//
// The lesson generalises past those four, which is why this is a rule and not four fixes: an
// accidental recreate path is not a design, and nothing was watching whether one existed.
//
// PURE TEXT, no database — deliberately. It has to fail on the machine of whoever edits the
// DDL, before any load, and the question it asks ("CAN this file's body ever reach a warm
// database?") is answerable from the file alone.
//
// A definition-drift check is a DIFFERENT question ("has it drifted YET?"), needs a database,
// and does not replace this one. When you do need it — auditing a KNOWN entry below, or
// checking prod after a body edit — the way to ask it is: rebuild the file's body as a
// throwaway probe matview and compare `pg_get_viewdef` of probe and deployed. Both sides then
// go through Postgres's own re-printer, so no hand-written normaliser is involved. (An earlier
// draft of this header called such a check infeasible for exactly that normaliser reason; the
// probe technique is the answer to it, and the audit recorded below used it.)
// ══════════════════════════════════════════════════════════════════════════════════════

import { test } from "vitest";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "../lib/paths";

const SCHEMA_DIR = path.join(REPO_ROOT, "scripts/db/schema/pg");

/**
 * Matviews declared `IF NOT EXISTS` with no DROP in their own file, and WHY that is accepted.
 *
 * EVERY entry here is by-design, and exactly one shape qualifies: a FIXED one-row wrapper over
 * a `CREATE OR REPLACE` function. The body is a single `SELECT fn(…)` with no reason to change,
 * and the logic that does change lives in the function, which propagates on every apply.
 * Dropping such a wrapper buys nothing and, for 077, actively broke a loader.
 *
 * That invariant is structural rather than per-entry: there is no `kind` discriminator, because
 * a single-variant field no assertion reads is noise. A genuinely different justification — say
 * "another file recreates it on the same path" — should arrive WITH the assertion that checks
 * it, not as a second string nothing branches on.
 *
 * The five entries this list started with (2026-08-10) were split by SHAPE, not syntax. Three
 * were real aggregate bodies — awarder_totals (017), sector_contractor_stats (018),
 * agri_beneficiary (046) — full of rules that exist because a previous spelling was wrong, i.e.
 * exactly the changes that must propagate. Each now DROPs above its CREATE and has left this
 * list. The two below are wrappers, and the earlier draft of this file mislabelled
 * procurement_by_settlement_cache "unreviewed" only because it grouped on the syntax.
 *
 * Before any of that, all five were checked for ACTUAL drift against both the local database
 * and Cloud SQL, by rebuilding each file's body as a throwaway probe matview and comparing
 * `pg_get_viewdef` of both (so each side goes through Postgres's own re-printer, which is what
 * makes a definition comparison possible at all). All five were in sync: the defect was latent
 * everywhere, never live.
 *
 * A NEW matview must not join this list without meeting the wrapper test above.
 */
const KNOWN: Record<string, { why: string }> = {
  dual_corpus_rankings_cache: {
    why:
      "077 deliberately DROPs nothing — its DROP turned every db:load:pg into a 2BP01 " +
      "once 145 read the cache (see dual_corpus_dependents.data.test.ts, which asserts " +
      "the file text stays DROP-free). It is a fixed one-column wrapper over a function " +
      "whose body CREATE OR REPLACE rewrites in place, and 077's header documents the " +
      "one-time manual DROP for the only change that needs it (a return-type change).",
  },
  procurement_by_settlement_cache: {
    why:
      "030, and structurally the SAME shape as dual_corpus_rankings_cache above: its whole " +
      "body is `SELECT procurement_by_settlement(NULL, NULL) AS r`, one row, over a " +
      "CREATE OR REPLACE function that carries every rule and propagates on every apply. " +
      "A frozen one-liner with nothing in it to freeze. Reclassified from 'unreviewed' " +
      "2026-08-10 after review: the first draft grouped it with the real aggregate bodies " +
      "because they share a keyword, not because they share a risk.",
  },
};

type Decl = {
  file: string;
  name: string;
  /** Declared `CREATE MATERIALIZED VIEW IF NOT EXISTS`, rather than the plain form. */
  ifNotExists: boolean;
  dropped: boolean;
};

// BOTH forms are collected. Matching only `IF NOT EXISTS` left this gate watching 4 of ~38
// declarations in the tree — and, worse, a matview LEFT its field of view the moment someone
// fixed it, which is the opposite of what a regression guard should do: the three unfrozen by
// 27e1c8bd2f became invisible here at the instant they gained their DROP.
const declarations = (): Decl[] => {
  const out: Decl[] = [];
  for (const f of readdirSync(SCHEMA_DIR).filter((n) => n.endsWith(".sql"))) {
    const code = readFileSync(path.join(SCHEMA_DIR, f), "utf8")
      .split("\n")
      .map((l) => l.replace(/--.*$/, ""))
      .join("\n");
    for (const m of code.matchAll(
      /CREATE\s+MATERIALIZED\s+VIEW\s+(IF\s+NOT\s+EXISTS\s+)?(?:public\.)?([a-z0-9_]+)/gi,
    )) {
      const name = m[2] as string;
      out.push({
        file: f,
        name,
        ifNotExists: Boolean(m[1]),
        dropped: new RegExp(
          `^\\s*DROP\\s+MATERIALIZED\\s+VIEW\\s+(?:IF\\s+EXISTS\\s+)?(?:public\\.)?${name}\\b`,
          "im",
        ).test(code),
      });
    }
  }
  return out;
};

test("no matview is declared IF NOT EXISTS unless something re-creates it", () => {
  const offences = declarations()
    .filter((d) => d.ifNotExists && !d.dropped && !KNOWN[d.name])
    .map((d) => `${d.file}: ${d.name}`);

  assert.deepStrictEqual(
    offences,
    [],
    "These matviews are `CREATE MATERIALIZED VIEW IF NOT EXISTS` and nothing in their own " +
      "file drops them, so the CREATE is a no-op on every warm database: an edit to the body " +
      "reaches a fresh clone and NOTHING else, while any loader REFRESHing it reports a " +
      "current timestamp over the old definition. Add `DROP MATERIALIZED VIEW IF EXISTS " +
      "<name>;` immediately above the CREATE in the same file (NOT CASCADE, and NOT from a " +
      "loader — see 008_connections.sql for the worked example and " +
      "migration_drop_dependents.data.test.ts for why the drop must ride the same path as " +
      "the create). If it genuinely must not drop, add it to KNOWN here WITH its reason.\n  " +
      offences.join("\n  "),
  );
});

test("every plain CREATE MATERIALIZED VIEW is dropped in its own file", () => {
  // The other half, and a different failure entirely — which is why it gets its own message.
  // A plain CREATE with no DROP cannot be by-design: it simply cannot apply twice, so KNOWN
  // does not excuse it. It fails LOUDLY with 42P07 rather than silently freezing…
  //
  // …but it fails at APPLY time, in the middle of db:refresh's 57-link `&&` chain whose only
  // verification is its last step. That is the exact shape of the 2BP01 that blocked every
  // procurement publish for a day (CLAUDE.md, "CASCADE is never the way out"): loud, and still
  // discovered hours later by whoever runs the chain rather than by whoever deleted the line.
  // A pure-text gate fails on the editor's machine instead, which is this file's whole purpose.
  const offences = declarations()
    .filter((d) => !d.ifNotExists && !d.dropped)
    .map((d) => `${d.file}: ${d.name}`);

  assert.deepStrictEqual(
    offences,
    [],
    "These matviews are created with a plain `CREATE MATERIALIZED VIEW` and their own file " +
      "never drops them, so the file cannot be applied twice — the second apply dies with " +
      "42P07 partway through whichever loader owns it. Restore the `DROP MATERIALIZED VIEW " +
      "IF EXISTS <name>;` above the CREATE.\n  " +
      offences.join("\n  "),
  );
});

test("KNOWN carries no entry that has since been fixed", () => {
  // The list is only honest if every entry is still real. A name that has gained its DROP —
  // or disappeared — must leave, or KNOWN becomes a place where a new instance can hide
  // behind a name that no longer means anything. Same argument as person_reload_locks'
  // ALLOWED.
  // Three ways an entry stops being real, and the third only became possible once this file
  // started collecting the plain form too: an entry rewritten to `CREATE MATERIALIZED VIEW`
  // is no longer excused by KNOWN at all (the plain-form test above owns it), so leaving it
  // listed would claim a justification nothing consults.
  const live = new Map(declarations().map((d) => [d.name, d]));
  const stale = Object.keys(KNOWN)
    .filter((n) => {
      const d = live.get(n);
      return !d || d.dropped || !d.ifNotExists;
    })
    .map((n) => {
      const d = live.get(n);
      if (!d) return `${n} (no such matview)`;
      if (d.dropped) return `${n} (now DROPs — remove it)`;
      return `${n} (no longer IF NOT EXISTS — remove it)`;
    });

  assert.deepStrictEqual(
    stale,
    [],
    `KNOWN is stale — drop these entries:\n  ${stale.join("\n  ")}`,
  );
});
