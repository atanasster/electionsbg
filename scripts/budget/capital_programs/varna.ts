// Parser for Община Варна's annual капиталова програма — Приложение №4
// to the council's budget decision.
//
// Source: varnacouncil.bg publishes the appendix as a 71-page rasterized
// scan (200dpi greyscale JPEGs inside a PDF wrapper). pdftotext returns
// near-zero bytes, so this parser runs in TWO stages:
//
//   1. varna_ocr.ts — one-shot Gemini Vision call that OCRs the entire
//      PDF and extracts structured project rows into
//      raw_data/budget/capital_programs/varna-{year}-ocr.json
//   2. varna.ts (this file) — reads the OCR JSON and rolls it up into
//      the same on-disk schema as Plovdiv (per-район breakdown + top
//      city-wide projects), written to
//      data/budget/capital_programs/{year}/varna.json
//
// Splitting the OCR call from the rollup means we only burn API credits
// when the source changes; the rollup parser runs offline and is
// deterministic. The OCR step has its own SKILL.md operator note;
// after running it the operator commits the OCR JSON to raw_data/ and
// then runs `tsx scripts/budget/capital_programs/varna.ts --year YYYY`.
//
// Tile UX matches Plovdiv (single settlement record for the whole
// city, render ALL 5 районi stacked).
//
// Run: tsx scripts/budget/capital_programs/varna.ts [--year 2025]

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BGN_PER_EUR } from "../../../src/lib/currency";
import { VARNA_RAYONS } from "./varna_rayons";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SOURCE_URLS: Record<number, string> = {
  2025: "https://varnacouncil.bg/wp-content/uploads/2025/04/7-9.-Приложение-4-капиталови-разходи-.pdf",
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
  rayon: string | null;
  amount: number;
}

interface OcrFile {
  generatedAt: string;
  model: string;
  source: { publisher: string; documentTitle: string; url: string };
  fiscalYear: number;
  pageCount: number;
  projects: OcrProject[];
  recapTotal?: number | null;
  notes?: string;
}

interface CapitalProject {
  id: number;
  name: string;
  rayons: string[];
  total: Money;
}

interface CapitalRayonRollup {
  code: string;
  labelBg: string;
  labelEn: string;
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
    ocrModel: string;
    ocrGeneratedAt: string;
  };
  municipalityCode: string;
  municipalityNameBg: string;
  municipalityNameEn: string;
  currency: "BGN" | "EUR";
  recapitulation: { total: Money };
  publishedRecap: Money | null;
  projects: CapitalProject[];
  byRayon: CapitalRayonRollup[];
}

const parseProgram = (
  ocrPath: string,
  fiscalYear: number,
): CapitalProgramFile => {
  if (!existsSync(ocrPath)) {
    throw new Error(
      `Missing OCR cache at ${ocrPath} — run varna_ocr.ts --year ${fiscalYear} first`,
    );
  }
  const ocr = JSON.parse(readFileSync(ocrPath, "utf-8")) as OcrFile;

  const projects: CapitalProject[] = ocr.projects.map((p, i) => ({
    id: i + 1,
    name: p.description.trim(),
    rayons: p.rayon ? [p.rayon] : [],
    total: bgnToMoney(p.amount),
  }));

  // Per-район rollup.
  const rayonAgg = new Map<
    string,
    { total: number; projects: CapitalProject[] }
  >();
  for (const p of projects) {
    for (const r of p.rayons) {
      const cur = rayonAgg.get(r) ?? { total: 0, projects: [] };
      cur.total += p.total.amount;
      cur.projects.push(p);
      rayonAgg.set(r, cur);
    }
  }
  const byRayon: CapitalRayonRollup[] = VARNA_RAYONS.map((r) => {
    const agg = rayonAgg.get(r.code);
    return {
      code: r.code,
      labelBg: r.labelBg,
      labelEn: r.labelEn,
      projectCount: agg?.projects.length ?? 0,
      total: bgnToMoney(agg?.total ?? 0),
      topProjects: (agg?.projects ?? [])
        .sort((a, b) => b.total.amount - a.total.amount)
        .slice(0, 10)
        .map((p) => ({ id: p.id, name: p.name, total: p.total })),
    };
  }).sort((a, b) => b.total.amountEur - a.total.amountEur);

  // Headline = sum of captured projects. Ruse/Stara-Zagora-style
  // convention: the tile shows what the project list adds up to. The
  // PDF's own ОБЩО recap (if Gemini found one) is preserved on the
  // `publishedRecap` field for reference.
  const itemisedTotal = bgnToMoney(
    projects.reduce((s, p) => s + p.total.amount, 0),
  );
  const publishedRecap =
    ocr.recapTotal != null ? bgnToMoney(ocr.recapTotal) : null;

  return {
    fiscalYear,
    generatedAt: new Date().toISOString(),
    source: {
      publisher: "Община Варна (Общински съвет)",
      documentTitle: `Приложение № 4 — Разчет за финансиране на капиталови разходи ${fiscalYear} г.`,
      url: SOURCE_URLS[fiscalYear] ?? "",
      fetchedAt: new Date().toISOString(),
      ocrModel: ocr.model,
      ocrGeneratedAt: ocr.generatedAt,
    },
    municipalityCode: "VAR06",
    municipalityNameBg: "Варна",
    municipalityNameEn: "Varna",
    currency: "BGN",
    recapitulation: { total: itemisedTotal },
    publishedRecap,
    projects,
    byRayon,
  };
};

const main = () => {
  const args = process.argv.slice(2);
  const yearIdx = args.indexOf("--year");
  const fiscalYear = yearIdx >= 0 ? Number(args[yearIdx + 1]) : 2025;
  const ocrPath = resolve(
    __dirname,
    "../../../raw_data/budget/capital_programs",
    `varna-${fiscalYear}-ocr.json`,
  );
  console.log(`[varna-capital] reading ${ocrPath} (year ${fiscalYear})`);
  const parsed = parseProgram(ocrPath, fiscalYear);

  const outPath = resolve(
    __dirname,
    "../../../data/budget/capital_programs",
    String(fiscalYear),
    "varna.json",
  );
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(parsed, null, 2) + "\n", "utf8");

  console.log(
    `[varna-capital] wrote ${outPath} — ${parsed.projects.length} projects, itemised EUR ${(
      parsed.recapitulation.total.amountEur / 1_000_000
    ).toFixed(1)}M (published recap ${
      parsed.publishedRecap
        ? `EUR ${(parsed.publishedRecap.amountEur / 1_000_000).toFixed(1)}M`
        : "—"
    })`,
  );
  const tagged = parsed.projects.filter((p) => p.rayons.length > 0).length;
  console.log(
    `[varna-capital] район tagging: ${tagged}/${parsed.projects.length} (${(
      (100 * tagged) /
      Math.max(parsed.projects.length, 1)
    ).toFixed(0)}%)`,
  );
  console.log("\n[varna-capital] per-район totals:");
  for (const r of parsed.byRayon) {
    console.log(
      `  ${r.labelBg.padEnd(22)} ${r.projectCount.toString().padStart(3)} projects  EUR ${(r.total.amountEur / 1_000_000).toFixed(2)}M`,
    );
  }
};

main();
