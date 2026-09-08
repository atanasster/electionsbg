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
// READS THE SOURCE to get at the `PER_*_FILES` lists, which are module-private — that, and
// nothing else, is why the regex parse below exists.
//
// ⚠️ ITS ORIGINAL RATIONALE IS NOW FALSE ON BOTH COUNTS, and the correction matters: the file
// USED to have zero exports and to call `run()` at module scope, so importing it started a
// production upload. `collect` is exported now and `run()` sits behind an exact-path
// entry-point guard, so importing this module is safe — which is what lets the assertions
// below import a producer's own constant instead of retyping it. Left as source-parsing only
// for the four private arrays.

import { describe, expect, test } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { isExcluded } from "./bucket_sync_paths";
import { CLEAVAGES_FILE } from "./parsers_presidential/build_demographics";
import { SUSPICIOUS_FILE } from "./parsers_presidential/build_suspicious";
import { NEIGHBORHOODS_FILE } from "./parsers_presidential/build_neighborhoods";
import { SCREENING_FILE } from "./parsers_presidential/build_screening";

const SRC = readFileSync("scripts/bucket_gzip.ts", "utf8");

/** Quoted entries of a `const <name> = [ … ];` array literal in the source. */
const arrayLiteral = (name: string): string[] => {
  const body = new RegExp(`const ${name} = \\[([\\s\\S]*?)\\n\\];`).exec(SRC);
  if (!body) return [];
  return [...body[1].matchAll(/^\s*"([^"]+)",/gm)].map((m) => m[1]);
};

const GLOBAL_FILES = arrayLiteral("GLOBAL_FILES");
const PER_ELECTION_FILES = arrayLiteral("PER_ELECTION_FILES");
const PER_CYCLE_FILES = arrayLiteral("PER_CYCLE_FILES");
const PER_ROUND_FILES = arrayLiteral("PER_ROUND_FILES");

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
  // ⚠ ASSERTED AGAINST THE SOURCE TEXT, and the reason is NOT that importing the module is
  // unsafe — this very file imports `collect` and four producer constants from it, and `run()`
  // has sat behind an entry-point guard since the 682-object accidental upload. The surviving
  // reason is narrower: the four `PER_*_FILES` arrays and `collect()`'s body are module-PRIVATE,
  // so a static read is the only way to see them.
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

/**
 * ⚠⚠ THIS PASS IS THE ONLY THING THAT PUBLISHES THE PRESIDENTIAL TREE AT ALL. `data/2*` is
 * gitignored and `_pvr` cycles are not rsynced, so a path absent from `collect()` never
 * reaches the bucket — and every presidential hook reads a missing file as `absent` by design,
 * which means the tile that needs it simply never renders in production while working
 * perfectly on a developer's machine. No error, no log, nothing red.
 *
 * That is not hypothetical. Measured against the live bucket on 2026-09-07:
 *
 *     2021_11_14_pvr/tickets.json           200
 *     2021_11_14_pvr/national_summary.json  200
 *     2021_11_14_pvr/runoff_transfer.json   404   ← „Откъде дойдоха гласовете на балотажа"
 *     2021_11_14_pvr/split_ticket.json      404   ← the split-ticket tile
 *
 * So the gate is derived from the BROWSER's own path builders rather than from a list somebody
 * maintains: every `${cycle}/…` template in `src/data/presidential/` must be reachable from
 * this file's lists or directory walks. A new hook that invents a path nobody publishes fails
 * here instead of in production.
 */
