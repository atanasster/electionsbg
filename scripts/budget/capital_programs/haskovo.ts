// Rollup parser for Хасково's annual капиталова програма. Consumes
// the Gemini Vision OCR JSON (raw_data/.../haskovo-YYYY-ocr.json) and
// emits a tile-ready HaskovoCapitalProgramFile.
//
// Haskovo obshtina = HKV34, EKATTE 77195 (the city). 37 settlements:
// city + 36 villages.
//
// Run: tsx scripts/budget/capital_programs/haskovo.ts [--year 2024]

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BGN_PER_EUR } from "../../../src/lib/currency";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SOURCE_URLS: Record<number, string> = {
  2024: "https://www.haskovo.bg/uploads/posts/2024/e02aef94db43a6123034f1947c9b9479.pdf",
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

interface HaskovoCapitalProject {
  id: number;
  name: string;
  settlement: string | null;
  total: Money;
}

interface HaskovoCapitalSettlementRollup {
  name: string;
  projectCount: number;
  total: Money;
  topProjects: Array<{ id: number; name: string; total: Money }>;
}

interface HaskovoCapitalProgramFile {
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
  projects: HaskovoCapitalProject[];
  bySettlement: HaskovoCapitalSettlementRollup[];
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

// 37 settlements of Община Хасково (HKV34).
const HSK_SETTLEMENTS: Array<{ name: string; prefix: "гр." | "с." }> = [
  { name: "Хасково", prefix: "гр." },
  { name: "Александрово", prefix: "с." },
  { name: "Брягово", prefix: "с." },
  { name: "Войводово", prefix: "с." },
  { name: "Въгларово", prefix: "с." },
  { name: "Гарваново", prefix: "с." },
  { name: "Големанци", prefix: "с." },
  { name: "Горно Войводино", prefix: "с." },
  { name: "Гълъбец", prefix: "с." },
  { name: "Динево", prefix: "с." },
  { name: "Долно Войводино", prefix: "с." },
  { name: "Долно Големанци", prefix: "с." },
  { name: "Елена", prefix: "с." },
  { name: "Зорница", prefix: "с." },
  { name: "Клокотница", prefix: "с." },
  { name: "Книжовник", prefix: "с." },
  { name: "Козлец", prefix: "с." },
  { name: "Конуш", prefix: "с." },
  { name: "Корен", prefix: "с." },
  { name: "Криво поле", prefix: "с." },
  { name: "Любеново", prefix: "с." },
  { name: "Малево", prefix: "с." },
  { name: "Манастир", prefix: "с." },
  { name: "Мандра", prefix: "с." },
  { name: "Маслиново", prefix: "с." },
  { name: "Момино", prefix: "с." },
  { name: "Николово", prefix: "с." },
  { name: "Нова Надежда", prefix: "с." },
  { name: "Орлово", prefix: "с." },
  { name: "Подкрепа", prefix: "с." },
  { name: "Родопи", prefix: "с." },
  { name: "Стамболийски", prefix: "с." },
  { name: "Стойково", prefix: "с." },
  { name: "Текето", prefix: "с." },
  { name: "Тракиец", prefix: "с." },
  { name: "Узунджово", prefix: "с." },
  { name: "Широка поляна", prefix: "с." },
];

const SETTLEMENT_PATTERNS = HSK_SETTLEMENTS.slice()
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
  const fiscalYear = yearIdx >= 0 ? Number(args[yearIdx + 1]) : 2024;

  const ocrPath = resolve(
    __dirname,
    "../../../raw_data/budget/capital_programs",
    `haskovo-${fiscalYear}-ocr.json`,
  );
  if (!existsSync(ocrPath)) {
    throw new Error(
      `Missing OCR JSON at ${ocrPath} — run haskovo_ocr.ts --year ${fiscalYear} first`,
    );
  }
  const ocr: OcrFile = JSON.parse(readFileSync(ocrPath, "utf-8"));
  console.log(
    `[haskovo-capital] reading ${ocrPath} (year ${fiscalYear}, ${ocr.projects.length} OCR rows)`,
  );

  const projects: HaskovoCapitalProject[] = ocr.projects.map((p, i) => ({
    id: i + 1,
    name: p.description.trim(),
    settlement: extractSettlement(p.description),
    total: bgnToMoney(p.amount),
  }));

  const bySettlementAgg = new Map<
    string,
    { total: number; projects: HaskovoCapitalProject[] }
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
  const bySettlement: HaskovoCapitalSettlementRollup[] = [...bySettlementAgg]
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

  const out: HaskovoCapitalProgramFile = {
    fiscalYear,
    generatedAt: new Date().toISOString(),
    source: {
      publisher: "Община Хасково",
      documentTitle: `Приложение №7 — Разчет за финансиране на капиталовите разходи ${fiscalYear} г.`,
      url: SOURCE_URLS[fiscalYear] ?? "",
      fetchedAt: new Date().toISOString(),
      ocrModel: ocr.model,
      ocrGeneratedAt: ocr.generatedAt,
    },
    municipalityCode: "HKV34",
    municipalityNameBg: "Хасково",
    municipalityNameEn: "Haskovo",
    currency: "BGN",
    recapitulation: { total: itemisedTotal },
    publishedRecap: ocr.recapTotal != null ? bgnToMoney(ocr.recapTotal) : null,
    projects,
    bySettlement,
  };

  const outPath = resolve(
    __dirname,
    "../../../data/budget/capital_programs",
    String(fiscalYear),
    "haskovo.json",
  );
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log(
    `[haskovo-capital] wrote ${outPath} — ${projects.length} projects, itemised EUR ${(
      itemisedTotal.amountEur / 1_000_000
    ).toFixed(1)}M${
      out.publishedRecap
        ? ` (published recap EUR ${(out.publishedRecap.amountEur / 1_000_000).toFixed(1)}M)`
        : ""
    }`,
  );
  const tagged = projects.filter((p) => p.settlement !== null).length;
  console.log(
    `[haskovo-capital] settlement tagging: ${tagged}/${projects.length} (${(
      (100 * tagged) /
      Math.max(projects.length, 1)
    ).toFixed(0)}%)`,
  );
  console.log("[haskovo-capital] top settlements:");
  for (const s of bySettlement.slice(0, 10)) {
    console.log(
      `  ${s.name.padEnd(22)} ${s.projectCount.toString().padStart(2)} proj  EUR ${(s.total.amountEur / 1000).toFixed(0)}k`,
    );
  }
};

main();
