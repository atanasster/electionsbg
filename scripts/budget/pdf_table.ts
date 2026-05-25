// Border-aware PDF table extractor, built on pdfjs-dist.
//
// The ministry program-budget execution reports draw their tables as ruled
// grids — thin filled rectangles (and occasionally stroked line segments) for
// the cell borders. We collect those rules from the page's operator list,
// derive the row/column grid from their distinct positions, then assign each
// positioned text item to its grid cell.
//
// Why not pdf2array (the repo's other PDF path): pdf2array clusters text by
// baseline, so a multi-line cell ("Политика в областта на устойчивото\nразвитие
// и конкурентоспособност") splits across rows and detaches the label from its
// figures. Border-based extraction bounds the *logical* row by its rules, so a
// wrapped cell stays one cell. The trade-off is this module — but the grid the
// reports use is regular enough that it is a contained amount of code.

import { createRequire } from "module";

// pdfjs-dist 3.x ships a CommonJS build with no statically-analysable named
// exports; createRequire is the reliable interop path from an ESM .ts file.
const require = createRequire(import.meta.url);

interface PdfjsOps {
  save: number;
  restore: number;
  transform: number;
  constructPath: number;
  rectangle: number;
  moveTo: number;
  lineTo: number;
  fill: number;
  eoFill: number;
  stroke: number;
}
interface PdfjsLib {
  getDocument: (opts: { data: Uint8Array; isEvalSupported?: boolean }) => {
    promise: Promise<PdfDocument>;
  };
  OPS: PdfjsOps & Record<string, number>;
}
interface PdfDocument {
  numPages: number;
  getPage: (n: number) => Promise<PdfPage>;
}
interface PdfTextItem {
  str: string;
  width: number;
  transform: number[]; // [a,b,c,d,e,f] — e,f are the x,y of the text origin
}
interface PdfPage {
  getOperatorList: () => Promise<{ fnArray: number[]; argsArray: unknown[] }>;
  getTextContent: () => Promise<{
    items: Array<PdfTextItem | { type: string }>;
  }>;
}

const pdfjs = require("pdfjs-dist") as PdfjsLib;
const OPS = pdfjs.OPS;

// ---------------------------------------------------------------------------
// Geometry primitives
// ---------------------------------------------------------------------------

// A horizontal or vertical rule, normalised so x0<=x1 and y0<=y1 (PDF space:
// origin bottom-left, y grows upward).
interface Rule {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

// 2x3 affine matrix multiply (pdfjs `transform` op semantics: m applied first,
// then the existing ctm).
const mul = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];
const apply = (m: Matrix, x: number, y: number): [number, number] => [
  m[0] * x + m[2] * y + m[4],
  m[1] * x + m[3] * y + m[5],
];

// A rule is "thin" if one dimension is hairline and the other has real length.
const THIN = 2.5; // pt — max thickness of a rule
const MIN_LEN = 4; // pt — min length for a rule to count

const ruleFromRect = (
  x: number,
  y: number,
  w: number,
  h: number,
): Rule | null => {
  const x0 = Math.min(x, x + w);
  const x1 = Math.max(x, x + w);
  const y0 = Math.min(y, y + h);
  const y1 = Math.max(y, y + h);
  const dw = x1 - x0;
  const dh = y1 - y0;
  if (dh <= THIN && dw >= MIN_LEN) return { x0, x1, y0: y0, y1: y0 }; // horizontal
  if (dw <= THIN && dh >= MIN_LEN) return { x0: x0, x1: x0, y0, y1 }; // vertical
  return null;
};

const ruleFromSegment = (
  ax: number,
  ay: number,
  bx: number,
  by: number,
): Rule | null => {
  if (Math.abs(ay - by) <= THIN && Math.abs(ax - bx) >= MIN_LEN) {
    return { x0: Math.min(ax, bx), x1: Math.max(ax, bx), y0: ay, y1: ay };
  }
  if (Math.abs(ax - bx) <= THIN && Math.abs(ay - by) >= MIN_LEN) {
    return { x0: ax, x1: ax, y0: Math.min(ay, by), y1: Math.max(ay, by) };
  }
  return null;
};

// ---------------------------------------------------------------------------
// Rule collection — walk the operator list, tracking the CTM.
// ---------------------------------------------------------------------------

