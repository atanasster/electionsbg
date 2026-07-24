// Unit tests for declaration-year resolution.
//
// The year a filing belongs to drives every "latest declaration" selection in
// the app (person profile, officials profile, both asset leaderboards), all of
// which sort newest-first and take the head. A year that does not come from the
// filing itself therefore does not just mislabel one row — it reorders the
// declarant's whole history. Runs in the `node` Vitest project: pure function,
// no network, no filesystem.

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  parseDeclarationXml,
  pickEurValue,
  resolveDeclarationYear,
} from "./parse_declaration";

// Minimal filing in the register's real shape. `year` omitted reproduces the
// one-off filings (Entry / Vacate / Other) that carry no <Year> — ~40% of the
// corpus, and the rows the wall-clock fallback used to mis-date.
const declarationXml = ({
  type,
  year,
  date,
}: {
  type: string;
  year?: string;
  date?: string;
}) => `<?xml version="1.0" encoding="utf-8"?>
<PublicPerson>
  <Personal><Name>Галин Борисов Цоков</Name></Personal>
  <DeclarationData>
    <DeclarationType>${type}</DeclarationType>
    ${year ? `<Year>${year}</Year>` : "<Year></Year>"}
    ${date ? `<DeclarationDate>${date}</DeclarationDate>` : ""}
    <EntryNumber>В998</EntryNumber>
    <ControlHash>B97B15D6</ControlHash>
  </DeclarationData>
  <Tables />
</PublicPerson>`;

const url = (folder: string) =>
  `https://register.cacbg.bg/${folder}/A73C03EA-1A0A-49EB-832E-71A7BFA32B0A184926.xml`;

