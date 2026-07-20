import { describe, it, expect } from "vitest";
import {
  TYPE_ORDER,
  SEARCH_FUSE_OPTIONS,
  searchLimitForType,
} from "./searchConfig";

// The shared, hook-free search config — the single source of truth for group order and the
// per-type fuzziness budget, consumed by both the live header search and the regression
// harness. These are pure assertions (no DB, no React) so they run in CI.
describe("searchConfig", () => {
  it("orders groups place → section → official → person → ministry → vote", () => {
    expect(TYPE_ORDER).toEqual(["s", "m", "d", "r", "c", "o", "p", "b", "v"]);
  });

  it("no longer carries the retired CIK-candidate ('a') surface", () => {
    // Candidates are persons now — search serves them from the 'p' (person_search) group,
    // not a static candidate index. A stray 'a' would resurrect the dropped JSON dependency.
    expect(TYPE_ORDER).not.toContain("a");
    expect(TYPE_ORDER).toContain("p");
  });

  it("applies the documented per-type fuzziness budget", () => {
    // Name-ish surfaces (ministry / vote title / municipal official) search by keyword → loose.
    for (const t of ["b", "v", "o"]) expect(searchLimitForType(t)).toBe(0.4);
    // Sections are numeric ids → tightest, so a fuzzy edit can't bind to a neighbour.
    expect(searchLimitForType("c")).toBe(0.1);
    // Places (settlement / municipality / rayon / region) tolerate one typo.
    for (const t of ["s", "m", "d", "r"])
      expect(searchLimitForType(t)).toBe(0.2);
    // 'p' (person) is not Fuse-scored — it comes live from person_search — so it takes the
    // default budget and never the retired 0.4 candidate bucket.
    expect(searchLimitForType("p")).toBe(0.2);
    expect(searchLimitForType("a")).toBe(0.2); // 'a' is dead → no special-case left
  });

  it("fuses the bilingual name fields, location-agnostic", () => {
    expect(SEARCH_FUSE_OPTIONS.keys).toEqual(["name", "name_en"]);
    expect(SEARCH_FUSE_OPTIONS.ignoreLocation).toBe(true);
    expect(SEARCH_FUSE_OPTIONS.includeScore).toBe(true);
    expect(SEARCH_FUSE_OPTIONS.includeMatches).toBe(true);
  });
});
