// The State Budget Law's named-project annex (Приложение № 2 към чл. 110). The HTML
// below keeps the shapes the real DV pages have: header words split across spans, a
// dash entity for a year with nothing set, a footnote marker on an amount, the annex
// title cited in an article first, a reserve section, and the next annex after it.
import { describe, expect, it } from "vitest";
import {
  BGN_PER_EUR,
  bgNumber,
  parseNamedAppropriations,
} from "./named_appropriations";

const td = (s: string) => `<td><p><span>${s}</span></p></td>`;
const tr = (...cells: string[]) => `<tr>${cells.map(td).join("")}</tr>`;
const table = (...rows: string[]) =>
  `<table><tbody>${rows.join("")}</tbody></table>`;

const TITLE =
  "Програма за приоритетни стратегически инвестиционни проекти с национално финансиране";
const RESERVE =
  "Списък с резервни стратегически инвестиционни проекти с национално финансиране";

const law2026 = [
  `<p>Чл. 110. (1) Определя ${TITLE} с отговорни институции съгласно приложение № 2.</p>`,
  table(tr("а", "б")), // an unrelated table between the citation and the annex
  `<p>Приложение № 2 към чл. 110, ал. 1</p><p>${TITLE} за периода 2026 – 2028 г. (хил. евро)</p>`,
  table(
    tr(
      "№",
      "Номер</span> <span>на проект",
      "Проект",
      "Размер на капиталови разходи по проекта през 2026 г.",
      "Прогнозен размер на капиталови разходи по проекта през 2027 г.",
      "Прогнозен размер на капиталови разходи по проекта през 2028 г.",
      "Индикатор/Показател за оценка на резултатите/целева стойност",
      "Отговорна институция",
    ),
    tr(
      "1",
      "NP-25.002-0048",
      "Софийски университет &bdquo;Св. Климент Охридски&ldquo; &ndash; Изграждане на изчислителен център (INSAIT)",
      "3 500,0",
      "3 500,0",
      "4 000,0",
      "Брой изграден център &ndash; 1",
      "Министерство на образованието и науката",
    ),
  ),
  // page break: the table continues without a header
  table(
    tr(
      "2",
      "NP-25.003-0019&nbsp;",
      "Паметник на свободата",
      "3 151,5**",
      "&nbsp;&ndash;",
      "&ndash;",
      "Реставрация &ndash; 100 %",
      "Министерство на културата",
    ),
  ),
  `<p>Приложение № 3 към чл. 111</p>`,
  table(tr("1", "NP-99.999-9999", "чужд ред", "1,0", "1,0", "1,0", "x", "y")),
].join("\n");

const law2025 = [
  `<p>Приложение № 2, раздел I, към чл. 110, ал. 1</p><p>${TITLE} за периода 2025 – 2028 г. (в хил. лв.)</p>`,
  table(
    tr(
      "№",
      "Номер на проект",
      "Проект",
      "Размер на капиталови разходи по проекта през 2025 г.",
      "Индикатор",
      "Отговорна институция",
    ),
    tr("1", "NP-25.001-0048", "INSAIT", "3 800,0", "1", "МОН"),
  ),
  `<p>Приложение № 2, раздел II, към чл. 110, ал. 2</p><p>${RESERVE} (в хил. лв.)</p>`,
  table(
    tr(
      "№",
      "Номер на проект",
      "Проект",
      "Индикативен размер на капиталовите разходи по проекта през 2025 г.",
      "Индикатор",
      "Отговорна институция",
    ),
    tr("1", "NP-25.002-0004", "Буна Ной", "4 737,9", "1", "МРРБ"),
  ),
].join("\n");

describe("bgNumber", () => {
  it("reads Bulgarian grouping and decimal comma", () => {
    expect(bgNumber("3 500,0")).toBe(3500);
    expect(bgNumber("1 609,5")).toBe(1609.5);
    expect(bgNumber("–")).toBeNull();
  });
});

describe("parseNamedAppropriations", () => {
  it("reads the 2026 annex: euro, one appropriation and two forecasts, across a page break", () => {
    const { rows, rejected } = parseNamedAppropriations(law2026, 2026);
    expect(rejected).toEqual([]);
    expect(rows.map((r) => r.projectCode)).toEqual([
      "NP-25.002-0048",
      "NP-25.003-0019",
    ]); // the next annex's row is not taken
    const [insait, shipka] = rows;
    expect(insait).toMatchObject({
      section: "priority",
      seq: 1,
      currency: "EUR",
      institution: "Министерство на образованието и науката",
    });
    expect(insait.title).toContain("– Изграждане");
    expect(insait.amounts).toEqual([
      { year: 2026, kind: "appropriation", native: 3500, eur: 3_500_000 },
      { year: 2027, kind: "forecast", native: 3500, eur: 3_500_000 },
      { year: 2028, kind: "forecast", native: 4000, eur: 4_000_000 },
    ]);
    // a footnoted figure stands; a dash is „nothing set", not zero
    expect(shipka.amounts).toEqual([
      { year: 2026, kind: "appropriation", native: 3151.5, eur: 3_151_500 },
    ]);
  });

  it("reads the 2025 annex in leva, and the reserve list as indicative only", () => {
    const { rows } = parseNamedAppropriations(law2025, 2025);
    expect(rows.map((r) => [r.section, r.seq, r.amounts[0].kind])).toEqual([
      ["priority", 1, "appropriation"],
      ["reserve", 1, "indicative"],
    ]);
    expect(rows[0].amounts[0].eur).toBeCloseTo((3800 * 1000) / BGN_PER_EUR, 1);
  });

  it("returns nothing for a law without the annex", () => {
    expect(parseNamedAppropriations("<p>Чл. 1</p>", 2024)).toEqual({
      rows: [],
      rejected: [],
    });
  });

  it("rejects a row whose cell count no longer matches the header", () => {
    const short = law2026.replace(
      "<td><p><span>Министерство на културата</span></p></td>",
      "",
    );
    expect(parseNamedAppropriations(short, 2026).rejected).toEqual([
      { code: "NP-25.003-0019", reason: "7 cells, header has 8" },
    ]);
  });

  it("rejects a row whose amount it cannot read, rather than dropping the amount", () => {
    const broken = law2026.replace("3 500,0", "три и половина");
    expect(parseNamedAppropriations(broken, 2026).rejected).toEqual([
      { code: "NP-25.002-0048", reason: "unreadable № or amount" },
    ]);
  });
});
