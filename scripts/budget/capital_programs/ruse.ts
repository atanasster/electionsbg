// Parser for Община Русе's annual капиталова програма.
//
// 2025 source (final 31.12 revised plan + execution, published Feb 2026):
//   https://obshtinaruse.bg/editor/files/Бюджет/Разчет за пап. разходи/
//     2025/Kapitalov_razchet_31.12.2025_publ._27.02.2026.xlsx
//   (561 KB; 71 sheets; the standard ЕБК workbook layout — one sheet per
//   second-level spending unit + an "Общо" recap sheet + a per-kmetstvo
//   sheet for each of the 12 villages with their own administration.)
//
// Structural advantage over Burgas/Stara Zagora: sub-settlement
// localisation is via SHEET STRUCTURE, not free-text regex. Each of the
// 12 villages has its own sheet ("33.Кметство Басарбово", "34.Кметство
// Николово", …); we attribute every row in that sheet to the named
// village. Schools and kindergartens in villages also embed the village
// name in their sheet title ("13.ОУ Отец Паисий гр. Мартен", "62.ДГ Роза
// с. Ново село", …), so a second pass picks those up too.
//
// Per-sheet layout (same template across all 71 sheets):
//   row 0   ОБЩИНА / "РАЗЧЕТ ЗА ФИНАНСИРАНЕ НА КАПИТАЛОВИТЕ РАЗХОДИ"
//   row 1   КОД ПО ЕБК + period label
//   row 7   column-number header (1..21)
//   row 8   ОБЩО sheet total
//   row 9+  project rows: col A = § code, col B = description+address,
//           col C = year range ("2025-2025"), col F = Уточнен план
//           (the 2025 plan figure we use as the project total).
//   Subtotal rows (Функция XX, Обект, §51xx group codes without period)
//   are filtered by checking the absence of a period in col C.
//
// Not районирана — single município (RSE27, EKATTE 63427). Tile UX
// matches the Burgas/Stara Zagora pattern: recap headline + per-village
// strip + top projects city-wide.
//
// Run: tsx scripts/budget/capital_programs/ruse.ts [--year 2025]

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";
import { BGN_PER_EUR } from "../../../src/lib/currency";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SOURCE_URLS: Record<number, string> = {
  2025: "https://obshtinaruse.bg/editor/files/Бюджет/Разчет за пап. разходи/2025/Kapitalov_razchet_31.12.2025_publ._27.02.2026.xlsx",
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

interface CapitalProject {
  id: number;
  name: string;
  settlement: string | null;
  spendingUnit: string; // sheet title
  paragraph: string; // § code from col A
  years: string; // col C "2025-2025"
  total: Money; // Уточнен план (col F)
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

// 12 villages + 1 town (Мартен — гр.) of obshtina Русе RSE27.
const RUSE_SUBSETTLEMENTS = [
  "Басарбово",
  "Бъзън",
  "Долно Абланово",
  "Николово",
  "Ново село",
  "Просена",
  "Сандрово",
  "Семерджиево",
  "Тетово",
  "Хотанца",
  "Червена вода",
  "Ястребово",
  "Мартен",
];

// Normalise diacritics/whitespace and lowercase for case-insensitive
// substring search.
const norm = (s: string): string =>
  s.toLowerCase().normalize("NFKC").replace(/\s+/g, " ").trim();

// Detect the sub-settlement a sheet belongs to. Try LONGEST first so
// "Долно Абланово" wins over "Долно".
const SUBSETTLEMENTS_BY_LENGTH = [...RUSE_SUBSETTLEMENTS].sort(
  (a, b) => b.length - a.length,
);

const detectSettlement = (sheetName: string): string | null => {
  const haystack = norm(sheetName);
  for (const v of SUBSETTLEMENTS_BY_LENGTH) {
    if (haystack.includes(norm(v))) return v;
  }
  return null;
};

const parseAmount = (v: unknown): number => {
  if (v == null || v === "") return 0;
  if (typeof v === "number") return v;
  const s = String(v)
    .replace(new RegExp("[\\s\\u00A0\\u2007\\u202F]", "g"), "")
    .replace(/,/g, ".");
  if (!s || s === "-") return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
};

// Period detection — every real project row has a year range like
// "2025-2025" / "2021-2025" / "2024-2025" in col C. Subtotal /
// function / object rows have null or empty col C.
const isProjectPeriod = (v: unknown): boolean => {
  if (v == null || v === "") return false;
  return /^\d{4}\s*-\s*\d{4}$/.test(String(v).trim());
};

const parseProgram = (
  xlsxPath: string,
  fiscalYear: number,
): CapitalProgramFile => {
  const buf = readFileSync(xlsxPath);
  const wb = XLSX.read(buf, { cellNF: false, cellText: false });

  const projects: CapitalProject[] = [];
  let projectId = 0;

  // Pass 1: sum the per-sheet ОБЩО (col F = Уточнен план) across all
  // spending-unit sheets. This matches what's actually itemised at
  // project granularity. The Общо sheet's own R8 col F is HIGHER
  // (~96.8M BGN vs 51.3M BGN per-sheet sum in 2025) because it
  // includes a city-wide "Преходен остатък ДДД" carry-over (idx 21 ≈
  // 49.5M BGN) that doesn't decompose to any individual spending unit
  // — using it as the recap would make the tile show a headline that
  // doesn't match what the per-project list sums to.
  let recapBgn = 0;
  for (const sheetName of wb.SheetNames) {
    if (sheetName === "Общо") continue;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheetName], {
      header: 1,
      raw: true,
    });
    const r8 = rows[8];
    if (r8 && r8[1] === "ОБЩО") {
      recapBgn += parseAmount(r8[5]);
    }
  }
  const recapTotal: Money = bgnToMoney(recapBgn);

  // Pass 2: walk every spending-unit sheet and pick up project rows.
  // A row counts as a project when col C (period) matches "YYYY-YYYY"
  // AND col F (Уточнен план — revised plan for the fiscal year) is
  // non-zero. Rows with col F = 0 are projects in the multi-year plan
  // (col D = Сметна стойност > 0) that have no allocation for the
  // current fiscal year — we omit them so the tile only shows what's
  // actually planned for spending this year.
  for (const sheetName of wb.SheetNames) {
    if (sheetName === "Общо") continue;
    const sheet = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      raw: true,
    });
    const settlement = detectSettlement(sheetName);

    for (let i = 9; i < rows.length; i++) {
      const row = rows[i];
      if (!row) continue;
      const para = row[0] != null ? String(row[0]).trim() : "";
      const name = row[1] != null ? String(row[1]).trim() : "";
      const period = row[2];
      if (!name) continue;
      if (!isProjectPeriod(period)) continue;
      const total = parseAmount(row[5]); // col F = Уточнен план
      if (total === 0) continue;

      projectId += 1;
      projects.push({
        id: projectId,
        name,
        settlement,
        spendingUnit: sheetName.replace(/^\d+\.\s*/, ""),
        paragraph: para,
        years: String(period).trim(),
        total: bgnToMoney(total),
      });
    }
  }

  // Per-settlement rollup.
  const bySettlementAgg = new Map<
    string,
    { total: number; projects: CapitalProject[] }
  >();
  for (const p of projects) {
    if (!p.settlement) continue;
    const cur = bySettlementAgg.get(p.settlement) ?? {
      total: 0,
      projects: [],
    };
    cur.total += p.total.amount;
    cur.projects.push(p);
    bySettlementAgg.set(p.settlement, cur);
  }
  const bySettlement: CapitalSettlementRollup[] = [...bySettlementAgg]
    .map(([name, agg]) => ({
      name,
      projectCount: agg.projects.length,
      total: bgnToMoney(agg.total),
      topProjects: agg.projects
        .sort((a, b) => b.total.amount - a.total.amount)
        .slice(0, 5)
        .map((p) => ({ id: p.id, name: p.name, total: p.total })),
    }))
    .sort((a, b) => b.total.amountEur - a.total.amountEur);

  // recapTotal is computed in Pass 1 above as the sum of per-sheet
  // ОБЩО col F values across all spending-unit sheets — it equals the
  // sum of captured projects exactly, so no fallback is needed.

  return {
    fiscalYear,
    generatedAt: new Date().toISOString(),
    source: {
      publisher: "Община Русе",
      documentTitle: `Капиталова програма ${fiscalYear} г. (Разчет към 31.12.${fiscalYear})`,
      url: SOURCE_URLS[fiscalYear] ?? "",
      fetchedAt: new Date().toISOString(),
    },
    municipalityCode: "RSE27",
    municipalityNameBg: "Русе",
    municipalityNameEn: "Ruse",
    currency: "BGN",
    recapitulation: { total: recapTotal },
    projects,
    bySettlement,
  };
};

