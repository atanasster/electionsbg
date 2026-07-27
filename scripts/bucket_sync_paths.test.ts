// Guards the bucket-exclusion invariants for the scoped-sync tool (persons-pg-retirement-v1
// T1.5). The exclusion set lives in THREE hand-maintained places — package.json's
// `bucket:sync` and `bucket:sync:dry` -x regexes, and isExcluded() here — so this pins that
// they agree on the retired officials families, that the guard is correctly scoped (spares
// the still-served index.json / declarations), and that a parent-scoped directory sync can't
// re-upload a retired child (FINDING-001).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { isExcluded, childExcludeRegexes } from "./bucket_sync_paths";

const pkg = JSON.parse(
  readFileSync(
    path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "..",
      "package.json",
    ),
    "utf8",
  ),
).scripts as Record<string, string>;

const RETIRED = [
  "officials/municipal/by_obshtina/",
  "officials/municipal/search_index",
];

describe("bucket exclusion lockstep (package.json ↔ isExcluded)", () => {
  it("both bucket:sync and bucket:sync:dry -x regexes exclude the officials families", () => {
    for (const frag of RETIRED) {
      expect(pkg["bucket:sync"]).toContain(frag);
      expect(pkg["bucket:sync:dry"]).toContain(frag);
    }
  });

  it("the two -x regexes are byte-identical (they must never drift)", () => {
    const xOf = (s: string) => s.match(/-x '([^']*)'/)?.[1];
    expect(xOf(pkg["bucket:sync"])).toBe(xOf(pkg["bucket:sync:dry"]));
  });
});

describe("isExcluded", () => {
  it("refuses the retired families", () => {
    expect(isExcluded("officials/municipal/by_obshtina")).toBeTruthy();
    expect(
      isExcluded("officials/municipal/by_obshtina/BGS04.json"),
    ).toBeTruthy();
    expect(isExcluded("officials/municipal/search_index.json")).toBeTruthy();
  });

  it("spares the still-served / load-source siblings", () => {
    expect(isExcluded("officials/municipal/index.json")).toBeNull();
    expect(isExcluded("officials/municipal/declarations/x.json")).toBeNull();
    expect(isExcluded("officials")).toBeNull();
    expect(isExcluded("officials/municipal")).toBeNull();
  });
});

describe("childExcludeRegexes (FINDING-001: parent-scoped dir sync)", () => {
  const matchesAny = (regexes: string[], relPath: string): boolean =>
    regexes.some((r) => new RegExp(r).test(relPath));

  it("excludes the retired children when the officials parent is synced", () => {
    const rx = childExcludeRegexes("officials/municipal");
    expect(matchesAny(rx, "by_obshtina/BGS04.json")).toBe(true);
    expect(matchesAny(rx, "search_index.json")).toBe(true);
    // …but never the still-served siblings under the same parent.
    expect(matchesAny(rx, "index.json")).toBe(false);
    expect(matchesAny(rx, "declarations/x.json")).toBe(false);
  });

  it("re-anchors relative to a grandparent sync", () => {
    const rx = childExcludeRegexes("officials");
    expect(matchesAny(rx, "municipal/by_obshtina/BGS04.json")).toBe(true);
    expect(matchesAny(rx, "municipal/search_index.json")).toBe(true);
    expect(matchesAny(rx, "municipal/index.json")).toBe(false);
  });

  it("is officials-anchored — never touches the bucket-served parliament search_index", () => {
    // The whole point of not using a blanket `search_index.json` pattern.
    expect(childExcludeRegexes("parliament/votes/derived")).toEqual([]);
    expect(childExcludeRegexes("prices")).toEqual([]);
  });
});
