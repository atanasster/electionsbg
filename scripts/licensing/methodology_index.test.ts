// Static gate over METHODOLOGY.md — is the index still an index?
//
// WHY: this file's entire value is that a stranger can follow it to the real
// definition of a published method. A dead link there is not a broken link like
// any other: it is a citation failure in the one document written to be cited.
//
// Two failure modes, and the second is the quiet one:
//
//   1. A repo-relative link points at a file that does not exist (moved, renamed
//      or never written).
//   2. The Status block — which is what makes the forthcoming rows honest — is
//      removed or goes stale. Removed while the artifacts are still missing, and
//      the file starts asserting things that do not exist. Left in place after
//      they ship, and it tells readers to ignore links that are now correct.
//
// So the gate is symmetric: unmarked links must resolve, and the Status block
// must be present exactly while at least one artifact it covers is missing.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

const ROOT = path.resolve(__dirname, "../..");
const DOC = path.join(ROOT, "METHODOLOGY.md");
const md = fs.readFileSync(DOC, "utf8");

/** Artifacts the Status block declares as forthcoming. Once every one of these
 *  exists, the block must go — that is asserted below, so this list is also the
 *  checklist for retiring it. */
const FORTHCOMING = [
  "src/lib/riskFlagCatalog.ts",
  "docs/methodology/procurement-risk-flags.md",
  "public/risk-flags.json",
];

const exists = (rel: string): boolean => fs.existsSync(path.join(ROOT, rel));

/** Markdown links, minus anchors and absolute URLs — i.e. the repo-relative ones
 *  a reader on GitHub would click. */
const repoLinks = (): string[] => {
  const out: string[] = [];
  for (const m of md.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const href = m[1].trim();
    if (/^https?:\/\//i.test(href) || href.startsWith("#")) continue;
    out.push(href.split("#")[0]);
  }
  return [...new Set(out)];
};

describe("METHODOLOGY.md stays a usable index", () => {
  test("every repo-relative link resolves, except the declared-forthcoming ones", () => {
    const missing = repoLinks().filter(
      (l) => !exists(l) && !FORTHCOMING.includes(l),
    );
    expect(
      missing,
      "dead links in the document written to be cited — add the file, fix the path, " +
        "or declare it in the Status block and in FORTHCOMING here",
    ).toEqual([]);
  });

  test("the gate is not vacuous — the document actually carries repo-relative links", () => {
    expect(repoLinks().length).toBeGreaterThan(3);
  });

  test("the Status block is present exactly while something it covers is missing", () => {
    const hasStatus = /^>\s*\*\*Status/m.test(md);
    const pending = FORTHCOMING.filter((f) => !exists(f));
    if (pending.length > 0) {
      expect(
        hasStatus,
        `still missing: ${pending.join(", ")} — the Status block is what keeps ` +
          "those rows honest and must stay until they ship",
      ).toBe(true);
    } else {
      expect(
        hasStatus,
        "every forthcoming artifact now exists — remove the Status block, and " +
          "remove FORTHCOMING from this test",
      ).toBe(false);
    }
  });

  test("site routes are given as absolute URLs, not bare paths", () => {
    // A bare `/budget/methodology` in a file read on GitHub looks like a repo
    // path and 404s there. These rows are pages, so they carry their origin.
    const bareRoutes = [
      ...md.matchAll(/^\|[^|]*\|\s*`(\/[a-z0-9/-]+)`\s*\|/gim),
    ].map((m) => m[1]);
    expect(
      bareRoutes,
      "site routes written as bare paths read as repo paths on GitHub",
    ).toEqual([]);
  });
});
