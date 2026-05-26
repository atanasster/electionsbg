// Parser for Община Стара Загора's annual капиталова програма — Приложение
// № 4 to the council's budget decision, published as a born-digital PDF on
// starazagora.bg.
//
// 2025 source:
//   https://www.starazagora.bg/uploads/posts/2025/2025_05_29_prilozhenia_byudzhet_2025.zip
//   (contains "pr 4 KV  2025.pdf" — 12 pages, ~596 line items, total
//   57,275,109 BGN ≈ EUR 29.3M).
//
// Layout (PDF text content):
//   col A  (x ~25-150)  Description / heading. Wraps to 2-3 lines.
//   col B  (x ~415-440) "Годишна задача общо" — the project's total
//   cols C-K (x ~440-800) 9 funding-source sub-columns
//
// Anchor strategy: find numeric items in col B with value >= 1000. Skip
// subtotal rows whose col-A description starts with §, ф-я, Д.NNN, "К",
// "КАПИТАЛОВИ", etc. (function/activity/paragraph rollups). Per-village
// tagging via "с. NAME" / "с.NAME" against the 51 known villages of
// obshtina Стара Загора (hardcoded — keeps the parser self-contained).
//
// Stara Zagora isn't районирана; the tile renders the Burgas pattern
// (no район breakdown — funding sources + per-settlement strip).
//
// Run: tsx scripts/budget/capital_programs/stara_zagora.ts [--year 2025]

import { createRequire } from "module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BGN_PER_EUR } from "../../../src/lib/currency";

const require = createRequire(import.meta.url);
const pdfjs = require("pdfjs-dist");

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SOURCE_URLS: Record<number, string> = {
  2025: "https://www.starazagora.bg/uploads/posts/2025/2025_05_29_prilozhenia_byudzhet_2025.zip",
};

interface Money {
  amount: number;
  currency: "BGN" | "EUR";
  amountEur: number;
}

const bgnToMoney = (amount: number): Money => ({
  amount,
  currency: "BGN",
  amountEur: Math.round(amount / BGN_PER_EUR),
});

interface RawItem {
  x: number;
  y: number;
  str: string;
}

interface CapitalProject {
  id: number;
  name: string;
  settlement: string | null;
  total: Money;
}

interface CapitalSettlementRollup {
  name: string;
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
  bySettlement: CapitalSettlementRollup[];
}

// 51 villages in obshtina Стара Загора (SZR31), from data/settlements.json
// at parse time. Hardcoded to keep this parser self-contained — the list
// changes ~once a decade when a settlement is renamed or merged.
const SZ_VILLAGES = [
  "Арнаутито",
  "Бенковски",
  "Богомилово",
  "Борилово",
  "Борово",
  "Братя Кунчеви",
  "Бъдеще",
  "Воденичарово",
  "Горно Ботево",
  "Дълбоки",
  "Еленино",
  "Елхово",
  "Загоре",
  "Змейово",
  "Казанка",
  "Калитиново",
  "Калояновец",
  "Кирилово",
  "Козаревец",
  "Колена",
  "Ловец",
  "Люляк",
  "Лясково",
  "Маджерито",
  "Малка Верея",
  "Малко Кадиево",
  "Михайлово",
  "Могила",
  "Ново село",
  "Оряховица",
  "Остра могила",
  "Памукчии",
  "Петрово",
  "Плоска могила",
  "Подслон",
  "Преславен",
  "Пряпорец",
  "Пшеничево",
  "Пъстрово",
  "Ракитница",
  "Лозен",
  "Руманя",
  "Самуилово",
  "Сладък кладенец",
  "Хан Аспарухово",
  "Старозагорски бани",
  "Стрелец",
  "Сулица",
  "Християново",
  "Хрищени",
  "Яворово",
];

// Match "с. NAME" / "с.NAME" with NAME a known village. Try LONGEST names
// first so "Сладък кладенец" wins over a bare "Сладък" match.
const SETTLEMENT_PATTERNS: Array<{ village: string; re: RegExp }> =
  SZ_VILLAGES.slice()
    .sort((a, b) => b.length - a.length)
    .map((v) => ({
      village: v,
      // Word-boundary before с.; literal " " or no space after с.; then the
      // village name; word-end after (space, comma, dash, end, quote, slash).
      re: new RegExp(
        "(?:^|[\\s,(\\-/])с\\.\\s*" +
          v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
          '(?:[\\s,)\\.\\-/"„“]|$)',
        "u",
      ),
    }));

const extractSettlement = (desc: string): string | null => {
  for (const { village, re } of SETTLEMENT_PATTERNS) {
    if (re.test(desc)) return village;
  }
  return null;
};

