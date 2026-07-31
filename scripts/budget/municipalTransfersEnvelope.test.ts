// What `total` spans, and the two integrity checks that keep it honest.
//
// Article 53 prints SIX money columns per municipality: column 2 ("Основни
// бюджетни взаимоотношения", declared by the header as 3+4+5+6), its four
// components in columns 3-6, and column 7 ("Трансфери за други целеви разходи")
// — which sits OUTSIDE column 2 and is declared in its own sub-paragraph.
//
// `total` is the ENVELOPE: column 2 + column 7, all five transfer types. It
// used to be column 2 alone, which every consumer then used as the denominator
// for shares taken over all five categories — so the five percentages summed to
// 100.3-108.6% on 1,056 municipality-years, and the AI tool's headline total
// came out smaller than the sum of the five rows it printed. Column 2 survives
// as `basic` because it is a real legal quantity and because its declared
// identity is worth checking.
import { describe, expect, it } from "vitest";
import {
  buildTotalsFile,
  MunicipalTransfersIntegrityError,
  parseMunicipalTransfers,
  TRANSFER_TYPES,
} from "./municipal_transfers";

const LEAD =
  `Чл. 53. Приема размерите на бюджетните взаимоотношения между централния ` +
  `бюджет и бюджетите на общините за 2026 г., в т.ч.: 1. основни бюджетни ` +
  `взаимоотношения по видове: обща субсидия за делегираните от държавата ` +
  `дейности 1 500,0 хил. евро, трансфери за местни дейности, в т.ч. обща ` +
  `изравнителна субсидия 200,0 хил. евро и трансфер за зимно поддържане и ` +
  `снегопочистване на общински пътища 30,0 хил. евро, целева субсидия за ` +
  `капиталови разходи 70,0 хил. евро и по общини, както следва: 2. трансфери ` +
  `за други целеви разходи за местни дейности 300,0 хил. евро и по общини, ` +
  `както следва:`;

/** cells 1-6: col2, delegated, equalization, winter, capital, otherTargeted. */
const row = (name: string, cells: string[]): string =>
  `<tr><td>${name}</td>${cells.map((c) => `<td>${c}</td>`).join("")}</tr>`;

const OBLAST_HEADER = row("ОБЛАСТ БЛАГОЕВГРАД", ["", "", "", "", "", ""]);

const law = (rows: string): string =>
  `<html><body><p>${LEAD}</p><p>(хил. евро)</p>` +
  `<table>${OBLAST_HEADER}${rows}</table></body></html>`;

// Two municipalities. Column 2 = 3+4+5+6 on each; column 7 is on top.
//   Банско  1 000,0 = 800 + 100 + 30 + 70, plus 250,0 other
//   Белица    800,0 = 700 + 100 +  0 +  0, plus  50,0 other
// Lead totals: delegated 1 500, equalization 200, winter 30, capital 70,
// other 300 ⇒ envelope 2 100,0; column 2 alone 1 800,0.
const ROWS =
  row("Банско", ["1 000,0", "800,0", "100,0", "30,0", "70,0", "250,0"]) +
  row("Белица", ["800,0", "700,0", "100,0", "", "", "50,0"]);

const parsed = () => parseMunicipalTransfers(law(ROWS), 2026);

