// Two text-level gates on the person schema, both closing defects this repo has actually
// shipped rather than hypothetical ones. Plan: docs/plans/tr-attribution-basis-v1.md.
//
// A `.test.ts`, NOT a `.data.test.ts`, for the reason grant_role_guard.test.ts gives: the
// `.data` suffix auto-skips when Postgres is down, which on CI means always, and a gate whose
// job is to stop a pattern reappearing must not be able to skip. Neither assertion needs a
// database — they read the files.
//
//   npm run test:unit

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const read = (rel: string): string =>
  readFileSync(path.join(ROOT, rel), "utf8");

/** The migration filenames a module's SCHEMA_FILES array lists, in apply order.
 *
 *  Parsed from the array literal rather than by `indexOf` over the whole file: both of these
 *  modules name migrations in prose comments long before the list (`load_persons_browse_pg`
 *  does it on line 1), so a naive index comparison reports the order of the DOCUMENTATION and
 *  passes or fails for reasons that have nothing to do with what is applied. */
const schemaFileOrder = (rel: string): string[] => {
  const src = read(rel);
  const open = src.indexOf("SCHEMA_FILES = [");
  if (open < 0) return [];
  const close = src.indexOf("];", open);
  const block = src.slice(open, close);
  // The two modules spell entries differently — the resolver lists bare filenames, the
  // browse loader path.join()s a repo-relative path — so the prefix is optional.
  return [
    ...block.matchAll(/["'](?:[^"']*\/)?(\d{3}_[a-z0-9_]+\.sql)["']/g),
  ].map((m) => m[1]);
};

describe("148_person_company_basis has automated appliers", () => {
  // The objects 148 creates are READ by 082 (person_by_slug's per-company linkBasis) and by
  // 120 (its bridge_a). Both are LANGUAGE-sql / matview bodies resolved at CREATE time, so a
  // database where 148 never ran fails those files with 42P01 rather than degrading. When
  // this was first written 148 had NO applier at all — its own header claimed two that did
  // not reference it — and nothing in the suite noticed, because every other db test asks a
  // different question.
  const MIGRATION = "148_person_company_basis.sql";

  it("is applied by the resolver, before 082", () => {
    const order = schemaFileOrder("scripts/person/resolve_persons.ts");
    expect(order).toContain(MIGRATION);
    // Order matters as much as presence: 082's body reads the view.
    expect(order.indexOf(MIGRATION)).toBeLessThan(
      order.indexOf("082_person_api.sql"),
    );
  });

  it("is applied by the persons-browse loader, before 120", () => {
    const order = schemaFileOrder("scripts/db/load_persons_browse_pg.ts");
    expect(order).toContain(MIGRATION);
    expect(order.indexOf(MIGRATION)).toBeLessThan(
      order.indexOf("120_person_browse.sql"),
    );
  });
});

describe("081 takes no unguarded exclusive lock on a served person table", () => {
  // `person` and `person_role` are on the serving path — person_by_slug opens with a SELECT
  // on `person`, and /person, /persons and /connections all reach it. `exec()` sends a
  // migration as ONE transaction, so an AccessExclusiveLock taken anywhere in 081 is held to
  // COMMIT, and every reader arriving behind it queues even where they would not have
  // conflicted with each other. Measured 2026-08-10 while building the date_basis block:
  // eight readers stacked behind one ALTER. 081 is also applied by add_override.ts, an
  // operator action against a running database.
  //
  // So every ALTER TABLE on those two must either be catalog-only (ADD COLUMN IF NOT EXISTS,
  // no default, no scan) or sit inside a DO block that skips in the steady state AND sets a
  // lock_timeout so it fails fast instead of heading the queue. This gate is the cheap 80%:
  // it cannot prove the guard is CORRECT, only that a bare ALTER did not creep back in.
  //
  // VALIDATE CONSTRAINT is exempt and must stay exempt: it takes a ShareUpdateExclusiveLock,
  // which readers do not contend with, and it is deliberately placed OUTSIDE the guards so a
  // run that timed out mid-way still converges. Requiring it to be guarded would push the row
  // scan back under the exclusive lock — the opposite of what this rule is for.
  const SERVED = /^ALTER TABLE (person|person_role)\b/;
  const SAFE =
    /^ALTER TABLE (person|person_role) (ADD COLUMN IF NOT EXISTS |VALIDATE CONSTRAINT )/;

  /** Every ALTER on a served person table that is neither catalog-only nor guarded.
   *  Takes the SQL as an argument so the discrimination test below can run the REAL
   *  detector over a mutated file, rather than re-implementing it and proving nothing. */
  const unguardedAlters = (sql: string): string[] => {
    const lines = sql.split("\n");

    // DO-block spans carrying BOTH defences; an ALTER inside one is exempt.
    const guarded: Array<[number, number]> = [];
    let start = -1;
    let body = "";
    lines.forEach((line, i) => {
      if (/^DO \$\$/.test(line)) {
        start = i;
        body = "";
      }
      if (start >= 0) body += line + "\n";
      if (/^END \$\$;/.test(line) && start >= 0) {
        if (
          /THEN RETURN; END IF;/.test(body) &&
          /SET LOCAL lock_timeout/.test(body)
        )
          guarded.push([start, i]);
        start = -1;
      }
    });
    const isGuarded = (i: number): boolean =>
      guarded.some(([a, b]) => i >= a && i <= b);

    return lines.flatMap((line, i) => {
      const trimmed = line.trim();
      if (!SERVED.test(trimmed) || SAFE.test(trimmed) || isGuarded(i))
        return [];
      return [`${i + 1}: ${trimmed}`];
    });
  };

  const SQL = "scripts/db/schema/pg/081_person_identity.sql";

  it("every ALTER is catalog-only or inside a guarded, lock_timeout'd DO block", () => {
    expect(
      unguardedAlters(read(SQL)),
      "an unguarded ALTER TABLE on a table /person reads — wrap it in a DO block that " +
        "RETURNs early in the steady state and SETs LOCAL lock_timeout, and add any CHECK " +
        "as NOT VALID so the scan is not held under the lock (see the date_basis block)",
    ).toEqual([]);
  });

  it("still discriminates — the same detector catches a bare ALTER", () => {
    // Without this, the assertion above is satisfied by any detector that matches nothing.
    // Both mutations must be caught: a bare constraint add, and one placed inside a DO block
    // that has a guard but NO lock_timeout (the half-defence that looks safe on review).
    const bare = unguardedAlters(
      read(SQL) + "\nALTER TABLE person ADD CONSTRAINT sneaky CHECK (true);\n",
    );
    expect(bare).toHaveLength(1);
    expect(bare[0]).toContain("sneaky");

    const halfGuarded = unguardedAlters(
      read(SQL) +
        [
          "",
          "DO $$",
          "BEGIN",
          "  IF EXISTS (SELECT 1) THEN RETURN; END IF;",
          "ALTER TABLE person ADD CONSTRAINT half CHECK (true);",
          "END $$;",
        ].join("\n"),
    );
    expect(halfGuarded).toHaveLength(1);
    expect(halfGuarded[0]).toContain("half");
  });
});
