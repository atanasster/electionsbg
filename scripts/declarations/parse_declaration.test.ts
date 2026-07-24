// Unit tests for declaration-year resolution.
//
// The year a filing belongs to drives every "latest declaration" selection in
// the app (person profile, officials profile, both asset leaderboards), all of
// which sort newest-first and take the head. A year that does not come from the
// filing itself therefore does not just mislabel one row — it reorders the
// declarant's whole history. Runs in the `node` Vitest project: pure function,
// no network, no filesystem.

import { afterEach, describe, expect, it, vi } from "vitest";
import { load } from "cheerio";
import {
  detectFormVersion,
  parseDeclarationXml,
  pickEurValue,
  resolveDeclarationYear,
} from "./parse_declaration";
import { declarationTotals } from "@/lib/declarations";

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

describe("parseEventTables — disposals and third-party expenses", () => {
  // Table 13 carries the current form's wording so these fixtures resolve as
  // 2018+ filings, the way the real documents they stand in for do.
  const V2_MARKER = "Дадени обезпечения и направени разходи";

  const withTable = (num: string, cells: Record<number, string>) => {
    const cellXml = Object.entries(cells)
      .map(([n, v]) => `<Cell Num="${n}" Description="c">${v}</Cell>`)
      .join("");
    const marker =
      num === "13"
        ? ""
        : `<Table Num="13" Description="${V2_MARKER}" Declared="False" />`;
    return `<?xml version="1.0" encoding="utf-8"?>
<PublicPerson>
  <Personal><Name>Тест</Name></Personal>
  <DeclarationData>
    <DeclarationType>Annualy</DeclarationType><Year>2024</Year>
  </DeclarationData>
  <Tables>
    ${marker}
    <Table Num="${num}" Description="${num === "13" ? V2_MARKER : "t"}" Declared="True">
      <Row Num="1">${cellXml}</Row>
    </Table>
  </Tables>
</PublicPerson>`;
  };

  const parseEvents = (xml: string) =>
    parseDeclarationXml({
      xml,
      mpId: 0,
      institution: "x",
      sourceUrl: url("2025"),
    }).events ?? [];

  it("records a property sold in the prior year", () => {
    const [e] = parseEvents(
      withTable("2", {
        2: "Нива",
        3: "Карайсен",
        4: "Павликени",
        5: "23",
        10: "20000",
        11: "възмездно",
      }),
    );
    expect(e.kind).toBe("disposal_property");
    expect(e.description).toBe("Нива");
    expect(e.municipality).toBe("Павликени");
    expect(e.valueEur).toBeCloseTo(10226, 0); // 20 000 лв at the peg
    expect(e.legalBasis).toBe("възмездно");
  });

  // The record the audit went looking for: "sold the Porsche the year before
  // leaving office" lives in table 3.5 and was never parsed.
  it("records a vehicle sold in the prior year", () => {
    const [e] = parseEvents(
      withTable("3.5", {
        2: "ЛЕК АВТОМОБИЛ",
        3: "ПОРШЕ",
        4: "37508",
        8: "възмездно",
      }),
    );
    expect(e.kind).toBe("disposal_vehicle");
    expect(e.detail).toBe("ПОРШЕ");
    expect(e.valueEur).toBeCloseTo(19178, 0);
  });

  it("records a guarantee given in the declarant's favour", () => {
    const [e] = parseEvents(
      withTable("13", { 2: "Издръжка за 3 деца", 3: "7000" }),
    );
    expect(e.kind).toBe("guarantee");
    expect(e.valueEur).toBeCloseTo(3579, 0);
  });

  it("records an expense a third party paid, with its currency", () => {
    const [e] = parseEvents(
      withTable("14", {
        2: "Китай - Япония",
        3: "3000",
        4: "BGN",
        5: "3000",
      }),
    );
    expect(e.kind).toBe("third_party_expense");
    expect(e.description).toBe("Китай - Япония");
    expect(e.currency).toBe("BGN");
    expect(e.valueEur).toBeCloseTo(1534, 0);
  });

  // The whole reason events are a separate field: a disposed property is no
  // longer in the estate, and a trip someone else paid for was never in it.
  it("keeps events out of the assets that feed net worth", () => {
    const d = parseDeclarationXml({
      xml: withTable("2", { 2: "Нива", 5: "23", 10: "20000" }),
      mpId: 0,
      institution: "x",
      sourceUrl: url("2025"),
    });
    expect(d.events).toHaveLength(1);
    expect(d.assets ?? []).toHaveLength(0);
    expect(declarationTotals(d.assets).netEur).toBe(0);
  });

  // Sale prices carry the same hand-keyed separator typos as acquisition
  // prices. Left unguarded, a flat sold for 145 000 лв published as a
  // 14.5-million-лв disposal — and the disposal feed is read for its outliers,
  // so the typo IS the headline.
  it("applies the separator-typo guard to a sale price", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const [e] = parseEvents(
      withTable("2", { 2: "апартамент", 5: "89", 10: "14500000" }),
    );
    expect(e?.valueEur).toBeCloseTo(74137, 0); // 145 000 лв at the peg
    expect(warn).toHaveBeenCalledOnce();
  });

  it("leaves a plausible sale price alone", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const [e] = parseEvents(
      withTable("2", { 2: "апартамент", 5: "89", 10: "145000" }),
    );
    expect(e?.valueEur).toBeCloseTo(74137, 0);
    expect(warn).not.toHaveBeenCalled();
  });

  it("emits nothing when the tables are not declared", () => {
    expect(
      parseEvents(declarationXml({ type: "Annualy", year: "2024" })),
    ).toEqual([]);
  });
});

