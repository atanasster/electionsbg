// Unit gate for the structured declaration reader.
//
// Fixtures are hand-built `Row` arrays transcribed from real ИВСС declarations (Сотир
// Цацаров's 2026 annual and his July 2022 entry filing, both verified against the PDFs and
// — for the 2026 one — against BIRD's independent reporting of the same four properties).
// No network, no PDF: this file tests the RULES, and the corpus-wide behaviour is measured
// separately by scripts/judiciary/validate_declaration_parse.ts.
//
// The assertions that matter most here are the REFUSALS. Phase 6's finding was not that
// this form is hard to parse, it is that a bad parse and a good one look identical — so
// every test that proves the reader declines something is doing the load-bearing work.

import { describe, it, expect } from "vitest";
import {
  columnMapFor,
  declarationMeta,
  isHeaderRow,
  isRefusal,
  readTable,
  tableRows,
  toRows,
  type Item,
  type Row,
  priceCurrency,
} from "./declarationTables";

/** Build a row at baseline `y` from [x, text] pairs. */
const row = (y: number, cells: [number, string][]): Row =>
  cells.map(([x, s]) => ({ s, x, y }) satisfies Item);

/** The 12-column header Таблица № 1 prints. */
const HDR_12 = (y: number): Row =>
  row(
    y,
    Array.from({ length: 12 }, (_, i) => [40 + i * 40, String(i + 1)]),
  );

const propertyRow = (
  y: number,
  ord: number,
  kind: string,
  place: string,
  price: string,
  acquired: string,
): Row =>
  row(y, [
    [40, `${ord}.`],
    [80, kind],
    [120, place],
    [160, "София-град"],
    [200, "110"],
    [240, "110"],
    [280, price],
    [320, acquired],
    [360, "Сотир Стефанов Цацаров"],
    [400, "1/1"],
    [440, "покупко-продажба"],
    [480, "продажба имот, наеми"],
  ]);

/** Таблица 1 as the pre-v3.0 form lays it out: година at 7, собственик at 8, идеална част at
 *  9, цена at 10 — the same twelve columns as v3.0 in a different order. */
const LEGACY_PAGE: Row[] = [
  row(700, [
    [40, "1. Право на собственост и ограничени вещни права:"],
    [400, "Таблица № 1"],
  ]),
  row(690, [
    [40, "Ном."],
    [280, "Година"],
    [320, "Собственик"],
    [400, "Цена на"],
  ]),
  row(685, [[400, "придоби-"]]),
  row(682, [[400, "/лева/"]]),
  HDR_12(660),
  row(640, [
    [40, "1."],
    [80, "апартамент"],
    [120, "гр. Плевен"],
    [160, "Плевен"],
    [200, "72"],
    [240, "72"],
    [280, "1993"],
    [320, "Иван Радков Диков"],
    [360, "1/1"],
    [400, "48000"],
    [440, "покупко-продажба"],
    [480, "заплата"],
  ]),
];

const TABLE1_PAGE: Row[] = [
  row(700, [
    [40, "1. Право на собственост и ограничени вещни права:"],
    [400, "Таблица № 1"],
  ]),
  row(680, [
    [40, "Ном."],
    [200, "Площ"],
    [280, "Цена на"],
  ]),
  HDR_12(660),
  propertyRow(
    640,
    1,
    "апартамент със склад - груб строеж",
    "гр. София",
    "178665",
    "2025",
  ),
  propertyRow(620, 2, "гараж - груб строеж", "гр. София", "19950", "2025"),
  propertyRow(600, 3, "гараж - груб строеж", "гр. София", "19550", "2025"),
  propertyRow(580, 4, "вила", "Балчик", "234700", "2025"),
  row(560, [[40, "Нямам нищо за деклариране"]]),
  row(540, [
    [40, "1a. Земеделски земи и гори:"],
    [400, "Таблица № 1.1"],
  ]),
];

describe("isHeaderRow", () => {
  it("accepts the form's strict 1..n numbered header", () => {
    expect(isHeaderRow(HDR_12(100))).toBe(true);
  });

  it("rejects a money row, which is also mostly digits", () => {
    // The discriminating case. A looser test ("most cells are numeric") would adopt a
    // column map derived from somebody's declared bank balances.
    expect(
      isHeaderRow(
        row(100, [
          [40, "1."],
          [80, "4500"],
          [120, "BGN"],
          [160, "4500"],
        ]),
      ),
    ).toBe(false);
  });

  it("rejects a sequence that skips or restarts", () => {
    expect(
      isHeaderRow(
        row(100, [
          [40, "1"],
          [80, "2"],
          [120, "4"],
        ]),
      ),
    ).toBe(false);
  });
});

