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
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const read = (rel: string): string =>
  readFileSync(path.join(ROOT, rel), "utf8");

describe("148_person_company_basis is applied wherever its dependents are", () => {
  // 082 (`person_by_slug`, a LANGUAGE sql body) and 120 (a matview body) both read
  // `person_company_bridge_a`, and both are resolved at CREATE time — so applying either to a
  // database without 148 raises 42P01 and takes the whole file with it. For 120 that is worse
  // than a failed apply: 090's `DROP … CASCADE` has already removed person_browse_table by
  // then, so /persons is left pointing at a missing relation.
  //
  // ⚠️ THE APPLIER SET IS DERIVED, NOT LISTED, and that is the whole point of this gate. Its
  // first version named the two appliers by hand and shipped green while a THIRD —
  // load_declarations_pg.ts, which re-applies 120 on every `--resolve` — had no 148 line at
  // all. A hand-written list encodes the same incomplete belief the bug came from.
  const MIGRATION = "148_person_company_basis.sql";
  const DEPENDENTS = ["082_person_api.sql", "120_person_browse.sql"];

  // Files that name a migration inside a STRING LITERAL are applying it; prose comments in
  // these modules refer to migrations by number ("120's matview body"), not by quoted
  // filename, so this does not sweep them in.
  const quoted = (file: string, migration: string): number =>
    file.search(new RegExp(`["'][^"']*${migration.replace(".", "\\.")}["']`));

  const tsFiles = (dir: string): string[] =>
    readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) =>
      e.isDirectory()
        ? tsFiles(path.join(dir, e.name))
        : e.name.endsWith(".ts") && !e.name.endsWith(".test.ts")
          ? [path.join(dir, e.name)]
          : [],
    );

  for (const dependent of DEPENDENTS) {
    it(`every module applying ${dependent} applies ${MIGRATION} first`, () => {
      const appliers = tsFiles("scripts").filter(
        (f) => quoted(read(f), dependent) >= 0,
      );
      expect(
        appliers.length,
        `no module applies ${dependent} — the detector has stopped finding appliers`,
      ).toBeGreaterThan(0);

      const broken = appliers.filter((f) => {
        const src = read(f);
        const at148 = quoted(src, MIGRATION);
        return at148 < 0 || at148 > quoted(src, dependent);
      });
      expect(
        broken,
        `these modules apply ${dependent} without applying ${MIGRATION} before it — ` +
          `${dependent} reads person_company_bridge_a and is resolved at CREATE time, so ` +
          `they raise 42P01 on any database where 148 has not run by hand`,
      ).toEqual([]);
    });
  }
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
