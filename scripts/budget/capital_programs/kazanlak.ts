// Rollup parser for Казанлък's annual капиталова програма. Consumes the
// Gemini Vision OCR JSON (kazanlak_ocr.ts) and emits a tile-ready
// KazanlakCapitalProgramFile.
//
// Kazanlak obshtina = SZR12 (Stara Zagora oblast), EKATTE 35167 (city).
// 20 settlements: 3 towns (Казанлък, Крън, Шипка) + 17 villages.
//
// Run: tsx scripts/budget/capital_programs/kazanlak.ts [--year 2025]

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BGN_PER_EUR } from "../../../src/lib/currency";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SOURCE_URLS: Record<number, string> = {
  2025: "https://www.kazanlak.bg/common/images/src/81/file/Приложения.pdf",
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

interface KazanlakCapitalProject {
  id: number;
  name: string;
  settlement: string | null;
  total: Money;
}

interface KazanlakCapitalSettlementRollup {
  name: string;
  projectCount: number;
  total: Money;
  topProjects: Array<{ id: number; name: string; total: Money }>;
}

interface KazanlakCapitalProgramFile {
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
  projects: KazanlakCapitalProject[];
  bySettlement: KazanlakCapitalSettlementRollup[];
}

interface OcrProject {
  page: number;
  rowNum: number | null;
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

// 20 settlements of Община Казанлък (SZR12) per data/settlements.json.
const KZN_SETTLEMENTS: Array<{ name: string; prefix: "гр." | "с." }> = [
  { name: "Казанлък", prefix: "гр." },
  { name: "Крън", prefix: "гр." },
  { name: "Шипка", prefix: "гр." },
  { name: "Бузовград", prefix: "с." },
  { name: "Голямо Дряново", prefix: "с." },
  { name: "Горно Изворово", prefix: "с." },
  { name: "Горно Черковище", prefix: "с." },
  { name: "Долно Изворово", prefix: "с." },
  { name: "Дунавци", prefix: "с." },
  { name: "Енина", prefix: "с." },
  { name: "Копринка", prefix: "с." },
  { name: "Кънчево", prefix: "с." },
  { name: "Овощник", prefix: "с." },
  { name: "Розово", prefix: "с." },
  { name: "Ръжена", prefix: "с." },
  { name: "Средногорово", prefix: "с." },
  { name: "Хаджидимитрово", prefix: "с." },
  { name: "Черганово", prefix: "с." },
  { name: "Шейново", prefix: "с." },
  { name: "Ясеново", prefix: "с." },
];

const SORTED = KZN_SETTLEMENTS.slice().sort(
  (a, b) => b.name.length - a.name.length,
);

const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Primary: explicit prefix ("гр. X" / "град X" / "с. X" / "село X" /
// "км. X" / "кмество X" — кметство is used for the village-office
// equipment lines).
const PREFIX_PATTERNS = SORTED.map(({ name, prefix }) => {
  const longPrefix =
    prefix === "гр."
      ? "(?:гр\\.|град)"
      : "(?:с\\.|село|км\\.|кмество|кметство)";
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
    `kazanlak-${fiscalYear}-ocr.json`,
  );
  if (!existsSync(ocrPath)) {
    throw new Error(
      `Missing OCR JSON at ${ocrPath} — run kazanlak_ocr.ts first`,
    );
  }
  console.log(`[kzn-capital] reading ${ocrPath} (year ${fiscalYear})`);
  const ocr = JSON.parse(readFileSync(ocrPath, "utf-8")) as OcrFile;

  const projects: KazanlakCapitalProject[] = [];
  for (const p of ocr.projects) {
    if (!p.description || !Number.isFinite(p.amount) || p.amount <= 0) continue;
    projects.push({
      id: projects.length + 1,
      name: p.description.replace(/\s+/g, " ").trim(),
      settlement: extractSettlement(p.description),
      total: bgnToMoney(p.amount),
    });
  }
  console.log(`[kzn-capital] kept ${projects.length} project rows`);

  const bySettlementAgg = new Map<
    string,
    { total: number; projects: KazanlakCapitalProject[] }
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
  const bySettlement: KazanlakCapitalSettlementRollup[] = [...bySettlementAgg]
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

  const out: KazanlakCapitalProgramFile = {
    fiscalYear,
    generatedAt: new Date().toISOString(),
    source: {
      publisher: "Община Казанлък",
      documentTitle: `Проект на инвестиционна програма и текущи ремонти за ${fiscalYear} г. (Приложение №4)`,
      url: SOURCE_URLS[fiscalYear] ?? "",
      fetchedAt: new Date().toISOString(),
      ocrModel: ocr.model,
      ocrGeneratedAt: ocr.generatedAt,
    },
    municipalityCode: "SZR12",
    municipalityNameBg: "Казанлък",
    municipalityNameEn: "Kazanlak",
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
    "kazanlak.json",
  );
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log(
    `[kzn-capital] wrote ${outPath} — ${projects.length} projects, itemised EUR ${(
      itemisedTotal.amountEur / 1_000_000
    ).toFixed(1)}M${
      out.publishedRecap
        ? ` (published recap EUR ${(out.publishedRecap.amountEur / 1_000_000).toFixed(1)}M, ratio ${(itemisedTotal.amount / out.publishedRecap.amount).toFixed(3)})`
        : ""
    }`,
  );
  const tagged = projects.filter((p) => p.settlement !== null).length;
  console.log(
    `[kzn-capital] settlement tagging: ${tagged}/${projects.length} (${(
      (100 * tagged) /
      Math.max(projects.length, 1)
    ).toFixed(0)}%)`,
  );
  console.log("[kzn-capital] top settlements:");
  for (const s of bySettlement.slice(0, 10)) {
    console.log(
      `  ${s.name.padEnd(22)} ${s.projectCount.toString().padStart(2)} proj  EUR ${(s.total.amountEur / 1000).toFixed(0)}k`,
    );
  }
};

main();
