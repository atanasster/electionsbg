// Gate for `isEikRollupFile` — the predicate that decides which files under
// data/procurement/{contractors,awarders} are per-EIK rollups.
//
// WHY IT NEEDS A GATE. It has now been broken TWICE by the same move, and both
// times nothing failed. The pattern was `\d+\.json`, which silently dropped the
// ~124 foreign suppliers whose registration id carries letters. It became
// `[A-Za-z0-9]+\.json`, which then silently dropped `np-<hash>` when the
// natural-person key was introduced — the breakage its own docstring describes:
// those rollups go invisible to the stale-file prune in gen_procurement/rollups.ts
// and accumulate forever, while the files-vs-distinct-EIKs invariant undercounts.
// It was then named `(np-)?[A-Za-z0-9]+\.json`, which would have dropped `ph-`
// (the filler-supplier key, scripts/procurement/supplier_identity.ts) in exactly
// the same way — caught in review, not by a test, because there was none.
//
// The failure is silent by construction: a rollup that is not matched is simply
// never enumerated, so no count moves and no file errors. Hence this file.
//
//   npx vitest run scripts/db/lib/paths.test.ts

import { describe, expect, it } from "vitest";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { isEikRollupFile, PROC_DIR } from "./paths";

describe("isEikRollupFile", () => {
  it("matches a plain numeric EIK rollup", () => {
    expect(isEikRollupFile("131468980.json")).toBe(true);
    expect(isEikRollupFile("000695114.json")).toBe(true);
  });

  it("matches a letter-bearing foreign registration id", () => {
    // The first breakage: `\d+` dropped these.
    for (const f of [
      "ATU14715405.json",
      "5210084655NTRPL000005852.json",
      "140639Y.json",
    ])
      expect(isEikRollupFile(f), f).toBe(true);
  });

  it("matches EVERY synthetic hyphenated namespace, named or not", () => {
    // The second and third breakages. `np-` is live (86 rollups on disk today),
    // `ph-` is the one review caught before it shipped, and the third entry stands
    // for whatever comes next — the point of the pattern being prefix-AGNOSTIC is
    // that a new namespace needs no edit here.
    for (const f of [
      "np-9906396c39ba.json",
      "ph-2475f7344022.json",
      "obed-e0d64b6674a1.json",
      "future-namespace-abc123.json",
    ])
      expect(isEikRollupFile(f), f).toBe(true);
  });

  it("still rejects what is not a rollup", () => {
    // The pattern is permissive on purpose (neither directory holds anything but
    // rollups), but it must not match a path, a dotfile or another extension —
    // otherwise the prune would consider deleting them.
    //
    // ⚠ `index.json` is NOT in this list, and that is not an oversight: it matches,
    // and always has (it is alphanumeric, so the pre-`np-` pattern took it too).
    // The docstring's "neither dir holds an index.json" is what makes that safe, so
    // the test below asserts that premise rather than a behaviour the code does not
    // have.
    for (const f of [
      "sub/dir/131468980.json",
      "131468980.json.gz",
      "131468980.txt",
      ".DS_Store",
      "",
      "-.json",
      "131468980-.json",
    ])
      expect(isEikRollupFile(f), f).toBe(false);
  });

  it("the permissive pattern's premise holds — neither dir has a non-rollup", () => {
    // The whole design rests on "every file in these two directories is a rollup".
    // If an index.json (or anything else) ever lands there, the prune in
    // gen_procurement/rollups.ts would treat it as a stale rollup and delete it.
    const dirs = ["contractors", "awarders"].map((d) => path.join(PROC_DIR, d));
    const present = dirs.filter((d) => existsSync(d));
    if (!present.length) return; // gitignored tree absent on a fresh clone

    for (const dir of present) {
      const files = readdirSync(dir);
      expect(files.length, dir).toBeGreaterThan(0); // else vacuous
      const strays = files.filter((f) => !isEikRollupFile(f));
      expect(strays, `non-rollup files in ${dir}`).toEqual([]);
      expect(files).not.toContain("index.json");
    }
  });
});