describe("`total` spans all five transfer types", () => {
  it("adds column 7 to column 2 on each municipality row", () => {
    const [bansko, belitsa] = parsed().municipalities;
    expect(bansko.total?.amountEur).toBe(1_250_000);
    expect(belitsa.total?.amountEur).toBe(850_000);
  });

  it("keeps column 2 alone as `basic`", () => {
    const [bansko, belitsa] = parsed().municipalities;
    expect(bansko.basic?.amountEur).toBe(1_000_000);
    expect(belitsa.basic?.amountEur).toBe(800_000);
  });

  it("makes the five categories sum to 100% of the row's own total", () => {
    // The property every consumer depends on and none of them asserts: each
    // tile divides the five categories by `total`. Against `basic` this row
    // sums to 125%. Scoped to the parsed ROWS deliberately — the oblast
    // rollups sum already-rounded EUR, so they hold it only to a few euro
    // (see addMoney).
    for (const m of parsed().municipalities) {
      const sum = TRANSFER_TYPES.reduce(
        (s, k) => s + (m[k]?.amountEur ?? 0),
        0,
      );
      expect(sum).toBe(m.total?.amountEur);
      expect(sum).not.toBe(m.basic?.amountEur);
    }
  });

  it("carries both up to the national row sums", () => {
    const { rowSum } = parsed();
    expect(rowSum.total.amountEur).toBe(2_100_000);
    expect(rowSum.basic.amountEur).toBe(1_800_000);
    expect(rowSum.otherTargeted.amountEur).toBe(300_000);
  });

  it("treats a blank column 7 as absent, not as a zero total", () => {
    // A municipality with no cell anywhere must stay null rather than becoming
    // a stated €0 — `total` is built by ADDING two cells, so it is the one
    // field that could invent a value the law never printed.
    const noneAtAll = row("Гърмен", ["", "", "", "", "", ""]);
    const p = parseMunicipalTransfers(law(ROWS + noneAtAll), 2026);
    expect(p.municipalities.some((m) => m.nameBg === "Гърмен")).toBe(false);
  });

  it("keeps total non-null when only one of the two cells is present", () => {
    // The asymmetric halves of the addition. Column 2 blank with a column 7
    // value is the case where `total` legitimately diverges from "the four
    // subsidies plus other" — it is column 7 alone.
    const onlyOther = row("Гърмен", ["", "", "", "", "", "40,0"]);
    const g = parseMunicipalTransfers(
      law(ROWS + onlyOther),
      2026,
    ).municipalities.find((m) => m.nameBg === "Гърмен");
    expect(g?.basic).toBeNull();
    expect(g?.total?.amountEur).toBe(40_000);

    const onlyBasic = row("Хаджидимово", [
      "500,0",
      "400,0",
      "100,0",
      "",
      "",
      "",
    ]);
    const h = parseMunicipalTransfers(
      law(ROWS + onlyBasic),
      2026,
    ).municipalities.find((m) => m.nameBg === "Хаджидимово");
    expect(h?.total?.amountEur).toBe(500_000);
    expect(h?.total?.amountEur).toBe(h?.basic?.amountEur);
  });
});

describe("laws that declare no 'други целеви' transfers (2018-2022)", () => {
  // 5 of 9 fiscal years and 1,325 of 2,385 municipality-years — the majority of
  // the corpus, and the one path where leadEnvelope's `?? 0` is load-bearing.
  const LEGACY_LEAD = LEAD.replace(
    / 2\. трансфери за други целеви разходи за местни дейности 300,0 хил\. евро и по общини, както следва:/,
    "",
  );
  const legacyLaw = (rows: string): string =>
    `<html><body><p>${LEGACY_LEAD}</p><p>(хил. евро)</p>` +
    `<table>${OBLAST_HEADER}${rows}</table></body></html>`;
  const LEGACY_ROWS =
    row("Банско", ["1 000,0", "800,0", "100,0", "30,0", "70,0", ""]) +
    row("Белица", ["800,0", "700,0", "100,0", "", "", ""]);

  it("passes the envelope canary with a null otherTargeted lead total", () => {
    expect(() =>
      buildTotalsFile(
        parseMunicipalTransfers(legacyLaw(LEGACY_ROWS), 2020),
        "2020-01-01",
        { documentId: "law-2020", url: "" },
      ),
    ).not.toThrow();
  });

  it("leaves total identical to basic when the table has no column 7", () => {
    const p = parseMunicipalTransfers(legacyLaw(LEGACY_ROWS), 2020);
    expect(p.totals.otherTargeted).toBeNull();
    expect(p.rowSum.total.amountEur).toBe(p.rowSum.basic.amountEur);
    for (const m of p.municipalities) {
      expect(m.total?.amountEur).toBe(m.basic?.amountEur);
    }
  });

  it("rejects a law whose table HAS column 7 but whose prose lost it", () => {
    // The two cases the `?? 0` cannot tell apart: "this law declares none"
    // (above, correct) vs "parseOtherTargetedTotal stopped matching". Only the
    // rows can distinguish them, and the second must name the prose rather
    // than let the envelope canary blame the table.
    expect(() => parseMunicipalTransfers(legacyLaw(ROWS), 2026)).toThrow(
      /the table carries column 7 .* but the lead paragraph yielded no/s,
    );
  });
});