const main = () => {
  const args = process.argv.slice(2);
  const yearIdx = args.indexOf("--year");
  const fiscalYear = yearIdx >= 0 ? Number(args[yearIdx + 1]) : 2025;
  const xlsxPath = resolve(
    __dirname,
    "../../../raw_data/budget/capital_programs",
    `ruse-${fiscalYear}.xlsx`,
  );
  console.log(`[ruse-capital] parsing ${xlsxPath} (year ${fiscalYear})`);
  const parsed = parseProgram(xlsxPath, fiscalYear);

  const outPath = resolve(
    __dirname,
    "../../../data/budget/capital_programs",
    String(fiscalYear),
    "ruse.json",
  );
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(parsed, null, 2) + "\n", "utf8");

  console.log(
    `[ruse-capital] wrote ${outPath} — ${parsed.projects.length} projects, recap EUR ${(
      parsed.recapitulation.total.amountEur / 1_000_000
    ).toFixed(1)}M`,
  );
  const tagged = parsed.projects.filter((p) => p.settlement !== null).length;
  console.log(
    `[ruse-capital] settlement tagging: ${tagged}/${parsed.projects.length} (${(
      (100 * tagged) /
      Math.max(parsed.projects.length, 1)
    ).toFixed(0)}%)`,
  );
  console.log("\n[ruse-capital] top settlements:");
  for (const s of parsed.bySettlement.slice(0, 10)) {
    console.log(
      `  ${s.name.padEnd(18)} ${s.projectCount.toString().padStart(3)} proj  EUR ${(s.total.amountEur / 1000).toFixed(0)}k`,
    );
  }
};

main();
