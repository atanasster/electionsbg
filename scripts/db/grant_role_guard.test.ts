// Every GRANT in scripts/db/schema/pg/ is role-guarded.
//
// Plan: docs/plans/grant-role-guard-sweep-v1.md (§7). Without this the sweep decays — the
// next migration is written against its neighbours, and 34 files' worth of bare-GRANT
// precedent is what a new file would have copied.
//
// WHAT A BARE GRANT COSTS. `exec()` sends a migration as ONE implicit transaction, so on a
// cluster where nothing has created `app_readonly` a bare GRANT raises 42704 and rolls the
// whole file back — every table, index, view and function above it — and the loader dies.
// Measured: `db:refresh` on a fresh clone died at `db:load:pg` applying 017.
//
// A `.test.ts`, NOT a `.data.test.ts`, and that is the point rather than an accident. The
// `.data` suffix auto-skips when Postgres is down, which on CI means always — a gate whose
// job is to stop a text pattern reappearing must not be able to skip. It needs no database:
// it reads the files.
//
//   npm run test:unit

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCHEMA_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "schema/pg",
);

/**
 * `roles_readonly.sql` is the ONE file allowed bare GRANTs, and the exemption is not a
 * convenience: it CREATEs `app_readonly` two statements above them, so guarding those grants
 * on "does the role exist" would be a tautology that also made the file unable to bootstrap
 * anything. Every other file must be guarded.
 */
const EXEMPT = new Set(["roles_readonly.sql"]);

/** The role every guard must actually name. Checking for the TOKEN `pg_roles` is not enough
 *  — see `guardTestsForRole`. */
const ROLE = "app_readonly";

/**
 * Blank out `--` and block comments, PRESERVING every newline so line numbers survive.
 *
 * Not optional, and not defensive: `000_search_fns.sql:164` contains the text `DO $$ … $$`
 * inside a prose comment describing the guard idiom. Parsed raw, that comment OPENS a guard
 * region which then runs to the next real `END $$;` and exempts every GRANT in between — a
 * false negative in the exact file this sweep touched most.
 *
 * `bootstrap_roles.ts` exports a `stripSqlComments` for the same corpus, deliberately not
 * reused here: it collapses a block comment to a single space, which is right for its caller
 * (it only needs the surviving tokens) and wrong for this one, which reports line numbers.
 */