// The register renumbered its tables between the pre-2018 form and the current
// one, and the numbers do NOT line up: old table 7 is "Банкови влогове" where
// the new one has "Задължения", old 9 is debts where the new one has securities,
// old 13 is income where the new one has guarantees. Reading by raw number filed
// 638 executive declarations (2015-2017, plus one straggler in the 2018 folder)
// into the wrong categories entirely — a declarant's savings counted as debt,
// their debt counted as shares, and their income leaking out as "guarantees"
// someone else had given them.
//
// The fixtures below are transcribed from a real 2016 filing
// (raw_data/officials/2016/BA0EAD62-…75329.xml, not checked in) and exercise
// both differences at once: the table NUMBERS and the one column the 2018 form
// inserted (ЕГН), which shifted every later column one place right.
describe("form versions — the pre-2018 table numbering", () => {
  const oldFormXml = `<?xml version="1.0" encoding="utf-8"?>
<PublicPerson>
  <Personal><Name>Дамян Миков Миков</Name></Personal>
  <DeclarationData>
    <DeclarationType>Annualy</DeclarationType><Year>2015</Year>
  </DeclarationData>
  <Tables>
    <Table Num="1" Description="Право на собственост и ограничени вещни права" Declared="True">
      <Row Num="1">
        <Cell Num="1">1.</Cell>
        <Cell Num="2" Description="Вид на имота /правото/">вила с вилно място</Cell>
        <Cell Num="3" Description="Местонахождение">землището на с. Хрищени</Cell>
        <Cell Num="4" Description="Община">Стара Загора</Cell>
        <Cell Num="5" Description="Площ кв.м.">500</Cell>
        <Cell Num="6" Description="Разгъната застроена площ - кв.м.">35</Cell>
        <Cell Num="7" Description="Година на придобиване">2013</Cell>
        <Cell Num="8" Description="Име: собствено, бащино, фамилно">Дамян Миков Миков</Cell>
        <Cell Num="9" Description="Идеална част">1</Cell>
        <Cell Num="10" Description="Цена на придобиване /лева/">1200</Cell>
        <Cell Num="11" Description="Правно основание за придобиване">покупка</Cell>
      </Row>
    </Table>
    <Table Num="7" Description="Банкови влогове /депозити/" Declared="True">
      <Row Num="1">
        <Cell Num="1">1.</Cell>
        <Cell Num="2" Description="Размер на средствата">4500</Cell>
        <Cell Num="3" Description="Вид на валутата">BGN</Cell>
        <Cell Num="4" Description="Равностойност в лв." />
        <Cell Num="5" Description="Име: собствено, бащино, фамилно">Дамян Миков Миков</Cell>
        <Cell Num="6" Description="В страната">България</Cell>
      </Row>
    </Table>
    <Table Num="9" Description="Задължения над 5000 лева" Declared="True">
      <Row Num="1">
        <Cell Num="1">1.</Cell>
        <Cell Num="2" Description="Вид  на задължението">Потребителски кредит</Cell>
        <Cell Num="3" Description="Размер на задължението">31000</Cell>
        <Cell Num="4" Description="Вид на валутата">BGN</Cell>
        <Cell Num="5" Description="Равностойност в лв." />
        <Cell Num="6" Description="Име: собствено, бащино, фамилно">Дамян Миков Миков</Cell>
        <Cell Num="7" Description="Правно основание за задължението">Договор</Cell>
        <Cell Num="8" Description="Към банки">ДСК</Cell>
      </Row>
    </Table>
    <Table Num="11" Description="Дялове в дружества с ограничена отговорност" Declared="True">
      <Row Num="1">
        <Cell Num="1">1.</Cell>
        <Cell Num="2" Description="Вид на имуществото">Дружествени дялове</Cell>
        <Cell Num="3" Description="Размер на дяловото участие">100%</Cell>
        <Cell Num="4" Description="Наименование на дружеството">Рос-Мари ЕООД</Cell>
        <Cell Num="5" Description="Седалище">Стара Загора</Cell>
        <Cell Num="6" Description="Стойност на дяловото участие">5000</Cell>
        <Cell Num="7" Description="Име: собствено, бащино, фамилно">Росица Неделчева Микова</Cell>
        <Cell Num="8" Description="Правно основание за придобиването">учредяване</Cell>
      </Row>
    </Table>
    <Table Num="13" Description="Доходи извън тези за заеманата длъжност" Declared="True">
      <Row Num="1">
        <Cell Num="1">1.</Cell>
        <Cell Num="2" Description="Видове доход от">Годишна данъчна основа за доходи от трудови правоотношения</Cell>
        <Cell Num="3" Description="На декларатора /лв./">24000</Cell>
        <Cell Num="4" Description="На съпруга/та /лв./">12000</Cell>
      </Row>
    </Table>
    <Table Num="15" Description="Направени разходи от или в полза на декларатора" Declared="True">
      <Row Num="1">
        <Cell Num="1">1.</Cell>
        <Cell Num="2" Description="Вид на разхода">Пътуване</Cell>
        <Cell Num="3" Description="Размер на разхода">3000</Cell>
        <Cell Num="4" Description="Вид на валутата">BGN</Cell>
        <Cell Num="5" Description="Равностойност в лева">3000</Cell>
      </Row>
    </Table>
  </Tables>
</PublicPerson>`;

  const parsed = () =>
    parseDeclarationXml({
      xml: oldFormXml,
      mpId: 0,
      institution: "x",
      sourceUrl: url("2016"),
    });

  const assetsOf = (category: string) =>
    (parsed().assets ?? []).filter((a) => a.category === category);

  it("detects the old form from a table description, not from the folder year", () => {
    expect(detectFormVersion(load(oldFormXml, { xmlMode: true }))).toBe("v1");
  });

  it("assumes the current form when no old-form table is present", () => {
    expect(
      detectFormVersion(
        load(declarationXml({ type: "Annualy", year: "2024" }), {
          xmlMode: true,
        }),
      ),
    ).toBe("v2");
  });

  // Old 7 = deposits. Read as a new-form number it is "Задължения" — the
  // declarant's savings would land on the liability side of their net worth.
  it("reads old table 7 as a bank deposit, not as a debt", () => {
    const bank = assetsOf("bank");
    expect(bank).toHaveLength(1);
    expect(bank[0]?.amount).toBe(4500);
    expect(assetsOf("debt")).toHaveLength(1);
  });

  // Old 9 = debts. Read as a new-form number it is "Ценни книги" — the debt
  // would count as an ASSET, moving net worth by twice its size.
  it("reads old table 9 as a debt, not as a security", () => {
    const debt = assetsOf("debt");
    expect(debt[0]?.amount).toBe(31000);
    expect(debt[0]?.description).toBe("Потребителски кредит");
    // Column 7 in the old form, 8 in the new one — the ЕГН shift.
    expect(debt[0]?.legalBasis).toBe("Договор");
    expect(assetsOf("security")).toHaveLength(0);
  });

  // Old 13 = income. Read as a new-form number it is "Дадени обезпечения", so
  // every income line surfaced as a gift someone had made to the declarant.
  it("reads old table 13 as income, not as a guarantee event", () => {
    const d = parsed();
    expect(d.income).toHaveLength(1);
    expect(d.income[0].amountEurDeclarant).toBeCloseTo(12271, 0);
    expect(d.income[0].amountEurSpouse).toBeCloseTo(6135.5, 0);
    expect((d.events ?? []).some((e) => e.kind === "guarantee")).toBe(false);
  });

  it("reads old table 15 as the third-party expense table", () => {
    const [e] = (parsed().events ?? []).filter(
      (x) => x.kind === "third_party_expense",
    );
    expect(e.description).toBe("Пътуване");
    expect(e.valueEur).toBeCloseTo(1534, 0);
  });

  // Old 11 = ООД stakes; the new form moved them to 10 and inserted ЕГН after
  // the holder, so the holder and legal basis sit one column earlier here.
  it("reads old table 11 as an ownership stake with the right holder", () => {
    const [s] = parsed().ownershipStakes;
    expect(s.companyName).toBe("Рос-Мари ЕООД");
    expect(s.holderName).toBe("Росица Неделчева Микова");
    expect(s.legalBasis).toBe("учредяване");
    expect(s.valueEur).toBeCloseTo(2556, 0);
  });

  // A minimal old-form document carrying only the tables a test cares about.
  // Table 13 is always present so the version resolves the way a real filing
  // does; the rest is whatever the test needs.
  const v1Doc = (tables: Record<string, Record<number, string>>) => {
    const tableXml = Object.entries(tables)
      .map(([num, cells]) => {
        const cellXml = Object.entries(cells)
          .map(([n, v]) => `<Cell Num="${n}" Description="c">${v}</Cell>`)
          .join("");
        return `<Table Num="${num}" Description="t" Declared="True"><Row Num="1">${cellXml}</Row></Table>`;
      })
      .join("");
    return `<?xml version="1.0" encoding="utf-8"?>
<PublicPerson>
  <Personal><Name>Тест</Name></Personal>
  <DeclarationData>
    <DeclarationType>Annualy</DeclarationType><Year>2015</Year>
  </DeclarationData>
  <Tables>
    <Table Num="13" Description="Доходи извън тези за заеманата длъжност" Declared="True">
      <Row Num="1"><Cell Num="1">1.</Cell></Row>
    </Table>
    ${tableXml}
  </Tables>
</PublicPerson>`;
  };

  const parseV1 = (tables: Record<string, Record<number, string>>) =>
    parseDeclarationXml({
      xml: v1Doc(tables),
      mpId: 0,
      institution: "x",
      sourceUrl: url("2016"),
    });

  // The sharpest crossover in the renumbering: the old form's cash table is 6
  // and its vessels table is 4, while the new form puts CASH at 4. Read by raw
  // number, a declarant's boat became a pile of cash.
  it("reads old table 6 as cash and old table 4 as a vessel, not the reverse", () => {
    const d = parseV1({
      "4": { 2: "яхта", 3: "Бавария", 4: "40000", 5: "2010", 6: "Тест" },
      "6": { 2: "8000", 3: "BGN", 5: "Тест" },
    });
    const cash = (d.assets ?? []).filter((a) => a.category === "cash");
    const vehicles = (d.assets ?? []).filter((a) => a.category === "vehicle");
    expect(cash).toHaveLength(1);
    expect(cash[0]?.amount).toBe(8000);
    expect(vehicles).toHaveLength(1);
    expect(vehicles[0]?.detail).toBe("Бавария");
  });

  // Old 8 = receivables (new 6), old 10 = securities (new 9). Read raw, a
  // receivable surfaced as a debt and a security as a stake.
  it("reads old table 8 as a receivable and old table 10 as a security", () => {
    const d = parseV1({
      "8": { 2: "Заем", 3: "12000", 4: "BGN", 6: "Тест", 7: "договор" },
      "10": { 2: "акции", 3: "500", 6: "Емитент АД", 7: "9000", 8: "Тест" },
    });
    const rec = (d.assets ?? []).filter((a) => a.category === "receivable");
    const sec = (d.assets ?? []).filter((a) => a.category === "security");
    expect(rec[0]?.amount).toBe(12000);
    expect(sec[0]?.amount).toBe(9000);
    expect(sec[0]?.detail).toBe("Емитент АД");
    expect(d.ownershipStakes).toHaveLength(0);
  });

  // Old 14 = guarantees, in the slot the old form uses for income (13) under
  // the new numbering. Both must land in their own bucket at once.
  it("reads old table 14 as a guarantee event", () => {
    const d = parseV1({ "14": { 2: "Ипотека", 3: "36900" } });
    const guarantees = (d.events ?? []).filter((e) => e.kind === "guarantee");
    expect(guarantees).toHaveLength(1);
    expect(guarantees[0]?.description).toBe("Ипотека");
  });

  it("reads old table 5 as a vehicle disposal, not as a transferred property", () => {
    const d = parseV1({ "5": { 2: "лек автомобил", 3: "Ситроен", 4: "2400" } });
    const events = d.events ?? [];
    expect(events).toHaveLength(1);
    expect(events[0]?.kind).toBe("disposal_vehicle");
    expect(events[0]?.detail).toBe("Ситроен");
  });

  // The null entries in TABLE_NUMS.v1 are load-bearing: the old form simply has
  // no investment-fund table, and "completing" the map with a plausible number
  // would start reading some other table as one.
  it("yields no investment assets for an old-form filing — v1 has no such table", () => {
    const d = parseV1({
      "8": { 2: "Заем", 3: "12000", 4: "BGN", 6: "Тест" },
    });
    expect((d.assets ?? []).some((a) => a.category === "investment")).toBe(
      false,
    );
  });

  it("falls back to table 15 when the filing carries no table 13", () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<PublicPerson><Personal><Name>Тест</Name></Personal>
<DeclarationData><DeclarationType>Annualy</DeclarationType><Year>2015</Year></DeclarationData>
<Tables><Table Num="15" Description="Направени разходи от или в полза на декларатора" Declared="True"><Row Num="1"><Cell Num="1">1.</Cell></Row></Table></Tables>
</PublicPerson>`;
    expect(detectFormVersion(load(xml, { xmlMode: true }))).toBe("v1");
  });

  it("assumes the current form when table 15 is the conflict-of-interest section", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<PublicPerson><Personal><Name>Тест</Name></Personal>
<DeclarationData><DeclarationType>Annualy</DeclarationType><Year>2024</Year></DeclarationData>
<Tables><Table Num="15" Description="Дружество" Declared="True"><Row Num="1"><Cell Num="1">1.</Cell></Row></Table></Tables>
</PublicPerson>`;
    expect(detectFormVersion(load(xml, { xmlMode: true }))).toBe("v2");
    // Guessing the version wrong misfiles a whole declaration, so the guess is
    // never silent when the filing actually carries tables.
    expect(warn).toHaveBeenCalledOnce();
  });

  // Table 1 keeps its number across both forms, but not its columns: the old
  // form has price at 10 and legal basis at 11 where the new one has 11 and 12.
  it("shifts real-estate columns back by the ЕГН cell the new form added", () => {
    const [re] = assetsOf("real_estate");
    expect(re?.amount).toBe(1200);
    expect(re?.share).toBe("1");
    expect(re?.legalBasis).toBe("покупка");
    expect(re?.holderName).toBe("Дамян Миков Миков");
  });
});
