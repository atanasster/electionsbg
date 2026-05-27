// Parser for Перник's annual капиталова програма ("Поименен списък на
// обектите за капиталови разходи"). Source is a clean XLS — no OCR.
//
// 2026 source: https://pernik.bg/wp-content/uploads/2026/04/
//   Poimenen-spisak-EURO.xls  (135 KB, single sheet "КР-2025")
// The file is post-euro-adoption — figures are already in EUR (with
// fractional cents because they're back-conversions from BGN at the
// 1.95583 peg). We canonicalise to BGN for storage and use the EUR
// value as the headline.
//
// Sheet structure (single "КР-2025" sheet despite the 2026 plan year):
//   row 1:   "ПОИМЕНЕН СПИСЪК 2026" title
//   row 8:   "ОБЩО :" grand total (41.3M EUR)
//   row 10:  §5100 "ОСНОВЕН РЕМОНТ" subtotal
//   row 11+: §5100 projects (61 rows)
//   row 72:  §5200 "ПРИДОБИВАНЕ НА ДМА" subtotal
//   row 73+: §5200 sub-sections (І, ІІ, IІІ, V) each with their own
//            re-starting numbering (1, 2, 3...) so per-row ID isn't
//            sequential — we re-number globally.
//   row 167+: §5300, §5400, §6000 capital transfers
//
// Sub-section headers (Roman numerals "І", "ІІ", "IІ", "IІІ", "V")
// appear in col 0 and are SKIPPED. Project rows must have col 0 as
// a pure decimal integer (so Cyrillic capital "І" doesn't match).
//
// Перник obshtina = PER32, EKATTE 55871 (the city). 24 settlements:
// гр. Перник + гр. Батановци + 22 villages. Project descriptions
// frequently tag villages ("с. Студена", "с. Кладница", …) and
// kvartali within the city ("кв. Изток", "кв. Тева", "кв. Каменина");
// settlement-tagging matches на the village list + a fallback to
// гр. Перник when "гр. Перник" appears in the description.
//
// Run: tsx scripts/budget/capital_programs/pernik.ts [--year 2026]

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";
import { BGN_PER_EUR } from "../../../src/lib/currency";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SOURCE_URLS: Record<number, string> = {
  2026: "https://pernik.bg/wp-content/uploads/2026/04/Poimenen-spisak-EURO.xls",
};

interface Money {
  amount: number;
  currency: "BGN" | "EUR";
  amountEur: number;
}

const eurToMoney = (amountEur: number): Money => ({
  amount: Math.round(amountEur * BGN_PER_EUR),
  currency: "BGN",
  amountEur: Math.round(amountEur),
});

interface PernikCapitalProject {
  id: number;
  name: string;
  settlement: string | null;
  total: Money;
}

interface PernikCapitalSettlementRollup {
  name: string;
  projectCount: number;
  total: Money;
  topProjects: Array<{ id: number; name: string; total: Money }>;
}

interface PernikCapitalProgramFile {
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
  projects: PernikCapitalProject[];
  bySettlement: PernikCapitalSettlementRollup[];
}

// 24 settlements of Община Перник (PER32). The city + town Батановци
// + 22 villages.
const PER_SETTLEMENTS: Array<{ name: string; prefix: "гр." | "с." }> = [
  { name: "Перник", prefix: "гр." },
  { name: "Батановци", prefix: "гр." },
  { name: "Богданов дол", prefix: "с." },
  { name: "Боснек", prefix: "с." },
  { name: "Вискяр", prefix: "с." },
  { name: "Витановци", prefix: "с." },
  { name: "Големо Бучино", prefix: "с." },
  { name: "Дивотино", prefix: "с." },
  { name: "Драгичево", prefix: "с." },
  { name: "Зидарци", prefix: "с." },
  { name: "Кладница", prefix: "с." },
  { name: "Кралев дол", prefix: "с." },
  { name: "Лесковец", prefix: "с." },
  { name: "Люлин", prefix: "с." },
  { name: "Мещица", prefix: "с." },
  { name: "Планиница", prefix: "с." },
  { name: "Радуй", prefix: "с." },
  { name: "Расник", prefix: "с." },
  { name: "Рударци", prefix: "с." },
  { name: "Селищен дол", prefix: "с." },
  { name: "Студена", prefix: "с." },
  { name: "Чуйпетлово", prefix: "с." },
  { name: "Черна гора", prefix: "с." },
  { name: "Ярджиловци", prefix: "с." },
];

const SETTLEMENT_PATTERNS = PER_SETTLEMENTS.slice()
  .sort((a, b) => b.name.length - a.name.length)
  .map(({ name, prefix }) => {
    const escName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const longPrefix = prefix === "гр." ? "(?:гр\\.|град)" : "(?:с\\.|село)";
    return {
      display: `${prefix} ${name}`,
      re: new RegExp(
        '(?:^|[\\s,(\\-/"„])' +
          longPrefix +
          "\\s*" +
          escName +
          '(?:[\\s,).\\-/"„“]|$)',
        "u",
      ),
    };
  });

const extractSettlement = (desc: string): string | null => {
  for (const { display, re } of SETTLEMENT_PATTERNS) {
    if (re.test(desc)) return display;
  }
  return null;
};

