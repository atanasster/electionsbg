// Unit tests for the officials INDEX merge. The generic per-declarant
// declaration merge moved to scripts/lib/declaration_merge.ts (shared with the
// MP ingest) and is tested there. Runs in the `node` Vitest project — pure
// functions, no network, no filesystem.

import { describe, expect, it } from "vitest";
import { mergeIndexEntries, mergeYears } from "./merge";
import type { OfficialIndexEntry } from "../../src/data/dataTypes";

const idx = (
  slug: string,
  descriptorYear: number,
  name = slug,
  latestDeclarationYear = descriptorYear,
): OfficialIndexEntry => ({
  slug,
  name,
  normalizedName: name.toUpperCase(),
  category: "cabinet",
  categoryRaw: "Министър-председател",
  institution: "Министерски съвет",
  positionTitle: "министър",
  isCaretaker: false,
  latestDeclarationYear,
  descriptorYear,
});

describe("mergeIndexEntries", () => {
  it("widens the universe rather than replacing it", () => {
    const merged = mergeIndexEntries([idx("a", 2025)], [idx("b", 2023)]);
    expect(merged.map((e) => e.slug).sort()).toEqual(["a", "b"]);
  });

  it("keeps the newest cycle's descriptors for a slug in both runs", () => {
    const merged = mergeIndexEntries([idx("a", 2025)], [idx("a", 2019)]);
    expect(merged).toHaveLength(1);
    expect(merged[0].descriptorYear).toBe(2025);
  });

  it("lets a newer run supersede an older entry", () => {
    const merged = mergeIndexEntries([idx("a", 2023)], [idx("a", 2025)]);
    expect(merged[0].descriptorYear).toBe(2025);
  });

  it("re-running the same year refreshes the entry in place", () => {
    const merged = mergeIndexEntries(
      [idx("a", 2025, "Стар")],
      [idx("a", 2025, "Нов")],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].name).toBe("Нов");
  });

  // The self-wedging regression: precedence used to key on the DECLARATION
  // year, which a buggy parser could inflate past anything a later run could
  // produce. 434 rows claimed a wall-clock 2026, and once the parser was fixed
  // to clamp years to their folder, no re-derive could ever replace them.
  it("replaces a row whose declaration year is impossibly far in the future", () => {
    const stale = idx("a", 2023, "Стар", 2026);
    const fresh = idx("a", 2025, "Нов", 2025);
    const merged = mergeIndexEntries([stale], [fresh]);
    expect(merged[0].name).toBe("Нов");
    expect(merged[0].latestDeclarationYear).toBe(2025);
  });

  // A row written before descriptorYear existed must not outrank a current run.
  it("treats a row with no descriptorYear as older than any current run", () => {
    const legacy = { ...idx("a", 2025, "Стар") } as Partial<OfficialIndexEntry>;
    delete legacy.descriptorYear;
    const merged = mergeIndexEntries(
      [legacy as OfficialIndexEntry],
      [idx("a", 2015, "Нов")],
    );
    expect(merged[0].name).toBe("Нов");
  });
});

describe("mergeYears", () => {
  it("unions and sorts ascending", () => {
    expect(mergeYears([2025], 2023)).toEqual([2023, 2025]);
  });

  it("is idempotent", () => {
    expect(mergeYears([2023, 2025], 2025)).toEqual([2023, 2025]);
  });
});
