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
import { stripDefiniteArticle } from "../lib/normalize_name";
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
  /** Names of grouping rows folded into this leaf (see parseProgramTable).
   *
   *  The law's programme registry is ALSO the execution-report join key —
   *  `execution_facts.ts` → `findProgramNode` matches each отчет row to a law
   *  node by normalised NAME, and drops an unmatched row with a bare
   *  `continue`. An отчет may name the SUBTOTAL rather than the leaf: МОСВ
   *  2024 reports „Други бюджетни програми" with €15,551,192 amended /
   *  €14,312,398 executed, and its only leaf („Дейности по метеорология…")
   *  is named nowhere in that отчет. Without the alias the subtotal row this
   *  parser now drops takes that execution overlay with it, silently — the
   *  reconciliation row flips `exact` → `missing` and `/budget/ministry`
   *  renders a plan-only programme. */
  aliases?: string[];
}

export interface ParsedLawUnit {
  unitName: string; // "Министерството на външните работи"
  fiscalYear: number;
  sections: ParsedLawSection[];
  // Empty for units that publish no program budget in the law text.
  programs: ParsedLawProgram[];
}

// The "Чл. 1" budget framework — the headline state-budget plan (whole-country
// totals), parsed from the two tables under "Приема държавния бюджет за YYYY г.
// по приходите …" and "… по разходите …". Carries the planned revenue tree
// (which mirrors КФП's revenue structure), planned spending headline, planned
// transfers tree, EU contribution, and the law-mandated deficit/surplus.
export interface ParsedLawFramework {
  fiscalYear: number;
  revenue: ParsedLawSection; // I.   ПРИХОДИ, ПОМОЩИ И ДАРЕНИЯ
  expenditure: ParsedLawSection; // II.  РАЗХОДИ
  transfers: ParsedLawSection; // III. БЮДЖЕТНИ ВЗАИМООТНОШЕНИЯ (ТРАНСФЕРИ) - НЕТО
  euContribution: ParsedLawSection; // IV.  ВНОСКА В ОБЩИЯ БЮДЖЕТ НА ЕС
  balance: ParsedLawSection | null; // V.   БЮДЖЕТНО САЛДО (signed; negative = deficit)
}

// "Приема бюджета на X за YYYY г." — one per first-level spending unit.
// The HTML occasionally renders the space after "Приема" as `&nbsp;`; match
// any whitespace including non-breaking space (U+00A0).
const MARKER_RE =
  /Приема[\s\u00A0]+бюджета на\s+([^,;]{4,90}?)\s+за\s+(20\d\d)\s*г/g;
// "Приема държавния бюджет за YYYY г. по приходите …" / "… по разходите …".
// Two markers; framework tables follow each. Same NBSP tolerance.
const FRAMEWORK_MARKER_RE =
  /Приема[\s\u00A0]+държавния бюджет за\s+(20\d\d)\s*г\.\s+по\s+(приходите|разходите)/g;

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

// Which currency a law's tables are denominated in. Laws through FY2025 are
// "(хил. лв.)"; from the FY2026 law (promulgated after Bulgaria adopted the euro
// on 2026-01-01) the same tables are "(хил. евро)". The tables themselves are
// identical in shape and the "Сума" header carries no unit, so the unit marker
// beside/above each table is the only signal — see detectLawCurrency.
type LawCurrency = "BGN" | "EUR";

// A law is uniformly one currency, so detect once per document by majority of
// the "(хил. лв.)" / "(хил. евро)" markers. Defaults to BGN: every pre-euro law
// is leva, and an unmarked document is far more likely an old layout than a new
// one. Getting this wrong is silent and halves (or doubles) every figure, so the
// caller asserts a marker was actually found.
export const detectLawCurrency = (
  html: string,
): { currency: LawCurrency; leva: number; euro: number } => {
  const leva = (html.match(/\(хил\.\s?лв\.\)/gi) ?? []).length;
  const euro = (html.match(/\(хил\.\s?евро\)/gi) ?? []).length;
  return { currency: euro > leva ? "EUR" : "BGN", leva, euro };
};

