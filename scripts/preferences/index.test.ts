import { describe, expect, it } from "vitest";
import { listPreferenceFolders } from "./index";
import { isParliamentaryFolder } from "../lib/electionFolders";
import { assertCommitted } from "../lib/assert_committed";

// The defect this file exists for: a FILTER and an INDEX-BASED lookup fourteen lines
// apart are coupled, and nothing said so. `createPreferencesFiles` reads
// `folders[index - 1]` as "the previous election", so narrowing the list silently
// repoints prev-year preference carry-over for every election in it. A pure test over
// the list catches that; no assertion about the filter alone can.
// ⚠ ASSERTED, NOT SKIPPED. `data/` is committed and CI does a full checkout, so its
// absence is a broken working copy rather than a supported state — and the previous
// `console.warn` was invisible under Vitest's default reporter anyway.
assertCommitted("data");

describe("listPreferenceFolders", () => {
  it("yields only parliamentary folders", () => {
    const folders = listPreferenceFolders();
    expect(folders.length).toBeGreaterThan(0);
    const wrongKind = folders
      .map((f) => f.name)
      .filter((n) => !isParliamentaryFolder(n));
    expect(
      wrongKind,
      "non-parliamentary folder in the preferences list",
    ).toEqual([]);
  });

  it("gives every election a parliamentary predecessor", () => {
    const folders = listPreferenceFolders();
    folders.forEach((f, i) => {
      if (i === 0) return;
      const prev = folders[i - 1];
      expect(
        isParliamentaryFolder(prev.name),
        `${f.name} takes its previous-year preferences from ${prev.name}`,
      ).toBe(true);
    });
  });

  it("is sorted ascending, which is what makes index-1 the PREVIOUS election", () => {
    const names = listPreferenceFolders().map((f) => f.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });
});