describe("columnMapFor", () => {
  it("maps the table under its caption", () => {
    const m = columnMapFor(TABLE1_PAGE, /Право на собственост/, 12);
    expect(isRefusal(m)).toBe(false);
    if (!isRefusal(m)) expect(m.count).toBe(12);
  });

  it("refuses when the caption is absent", () => {
    const m = columnMapFor(TABLE1_PAGE, /Банкови сметки/, 8);
    expect(isRefusal(m) && m.kind).toBe("no-header");
  });

  it("refuses a header whose column count is not the expected one", () => {
    // A form revision that adds or drops a column must REFUSE, not silently shift every
    // value one place — that is how a „правно основание" gets published as a price.
    const m = columnMapFor(TABLE1_PAGE, /Право на собственост/, 10);
    expect(isRefusal(m) && m.kind).toBe("column-count");
    if (isRefusal(m) && m.kind === "column-count") expect(m.got).toBe(12);
  });
});

describe("tableRows", () => {
  it("reads each declared property into its own numbered columns", () => {
    const m = columnMapFor(TABLE1_PAGE, /Право на собственост/, 12);
    if (isRefusal(m)) throw new Error("expected a map");
    const rows = tableRows(TABLE1_PAGE, m);
    expect(rows.map((r) => r.ord)).toEqual([1, 2, 3, 4]);
    // Cells are keyed by the column number the FORM prints. Таблица № 1 numbers its OWN
    // ordinal as column 1 („Ном. по ред"), so вид is 2, цена на сделката is 7 and година
    // на придобиване is 8 — the code reads the same indices a person reading the page
    // would. Getting this off by one is precisely the failure the column map exists to
    // prevent: it publishes „правно основание" as a price.
    expect(rows[3].cells[2]).toBe("вила");
    expect(rows[3].cells[7]).toBe("234700");
    expect(rows[3].cells[8]).toBe("2025");
    expect(rows[3].cells[10]).toBe("1/1");
  });

  it("reads the same values whatever the header alignment", () => {
    // ⚠️ THE DEFECT THIS EXISTS FOR. The header digits are not reliably aligned with the
    // text beneath them. Printed CENTRED — the ordinary way to typeset `1 | 2 | … | 12` —
    // an edge-with-tolerance assignment shifted every value one column LEFT, so „Цена на
    // сделката" came back holding the acquisition year and вид held the location. The row
    // COUNT was unchanged, so the validation harness reported 100% agreement on it.
    for (const [label, offset] of [
      ["left-aligned", 0],
      ["centred", 18],
      ["right-aligned", 34],
    ] as const) {
      const hdr = row(
        660,
        Array.from({ length: 12 }, (_, i) => [
          40 + i * 40 + offset,
          String(i + 1),
        ]),
      );
      const page = [
        TABLE1_PAGE[0],
        hdr,
        propertyRow(640, 1, "вила", "Балчик", "234700", "2025"),
      ];
      const m = columnMapFor(page, /Право на собственост/, 12);
      if (isRefusal(m)) throw new Error(`${label}: expected a map`);
      const r = tableRows(page, m)[0];
      expect(r.cells[2], label).toBe("вила");
      expect(r.cells[7], label).toBe("234700");
      expect(r.cells[8], label).toBe("2025");
    }
  });

  it("stops at the next table rather than absorbing it", () => {
    const m = columnMapFor(TABLE1_PAGE, /Право на собственост/, 12);
    if (isRefusal(m)) throw new Error("expected a map");
    expect(tableRows(TABLE1_PAGE, m)).toHaveLength(4);
  });

  it("skips an empty form slot instead of returning a row of blanks", () => {
    const page = [
      ...TABLE1_PAGE.slice(0, 3),
      row(640, [[40, "1."]]), // the printed but unfilled slot
      row(620, [[40, "2."]]),
    ];
    const m = columnMapFor(page, /Право на собственост/, 12);
    if (isRefusal(m)) throw new Error("expected a map");
    expect(tableRows(page, m)).toHaveLength(0);
  });
});

/** Page 1 of a v3.0 form — `readTable` refuses a document without it.
 *
 *  It carries the price column's unit as well as the version, because a real form always
 *  prints one and `readTable` now refuses a document whose unit it cannot read: the two
 *  mapped versions are denominated differently (v3.0 лева, v4.0 евро), so an amount with no
 *  unit is a figure off by 1.95583 waiting for a consumer to assume one. */
