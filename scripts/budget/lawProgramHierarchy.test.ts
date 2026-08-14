// The programme table in the State Budget Law is hierarchical, and only its
// LEAVES are programmes — a row with children beneath it ("3" above "3.1") is a
// grouping subtotal. Emitting both halves double-counts: measured 2026-08-13,
// МОСВ's programmes summed to +25.1% of its unit total and ДА „Държавен резерв“
// to +100.0% in every year 2018-2026. See parseProgramTable in law_html.ts.
//
// Both fixtures are the real 2026 shapes, verbatim from raw_data/budget/
// law-245041.html.gz: МОСВ is the one-child case (where parent and child carry
// an identical amount) and ДА „Държавен резерв“ the n-child case (where they do
// not). МФ is the control — a flat table that must pass through untouched.

import { describe, it, expect } from "vitest";
import { parseLawHtml, type ParsedLawProgram } from "./law_html";

/** Wrap unit + programme tables in the minimum markup parseLawHtml needs: the
 *  currency marker, the "Приема бюджета на X за YYYY г." unit marker, a unit
 *  table (header carries Показатели + Сума) and a programme table (header names
 *  the област на политика/бюджетна програма column). */
const lawHtml = (
  units: Array<{ name: string; total: string; programs: string[][] }>,
): string => {
  const blocks = units
    .map(
      (u) => `
  <p>Чл. 20. (1) Приема бюджета на ${u.name} за 2026 г. както следва:</p>
  <table>
    <tr><td>№</td><td>Показатели</td><td>Сума (хил. евро)</td></tr>
    <tr><td>II.</td><td>РАЗХОДИ</td><td>${u.total}</td></tr>
  </table>
  <table>
    <tr><td>№</td><td>Наименование на областта на политика/бюджетната програма</td><td>Сума</td></tr>
    ${u.programs
      .map(
        ([code, name, amount]) =>
          `<tr><td>${code}</td><td>${name}</td><td>${amount}</td></tr>`,
      )
      .join("\n    ")}
  </table>`,
    )
    .join("\n");
  return `<html><body><p>Сума (хил. евро)</p>${blocks}</body></html>`;
};

const programsOf = (html: string, unitMatch: RegExp) => {
  const { units } = parseLawHtml(html, 2026);
  const unit = units.find((u) => unitMatch.test(u.unitName));
  if (!unit) throw new Error(`fixture unit not found: ${unitMatch}`);
  return unit.programs;
};

// cellToMoney scales the хил. cell by 1000, so a "77 774,1" total is 77_774_100.
const eur = (p: ParsedLawProgram): number => p.amount?.amountEur ?? 0;

