// Rollup parser for Монтана's annual капиталова програма. Consumes the
// Gemini Vision OCR JSON (montana_ocr.ts) and emits a tile-ready
// MontanaCapitalProgramFile.
//
// Montana obshtina = MON29 (Montana oblast, oblast capital). EKATTE 48489.
// 24 settlements: 1 town + 23 villages.
//
// Source PDF (5 pages) is a Konica Minolta scan of multiple sub-appendices
// (Прил. 7а / 7б / 7в / 7д on pages 1-4 — funding-source breakdowns) and
// a CONSOLIDATED summary table on page 5 containing the canonical list of
// 9 named projects that sum to "ВСИЧКО" 53,932,194 BGN, PLUS a separate
// 3M театър ремонт line listed below the recap.
//
// We use ONLY page 5: pages 1-4 itemise the same projects across funding
// sources and would double-count if included. The page-5 list of 9 projects
// totals 56,932,194 BGN ≈ €29.1M and is treated as the headline.
//
// Run: tsx scripts/budget/capital_programs/montana.ts [--year 2025]

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BGN_PER_EUR } from "../../../src/lib/currency";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SOURCE_URLS: Record<number, string> = {
  2025: "https://www.montana.bg/свали/бюджет/32",
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

interface MontanaCapitalProject {
  id: number;
  name: string;
  settlement: string | null;
  total: Money;
}

interface MontanaCapitalSettlementRollup {
  name: string;
  projectCount: number;
  total: Money;
  topProjects: Array<{ id: number; name: string; total: Money }>;
}

interface MontanaCapitalProgramFile {
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
  projects: MontanaCapitalProject[];
  bySettlement: MontanaCapitalSettlementRollup[];
}

interface OcrProject {
  page: number;
  rowNum: string | null;
  description: string;
  amount: number;
}
interface OcrFile {
  generatedAt: string;
  model: string;
  fiscalYear: number;
  pageCount: number;
  projects: OcrProject[];
  recapTotal: number | null;
}

// 24 settlements of Община Монтана (MON29) per data/settlements.json.
const MON_SETTLEMENTS: Array<{ name: string; prefix: "гр." | "с." }> = [
  { name: "Монтана", prefix: "гр." },
  { name: "Безденица", prefix: "с." },
  { name: "Белотинци", prefix: "с." },
  { name: "Долно Белотинци", prefix: "с." },
  { name: "Благово", prefix: "с." },
  { name: "Винище", prefix: "с." },
  { name: "Вирове", prefix: "с." },
  { name: "Войници", prefix: "с." },
  { name: "Габровница", prefix: "с." },
  { name: "Горна Вереница", prefix: "с." },
  { name: "Горно Церовене", prefix: "с." },
  { name: "Доктор Йосифово", prefix: "с." },
  { name: "Долна Вереница", prefix: "с." },
  { name: "Долна Рикса", prefix: "с." },
  { name: "Клисурица", prefix: "с." },
  { name: "Крапчене", prefix: "с." },
  { name: "Липен", prefix: "с." },
  { name: "Николово", prefix: "с." },
  { name: "Славотин", prefix: "с." },
  { name: "Смоляновци", prefix: "с." },
  { name: "Стубел", prefix: "с." },
  { name: "Студено буче", prefix: "с." },
  { name: "Сумер", prefix: "с." },
  { name: "Трифоново", prefix: "с." },
];

const SORTED = MON_SETTLEMENTS.slice().sort(
  (a, b) => b.name.length - a.name.length,
);

const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const PREFIX_PATTERNS = SORTED.map(({ name, prefix }) => {
  const longPrefix =
    prefix === "гр." ? "(?:гр\\.|град)" : "(?:с\\.|село|км\\.|кметство)";
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

const main = () => {
  const args = process.argv.slice(2);
  const yearIdx = args.indexOf("--year");
  const fiscalYear = yearIdx >= 0 ? Number(args[yearIdx + 1]) : 2025;

  const ocrPath = resolve(
    __dirname,
    "../../../raw_data/budget/capital_programs",
    `montana-${fiscalYear}-ocr.json`,
  );
  if (!existsSync(ocrPath)) {
    throw new Error(
      `Missing OCR JSON at ${ocrPath} — run montana_ocr.ts first`,
    );
  }
  console.log(`[mon-capital] reading ${ocrPath} (year ${fiscalYear})`);
  const ocr = JSON.parse(readFileSync(ocrPath, "utf-8")) as OcrFile;

  // Use ONLY page 5 (the consolidated summary list); pages 1-4 itemise
  // the same projects across funding sources and would double-count.
  const page5 = ocr.projects.filter((p) => p.page === 5);

  const projects: MontanaCapitalProject[] = [];
  for (const p of page5) {
    if (!p.description || !Number.isFinite(p.amount) || p.amount <= 0) continue;
    projects.push({
      id: projects.length + 1,
      name: p.description.replace(/\s+/g, " ").trim(),
      settlement: extractSettlement(p.description),
      total: bgnToMoney(p.amount),
    });
  }
  console.log(`[mon-capital] kept ${projects.length} page-5 projects`);

  const bySettlementAgg = new Map<
    string,
    { total: number; projects: MontanaCapitalProject[] }
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
  const bySettlement: MontanaCapitalSettlementRollup[] = [...bySettlementAgg]
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

  const out: MontanaCapitalProgramFile = {
    fiscalYear,
    generatedAt: new Date().toISOString(),
    source: {
      publisher: "Община Монтана",
      documentTitle: `Капиталова програма за ${fiscalYear} г.`,
      url: SOURCE_URLS[fiscalYear] ?? "",
      fetchedAt: new Date().toISOString(),
      ocrModel: ocr.model,
      ocrGeneratedAt: ocr.generatedAt,
    },
    municipalityCode: "MON29",
    municipalityNameBg: "Монтана",
    municipalityNameEn: "Montana",
    currency: "BGN",
    recapitulation: { total: itemisedTotal },
    // OCR's recapTotal captures the "ВСИЧКО" subtotal (53,932,194 BGN) but
    // there's a separate 3M театър ремонт project listed below it on the
    // same page — that's still a 2025 capital project even if outside the
    // formal recap. Headline uses the full 9-row itemised total (~57M) so
    // it matches the per-project list shown on the tile.
    publishedRecap: itemisedTotal,
    projects,
    bySettlement,
  };

  const outPath = resolve(
    __dirname,
    "../../../data/budget/capital_programs",
    String(fiscalYear),
    "montana.json",
  );
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log(
    `[mon-capital] wrote ${outPath} — ${projects.length} projects, itemised EUR ${(
      itemisedTotal.amountEur / 1_000_000
    ).toFixed(1)}M${
      out.publishedRecap
        ? ` (published recap EUR ${(out.publishedRecap.amountEur / 1_000_000).toFixed(1)}M, ratio ${(itemisedTotal.amount / out.publishedRecap.amount).toFixed(3)})`
        : ""
    }`,
  );
  const tagged = projects.filter((p) => p.settlement !== null).length;
  console.log(
    `[mon-capital] settlement tagging: ${tagged}/${projects.length} (${(
      (100 * tagged) /
      Math.max(projects.length, 1)
    ).toFixed(0)}%)`,
  );
  console.log("[mon-capital] top settlements:");
  for (const s of bySettlement.slice(0, 10)) {
    console.log(
      `  ${s.name.padEnd(22)} ${s.projectCount.toString().padStart(2)} proj  EUR ${(s.total.amountEur / 1000).toFixed(0)}k`,
    );
  }
};

main();
