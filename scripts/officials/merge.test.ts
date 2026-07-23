// Unit tests for the officials merge semantics: a run is authoritative for its
// target register-folder year and additive everywhere else. Runs in the `node`
// Vitest project. No network, no filesystem — pure functions only.

import { describe, expect, it } from "vitest";
import {
  folderYearFromSourceUrl,
  mergeDeclarations,
  mergeIndexEntries,
  mergeYears,
} from "./merge";
import type {
  OfficialDeclaration,
  OfficialIndexEntry,
} from "../../src/data/dataTypes";

const decl = (
  over: Partial<OfficialDeclaration> & { sourceUrl: string },
): OfficialDeclaration =>
  ({
    slug: "ivan-petev-demerdzhiev-abc123",
    declarantName: "Иван Петев Демерджиев",
    institution: "Министерски съвет",
    positionTitle: "министър",
    declarationYear: 2025,
    fiscalYear: 2024,
    declarationType: "Annualy",
    filedAt: null,
    entryNumber: null,
    controlHash: null,
    ownershipStakes: [],
    income: [],
    assets: [],
    ...over,
  }) as OfficialDeclaration;

const url = (year: number, file: string) =>
  `https://register.cacbg.bg/${year}/${file}.xml`;

describe("folderYearFromSourceUrl", () => {
  it("reads the register folder year", () => {
    expect(folderYearFromSourceUrl(url(2023, "ABC123"))).toBe(2023);
  });

  it("returns null for a URL outside the register", () => {
    expect(
      folderYearFromSourceUrl("https://example.com/2023/x.xml"),
    ).toBeNull();
  });
});

describe("mergeDeclarations", () => {
  it("keeps other years when a backfill year is written", () => {
    // The regression this whole change exists for: ingesting 2023 must not
    // wipe the 2025 filing.
    const existing = [
      decl({ sourceUrl: url(2025, "cur"), declarationYear: 2025 }),
    ];
    const incoming = [
      decl({ sourceUrl: url(2023, "old"), declarationYear: 2023 }),
    ];
    const merged = mergeDeclarations(existing, incoming, 2023);
    expect(merged.map((d) => d.sourceUrl)).toEqual([
      url(2025, "cur"),
      url(2023, "old"),
    ]);
  });

  it("replaces only the target year's rows, so re-runs are idempotent", () => {
    const existing = [
      decl({ sourceUrl: url(2025, "cur"), declarationYear: 2025 }),
      decl({ sourceUrl: url(2023, "stale"), declarationYear: 2023 }),
    ];
    const incoming = [
      decl({ sourceUrl: url(2023, "fresh"), declarationYear: 2023 }),
    ];
    const merged = mergeDeclarations(existing, incoming, 2023);
    expect(merged.map((d) => d.sourceUrl)).toEqual([
      url(2025, "cur"),
      url(2023, "fresh"),
    ]);
    // Re-running the same year again is a no-op.
    expect(mergeDeclarations(merged, incoming, 2023)).toEqual(merged);
  });

  it("keys replacement on the folder year, not the parsed declarationYear", () => {
    // The live 2025 folder holds rows parsing to 2026 (one-off entry/exit
    // filings). Re-running 2025 must replace them; they must not be mistaken
    // for a separate 2026 cycle and stranded.
    const existing = [
      decl({ sourceUrl: url(2025, "oneoff"), declarationYear: 2026 }),
      decl({ sourceUrl: url(2023, "old"), declarationYear: 2023 }),
    ];
    const incoming = [
      decl({ sourceUrl: url(2025, "again"), declarationYear: 2026 }),
    ];
    const merged = mergeDeclarations(existing, incoming, 2025);
    expect(merged.map((d) => d.sourceUrl)).toEqual([
      url(2025, "again"),
      url(2023, "old"),
    ]);
  });

  it("sorts newest-first so rankings can read [0] and [1]", () => {
    const merged = mergeDeclarations(
      [
        decl({ sourceUrl: url(2019, "c"), declarationYear: 2019 }),
        decl({ sourceUrl: url(2025, "a"), declarationYear: 2025 }),
      ],
      [decl({ sourceUrl: url(2022, "b"), declarationYear: 2022 })],
      2022,
    );
    expect(merged.map((d) => d.declarationYear)).toEqual([2025, 2022, 2019]);
  });

  it("does not duplicate a row that appears on both sides", () => {
    const same = decl({ sourceUrl: url(2023, "x"), declarationYear: 2023 });
    // An existing row whose folder year is unparseable would survive the year
    // filter — the sourceUrl guard still stops it doubling up.
    const odd = decl({ sourceUrl: "https://example.com/x.xml" });
    expect(mergeDeclarations([same, odd], [same], 2023)).toHaveLength(2);
  });

  it("orders same-year filings deterministically", () => {
    const a = decl({
      sourceUrl: url(2023, "a"),
      declarationYear: 2023,
      filedAt: "2023-07-04",
      entryNumber: "Ф917",
    });
    const b = decl({
      sourceUrl: url(2023, "b"),
      declarationYear: 2023,
      filedAt: "2023-03-01",
      entryNumber: "Г3110",
    });
    // Later filing first, regardless of input order.
    expect(
      mergeDeclarations([], [b, a], 2023).map((d) => d.entryNumber),
    ).toEqual(["Ф917", "Г3110"]);
    expect(
      mergeDeclarations([], [a, b], 2023).map((d) => d.entryNumber),
    ).toEqual(["Ф917", "Г3110"]);
  });
});

// `descriptorYear` is the register folder the run targeted — the merge
// precedence key. It normally equals the run's own latestDeclarationYear, so it
// defaults to it, but the two are decoupled on purpose (see mergeIndexEntries).
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