describe("parseProgramTable — hierarchical programme rows", () => {
  it("drops a one-child subtotal (МОСВ 2026 „Други бюджетни програми:“)", () => {
    const html = lawHtml([
      {
        name: "Министерството на околната среда и водите",
        total: "77 774,1",
        programs: [
          ["1.", "Политика в областта на опазването и ползването на компонентите на околната среда", "28 831,9"], // prettier-ignore
          ["2.", "Политика в областта на Националната система за мониторинг на околната среда", "10 853,8"], // prettier-ignore
          ["3.", "Други бюджетни програми:", "19 497,9"],
          ["3.1.", "Бюджетна програма „Дейности по метеорология, хидрология и агрометеорология“", "19 497,9"], // prettier-ignore
          ["4.", "Бюджетна програма „Администрация“", "18 590,5"],
        ],
      },
    ]);
    const programs = programsOf(html, /околната среда/);

    expect(programs.map((p) => p.code)).toEqual(["1", "2", "3.1", "4"]);
    expect(programs.map((p) => p.nameBg)).not.toContain(
      "Други бюджетни програми:",
    );
    // The subtotal and its single child carry the SAME amount, so keeping both
    // is exactly the +25.1% over-count this guards.
    expect(programs.reduce((a, p) => a + eur(p), 0)).toBe(77_774_100);

    // …but the dropped name must survive as an alias, or МОСВ 2024's отчет —
    // which reports „Други бюджетни програми" and never names the leaf — stops
    // matching and its €14.3m executed is discarded by execution_facts.ts.
    expect(programs.find((p) => p.code === "3.1")?.aliases).toEqual([
      "Други бюджетни програми:",
    ]);
  });

  it("drops an n-child subtotal whose children do not tie (ДА „Държавен резерв“ 2026)", () => {
    const html = lawHtml([
      {
        name: "Държавната агенция „Държавен резерв и военновременни запаси“",
        total: "78 232,2",
        programs: [
          ["1.", "Политика в областта на държавните резерви, военновременните запаси и задължителните запаси от нефт и нефтопродукти (общо), в т.ч.:", "78 232,2"], // prettier-ignore
          ["1.1.", "Бюджетна програма „Държавни резерви и военновременни запаси“", "69 928,0"], // prettier-ignore
          ["1.2.", "Бюджетна програма „Запаси за извънредни ситуации от нефт и нефтопродукти“", "8 304,2"], // prettier-ignore
        ],
      },
    ]);
    const programs = programsOf(html, /Държавен резерв/);

    expect(programs.map((p) => p.code)).toEqual(["1.1", "1.2"]);
    expect(programs.reduce((a, p) => a + eur(p), 0)).toBe(78_232_200);

    // No alias here, deliberately: a subtotal over SEVERAL leaves cannot be
    // attributed to any one of them, so an отчет reporting at that level stays
    // unmatched rather than being misattributed to the larger child.
    expect(programs.map((p) => p.aliases)).toEqual([undefined, undefined]);
  });

  it("leaves a flat programme table untouched (МФ 2026)", () => {
    const html = lawHtml([
      {
        name: "Министерството на финансите",
        total: "409 151,9",
        programs: [
          ["1.", "Политика в областта на устойчивите и прозрачни публични финанси", "46 687,4"], // prettier-ignore
          ["2.", "Политика в областта на ефективното събиране на всички държавни приходи", "298 713,2"], // prettier-ignore
          ["3.", "Политика в областта на защитата на обществото и икономиката от финансови измами", "40 829,0"], // prettier-ignore
          ["4.", "Политика в областта на управлението на дълга", "3 531,4"],
          ["5.", "Бюджетна програма „Администрация“", "19 390,9"],
        ],
      },
    ]);
    const programs = programsOf(html, /финансите/);

    expect(programs.map((p) => p.code)).toEqual(["1", "2", "3", "4", "5"]);
    expect(programs.reduce((a, p) => a + eur(p), 0)).toBe(409_151_900);
  });

  it('treats a numeric sibling as a sibling, not a child ("11" under "1")', () => {
    // The child test is `startsWith(code + ".")`, so the dot is what separates
    // "1.1" (a child of 1) from "11" (a tenth sibling). Without it every table
    // with more than nine programmes would lose its first row.
    const html = lawHtml([
      {
        name: "Министерството на примера",
        total: "30,0",
        programs: [
          ["1.", "Първа програма", "10,0"],
          ["11.", "Единадесета програма", "20,0"],
        ],
      },
    ]);
    const programs = programsOf(html, /примера/);

    expect(programs.map((p) => p.code)).toEqual(["1", "11"]);
    expect(programs.reduce((a, p) => a + eur(p), 0)).toBe(30_000);
  });

  it('drops a subtotal whose intermediate level is missing ("1" + "1.1.1")', () => {
    // A malformed table must still not double-count: "1" has a DESCENDANT even
    // though its immediate child is absent, so it is a subtotal.
    const html = lawHtml([
      {
        name: "Министерството на примера",
        total: "5,0",
        programs: [
          ["1.", "Група", "5,0"],
          ["1.1.1.", "Единствената програма", "5,0"],
        ],
      },
    ]);
    const programs = programsOf(html, /примера/);

    expect(programs.map((p) => p.code)).toEqual(["1.1.1"]);
    expect(programs.reduce((a, p) => a + eur(p), 0)).toBe(5_000);
  });

  it("drops every non-leaf level of a three-level table", () => {
    // Where "drop rows with an immediate child" and the correct "drop rows with
    // any descendant" diverge: "1" must go even though its child "1.1" is
    // itself a subtotal. The chain "1" → "1.1" has TWO leaves beneath it, so
    // neither name is aliased.
    const html = lawHtml([
      {
        name: "Министерството на примера",
        total: "9,0",
        programs: [
          ["1.", "Област на политика (общо)", "9,0"],
          ["1.1.", "Група (общо)", "9,0"],
          ["1.1.1.", "Програма А", "4,0"],
          ["1.1.2.", "Програма Б", "5,0"],
        ],
      },
    ]);
    const programs = programsOf(html, /примера/);

    expect(programs.map((p) => p.code)).toEqual(["1.1.1", "1.1.2"]);
    expect(programs.reduce((a, p) => a + eur(p), 0)).toBe(9_000);
    expect(programs.map((p) => p.aliases)).toEqual([undefined, undefined]);
  });

  it("keeps an amount-less leaf as a node and still drops its blank parent", () => {
    // cellToMoney returns null for "" and "-". The filter is CODE-based, so a
    // blank subtotal must still be dropped; and a blank leaf must still be
    // emitted, because facts.ts registers the node before it checks the amount
    // (`if (!program.amount) continue` skips only the fact).
    const html = lawHtml([
      {
        name: "Министерството на примера",
        total: "5,0",
        programs: [
          ["1.", "Група", "-"],
          ["1.1.", "Програма без сума", ""],
          ["2.", "Програма", "5,0"],
        ],
      },
    ]);
    const programs = programsOf(html, /примера/);

    expect(programs.map((p) => p.code)).toEqual(["1.1", "2"]);
    expect(programs.find((p) => p.code === "1.1")?.amount).toBeNull();
    // A blank parent still folds its identity onto its only leaf.
    expect(programs.find((p) => p.code === "1.1")?.aliases).toEqual(["Група"]);
  });

  it('scopes the leaf filter to one unit (A\'s "1" is not a parent of B\'s "1.1")', () => {
    // parseProgramTable is invoked once per table, so cross-unit matching is
    // structurally impossible today. Nothing else pins that: hoisting the
    // filter to run over every unit at once would silently delete ministry A's
    // only programme because ministry B happens to have a deeper code.
    const html = lawHtml([
      {
        name: "Министерството на А",
        total: "10,0",
        programs: [["1.", "Само една програма", "10,0"]],
      },
      {
        name: "Министерството на Б",
        total: "10,0",
        programs: [["1.1.", "Друга програма", "10,0"]],
      },
    ]);

    expect(programsOf(html, /на А/).map((p) => p.code)).toEqual(["1"]);
    expect(programsOf(html, /на Б/).map((p) => p.code)).toEqual(["1.1"]);
    expect(programsOf(html, /на Б/)[0].aliases).toBeUndefined();
  });
});
