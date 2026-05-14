// State Budget Law parser — extracts per-spending-unit appropriations from the
// Държавен вестник promulgated-law HTML.
//
// The law text introduces each first-level spending unit ("разпоредител с
// бюджет" — a ministry, agency, the judiciary, …) with "Приема бюджета на X за
// YYYY г." followed by an HTML <table> carrying that unit's appropriation
// breakdown. The table uses a leading-numbered-label structure:
//
//   ["№","Показатели","Сума (хил. лв.)"]
//   ["I.","ПРИХОДИ, ПОМОЩИ И ДАРЕНИЯ","100 000,0"]
//   ["1.","Неданъчни приходи","100 000,0"]
//   ["II.","РАЗХОДИ","1 221 324,9"]
//   ["III.","БЮДЖЕТНИ ВЗАИМООТНОШЕНИЯ (ТРАНСФЕРИ)","1 121 324,9"]
//   ["IV.","БЮДЖЕТНО САЛДО (І-ІІ+ІІІ)",""]
//
// Amounts are in THOUSANDS of leva (хил. лв.). Section II (РАЗХОДИ) is the
// unit's spending total — the figure that headlines a ministry budget.

import { load } from "cheerio";
import { toEur } from "../../src/lib/currency";
import type { FactKind, Money } from "./types";

// Minimal DOM-node shape — cheerio's nodes are domhandler nodes; we only need
// these fields to depth-first walk the tree in document order.
interface DomNode {
  type: string;
  name?: string;
  data?: string;
  children?: DomNode[];
}

export interface ParsedLawLine {
  code: string; // "1.", "1.1." — the leading numbered label
  labelBg: string;
  amount: Money | null;
}

export interface ParsedLawSection {
  code: string; // "I" | "II" | "III" | "IV"
  kind: FactKind;
  labelBg: string;
  amount: Money | null;
  lines: ParsedLawLine[];
}

// One row of a unit's program-budget table ("област на политика / бюджетна
// програма") — the appropriation by policy area / program.
export interface ParsedLawProgram {
  code: string; // "1.", "2." — the leading numbered label
  nameBg: string;
  amount: Money | null;
}

export interface ParsedLawUnit {
  unitName: string; // "Министерството на външните работи"
  fiscalYear: number;
  sections: ParsedLawSection[];
  // Empty for units that publish no program budget in the law text.
  programs: ParsedLawProgram[];
}

// "Приема бюджета на X за YYYY г." — one per first-level spending unit.
const MARKER_RE = /Приема бюджета на\s+([^,;]{4,90}?)\s+за\s+(20\d\d)\s*г/g;

// Roman-numeral section codes I…VI.
const SECTION_RE = /^(I|II|III|IV|V|VI)\.?$/;
// Decimal numbered line codes — "1.", "1.1.", "2.3.1."
const LINE_RE = /^\d+(\.\d+)*\.?$/;

// Map a section's Roman code to a FactKind. III (transfers) and any unmapped
// section fall through to null — they're parsed for context but not emitted as
// facts (the FactKind vocabulary has no "transfer").
const SECTION_KIND: Record<string, FactKind | null> = {
  I: "revenue",
  II: "expenditure",
  III: null, // БЮДЖЕТНИ ВЗАИМООТНОШЕНИЯ (ТРАНСФЕРИ)
  IV: "balance",
};

// "1 221 324,9" (thousands of leva) → Money. Space/NBSP thousands separators,
// comma decimal. Empty / non-numeric → null.
const cellToMoney = (cell: string | undefined): Money | null => {
  if (!cell) return null;
  const cleaned = cell.replace(/\s/g, "").replace(",", ".");
  if (cleaned === "" || cleaned === "-") return null;
  const thousands = Number(cleaned);
  if (!Number.isFinite(thousands)) return null;
  const amount = Math.round(thousands * 1000);
  const eur = toEur(amount, "BGN");
  return {
    amount,
    currency: "BGN",
    amountEur: eur == null ? amount : Math.round(eur),
  };
};

const cellText = (s: string | undefined): string =>
  (s ?? "").replace(/\s+/g, " ").trim();

// Pull the [code, label, amount] rows out of one <table> node.
const tableRows = (
  tableNode: DomNode,
  $: ReturnType<typeof load>,
): string[][] => {
  const rows: string[][] = [];
  $(tableNode as never)
    .find("tr")
    .each((_, tr) => {
      const cells = $(tr)
        .find("td,th")
        .map((__, td) => cellText($(td).text()))
        .get();
      if (cells.some((c) => c)) rows.push(cells);
    });
  return rows;
};

// A "unit appropriation table" has a header row carrying both "Показатели" and
// "Сума" — this excludes the program / sub-breakdown tables (whose header is
// "Органи на …" / a program name).
const isUnitTable = (rows: string[][]): boolean =>
  rows.some(
    (r) =>
      r.some((c) => /Показатели/i.test(c)) && r.some((c) => /Сума/i.test(c)),
  );

