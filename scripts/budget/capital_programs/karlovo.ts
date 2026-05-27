// Parser for Карлово's annual capital programme. Source is a clean XLSX
// (Приложение № 7 to the council's budget package) — no OCR required.
//
// 2025 source: karlovo.bg "currentNews" page, file
//   "Капиталови разходи 2025.xlsx" served via service-download-file.php.
//   Workbook has two sheets:
//     "Общо (2)"  — MINFIN B3 multi-year template, year-end отчет (2024).
//     "2025"      — План за финансиране на капиталови разходи за 2025 г.
//   We parse the "2025" sheet: its col 13 ("Обща сума за обекта") is the
//   per-line total summing carryover + all 2025 sources.
//
// Sheet "2025" layout (0-indexed columns):
//   col 0  — § / function / category label
//   col 1  — project description
//   col 2  — year range "YYYY-YYYY"
//   col 3..7  — Преходен остатък (carryover) by source
//   col 8  — Обща сума от преходен остатък (total carryover)
//   col 9  — План 2025 капиталова субсидия
//   col 10 — План 2025 собствени средства
//   col 11 — План 2025 държавни дейности / други
//   col 12 — Обща сума за обекта (TOTAL — headline)
//
//   row 7 ОБЩО:    29 336 236 BGN  (≈ EUR 15.0M)
//
// Карлово obshtina = PDV13 (Plovdiv oblast). 27 settlements:
//   4 towns (Карлово, Калофер, Клисура, Баня) + 23 villages.
//
// Run: tsx scripts/budget/capital_programs/karlovo.ts [--year 2025]

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";
import { BGN_PER_EUR } from "../../../src/lib/currency";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SOURCE_URLS: Record<number, string> = {
  2025: "https://karlovo.bg/inc/service/service-download-file.php?identifier=6d56fbd5-f78b-4a49-a311-a0fff162c643",
};

// Council-published "ОБЩО" total for the 2025 plan (sheet "2025", row 7, col 12).
const PUBLISHED_RECAPS: Record<number, number> = {
  2025: 29_336_236,
};

interface Money {
  amount: number;
  currency: "BGN" | "EUR";
  amountEur: number;
}

const bgnToMoney = (amount: number): Money => ({
  amount: Math.round(amount),
  currency: "BGN",
  amountEur: Math.round(amount / BGN_PER_EUR),
});

interface KarlovoCapitalProject {
  id: number;
  name: string;
  settlement: string | null;
  total: Money;
}

interface KarlovoCapitalSettlementRollup {
  name: string;
  projectCount: number;
  total: Money;
  topProjects: Array<{ id: number; name: string; total: Money }>;
}

interface KarlovoCapitalProgramFile {
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
  publishedRecap: Money | null;
  projects: KarlovoCapitalProject[];
  bySettlement: KarlovoCapitalSettlementRollup[];
}

// 27 settlements of Община Карлово (PDV13) per data/settlements.json.
const KRL_SETTLEMENTS: Array<{ name: string; prefix: "гр." | "с." }> = [
  { name: "Карлово", prefix: "гр." },
  { name: "Калофер", prefix: "гр." },
  { name: "Клисура", prefix: "гр." },
  { name: "Баня", prefix: "гр." },
  { name: "Бегунци", prefix: "с." },
  { name: "Богдан", prefix: "с." },
  { name: "Васил Левски", prefix: "с." },
  { name: "Ведраре", prefix: "с." },
  { name: "Войнягово", prefix: "с." },
  { name: "Горни Домлян", prefix: "с." },
  { name: "Домлян", prefix: "с." },
  { name: "Дъбене", prefix: "с." },
  { name: "Иганово", prefix: "с." },
  { name: "Каравелово", prefix: "с." },
  { name: "Климент", prefix: "с." },
  { name: "Куртово", prefix: "с." },
  { name: "Кърнаре", prefix: "с." },
  { name: "Марино поле", prefix: "с." },
  { name: "Московец", prefix: "с." },
  { name: "Мраченик", prefix: "с." },
  { name: "Певците", prefix: "с." },
  { name: "Пролом", prefix: "с." },
  { name: "Розино", prefix: "с." },
  { name: "Слатина", prefix: "с." },
  { name: "Соколица", prefix: "с." },
  { name: "Столетово", prefix: "с." },
  { name: "Христо Даново", prefix: "с." },
];

// Longest-first so multi-word names match before any single-word prefix collision.
const SORTED = KRL_SETTLEMENTS.slice().sort(
  (a, b) => b.name.length - a.name.length,
);

const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Primary: explicit prefix ("гр. X" / "град X" / "с. X" / "село X").
const PREFIX_PATTERNS = SORTED.map(({ name, prefix }) => {
  const longPrefix = prefix === "гр." ? "(?:гр\\.|град)" : "(?:с\\.|село)";
  return {
    display: `${prefix} ${name}`,
    re: new RegExp(
      '(?:^|[\\s,(\\-/"„])' +
        longPrefix +
        "\\s*" +
        escRe(name) +
        '(?:[\\s,)\\.\\-/"„“]|$)',
      "u",
    ),
  };
});

// Fallback: bare settlement name (Karlovo descriptions often write
// "..., Карлово" without prefix). Negative lookbehind avoids the
// "Община Карлово" suffix.
const BARE_PATTERNS = SORTED.map(({ name, prefix }) => ({
  display: `${prefix} ${name}`,
  re: new RegExp(
    '(?<!Община\\s)(?:^|[\\s,(\\-/"„])' +
      escRe(name) +
      '(?:[\\s,)\\.\\-/"„“]|$)',
    "u",
  ),
}));