describe("the declared 2(3+4+5+6) identity is checked on every row", () => {
  it("accepts rows that satisfy it", () => {
    expect(() => parsed()).not.toThrow();
  });

  it("throws on a row where column 2 disagrees with its components", () => {
    // The realistic corruption is a column SHIFT, not a wrong number: blank
    // cells are common (Белица above has neither winter nor capital), and a
    // blank that stops rendering as an empty <td> slides every later column
    // left, producing entirely plausible figures.
    const shifted = row("Гоце Делчев", [
      "900,0",
      "800,0",
      "100,0",
      "30,0",
      "70,0",
      "10,0",
    ]);
    expect(() => parseMunicipalTransfers(law(ROWS + shifted), 2026)).toThrow(
      /declared "2\(3\+4\+5\+6\)" identity/,
    );
  });

  it("names the offending municipality and its two sides", () => {
    const shifted = row("Гоце Делчев", [
      "900,0",
      "800,0",
      "100,0",
      "30,0",
      "70,0",
      "",
    ]);
    // Oblast code included because the name alone is not unique — Бяла exists
    // in both RSE and VAR — and one decimal because the raw float sum prints
    // as 1000.1000000000000227.
    expect(() => parseMunicipalTransfers(law(ROWS + shifted), 2026)).toThrow(
      /Гоце Делчев \(BLG\): column 2 = 900\.0 but 3\+4\+5\+6 = 1000\.0/,
    );
  });

  it("raises integrity failures as the type the ingest re-throws", () => {
    // The gap that made the check inert: the suite proved the parser THREW,
    // but nothing proved anything observed the throw. ingest.ts wraps the
    // parse in a catch written for "this law has no Article 53 table", so a
    // plain Error is silently swallowed and the year vanishes from the corpus.
    const shifted = row("Гоце Делчев", [
      "900,0",
      "800,0",
      "100,0",
      "30,0",
      "70,0",
      "",
    ]);
    expect(() => parseMunicipalTransfers(law(ROWS + shifted), 2026)).toThrow(
      MunicipalTransfersIntegrityError,
    );
  });

  it("leaves a genuinely absent article as an ordinary skippable Error", () => {
    // The other side of the same contract: no anchor phrase means the law
    // carries no such table, which the ingest is entitled to skip. If this
    // became an integrity error, an older layout would fail the whole ingest.
    const noArticle = `<html><body><p>(хил. евро)</p><p>Чл. 1. …</p></body></html>`;
    expect(() => parseMunicipalTransfers(noArticle, 2026)).toThrow();
    expect(() => parseMunicipalTransfers(noArticle, 2026)).not.toThrow(
      MunicipalTransfersIntegrityError,
    );
  });

  it("tolerates one last-place rounding unit", () => {
    // The source prints one decimal, so a legitimately rounded component can
    // leave the identity off by 0,1 — that must not fail the ingest.
    const rounded = row("Гърмен", [
      "1 000,0",
      "800,1",
      "100,0",
      "30,0",
      "70,0",
      "10,0",
    ]);
    expect(() =>
      parseMunicipalTransfers(law(ROWS + rounded), 2026),
    ).not.toThrow();
  });
});

describe("the whole-envelope canary", () => {
  const build = (html: string) =>
    buildTotalsFile(parseMunicipalTransfers(html, 2026), "2026-01-01", {
      documentId: "law-2026",
      url: "",
    });

  it("passes when the rows and the lead paragraph describe the same envelope", () => {
    expect(build(law(ROWS)).reconciliationDeltasEur).toEqual({});
  });

  it("catches a `total` that spans the wrong set of columns", () => {
    // This is the check the per-category deltas CANNOT do. Drop a
    // municipality's column 7 and every per-category delta still reconciles
    // for four of five types, but the envelope no longer matches the lead
    // paragraph — which is exactly the shape of the bug that shipped.
    const short =
      row("Банско", ["1 000,0", "800,0", "100,0", "30,0", "70,0", "250,0"]) +
      row("Белица", ["800,0", "700,0", "100,0", "", "", ""]);
    expect(() => build(law(short))).toThrow(/summed envelope/);
  });

  it("still reports an ordinary per-category drift as a delta, not a throw", () => {
    // A row-vs-paragraph disagreement WITHIN a category is the pre-existing
    // soft signal and must stay soft — only the envelope's shape is fatal.
    // Move 10,0 from delegated to capital in the rows: both categories now
    // disagree with the lead paragraph, each row still satisfies 2(3+4+5+6),
    // and the envelope is untouched.
    const drifted =
      row("Банско", ["1 000,0", "790,0", "100,0", "30,0", "80,0", "250,0"]) +
      row("Белица", ["800,0", "700,0", "100,0", "", "", "50,0"]);
    const file = build(law(drifted));
    expect(file.reconciliationDeltasEur.delegated).toBe(-10_000);
    expect(file.reconciliationDeltasEur.capital).toBe(10_000);
    expect(file.rowSum.total.amountEur).toBe(2_100_000);
  });
});