describe("the presidential tree this pass publishes", () => {
  const HOOK_DIR = "src/data/presidential";
  /** Every `${cycle}/…` path template the hooks build, with their interpolations blanked. */
  const templates = readdirSync(HOOK_DIR)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .flatMap((f) => [
      ...readFileSync(`${HOOK_DIR}/${f}`, "utf8").matchAll(
        /`\$\{cycle\}\/([^`]*)`/g,
      ),
    ])
    .map((m) => m[1]);

  /** ⚠ ONE TEMPLATE NAMES NO FILE. `useRoundRollup` builds its filename from a level→file
   *  map, so `tur${round}/${FILE_OF[level]}` has to be resolved against that module's own
   *  source — restating the four names here would be a second list to keep in step, and the
   *  whole point of this gate is not having one. */
  const FILE_OF = [
    ...readFileSync(`${HOOK_DIR}/useRoundRollup.ts`, "utf8").matchAll(
      /^\s*\w+: "([^"]+\.json)",$/gm,
    ),
  ].map((m) => m[1]);
  const expand = (tpl: string): string[] =>
    tpl.includes("${FILE_OF[level]}")
      ? FILE_OF.map((f) => tpl.replace("${FILE_OF[level]}", f))
      : [tpl];

  test("the scan still finds the hooks' path builders", () => {
    // Without this, a rename or a reformat leaves the assertion below iterating nothing.
    expect(templates.length).toBeGreaterThanOrEqual(6);
    expect(templates).toContain("national_summary.json");
    // The four levels `useRoundRollup` serves — country, region, município, abroad.
    expect(FILE_OF.length).toBe(4);
  });

  test("every path a presidential hook fetches is on this pass's upload set", () => {
    const cycleRoot = new Set([...PER_CYCLE_FILES, ...PER_ELECTION_FILES]);
    const perRound = new Set(PER_ROUND_FILES);
    // Directory walks inside `collect()`, keyed by the template they cover. Pinned to the
    // source below so a walk that is deleted cannot keep satisfying this list.
    const WALKED: Record<string, string> = {
      "tur${round}/sections/${oblast}.json": "/sections",
      "runoff_transfer/${oblast}.json": "runoff_transfer",
    };
    const expanded = templates.flatMap(expand);
    // ⚠ PIN WHAT THE `.json` FILTER SWALLOWS, rather than only applying it. Five templates name
    // no file today, and all five are `warnOnce` LOG KEYS — `useOblastTransfer`'s
    // `${cycle}/${oblast}`, and the per-round `${cycle}/tur${round}` built by
    // `usePresidentialCleavages`, `useSuspiciousSettlements`, `useNeighborhoods` and
    // `useScreening`. A SIXTH is either another log key (added here, deliberately) or an
    // unguarded fetch path, and an unbounded filter cannot tell those apart — which is the
    // shape that left two artifacts 404 in production, per this describe block's own header.
    //
    // ⚠ AND THIS ASSERTION IS WHY THE PIN IS WORTH ITS MAINTENANCE COST: adding the cleavages
    // hook turned it red, which is exactly what it is for. It went unnoticed for one commit
    // because that step's verification ran the `src/` and i18n suites and not this file — a
    // reminder that the publish gate lives in `scripts/`, not beside the hook it guards. The
    // suspicious-settlements hook turned it red the same way and was caught in its own step.
    expect(expanded.filter((tpl) => !tpl.endsWith(".json")).sort()).toEqual([
      "${oblast}",
      "tur${round}",
      "tur${round}",
      "tur${round}",
      "tur${round}",
    ]);
    const unpublished = expanded
      // ⚠ A FETCHED PATH ENDS IN `.json`. The scan matches every `${cycle}/…` template in the
      // module, and not all of them are paths: `useOblastTransfer` builds `${cycle}/${oblast}`
      // as a LOG key. Filtering on the extension keeps the gate about files without needing a
      // list of exceptions — and a template that ends in an unresolved `${…}` (the `FILE_OF`
      // shape) still has to be expanded above rather than skipped here.
      .filter((tpl) => tpl.endsWith(".json"))
      .filter((tpl) => {
        if (WALKED[tpl]) return false;
        const round = /^tur\$\{round\}\/(.+)$/.exec(tpl);
        if (round) return !perRound.has(round[1]);
        // `${FILE_OF[level]}` and friends are resolved by the per-round list above; anything
        // else is a literal at the cycle root.
        return !cycleRoot.has(tpl);
      });
    expect(unpublished).toEqual([]);
  });

  test("the directory walks those templates rely on are still in collect()", () => {
    // ⚠ THE LIST ABOVE IS ONLY AS GOOD AS THIS. A walk removed from `collect()` would leave
    // its template silently „covered" by a `WALKED` entry describing code that no longer runs.
    expect(SRC).toContain('join(DATA, entry.name, round, "sections")');
    expect(SRC).toContain('join(DATA, entry.name, "runoff_transfer")');
  });

  // ⚠ NEITHER OF THE NEXT TWO IS REDUNDANT WITH THE DERIVED GATE ABOVE, though both look it
  // now that a hook reads each path. That gate pins the upload list against the BROWSER's
  // literal; these pin it against the PRODUCER's exported constant. Those are two different
  // renames, and only these catch the producer-side one — which stops the artifact being
  // WRITTEN under the name we publish, leaving the derived gate perfectly green.
  //
  // ⚠ THEIR ORIGINAL RATIONALE („no hook reads it yet, so the derived gate is vacuous") was
  // true when each was written and false by the end of the same plan. It is recorded here
  // because a test whose only stated justification is demonstrably false is a test the next
  // reader deletes.
  test("the presidential cleavages file is published", () => {
    expect(PER_ROUND_FILES).toContain(CLEAVAGES_FILE);
  });

  test("the presidential suspicious-settlements file is published", () => {
    expect(PER_ROUND_FILES).toContain(SUSPICIOUS_FILE);
  });

  test("the presidential flagged-districts file is published", () => {
    expect(PER_ROUND_FILES).toContain(NEIGHBORHOODS_FILE);
  });

  test("the presidential section-screening file is published", () => {
    expect(PER_ROUND_FILES).toContain(SCREENING_FILE);
  });

  test("the two files that were 404 in production are named", () => {
    // ⚠ THE REGRESSION ANCHOR. The derived gate above passes the day somebody deletes both the
    // list entry AND the hook; this says the artifacts themselves stay published.
    expect(PER_CYCLE_FILES).toContain("runoff_transfer.json");
    expect(PER_CYCLE_FILES).toContain("split_ticket.json");
  });
});
