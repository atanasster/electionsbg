// Parses Приложение № 3 към чл. 113 / чл. 107 of the State Budget Law — the
// Investment Program for Municipal Projects. Published as a borderless PDF
// annex to the law in Държавен вестник.
//
// 2025: https://dv.parliament.bg/DVPics/2025/26_25/1619.pdf (120 pages,
//        3066 project rows; via Adobe InDesign).
// 2024: similar shape, different URL on parliament.bg (Excel-origin PDF).
//
// Page layout — 4 columns, no rules:
//   col 1 (x≈40-90):    Project ID — "OP-YY.NNN-NNNN" — stable across years
//   col 2 (x≈100-355):  Project name (can wrap to 2-3 lines)
//   col 3 (x≈370-435):  Total cost in хил. лв.
//   col 4 (x≈440-...):  Responsible institution — "Община X, област Y"
//
// Strategy: collect every text item with its (x,y). Find rows whose first
// item is an OP- identifier — those are the project anchors. For each
// anchor, scan items in the y-band [prev_anchor_y, next_anchor_y) and
// classify by x-position into the four columns. Wrapped names/institutions
// land on multiple PDF baselines but share the same x-band and project
// y-range, so concatenation reconstructs the cell content.

import { createRequire } from "module";
import { toEur } from "../../../src/lib/currency";
import type { Money } from "../types";

const require = createRequire(import.meta.url);
const pdfjs = require("pdfjs-dist") as PdfjsLib;

interface PdfjsLib {
  getDocument: (opts: { data: Uint8Array; isEvalSupported?: boolean }) => {
    promise: Promise<PdfDocument>;
  };
}
interface PdfTextItem {
  str: string;
  transform: number[]; // [a,b,c,d,e,f] — e,f are x,y
}
interface PdfPage {
  getTextContent: () => Promise<{
    items: Array<PdfTextItem | { type: string }>;
  }>;
}
interface PdfDocument {
  numPages: number;
  getPage: (n: number) => Promise<PdfPage>;
}

// Column-boundary x-thresholds. Calibrated against the 2025 PDF; the 2024
// PDF uses the same Office origin (Excel template) so the same numbers hold.
const COL_PROJECT_ID_MAX_X = 95;
const COL_NAME_MAX_X = 380;
const COL_COST_MAX_X = 420;

// One project's text band spans roughly 16pt of PDF height (top line of name
// to bottom line of institution wrap). Anything outside [anchor_y - 8,
// anchor_y + 12] in packed coordinates belongs to the previous/next project
// or to the page header.
const PROJECT_BAND_RADIUS = 12;

const OP_ID_RE = /^OP-\d{2}\.\d{3}-\d{4}$/;
const COST_RE = /^[\d\s.,]+$/;

interface PositionedItem {
  x: number;
  y: number;
  str: string;
}

export interface ParsedInvestmentProject {
  projectId: string;
  name: string;
  // Responsible institution as printed: "Община X, област Y".
  responsibleInstitution: string;
  // Extracted from `responsibleInstitution` when the format matches.
  municipalityName: string | null;
  oblastName: string | null;
  // Total cost as printed (хил. лв.) + Money.
  costThousandsBgn: number;
  cost: Money;
}

export interface ParsedInvestmentAnnex {
  fiscalYear: number;
  projects: ParsedInvestmentProject[];
  // Names that didn't match "Община X, област Y" — investigate manually.
  unparsedInstitutions: string[];
}

// Lightweight project-type classifier — regex-based tagging from the
// project name. Lets the drilldown surface a "by type" breakdown without
// extra source data. Heuristic, not authoritative; tweak as new patterns
// surface in the annex.
export type InvestmentCategory =
  | "roads"
  | "water_sewage"
  | "education"
  | "social"
  | "sports"
  | "culture"
  | "buildings"
  | "energy"
  | "other";

export const classifyProject = (name: string): InvestmentCategory => {
  const n = name.toLowerCase();
  if (/път|улиц|трот[ао]|магистрал|пътна|шосе|обход|кръст|мост/i.test(n))
    return "roads";
  if (/вик|водоснабд|канализаци|водопровод|пречиств/i.test(n))
    return "water_sewage";
  if (/учил|детска градин|детска ясла|гимназ|университет|академ|учебн/i.test(n))
    return "education";
  if (/болниц|здрав|социал|клиник|медицин|дом за|инвалид/i.test(n))
    return "social";
  if (/спортн|зала|стадион|плувен|футболен|игрищ|комплекс/i.test(n))
    return "sports";
  if (/музей|читалищ|театр|културн|храм|църква|джамия/i.test(n))
    return "culture";
  if (/енергийн|отоплен|фотоволта|вяте?рни|соларн/i.test(n)) return "energy";
  if (/сграда|реконструкц|основен ремонт|саниран|пристрой|надстрой/i.test(n))
    return "buildings";
  return "other";
};