// Pin the clock to a year that appears in NO fixture below, so any test that
// passes proves the resolver never consulted it.
const PIPELINE_RUN_YEAR = "2026-07-23T00:00:00Z";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("resolveDeclarationYear", () => {
  it("dates an annual filing to the year AFTER the fiscal year it covers", () => {
    expect(
      resolveDeclarationYear({
        declType: "Annualy",
        fiscalYear: 2023,
        filedAt: "2024-05-14",
        sourceUrl: url("2024"),
      }).declarationYear,
    ).toBe(2024);
  });

  it("dates a non-annual filing to its fiscal year as-is", () => {
    expect(
      resolveDeclarationYear({
        declType: "Vacate",
        fiscalYear: 2023,
        filedAt: "2023-07-04",
        sourceUrl: url("2023"),
      }).declarationYear,
    ).toBe(2023);
  });

  // The regression this whole change exists for: an "Other" (incompatibility)
  // filing carries no <Year>, and used to inherit `new Date().getFullYear()`.
  it("falls back to the filing date, not the clock, when the fiscal year is absent", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(PIPELINE_RUN_YEAR));
    expect(
      resolveDeclarationYear({
        declType: "Other",
        fiscalYear: null,
        filedAt: "2023-06-28",
        sourceUrl: url("2023"),
      }).declarationYear,
    ).toBe(2023);
  });

  it("falls back to the register folder when neither year nor filing date is present", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(PIPELINE_RUN_YEAR));
    expect(
      resolveDeclarationYear({
        declType: "Other",
        fiscalYear: null,
        filedAt: null,
        sourceUrl: url("2022"),
      }).declarationYear,
    ).toBe(2022);
  });

  // 2021 ships as `2021_nc` / `2021_nonc` — there is no bare /2021/ folder, but
  // those rows still need a year.
  it("reads the year from a suffixed register folder", () => {
    expect(
      resolveDeclarationYear({
        declType: "Other",
        fiscalYear: null,
        filedAt: null,
        sourceUrl: url("2021_nc"),
      }).declarationYear,
    ).toBe(2021);
  });

  // A far-future <Year> is not clamped to the bound — clamping would still be
  // inventing a year. It is DISBELIEVED, and the filing is dated from the next
  // rung down (here the filing date).
  it("disbelieves an impossible fiscal year and falls through, warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(
      resolveDeclarationYear({
        declType: "Annualy",
        fiscalYear: 3024,
        filedAt: "2025-04-01",
        sourceUrl: url("2025"),
      }).declarationYear,
    ).toBe(2025);
    expect(warn).toHaveBeenCalledOnce();
  });

  // An annual whose fiscal year equals its folder year (the register does carry
  // these — fiscal 2025 in the 2025 folder, filed that May). `fy+1` would date
  // it 2026, a year past the folder it was published in, so it clamps back to
  // the folder. 136 rows across the corpus had this shape.
  it("clamps an annual whose fiscal year equals the folder year to the folder", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(
      resolveDeclarationYear({
        declType: "Annualy",
        fiscalYear: 2025,
        filedAt: null,
        sourceUrl: url("2025"),
      }).declarationYear,
    ).toBe(2025);
    expect(warn).toHaveBeenCalledOnce();
  });

  // The normal annual: filed in folder N for fiscal N-1, so fy+1 lands exactly
  // on the folder year and is NOT clamped.
  it("dates a normal annual to the folder year without clamping", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(
      resolveDeclarationYear({
        declType: "Annualy",
        fiscalYear: 2024,
        filedAt: "2025-05-14",
        sourceUrl: url("2025"),
      }).declarationYear,
    ).toBe(2025);
    expect(warn).not.toHaveBeenCalled();
  });

  // `<Year>` is read with Number(), so non-numeric content arrives as NaN — and
  // `NaN != null` is true. Gating on nullishness would take the fiscal-year rung
  // and then fail out of the chain, discarding a perfectly good filedAt.
  it("falls through a non-numeric <Year> instead of aborting", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(
      resolveDeclarationYear({
        declType: "Annualy",
        fiscalYear: Number("2023 г."),
        filedAt: "2024-05-14",
        sourceUrl: url("2024"),
      }).declarationYear,
    ).toBe(2024);
    expect(warn).toHaveBeenCalledOnce();
  });

  it("clamps a non-annual filing to the folder year, without the annual +1", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(
      resolveDeclarationYear({
        declType: "Other",
        fiscalYear: 3024,
        filedAt: null,
        sourceUrl: url("2025"),
      }).declarationYear,
    ).toBe(2025);
    expect(warn).toHaveBeenCalledOnce();
  });

  // The regression this window exists for: a 2025-folder Vacate declaring 2005.
  // Clamping it to the register floor left it dated 2005, so it sorted BELOW the
  // declarant's annual filed the same day, became the "prior" filing to
  // difference against, and published a net worth of −79,546 EUR.
  it("disbelieves a year far below its register folder", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(
      resolveDeclarationYear({
        declType: "Vacate",
        fiscalYear: 2005,
        filedAt: null,
        sourceUrl: url("2023"),
      }).declarationYear,
    ).toBe(2023);
    expect(warn).toHaveBeenCalledOnce();
  });

  // A genuinely late filing or a correction to a recent year stays believed —
  // the window is deliberately generous.
  it("still believes a plausibly late filing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(
      resolveDeclarationYear({
        declType: "Annualy",
        fiscalYear: 2021,
        filedAt: null,
        sourceUrl: url("2023"),
      }).declarationYear,
    ).toBe(2022);
    expect(warn).not.toHaveBeenCalled();
  });

  // Upstream types the filing DATE wrong too — a 2024 annual "filed" in 2004.
  // The fiscal year is right there and is believed, so the bad date is ignored.
  it("prefers a plausible fiscal year over an implausible filing date", () => {
    expect(
      resolveDeclarationYear({
        declType: "Annualy",
        fiscalYear: 2024,
        filedAt: "2004-02-27",
        sourceUrl: url("2025"),
      }).declarationYear,
    ).toBe(2025);
  });

  // ...and when BOTH are implausible, the folder is the last thing standing.
  it("falls through to the folder when year and filing date are both implausible", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(
      resolveDeclarationYear({
        declType: "Vacate",
        fiscalYear: 1998,
        filedAt: "2001-01-01",
        sourceUrl: url("2025"),
      }).declarationYear,
    ).toBe(2025);
    expect(warn).toHaveBeenCalled();
  });

  // Precedence when the rungs disagree: the fiscal year wins over the filing
  // date, which wins over the folder.
  it("prefers the fiscal year over a filing date from a different year", () => {
    expect(
      resolveDeclarationYear({
        declType: "Annualy",
        fiscalYear: 2022,
        filedAt: "2024-01-30",
        sourceUrl: url("2024"),
      }).declarationYear,
    ).toBe(2023);
  });

  it("prefers the filing date over the folder when the fiscal year is absent", () => {
    expect(
      resolveDeclarationYear({
        declType: "Entry",
        fiscalYear: null,
        filedAt: "2022-08-02",
        sourceUrl: url("2023"),
      }).declarationYear,
    ).toBe(2022);
  });

  // Disbelieving a <Year> for DATING and then publishing it as fact would be
  // incoherent — priorAssetDeclaration keys the "vs prior year" comparison on
  // fiscalYear, so a 2004 left on a 2024 filing invents a 19-year gap. Real
  // case: Ивелина Дундакова, whose Vacate and annual were filed the same day.
  it("drops an implausible fiscal year instead of publishing it", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = resolveDeclarationYear({
      declType: "Vacate",
      fiscalYear: 2004,
      filedAt: "2024-05-02",
      sourceUrl: url("2024"),
    });
    expect(r.declarationYear).toBe(2024);
    expect(r.fiscalYear).toBeNull();
  });

  it("keeps a plausible fiscal year", () => {
    const r = resolveDeclarationYear({
      declType: "Annualy",
      fiscalYear: 2023,
      filedAt: "2024-05-02",
      sourceUrl: url("2024"),
    });
    expect(r.declarationYear).toBe(2024);
    expect(r.fiscalYear).toBe(2023);
  });

  it("throws rather than invent a year when nothing can date the filing", () => {
    expect(() =>
      resolveDeclarationYear({
        declType: "Other",
        fiscalYear: null,
        filedAt: null,
        sourceUrl: "https://example.invalid/whatever.xml",
      }),
    ).toThrow(/cannot resolve declarationYear/);
  });
});

