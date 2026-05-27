// Parser for Велико Търново's annual "Инвестиционна програма" (Приложение 15
// to the council's budget package). Source is a clean XLSX — no OCR needed.
//
// 2025 source: https://www.veliko-tarnovo.bg/uploads/posts/2025/
//   2025_05_07_2025_04_30_572-2-prilozheniya1-22.xlsx  (1.75 MB, 28 sheets)
// Capital programme is in sheet "Pril15" — 477 rows × 237 cols. We only
// need the first two columns (name + total).
//
// Sheet structure:
//   row 6:   header   ("НАИМЕНОВАНИЕ НА ОБЕКТИТЕ" | "ВСИЧКО" | …)
//   row 7:   grand total "ВСИЧКО РАЗХОДИ:" = 92,164,560 BGN
//   row 8+:  §-block headers (5100 / 5200 / 5300 with subtotal)
//   each §:  Функция XX subtotal → § sub-codes (5201, 5202, …) → projects
//
// Section/header rows to skip (recognisable by name prefix):
//   "5100…" / "5200…" / "5201…" / "Функция…" / "ОБЕКТИ" / "ВСИЧКО…"
//
// Велико Търново obshtina = VTR04, EKATTE 10447 (the city). 89 settlements:
// city + town Дебелец + town Килифарево + 86 villages.
//
// Run: tsx scripts/budget/capital_programs/veliko_tarnovo.ts [--year 2025]

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";
import { BGN_PER_EUR } from "../../../src/lib/currency";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SOURCE_URLS: Record<number, string> = {
  2025: "https://www.veliko-tarnovo.bg/uploads/posts/2025/2025_05_07_2025_04_30_572-2-prilozheniya1-22.xlsx",
};