const parseCost = (raw: string): number | null => {
  const cleaned = raw.replace(/\s/g, "").replace(/,/g, ".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
};

// "Община Банско, област Благоевград" → { municipality: "Банско", oblast: "Благоевград" }.
// The law also writes some entries as "Столична община" without an oblast
// suffix; treat those as municipality only.
//
// Whitespace tolerance: the PDF sometimes drops the space between "Община"
// and the name, or before "област", because the source text run was emitted
// without an explicit space item. Allow zero-or-more whitespace at those
// joints. Also allow Latin-letter homoglyphs in the same spirit as the
// municipal-transfers parser (e.g. "област" with a Latin "o").
// Some PDF rows render text justified by emitting each Cyrillic letter as a
// separate text item with explicit space items between them — producing
// "Общ и наС и м и тл и" instead of "Община Симитли". Collapse that pattern
// by repeatedly removing single-character whitespace runs between Cyrillic
// letters until stable.
const collapseLetterSpacing = (s: string): string => {
  let prev = "";
  let curr = s;
  for (let i = 0; i < 10 && prev !== curr; i++) {
    prev = curr;
    // Remove a space when surrounded by single Cyrillic letters on both
    // sides (i.e. justified per-glyph rendering).
    curr = curr.replace(/([А-Яа-я])\s+(?=[А-Яа-я]\s|[А-Яа-я],)/g, "$1");
  }
  return curr;
};

const parseInstitution = (
  raw: string,
): { municipality: string | null; oblast: string | null } => {
  const trimmed = collapseLetterSpacing(raw.replace(/\s+/g, " ").trim());
  // Primary attempt — well-spaced text.
  if (/^Столична\s*община$/i.test(trimmed)) {
    return { municipality: "Столична", oblast: "София-град" };
  }
  const m = trimmed.match(/^Община\s*(.+?),\s*област\s*(.+)$/i);
  if (m) {
    return { municipality: m[1].trim(), oblast: m[2].trim() };
  }
  // Fallback — when justified-text letter-spacing defeats the primary parse,
  // strip ALL whitespace AND in-word hyphens, then retry. The source PDF
  // emits "об-ласт" and similar hyphenated line-break artifacts. Loses any
  // multi-word municipality name detail ("Велико Търново" → "ВеликоТърново")
  // but the EKATTE lookup is tolerant of that via name normalization.
  const collapsed = trimmed.replace(/-(?=[А-Яа-я])/g, "").replace(/\s+/g, "");
  if (
    /^Столичнаобщина$/i.test(collapsed) ||
    /^Столичнаобщина,область?София-?град$/i.test(collapsed)
  ) {
    return { municipality: "Столична", oblast: "София-град" };
  }
  const m2 = collapsed.match(/^Община(.+?),област(.+)$/i);
  if (m2) {
    return { municipality: m2[1].trim(), oblast: m2[2].trim() };
  }
  return { municipality: null, oblast: null };
};

const moneyFromThousandsBgn = (thousands: number): Money => {
  const amount = Math.round(thousands * 1000);
  const eur = toEur(amount, "BGN");
  return {
    amount,
    currency: "BGN",
    amountEur: eur == null ? amount : Math.round(eur),
  };
};

// Collect text items from every page in document order. Y is flipped
// per-page (PDF origin is bottom-left) — we encode an absolute position by
// adding a page-prefix (page * 10000 - y) so projects sort top-to-bottom
// across the whole document.
const collectAllItems = async (doc: PdfDocument): Promise<PositionedItem[]> => {
  const out: PositionedItem[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    for (const it of content.items) {
      if (!("str" in it)) continue;
      if (!it.str.trim()) continue;
      out.push({
        x: it.transform[4],
        // Pack page + y into a single sortable scalar — larger first.
        y: p * 10000 - it.transform[5],
        str: it.str,
      });
    }
  }
  return out;
};

// Find each project's anchor: an item whose text matches the OP- ID pattern
// and whose x is in the project-ID column.
const findAnchors = (items: PositionedItem[]): number[] => {
  const anchors: number[] = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.x > COL_PROJECT_ID_MAX_X) continue;
    if (!OP_ID_RE.test(it.str.trim())) continue;
    anchors.push(i);
  }
  return anchors;
};

