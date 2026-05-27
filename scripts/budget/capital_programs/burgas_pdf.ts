// Rollup parser for Бургас 2024 + 2023 капиталова програма — consumes
// the Gemini Vision OCR JSON output (raw_data/.../burgas-YYYY-ocr.json)
// and emits the standard BurgasCapitalProgramFile shape that the
// existing useBurgasCapitalProgram hook + tile consume.
//
// Workflow:
//   1. Download Приложения.pdf into raw_data/budget/capital_programs/
//      burgas-YYYY-prilozhenia.pdf (council-decision URL — hand-edited
//      per fiscal year in burgas_ocr.ts).
//   2. Run burgas_ocr.ts --year YYYY (writes burgas-YYYY-ocr.json with
//      function/activity/§/обект codes + 7 funding columns per row).
//   3. Run this script — reads the OCR JSON, applies the same
//      VILLAGE_NAMES + MULTI_WORD_QUARTERS settlement extraction
//      from burgas.ts, materialises the BurgasCapitalProgramFile.
//
// Output shape is identical to burgas.ts (the 2025 XLSX parser) so
// the tile + hook stay year-agnostic — only the SOURCE differs.
//
// Run: tsx scripts/budget/capital_programs/burgas_pdf.ts --year 2024

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BGN_PER_EUR } from "../../../src/lib/currency";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SOURCE_URLS: Record<number, string> = {
  2024: "https://www.burgas.bg/uploads/posts/2024/3886aef5966458387457a988d50be8ea.pdf",
  2023: "https://www.burgas.bg/uploads/posts/2023/6fb48388025aacb5ea37b9ee33a36030.pdf",
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

interface OcrProject {
  page: number;
  description: string;
  functionCode: string;
  activityCode: string;
  paragraphCode: string;
  objectCode: string;
  yearRange: string;
  stateSubsidy: number;
  ownFunds: number;
  externalFunding: number;
  debtFinancing: number;
  euFunds: number;
  carryOverCommunity: number;
  carryOverDelegated: number;
  total: number;
}

interface OcrFile {
  generatedAt: string;
  model: string;
  source: { publisher: string; documentTitle: string; url: string };
  fiscalYear: number;
  projects: OcrProject[];
  recapTotal: number | null;
  notes: string | null;
}

// Mirrors VILLAGE_NAMES + MULTI_WORD_QUARTERS in burgas.ts (the 2025 path).
const VILLAGE_NAMES = [
  "Банево",
  "Брястовец",
  "Димчево",
  "Драганово",
  "Извор",
  "Изворище",
  "Маринка",
  "Миролюбово",
  "Равнец",
  "Рудник",
  "Твърдица",
];
const QUARTER_PREFIXES = ["ж.к.", "ж.к", "к/с", "кв.", "кв "];
const MULTI_WORD_QUARTERS = [
  "Черно Море",
  "Меден рудник",
  "Долно Езерово",
  "Горно Езерово",
  "Братя Миладинови",
  "Петко Славейков",
];

const extractSettlement = (name: string): string | null => {
  for (const v of VILLAGE_NAMES) {
    const re = new RegExp(
      "(?:^|[\\s,(])с\\.\\s*" + v + "(?:[\\s,)\\.\\-]|$)",
      "u",
    );
    if (re.test(name)) return v;
  }
  for (const v of VILLAGE_NAMES) {
    if (
      new RegExp("(?:^|[\\s,(\\-])" + v + "(?:[\\s,)\\.\\-]|$)", "u").test(name)
    ) {
      return v;
    }
  }
  for (const p of QUARTER_PREFIXES) {
    const idx = name.indexOf(p);
    if (idx < 0) continue;
    const after = name.slice(idx + p.length).trimStart();
    const afterLower = after.toLowerCase();
    for (const known of MULTI_WORD_QUARTERS) {
      if (afterLower.startsWith(known.toLowerCase())) return known;
    }
    const m = after.match(/^[А-ЯЁ][а-яё]+/u);
    if (m) return m[0];
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
    `burgas-${fiscalYear}-ocr.json`,
  );
  if (!existsSync(ocrPath)) {
    throw new Error(
      `Missing OCR JSON at ${ocrPath} — run burgas_ocr.ts --year ${fiscalYear} first`,
    );
  }
  const ocr: OcrFile = JSON.parse(readFileSync(ocrPath, "utf-8"));
  console.log(
    `[burgas-pdf] reading ${ocrPath} (year ${fiscalYear}, ${ocr.projects.length} OCR rows)`,
  );

  type Proj = {
    id: number;
    name: string;
    settlement: string | null;
    stateSubsidy: Money;
    ownFunds: Money;
    debt: Money;
    euFunds: Money;
    other: Money;
    carryOverCommunity: Money;
    carryOverDelegated: Money;
    total: Money;
  };
  const projects: Proj[] = ocr.projects.map((p, i) => ({
    id: i + 1,
    name: p.description.trim(),
    settlement: extractSettlement(p.description),
    // Map the OCR's 7 columns to the BurgasCapitalFunding 7 columns.
    // The OCR's "externalFunding" → tile's "other" (closest analog —
    // burgas's "Външно финансиране" is what the 2025 tile calls "other").
    stateSubsidy: bgnToMoney(p.stateSubsidy),
    ownFunds: bgnToMoney(p.ownFunds),
    debt: bgnToMoney(p.debtFinancing),
    euFunds: bgnToMoney(p.euFunds),
    other: bgnToMoney(p.externalFunding),
    carryOverCommunity: bgnToMoney(p.carryOverCommunity),
    carryOverDelegated: bgnToMoney(p.carryOverDelegated),
    total: bgnToMoney(p.total),
  }));

  // Funding-source rollup.
  const fundingTotals = {
    stateSubsidy: bgnToMoney(
      projects.reduce((s, p) => s + p.stateSubsidy.amount, 0),
    ),
    ownFunds: bgnToMoney(projects.reduce((s, p) => s + p.ownFunds.amount, 0)),
    debt: bgnToMoney(projects.reduce((s, p) => s + p.debt.amount, 0)),
    euFunds: bgnToMoney(projects.reduce((s, p) => s + p.euFunds.amount, 0)),
    other: bgnToMoney(projects.reduce((s, p) => s + p.other.amount, 0)),
    carryOverCommunity: bgnToMoney(
      projects.reduce((s, p) => s + p.carryOverCommunity.amount, 0),
    ),
    carryOverDelegated: bgnToMoney(
      projects.reduce((s, p) => s + p.carryOverDelegated.amount, 0),
    ),
  };

  // Per-settlement rollup.
  const bySettlementAgg = new Map<
    string,
    { total: number; projects: Proj[] }
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
  const bySettlement = [...bySettlementAgg]
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

  const totalSum = projects.reduce((s, p) => s + p.total.amount, 0);

  const out = {
    fiscalYear,
    generatedAt: new Date().toISOString(),
    source: {
      publisher: "Община Бургас",
      documentTitle: `Капиталова програма ${fiscalYear} г. (Приложение №3)`,
      url: SOURCE_URLS[fiscalYear] ?? "",
      fetchedAt: new Date().toISOString(),
    },
    municipalityCode: "BGS04",
    municipalityNameBg: "Бургас",
    municipalityNameEn: "Burgas",
    currency: "BGN" as const,
    recapitulation: {
      total: bgnToMoney(totalSum),
      funding: fundingTotals,
    },
    projects,
    bySettlement,
  };

  const outPath = resolve(
    __dirname,
    "../../../data/budget/capital_programs",
    String(fiscalYear),
    "burgas.json",
  );
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log(
    `[burgas-pdf] wrote ${outPath} — ${projects.length} projects, recap EUR ${(
      out.recapitulation.total.amountEur / 1_000_000
    ).toFixed(1)}M${
      ocr.recapTotal != null
        ? ` (published recap EUR ${(ocr.recapTotal / BGN_PER_EUR / 1_000_000).toFixed(1)}M)`
        : ""
    }`,
  );
  const tagged = projects.filter((p) => p.settlement !== null).length;
  console.log(
    `[burgas-pdf] settlement tagging: ${tagged}/${projects.length} (${(
      (100 * tagged) /
      Math.max(projects.length, 1)
    ).toFixed(0)}%)`,
  );
  console.log("[burgas-pdf] top 6 settlements:");
  for (const s of bySettlement.slice(0, 6)) {
    console.log(
      `  ${s.name.padEnd(20)} ${s.projectCount.toString().padStart(2)} proj  EUR ${(s.total.amountEur / 1000).toFixed(0)}k`,
    );
  }
};

main();
