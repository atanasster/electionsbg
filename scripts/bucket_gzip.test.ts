// Nothing bucket_gzip.ts uploads may be a path `bucket:sync` excludes.
//
// WHY THIS EXISTS. An exclusion in `bucket_sync_paths.ts` stops the RSYNC and nothing else.
// `gsutil cp -Z` takes no -x, and `bucket:gz` runs AFTER the sync (see bucket_sync_paths'
// ORDERING note), so a retired artifact left in this file's upload set is re-published on
// every run — gzipped, with a fresh Cache-Control, looking perfectly healthy. There is no
// symptom: the object simply never goes away, and the next person to check the bucket
// concludes the retirement never happened.
//
// The file's own comments name that trap twice (the `connections-search.json` and
// `officials/municipal/search_index.json` removals both record having to delete from HERE as
// well as from the rsync list). Nothing enforced it until now.
//
// READS THE SOURCE rather than importing the module, for two reasons: `bucket_gzip.ts` has
// zero exports, and it calls `run()` at module scope — importing it would start an upload.
// `scripts/parliament/derived/upload_coverage.test.ts` established this pattern in the repo
// for the same reason; see its header.

import { describe, expect, test } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { isExcluded } from "./bucket_sync_paths";

const SRC = readFileSync("scripts/bucket_gzip.ts", "utf8");

/** Quoted entries of a `const <name> = [ … ];` array literal in the source. */
const arrayLiteral = (name: string): string[] => {
  const body = new RegExp(`const ${name} = \\[([\\s\\S]*?)\\n\\];`).exec(SRC);
  if (!body) return [];
  return [...body[1].matchAll(/^\s*"([^"]+)",/gm)].map((m) => m[1]);
};

const GLOBAL_FILES = arrayLiteral("GLOBAL_FILES");
const PER_ELECTION_FILES = arrayLiteral("PER_ELECTION_FILES");

/**
 * Directory prefixes the collector walks wholesale. These never appear in a quoted array, so
 * they are listed here and pinned to the source below — a tree added to `collect()` without
 * a matching entry here would otherwise escape the exclusion check entirely.
 *
 * EMPTY since json-retirement-v2 Tier 1 (2026-08-22): `parliament/votes/sessions` was the only
 * member, and `collect()` no longer walks it. Per this file's own rule, a pinned directory the
 * collector has stopped walking is dead config, so it is removed rather than left to rot.
 *
 * ⚠️ An empty list makes the two assertions over it VACUOUS, which is why the runtime guard
 * below is now the load-bearing one: `collect()` filters every path it returns through
 * `isExcluded()`, so a tree added without a line here is caught at run time rather than
 * escaping entirely. That is strictly stronger than this list ever was — the list could only
 * ever cover trees somebody remembered to add to it.
 */
const COLLECTED_DIRS: string[] = [];

describe("bucket_gzip upload set", () => {
  // Guards the two regexes above. Without this, a rename or a reformat that stopped the
  // parse would leave every assertion below iterating an empty array and passing.
  test("the source parse still finds both lists", () => {
    expect(GLOBAL_FILES.length).toBeGreaterThan(10);
    expect(PER_ELECTION_FILES.length).toBeGreaterThan(1);
  });

  test("names no path bucket:sync excludes", () => {
    const offenders = GLOBAL_FILES.filter(
      (rel) => isExcluded(rel) !== null,
    ).map((rel) => `${rel} — ${isExcluded(rel)}`);
    expect(offenders).toEqual([]);
  });

  test("walks no directory bucket:sync excludes", () => {
    const offenders = COLLECTED_DIRS.filter(
      (dir) => isExcluded(dir) !== null,
    ).map((dir) => `${dir} — ${isExcluded(dir)}`);
    expect(offenders).toEqual([]);
  });

  // MUTATION CHECK. The three assertions above are satisfied by any `isExcluded` that has
  // silently stopped discriminating — one that returns null for everything passes them all.
  // Pin a path the sync layer is known to refuse, so a gate going vacuous fails here first.
  //
  // Both anchors are chosen because they are excluded TODAY and for durable reasons — one a
  // retired PG-served tree, one a live PG load source. Do not anchor on a path a pending
  // change is about to exclude: the first draft used `officials/declarations/`, which
  // json-retirement-v2 Tier 0 adds but which returns null until that lands, so the check
  // failed against the very state it was meant to describe.
  test("the exclusion rule still discriminates", () => {
    expect(isExcluded("parliament/by-id/1.json")).not.toBeNull();
    expect(isExcluded("funds/x.json")).not.toBeNull();
  });

  test("every listed global file exists under data/", () => {
    const missing = GLOBAL_FILES.filter((rel) => !existsSync(`data/${rel}`));
    expect(missing).toEqual([]);
  });

  // The whole point of this file is that `cp -Z` cannot filter, so the collector must not be
  // handed a path the rule refuses. A directory pinned in COLLECTED_DIRS that `collect()` no
  // longer walks is dead config; one it walks without being pinned is an unguarded tree.
  test("COLLECTED_DIRS matches what collect() actually walks", () => {
    for (const dir of COLLECTED_DIRS) {
      expect(SRC).toContain(dir);
    }
  });

  // ⚠️ THE ONE THAT MATTERS NOW THAT COLLECTED_DIRS IS EMPTY. Every assertion above is a
  // STATIC check over paths someone remembered to list; this pins the RUNTIME guard that
  // covers the ones they did not. `collect()` filters its result through `isExcluded()` — the
  // same single definition the rsync uses — so a retired tree cannot be republished by
  // `cp -Z` merely because nobody updated this file.
  //
  // Asserted against the source for the reason in the header: bucket_gzip.ts has no exports
  // and calls run() at module scope, so importing it would start an upload.
  test("collect() filters its result through isExcluded()", () => {
    expect(SRC).toMatch(/import \{ isExcluded \} from "\.\/bucket_sync_paths"/);
    // Inside collect(), not merely imported somewhere in the file.
    const collectBody =
      /const collect = \(\)[\s\S]*?\n\};/.exec(SRC)?.[0] ?? "";
    expect(collectBody, "collect() not found — the parse went stale").not.toBe(
      "",
    );
    expect(collectBody).toContain("isExcluded(");
  });
});