const extractSettlement = (desc: string): string | null => {
  for (const { display, re } of PREFIX_PATTERNS)
    if (re.test(desc)) return display;
  for (const { display, re } of BARE_PATTERNS)
    if (re.test(desc)) return display;
  return null;
};

const isSectionRow = (c0: unknown, c1: string, c2: string): boolean => {
  if (!c1) return true;
  if (c1 === "ОБЩО") return true;
  if (/^Функция/i.test(c1)) return true;
  if (typeof c0 === "string" && /^[0-9]{4}/.test(c0)) return true;
  if (/^Основен ремонт на дълготрайни/i.test(c1) && !c2) return true;
  if (/^Придобиване/i.test(c1) && !c2) return true;
  return false;
};

const main = () => {
  const args = process.argv.slice(2);
  const yearIdx = args.indexOf("--year");
  const fiscalYear = yearIdx >= 0 ? Number(args[yearIdx + 1]) : 2025;

  const xlsxPath = resolve(
    __dirname,
    "../../../raw_data/budget/capital_programs",
    `karlovo-${fiscalYear}.xlsx`,
  );
  if (!existsSync(xlsxPath)) {
    throw new Error(
      `Missing source XLSX at ${xlsxPath} — download from karlovo.bg first`,
    );
  }
  console.log(`[krl-capital] reading ${xlsxPath} (year ${fiscalYear})`);

  const wb = XLSX.read(readFileSync(xlsxPath), { type: "buffer" });
  const sheetName = String(fiscalYear);
  if (!wb.Sheets[sheetName]) {
    throw new Error(
      `Workbook missing sheet "${sheetName}" — sheets present: ${wb.SheetNames.join(", ")}`,
    );
  }
  const aoa = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {
    header: 1,
    defval: "",
  }) as (string | number)[][];

  // Locate the "ОБЩО" recap row; data starts immediately after.
  let dataStart = -1;
  for (let i = 0; i < Math.min(15, aoa.length); i++) {
    if (String(aoa[i][1] || "").trim() === "ОБЩО") {
      dataStart = i + 1;
      break;
    }
  }
  if (dataStart < 0) {
    throw new Error('Could not locate "ОБЩО" anchor row in sheet');
  }

  const projects: KarlovoCapitalProject[] = [];
  for (let i = dataStart; i < aoa.length; i++) {
    const r = aoa[i];
    const c0 = r[0];
    const c1 = String(r[1] || "").trim();
    const c2 = String(r[2] || "").trim();
    const totalRaw = Number(r[12] || 0);
    if (isSectionRow(c0, c1, c2)) continue;
    if (!Number.isFinite(totalRaw) || totalRaw <= 0) continue;
    if (!c2) continue;
    projects.push({
      id: projects.length + 1,
      name: c1.replace(/\s+/g, " "),
      settlement: extractSettlement(c1),
      total: bgnToMoney(totalRaw),
    });
  }
  console.log(`[krl-capital] matched ${projects.length} project rows`);

  const bySettlementAgg = new Map<
    string,
    { total: number; projects: KarlovoCapitalProject[] }
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
  const bySettlement: KarlovoCapitalSettlementRollup[] = [...bySettlementAgg]
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

  const itemisedTotal = bgnToMoney(
    projects.reduce((s, p) => s + p.total.amount, 0),
  );

  const out: KarlovoCapitalProgramFile = {
    fiscalYear,
    generatedAt: new Date().toISOString(),
    source: {
      publisher: "Община Карлово",
      documentTitle: `Капиталови разходи ${fiscalYear} г. (Приложение № 7)`,
      url: SOURCE_URLS[fiscalYear] ?? "",
      fetchedAt: new Date().toISOString(),
    },
    municipalityCode: "PDV13",
    municipalityNameBg: "Карлово",
    municipalityNameEn: "Karlovo",
    currency: "BGN",
    recapitulation: { total: itemisedTotal },
    publishedRecap:
      PUBLISHED_RECAPS[fiscalYear] != null
        ? bgnToMoney(PUBLISHED_RECAPS[fiscalYear])
        : null,
    projects,
    bySettlement,
  };

  const outPath = resolve(
    __dirname,
    "../../../data/budget/capital_programs",
    String(fiscalYear),
    "karlovo.json",
  );
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log(
    `[krl-capital] wrote ${outPath} — ${projects.length} projects, itemised EUR ${(
      itemisedTotal.amountEur / 1_000_000
    ).toFixed(1)}M${
      out.publishedRecap
        ? ` (published recap EUR ${(out.publishedRecap.amountEur / 1_000_000).toFixed(1)}M)`
        : ""
    }`,
  );
  const tagged = projects.filter((p) => p.settlement !== null).length;
  console.log(
    `[krl-capital] settlement tagging: ${tagged}/${projects.length} (${(
      (100 * tagged) /
      Math.max(projects.length, 1)
    ).toFixed(0)}%)`,
  );
  console.log("[krl-capital] top settlements:");
  for (const s of bySettlement.slice(0, 10)) {
    console.log(
      `  ${s.name.padEnd(22)} ${s.projectCount.toString().padStart(2)} proj  EUR ${(s.total.amountEur / 1000).toFixed(0)}k`,
    );
  }
};

main();
