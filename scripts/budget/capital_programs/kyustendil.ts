// Rollup parser for Кюстендил's annual капиталова програма. Consumes the
// Gemini Vision OCR JSON (kyustendil_ocr.ts) and emits a tile-ready
// KyustendilCapitalProgramFile.
//
// Kyustendil obshtina = KNL29 (Kyustendil oblast), EKATTE 41112 (city).
// 72 settlements: 1 town + 71 villages.
//
// Run: tsx scripts/budget/capital_programs/kyustendil.ts [--year 2025]

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BGN_PER_EUR } from "../../../src/lib/currency";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SOURCE_URLS: Record<number, string> = {
  2025: "https://obs.kyustendil.bg/Documents/DnevenRed/30/ДЗ 61-00-3216.pdf",
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

interface KyustendilCapitalProject {
  id: number;
  name: string;
  settlement: string | null;
  total: Money;
}

interface KyustendilCapitalSettlementRollup {
  name: string;
  projectCount: number;
  total: Money;
  topProjects: Array<{ id: number; name: string; total: Money }>;
}

interface KyustendilCapitalProgramFile {
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
  projects: KyustendilCapitalProject[];
  bySettlement: KyustendilCapitalSettlementRollup[];
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

// 72 settlements of Община Кюстендил (KNL29) per data/settlements.json.
const KYU_SETTLEMENTS: Array<{ name: string; prefix: "гр." | "с." }> = [
  { name: "Кюстендил", prefix: "гр." },
  { name: "Багренци", prefix: "с." },
  { name: "Берсин", prefix: "с." },
  { name: "Блатец", prefix: "с." },
  { name: "Бобешино", prefix: "с." },
  { name: "Богослов", prefix: "с." },
  { name: "Буново", prefix: "с." },
  { name: "Вратца", prefix: "с." },
  { name: "Гирчевци", prefix: "с." },
  { name: "Горановци", prefix: "с." },
  { name: "Горна Брестница", prefix: "с." },
  { name: "Горна Гращица", prefix: "с." },
  { name: "Горно Уйно", prefix: "с." },
  { name: "Грамаждано", prefix: "с." },
  { name: "Граница", prefix: "с." },
  { name: "Гурбановци", prefix: "с." },
  { name: "Гърбино", prefix: "с." },
  { name: "Гърляно", prefix: "с." },
  { name: "Гюешево", prefix: "с." },
  { name: "Дворище", prefix: "с." },
  { name: "Дождевица", prefix: "с." },
  { name: "Долна Гращица", prefix: "с." },
  { name: "Долно село", prefix: "с." },
  { name: "Долно Уйно", prefix: "с." },
  { name: "Драговищица", prefix: "с." },
  { name: "Жабокрът", prefix: "с." },
  { name: "Жеравино", prefix: "с." },
  { name: "Жиленци", prefix: "с." },
  { name: "Ивановци", prefix: "с." },
  { name: "Каменичка Скакавица", prefix: "с." },
  { name: "Катрище", prefix: "с." },
  { name: "Коняво", prefix: "с." },
  { name: "Копиловци", prefix: "с." },
  { name: "Коприва", prefix: "с." },
  { name: "Кутугерци", prefix: "с." },
  { name: "Кършалево", prefix: "с." },
  { name: "Лелинци", prefix: "с." },
  { name: "Леска", prefix: "с." },
  { name: "Лисец", prefix: "с." },
  { name: "Лозно", prefix: "с." },
  { name: "Ломница", prefix: "с." },
  { name: "Мазарачево", prefix: "с." },
  { name: "Николичевци", prefix: "с." },
  { name: "Нови чифлик", prefix: "с." },
  { name: "Ново село", prefix: "с." },
  { name: "Пиперков чифлик", prefix: "с." },
  { name: "Полетинци", prefix: "с." },
  { name: "Полска Скакавица", prefix: "с." },
  { name: "Преколница", prefix: "с." },
  { name: "Радловци", prefix: "с." },
  { name: "Раждавица", prefix: "с." },
  { name: "Раненци", prefix: "с." },
  { name: "Режинци", prefix: "с." },
  { name: "Ръсово", prefix: "с." },
  { name: "Савойски", prefix: "с." },
  { name: "Сажденик", prefix: "с." },
  { name: "Скриняно", prefix: "с." },
  { name: "Слокощица", prefix: "с." },
  { name: "Соволяно", prefix: "с." },
  { name: "Стенско", prefix: "с." },
  { name: "Таваличево", prefix: "с." },
  { name: "Търновлаг", prefix: "с." },
  { name: "Търсино", prefix: "с." },
  { name: "Церовица", prefix: "с." },
  { name: "Црешново", prefix: "с." },
  { name: "Цървена ябълка", prefix: "с." },
  { name: "Цървендол", prefix: "с." },
  { name: "Цървеняно", prefix: "с." },
  { name: "Чудинци", prefix: "с." },
  { name: "Шипочано", prefix: "с." },
  { name: "Шишковци", prefix: "с." },
  { name: "Ябълково", prefix: "с." },
];

const SORTED = KYU_SETTLEMENTS.slice().sort(
  (a, b) => b.name.length - a.name.length,
);

const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Primary: explicit prefix ("гр. X" / "град X" / "с. X" / "село X" /
// "кметство X" — кметство is used heavily in Kyustendil descriptions).
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

// Fallback: bare settlement name. Skip if preceded by "Община ".
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
    `kyustendil-${fiscalYear}-ocr.json`,
  );
  if (!existsSync(ocrPath)) {
    throw new Error(
      `Missing OCR JSON at ${ocrPath} — run kyustendil_ocr.ts first`,
    );
  }
  console.log(`[kyu-capital] reading ${ocrPath} (year ${fiscalYear})`);
  const ocr = JSON.parse(readFileSync(ocrPath, "utf-8")) as OcrFile;

  const projects: KyustendilCapitalProject[] = [];
  for (const p of ocr.projects) {
    if (!p.description || !Number.isFinite(p.amount) || p.amount <= 0) continue;
    projects.push({
      id: projects.length + 1,
      name: p.description.replace(/\s+/g, " ").trim(),
      settlement: extractSettlement(p.description),
      total: bgnToMoney(p.amount),
    });
  }
  console.log(`[kyu-capital] kept ${projects.length} project rows`);

  const bySettlementAgg = new Map<
    string,
    { total: number; projects: KyustendilCapitalProject[] }
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
  const bySettlement: KyustendilCapitalSettlementRollup[] = [...bySettlementAgg]
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

  const out: KyustendilCapitalProgramFile = {
    fiscalYear,
    generatedAt: new Date().toISOString(),
    source: {
      publisher: "Община Кюстендил",
      documentTitle: `Поименен списък на капиталовите разходи за ${fiscalYear} г. (Приложение № 6 към Окончателен годишен план)`,
      url: SOURCE_URLS[fiscalYear] ?? "",
      fetchedAt: new Date().toISOString(),
      ocrModel: ocr.model,
      ocrGeneratedAt: ocr.generatedAt,
    },
    municipalityCode: "KNL29",
    municipalityNameBg: "Кюстендил",
    municipalityNameEn: "Kyustendil",
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
    "kyustendil.json",
  );
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log(
    `[kyu-capital] wrote ${outPath} — ${projects.length} projects, itemised EUR ${(
      itemisedTotal.amountEur / 1_000_000
    ).toFixed(1)}M${
      out.publishedRecap
        ? ` (published recap EUR ${(out.publishedRecap.amountEur / 1_000_000).toFixed(1)}M, ratio ${(itemisedTotal.amount / out.publishedRecap.amount).toFixed(3)})`
        : ""
    }`,
  );
  const tagged = projects.filter((p) => p.settlement !== null).length;
  console.log(
    `[kyu-capital] settlement tagging: ${tagged}/${projects.length} (${(
      (100 * tagged) /
      Math.max(projects.length, 1)
    ).toFixed(0)}%)`,
  );
  console.log("[kyu-capital] top settlements:");
  for (const s of bySettlement.slice(0, 10)) {
    console.log(
      `  ${s.name.padEnd(22)} ${s.projectCount.toString().padStart(2)} proj  EUR ${(s.total.amountEur / 1000).toFixed(0)}k`,
    );
  }
};

main();
