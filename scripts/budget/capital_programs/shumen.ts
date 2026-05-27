// Rollup parser for Шумен's annual капиталова програма — consumes the
// Gemini Vision OCR JSON (raw_data/.../shumen-YYYY-ocr.json) and emits
// a ShumenCapitalProgramFile shape (single município, no районi,
// per-village breakdown via "с." / "гр." prefix match).
//
// Shumen obshtina = SHU30, EKATTE 83510. 27 settlements: the city +
// 26 villages.
//
// Run: tsx scripts/budget/capital_programs/shumen.ts [--year 2025]

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BGN_PER_EUR } from "../../../src/lib/currency";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SOURCE_URLS: Record<number, string> = {
  2025: "https://www.shumen.bg/uploads/deinosti/budjet/25051314.pdf",
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

interface ShumenCapitalProject {
  id: number;
  name: string;
  settlement: string | null;
  total: Money;
}

interface ShumenCapitalSettlementRollup {
  name: string;
  projectCount: number;
  total: Money;
  topProjects: Array<{ id: number; name: string; total: Money }>;
}

interface ShumenCapitalProgramFile {
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
  projects: ShumenCapitalProject[];
  bySettlement: ShumenCapitalSettlementRollup[];
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

// 27 settlements of Община Шумен (SHU30) — 1 city + 26 villages.
const SHU_SETTLEMENTS: Array<{ name: string; prefix: string }> = [
  { name: "Шумен", prefix: "гр." },
  { name: "Белокопитово", prefix: "с." },
  { name: "Благово", prefix: "с." },
  { name: "Васил Друмев", prefix: "с." },
  { name: "Велино", prefix: "с." },
  { name: "Ветрище", prefix: "с." },
  { name: "Вехтово", prefix: "с." },
  { name: "Градище", prefix: "с." },
  { name: "Дибич", prefix: "с." },
  { name: "Друмево", prefix: "с." },
  { name: "Ивански", prefix: "с." },
  { name: "Илия Блъсково", prefix: "с." },
  { name: "Кладенец", prefix: "с." },
  { name: "Костена река", prefix: "с." },
  { name: "Коньовец", prefix: "с." },
  { name: "Лозево", prefix: "с." },
  { name: "Мадара", prefix: "с." },
  { name: "Мараш", prefix: "с." },
  { name: "Новосел", prefix: "с." },
  { name: "Овчарово", prefix: "с." },
  { name: "Панайот Волово", prefix: "с." },
  { name: "Радко Димитриево", prefix: "с." },
  { name: "Салманово", prefix: "с." },
  { name: "Средня", prefix: "с." },
  { name: "Струино", prefix: "с." },
  { name: "Царев брод", prefix: "с." },
  { name: "Черенча", prefix: "с." },
];

const SETTLEMENT_PATTERNS = SHU_SETTLEMENTS.slice()
  .sort((a, b) => b.name.length - a.name.length)
  .map(({ name, prefix }) => ({
    display: `${prefix} ${name}`,
    re: new RegExp(
      "(?:^|[\\s,(\\-/])" +
        prefix.replace(/\./g, "\\.") +
        "\\s*" +
        name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
        '(?:[\\s,)\\.\\-/"„“]|$)',
      "u",
    ),
  }));

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
    `shumen-${fiscalYear}-ocr.json`,
  );
  if (!existsSync(ocrPath)) {
    throw new Error(
      `Missing OCR JSON at ${ocrPath} — run shumen_ocr.ts --year ${fiscalYear} first`,
    );
  }
  const ocr: OcrFile = JSON.parse(readFileSync(ocrPath, "utf-8"));
  console.log(
    `[shumen-capital] reading ${ocrPath} (year ${fiscalYear}, ${ocr.projects.length} OCR rows)`,
  );

  const projects: ShumenCapitalProject[] = ocr.projects.map((p, i) => ({
    id: i + 1,
    name: p.description.trim(),
    settlement: extractSettlement(p.description),
    total: bgnToMoney(p.amount),
  }));

  const bySettlementAgg = new Map<
    string,
    { total: number; projects: ShumenCapitalProject[] }
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
  const bySettlement: ShumenCapitalSettlementRollup[] = [...bySettlementAgg]
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

  const out: ShumenCapitalProgramFile = {
    fiscalYear,
    generatedAt: new Date().toISOString(),
    source: {
      publisher: "Община Шумен",
      documentTitle: `Приложение №6 — План за финансиране на капиталовите разходи ${fiscalYear} г.`,
      url: SOURCE_URLS[fiscalYear] ?? "",
      fetchedAt: new Date().toISOString(),
      ocrModel: ocr.model,
      ocrGeneratedAt: ocr.generatedAt,
    },
    municipalityCode: "SHU30",
    municipalityNameBg: "Шумен",
    municipalityNameEn: "Shumen",
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
    "shumen.json",
  );
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log(
    `[shumen-capital] wrote ${outPath} — ${projects.length} projects, itemised EUR ${(
      itemisedTotal.amountEur / 1_000_000
    ).toFixed(1)}M${
      out.publishedRecap
        ? ` (published recap EUR ${(out.publishedRecap.amountEur / 1_000_000).toFixed(1)}M)`
        : ""
    }`,
  );
  const tagged = projects.filter((p) => p.settlement !== null).length;
  console.log(
    `[shumen-capital] settlement tagging: ${tagged}/${projects.length} (${(
      (100 * tagged) /
      Math.max(projects.length, 1)
    ).toFixed(0)}%)`,
  );
  console.log("[shumen-capital] top settlements:");
  for (const s of bySettlement.slice(0, 10)) {
    console.log(
      `  ${s.name.padEnd(22)} ${s.projectCount.toString().padStart(2)} proj  EUR ${(s.total.amountEur / 1000).toFixed(0)}k`,
    );
  }
};

main();
