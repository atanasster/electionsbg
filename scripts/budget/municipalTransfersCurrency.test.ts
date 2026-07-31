// Article 53 carries no unit of its own — it inherits the budget law's
// denomination, which flipped from "(хил. лв.)" to "(хил. евро)" with the
// FY2026 law. Getting that wrong is the worst kind of parser bug: the table
// still parses, every row count still reconciles, and every figure is off by
// the 1.95583 peg. It shipped once — FY2026 published €2.499bn of state→
// municipality transfers against the law's actual €4.887bn — and the only
// visible symptom was an unrelated null-dereference downstream.
//
// Driven against synthetic laws rather than the cached DV HTML so the cases
// are the ones the real documents do NOT have (unmarked unit, drifted lead
// wording), and so the leva case cannot quietly stop being exercised the year
// every cached law is euro-denominated.
import { describe, expect, it } from "vitest";
import { parseMunicipalTransfers } from "./municipal_transfers";

const LEAD = (unit: string): string =>
  `Чл. 53. Приема размерите на бюджетните взаимоотношения между централния ` +
  `бюджет и бюджетите на общините за 2026 г., в т.ч.: 1. основни бюджетни ` +
  `взаимоотношения под формата на субсидии по механизъм съгласно приложение ` +
  `№ 1 по видове: обща субсидия за делегираните от държавата дейности ` +
  `1 000,0 ${unit}, трансфери за местни дейности, в т.ч. обща изравнителна ` +
  `субсидия 100,0 ${unit} и трансфер за зимно поддържане и снегопочистване ` +
  `на общински пътища 10,0 ${unit}, целева субсидия за капиталови разходи ` +
  `50,0 ${unit} и по общини, както следва: 2. трансфери за други целеви ` +
  `разходи за местни дейности 20,0 ${unit} и по общини, както следва:`;

const tableRow = (otherTargeted: string): string =>
  `<tr><td>Банско</td><td>1 160,0</td><td>1 000,0</td><td>100,0</td>` +
  `<td>10,0</td><td>50,0</td><td>${otherTargeted}</td></tr>`;

const table = (otherTargeted: string): string =>
  `<table>` +
  `<tr><td>ОБЛАСТ БЛАГОЕВГРАД</td><td></td><td></td><td></td><td></td><td></td><td></td></tr>` +
  tableRow(otherTargeted) +
  `</table>`;

/** A minimal law document in one denomination. */
const law = (opts: {
  lead: string;
  marker: string | null;
  otherTargeted?: string;
}): string =>
  `<html><body><p>${opts.lead}</p>` +
  (opts.marker ? `<p>${opts.marker}</p>` : "") +
  table(opts.otherTargeted ?? "20,0") +
  `</body></html>`;

const LEVA = law({ lead: LEAD("хил. лв."), marker: "(хил. лв.)" });
const EURO = law({ lead: LEAD("хил. евро"), marker: "(хил. евро)" });

// The peg, as scripts use it. 1 000,0 хил. лв. → 1,000,000 лв. → €511,292.
const PEGGED_DELEGATED_EUR = 511292;

describe("the law's denomination decides whether the peg is applied", () => {
  it("converts a leva-denominated law through the peg", () => {
    const p = parseMunicipalTransfers(LEVA, 2025);
    expect(p.totals.delegated).toEqual({
      amount: 1_000_000,
      currency: "BGN",
      amountEur: PEGGED_DELEGATED_EUR,
    });
    expect(p.municipalities[0].total?.currency).toBe("BGN");
  });

  it("leaves a euro-denominated law alone", () => {
    const p = parseMunicipalTransfers(EURO, 2026);
    expect(p.totals.delegated).toEqual({
      amount: 1_000_000,
      currency: "EUR",
      amountEur: 1_000_000,
    });
    expect(p.municipalities[0].total).toEqual({
      amount: 1_180_000, // column 2 (1 160,0) + column 7 (20,0)
      currency: "EUR",
      amountEur: 1_180_000,
    });
  });

  it("does not halve the euro law — the exact failure that shipped", () => {
    const eur = parseMunicipalTransfers(EURO, 2026).rowSum.total.amountEur;
    expect(eur).toBe(1_180_000);
    expect(eur).not.toBe(
      parseMunicipalTransfers(LEVA, 2025).rowSum.total.amountEur,
    );
  });

  it("carries the denomination into the per-municipality rows too", () => {
    // The oblast rollup sums these, so a row mislabelled BGN invites a second
    // conversion downstream even when amountEur is already right.
    for (const m of parseMunicipalTransfers(EURO, 2026).municipalities) {
      for (const k of ["total", "delegated", "capital"] as const) {
        expect(m[k]?.currency).toBe("EUR");
      }
    }
  });

  it("refuses to guess when the document carries no unit marker", () => {
    // Defaulting to BGN here is what halves a euro law, so an unmarked
    // document must fail rather than pick.
    expect(() =>
      parseMunicipalTransfers(
        law({ lead: LEAD("хил. евро"), marker: null }),
        2026,
      ),
    ).toThrow(/no "\(хил\. лв\.\)" \/ "\(хил\. евро\)" unit marker/);
  });
});

describe("the lead-paragraph totals are a required canary", () => {
  it("parses all five when the wording matches", () => {
    const t = parseMunicipalTransfers(EURO, 2026).totals;
    expect(t.delegated?.amountEur).toBe(1_000_000);
    expect(t.equalization?.amountEur).toBe(100_000);
    expect(t.winter?.amountEur).toBe(10_000);
    expect(t.capital?.amountEur).toBe(50_000);
    expect(t.otherTargeted?.amountEur).toBe(20_000);
  });

  it("throws when a core total stops matching, naming which", () => {
    // Their only other consumer is the reconciliation delta, which SKIPS a
    // null field — so an unmatched lead paragraph reconciles perfectly against
    // nothing and reads as a clean parse. That is how the unit change got
    // through: the table parsed, the prose did not, and no delta was raised.
    const drifted = LEAD("хил. евро").replace(
      "целева субсидия за капиталови разходи",
      "целеви средства за капиталови разходи",
    );
    expect(() =>
      parseMunicipalTransfers(
        law({ lead: drifted, marker: "(хил. евро)" }),
        2026,
      ),
    ).toThrow(/lead paragraph yielded no total for capital/);
  });

  it("still accepts a law that declares no otherTargeted", () => {
    // Genuinely absent from the 2018–2022 laws — it must stay null-able while
    // the other four are required. Those laws have no column 7 in the table
    // EITHER, which is what makes the null safe; a null lead total against a
    // populated column 7 is a parser regression and is rejected separately.
    const noOther = LEAD("хил. лв.").replace(
      /2\. трансфери за други целеви разходи.*$/,
      "",
    );
    const p = parseMunicipalTransfers(
      law({ lead: noOther, marker: "(хил. лв.)", otherTargeted: "" }),
      2022,
    );
    expect(p.totals.otherTargeted).toBeNull();
    expect(p.totals.delegated?.amountEur).toBe(PEGGED_DELEGATED_EUR);
  });
});