// Subtotal/heading row signatures: skip when assembling projects. Function
// ("ф-я"), activity ("Д.XXX"), paragraph ("§"), and the city-wide
// "КАПИТАЛОВИ РАЗХОДИ - ОБЩО" rollup at the top. These markers can appear
// AT THE START of an anchor's description (typical case) or LEAKED from
// the row above when the anchor's y is within the y-band of the previous
// (subtotal) row. The non-anchored match catches both.
const SKIP_RE = /КАПИТАЛОВИ РАЗХОДИ\s*-\s*ОБЩО|§\s*\d+\s*-|ф-я\s*"|Д\.\s*\d+/u;

const parseAmount = (raw: string): number | null => {
  const t = raw
    .replace(new RegExp("[\\s\\u00A0\\u2007\\u202F]", "g"), "")
    .replace(/,/g, ".");
  if (!t || t === "-") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

const TOTAL_COL_MIN_X = 410;
const TOTAL_COL_MAX_X = 445;
const DESC_COL_MIN_X = 25;
const DESC_COL_MAX_X = 408;

const collectDescription = (
  items: RawItem[],
  yAnchor: number,
  yPrevAnchor: number,
  yNextAnchor: number,
): string => {
  // The SZ PDF mixes three layouts (same-line / desc-above-amount /
  // desc-below-amount). Pick the SINGLE col-A line closest to the
  // anchor's y, then optionally extend with an immediately adjacent line
  // for wrap. Multi-line aggressive band capture leaked text between
  // projects (Project N's desc-above-amount line collides with Project
  // N+1's desc-below-amount line at the same y).
  const linesByY = new Map<number, RawItem[]>();
  for (const it of items) {
    if (it.x < DESC_COL_MIN_X || it.x > DESC_COL_MAX_X) continue;
    if (it.y <= yNextAnchor || it.y >= yPrevAnchor) continue;
    const yKey = Math.round(it.y);
    if (!linesByY.has(yKey)) linesByY.set(yKey, []);
    linesByY.get(yKey)!.push(it);
  }
  if (linesByY.size === 0) return "";

  // Pick the line closest to the anchor.
  const candidateYs = [...linesByY.keys()];
  candidateYs.sort((a, b) => Math.abs(a - yAnchor) - Math.abs(b - yAnchor));
  const primaryY = candidateYs[0];
  const primary = linesByY
    .get(primaryY)!
    .sort((a, b) => a.x - b.x)
    .map((it) => it.str)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  if (!primary) return "";

  // If a line is immediately ABOVE the primary (≤ 10pt above) and no
  // other anchor sits between them, treat it as a wrap continuation.
  const wrapY = candidateYs.find(
    (y) => y > primaryY && y - primaryY <= 10 && y !== primaryY,
  );
  if (wrapY != null) {
    const wrap = linesByY
      .get(wrapY)!
      .sort((a, b) => a.x - b.x)
      .map((it) => it.str)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (wrap) return `${wrap} ${primary}`.replace(/\s+/g, " ").trim();
  }
  return primary;
};

const parsePage = async (page: {
  getTextContent: () => Promise<{ items: unknown[] }>;
}): Promise<RawItem[]> => {
  const tc = await page.getTextContent();
  const items: RawItem[] = [];
  for (const it of tc.items as Array<{ str?: string; transform?: number[] }>) {
    if (!it.transform || !it.str || !it.str.trim()) continue;
    items.push({ x: it.transform[4], y: it.transform[5], str: it.str });
  }
  return items;
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
  let recapTotal: Money | null = null;

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const items = await parsePage(page);

    // Anchor rows on this page.
    const anchors = items
      .filter(
        (it) =>
          it.x >= TOTAL_COL_MIN_X &&
          it.x <= TOTAL_COL_MAX_X &&
          new RegExp("^[\\d\\s ]+$").test(it.str.trim()) &&
          (parseAmount(it.str) ?? 0) >= 1000,
      )
      .sort((a, b) => b.y - a.y);

    let prevY = 1000; // page-top sentinel
    for (let ai = 0; ai < anchors.length; ai++) {
      const a = anchors[ai];
      const amount = parseAmount(a.str);
      if (amount == null || amount === 0) {
        prevY = a.y;
        continue;
      }
      // The NEXT anchor in descending-y order — sets a floor so below-line
      // descriptions don't leak from later projects. Bottom of page = -1
      // (any item passes the floor check).
      const nextY = ai + 1 < anchors.length ? anchors[ai + 1].y : -1;
      const desc = collectDescription(items, a.y, prevY, nextY);
      prevY = a.y;
      if (!desc) continue;

      // Recapitulation row — page 1 only, FIRST match wins. The §51
      // subtotal row immediately below the recap leaks "КАПИТАЛОВИ
      // РАЗХОДИ - ОБЩО" into its own desc via the y-band overlap, so
      // overwriting would clobber the correct figure with §51's smaller
      // amount.
      if (
        p === 1 &&
        !recapTotal &&
        /КАПИТАЛОВИ РАЗХОДИ\s*-\s*ОБЩО/u.test(desc)
      ) {
        recapTotal = bgnToMoney(amount);
        continue;
      }

      // Skip subtotal/heading rows.
      if (SKIP_RE.test(desc)) continue;
      // Skip free-standing settlement names without project descriptions
      // (rare but defensive — a 2-word "с. Калояновец" row shouldn't
      // count as a project).
      if (/^с\.\s*[А-ЯЁа-яё\s]+$/u.test(desc)) continue;

      projectId += 1;
      projects.push({
        id: projectId,
        name: desc,
        settlement: extractSettlement(desc),
        total: bgnToMoney(amount),
      });
    }
  }

  if (!recapTotal) {
    // Fallback to itemised sum (won't double-count subtotals since we
    // filtered them above).
    recapTotal = bgnToMoney(projects.reduce((s, p) => s + p.total.amount, 0));
  }

  // Per-settlement rollup.
  const bySettlementAgg = new Map<
    string,
    { total: number; projects: CapitalProject[] }
  >();
  for (const pr of projects) {
    if (!pr.settlement) continue;
    const cur = bySettlementAgg.get(pr.settlement) ?? {
      total: 0,
      projects: [],
    };
    cur.total += pr.total.amount;
    cur.projects.push(pr);
    bySettlementAgg.set(pr.settlement, cur);
  }
  const bySettlement: CapitalSettlementRollup[] = [...bySettlementAgg]
    .map(([name, agg]) => ({
      name,
      projectCount: agg.projects.length,
      total: bgnToMoney(agg.total),
      topProjects: agg.projects
        .sort((a, b) => b.total.amount - a.total.amount)
        .slice(0, 5)
        .map((pr) => ({ id: pr.id, name: pr.name, total: pr.total })),
    }))
    .sort((a, b) => b.total.amountEur - a.total.amountEur);

  return {
    fiscalYear,
    generatedAt: new Date().toISOString(),
    source: {
      publisher: "Община Стара Загора",
      documentTitle: `Капиталова програма ${fiscalYear} г. (Приложение №4)`,
      url: SOURCE_URLS[fiscalYear] ?? "",
      fetchedAt: new Date().toISOString(),
    },
    municipalityCode: "SZR31",
    municipalityNameBg: "Стара Загора",
    municipalityNameEn: "Stara Zagora",
    currency: "BGN",
    recapitulation: { total: recapTotal },
    projects,
    bySettlement,
  };
};