const VERSION_PAGE: Row[] = [
  row(760, [[400, "v.3.0 / 22.11.2022 г."]]),
  // The unit as the form actually prints it: the price column's label wraps across three
  // visual rows, and priceCurrency() anchors on „Цена на" rather than scanning the page —
  // the document is full of other slash-delimited tokens („/правото/", „/кв.м./"), and the
  // declarant's own free text sits nearby.
  row(752, [[361, "Цена на"]]),
  row(746, [[359, "сделката"]]),
  row(740, [[365, "/лева/"]]),
];

/** The same page as the ИВСС reissued it for the euro: v4.0, identical column map, and the
 *  one thing that actually changed. */
const VERSION_PAGE_V4: Row[] = [
  row(760, [[400, "v.4.0 / 15.01.2026 г."]]),
  row(752, [[361, "Цена на"]]),
  row(746, [[359, "сделката"]]),
  row(740, [[365, "/евро/"]]),
];

describe("readTable across pages", () => {
  it("refuses an unversioned document laid out the MODERN way", () => {
    // ⚠️ THE FINDING THIS GATE EXISTS FOR. The old Таблица 1 runs
    // „… 7 година | 8 собственик | 9 идеална част | 10 цена …" where v3.0 runs
    // „… 7 цена | 8 година | 9 собственик | 10 идеална част …" — twelve columns either way,
    // so a column-COUNT guard passes and every value lands under the wrong heading.
    // Measured over 60 sampled filings: „година на придобиване" came back holding the
    // declarant's NAME on five of them, and „цена на сделката" holding
    // „1997 Радослав Петров Маринов". The row count is identical, so the count-based half
    // of the validation harness reported 100% agreement on exactly those documents.
    // The pre-v3.0 form IS mapped now, and a document printing no revision is assumed to be
    // it — the 2017-2020 form states none. But that assumption is only safe because the
    // labels then have to agree: here „Цена на" sits at column 7, where v3.0 puts it and the
    // legacy layout does not, so reading it as legacy would put the price under „идеална
    // част". Refused instead.
    //
    // (This is the reachable half of `requireProof`. A document with NO price label at all is
    // already refused one step earlier as `currency`, since the unit is read from that same
    // header — so „unversioned and completely unlabelled" never gets this far.)
    const modernLaidOut: Row[] = [
      row(695, [[280, "Цена на"]]),
      row(692, [[280, "/лева/"]]),
      ...TABLE1_PAGE,
    ];
    const t = readTable([modernLaidOut], /Право на собственост/, 12);
    expect(isRefusal(t) && t.kind).toBe("column-role");
  });

  it("reads the legacy layout, putting each value under its own heading", () => {
    // ⚠️ The whole point. Verified against real v2.0/2.1/2.2 and unversioned filings: all four
    // run „… 7 година | 8 собственик | 9 идеална част | 10 цена …". Read with the modern map
    // the year lands in the price column and the declarant's NAME in the year column — both
    // look like data, which is why the count-based harness reported 100% agreement on exactly
    // these documents.
    const t = readTable([LEGACY_PAGE], /Право на собственост/, 12);
    expect(isRefusal(t)).toBe(false);
    if (!isRefusal(t)) {
      const c = t.rows[0].cells;
      expect(c[7]).toBe("1993"); // година, NOT the price
      expect(c[8]).toBe("Иван Радков Диков"); // собственик
      expect(c[10]).toBe("48000"); // цена, at 10 and not 7
    }
  });

  it("refuses a document whose labels contradict its declared era", () => {
    // The era comes from the revision string, which is an assumption from one sample per
    // bucket; the labels are the document's own answer. When they disagree the document wins
    // — every value would otherwise be shifted by one heading.
    const mismatched: Row[] = [
      row(760, [[400, "v.3.0 / 22.11.2022 г."]]),
      row(752, [[361, "Цена на"]]),
      row(740, [[365, "/лева/"]]),
      ...LEGACY_PAGE, // …but laid out the OLD way
    ];
    const t = readTable([mismatched], /Право на собственост/, 12);
    expect(isRefusal(t) && t.kind).toBe("column-role");
  });

  it("accepts the v3.0 form it has a verified map for", () => {
    const t = readTable(
      [VERSION_PAGE, TABLE1_PAGE],
      /Право на собственост/,
      12,
    );
    expect(isRefusal(t)).toBe(false);
    if (!isRefusal(t)) expect(t.rows).toHaveLength(4);
  });

  it("accepts v4.0, which is v3.0 re-denominated rather than re-laid-out", () => {
    // Verified against 6 v4.0 and 2 v3.0 filings before it was admitted: the header declares
    // the same 12 columns at the same x-positions in the same order, and the ONLY difference
    // in the table is the price column's unit. So they share one map.
    const t = readTable(
      [VERSION_PAGE_V4, TABLE1_PAGE],
      /Право на собственост/,
      12,
    );
    expect(isRefusal(t)).toBe(false);
    if (!isRefusal(t)) expect(t.rows).toHaveLength(4);
  });

  it("reads the price unit off the document, and does not infer it from the version", () => {
    // ⚠️ The trap this closes is the YEAR heuristic, not the version one. 2026 carries BOTH
    // forms — 3,483 v3.0 filings in лева beside 201 v4.0 in евро — so anything keyed on the
    // year restates thousands of prices at 1.95583× against named judges.
    expect(priceCurrency([VERSION_PAGE])).toBe("BGN");
    expect(priceCurrency([VERSION_PAGE_V4])).toBe("EUR");
    // …and a version-shaped guess is refused: a v4.0 page that actually says лева is лева.
    const mixed: Row[] = [
      row(760, [[400, "v.4.0 / 15.01.2026 г."]]),
      row(752, [[361, "Цена на"]]),
      row(740, [[365, "/лева/"]]),
    ];
    expect(priceCurrency([mixed])).toBe("BGN");
  });

  it("does not let stray slash-delimited text elsewhere decide the unit", () => {
    // ⚠️ The form prints „/правото/", „/кв.м./", „/декара/", „/подпис/" — and the declarant's
    // own free text sits on the same pages. A page-wide search lets any of it decide what a
    // judge's declared prices are denominated in.
    const decoy: Row[] = [
      row(760, [[400, "v.4.0 / 15.01.2026 г."]]),
      row(700, [[100, "Вид на имота /правото/"]]),
      row(690, [[100, "получено в /евро/ по банков път"]]), // declarant free text
      row(652, [[361, "Цена на"]]),
      row(640, [[365, "/лева/"]]),
    ];
    expect(priceCurrency([decoy])).toBe("BGN");
  });

  it("refuses a mapped form whose price column states no unit at all", () => {
    // A price with no unit is worse than no price: it is stored under whichever unit the
    // consumer assumes, and looks entirely ordinary while being off by a factor of two.
    const noUnit: Row[] = [row(760, [[400, "v.4.0 / 15.01.2026 г."]])];
    const t = readTable([noUnit, TABLE1_PAGE], /Право на собственост/, 12);
    expect(isRefusal(t)).toBe(true);
    if (isRefusal(t)) expect(t.kind).toBe("currency");
  });

  it("follows a table onto a continuation page that has no caption or header", () => {
    // Цацаров's entry declaration lists 11 properties, 1-6 on one page and 7-11 on the
    // next with nothing but ordinals. Reading page by page returns 6 of 11 — a wrong
    // answer about a named judge's estate rather than a missing one.
    const p1 = [
      ...TABLE1_PAGE.slice(0, 3),
      propertyRow(640, 1, "апартамент", "Пловдив", "0", "2012"),
      propertyRow(620, 2, "парцел ид. част", "София", "3065", "2012"),
    ];
    const p2 = [
      row(700, [[40, "Име на декларатора"]]),
      propertyRow(640, 3, "ателие", "Пловдив", "40000", "2007"),
      propertyRow(620, 4, "вила", "Пещера", "58675", "2018"),
    ];
    const t = readTable([VERSION_PAGE, p1, p2], /Право на собственост/, 12);
    if (isRefusal(t)) throw new Error("expected rows");
    expect(t.rows.map((r) => r.ord)).toEqual([1, 2, 3, 4]);
  });

  it("does not absorb a later numbered table whose ordinals restart", () => {
    const p1 = [
      ...TABLE1_PAGE.slice(0, 3),
      propertyRow(640, 1, "апартамент", "Пловдив", "0", "2012"),
    ];
    const p2 = [
      row(700, [
        [40, "3. Вземания:"],
        [400, "Таблица № 12"],
      ]),
      propertyRow(640, 1, "нещо друго", "някъде", "1", "2020"),
    ];
    const t = readTable([VERSION_PAGE, p1, p2], /Право на собственост/, 12);
    if (isRefusal(t)) throw new Error("expected rows");
    expect(t.rows).toHaveLength(1);
  });
});