// Concatenate items whose x is within the given column band and y is within
// [yMin, yMax], sorted by y then x. Returns the assembled string.
const collectColumn = (
  items: PositionedItem[],
  startIdx: number,
  endIdx: number,
  xMin: number,
  xMax: number,
  yMin: number = Number.NEGATIVE_INFINITY,
  yMax: number = Number.POSITIVE_INFINITY,
): string => {
  const bucket: PositionedItem[] = [];
  for (let i = startIdx; i < endIdx; i++) {
    const it = items[i];
    if (it.x < xMin || it.x >= xMax) continue;
    if (it.y < yMin || it.y > yMax) continue;
    bucket.push(it);
  }
  bucket.sort((a, b) => a.y - b.y || a.x - b.x);
  // Join with no separator — the PDF text items already contain explicit
  // whitespace items where needed. Adding " " between every item produces
  // letter-spaced rendering ("С и м и тл и" instead of "Симитли") on rows
  // where the source draws each glyph as its own item for justification.
  return bucket
    .map((b) => b.str)
    .join("")
    .replace(/\s+/g, " ")
    .trim();
};

export const parseInvestmentAnnex = async (
  pdfBytes: Uint8Array,
  fiscalYear: number,
): Promise<ParsedInvestmentAnnex> => {
  const doc = await pdfjs.getDocument({
    data: pdfBytes,
    isEvalSupported: false,
  }).promise;
  const items = await collectAllItems(doc);
  // Sort once by document position (page-encoded y, then x).
  items.sort((a, b) => a.y - b.y || a.x - b.x);

  const anchors = findAnchors(items);
  if (anchors.length === 0) {
    throw new Error(
      `Investment annex (${fiscalYear}): found 0 OP- project IDs — the PDF layout likely changed.`,
    );
  }

  const projects: ParsedInvestmentProject[] = [];
  const unparsedInstitutions: string[] = [];

  for (let i = 0; i < anchors.length; i++) {
    const anchorIdx = anchors[i];
    const nextAnchorIdx = anchors[i + 1] ?? items.length;
    const anchorItem = items[anchorIdx];
    const projectId = anchorItem.str.trim();

    // Cost is on the SAME PDF row as the OP id (col 3). Scan a wider window
    // forward — wrapped-text projects can put many name items between the
    // anchor and the cost cell. Keep the y-band tight to avoid catching the
    // next project's cost.
    let costStr = "";
    const costYMin = anchorItem.y - 2;
    const costYMax = anchorItem.y + 2;
    for (let j = anchorIdx + 1; j < nextAnchorIdx; j++) {
      const it = items[j];
      if (it.y < costYMin || it.y > costYMax) continue;
      if (it.x >= COL_NAME_MAX_X && it.x < COL_COST_MAX_X) {
        const candidate = it.str.replace(/\s/g, "");
        if (COST_RE.test(candidate) && candidate.length > 0) {
          costStr = candidate;
          break;
        }
      }
    }

    // Bound the project's text band by both array position AND y proximity
    // to the anchor — y proximity filters out page-header text that would
    // otherwise leak into the first project on each page.
    const prevAnchorIdx = i > 0 ? anchors[i - 1] : -1;
    const bandStart = prevAnchorIdx + 1;
    const bandEnd = nextAnchorIdx;
    const yMin = anchorItem.y - PROJECT_BAND_RADIUS;
    const yMax = anchorItem.y + PROJECT_BAND_RADIUS;

    const name = collectColumn(
      items,
      bandStart,
      bandEnd,
      COL_PROJECT_ID_MAX_X,
      COL_NAME_MAX_X,
      yMin,
      yMax,
    );
    const institution = collectColumn(
      items,
      bandStart,
      bandEnd,
      COL_COST_MAX_X,
      Number.POSITIVE_INFINITY,
      yMin,
      yMax,
    );

    const cost = parseCost(costStr);
    if (cost === null || cost === 0) continue; // skip rows without a parseable cost

    const inst = parseInstitution(institution);
    if (!inst.municipality) unparsedInstitutions.push(institution);

    projects.push({
      projectId,
      name,
      responsibleInstitution: institution,
      municipalityName: inst.municipality,
      oblastName: inst.oblast,
      costThousandsBgn: cost,
      cost: moneyFromThousandsBgn(cost),
    });
  }

  return { fiscalYear, projects, unparsedInstitutions };
};