// A "program budget table" has a header row naming the policy-area / program
// column ("Наименование на областта на политика/бюджетната програма").
const isProgramTable = (rows: string[][]): boolean =>
  rows.some((r) =>
    r.some(
      (c) =>
        /област(та)?\s+на\s+политика/i.test(c) ||
        /бюджетна(та)?\s+програма/i.test(c),
    ),
  );

// Parse a program-budget table's rows into [code, name, amount] entries.
const parseProgramTable = (rows: string[][]): ParsedLawProgram[] => {
  const programs: ParsedLawProgram[] = [];
  for (const row of rows) {
    const code = (row[0] ?? "").trim();
    const name = cellText(row[1]);
    if (!LINE_RE.test(code) || !name) continue;
    programs.push({
      code: code.replace(/\.$/, ""),
      nameBg: name,
      amount: cellToMoney(row[row.length - 1]),
    });
  }
  return programs;
};

// Parse one unit table's rows into the I…IV section structure.
const parseUnitTable = (rows: string[][]): ParsedLawSection[] => {
  const sections: ParsedLawSection[] = [];
  let current: ParsedLawSection | null = null;
  for (const row of rows) {
    const code = (row[0] ?? "").replace(/І/g, "I").trim(); // normalise Cyrillic І→I
    const label = cellText(row[1]);
    const amount = cellToMoney(row[row.length - 1]);
    if (SECTION_RE.test(code)) {
      const roman = code.replace(".", "");
      current = {
        code: roman,
        kind: SECTION_KIND[roman] ?? "financing",
        labelBg: label,
        amount,
        lines: [],
      };
      sections.push(current);
      continue;
    }
    if (current && LINE_RE.test(code) && label) {
      current.lines.push({
        code: code.replace(/\.$/, ""),
        labelBg: label,
        amount,
      });
    }
  }
  return sections;
};

// Depth-first walk: collect, in document order, every "Приема бюджета на X"
// marker and every <table> node. Pairing happens afterwards.
const walkInOrder = (
  root: DomNode,
): {
  markers: Array<{ unit: string; year: number; order: number }>;
  tables: Array<{ node: DomNode; order: number }>;
} => {
  const markers: Array<{ unit: string; year: number; order: number }> = [];
  const tables: Array<{ node: DomNode; order: number }> = [];
  let order = 0;
  const visit = (node: DomNode): void => {
    order++;
    if (node.type === "text" && node.data) {
      MARKER_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = MARKER_RE.exec(node.data)) !== null) {
        markers.push({
          unit: m[1].replace(/\s+/g, " ").trim(),
          year: parseInt(m[2], 10),
          order,
        });
      }
    }
    if (node.type === "tag" && node.name === "table") {
      tables.push({ node, order });
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(root);
  return { markers, tables };
};

// Parse a Държавен вестник budget-law HTML page into per-spending-unit
// appropriations. Throws if the document yields no spending units — the
// upstream structure changed.
export const parseLawHtml = (
  html: string,
  fiscalYear: number,
): ParsedLawUnit[] => {
  const $ = load(html);
  const root = $.root()[0] as unknown as DomNode;
  const { markers, tables } = walkInOrder(root);
  // Only markers for the year we expect — guards against stray references.
  const yearMarkers = markers.filter((m) => m.year === fiscalYear);
  if (yearMarkers.length === 0) {
    throw new Error(
      `budget law ${fiscalYear}: no "Приема бюджета на …" spending units found ` +
        `— the Държавен вестник page structure likely changed`,
    );
  }

  const units: ParsedLawUnit[] = [];
  const usedTableOrders = new Set<number>();
  for (const marker of yearMarkers) {
    // Scan the tables in this unit's block — from its marker to the next.
    // The first unit-table (I…IV) is the appropriations; the first program
    // table is the policy-area / program budget (absent for some units).
    const nextMarkerOrder =
      yearMarkers.find((m) => m.order > marker.order)?.order ?? Infinity;
    let mainRows: string[][] | null = null;
    let programRows: string[][] | null = null;
    for (const tbl of tables) {
      if (tbl.order <= marker.order || tbl.order >= nextMarkerOrder) continue;
      if (usedTableOrders.has(tbl.order)) continue;
      const rows = tableRows(tbl.node, $);
      if (!mainRows && isUnitTable(rows)) {
        mainRows = rows;
        usedTableOrders.add(tbl.order);
      } else if (!programRows && isProgramTable(rows)) {
        programRows = rows;
        usedTableOrders.add(tbl.order);
      }
      if (mainRows && programRows) break;
    }
    if (!mainRows) continue; // unit with no parseable table — skipped, not fatal
    units.push({
      unitName: marker.unit,
      fiscalYear,
      sections: parseUnitTable(mainRows),
      programs: programRows ? parseProgramTable(programRows) : [],
    });
  }

  if (units.length === 0) {
    throw new Error(
      `budget law ${fiscalYear}: matched ${yearMarkers.length} spending unit(s) ` +
        `but none had a parseable appropriation table`,
    );
  }
  return units;
};
