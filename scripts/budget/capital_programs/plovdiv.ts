// Parser for Община Пловдив's annual Капиталова програма — published as a
// borderless PDF on plovdiv.bg.
//
// 2025 source:
//   https://www.plovdiv.bg/wp-content/uploads/2025/04/RazchetZaFinansiraneNaKapitaloviteRazhodiPrez2025g..pdf
//   22 pages, ~600-700 line items, total 139,597,929 BGN.
//
// Layout (5 columns, no rules):
//   col A  (x ~22-80)   "Разпоредител с бюджет" — район tag or institution
//                       name. May be on the same y as the amount, or 2-3
//                       lines tall when vertical-text-set.
//   col B  (x ~104-140) § paragraph / Функция / Дейност codes (numeric)
//   col C  (x ~150-410) Free-text project description, may wrap 2-4 lines
//   col D  (x ~420-470) "Всичко" — total (BGN)
//   col E  (x ~480-510) "Бюджет" subcolumn
//   col F  (x ~540-580) "Оперативни програми" subcolumn
//
// Anchor strategy: a "project row" is any y-bin where col D contains a
// thousand-separated number. For each anchor, we look at the SAME y to
// grab the район marker (col A) and the description (col C). Wrapped
// description lines sit in the y-band above the anchor down to the
// previous anchor — concatenated in y-descending order.
//
// Project rows where col A is "Първостепенен разпоредител", "ОП X" or an
// institution name (Градска художествена галерия etc.) have no район tag
// and are bucketed as "city-wide". Subtotal rows (Функция X, Дейност X,
// §51-§55) are skipped — they're recapitulation lines.
//
// Run: tsx scripts/budget/capital_programs/plovdiv.ts [--year 2025]

import { createRequire } from "module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BGN_PER_EUR } from "../../../src/lib/currency";
import { PLOVDIV_RAYONS, lookupRayonCode } from "./plovdiv_rayons";

const require = createRequire(import.meta.url);
const pdfjs = require("pdfjs-dist");

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SOURCE_URLS: Record<number, string> = {
  2025: "https://www.plovdiv.bg/wp-content/uploads/2025/04/RazchetZaFinansiraneNaKapitaloviteRazhodiPrez2025g..pdf",
};

interface Money {
  amount: number;
  currency: "BGN" | "EUR";
  amountEur: number;
}

// 2026+ Plovdiv programmes will be EUR-denominated; add a parallel
// eurToMoney() when the changeover lands. Until then, BGN-only.
const bgnToMoney = (amount: number): Money => ({
  amount,
  currency: "BGN",
  amountEur: Math.round(amount / BGN_PER_EUR),
});

interface CapitalProject {
  id: number;
  name: string;
  rayons: string[];
  total: Money;
}

interface CapitalRayonRollup {
  code: string;
  labelBg: string;
  labelEn: string;
  projectCount: number;
  total: Money;
  topProjects: Array<{ id: number; name: string; total: Money }>;
}

interface CapitalProgramFile {
  fiscalYear: number;
  generatedAt: string;
  source: {
    publisher: string;
    documentTitle: string;
    url: string;
    fetchedAt: string;
  };
  municipalityCode: string;
  municipalityNameBg: string;
  municipalityNameEn: string;
  currency: "BGN" | "EUR";
  recapitulation: { total: Money };
  projects: CapitalProject[];
  byRayon: CapitalRayonRollup[];
}

interface RawItem {
  x: number;
  y: number;
  str: string;
}

