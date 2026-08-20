// Pure parser tests — no network, no database. The fixtures are two real pages:
// area 39 (Право, the busiest at 20 experts) and area 69 (Изкуства, genuinely
// empty), because „empty" and „broken" must stay distinguishable.

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { foldExperts, parseAreaPage, parseBgDate } from "./parse";
import { areaUrl } from "./sources";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const fixture = (n: number): string =>
  // The register serves windows-1251 and declares it only in a <meta>. Decoding as
  // UTF-8 does not throw — it yields mojibake that still passes every row count.
  new TextDecoder("windows-1251").decode(
    fs.readFileSync(path.join(DIR, "__fixtures__", `area_${n}.html`)),
  );

describe("parseBgDate", () => {
  it("reads the register's dd.mm.yyyy, with or without the „г.“ marker", () => {
    expect(parseBgDate("01.01.2020 г.")).toBe("2020-01-01");
    expect(parseBgDate("21.12.2017")).toBe("2017-12-21");
    expect(parseBgDate("21.12.2017 г")).toBe("2017-12-21");
  });

  it("returns null rather than a wrong date on an impossible one", () => {
    // Date() would roll 31.02 over to 03-03. A silently rolled date on a register
    // whose whole content is validity windows is worse than no date.
    expect(parseBgDate("31.02.2020 г.")).toBeNull();
    expect(parseBgDate("00.01.2020")).toBeNull();
    expect(parseBgDate("2020-01-01")).toBeNull();
    expect(parseBgDate("")).toBeNull();
  });
});

describe("parseAreaPage", () => {
  it("parses the busiest area and matches the register's own count", () => {
    const p = parseAreaPage(fixture(39), 39);
    expect(p.declaredTotal).toBe(20);
    expect(p.rows).toHaveLength(20);
    for (const r of p.rows) {
      expect(r.une).toMatch(/^ЕТС-\d+$/u);
      expect(r.name.length).toBeGreaterThan(3);
      expect(r.areaNo).toBe(39);
    }
  });

  it("distinguishes a genuinely EMPTY area from a broken parse", () => {
    // The whole reason the declared total is parsed: without it, „0 experts" and
    // „the layout moved and we matched nothing" are the same observation.
    const p = parseAreaPage(fixture(69), 69);
    expect(p.declaredTotal).toBe(0);
    expect(p.rows).toEqual([]);
  });

  it("never mistakes the search FORM's own rows for experts", () => {
    // The form and the results are sibling tables with no distinguishing markup;
    // both fixtures contain the full form.
    const names = parseAreaPage(fixture(39), 39).rows.map((r) => r.name);
    for (const label of [
      "Име:",
      "Фамилия:",
      "Презиме*:",
      "Област на компетентност:",
    ])
      expect(names).not.toContain(label);
  });

  it("REFUSES when the parsed count disagrees with the declared one", () => {
    // Mutation check: drop one result row and the parse must fail rather than
    // return 19 of 20. A partial area is indistinguishable from a small one.
    const html = fixture(39);
    // NOT indexOf("ЕТС-"): the search form carries „ЕТС-" as a field PREFIX label,
    // so the first hit is a form row. Removing that leaves the 20 results intact
    // and the assertion passes without testing anything.
    const i = html.search(/ЕТС-\d+/u);
    const rowStart = html.lastIndexOf("<tr", i);
    const rowEnd = html.indexOf("</tr>", i) + 5;
    const mutated = html.slice(0, rowStart) + html.slice(rowEnd);
    expect(() => parseAreaPage(mutated, 39)).toThrow(
      /declares 20 .*parsed 19/s,
    );
  });

  it("REFUSES a page with no declared total at all", () => {
    expect(() =>
      parseAreaPage(fixture(39).replace(/Общ\s+брой:/u, "xx:"), 39),
    ).toThrow(/no „Общ брой“/u);
  });

  it("rejects an area number the register does not have", () => {
    expect(() => parseAreaPage(fixture(39), 0)).toThrow(
      /unknown competence area/,
    );
    expect(() => parseAreaPage(fixture(39), 78)).toThrow(
      /unknown competence area/,
    );
  });
});

describe("foldExperts", () => {
  it("folds one expert's several areas into ONE expert", () => {
    const p39 = parseAreaPage(fixture(39), 39);
    // Same rows presented under a second area — the multi-area case, which is 28
    // of the register's 88 people. Summing per-area counts double-counts them.
    const alias = {
      ...p39,
      rows: p39.rows.map((r) => ({
        ...r,
        areaNo: 37,
        area: "37. Администрация и управление",
      })),
    };
    const folded = foldExperts([p39, alias]);
    expect(folded).toHaveLength(p39.rows.length);
    expect(folded[0].areas.map((a) => a.areaNo)).toEqual([37, 39]);
  });

  it("keeps a DIFFERENT validity window per area, and unions them on the expert", () => {
    // 4 of the register's 88 experts carry two windows because they were admitted
    // to a second competence area later. Storing one scalar pair per expert keeps
    // whichever area was visited first — one of two true answers, chosen by loop
    // order. This is the regression guard for that.
    const p = parseAreaPage(fixture(39), 39);
    const one = { ...p, rows: [p.rows[0]] };
    const later = {
      ...p,
      rows: [
        {
          ...p.rows[0],
          areaNo: 37,
          area: "37. Администрация и управление",
          validFrom: "2019-01-01",
          validUntil: "2022-01-01",
        },
      ],
    };
    const [e] = foldExperts([one, later]);
    expect(e.areas).toHaveLength(2);
    expect(e.areas.find((a) => a.areaNo === 37)?.validUntil).toBe("2022-01-01");
    expect(e.areas.find((a) => a.areaNo === 39)?.validUntil).toBe(
      p.rows[0].validUntil,
    );
    // the expert-level window is the UNION, not either area's
    const untils = [p.rows[0].validUntil, "2022-01-01"].filter(Boolean).sort();
    expect(e.validUntil).toBe(untils.at(-1));
  });

  it("is deterministic in УНЕ order", () => {
    const p = parseAreaPage(fixture(39), 39);
    expect(foldExperts([p]).map((e) => e.une)).toEqual(
      foldExperts([p]).map((e) => e.une),
    );
  });
});

describe("areaUrl", () => {
  it("sends every field the form does, and the area", () => {
    const u = new URL(areaUrl(39));
    expect(u.searchParams.get("mode")).toBe("search");
    expect(u.searchParams.get("ets_prof_oblast")).toBe("39");
    for (const f of [
      "ets_venum",
      "ets_appl_id",
      "first_name",
      "mid_name",
      "last_name",
    ])
      expect(u.searchParams.get(f)).toBe("");
  });

  it("refuses a non-area", () => {
    expect(() => areaUrl(0)).toThrow(/positive integer/);
    expect(() => areaUrl(1.5)).toThrow(/positive integer/);
  });
});
