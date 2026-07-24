// The safety-critical core of the slug-normalisation migration.
//
// The migration renames ~20,800 shards and folds the profiles the register's
// re-spellings split. Its one unforgivable failure is the opposite of a fold —
// bringing two register people onto one slug — so unsafeFold() is what these
// tests hammer, alongside the slug/name/row derivations that feed it.
//
// Pure functions on synthetic shards; no disk, no `node` fixtures.

import { describe, expect, it } from "vitest";
import type { OfficialDeclaration } from "../../src/data/dataTypes";
import {
  guidsOf,
  newSlugFor,
  rebuildRow,
  unsafeFold,
  type Move,
} from "./migrate_slug_normalisation";
import { canonicalDeclarantName, officialSlug } from "./shared";

const REGISTER = "https://register.cacbg.bg";
// A filing whose filename carries a person-GUID with a filing sequence.
const filing = (
  guid: string | null,
  year: number,
  seq = "100000",
): OfficialDeclaration =>
  ({
    slug: "x",
    declarantName: "x",
    institution: "x",
    positionTitle: null,
    declarationYear: year,
    fiscalYear: year,
    declarationType: "Entry",
    filedAt: `${year}-05-01`,
    entryNumber: "В1",
    controlHash: "AA",
    sourceUrl: guid
      ? `${REGISTER}/${year}/${guid}${seq}.xml`
      : // a bare per-document guid — personGuid() returns null for it
        `${REGISTER}/${year}/255f6c79-551f-4b67-87b4-77e8b1401ddb.xml`,
    ownershipStakes: [],
    income: [],
    assets: [],
    events: [],
  }) as OfficialDeclaration;

const G1 = "A1111111-1111-1111-1111-111111111111";
const G2 = "B2222222-2222-2222-2222-222222222222";

describe("guidsOf", () => {
  it("collects person-GUIDs and ignores bare per-document filings", () => {
    expect([...guidsOf([filing(G1, 2024), filing(null, 2020)])]).toEqual([G1]);
  });
});

describe("unsafeFold — the two-people guard", () => {
  it("passes a fold where every shard carries the same person", () => {
    expect(unsafeFold([new Set([G1]), new Set([G1]), new Set([G1])])).toBe(
      false,
    );
  });

  it("passes a re-issued id (two GUIDs, but chained through a shared shard)", () => {
    // One shard bridges both ids — this is the Николай Стефанов Петров shape,
    // one person the register re-numbered, and it must survive.
    expect(unsafeFold([new Set([G1, G2]), new Set([G1]), new Set([G2])])).toBe(
      false,
    );
  });

  it("passes the bridged fold regardless of shard order", () => {
    // The bridge shard {G1,G2} is LAST here. An order-dependent "intersect the
    // head" check would falsely reject this; the connected-component check must
    // not — it is the same one person as the case above.
    expect(unsafeFold([new Set([G1]), new Set([G2]), new Set([G1, G2])])).toBe(
      false,
    );
  });

  it("flags two disjoint people on one target", () => {
    expect(unsafeFold([new Set([G1]), new Set([G2])])).toBe(true);
  });

  it("flags two components even when a third bridges neither", () => {
    // G1–G2 are one person (bridged), G3 is a stranger with no link to them.
    const G3 = "C3333333-3333-3333-3333-333333333333";
    expect(unsafeFold([new Set([G1, G2]), new Set([G1]), new Set([G3])])).toBe(
      true,
    );
  });

  it("does not let a GUID-less shard mask a two-people merge behind it", () => {
    // The regression this guards: if the FIRST shard proves no identity, a naive
    // "intersect the first" check reads an empty reference and waves everything
    // through. The two real people behind it must still be caught.
    expect(unsafeFold([new Set<string>(), new Set([G1]), new Set([G2])])).toBe(
      true,
    );
  });

  it("is quiet when only one shard proves identity", () => {
    // Not enough evidence to call it a collision — one GUID plus bare filings is
    // the ordinary case of a person with some pre-2024 document-id filings.
    expect(unsafeFold([new Set([G1]), new Set<string>()])).toBe(false);
  });
});

describe("newSlugFor", () => {
  const inst = "РЗИ";
  it("hashes the canonical name, dropping a title", () => {
    const row = { name: "д-р Ася Русева Генева", institution: inst } as never;
    const { slug, name } = newSlugFor(row, inst, [filing(G1, 2024)]);
    expect(name).toBe("д-р Ася Русева Генева");
    expect(slug).toBe(officialSlug("Ася Русева Генева", inst));
  });

  it("substitutes the aliased name when a filing's GUID is in the table", () => {
    // 7515A8D9… → Наталия Василева Илиева; the register typed Натгалия.
    const guid = "7515A8D9-F3E5-476B-8979-41B288573F78";
    const inst2 = "Национално бюро за правна помощ";
    const row = {
      name: "Натгалия Василева Илиева",
      institution: inst2,
    } as never;
    const { slug, name } = newSlugFor(row, inst2, [filing(guid, 2020)]);
    expect(name).toBe("Наталия Василева Илиева");
    expect(slug).toBe(officialSlug("Наталия Василева Илиева", inst2));
  });
});

describe("rebuildRow", () => {
  const move = (
    oldSlug: string,
    latestYear: number,
    newName: string,
  ): Move => ({
    oldSlug,
    newSlug: "target",
    row: {
      slug: oldSlug,
      name: newName,
      normalizedName: "STALE",
      institution: "РЗИ",
      latestDeclarationYear: latestYear,
    } as never,
    decls: [],
    disambiguator: "РЗИ",
    newName,
  });

  it("takes descriptors from the source with the newest filing", () => {
    const row = rebuildRow("target", [
      move("old-a", 2023, "Ася Русева Генева"),
      move("old-b", 2025, "Ася Русева Генева"),
    ]);
    expect(row.slug).toBe("target");
    // 2025 wins.
    expect(row.latestDeclarationYear).toBe(2025);
  });

  it("stamps the canonical normalizedName, not the stale one it carried", () => {
    const row = rebuildRow("target", [
      move("old-a", 2025, "д-р Ася Русева Генева"),
    ]);
    expect(row.normalizedName).toBe(
      canonicalDeclarantName("д-р Ася Русева Генева"),
    );
    expect(row.normalizedName).not.toBe("STALE");
  });
});