// Parse "139 597 929" / "1 234,56" / "-" → number. Empty / dash → 0.
const parseAmount = (raw: string): number | null => {
  const t = raw
    .replace(new RegExp("[\\s\u00A0\u2007\u202F]", "g"), "")
    .replace(/,/g, ".");
  if (!t || t === "-" || t === "0") return t === "0" ? 0 : null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

// Column-D x-band — calibrated from the 2025 PDF.
const TOTAL_COL_MIN_X = 420;
const TOTAL_COL_MAX_X = 478;
// Column-C x-band (description).
const DESC_COL_MIN_X = 145;
const DESC_COL_MAX_X = 415;
// Column-A x-band (район / разпоредител / institution).
const COL_A_MAX_X = 95;
// y-tolerance for "same row".
const ROW_Y_TOL = 4;

const parsePage = async (page: {
  getTextContent: () => Promise<{ items: unknown[] }>;
}): Promise<RawItem[]> => {
  const tc = await page.getTextContent();
  const items: RawItem[] = [];
  for (const it of tc.items as Array<{ str?: string; transform?: number[] }>) {
    if (!it.transform || !it.str) continue;
    if (!it.str.trim()) continue;
    items.push({
      x: it.transform[4],
      y: it.transform[5],
      str: it.str,
    });
  }
  return items;
};

// Subtotal/heading row signatures: skip them when assembling projects.
const SKIP_PREFIXES = [
  "Функция",
  "Дейност",
  "Обект",
  "в това число",
  "наименование",
  "Информация за",
  "Раздел",
  "ОБЩО",
];
const SKIP_RE = new RegExp("^(" + SKIP_PREFIXES.join("|") + ")", "i");
// Paragraph subtotals — §5100 etc. The leading § sign is often dropped
// from text extraction; instead we recognise the canonical title prefix.
const PARAGRAPH_TITLES = [
  "Основен ремонт на дълготрайни",
  "Придобиване на дълготрайни",
  "Придобиване на нематериални",
  "Придобиване на земя",
  "Капиталови трансфери",
];

const collectColA = (items: RawItem[], y: number): string => {
  // Some district tags ("Район Централен") sit at the same y; others may
  // be vertically split (each Cyrillic letter is its own text item at
  // x=55 over a 30pt y-range). We gather any items with x<COL_A_MAX_X
  // whose y is within 3pt of the anchor — that covers both cases.
  const parts: Array<{ y: number; str: string }> = [];
  for (const it of items) {
    if (it.x > COL_A_MAX_X) continue;
    if (Math.abs(it.y - y) > 3 && Math.abs(it.y - (y + 9)) > 3) continue;
    parts.push({ y: it.y, str: it.str });
  }
  // Sort top-to-bottom (descending y) and concatenate without spaces —
  // the vertical-text case is per-letter and needs to glue back together.
  parts.sort((a, b) => b.y - a.y);
  return parts
    .map((p) => p.str)
    .join("")
    .trim();
};

const collectDescription = (
  items: RawItem[],
  yAnchor: number,
  yPrevAnchor: number,
): string => {
  // Description text in col C between yAnchor (inclusive, with a 1pt slop
  // for items rendered slightly below the anchor baseline) and yPrevAnchor
  // (exclusive). Anchors iterate top-down (descending y), so yPrevAnchor
  // is HIGHER than yAnchor; "above the anchor" means y > yAnchor.
  const linesByY = new Map<number, RawItem[]>();
  for (const it of items) {
    if (it.x < DESC_COL_MIN_X || it.x > DESC_COL_MAX_X) continue;
    if (it.y < yAnchor - 1 || it.y >= yPrevAnchor) continue;
    const yKey = Math.round(it.y);
    if (!linesByY.has(yKey)) linesByY.set(yKey, []);
    linesByY.get(yKey)!.push(it);
  }
  const ys = [...linesByY.keys()].sort((a, b) => b - a);
  return ys
    .map((y) =>
      linesByY
        .get(y)!
        .sort((a, b) => a.x - b.x)
        .map((it) => it.str)
        .join("")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter((s) => s)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
};

const parseProgram = async (
  pdfPath: string,
  fiscalYear: number,
): Promise<CapitalProgramFile> => {
  const data = readFileSync(pdfPath);
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(data),
    isEvalSupported: false,
  }).promise;

  const projects: CapitalProject[] = [];
  let projectId = 0;

  // Skip page 1 — it's the recapitulation. Iterate pages 2..N.
  let recapTotal: Money | null = null;
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const items = await parsePage(page);

    // Page 1: read the "ОБЩО:" recap total from the very first lines.
    if (p === 1) {
      for (const it of items) {
        if (it.str.trim() === "ОБЩО:") {
          // Find the rightmost amount on the same y-line.
          const sameY = items.filter(
            (q) =>
              Math.abs(q.y - it.y) < ROW_Y_TOL &&
              q.x >= TOTAL_COL_MIN_X &&
              q.x <= TOTAL_COL_MAX_X + 10,
          );
          for (const q of sameY) {
            const n = parseAmount(q.str);
            if (n != null && n > 1_000_000) {
              recapTotal = bgnToMoney(n);
              break;
            }
          }
          if (recapTotal) break;
        }
      }
      continue;
    }

    // Find anchor rows on this page: any item in col D that parses as a
    // number > 0 with thousands separators (≥ 1000) — small numbers are
    // likely subtotal artefacts (5100 §codes etc.).
    const anchors = items
      .filter(
        (it) =>
          it.x >= TOTAL_COL_MIN_X &&
          it.x <= TOTAL_COL_MAX_X &&
          new RegExp("^[\\d\\s\u00A0]+$").test(it.str.trim()) &&
          (parseAmount(it.str) ?? 0) >= 1000,
      )
      .sort((a, b) => b.y - a.y);

    // Skip the FIRST anchor on the page if it's a page-header subtotal
    // (col-C description starts with "Обект" / "Функция" / "§ subtotal").
    // We do this implicitly via SKIP_RE on the assembled description.

    let prevY = 800; // page-top sentinel (PDF coords grow upward)
    for (const a of anchors) {
      const amount = parseAmount(a.str);
      if (amount == null || amount === 0) {
        prevY = a.y;
        continue;
      }
      const colA = collectColA(items, a.y);
      const desc = collectDescription(items, a.y, prevY);
      prevY = a.y;
      if (!desc) continue;
      // Skip recapitulation / subtotal rows.
      if (SKIP_RE.test(desc)) continue;
      if (PARAGRAPH_TITLES.some((t) => desc.startsWith(t))) continue;
      // Discard sub-subcolumns: rows where colA looks like a § number.
      if (/^[\d\s]+$/.test(colA)) continue;
      const rayon = lookupRayonCode(colA) || lookupRayonCode(desc);
      projectId += 1;
      projects.push({
        id: projectId,
        name: desc,
        rayons: rayon ? [rayon] : [],
        total: bgnToMoney(amount),
      });
    }
  }

  // Per-район rollup. When a project has no район, it doesn't show on any
  // per-район tile — it's covered by the município's transfer envelope.
  const rayonAgg = new Map<
    string,
    { total: number; projects: CapitalProject[] }
  >();
  for (const p of projects) {
    for (const r of p.rayons) {
      const cur = rayonAgg.get(r) ?? { total: 0, projects: [] };
      cur.total += p.total.amount;
      cur.projects.push(p);
      rayonAgg.set(r, cur);
    }
  }
  const byRayon: CapitalRayonRollup[] = PLOVDIV_RAYONS.map((r) => {
    const agg = rayonAgg.get(r.code);
    return {
      code: r.code,
      labelBg: r.labelBg,
      labelEn: r.labelEn,
      projectCount: agg?.projects.length ?? 0,
      total: bgnToMoney(agg?.total ?? 0),
      topProjects: (agg?.projects ?? [])
        .sort((a, b) => b.total.amount - a.total.amount)
        .slice(0, 10)
        .map((p) => ({ id: p.id, name: p.name, total: p.total })),
    };
  }).sort((a, b) => b.total.amountEur - a.total.amountEur);

  if (!recapTotal) {
    // Fallback to itemised sum.
    recapTotal = bgnToMoney(projects.reduce((s, p) => s + p.total.amount, 0));
  }

  return {
    fiscalYear,
    generatedAt: new Date().toISOString(),
    source: {
      publisher: "Община Пловдив",
      documentTitle: `Капиталова програма ${fiscalYear} г.`,
      url: SOURCE_URLS[fiscalYear] ?? "",
      fetchedAt: new Date().toISOString(),
    },
    municipalityCode: "PDV05",
    municipalityNameBg: "Пловдив",
    municipalityNameEn: "Plovdiv",
    currency: "BGN",
    recapitulation: { total: recapTotal },
    projects,
    byRayon,
  };
};

