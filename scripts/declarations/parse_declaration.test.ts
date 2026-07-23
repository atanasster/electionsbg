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
      }),
    ).toBe(2024);
  });

  it("dates a non-annual filing to its fiscal year as-is", () => {
    expect(
      resolveDeclarationYear({
        declType: "Vacate",
        fiscalYear: 2023,
        filedAt: "2023-07-04",
        sourceUrl: url("2023"),
      }),
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
      }),
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
      }),
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
      }),
    ).toBe(2021);
  });

  it("clamps an impossible fiscal year to the folder bound and warns", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(
      resolveDeclarationYear({
        declType: "Annualy",
        fiscalYear: 3024,
        filedAt: "2025-04-01",
        sourceUrl: url("2025"),
      }),
    ).toBe(2026);
    expect(warn).toHaveBeenCalledOnce();
  });

  it("accepts an annual whose fiscal year equals the folder year (+1 is legitimate)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(
      resolveDeclarationYear({
        declType: "Annualy",
        fiscalYear: 2025,
        filedAt: null,
        sourceUrl: url("2025"),
      }),
    ).toBe(2026);
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
      }),
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
      }),
    ).toBe(2025);
    expect(warn).toHaveBeenCalledOnce();
  });

  it("clamps a year that predates the register itself", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(
      resolveDeclarationYear({
        declType: "Vacate",
        fiscalYear: 1900,
        filedAt: null,
        sourceUrl: url("2023"),
      }),
    ).toBe(2005);
    expect(warn).toHaveBeenCalledOnce();
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
      }),
    ).toBe(2023);
  });

  it("prefers the filing date over the folder when the fiscal year is absent", () => {
    expect(
      resolveDeclarationYear({
        declType: "Entry",
        fiscalYear: null,
        filedAt: "2022-08-02",
        sourceUrl: url("2023"),
      }),
    ).toBe(2022);
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
