import { describe, expect, it } from "vitest";
import {
  flattenJsonStat,
  isVaccineProduct,
  parseHisReport,
  parseIncidence,
  parseSespa,
  parseVirology,
  splitCsvLine,
} from "./sources";

const districts = (n = 28) =>
  Array.from(
    { length: n },
    (_, i) => `BG-${String(i + 1).padStart(2, "0")},${100 + i},1.5`,
  );

const hisPage = (opts: { districts?: string[]; stamp?: boolean } = {}) => `
<p>${opts.stamp === false ? "" : "Данните са актуализирани в 9:05 на 23.11.2026"}</p>
<xmp class="csv" data-filename="TotalNumberOfImmunizationByDistrict2026.csv">
district,number_of_immunizations,per_1000
${(opts.districts ?? districts()).join("\n")}
</xmp>
<xmp class="csv" data-filename="NumberOfImmunizationsByVaccine2026.csv">
vaccine,number_of_immunizations
"Грип (инжекционна) / Influenza vaccine (injectable)",323 437
Морбили / Measles,1200
</xmp>`;

describe("parseHisReport", () => {
  it("reads both embedded CSVs and the as-of stamp", () => {
    const r = parseHisReport(hisPage(), 2026);
    expect(r.updatedAt).toEqual(["2026-11-23T09:05:00"]);
    expect(r.byVaccine).toEqual([
      {
        label: "Грип (инжекционна) / Influenza vaccine (injectable)",
        labelBg: "Грип (инжекционна)",
        labelEn: "Influenza vaccine (injectable)",
        n: 323437,
      },
      {
        label: "Морбили / Measles",
        labelBg: "Морбили",
        labelEn: "Measles",
        n: 1200,
      },
    ]);
    expect(r.total).toBe(324637);
    expect(r.byDistrict).toHaveLength(28);
  });
  it("refuses a page with a missing district or no stamp", () => {
    expect(() =>
      parseHisReport(hisPage({ districts: districts(27) }), 2026),
    ).toThrow(/27 districts/);
    expect(() => parseHisReport(hisPage({ stamp: false }), 2026)).toThrow(
      /stamp/,
    );
  });
  it("accepts a closed year's page, which carries no stamp", () => {
    expect(
      parseHisReport(hisPage({ stamp: false }), 2025, true).updatedAt,
    ).toEqual([]);
  });
});

describe("splitCsvLine", () => {
  it("keeps commas and escaped quotes inside quoted fields", () => {
    expect(splitCsvLine('a,"b, ""c""",d')).toEqual(["a", 'b, "c"', "d"]);
  });
});

const sespaRow = (code: string, name: string, inn: string) =>
  `<tr ><td headers="NSCRLP_CODE">${code}</td><td headers="DRUG_TRADE_NAME">${name}</td>` +
  `<td headers="INN">${inn}</td><td headers="ACTIVE_SUBSTANCE">0.2</td>` +
  `<td headers="ACTIVE_SUBSTANCE_MEASUREMENT">ml</td><td headers="FORMA">spray</td>` +
  `<td headers="NUMBER_IN_PACKAGE">1</td></tr>`;

const sespaPage = (total: number) => `
<span>В сила от 20.11.2026 00:00:00 ч. до 26.11.2026 23:59:59 ч.</span>
<table aria-label="Total Rows = ${total}">
${sespaRow("64907", "Fluenz", "Influenza vaccine (live attenuated, nasal)")}
${sespaRow("12345", "Amoksiklav &amp; Co", "Amoxicillin")}
</table>`;

describe("parseSespa", () => {
  it("reads the validity window and rows, flagging vaccines", () => {
    const l = parseSespa(sespaPage(2));
    expect(l.validFrom).toBe("2026-11-20");
    expect(l.validTo).toBe("2026-11-26");
    expect(l.rows.map((r) => [r.ncprCode, r.name, r.isVaccine])).toEqual([
      ["64907", "Fluenz", true],
      ["12345", "Amoksiklav & Co", false],
    ]);
  });
  it("refuses a page whose rows disagree with the report's total", () => {
    expect(() => parseSespa(sespaPage(57))).toThrow(/parsed 2 rows/);
  });
  it("recognises vaccines in either language", () => {
    expect(isVaccineProduct("Ваксина срещу грип", "")).toBe(true);
    expect(isVaccineProduct("Aspirin", "acetylsalicylic acid")).toBe(false);
  });
});

const incidenceRow = (area: string, base: number) =>
  `<tr><td>${area}</td><td>5</td>${Array.from({ length: 18 }, (_, i) => `<td>${base + i}</td>`).join("")}</tr>`;

const incidencePage = (oblasts = 28) => `
<h3>за периода от 16-11-2026 до 22-11-2026 (седмица 47)</h3>
<table><tbody>
${Array.from({ length: oblasts }, (_, i) => incidenceRow(`Област ${i}`, i)).join("\n")}
${incidenceRow("Общо за страната", 1000)}
</tbody></table>`;

describe("parseIncidence", () => {
  it("reads the week and 28 oblasts + the national row", () => {
    const w = parseIncidence(incidencePage());
    expect(w).toMatchObject({
      isoWeek: 47,
      weekStart: "2026-11-16",
      weekEnd: "2026-11-22",
    });
    const nat = w.rows.find((r) => r.isNational)!;
    expect(nat.served).toEqual([1000, 1001, 1002, 1003, 1004, 1005]);
    expect(nat.cases).toEqual([1006, 1007, 1008, 1009, 1010, 1011]);
    expect(nat.rate).toEqual([1012, 1013, 1014, 1015, 1016, 1017]);
  });
  it("refuses a table missing an oblast", () => {
    expect(() => parseIncidence(incidencePage(27))).toThrow(/27 oblasts/);
  });
});

describe("parseVirology", () => {
  it("reads table 1 under the &#8470; heading", () => {
    const html = `Седмица &#8470 46 (от 09.11.2026 до 15.11.2026)
      <p>Таблица&nbsp;1: Real-Time RT-PCR</p>
      <table><tbody><tr><td>Общо</td><td>48</td><td>0</td><td>0</td><td>4</td><td>0</td><td>0</td></tr></tbody></table>
      <p>Таблица&nbsp;2:</p><table><tbody><tr><td>9</td></tr></tbody></table>`;
    expect(parseVirology(html)).toEqual({
      isoWeek: 46,
      weekStart: "2026-11-09",
      weekEnd: "2026-11-15",
      tested: 48,
      aH1n1: 0,
      aH3n2: 0,
      aH1n1pdm09: 4,
      bVictoria: 0,
      bYamagata: 0,
    });
  });
});

describe("flattenJsonStat", () => {
  it("maps flat indexes back to row-major dimension labels, skipping gaps", () => {
    const rows = flattenJsonStat({
      id: ["geo", "time"],
      size: [2, 2],
      dimension: {
        geo: { category: { index: { BG: 0, RO: 1 } } },
        time: { category: { index: { "2023": 0, "2024": 1 } } },
      },
      value: { "0": 15.2, "1": 19.4, "3": 7 },
    });
    expect(rows).toEqual([
      { dims: { geo: "BG", time: "2023" }, value: 15.2 },
      { dims: { geo: "BG", time: "2024" }, value: 19.4 },
      { dims: { geo: "RO", time: "2024" }, value: 7 },
    ]);
  });
});
