// Rollup parser for Сливен's annual капиталова програма — consumes the
// Gemini Vision OCR JSON (raw_data/.../sliven-YYYY-ocr.json) and emits
// a StaraZagora-style SlivenCapitalProgramFile shape (single município,
// no районi, per-settlement breakdown via "с." / "гр." prefix match).
//
// Sliven obshtina = SLV20, EKATTE 67338 (the city). The município has
// 45 settlements: 43 villages + the city of Sliven + the small town of
// Кермен. The 2025 capital programme totals ~120 projects after OCR.
//
// Run: tsx scripts/budget/capital_programs/sliven.ts [--year 2025]

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BGN_PER_EUR } from "../../../src/lib/currency";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SOURCE_URLS: Record<number, string> = {
  2025: "https://mun.sliven.bg/uploads/95ADBC16C47BD97F571BEB02674C6E2C",
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

interface SlivenCapitalProject {
  id: number;
  name: string;
  settlement: string | null;
  total: Money;
}

interface SlivenCapitalSettlementRollup {
  name: string;
  projectCount: number;
  total: Money;
  topProjects: Array<{ id: number; name: string; total: Money }>;
}

interface SlivenCapitalProgramFile {
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
  projects: SlivenCapitalProject[];
  bySettlement: SlivenCapitalSettlementRollup[];
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

// 45 settlements of Община Сливен (SLV20) — 43 villages + 1 town + the city.
const SLV_SETTLEMENTS: Array<{ name: string; prefix: string }> = [
  { name: "Сливен", prefix: "гр." },
  { name: "Кермен", prefix: "гр." },
  { name: "Биково", prefix: "с." },
  { name: "Бинкос", prefix: "с." },
  { name: "Блатец", prefix: "с." },
  { name: "Божевци", prefix: "с." },
  { name: "Бозаджии", prefix: "с." },
  { name: "Бяла", prefix: "с." },
  { name: "Въглен", prefix: "с." },
  { name: "Гавраилово", prefix: "с." },
  { name: "Гергевец", prefix: "с." },
  { name: "Глуфишево", prefix: "с." },
  { name: "Глушник", prefix: "с." },
  { name: "Голямо Чочовени", prefix: "с." },
  { name: "Горно Александрово", prefix: "с." },
  { name: "Градско", prefix: "с." },
  { name: "Драгоданово", prefix: "с." },
  { name: "Желю войвода", prefix: "с." },
  { name: "Зайчари", prefix: "с." },
  { name: "Злати войвода", prefix: "с." },
  { name: "Изгрев", prefix: "с." },
  { name: "Ичера", prefix: "с." },
  { name: "Калояново", prefix: "с." },
  { name: "Камен", prefix: "с." },
  { name: "Ковачите", prefix: "с." },
  { name: "Крушаре", prefix: "с." },
  { name: "Малко Чочовени", prefix: "с." },
  { name: "Мечкарево", prefix: "с." },
  { name: "Младово", prefix: "с." },
  { name: "Николаево", prefix: "с." },
  { name: "Новачево", prefix: "с." },
  { name: "Панаретовци", prefix: "с." },
  { name: "Раково", prefix: "с." },
  { name: "Самуилово", prefix: "с." },
  { name: "Селиминово", prefix: "с." },
  { name: "Скобелево", prefix: "с." },
  { name: "Сотиря", prefix: "с." },
  { name: "Средорек", prefix: "с." },
  { name: "Стара река", prefix: "с." },
  { name: "Старо село", prefix: "с." },
  { name: "Струпец", prefix: "с." },
  { name: "Тополчане", prefix: "с." },
  { name: "Трапоклово", prefix: "с." },
  { name: "Чинтулово", prefix: "с." },
  { name: "Чокоба", prefix: "с." },
];

const SETTLEMENT_PATTERNS = SLV_SETTLEMENTS.slice()
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
    `sliven-${fiscalYear}-ocr.json`,
  );
  if (!existsSync(ocrPath)) {
    throw new Error(
      `Missing OCR JSON at ${ocrPath} — run sliven_ocr.ts --year ${fiscalYear} first`,
    );
  }
  const ocr: OcrFile = JSON.parse(readFileSync(ocrPath, "utf-8"));
  console.log(
    `[sliven-capital] reading ${ocrPath} (year ${fiscalYear}, ${ocr.projects.length} OCR rows)`,
  );

  const projects: SlivenCapitalProject[] = ocr.projects.map((p, i) => ({
    id: i + 1,
    name: p.description.trim(),
    settlement: extractSettlement(p.description),
    total: bgnToMoney(p.amount),
  }));

  // Per-settlement rollup.
  const bySettlementAgg = new Map<
    string,
    { total: number; projects: SlivenCapitalProject[] }
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
  const bySettlement: SlivenCapitalSettlementRollup[] = [...bySettlementAgg]
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

  // Itemised sum is the tile's headline; publishedRecap preserved for reference.
  const itemisedTotal = bgnToMoney(
    projects.reduce((s, p) => s + p.total.amount, 0),
  );

  const out: SlivenCapitalProgramFile = {
    fiscalYear,
    generatedAt: new Date().toISOString(),
    source: {
      publisher: "Община Сливен",
      documentTitle: `Капиталова програма ${fiscalYear} г. (Разчет за финансиране на капиталови разходи, Начален план)`,
      url: SOURCE_URLS[fiscalYear] ?? "",
      fetchedAt: new Date().toISOString(),
      ocrModel: ocr.model,
      ocrGeneratedAt: ocr.generatedAt,
    },
    municipalityCode: "SLV20",
    municipalityNameBg: "Сливен",
    municipalityNameEn: "Sliven",
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
    "sliven.json",
  );
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log(
    `[sliven-capital] wrote ${outPath} — ${projects.length} projects, itemised EUR ${(
      itemisedTotal.amountEur / 1_000_000
    ).toFixed(1)}M${
      out.publishedRecap
        ? ` (published recap EUR ${(out.publishedRecap.amountEur / 1_000_000).toFixed(1)}M)`
        : ""
    }`,
  );
  const tagged = projects.filter((p) => p.settlement !== null).length;
  console.log(
    `[sliven-capital] settlement tagging: ${tagged}/${projects.length} (${(
      (100 * tagged) /
      Math.max(projects.length, 1)
    ).toFixed(0)}%)`,
  );
  console.log("[sliven-capital] top settlements:");
  for (const s of bySettlement.slice(0, 10)) {
    console.log(
      `  ${s.name.padEnd(22)} ${s.projectCount.toString().padStart(2)} proj  EUR ${(s.total.amountEur / 1000).toFixed(0)}k`,
    );
  }
};

main();