describe("declarationMeta", () => {
  const decl = (marker: string, period?: string): Row[] => [
    row(700, [[40, "Д Е К Л А Р И Р А М:"]]),
    row(680, [[40, marker]]),
    row(660, [
      [40, "като:"],
      [90, "01.01."],
      [130, "–"],
      [160, `31.12${period ? ` ${period}` : ""}`],
      [220, "год."],
    ]),
    // The form's own footnote — the trap the row-scoped match exists for.
    row(400, [
      [
        40,
        "- Колона 2 се попълва, когато лицето подава ежегодна декларация до 15 май, докато лицето заема съответната длъжност.",
      ],
    ]),
  ];

  it("reads an annual filing and the year it covers", () => {
    expect(declarationMeta(decl("Е Ж Е Г О Д Н А", "2025"))).toEqual({
      kind: "annual",
      periodYear: 2025,
    });
  });

  it("does not read the footnote's mention of ежегодна as the marker", () => {
    // Case-insensitively searching the flattened page finds that word on EVERY
    // declaration, including entry ones, and reports the whole corpus as annual —
    // measured, exactly what happened to Цацаров's July 2022 entry filing.
    const m = declarationMeta(
      decl("ПРИ ВЪЗНИКВАНЕ НА КАЧЕСТВОТО, КОЕТО Е ОСНОВАНИЕ"),
    );
    expect(m.kind).toBe("entry");
  });

  it("returns unknown when the declarant marked nothing", () => {
    // A real and common state — the form is printed with no box ticked. „unknown" is the
    // document's answer and must not be rounded to „annual".
    expect(declarationMeta(decl("Име на декларатора")).kind).toBe("unknown");
  });

  it("returns a null period rather than inventing one", () => {
    // Entry and exit filings are anchored to a DATE and leave the period blank by design,
    // and plenty of annuals leave it blank too. Nothing may substitute the filing year.
    expect(declarationMeta(decl("Е Ж Е Г О Д Н А")).periodYear).toBeNull();
  });

  it("ignores a year that is not the period's own", () => {
    const rows = [
      row(700, [[40, "Д Е К Л А Р И Р А М:"]]),
      row(680, [[40, "Е Ж Е Г О Д Н А"]]),
      row(660, [
        [40, "№"],
        [80, "РД-08-176"],
        [120, "/ 01.03. 20 22 г."],
      ]),
      row(640, [
        [40, "като:"],
        [90, "01.01."],
        [160, "31.12"],
        [220, "год."],
      ]),
    ];
    expect(declarationMeta(rows).periodYear).toBeNull();
  });

  it("does not pull a year across a row boundary", () => {
    // Anchoring on „31.12" over the FLATTENED page joined a money table's „към 31.12."
    // header to the next row's leading year and returned it as the covered period — i.e.
    // invented one for exactly the entry/exit filings that leave it blank by design.
    const rows = [
      row(700, [[40, "Д Е К Л А Р И Р А М:"]]),
      row(680, [[40, "ПРИ ВЪЗНИКВАНЕ НА КАЧЕСТВОТО, КОЕТО Е ОСНОВАНИЕ"]]),
      row(660, [
        [40, "като:"],
        [90, "01.01."],
        [160, "31.12"],
        [220, "год."],
      ]),
      row(500, [[40, "Налични парични средства към 31.12."]]),
      row(480, [
        [40, "2019"],
        [80, "нещо"],
      ]),
    ];
    const m = declarationMeta(rows);
    expect(m.kind).toBe("entry");
    expect(m.periodYear).toBeNull();
  });

  it("reads a lowercase marker row, because the row SHAPE is the defence", () => {
    // The module comment used to claim case-sensitivity was the mechanism. It is not —
    // `letters()` upper-cases. What a footnote can never do is BE a row containing only the
    // phrase, and that is what discriminates. Pinned so the claim and the code agree.
    expect(declarationMeta(decl("е ж е г о д н а")).kind).toBe("annual");
  });
});

describe("toRows", () => {
  it("buckets runs sharing a baseline and orders them left to right", () => {
    const items: Item[] = [
      { s: "b", x: 200, y: 500 },
      { s: "a", x: 100, y: 501 }, // within the 3pt tolerance
      { s: "c", x: 100, y: 480 },
    ];
    expect(toRows(items).map((r) => r.map((i) => i.s))).toEqual([
      ["a", "b"],
      ["c"],
    ]);
  });
});
