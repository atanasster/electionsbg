// Rollup parser for Ловеч's annual капиталова програма. Consumes the
// Gemini Vision OCR JSON and emits a tile-ready LovechCapitalProgramFile.
//
// Lovech obshtina = LOV18, EKATTE 43952 (the city). 35 settlements:
// city + 34 villages.
//
// Run: tsx scripts/budget/capital_programs/lovech.ts [--year 2025]

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BGN_PER_EUR } from "../../../src/lib/currency";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SOURCE_URLS: Record<number, string> = {
  2025: "https://www.lovech.bg/uploads/posts/2025/byudzhet-i-kapitalovi-razhodi-na-obshtina-lovech-za-2025-g.pdf",
};

// Authoritative recap totals from the council decision text. Lovech's
// table layout has multiple amount columns and the OCR sometimes picks
// the multi-year project cost rather than the annual planned amount,
// inflating the itemised sum. We override with the published total —
// the per-project rollup is preserved for rankings/breakdown but the
// tile uses publishedRecap as the headline.
const PUBLISHED_RECAPS: Record<number, number> = {
  // From Решение №465/31.07.2025 — "Капиталовата програма за 2025 г.
  // възлиза на 49 781 917 лв." (incl. 2 289 702 целева субсидия,
  // 149 800 собствени средства, etc.).
  2025: 49_781_917,
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

interface LovechCapitalProject {
  id: number;
  name: string;
  settlement: string | null;
  total: Money;
}

interface LovechCapitalSettlementRollup {
  name: string;
  projectCount: number;
  total: Money;
  topProjects: Array<{ id: number; name: string; total: Money }>;
}

interface LovechCapitalProgramFile {
  fiscalYear: number;
  generatedAt: string;
  source: {
    publisher: string;
    documentTitle: string;
    url: string;
    fetchedAt: string;
    ocrModel: string;
    ocrGeneratedAt: string;
  };
  municipalityCode: string;
  municipalityNameBg: string;
  municipalityNameEn: string;
  currency: "BGN" | "EUR";
  recapitulation: { total: Money };
  publishedRecap: Money | null;
  projects: LovechCapitalProject[];
  bySettlement: LovechCapitalSettlementRollup[];
}

interface OcrFile {
  generatedAt: string;
  model: string;
  source: { publisher: string; documentTitle: string; url: string };
  fiscalYear: number;
  pageCount: number;
  projects: Array<{ page: number; description: string; amount: number }>;
  recapTotal: number | null;
  notes: string | null;
}

// 35 settlements of Община Ловеч (LOV18).
const LVH_SETTLEMENTS: Array<{ name: string; prefix: "гр." | "с." }> = [
  { name: "Ловеч", prefix: "гр." },
  { name: "Абланица", prefix: "с." },
  { name: "Александрово", prefix: "с." },
  { name: "Баховица", prefix: "с." },
  { name: "Брестово", prefix: "с." },
  { name: "Българене", prefix: "с." },
  { name: "Владиня", prefix: "с." },
  { name: "Горан", prefix: "с." },
  { name: "Горно Павликене", prefix: "с." },
  { name: "Гостиня", prefix: "с." },
  { name: "Деветаки", prefix: "с." },
  { name: "Дойренци", prefix: "с." },
  { name: "Дренов", prefix: "с." },
  { name: "Дъбрава", prefix: "с." },
  { name: "Изворче", prefix: "с." },
  { name: "Йоглав", prefix: "с." },
  { name: "Казачево", prefix: "с." },
  { name: "Къкрина", prefix: "с." },
  { name: "Лешница", prefix: "с." },
  { name: "Лисец", prefix: "с." },
  { name: "Малиново", prefix: "с." },
  { name: "Прелом", prefix: "с." },
  { name: "Пресяка", prefix: "с." },
  { name: "Скобелево", prefix: "с." },
  { name: "Славяни", prefix: "с." },
  { name: "Слатина", prefix: "с." },
  { name: "Сливек", prefix: "с." },
  { name: "Смочан", prefix: "с." },
  { name: "Соколово", prefix: "с." },
  { name: "Стефаново", prefix: "с." },
  { name: "Радювене", prefix: "с." },
  { name: "Тепава", prefix: "с." },
  { name: "Умаревци", prefix: "с." },
  { name: "Хлевене", prefix: "с." },
  { name: "Чавдарци", prefix: "с." },
];

const SETTLEMENT_PATTERNS = LVH_SETTLEMENTS.slice()
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
  const fiscalYear = yearIdx >= 0 ? Number(args[yearIdx + 1]) : 2025;

  const ocrPath = resolve(
    __dirname,
    "../../../raw_data/budget/capital_programs",
    `lovech-${fiscalYear}-ocr.json`,
  );
  if (!existsSync(ocrPath)) {
    throw new Error(
      `Missing OCR JSON at ${ocrPath} — run lovech_ocr.ts --year ${fiscalYear} first`,
    );
  }
  const ocr: OcrFile = JSON.parse(readFileSync(ocrPath, "utf-8"));
  console.log(
    `[lovech-capital] reading ${ocrPath} (year ${fiscalYear}, ${ocr.projects.length} OCR rows)`,
  );

  const projects: LovechCapitalProject[] = ocr.projects.map((p, i) => ({
    id: i + 1,
    name: p.description.trim(),
    settlement: extractSettlement(p.description),
    total: bgnToMoney(p.amount),
  }));

  const bySettlementAgg = new Map<
    string,
    { total: number; projects: LovechCapitalProject[] }
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
  const bySettlement: LovechCapitalSettlementRollup[] = [...bySettlementAgg]
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

  const out: LovechCapitalProgramFile = {
    fiscalYear,
    generatedAt: new Date().toISOString(),
    source: {
      publisher: "Община Ловеч",
      documentTitle: `Приложение №7 — Капиталови разходи на Община Ловеч за ${fiscalYear} г.`,
      url: SOURCE_URLS[fiscalYear] ?? "",
      fetchedAt: new Date().toISOString(),
      ocrModel: ocr.model,
      ocrGeneratedAt: ocr.generatedAt,
    },
    municipalityCode: "LOV18",
    municipalityNameBg: "Ловеч",
    municipalityNameEn: "Lovech",
    currency: "BGN",
    recapitulation: { total: itemisedTotal },
    publishedRecap:
      PUBLISHED_RECAPS[fiscalYear] != null
        ? bgnToMoney(PUBLISHED_RECAPS[fiscalYear])
        : ocr.recapTotal != null
          ? bgnToMoney(ocr.recapTotal)
          : null,
    projects,
    bySettlement,
  };

  const outPath = resolve(
    __dirname,
    "../../../data/budget/capital_programs",
    String(fiscalYear),
    "lovech.json",
  );
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log(
    `[lovech-capital] wrote ${outPath} — ${projects.length} projects, itemised EUR ${(
      itemisedTotal.amountEur / 1_000_000
    ).toFixed(1)}M${
      out.publishedRecap
        ? ` (published recap EUR ${(out.publishedRecap.amountEur / 1_000_000).toFixed(1)}M)`
        : ""
    }`,
  );
  const tagged = projects.filter((p) => p.settlement !== null).length;
  console.log(
    `[lovech-capital] settlement tagging: ${tagged}/${projects.length} (${(
      (100 * tagged) /
      Math.max(projects.length, 1)
    ).toFixed(0)}%)`,
  );
  console.log("[lovech-capital] top settlements:");
  for (const s of bySettlement.slice(0, 10)) {
    console.log(
      `  ${s.name.padEnd(22)} ${s.projectCount.toString().padStart(2)} proj  EUR ${(s.total.amountEur / 1000).toFixed(0)}k`,
    );
  }
};

main();