const collectRules = (
  fnArray: number[],
  argsArray: unknown[],
): { horizontal: Rule[]; vertical: Rule[] } => {
  const horizontal: Rule[] = [];
  const vertical: Rule[] = [];
  let ctm: Matrix = IDENTITY;
  const stack: Matrix[] = [];

  // A path is built by constructPath then painted by the *next* op; only
  // filled/stroked paths are visible rules (eoClip etc. are invisible).
  let pending: Rule[] = [];

  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i];
    if (fn === OPS.save) {
      stack.push(ctm);
    } else if (fn === OPS.restore) {
      ctm = stack.pop() ?? IDENTITY;
    } else if (fn === OPS.transform) {
      const a = argsArray[i] as number[];
      ctm = mul(ctm, [a[0], a[1], a[2], a[3], a[4], a[5]]);
    } else if (fn === OPS.constructPath) {
      const [subOps, coords] = argsArray[i] as [number[], number[]];
      pending = [];
      let ci = 0;
      let cx = 0;
      let cy = 0;
      for (const so of subOps) {
        if (so === OPS.rectangle) {
          const [rx, ry, rw, rh] = coords.slice(ci, ci + 4);
          ci += 4;
          const [px, py] = apply(ctm, rx, ry);
          const [px2, py2] = apply(ctm, rx + rw, ry + rh);
          const r = ruleFromRect(
            Math.min(px, px2),
            Math.min(py, py2),
            Math.abs(px2 - px),
            Math.abs(py2 - py),
          );
          if (r) pending.push(r);
        } else if (so === OPS.moveTo) {
          [cx, cy] = apply(ctm, coords[ci], coords[ci + 1]);
          ci += 2;
        } else if (so === OPS.lineTo) {
          const [nx, ny] = apply(ctm, coords[ci], coords[ci + 1]);
          ci += 2;
          const r = ruleFromSegment(cx, cy, nx, ny);
          if (r) pending.push(r);
          cx = nx;
          cy = ny;
        } else {
          // curveTo (6 coords) / other — skip its coords, ignore for ruling
          ci += so === OPS.moveTo || so === OPS.lineTo ? 2 : 6;
        }
      }
    } else if (fn === OPS.fill || fn === OPS.eoFill || fn === OPS.stroke) {
      for (const r of pending) {
        if (r.y0 === r.y1) horizontal.push(r);
        else vertical.push(r);
      }
      pending = [];
    }
  }
  return { horizontal, vertical };
};

// ---------------------------------------------------------------------------
// Grid construction
// ---------------------------------------------------------------------------

const CLUSTER_TOL = 2.5; // pt — positions within this are the same grid line

// Cluster a list of scalar positions into representative grid lines.
const clusterPositions = (values: number[]): number[] => {
  if (values.length === 0) return [];
  const sorted = [...values].sort((a, b) => a - b);
  const lines: number[] = [];
  let bucket: number[] = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] - bucket[bucket.length - 1] <= CLUSTER_TOL) {
      bucket.push(sorted[i]);
    } else {
      lines.push(bucket.reduce((s, v) => s + v, 0) / bucket.length);
      bucket = [sorted[i]];
    }
  }
  lines.push(bucket.reduce((s, v) => s + v, 0) / bucket.length);
  return lines;
};

const near = (a: number, b: number, tol = CLUSTER_TOL): boolean =>
  Math.abs(a - b) <= tol;

// One detected table: a contiguous run of ruled rows sharing a column grid.
interface GridTable {
  rowLines: number[]; // y of each horizontal separator, top→bottom (desc)
  colLines: number[]; // x of each vertical separator, left→right (asc)
}

