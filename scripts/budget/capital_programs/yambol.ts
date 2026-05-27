// Rollup parser for Ямбол's annual капиталова програма. Consumes the
// Gemini Vision OCR JSON and emits a tile-ready YambolCapitalProgramFile.
//
// Yambol obshtina = JAM26, single-settlement município — just the city
// of Ямбол, no surrounding villages. So bySettlement is empty and the
// tile leads with recap + top projects (same shape as Dobrich).
//
// Run: tsx scripts/budget/capital_programs/yambol.ts [--year 2025]

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BGN_PER_EUR } from "../../../src/lib/currency";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SOURCE_URLS: Record<number, string> = {
  2022: "https://yambol.bg/uploads/3E82C93B98F495133D0C965CBAAF957C",
  2023: "https://yambol.bg/uploads/A70C407EA08879FEF3B5CCE86AD91A62",
  2024: "https://yambol.bg/uploads/E2799BB345CA60C59FADC2893CA59B8F",
  2025: "https://yambol.bg/uploads/F78A27D981721A6CE39F7EC33D6B09B2",
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

interface YambolCapitalProject {
  id: number;
  name: string;
  total: Money;
}

interface YambolCapitalProgramFile {
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
  projects: YambolCapitalProject[];
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

const main = () => {
  const args = process.argv.slice(2);
  const yearIdx = args.indexOf("--year");
  const fiscalYear = yearIdx >= 0 ? Number(args[yearIdx + 1]) : 2025;

  const ocrPath = resolve(
    __dirname,
    "../../../raw_data/budget/capital_programs",
    `yambol-${fiscalYear}-ocr.json`,
  );
  if (!existsSync(ocrPath)) {
    throw new Error(
      `Missing OCR JSON at ${ocrPath} — run yambol_ocr.ts --year ${fiscalYear} first`,
    );
  }
  const ocr: OcrFile = JSON.parse(readFileSync(ocrPath, "utf-8"));
  console.log(
    `[yambol-capital] reading ${ocrPath} (year ${fiscalYear}, ${ocr.projects.length} OCR rows)`,
  );

  const projects: YambolCapitalProject[] = ocr.projects.map((p, i) => ({
    id: i + 1,
    name: p.description.trim(),
    total: bgnToMoney(p.amount),
  }));

  const itemisedTotal = bgnToMoney(
    projects.reduce((s, p) => s + p.total.amount, 0),
  );

  const out: YambolCapitalProgramFile = {
    fiscalYear,
    generatedAt: new Date().toISOString(),
    source: {
      publisher: "Община Ямбол",
      documentTitle: `Приложение ${fiscalYear >= 2025 ? "5" : "4"} — Разчет за финансиране на капиталовите разходи за ${fiscalYear} г.`,
      url: SOURCE_URLS[fiscalYear] ?? "https://yambol.bg/byudzhet",
      fetchedAt: new Date().toISOString(),
      ocrModel: ocr.model,
      ocrGeneratedAt: ocr.generatedAt,
    },
    municipalityCode: "JAM26",
    municipalityNameBg: "Ямбол",
    municipalityNameEn: "Yambol",
    currency: "BGN",
    recapitulation: { total: itemisedTotal },
    publishedRecap: ocr.recapTotal != null ? bgnToMoney(ocr.recapTotal) : null,
    projects,
  };

  const outPath = resolve(
    __dirname,
    "../../../data/budget/capital_programs",
    String(fiscalYear),
    "yambol.json",
  );
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log(
    `[yambol-capital] wrote ${outPath} — ${projects.length} projects, itemised EUR ${(
      itemisedTotal.amountEur / 1_000_000
    ).toFixed(1)}M${
      out.publishedRecap
        ? ` (published recap EUR ${(out.publishedRecap.amountEur / 1_000_000).toFixed(1)}M)`
        : ""
    }`,
  );
};

main();
