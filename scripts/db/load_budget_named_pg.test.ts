// parseLaws — the loader's refusals: a law whose annex did not read cleanly must stop
// the load rather than publish a year with rows missing.
import { describe, expect, it } from "vitest";
import { LAW_DV_MATERIALS } from "../budget/fetch_sources";
import { parseLaws } from "./load_budget_named_pg";

const td = (s: string) => `<td>${s}</td>`;
const tr = (...c: string[]) => `<tr>${c.map(td).join("")}</tr>`;
const HEAD = tr(
  "№",
  "Номер на проект",
  "Проект",
  "Размер на капиталови разходи по проекта през 2026 г.",
  "Отговорна институция",
);
const annex = (...rows: string[]) =>
  `<p>Приложение № 2 към чл. 110, ал. 1</p><p>Програма за приоритетни стратегически инвестиционни проекти с национално финансиране (хил. евро)</p>` +
  `<table>${HEAD}${rows.join("")}</table>`;
const row = (seq: number, code: string, amount = "1,0") =>
  tr(String(seq), code, "проект", amount, "МОН");

const ID_2026 = LAW_DV_MATERIALS[2026];
const only2026 = (html: string) => (id: string) =>
  id === ID_2026 ? html : null;

describe("parseLaws", () => {
  it("loads a clean annex and reports the years with no cached law", () => {
    const { years, missing } = parseLaws(
      only2026(annex(row(1, "NP-25.002-0001"), row(2, "NP-25.002-0002"))),
    );
    expect(years.map((y) => [y.year, y.rows.length])).toEqual([[2026, 2]]);
    expect(missing).toContain(2025);
  });

  it("refuses an unreadable row", () => {
    expect(() =>
      parseLaws(only2026(annex(row(1, "NP-25.002-0001", "много")))),
    ).toThrow(/unreadable/);
  });

  it("refuses a gap in a section's numbering", () => {
    expect(() =>
      parseLaws(
        only2026(annex(row(1, "NP-25.002-0001"), row(3, "NP-25.002-0003"))),
      ),
    ).toThrow(/not 1\.\.2/);
  });

  it("refuses a code the law prints but the parser did not read", () => {
    // a row whose cell count no longer matches the header is rejected by the parser…
    expect(() =>
      parseLaws(
        only2026(
          annex(
            row(1, "NP-25.002-0001"),
            `<tr>${td("2")}${td("NP-25.002-0002")}</tr>`,
          ),
        ),
      ),
    ).toThrow(/unreadable|not read/);
    // …and a code that survives only outside the table (the annex lost) is caught too.
    expect(() =>
      parseLaws(only2026("<p>Проект NP-25.002-0009 е в приложение № 2.</p>")),
    ).toThrow(/not read/);
  });
});