// "ВСИЧКО РАЗХОДИ" row (row index 7 in the 2025 file) — published recap.
const PUBLISHED_RECAPS: Record<number, number> = {
  2025: 92_164_560,
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

interface VelikoTarnovoCapitalProject {
  id: number;
  name: string;
  settlement: string | null;
  total: Money;
}

interface VelikoTarnovoCapitalSettlementRollup {
  name: string;
  projectCount: number;
  total: Money;
  topProjects: Array<{ id: number; name: string; total: Money }>;
}

interface VelikoTarnovoCapitalProgramFile {
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
  projects: VelikoTarnovoCapitalProject[];
  bySettlement: VelikoTarnovoCapitalSettlementRollup[];
}

// 89 settlements of Община Велико Търново (VTR04) — city + town Дебелец +
// town Килифарево + 86 villages. List sourced from data/settlements.json.
const VT_SETTLEMENTS: Array<{ name: string; prefix: "гр." | "с." }> = [
  { name: "Велико Търново", prefix: "гр." },
  { name: "Дебелец", prefix: "гр." },
  { name: "Килифарево", prefix: "гр." },
  { name: "Арбанаси", prefix: "с." },
  { name: "Балван", prefix: "с." },
  { name: "Белчевци", prefix: "с." },
  { name: "Беляковец", prefix: "с." },
  { name: "Бижовци", prefix: "с." },
  { name: "Бойчеви колиби", prefix: "с." },
  { name: "Бойчовци", prefix: "с." },
  { name: "Бочковци", prefix: "с." },
  { name: "Бояновци", prefix: "с." },
  { name: "Бранковци", prefix: "с." },
  { name: "Буковец", prefix: "с." },
  { name: "Велчево", prefix: "с." },
  { name: "Ветринци", prefix: "с." },
  { name: "Виларе", prefix: "с." },
  { name: "Водолей", prefix: "с." },
  { name: "Войнежа", prefix: "с." },
  { name: "Вонеща вода", prefix: "с." },
  { name: "Въглевци", prefix: "с." },
  { name: "Върлинка", prefix: "с." },
  { name: "Габровци", prefix: "с." },
  { name: "Гащевци", prefix: "с." },
  { name: "Големаните", prefix: "с." },
  { name: "Горановци", prefix: "с." },
  { name: "Горен Еневец", prefix: "с." },
  { name: "Деветаците", prefix: "с." },
  { name: "Дечковци", prefix: "с." },
  { name: "Димитровци", prefix: "с." },
  { name: "Димовци", prefix: "с." },
  { name: "Дичин", prefix: "с." },
  { name: "Дойновци", prefix: "с." },
  { name: "Долен Еневец", prefix: "с." },
  { name: "Долни Дамяновци", prefix: "с." },
  { name: "Дунавци", prefix: "с." },
  { name: "Емен", prefix: "с." },
  { name: "Ивановци", prefix: "с." },
  { name: "Илевци", prefix: "с." },
  { name: "Йовчевци", prefix: "с." },
  { name: "Къпиново", prefix: "с." },
  { name: "Кисьовци", prefix: "с." },
  { name: "Кладни дял", prefix: "с." },
  { name: "Клъшка река", prefix: "с." },
  { name: "Куцаровци", prefix: "с." },
  { name: "Лагерите", prefix: "с." },
  { name: "Леденик", prefix: "с." },
  { name: "Малки чифлик", prefix: "с." },
  { name: "Малчовци", prefix: "с." },
  { name: "Марговци", prefix: "с." },
  { name: "Миндя", prefix: "с." },
  { name: "Мишеморков хан", prefix: "с." },
  { name: "Момин сбор", prefix: "с." },
  { name: "Нацовци", prefix: "с." },
  { name: "Никюп", prefix: "с." },
  { name: "Ново село", prefix: "с." },
  { name: "Осенарите", prefix: "с." },
  { name: "Пирамидата", prefix: "с." },
  { name: "Плаково", prefix: "с." },
  { name: "Пожерник", prefix: "с." },
  { name: "Поповци", prefix: "с." },
  { name: "Присово", prefix: "с." },
  { name: "Продановци", prefix: "с." },
  { name: "Пушево", prefix: "с." },
  { name: "Пчелище", prefix: "с." },
  { name: "Пъровци", prefix: "с." },
  { name: "Радковци", prefix: "с." },
  { name: "Райковци", prefix: "с." },
  { name: "Рашевци", prefix: "с." },
  { name: "Ресен", prefix: "с." },
  { name: "Русаля", prefix: "с." },
  { name: "Русковци", prefix: "с." },
  { name: "Самоводене", prefix: "с." },
  { name: "Самсиите", prefix: "с." },
  { name: "Сеймените", prefix: "с." },
  { name: "Семковци", prefix: "с." },
  { name: "Суха река", prefix: "с." },
  { name: "Сърненци", prefix: "с." },
  { name: "Терзиите", prefix: "с." },
  { name: "Тодоровци", prefix: "с." },
  { name: "Ушевци", prefix: "с." },
  { name: "Хотница", prefix: "с." },
  { name: "Цепераните", prefix: "с." },
  { name: "Церова кория", prefix: "с." },
  { name: "Цонковци", prefix: "с." },
  { name: "Шереметя", prefix: "с." },
  { name: "Шодековци", prefix: "с." },
  { name: "Шемшево", prefix: "с." },
  { name: "Ялово", prefix: "с." },
];

// Match patterns. For each settlement, try several prefix variants:
//   "гр. Велико Търново"  /  "град Велико Търново"  /  "гр.Велико Търново"
//   plus the abbreviation "В. Търново" / "В.Търново" for Велико Търново.
// For villages: "с. <Name>" / "село <Name>".
// Longest names first so "Велико Търново" wins over "Търново" prefix collisions.
const SETTLEMENT_PATTERNS = VT_SETTLEMENTS.slice()
  .sort((a, b) => b.name.length - a.name.length)
  .map(({ name, prefix }) => {
    const displayPrefix = prefix === "гр." ? "гр." : "с.";
    // Pre-escape the name for regex (settlement names may contain spaces but no special chars in our list)
    const escName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Allow optional whitespace between prefix and name to catch "гр.Велико"
    const longPrefix = prefix === "гр." ? "(?:гр\\.|град)" : "(?:с\\.|село)";
    return {
      display: `${displayPrefix} ${name}`,
      re: new RegExp(
        '(?:^|[\\s,(\\-/"„])' +
          longPrefix +
          "\\s*" +
          escName +
          '(?:[\\s,)\\.\\-/"„“]|$)',
        "u",
      ),
    };
  });

// "В. Търново" / "В.Търново" — abbreviation for Велико Търново only.
const VT_ABBREV_RE =
  /(?:^|[\s,(\-/"„])(?:гр\.|град)\s*В\.\s*Търново(?:[\s,).\-/"„“]|$)/u;

const extractSettlement = (desc: string): string | null => {
  if (VT_ABBREV_RE.test(desc)) return "гр. Велико Търново";
  for (const { display, re } of SETTLEMENT_PATTERNS) {
    if (re.test(desc)) return display;
  }
  return null;
};

const isSectionRow = (name: string): boolean => {
  if (!name) return true;
  if (/^[0-9]{4}/.test(name)) return true; // 5100, 5200, 5201, 5301-...
  if (/^Функция\s/i.test(name)) return true;
  if (/^ОБЕКТИ$/.test(name)) return true;
  if (/^ВСИЧКО/i.test(name)) return true;
  return false;
};

const main = () => {
  const args = process.argv.slice(2);
  const yearIdx = args.indexOf("--year");
  const fiscalYear = yearIdx >= 0 ? Number(args[yearIdx + 1]) : 2025;

  const xlsxPath = resolve(
    __dirname,
    "../../../raw_data/budget/capital_programs",
    `veliko_tarnovo-${fiscalYear}.xlsx`,
  );
  if (!existsSync(xlsxPath)) {
    throw new Error(
      `Missing source XLSX at ${xlsxPath} — download from veliko-tarnovo.bg first`,
    );
  }
  console.log(`[vt-capital] reading ${xlsxPath} (year ${fiscalYear})`);

  const wb = XLSX.read(readFileSync(xlsxPath), { type: "buffer" });
  const sheetName = "Pril15";
  if (!wb.Sheets[sheetName]) {
    throw new Error(
      `Workbook missing sheet "${sheetName}" — sheets present: ${wb.SheetNames.join(", ")}`,
    );
  }
  const aoa = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {
    header: 1,
    defval: "",
  }) as (string | number)[][];

  const projects: VelikoTarnovoCapitalProject[] = [];
  for (let i = 6; i < aoa.length; i++) {
    const name = String(aoa[i][0] || "").trim();
    const totalRaw = Number(aoa[i][1] || 0);
    if (!name) continue;
    if (isSectionRow(name)) continue;
    if (!Number.isFinite(totalRaw) || totalRaw <= 0) continue;
    projects.push({
      id: projects.length + 1,
      name,
      settlement: extractSettlement(name),
      total: bgnToMoney(totalRaw),
    });
  }
  console.log(`[vt-capital] matched ${projects.length} project rows`);

  // Per-settlement rollup.
  const bySettlementAgg = new Map<
    string,
    { total: number; projects: VelikoTarnovoCapitalProject[] }
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
  const bySettlement: VelikoTarnovoCapitalSettlementRollup[] = [
    ...bySettlementAgg,
  ]
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

  const out: VelikoTarnovoCapitalProgramFile = {
    fiscalYear,
    generatedAt: new Date().toISOString(),
    source: {
      publisher: "Община Велико Търново",
      documentTitle: `Приложение 15 — Инвестиционна програма ${fiscalYear} г.`,
      url: SOURCE_URLS[fiscalYear] ?? "",
      fetchedAt: new Date().toISOString(),
    },
    municipalityCode: "VTR04",
    municipalityNameBg: "Велико Търново",
    municipalityNameEn: "Veliko Tarnovo",
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
    "veliko_tarnovo.json",
  );
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log(
    `[vt-capital] wrote ${outPath} — ${projects.length} projects, itemised EUR ${(
      itemisedTotal.amountEur / 1_000_000
    ).toFixed(1)}M${
      out.publishedRecap
        ? ` (published recap EUR ${(out.publishedRecap.amountEur / 1_000_000).toFixed(1)}M)`
        : ""
    }`,
  );
  const tagged = projects.filter((p) => p.settlement !== null).length;
  console.log(
    `[vt-capital] settlement tagging: ${tagged}/${projects.length} (${(
      (100 * tagged) /
      Math.max(projects.length, 1)
    ).toFixed(0)}%)`,
  );
  console.log("[vt-capital] top settlements:");
  for (const s of bySettlement.slice(0, 10)) {
    console.log(
      `  ${s.name.padEnd(24)} ${s.projectCount.toString().padStart(2)} proj  EUR ${(s.total.amountEur / 1000).toFixed(0)}k`,
    );
  }
};

main();
