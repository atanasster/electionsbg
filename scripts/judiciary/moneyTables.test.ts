// ИВСС money tables 10/11/13 against four filings READ BY HAND off the PDFs on 2026-10-21 —
// Phase 6's two documented failures (Kovachev's 24% undercount, Shutova's „false positive")
// plus Цацаров and Адамова-Петкова. Fixtures are the positioned rows crawl_declarations.ts
// extracts, trimmed to the pages the reader uses.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isRefusal, type Row } from "./declarationTables";
import {
  normCurrency,
  parseMoney,
  readMoneyTables,
  type MoneyRow,
  type MoneyTableResult,
} from "./moneyTables";

const pages = (f: string): Row[][] =>
  JSON.parse(
    readFileSync(
      path.join(
        path.dirname(fileURLToPath(import.meta.url)),
        "__fixtures__",
        f,
      ),
      "utf8",
    ),
  );

const ok = (v: unknown): MoneyTableResult => {
  if (isRefusal(v as never)) throw new Error(`refused: ${JSON.stringify(v)}`);
  return v as MoneyTableResult;
};
/** [amount, currency, equivalence] per row — the three cells the anchor reads. */
const triples = (rows: MoneyRow[]) =>
  rows.map((r) => [r.amount, r.currency, r.equiv]);
/** The declared лев value of a table: the equivalence when given, else a лев amount. */
const lev = (rows: MoneyRow[]) =>
  rows.reduce(
    (s, r) => s + (r.equiv ?? (r.currency === "BGN" ? r.amount : 0)),
    0,
  );

describe("Kovachev 2025 — Phase 6's 24% undercount", () => {
  const t = readMoneyTables(pages("money_kovachev_2025.json"));
  it("reads the лев rows whose equivalence cell is blank — the 63,395 лв Phase 6 lost", () => {
    expect(triples(ok(t["10"]).rows)).toEqual([[60000, "BGN", null]]);
    expect(triples(ok(t["11"]).rows)).toEqual([
      [3395, "BGN", null],
      [104293, "EUR", 203979],
    ]);
    expect(ok(t["10"]).rows[0].valueBasis).toBe("amount-bgn");
  });
  it("cash + bank = 267,374 лв, the figure the undercount fell 24% short of", () => {
    expect(lev(ok(t["10"]).rows) + lev(ok(t["11"]).rows)).toBe(267374);
  });
});

describe("Shutova 2025 — Phase 6's „false positive“ was a real row", () => {
  const t = readMoneyTables(pages("money_shutova_2025.json"));
  it("an empty cash table reads as no rows, not stray cells", () => {
    expect(ok(t["10"]).rows).toEqual([]);
  });
  it("five bank rows, the 6,854 лв among them being her own 3,500 евро deposit", () => {
    expect(triples(ok(t["11"]).rows)).toEqual([
      [3910, "BGN", 3910],
      [36000, "BGN", 36000],
      [634, "BGN", 634],
      [3500, "EUR", 6854],
      [6046, "BGN", 6046],
    ]);
    expect(lev(ok(t["11"]).rows)).toBe(53444);
  });
  it("two bank loans in table 13", () => {
    expect(triples(ok(t["13"]).rows)).toEqual([
      [46124, "BGN", 46124],
      [18948, "BGN", 18948],
    ]);
    expect(ok(t["11"]).rows.every((r) => r.lead === "")).toBe(true);
    expect(ok(t["13"]).rows.map((r) => r.lead)).toEqual([
      "банков кредит",
      "банков кредит",
    ]);
  });
});

describe("Цацаров 2026", () => {
  const t = readMoneyTables(pages("money_tsatsarov_2026.json"));
  it("cash, two accounts and two debts", () => {
    expect(triples(ok(t["10"]).rows)).toEqual([[4500, "BGN", 4500]]);
    expect(triples(ok(t["11"]).rows)).toEqual([
      [8858, "BGN", 8858],
      [2510, "EUR", 4910],
    ]);
    expect(triples(ok(t["13"]).rows)).toEqual([
      [187760, "BGN", 187760],
      [30000, "BGN", 30000],
    ]);
  });
});

describe("Адамова-Петкова 2026", () => {
  const t = readMoneyTables(pages("money_adamova_2026.json"));
  it("reads every row and the equivalence column's лев unit", () => {
    expect(ok(t["10"]).equivUnit).toBe("BGN");
    expect(triples(ok(t["10"]).rows)).toEqual([
      [11000, "BGN", 11000],
      [7698, "EUR", 15056],
    ]);
    expect(ok(t["11"]).rows).toHaveLength(5);
    expect(ok(t["13"]).rows).toEqual([]);
  });
  it("values a euro row from its AMOUNT, not the declarant's equivalence arithmetic", () => {
    const eur = ok(t["10"]).rows[1];
    expect(eur.valueBasis).toBe("amount-eur");
    expect(eur.valueEur).toBe(7698);
    const bgn = ok(t["10"]).rows[0];
    expect(bgn.valueEur).toBeCloseTo(11000 / 1.95583, 2);
  });
});