// "1 221 324,9" (thousands) → Money. Space/NBSP thousands separators, comma
// decimal. Empty / non-numeric → null. `currency` is the document's own
// denomination; an EUR-denominated law needs no conversion.
const cellToMoney = (
  cell: string | undefined,
  currency: LawCurrency,
): Money | null => {
  if (!cell) return null;
  const cleaned = cell.replace(/\s/g, "").replace(",", ".");
  if (cleaned === "" || cleaned === "-") return null;
  const thousands = Number(cleaned);
  if (!Number.isFinite(thousands)) return null;
  const amount = Math.round(thousands * 1000);
  if (currency === "EUR") return { amount, currency, amountEur: amount };
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
//
// ⚠ The table is HIERARCHICAL and only its LEAVES are programmes. A row whose
// code has children beneath it ("3" above "3.1") is a GROUPING SUBTOTAL, not a
// programme of its own:
//
//   МОСВ 2026        "3"   19 497 900  Други бюджетни програми:
//                    "3.1" 19 497 900  Бюджетна програма „Дейности по метеорология…“
//   ДА „Държавен     "1"   78 232 200  Политика … (общо), в т.ч.:
//    резерв“ 2026    "1.1" 69 928 000  Бюджетна програма „Държавни резерви…“
//                    "1.2"  8 304 200  Бюджетна програма „Запаси за извънредни…“
//
// Emitting both halves double-counts the subtotal: measured 2026-08-13, МОСВ's
// programmes summed to €97,272,000 against a €77,774,100 unit total (+25.1%,
// exactly the duplicated метеорология line) and ДА „Държавен резерв“ was +100.0%
// in every year 2018-2026. That reaches `/budget/ministry/<node>` (both the
// programme list and the stacked ProgramTrendChart) and `budget_program_fact`.
//
// The discriminator is the CODE DEPTH, never the wording. A name test
// (trailing ":", „в т.ч.", „(общо)") would be both loose — it cannot see a
// parent the law happened to name plainly — and unsafe, since a real programme
// may carry any of those strings. Amount equality is likewise not required: a
// parent whose children fail to sum exactly (rounding, a child the parser
// missed) is still a subtotal, and keeping it would be the double-count this
// exists to prevent.
const parseProgramTable = (
  rows: string[][],
  currency: LawCurrency,
): ParsedLawProgram[] => {
  const programs: ParsedLawProgram[] = [];
  for (const row of rows) {
    const code = (row[0] ?? "").trim();
    const name = cellText(row[1]);
    if (!LINE_RE.test(code) || !name) continue;
    programs.push({
      code: code.replace(/\.$/, ""),
      nameBg: name,
      amount: cellToMoney(row[row.length - 1], currency),
    });
  }
  // Keep the leaves. `startsWith(code + ".")` matches any DESCENDANT, so a
  // malformed table carrying "1" and "1.1.1" without the intermediate "1.1"
  // still drops the subtotal rather than counting it twice; and the dot makes
  // "11" a sibling of "1", not its child.
  const descendantsOf = (code: string): ParsedLawProgram[] =>
    programs.filter((o) => o.code.startsWith(`${code}.`));
  const leaves = programs.filter((p) => descendantsOf(p.code).length === 0);

  // Carry a dropped subtotal's NAME onto its leaf, so the execution matcher can
  // still resolve an отчет that reports at the grouping level (see
  // ParsedLawProgram.aliases). Only an unambiguous 1:1 fold qualifies — a
  // subtotal with exactly ONE leaf beneath it IS that leaf's money, whatever
  // the depth of the chain between them. A subtotal over SEVERAL leaves (ДА
  // „Държавен резерв“: "1" over "1.1"+"1.2") is deliberately left unaliased:
  // its отчет row cannot be attributed to any single leaf, and guessing one
  // would trade a silent loss for a silent misattribution, which is worse.
  for (const p of programs) {
    const kids = descendantsOf(p.code).filter((o) => leaves.includes(o));
    if (kids.length === 1)
      kids[0].aliases = [...(kids[0].aliases ?? []), p.nameBg];
  }
  return leaves;
};

// Parse one unit table's rows into the I…IV section structure.
const parseUnitTable = (
  rows: string[][],
  currency: LawCurrency,
): ParsedLawSection[] => {
  const sections: ParsedLawSection[] = [];
  let current: ParsedLawSection | null = null;
  for (const row of rows) {
    const code = (row[0] ?? "").replace(/І/g, "I").trim(); // normalise Cyrillic І→I
    const label = cellText(row[1]);
    const amount = cellToMoney(row[row.length - 1], currency);
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
// marker, every "Приема държавния бюджет за YYYY г. по …" framework marker,
// and every <table> node. Pairing happens afterwards.
const walkInOrder = (
  root: DomNode,
): {
  markers: Array<{ unit: string; year: number; order: number }>;
  frameworkMarkers: Array<{
    year: number;
    half: "revenue" | "spending";
    order: number;
  }>;
  tables: Array<{ node: DomNode; order: number }>;
} => {
  const markers: Array<{ unit: string; year: number; order: number }> = [];
  const frameworkMarkers: Array<{
    year: number;
    half: "revenue" | "spending";
    order: number;
  }> = [];
  const tables: Array<{ node: DomNode; order: number }> = [];
  let order = 0;
  const visit = (node: DomNode): void => {
    order++;
    if (node.type === "text" && node.data) {
      // The HTML uses NBSP between words; collapse to a regular space so the
      // markers match. Doing the replace on the text-node level (rather than
      // in the regex) keeps the regex readable and works the same for both
      // marker families.
      const text = node.data.replace(/\u00A0/g, " ");
      MARKER_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = MARKER_RE.exec(text)) !== null) {
        markers.push({
          unit: m[1].replace(/\s+/g, " ").trim(),
          year: parseInt(m[2], 10),
          order,
        });
      }
      FRAMEWORK_MARKER_RE.lastIndex = 0;
      let fm: RegExpExecArray | null;
      while ((fm = FRAMEWORK_MARKER_RE.exec(text)) !== null) {
        frameworkMarkers.push({
          year: parseInt(fm[1], 10),
          half: fm[2] === "приходите" ? "revenue" : "spending",
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
  return { markers, frameworkMarkers, tables };
};

// Combine the two framework tables (revenue + spending) into a single
// `ParsedLawFramework`. The spending table carries sections II, III, IV, and
// optionally V (БЮДЖЕТНО САЛДО) — each appears as a separate I…IV-style row
// in the source, and parseUnitTable already splits them.
const buildFramework = (
  fiscalYear: number,
  revenueRows: string[][],
  spendingRows: string[][],
  currency: LawCurrency,
): ParsedLawFramework | null => {
  const revenueSections = parseUnitTable(revenueRows, currency);
  const spendingSections = parseUnitTable(spendingRows, currency);
  const revenue = revenueSections.find((s) => s.code === "I");
  const expenditure = spendingSections.find((s) => s.code === "II");
  const transfers = spendingSections.find((s) => s.code === "III");
  const euContribution = spendingSections.find((s) => s.code === "IV");
  const balance = spendingSections.find((s) => s.code === "V") ?? null;
  if (!revenue || !expenditure || !transfers || !euContribution) return null;
  return {
    fiscalYear,
    revenue,
    expenditure,
    transfers,
    euContribution,
    balance,
  };
};

// Parse a Държавен вестник budget-law HTML page into per-spending-unit
// appropriations plus the Чл. 1 framework totals. Throws if the document
// yields no spending units — the upstream structure changed. `framework` may
// still be null for older law layouts that lack the framework markers.
export const parseLawHtml = (
  html: string,
  fiscalYear: number,
): { units: ParsedLawUnit[]; framework: ParsedLawFramework | null } => {
  const $ = load(html);
  const root = $.root()[0] as unknown as DomNode;
  const { currency, leva, euro } = detectLawCurrency(html);
  // An unmarked document would silently default to BGN and halve every figure
  // in a euro-denominated law, so require the marker rather than assume.
  if (leva === 0 && euro === 0) {
    throw new Error(
      `budget law ${fiscalYear}: no "(хил. лв.)" / "(хил. евро)" unit marker ` +
        `found — cannot determine the law's denomination`,
    );
  }
  const { markers, frameworkMarkers, tables } = walkInOrder(root);
  // Pair each framework marker with the first unused table after it. Both
  // halves needed to build the framework — fall through with null if either
  // is missing (older layouts).
  const yearFrameworkMarkers = frameworkMarkers
    .filter((m) => m.year === fiscalYear)
    .sort((a, b) => a.order - b.order);
  const usedFrameworkTableOrders = new Set<number>();
  const frameworkRows: Partial<Record<"revenue" | "spending", string[][]>> = {};
  for (const fm of yearFrameworkMarkers) {
    for (const tbl of tables) {
      if (tbl.order <= fm.order || usedFrameworkTableOrders.has(tbl.order)) {
        continue;
      }
      const rows = tableRows(tbl.node, $);
      if (!isUnitTable(rows)) continue;
      frameworkRows[fm.half] = rows;
      usedFrameworkTableOrders.add(tbl.order);
      break;
    }
  }
  const framework =
    frameworkRows.revenue && frameworkRows.spending
      ? buildFramework(
          fiscalYear,
          frameworkRows.revenue,
          frameworkRows.spending,
          currency,
        )
      : null;
  // Only markers for the year we expect — guards against stray references.
  const yearMarkers = markers.filter((m) => m.year === fiscalYear);
  if (yearMarkers.length === 0) {
    throw new Error(
      `budget law ${fiscalYear}: no "Приема бюджета на …" spending units found ` +
        `— the Държавен вестник page structure likely changed`,
    );
  }

  const units: ParsedLawUnit[] = [];
  // Pre-claim the framework tables so they can't accidentally be matched as
  // unit appropriation tables (the framework tables also pass `isUnitTable`).
  const usedTableOrders = new Set<number>(usedFrameworkTableOrders);
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
      // The law's marker reads "Министерството на ...", with the definite
      // article. Every other ingest source uses "Министерство на ..." —
      // strip the article here so the unit name is comparable across
      // budget × funds × officials × procurement.
      unitName: stripDefiniteArticle(marker.unit),
      fiscalYear,
      sections: parseUnitTable(mainRows, currency),
      programs: programRows ? parseProgramTable(programRows, currency) : [],
    });
  }

  if (units.length === 0) {
    throw new Error(
      `budget law ${fiscalYear}: matched ${yearMarkers.length} spending unit(s) ` +
        `but none had a parseable appropriation table`,
    );
  }
  return { units, framework };
};
