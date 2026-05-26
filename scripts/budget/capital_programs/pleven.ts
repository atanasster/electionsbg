// Parser for Община Плевен's annual капиталова програма — Приложения №4
// (general capital programme) + №10А (EU projects) extracted from the
// council's budget docket PDF.
//
// 2025 source workflow:
//   1. Download the full budget docket PDF (63 pages) into
//      raw_data/budget/capital_programs/pleven-2025.pdf
//   2. Slice pages 13-17 + 35-37 into pleven-2025-capital-pages.pdf with:
//        python3 -c "
//        from pypdf import PdfReader, PdfWriter
//        r = PdfReader('raw_data/budget/capital_programs/pleven-2025.pdf')
//        w = PdfWriter()
//        for i in list(range(12,17)) + list(range(34,37)): w.add_page(r.pages[i])
//        with open('raw_data/budget/capital_programs/pleven-2025-capital-pages.pdf','wb') as f: w.write(f)
//        "
//   3. Run the OCR pre-step:
//        tsx scripts/budget/capital_programs/pleven_ocr.ts --year 2025
//   4. Run this rollup:
//        tsx scripts/budget/capital_programs/pleven.ts --year 2025
//
// Why OCR rather than pdftotext: the source PDF has born-digital text
// but the layout is heavily fragmented (rotated funding-source labels,
// multi-line descriptions, sparse columns) — Gemini Vision recovers the
// row-level structure reliably. See Varna for the original use case.
//
// Pleven has NO районi. The structural dimension we expose is:
//   - by FUNDING SOURCE (Прил. №4 row-groups: преходни остатъци /
//     целеви субсидии / други бюджетни средства + Прил. №10А EU)
//   - by SETTLEMENT (city + 24 outlying villages around it, where the
//     project description names a "гр./с." location)
//
// Recap convention: same as Stara Zagora / Ruse — use the itemised sum
// as the tile headline; preserve the published Прил. №4 + №10А ВСИЧКО
// totals on `publishedRecap` for reference. The two recaps are 7.59M +
// 11.00M = 18.58M BGN.
//
// Run: tsx scripts/budget/capital_programs/pleven.ts [--year 2025]

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BGN_PER_EUR } from "../../../src/lib/currency";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SOURCE_URLS: Record<number, string> = {
  2025: "https://obs.pleven.bg/uploads/posts/prilozheniya-kam-reshenie-659.pdf",
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

interface PlevenCapitalProject {
  id: number;
  name: string;
  settlement: string | null; // "гр. Плевен" / "с. Горталово" / null
  fundingSource: string | null; // SCREAMING_SNAKE_CASE
  appendix: "PRILOZHENIE_4" | "PRILOZHENIE_10A";
  total: Money;
}

interface PlevenCapitalSettlementRollup {
  name: string; // display name e.g. "гр. Плевен"
  projectCount: number;
  total: Money;
  topProjects: Array<{ id: number; name: string; total: Money }>;
}

interface PlevenCapitalFundingRollup {
  code: string;
  projectCount: number;
  total: Money;
}

interface PlevenCapitalProgramFile {
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
  publishedRecap: {
    prilozhenie4: Money | null;
    prilozhenie10A: Money | null;
    combined: Money | null;
  };
  projects: PlevenCapitalProject[];
  bySettlement: PlevenCapitalSettlementRollup[];
  byFundingSource: PlevenCapitalFundingRollup[];
}

interface OcrFile {
  generatedAt: string;
  model: string;
  source: { publisher: string; documentTitle: string; url: string };
  fiscalYear: number;
  pageCount: number;
  projects: Array<{
    page: number;
    description: string;
    fundingSource: string | null;
    appendix: "PRILOZHENIE_4" | "PRILOZHENIE_10A";
    amount: number;
  }>;
  recapPrilozhenie4: number | null;
  recapPrilozhenie10A: number | null;
  notes: string | null;
}

// 25 settlements of Община Плевен (PVN24).
const PVN_SETTLEMENTS = [
  { name: "Плевен", prefix: "гр." },
  { name: "Славяново", prefix: "гр." },
  { name: "Беглеж", prefix: "с." },
  { name: "Бохот", prefix: "с." },
  { name: "Брестовец", prefix: "с." },
  { name: "Бръшляница", prefix: "с." },
  { name: "Буковлък", prefix: "с." },
  { name: "Върбица", prefix: "с." },
  { name: "Горталово", prefix: "с." },
  { name: "Гривица", prefix: "с." },
  { name: "Дисевица", prefix: "с." },
  { name: "Коиловци", prefix: "с." },
  { name: "Къртожабене", prefix: "с." },
  { name: "Къшин", prefix: "с." },
  { name: "Ласкар", prefix: "с." },
  { name: "Мечка", prefix: "с." },
  { name: "Николаево", prefix: "с." },
  { name: "Опанец", prefix: "с." },
  { name: "Пелишат", prefix: "с." },
  { name: "Радишево", prefix: "с." },
  { name: "Ралево", prefix: "с." },
  { name: "Тодорово", prefix: "с." },
  { name: "Тученица", prefix: "с." },
  { name: "Търнене", prefix: "с." },
  { name: "Ясен", prefix: "с." },
];

// Match "<prefix> NAME" with NAME a known village/town. Longest first
// so "Сладък кладенец"-style multi-word names win over substring matches.
// Anchored on word-boundary punctuation since Bulgarian \b is unreliable.
const SETTLEMENT_PATTERNS: Array<{
  display: string;
  re: RegExp;
}> = PVN_SETTLEMENTS.slice()
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
    `pleven-${fiscalYear}-ocr.json`,
  );
  if (!existsSync(ocrPath)) {
    throw new Error(
      `Missing OCR JSON at ${ocrPath} — run pleven_ocr.ts --year ${fiscalYear} first`,
    );
  }
  const ocr: OcrFile = JSON.parse(readFileSync(ocrPath, "utf-8"));

  console.log(
    `[pleven-capital] reading ${ocrPath} (year ${fiscalYear}, ${ocr.projects.length} OCR rows)`,
  );

  const projects: PlevenCapitalProject[] = ocr.projects.map((p, i) => ({
    id: i + 1,
    name: p.description.trim(),
    settlement: extractSettlement(p.description),
    fundingSource: p.fundingSource,
    appendix: p.appendix,
    total: bgnToMoney(p.amount),
  }));

  // Per-settlement rollup.
  const bySettlementAgg = new Map<
    string,
    { total: number; projects: PlevenCapitalProject[] }
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
  const bySettlement: PlevenCapitalSettlementRollup[] = [...bySettlementAgg]
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

  // Per-funding-source rollup.
  const byFundingAgg = new Map<string, { total: number; count: number }>();
  for (const pr of projects) {
    const key = pr.fundingSource ?? "UNSPECIFIED";
    const cur = byFundingAgg.get(key) ?? { total: 0, count: 0 };
    cur.total += pr.total.amount;
    cur.count += 1;
    byFundingAgg.set(key, cur);
  }
  const byFundingSource: PlevenCapitalFundingRollup[] = [...byFundingAgg]
    .map(([code, agg]) => ({
      code,
      projectCount: agg.count,
      total: bgnToMoney(agg.total),
    }))
    .sort((a, b) => b.total.amountEur - a.total.amountEur);

  // Itemised sum as headline; published recaps preserved for reference.
  const itemisedTotal = bgnToMoney(
    projects.reduce((s, p) => s + p.total.amount, 0),
  );
  const recap4 =
    ocr.recapPrilozhenie4 != null ? bgnToMoney(ocr.recapPrilozhenie4) : null;
  const recap10A =
    ocr.recapPrilozhenie10A != null
      ? bgnToMoney(ocr.recapPrilozhenie10A)
      : null;
  const combined =
    recap4 && recap10A ? bgnToMoney(recap4.amount + recap10A.amount) : null;

  const out: PlevenCapitalProgramFile = {
    fiscalYear,
    generatedAt: new Date().toISOString(),
    source: {
      publisher: "Община Плевен",
      documentTitle: `Капиталова програма ${fiscalYear} г. (Приложения №4 + №10А)`,
      url: SOURCE_URLS[fiscalYear] ?? "",
      fetchedAt: new Date().toISOString(),
      ocrModel: ocr.model,
      ocrGeneratedAt: ocr.generatedAt,
    },
    municipalityCode: "PVN24",
    municipalityNameBg: "Плевен",
    municipalityNameEn: "Pleven",
    currency: "BGN",
    recapitulation: { total: itemisedTotal },
    publishedRecap: {
      prilozhenie4: recap4,
      prilozhenie10A: recap10A,
      combined,
    },
    projects,
    bySettlement,
    byFundingSource,
  };

  const outPath = resolve(
    __dirname,
    "../../../data/budget/capital_programs",
    String(fiscalYear),
    "pleven.json",
  );
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n", "utf8");

  console.log(
    `[pleven-capital] wrote ${outPath} — ${projects.length} projects, itemised EUR ${(
      itemisedTotal.amountEur / 1_000_000
    ).toFixed(1)}M (published combined recap EUR ${
      combined ? (combined.amountEur / 1_000_000).toFixed(1) : "—"
    }M)`,
  );
  const tagged = projects.filter((p) => p.settlement !== null).length;
  console.log(
    `[pleven-capital] settlement tagging: ${tagged}/${projects.length} (${(
      (100 * tagged) /
      Math.max(projects.length, 1)
    ).toFixed(0)}%)`,
  );
  console.log("\n[pleven-capital] top settlements:");
  for (const s of bySettlement.slice(0, 10)) {
    console.log(
      `  ${s.name.padEnd(22)} ${s.projectCount.toString().padStart(2)} proj  EUR ${(s.total.amountEur / 1000).toFixed(0)}k`,
    );
  }
  console.log("\n[pleven-capital] by funding source:");
  for (const f of byFundingSource) {
    console.log(
      `  ${f.code.padEnd(24)} ${f.projectCount.toString().padStart(3)} proj  EUR ${(f.total.amountEur / 1000).toFixed(0)}k`,
    );
  }
};

main();