const main = async () => {
  const args = process.argv.slice(2);
  const yearIdx = args.indexOf("--year");
  const fiscalYear = yearIdx >= 0 ? Number(args[yearIdx + 1]) : 2025;
  const pdfPath = resolve(
    __dirname,
    "../../../raw_data/budget/capital_programs",
    `stara_zagora-${fiscalYear}.pdf`,
  );
  console.log(`[stara-zagora-capital] parsing ${pdfPath} (year ${fiscalYear})`);
  const parsed = await parseProgram(pdfPath, fiscalYear);

  const outPath = resolve(
    __dirname,
    "../../../data/budget/capital_programs",
    String(fiscalYear),
    "stara_zagora.json",
  );
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(parsed, null, 2) + "\n", "utf8");

  console.log(
    `[stara-zagora-capital] wrote ${outPath} — ${parsed.projects.length} projects, recap EUR ${(
      parsed.recapitulation.total.amountEur / 1_000_000
    ).toFixed(1)}M`,
  );
  const tagged = parsed.projects.filter((p) => p.settlement !== null).length;
  console.log(
    `[stara-zagora-capital] village tagging: ${tagged}/${parsed.projects.length} (${(
      (100 * tagged) /
      Math.max(parsed.projects.length, 1)
    ).toFixed(0)}%)`,
  );
  console.log("\n[stara-zagora-capital] top settlements:");
  for (const s of parsed.bySettlement.slice(0, 8)) {
    console.log(
      `  ${s.name.padEnd(22)} ${s.projectCount.toString().padStart(2)} proj  EUR ${(s.total.amountEur / 1000).toFixed(0)}k`,
    );
  }
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