const main = async () => {
  const args = process.argv.slice(2);
  const yearIdx = args.indexOf("--year");
  const fiscalYear = yearIdx >= 0 ? Number(args[yearIdx + 1]) : 2025;
  const pdfPath = resolve(
    __dirname,
    "../../../raw_data/budget/capital_programs",
    `plovdiv-${fiscalYear}.pdf`,
  );
  console.log(`[plovdiv-capital] parsing ${pdfPath} (year ${fiscalYear})`);
  const parsed = await parseProgram(pdfPath, fiscalYear);

  const outPath = resolve(
    __dirname,
    "../../../data/budget/capital_programs",
    String(fiscalYear),
    "plovdiv.json",
  );
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(parsed, null, 2) + "\n", "utf8");

  console.log(
    `[plovdiv-capital] wrote ${outPath} — ${parsed.projects.length} projects, recap €${(
      parsed.recapitulation.total.amountEur / 1_000_000
    ).toFixed(1)}M`,
  );
  const tagged = parsed.projects.filter((p) => p.rayons.length > 0).length;
  console.log(
    `[plovdiv-capital] район tagging: ${tagged}/${parsed.projects.length} (${(
      (100 * tagged) /
      Math.max(parsed.projects.length, 1)
    ).toFixed(0)}%)`,
  );
  console.log("[plovdiv-capital] per-район totals:");
  for (const r of parsed.byRayon) {
    console.log(
      `  ${r.labelBg.padEnd(12)} ${r.projectCount.toString().padStart(3)} projects  €${(
        r.total.amountEur / 1_000_000
      ).toFixed(2)}M`,
    );
  }
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