const blankComments = (src: string): string => {
  const keepNewlines = (s: string): string => s.replace(/[^\n]/g, " ");
  return src
    .replace(/\/\*[\s\S]*?\*\//g, keepNewlines)
    .replace(/--[^\n]*/g, keepNewlines);
};

/**
 * A guard region only counts if it actually tests for THIS role. Two accepted proofs:
 *
 *  - it probes `pg_roles` for the literal role name, or
 *  - it handles `undefined_object`, the SQLSTATE a missing role raises (080's idiom).
 *
 * Requiring the literal name rather than the bare token `pg_roles` closes the worst failure
 * this gate can have: a typo'd `rolname = 'app_readnoly'` is a guard that can NEVER fire, so
 * the GRANT silently never happens — which the plan calls out as strictly worse than no guard
 * at all, because it trades a loud 42704 at apply time for a silent 42501 at serving time.
 * Free to require: all 48 existing probes already spell it.
 */
const guardTestsForRole = (block: string): boolean =>
  new RegExp(`pg_roles[\\s\\S]*?rolname\\s*=\\s*'${ROLE}'`, "i").test(block) ||
  /undefined_object/i.test(block);

/**
 * The THREE accepted guard idioms. All three are in the tree, all three are correct, and a
 * gate that recognised only the first would fail 12 correct files — which is exactly how
 * somebody ends up "fixing" working SQL to silence a test.
 *
 *  1. `DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles …) THEN … END IF; END $$;`
 *     — the 117/130 shape, used at the top level of a migration.
 *  2. `IF EXISTS (SELECT 1 FROM pg_roles …) THEN … END IF;` inside a plpgsql body
 *     — for a GRANT that runs when a function is CALLED (000, 112, 138, 139).
 *  3. `DO $$ BEGIN … EXCEPTION WHEN undefined_object THEN NULL; END $$;`
 *     — 080's shape, matched by (1)'s region plus `guardTestsForRole`'s second arm. Sound,
 *     and TESTED rather than assumed: a missing ROLE raises 42704 undefined_object and is
 *     caught, while a typo'd RELATION raises 42P01 undefined_table and still propagates. It
 *     was reported as swallowing typos; it does not.
 */
const GUARD_REGIONS: RegExp[] = [
  // Dollar tag captured and BACK-REFERENCED. A bare `END\s*\$\$` also matches the `$$` that
  // closes a `$fn$`-quoted body or a nested `END; $$;`, letting one lazy match span from a
  // real guard to some unrelated block far below and exempt everything between.
  /DO\s+(\$[A-Za-z_]*\$)[\s\S]*?END\s*;?\s*\1\s*;/g,
  // The plpgsql form, for a GRANT that runs when a function is CALLED.
  // KNOWN LIMIT: stops at the first `END IF;`, so a guard containing a NESTED conditional
  // reports its inner GRANTs as bare. No file does that today. If one ever does, fix this
  // pattern — do not unwrap the SQL to silence it.
  /IF\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+pg_roles[\s\S]*?END\s+IF\s*;/gi,
];

/** Line numbers (0-based) covered by an accepted guard. */
const guardedLines = (src: string): Set<number> => {
  const covered = new Set<number>();
  for (const re of GUARD_REGIONS) {
    for (const m of src.matchAll(re)) {
      if (!guardTestsForRole(m[0])) continue;
      // Exclusive upper bound. An inclusive one over-covers by a line, which silently
      // exempts a bare GRANT sitting immediately after a guarded block — the shape 033
      // actually had. Caught by the non-vacuity case below, not by any real file.
      const start = src.slice(0, m.index).split("\n").length - 1;
      const lines = m[0].split("\n").length;
      for (let i = start; i < start + lines; i++) covered.add(i);
    }
  }
  return covered;
};

/** Every unguarded GRANT in `src`, as [line number (1-based), text].
 *
 *  Both the guard scan and the GRANT scan run over the COMMENT-BLANKED source, so a GRANT
 *  discussed in prose is neither reported nor able to open a fake guard. Reported text comes
 *  from the original line, so the message shows what the author actually wrote. */
export const bareGrants = (src: string): Array<[number, string]> => {
  const clean = blankComments(src);
  const covered = guardedLines(clean);
  const original = src.split("\n");
  return clean
    .split("\n")
    .map((line, i): [number, string] => [i + 1, line])
    .filter(([i, line]) => /\bGRANT\b/.test(line) && !covered.has(i - 1))
    .map(([i]): [number, string] => [i, original[i - 1]]);
};

const files = readdirSync(SCHEMA_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort();

describe("every GRANT in schema/pg is role-guarded", () => {
  it("is actually checking GRANT-bearing files", () => {
    // The floor that matters is how many files CARRY a grant (49 today), not how many exist
    // (148) — the latter stays healthy while a refactor moves every grant out of reach, and
    // this suite would go green having checked nothing. A moved directory needs no assertion:
    // readdirSync throws.
    const withGrants = files.filter((f) =>
      /\bGRANT\b/.test(readFileSync(path.join(SCHEMA_DIR, f), "utf8")),
    );
    expect(withGrants.length).toBeGreaterThan(40);
  });

  for (const f of files) {
    if (EXEMPT.has(f)) continue;
    it(f, () => {
      const bare = bareGrants(readFileSync(path.join(SCHEMA_DIR, f), "utf8"));
      expect(
        bare.map(([n, l]) => `${f}:${n}: ${l.trim()}`),
        `bare GRANT(s) in ${f}. exec() sends a migration as ONE implicit transaction, so on ` +
          `a cluster without app_readonly this raises 42704 and rolls the WHOLE FILE back. ` +
          `Wrap it:\n` +
          `  DO $$ BEGIN\n` +
          `    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN\n` +
          `      <the GRANT>\n` +
          `    END IF;\n` +
          `  END $$;\n` +
          `Inside a plpgsql body, use the bare IF EXISTS form instead. See ` +
          `docs/plans/grant-role-guard-sweep-v1.md.`,
      ).toEqual([]);
    });
  }
});

describe("the detector is not vacuous", () => {
  // Without these, a parser bug that matches nothing turns the whole suite above green
  // forever and reads as success. Each case is a shape that actually occurs in the tree.
  it("flags a bare top-level GRANT", () => {
    expect(bareGrants(`GRANT SELECT ON t TO app_readonly;`)).toHaveLength(1);
  });

  it("flags a bare GRANT sitting after a guarded one in the same file", () => {
    // 033's real shape before Tier 1: one guarded grant and one bare, which is how a file
    // ends up implying the guard is optional.
    const src = `DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    GRANT SELECT ON a TO app_readonly;
  END IF;
END $$;
GRANT SELECT ON b TO app_readonly;`;
    expect(bareGrants(src).map(([n]) => n)).toEqual([6]);
  });

  it("does NOT flag the DO-block guard", () => {
    expect(
      bareGrants(`DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    GRANT SELECT ON t TO app_readonly;
  END IF;
END $$;`),
    ).toEqual([]);
  });

  it("does NOT flag the plpgsql IF form inside a function body", () => {
    expect(
      bareGrants(`CREATE FUNCTION f() RETURNS void AS $fn$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN
    EXECUTE 'GRANT SELECT ON t TO app_readonly';
  END IF;
END; $fn$ LANGUAGE plpgsql;`),
    ).toEqual([]);
  });

  it("does NOT flag 080's EXCEPTION idiom, whose handler FOLLOWS the statements", () => {
    // The false positive a backwards-lookback parser produces, reproduced during review.
    // If this case ever starts failing, fix the PARSER — do not "fix" 080, which is correct:
    // a missing role raises 42704 undefined_object and is caught; a typo'd relation raises
    // 42P01 undefined_table and still propagates.
    expect(
      bareGrants(`DO $$ BEGIN
  EXECUTE 'GRANT SELECT ON a TO app_readonly';
  EXECUTE 'GRANT SELECT ON b TO app_readonly';
EXCEPTION WHEN undefined_object THEN NULL; END $$;`),
    ).toEqual([]);
  });

  it("DOES flag a DO block that wraps a GRANT without testing for the role", () => {
    // A wrapper is not a guard. This is the plausible-looking edit that would otherwise
    // sail through and reintroduce the 42704.
    expect(
      bareGrants(`DO $$ BEGIN
  GRANT SELECT ON t TO app_readonly;
END $$;`),
    ).toHaveLength(1);
  });

  it("ignores a commented-out GRANT", () => {
    expect(bareGrants(`-- GRANT SELECT ON t TO app_readonly;`)).toEqual([]);
  });

  // ---- false negatives found by adversarial review, each verified against the real tree ----

  it("is not fooled by `DO $$` appearing inside a prose comment", () => {
    // 000_search_fns.sql:164 contains this text today. Unblanked, the comment opens a guard
    // region that runs to the next real `END $$;` and exempts everything between.
    const src = [
      "-- takes the plpgsql IF rather than the DO $$ … $$ wrapper used at the",
      "GRANT SELECT ON t TO app_readonly;",
      "DO $$ BEGIN",
      "  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readonly') THEN",
      "    GRANT SELECT ON u TO app_readonly;",
      "  END IF;",
      "END $$;",
    ].join("\n");
    expect(bareGrants(src).map(([n]) => n)).toEqual([2]);
  });

  it("is not fooled by a GRANT inside a block comment", () => {
    expect(bareGrants(`/*\nGRANT SELECT ON t TO app_readonly;\n*/`)).toEqual(
      [],
    );
  });

  it("reports the right LINE after blanking a multi-line block comment", () => {
    // Blanking must preserve newlines, or every line number after a block comment is wrong.
    expect(
      bareGrants(`/* one\ntwo */\nGRANT SELECT ON t TO app_readonly;`).map(
        ([n]) => n,
      ),
    ).toEqual([3]);
  });

  it("REJECTS a guard whose role name is misspelled", () => {
    // The worst thing this gate can wave through: a guard that can never fire, so the GRANT
    // silently never happens. Trades a loud 42704 at apply time for a silent 42501 at
    // serving time — strictly worse than the bare form it replaced.
    const src = [
      "DO $$ BEGIN",
      "  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_readnoly') THEN",
      "    GRANT SELECT ON t TO app_readonly;",
      "  END IF;",
      "END $$;",
    ].join("\n");
    expect(bareGrants(src)).toHaveLength(1);
  });

  it("does not let a $fn$ body's closing $$ terminate a guard region early", () => {
    // A bare `END\s*\$\$` also matches the close of a dollar-tagged body, which let one lazy
    // match span from a real guard down to an unrelated block and exempt everything between.
    const src = [
      "CREATE FUNCTION f() RETURNS void AS $fn$ BEGIN",
      "  PERFORM 1;",
      "END; $fn$ LANGUAGE plpgsql;",
      "GRANT SELECT ON t TO app_readonly;",
    ].join("\n");
    expect(bareGrants(src).map(([n]) => n)).toEqual([4]);
  });
});
