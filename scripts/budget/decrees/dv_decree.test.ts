// ПМС spending decrees from Държавен вестник. Fixtures are verbatim DV material pages:
// dv_247740 is ПМС № 271/2026 (additional spending, Министерство на енергетиката) and
// dv_156315 is ПМС № 67/2021 (a transfer to Sofia University for the computer-science
// institute) and dv_247806 a Народно събрание decision that must not be taken for a decree.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  isSpendingDecree,
  parseHeader,
  parseSpendingDecree,
} from "./dv_decree";
import { classify, newestIdFrom } from "./fetch_dv_decrees";

const page = (id: number) =>
  readFileSync(
    path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      `__fixtures__/dv_${id}.html`,
    ),
    "utf8",
  );

describe("parseHeader", () => {
  it("reads issuer, issue and title", () => {
    expect(parseHeader(page(247740))).toEqual({
      issuer: "Министерски съвет",
      issueNo: 106,
      issueDate: "2026-11-24",
      official: true,
      title:
        "Постановление № 271 от 19 ноември 2026 г. за одобряване на допълнителни разходи по бюджета на Министерството на енергетиката за 2026 г.",
    });
  });
  it("returns null for a page that is not a material", () => {
    expect(parseHeader("<html><body></body></html>")).toBeNull();
  });
});

describe("isSpendingDecree", () => {
  it("takes a Council of Ministers ПМС and refuses a parliament decision", () => {
    expect(isSpendingDecree(parseHeader(page(247740))!)).toBe(true);
    expect(isSpendingDecree(parseHeader(page(247806))!)).toBe(false);
  });
});

describe("parseSpendingDecree", () => {
  it("reads number, date, budget and the amount with its purpose", () => {
    const h = parseHeader(page(247740))!;
    const d = parseSpendingDecree(page(247740), h)!;
    expect(d).toMatchObject({
      number: 271,
      date: "2026-11-19",
      kind: "разходи",
      budgetOf: "Министерството на енергетиката",
      budgetYear: 2026,
    });
    expect(d.clauses).toHaveLength(1);
    expect(d.clauses[0]).toMatchObject({
      native: 5_000_000,
      currency: "EUR",
      eur: 5_000_000,
      upTo: false,
    });
    // the purpose runs past „2021 г." to the end of the paragraph
    expect(d.clauses[0].purpose).toMatch(
      /^за финансиране на дейности на Държавно предприятие "Радиоактивни отпадъци".*1368\/2013/,
    );
    expect(d.text).toContain("МИНИСТЕРСКИЯТ СЪВЕТ ПОСТАНОВИ");
  });

  it("reads ПМС 67/2021 — the transfer to Sofia University for INSAIT's institute", () => {
    const h = parseHeader(page(156315))!;
    expect(isSpendingDecree(h)).toBe(true);
    const d = parseSpendingDecree(page(156315), h)!;
    expect(d).toMatchObject({
      number: 67,
      date: "2021-02-25",
      kind: "трансфери",
      budgetOf: "Министерството на образованието и науката",
      budgetYear: 2021,
    });
    expect(d.clauses).toEqual([
      {
        seq: 1,
        native: 7_802_200,
        currency: "BGN",
        eur: 3_989_201.52,
        upTo: false,
        purpose:
          'за Софийския университет "Св. Климент Охридски" чрез бюджета на Министерството на образованието и науката за 2021 г. за финансирането на дейността на Института за научни изследвания в областта на компютърните науки',
      },
    ]);
    expect(d.text).toContain("§ 1.");
  });

  it("reads a leva ceiling as up-to, converted at the locked rate", () => {
    const h = parseHeader(page(247740))!;
    const html = page(247740).replace(
      "в размер 5 000 000 евро",
      "в размер до 1 955 830 лв.",
    );
    const [c] = parseSpendingDecree(html, h)!.clauses;
    expect(c).toMatchObject({
      native: 1_955_830,
      currency: "BGN",
      eur: 1_000_000,
      upTo: true,
    });
  });

  it("models only the „одобряване на допълнителни разходи/трансфери“ form", () => {
    const h = {
      ...parseHeader(page(247740))!,
      title: "Постановление № 5 от 1 март 2026 г. за приемане на Наредба за …",
    };
    expect(parseSpendingDecree(page(247740), h)).toBeNull();
  });

  it("takes the total once, never an item's own „в общ размер“ subtotal", () => {
    const d = parseSpendingDecree(page(155761), parseHeader(page(155761))!)!;
    expect(d.clauses.map((c) => c.native)).toEqual([14_498_262]);
  });

  it("ignores an amount in a paragraph that appropriates nothing", () => {
    // ПМС 84/2021: (2) „Допълнителната сума по ал. 1 е в размер 50 лв." is per pensioner
    const d = parseSpendingDecree(page(156597), parseHeader(page(156597))!)!;
    expect(d.clauses.map((c) => c.native)).toEqual([105_000_000]);
  });

  it("reads a combined title, with the money in a later article", () => {
    // ПМС 45/2021: „за определяне размера на … и за одобряване на допълнителни разходи"
    const d = parseSpendingDecree(page(155983), parseHeader(page(155983))!)!;
    expect(d).toMatchObject({ number: 45, kind: "разходи" });
    expect(d.clauses.map((c) => c.native)).toEqual([2_000_000]);
  });
});

describe("crawler", () => {
  it("finds the newest id even when links carry a jsessionid", () => {
    expect(
      newestIdFrom(
        '<a href="showMaterialDV.jsp;jsessionid=AB12?idMat=247514">x</a><a href="showMaterialDV.jsp?idMat=247816">y</a>',
      ),
    ).toBe(247816);
    expect(() => newestIdFrom("<html></html>")).toThrow();
  });
  it("tells an unissued id from a page that failed", () => {
    expect(classify(200, "\r\n\r\n")).toEqual({ kind: "missing" });
    expect(classify(200, page(247740))).toEqual({
      kind: "material",
      decree: true,
    });
    expect(classify(200, page(247806))).toEqual({
      kind: "material",
      decree: false,
    });
    expect(classify(200, "<html>maintenance</html>")).toMatchObject({
      kind: "failed",
    });
    expect(classify(503, "")).toMatchObject({ kind: "failed" });
  });
});
