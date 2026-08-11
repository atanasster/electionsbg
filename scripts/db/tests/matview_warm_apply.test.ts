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
// DDL, before any load, and the question it asks ("can this file's body ever reach a warm
// database?") is answerable from the file alone. A definition-drift check against
// pg_matviews.definition would be strictly weaker: Postgres re-prints stored SQL in its own
// normal form, so any comparison would need a normaliser that itself drifts.
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
 * Every entry is a body that cannot change on a warm database. Two kinds:
 *
 *   "by-design"  — the file documents why it must not drop, and carries an escape hatch.
 *   "unreviewed" — pre-existing, found when this gate was written, NOT audited. Listed so the
 *                  class is visible rather than silently tolerated. Each is a latent instance
 *                  of the defect above; removing one means either adding the DROP or proving
 *                  another path recreates it.
 *
 * A NEW matview must not join this list without a reason of the first kind.
 */
const KNOWN: Record<string, { kind: "by-design" | "unreviewed"; why: string }> =
  {
    dual_corpus_rankings_cache: {
      kind: "by-design",
      why:
        "077 deliberately DROPs nothing — its DROP turned every db:load:pg into a 2BP01 " +
        "once 145 read the cache (see dual_corpus_dependents.data.test.ts, which asserts " +
        "the file text stays DROP-free). It is a fixed one-column wrapper over a function " +
        "whose body CREATE OR REPLACE rewrites in place, and 077's header documents the " +
        "one-time manual DROP for the only change that needs it (a return-type change).",
    },
    awarder_totals: {
      kind: "unreviewed",
      why: "017. Pre-existing; found 2026-08-10 when this gate was written. Not audited.",
    },
    sector_contractor_stats: {
      kind: "unreviewed",
      why: "018. Pre-existing; found 2026-08-10 when this gate was written. Not audited.",
    },
    procurement_by_settlement_cache: {
      kind: "unreviewed",
      why: "030. Pre-existing; found 2026-08-10 when this gate was written. Not audited.",
    },
    agri_beneficiary: {
      kind: "unreviewed",
      why: "046. Pre-existing; found 2026-08-10 when this gate was written. Not audited.",
    },
  };

type Decl = { file: string; name: string; dropped: boolean };

const declarations = (): Decl[] => {
  const out: Decl[] = [];
  for (const f of readdirSync(SCHEMA_DIR).filter((n) => n.endsWith(".sql"))) {
    const code = readFileSync(path.join(SCHEMA_DIR, f), "utf8")
      .split("\n")
      .map((l) => l.replace(/--.*$/, ""))
      .join("\n");
    for (const m of code.matchAll(
      /CREATE\s+MATERIALIZED\s+VIEW\s+IF\s+NOT\s+EXISTS\s+(?:public\.)?([a-z0-9_]+)/gi,
    )) {
      const name = m[1] as string;
      out.push({
        file: f,
        name,
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
    .filter((d) => !d.dropped && !KNOWN[d.name])
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

test("KNOWN carries no entry that has since been fixed", () => {
  // The list is only honest if every entry is still real. A name that has gained its DROP —
  // or disappeared — must leave, or KNOWN becomes a place where a new instance can hide
  // behind a name that no longer means anything. Same argument as person_reload_locks'
  // ALLOWED.
  const live = new Map(declarations().map((d) => [d.name, d]));
  const stale = Object.keys(KNOWN)
    .filter((n) => !live.has(n) || live.get(n)?.dropped)
    .map((n) =>
      live.has(n) ? `${n} (now DROPs — remove it)` : `${n} (no such matview)`,
    );

  assert.deepStrictEqual(
    stale,
    [],
    `KNOWN is stale — drop these entries:\n  ${stale.join("\n  ")}`,
  );
});