const main = () => {
  const args = process.argv.slice(2);
  const yearIdx = args.indexOf("--year");
  const fiscalYear = yearIdx >= 0 ? Number(args[yearIdx + 1]) : 2026;

  const xlsxPath = resolve(
    __dirname,
    "../../../raw_data/budget/capital_programs",
    `pernik-${fiscalYear}.xls`,
  );
  if (!existsSync(xlsxPath)) {
    throw new Error(
      `Missing source XLS at ${xlsxPath} — download from pernik.bg first`,
    );
  }
  console.log(`[pernik-capital] reading ${xlsxPath} (year ${fiscalYear})`);

  const wb = XLSX.read(readFileSync(xlsxPath), { type: "buffer" });
  const sheetName = wb.SheetNames[0];
  const aoa = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {
    header: 1,
    defval: "",
  }) as (string | number)[][];

  // Locate "ОБЩО :" grand-total row (published recap headline).
  // It sits in col 1 (or sometimes col 0) within the first ~15 rows.
  let publishedRecapEur: number | null = null;
  for (let i = 0; i < Math.min(15, aoa.length); i++) {
    const c0 = String(aoa[i][0] || "").trim();
    const c1 = String(aoa[i][1] || "").trim();
    if (/^ОБЩО/.test(c0) || /^ОБЩО/.test(c1)) {
      const total = Number(aoa[i][2] || 0);
      if (total > 0) publishedRecapEur = total;
      break;
    }
  }

  // Project rows: col 0 is a pure decimal integer (Arabic digits),
  // col 1 has the project description, col 2 has the EUR amount.
  const projects: PernikCapitalProject[] = [];
  for (let i = 0; i < aoa.length; i++) {
    const c0 = String(aoa[i][0] || "").trim();
    if (!/^\d+$/.test(c0)) continue; // skip non-numbered rows (headers, romans)
    const name = String(aoa[i][1] || "").trim();
    const totalEur = Number(aoa[i][2] || 0);
    if (!name || !Number.isFinite(totalEur) || totalEur <= 0) continue;
    projects.push({
      id: projects.length + 1,
      name,
      settlement: extractSettlement(name),
      total: eurToMoney(totalEur),
    });
  }
  console.log(`[pernik-capital] matched ${projects.length} project rows`);

  // Per-settlement rollup.
  const bySettlementAgg = new Map<
    string,
    { total: number; projects: PernikCapitalProject[] }
  >();
  for (const pr of projects) {
    if (!pr.settlement) continue;
    const cur = bySettlementAgg.get(pr.settlement) ?? {
      total: 0,
      projects: [],
    };
    cur.total += pr.total.amountEur;
    cur.projects.push(pr);
    bySettlementAgg.set(pr.settlement, cur);
  }
  const bySettlement: PernikCapitalSettlementRollup[] = [...bySettlementAgg]
    .map(([name, agg]) => ({
      name,
      projectCount: agg.projects.length,
      total: eurToMoney(agg.total),
      topProjects: agg.projects
        .sort((a, b) => b.total.amountEur - a.total.amountEur)
        .slice(0, 5)
        .map((pr) => ({ id: pr.id, name: pr.name, total: pr.total })),
    }))
    .sort((a, b) => b.total.amountEur - a.total.amountEur);

  const itemisedTotalEur = projects.reduce((s, p) => s + p.total.amountEur, 0);
  const itemisedTotal = eurToMoney(itemisedTotalEur);

  const out: PernikCapitalProgramFile = {
    fiscalYear,
    generatedAt: new Date().toISOString(),
    source: {
      publisher: "Община Перник",
      documentTitle: `Поименен списък на обектите за капиталови разходи ${fiscalYear} г.`,
      url: SOURCE_URLS[fiscalYear] ?? "",
      fetchedAt: new Date().toISOString(),
    },
    municipalityCode: "PER32",
    municipalityNameBg: "Перник",
    municipalityNameEn: "Pernik",
    currency: "BGN",
    recapitulation: { total: itemisedTotal },
    publishedRecap:
      publishedRecapEur != null ? eurToMoney(publishedRecapEur) : null,
    projects,
    bySettlement,
  };

  const outPath = resolve(
    __dirname,
    "../../../data/budget/capital_programs",
    String(fiscalYear),
    "pernik.json",
  );
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log(
    `[pernik-capital] wrote ${outPath} — ${projects.length} projects, itemised EUR ${(
      itemisedTotal.amountEur / 1_000_000
    ).toFixed(1)}M${
      out.publishedRecap
        ? ` (published recap EUR ${(out.publishedRecap.amountEur / 1_000_000).toFixed(1)}M)`
        : ""
    }`,
  );
  const tagged = projects.filter((p) => p.settlement !== null).length;
  console.log(
    `[pernik-capital] settlement tagging: ${tagged}/${projects.length} (${(
      (100 * tagged) /
      Math.max(projects.length, 1)
    ).toFixed(0)}%)`,
  );
  console.log("[pernik-capital] top settlements:");
  for (const s of bySettlement.slice(0, 10)) {
    console.log(
      `  ${s.name.padEnd(22)} ${s.projectCount.toString().padStart(2)} proj  EUR ${(s.total.amountEur / 1000).toFixed(0)}k`,
    );
  }
};

main();
