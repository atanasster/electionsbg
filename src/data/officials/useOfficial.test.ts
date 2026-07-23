// Merging one person's filings across their several official identities.
//
// The officials slug is `name + institution` hashed, so changing post mints a
// new slug: Лозана Илиева Василева holds four (МЗХ, МЗХГ, ДФ „Земеделие"-РА,
// ДФ „Земеделие") covering 2015-2025. The person page used to pick one with
// `.find()`, which showed whichever the role order happened to yield and hid
// the rest of the person's declaration history entirely.

import { describe, expect, it } from "vitest";
import type { OfficialDeclaration } from "@/data/dataTypes";
import { mergeDeclarationTimelines } from "./useOfficial";

const decl = (
  declarationYear: number,
  institution: string,
  filedAt: string | null = null,
  sourceUrl = `https://register.cacbg.bg/${declarationYear}/${institution}-${declarationYear}.xml`,
  entryNumber: string | null = null,
): OfficialDeclaration =>
  ({
    slug: "x",
    declarantName: "Лозана Илиева Василева",
    institution,
    positionTitle: null,
    declarationYear,
    fiscalYear: declarationYear - 1,
    declarationType: "Annualy",
    filedAt,
    entryNumber,
    controlHash: null,
    sourceUrl,
    ownershipStakes: [],
    income: [],
    assets: [],
  }) as OfficialDeclaration;

describe("mergeDeclarationTimelines", () => {
  it("interleaves several identities into one newest-first timeline", () => {
    const merged = mergeDeclarationTimelines([
      [decl(2025, "МЗХ")],
      [decl(2021, "МЗХГ"), decl(2019, "МЗХГ")],
      [decl(2024, "ДФЗ")],
    ]);
    expect(merged.map((d) => d.declarationYear)).toEqual([
      2025, 2024, 2021, 2019,
    ]);
  });

  it("keeps a filing once when two identities both carry it", () => {
    const shared = decl(
      2020,
      "МЗХГ",
      null,
      "https://register.cacbg.bg/2020/s.xml",
    );
    const merged = mergeDeclarationTimelines([[shared], [shared]]);
    expect(merged).toHaveLength(1);
  });

  it("orders same-year filings by filing date, newest first", () => {
    const merged = mergeDeclarationTimelines([
      [decl(2023, "A", "2023-03-01", "https://register.cacbg.bg/2023/a.xml")],
      [decl(2023, "B", "2023-09-01", "https://register.cacbg.bg/2023/b.xml")],
    ]);
    expect(merged.map((d) => d.filedAt)).toEqual(["2023-09-01", "2023-03-01"]);
  });

  // A query that has not resolved yet arrives as undefined, and a slug with no
  // file at all resolves to null. Neither should break the merge.
  it("tolerates unresolved and empty identities", () => {
    const merged = mergeDeclarationTimelines([
      undefined,
      null,
      [],
      [decl(2022, "МЗХГ")],
    ]);
    expect(merged.map((d) => d.declarationYear)).toEqual([2022]);
    expect(mergeDeclarationTimelines([])).toEqual([]);
  });

  // The rung that decides who is worth what. An annual (Г…) and an entry or
  // vacate filing (Ф…) routinely share a year with no filing date on either, so
  // dropping entryNumber left an opaque GUID to break the tie — 32 declarants
  // then showed one net worth on /person and a different one on /officials.
  it("breaks a same-year, undated tie on the registry entry number", () => {
    // sourceUrl order is deliberately the OPPOSITE of entryNumber order, so a
    // sort that ignores entryNumber returns the wrong head.
    const annual = decl(
      2024,
      "МЗХ",
      null,
      "https://register.cacbg.bg/2024/zzz.xml",
      "Г3810",
    );
    const vacate = decl(
      2024,
      "МЗХ",
      null,
      "https://register.cacbg.bg/2024/aaa.xml",
      "Ф9001",
    );
    expect(mergeDeclarationTimelines([[vacate], [annual]])[0].entryNumber).toBe(
      "Г3810",
    );
  });

  // Parity with the producer: the client must order a history exactly as
  // scripts/officials/merge.ts wrote it, or "the latest filing" differs between
  // the shard and the page rendering it.
  it("orders a single identity exactly as the shard was written", () => {
    const shard = [
      decl(
        2025,
        "A",
        "2025-05-01",
        "https://register.cacbg.bg/2025/a.xml",
        "Г1",
      ),
      decl(2024, "A", null, "https://register.cacbg.bg/2024/b.xml", "Г2"),
      decl(2024, "A", null, "https://register.cacbg.bg/2024/a.xml", "Ф3"),
    ];
    expect(mergeDeclarationTimelines([shard])).toEqual(shard);
  });

  it("is deterministic when years, dates and entry numbers all tie", () => {
    const a = decl(2023, "A", null, "https://register.cacbg.bg/2023/a.xml");
    const b = decl(2023, "B", null, "https://register.cacbg.bg/2023/b.xml");
    expect(
      mergeDeclarationTimelines([[a], [b]]).map((d) => d.sourceUrl),
    ).toEqual(mergeDeclarationTimelines([[b], [a]]).map((d) => d.sourceUrl));
  });
});