describe("parseDeclarationXml — declaration year end to end", () => {
  const parse = (xml: string, folder: string) =>
    parseDeclarationXml({
      xml,
      mpId: 0,
      institution: "Министерство на образованието и науката",
      sourceUrl: url(folder),
    });

  it("dates an annual filing from its fiscal year", () => {
    const d = parse(
      declarationXml({ type: "Annualy", year: "2023", date: "14.05.2024" }),
      "2024",
    );
    expect(d.fiscalYear).toBe(2023);
    expect(d.declarationYear).toBe(2024);
  });

  // The exact shape that produced `declarationYear: 2026, filedAt: 2023-06-28`
  // across 294 committed executive filings.
  it("dates a <Year>-less one-off filing from its filing date, not the clock", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(PIPELINE_RUN_YEAR));
    const d = parse(
      declarationXml({ type: "Other", date: "28.06.2023" }),
      "2023",
    );
    expect(d.fiscalYear).toBeNull();
    expect(d.filedAt).toBe("2023-06-28");
    expect(d.declarationYear).toBe(2023);
  });

  it("falls back to the register folder when the filing carries no date either", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(PIPELINE_RUN_YEAR));
    const d = parse(declarationXml({ type: "Other" }), "2022");
    expect(d.declarationYear).toBe(2022);
  });
});

describe("pickEurValue — money-field separator typos", () => {
  // A bank/cash row: cell A (amount) and cell C (lev-equivalent) describe the
  // same sum, so they must agree up to the peg. A wildly larger equivalent is a
  // dropped-decimal typo — value the row from the amount instead. Real case:
  // 16,415 EUR declared, lev-equivalent typed as ~3.2bn, ranking #1 at €1.6bn.
  it("distrusts a lev-equivalent that dwarfs a declared bank amount", () => {
    expect(pickEurValue(16415, "EUR", 3.2e9, true)).toBeCloseTo(16415, 0);
  });

  it("keeps a lev-equivalent that agrees with the amount", () => {
    // 11,600 BGN ≈ €5,931; equivalent field ~11,600 BGN → same.
    expect(pickEurValue(11600, "BGN", 11600, true)).toBeCloseTo(5931, 0);
  });

  // investment/security are NOT pure-money: cell A can be a share count far
  // below the market value in cell C, so the guard must not touch them.
  it("does not second-guess a share count against its market value", () => {
    // 3 shares, market value 4,266 BGN → keep the equivalent.
    expect(pickEurValue(3, "BGN", 4266, false)).toBeCloseTo(2181, 0);
  });

  it("falls back to the amount when there is no equivalent", () => {
    expect(pickEurValue(500, "EUR", null, true)).toBeCloseTo(500, 0);
  });
});
