// The ЗБДОО annex parsers' THROW paths.
//
// The throw/count split is the whole design of these parsers — structural
// faults are fatal, a below-floor value is merely counted — and every check
// that runs against the real law exercises only the happy path. A parser that
// silently returned 3 rows instead of 86 would satisfy every assertion the
// smoke makes about the artifact it just wrote.
//
// Synthetic HTML rather than the cached ДВ blob: these cases are about shapes
// the real document does not have, and the tests must run without network or
// raw_data.
import { describe, expect, it } from "vitest";
import { parseModAnnex, parseTzpbAnnex } from "./parse_zbdoo_annexes";

/** Build a МОД annex table: `rows` activity rows of `cols` cells each. */
const modHtml = (
  rows: number,
  cols = 13,
  value = "550.66",
  extras = "",
): string => {
  const body = Array.from({ length: rows }, (_, i) => {
    const cells = Array.from({ length: cols }, (_, c) =>
      c === 0
        ? `<td>${i + 1}</td>`
        : c < 4
          ? `<td>x</td>`
          : `<td>${value}</td>`,
    ).join("");
    return `<tr>${cells}</tr>`;
  }).join("");
  return `PRE Приложение № 1 <table><tr>${Array.from({ length: cols }, () => "<td>h</td>").join("")}</tr>${body}${extras}</table> Приложение № 1А TAIL`;
};

const MOD_OPTS = {
  annex: "1",
  fromMarker: "Приложение № 1",
  toMarker: "Приложение № 1А",
  periodFrom: "2026-01-01",
  periodTo: "2026-07-31",
  floorEur: 550.66,
  expectedRows: 86,
};

describe("parseModAnnex — structural faults are fatal", () => {
  it("parses a well-formed table", () => {
    const a = parseModAnnex(modHtml(86), MOD_OPTS);
    expect(a.rows).toHaveLength(86);
    expect(a.stats.gridCells).toBe(774);
    expect(a.stats.populatedCells).toBe(774);
  });

  it("throws when rows are lost", () => {
    // The failure that is otherwise silent: fewer rows, no error, every
    // downstream aggregate quietly smaller.
    expect(() => parseModAnnex(modHtml(85), MOD_OPTS)).toThrow(
      /expected 86 activity rows, got 85/,
    );
  });

  it("throws when the column count shifts", () => {
    expect(() => parseModAnnex(modHtml(86, 12), MOD_OPTS)).toThrow(
      /expected every row to have 13 cells/,
    );
  });

  it("throws when rows have inconsistent widths", () => {
    const ragged = modHtml(86, 13, "550.66", "<tr><td>x</td></tr>");
    expect(() => parseModAnnex(ragged, MOD_OPTS)).toThrow(
      /expected every row to have 13 cells/,
    );
  });

  it("throws when the start marker is absent", () => {
    expect(() => parseModAnnex("<p>nothing here</p>", MOD_OPTS)).toThrow(
      /annex marker not found/,
    );
  });

  it("throws when the END marker is absent, instead of slicing to EOF", () => {
    // Slicing to EOF swallows every later appendix and then fails as a
    // row-count mismatch, which points at the wrong cause.
    const noEnd = modHtml(86).replace(" Приложение № 1А TAIL", "");
    expect(() => parseModAnnex(noEnd, MOD_OPTS)).toThrow(
      /annex end marker not found/,
    );
  });

  it("throws on a non-empty cell that will not parse", () => {
    expect(() => parseModAnnex(modHtml(86, 13, "n/a"), MOD_OPTS)).toThrow(
      /cannot parse "n\/a"/,
    );
  });
});

describe("parseModAnnex — data facts are counted, not fatal", () => {
  it("treats a blank cell as data, not as an error", () => {
    const a = parseModAnnex(modHtml(86, 13, ""), MOD_OPTS);
    expect(a.stats.populatedCells).toBe(0);
    expect(a.stats.blankCells).toBe(774);
    expect(a.rows[0].byQualificationGroup.every((v) => v === null)).toBe(true);
  });

  it("COUNTS a value below the floor rather than throwing", () => {
    // A cell below the floor would be a real, editorially interesting fact
    // about the law. Rejecting it would reject valid data.
    const a = parseModAnnex(modHtml(86, 13, "100"), MOD_OPTS);
    expect(a.stats.belowFloor).toBe(774);
    expect(a.stats.aboveFloor).toBe(0);
  });

  it("counts above-floor cells and the maximum", () => {
    const a = parseModAnnex(modHtml(86, 13, "901.41"), MOD_OPTS);
    expect(a.stats.aboveFloor).toBe(774);
    expect(a.stats.maxEur).toBe(901.41);
  });
});

const tzpbHtml = (rows: number, rate = "1,1", cols = 3): string => {
  const body = Array.from({ length: rows }, (_, i) => {
    const cells = [`<td>${i + 1}</td>`, `<td>Дейност</td>`, `<td>${rate}</td>`]
      .slice(0, cols)
      .concat(Array.from({ length: Math.max(0, cols - 3) }, () => "<td>z</td>"))
      .join("");
    return `<tr>${cells}</tr>`;
  }).join("");
  return `Приложение № 2 <table><tr><td>a</td><td>b</td><td>c</td></tr>${body}</table> Приложение № 2А`;
};

const TZPB_OPTS = {
  annex: "2",
  fromMarker: "Приложение № 2",
  toMarker: "Приложение № 2А",
  periodFrom: "2026-01-01",
  periodTo: "2026-07-31",
  expectedRows: 87,
};

describe("parseTzpbAnnex", () => {
  it("parses a well-formed table and both decimal separators", () => {
    // ДВ really does mix them: Прил. 2 prints "1,1" where Прил. 2А prints "1.1".
    expect(parseTzpbAnnex(tzpbHtml(87, "1,1"), TZPB_OPTS).rows[0].ratePct).toBe(
      1.1,
    );
    expect(parseTzpbAnnex(tzpbHtml(87, "1.1"), TZPB_OPTS).rows[0].ratePct).toBe(
      1.1,
    );
  });

  it("throws when rows are lost", () => {
    expect(() => parseTzpbAnnex(tzpbHtml(86), TZPB_OPTS)).toThrow(
      /expected 87 activity rows, got 86/,
    );
  });

  it("throws when the column count shifts", () => {
    expect(() => parseTzpbAnnex(tzpbHtml(87, "1,1", 4), TZPB_OPTS)).toThrow(
      /expected every row to have 3 cells/,
    );
  });

  it("throws on a rate outside чл. 14's set", () => {
    // 2.5% is not a rate the law can set; seeing one means a column slipped.
    expect(() => parseTzpbAnnex(tzpbHtml(87, "2,5"), TZPB_OPTS)).toThrow(
      /outside чл. 14's set/,
    );
  });
});