describe("a table that runs onto the next page", () => {
  // Shutova's five bank rows, with rows 4-5 moved overleaf behind a page footer — the shape
  // of Цацаров's 6-of-11 entry filing, which carries no caption or header on page two.
  const split = (renumberFrom?: number): Row[][] => {
    const src = pages("money_shutova_2025.json");
    const p = src.findIndex((rows) =>
      rows.some((r) => r.some((it) => it.s === "Таблица № 11")),
    );
    const rows = src[p];
    const cap = rows.findIndex((r) => r.some((it) => it.s === "Таблица № 11"));
    const at = (ord: string) =>
      rows.findIndex((r, i) => i > cap && r[0]?.s === ord);
    const r4 = at("4.");
    const tail = rows.findIndex(
      (r, i) => i > r4 && /Нямам нищо/.test(r[0]?.s ?? ""),
    );
    const footer: Row = [{ s: "Декларатор:", x: 429, y: 26 }];
    let moved = rows.slice(r4, tail);
    if (renumberFrom != null)
      moved = moved.map((r, k) => [
        { ...r[0], s: `${renumberFrom + k}.` },
        ...r.slice(1),
      ]);
    const overleaf: Row[] = [
      [{ s: "Име на декларатора", x: 138, y: 548 }],
      ...moved,
      ...rows.slice(tail),
    ];
    return [
      ...src.slice(0, p),
      [...rows.slice(0, r4), footer],
      overleaf,
      ...src.slice(p + 1),
    ];
  };
  it("reads the rows printed overleaf", () => {
    const t = readMoneyTables(split());
    expect(triples(ok(t["11"]).rows)).toEqual([
      [3910, "BGN", 3910],
      [36000, "BGN", 36000],
      [634, "BGN", 634],
      [3500, "EUR", 6854],
      [6046, "BGN", 6046],
    ]);
    expect(ok(t["13"]).rows).toHaveLength(2);
  });
  it("does not absorb a page whose ordinals do not continue the sequence", () => {
    const t = readMoneyTables(split(9));
    expect(ok(t["11"]).rows.map((r) => r.ord)).toEqual([1, 2, 3]);
  });
});

describe("Фикиин 2026 — the v4.0 euro reissue has NO equivalence column", () => {
  const t = readMoneyTables(pages("money_fikiin_2026.json"));
  it("reads 5/7/8-column tables, valued from the amount", () => {
    expect(ok(t["10"]).rows).toEqual([]);
    expect(triples(ok(t["11"]).rows)).toEqual([
      [197824, "EUR", null],
      [157333, "EUR", null],
    ]);
    expect(ok(t["11"]).equivUnit).toBeNull();
    expect(ok(t["11"]).rows.map((r) => r.valueEur)).toEqual([197824, 157333]);
  });
  it("keeps the debt's kind, printed before the amount on № 13", () => {
    expect(ok(t["13"]).rows.map((r) => [r.lead, r.amount, r.currency])).toEqual(
      [
        ["кредитна карта", 357, "EUR"],
        ["финансов лизинг", 10146, "EUR"],
      ],
    );
  });
  it("refuses v4.0 if the v3.0 equivalence label is present after all", () => {
    const p = pages("money_fikiin_2026.json").map((rows) =>
      rows.map((r) =>
        r.some((it) => it.s === "валутата" && it.x > 160 && it.x < 200)
          ? [...r, { s: "в лв.", x: 219, y: r[0].y }]
          : r,
      ),
    );
    expect(isRefusal(readMoneyTables(p)["11"] as never)).toBe(true);
  });
});

describe("refusals and parsing", () => {
  it("a filing that states no v3.0/v4.0 form is refused, not read", () => {
    const p = pages("money_tsatsarov_2026.json").map((rows) =>
      rows.map((r) => r.filter((it) => !/v\.?\s*\d+\.\d+/i.test(it.s))),
    );
    const t = readMoneyTables(p);
    expect(isRefusal(t["10"] as never)).toBe(true);
  });
  it("a wrapped tick-box label inside the numbered header does not hide the table", () => {
    // Ангелова 2024: „деклариране" printed between header digits 5 and 6.
    const p = pages("money_tsatsarov_2026.json").map((rows) =>
      rows.map((r) => {
        const isT11Header =
          r.length === 8 && r.every((it, i) => it.s === String(i + 1));
        if (!isT11Header) return r;
        return [
          ...r.slice(0, 5),
          { s: "деклариране", x: r[4].x + 40, y: r[4].y },
          ...r.slice(5),
        ];
      }),
    );
    expect(triples(ok(readMoneyTables(p)["11"]).rows)).toEqual([
      [8858, "BGN", 8858],
      [2510, "EUR", 4910],
    ]);
  });
  it.each([
    ["BGN", "BGN"],
    ["лв", "BGN"],
    ["лв.", "BGN"],
    ["евро", "EUR"],
    ["EUR", "EUR"],
    ["USD", "USD"],
    ["ЩД", "USD"],
    ["щ.д.", "USD"],
    ["долара", "USD"],
    ["Сотир", null],
    ["UBB", null],
  ])("currency %s → %s", (s, want) => {
    expect(normCurrency(s)).toBe(want);
  });
  it("parses spaced thousands and a decimal comma, and refuses text", () => {
    expect(parseMoney("11 000")).toBe(11000);
    expect(parseMoney("11000,50")).toBe(11000.5);
    expect(parseMoney("18000,0000")).toBe(18000);
    expect(parseMoney("заплата")).toBeNull();
  });
});