// Segment a page's rules into tables. A row band (gap between two adjacent
// horizontal lines) is "real" only when a vertical rule spans it; a maximal run
// of real row bands is one table.
const buildTables = (horizontal: Rule[], vertical: Rule[]): GridTable[] => {
  if (horizontal.length === 0 || vertical.length === 0) return [];
  const hLines = clusterPositions(horizontal.map((r) => r.y0)).sort(
    (a, b) => b - a,
  ); // top→bottom
  const tables: GridTable[] = [];
  let runStart = -1;

  const spanned = (yTop: number, yBot: number): boolean =>
    vertical.some(
      (v) =>
        v.y1 >= yTop - CLUSTER_TOL &&
        v.y0 <= yBot + CLUSTER_TOL &&
        v.y1 - v.y0 >= yTop - yBot - CLUSTER_TOL * 2,
    );

  const flush = (endIdx: number): void => {
    if (runStart < 0 || endIdx - runStart < 1) {
      runStart = -1;
      return;
    }
    const rowLines = hLines.slice(runStart, endIdx + 1);
    const yTop = rowLines[0];
    const yBot = rowLines[rowLines.length - 1];
    const colLines = clusterPositions(
      vertical
        .filter((v) => v.y0 <= yTop + CLUSTER_TOL && v.y1 >= yBot - CLUSTER_TOL)
        .map((v) => v.x0),
    );
    if (colLines.length >= 2) tables.push({ rowLines, colLines });
    runStart = -1;
  };

  for (let i = 0; i < hLines.length - 1; i++) {
    if (spanned(hLines[i], hLines[i + 1])) {
      if (runStart < 0) runStart = i;
    } else {
      flush(i);
    }
  }
  flush(hLines.length - 1);
  return tables;
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ExtractedTable {
  page: number; // 1-based
  rows: string[][]; // top→bottom, left→right; each cell's text joined
  yTop: number;
  yBottom: number;
}

const isTextItem = (it: PdfTextItem | { type: string }): it is PdfTextItem =>
  typeof (it as PdfTextItem).str === "string";

// Extract every ruled table from a PDF, in page then top-to-bottom order.
export const extractTables = async (
  pdfBytes: Uint8Array,
): Promise<ExtractedTable[]> => {
  // pdfjs takes ownership of the buffer and detaches it once getDocument
  // runs, so a second parse pass on the same Uint8Array (e.g. financial →
  // headcount in the budget ingest) blows up with "Cannot transfer object
  // of unsupported type". Clone the bytes so each call owns its own buffer.
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(pdfBytes),
    isEvalSupported: false,
  }).promise;
  const out: ExtractedTable[] = [];

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const opList = await page.getOperatorList();
    const { horizontal, vertical } = collectRules(
      opList.fnArray,
      opList.argsArray,
    );
    const grids = buildTables(horizontal, vertical);
    if (grids.length === 0) continue;

    const textContent = await page.getTextContent();
    const items = textContent.items
      .filter(isTextItem)
      .map((it) => ({
        str: it.str,
        x: it.transform[4],
        y: it.transform[5],
        w: it.width,
      }))
      .filter((it) => it.str.trim() !== "");

    for (const grid of grids) {
      const { rowLines, colLines } = grid;
      const yTop = rowLines[0];
      const yBottom = rowLines[rowLines.length - 1];
      // cell[r][c] accumulates the text items that fall inside it
      const cells: Array<Array<Array<{ str: string; x: number; y: number }>>> =
        rowLines.slice(0, -1).map(() => colLines.slice(0, -1).map(() => []));
      for (const it of items) {
        // row: the band whose [lower, upper] y-range contains the text origin
        let r = -1;
        for (let ri = 0; ri < rowLines.length - 1; ri++) {
          if (
            it.y <= rowLines[ri] + CLUSTER_TOL &&
            it.y >= rowLines[ri + 1] - CLUSTER_TOL
          ) {
            r = ri;
            break;
          }
        }
        if (r < 0) continue;
        // column: the band containing the item's horizontal midpoint
        const mid = it.x + it.w / 2;
        let c = -1;
        for (let ci = 0; ci < colLines.length - 1; ci++) {
          if (
            mid >= colLines[ci] - CLUSTER_TOL &&
            mid <= colLines[ci + 1] + CLUSTER_TOL
          ) {
            c = ci;
            break;
          }
        }
        if (c < 0) continue;
        cells[r][c].push({ str: it.str, x: it.x, y: it.y });
      }
      const rows = cells.map((row) =>
        row.map((cell) => {
          // join in reading order: top line first, left-to-right within a line
          cell.sort((a, b) => (near(a.y, b.y, 3) ? a.x - b.x : b.y - a.y));
          return cell
            .map((t) => t.str)
            .join(" ")
            .replace(/\s+/g, " ")
            .trim();
        }),
      );
      out.push({ page: p, rows, yTop, yBottom });
    }
  }
  return out;
};
