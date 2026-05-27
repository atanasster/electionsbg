// Rollup parser for Самоков's annual капиталова програма. Consumes the
// Gemini Vision OCR JSON and emits a tile-ready SamokovCapitalProgramFile.
//
// Samokov obshtina = SFO39 (Sofia oblast), EKATTE 65231 (the city).
// 28 settlements: city + 27 villages.
//
// Run: tsx scripts/budget/capital_programs/samokov.ts [--year 2025]

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BGN_PER_EUR } from "../../../src/lib/currency";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SOURCE_URLS: Record<number, string> = {
  2025: "https://www.samokov.bg/documents/d/samokov/prilozenie-5",
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

interface SamokovCapitalProject {
  id: number;
  name: string;
  settlement: string | null;
  total: Money;
}

interface SamokovCapitalSettlementRollup {
  name: string;
  projectCount: number;
  total: Money;
  topProjects: Array<{ id: number; name: string; total: Money }>;
}

interface SamokovCapitalProgramFile {
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
  projects: SamokovCapitalProject[];
  bySettlement: SamokovCapitalSettlementRollup[];
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

// 28 settlements of Община Самоков (SFO39).
const SAM_SETTLEMENTS: Array<{ name: string; prefix: "гр." | "с." }> = [
  { name: "Самоков", prefix: "гр." },
  { name: "Алино", prefix: "с." },
  { name: "Бели Искър", prefix: "с." },
  { name: "Белчин", prefix: "с." },
  { name: "Белчински бани", prefix: "с." },
  { name: "Говедарци", prefix: "с." },
  { name: "Горни Окол", prefix: "с." },
  { name: "Гуцал", prefix: "с." },
  { name: "Долни Окол", prefix: "с." },
  { name: "Доспей", prefix: "с." },
  { name: "Драгушиново", prefix: "с." },
  { name: "Злокучене", prefix: "с." },
  { name: "Клисура", prefix: "с." },
  { name: "Ковачевци", prefix: "с." },
  { name: "Лисец", prefix: "с." },
  { name: "Маджаре", prefix: "с." },
  { name: "Мала църква", prefix: "с." },
  { name: "Марица", prefix: "с." },
  { name: "Ново село", prefix: "с." },
  { name: "Поповяне", prefix: "с." },
  { name: "Продановци", prefix: "с." },
  { name: "Радуил", prefix: "с." },
  { name: "Райово", prefix: "с." },
  { name: "Рельово", prefix: "с." },
  { name: "Шипочане", prefix: "с." },
  { name: "Широки дол", prefix: "с." },
  { name: "Яребковица", prefix: "с." },
  { name: "Ярлово", prefix: "с." },
];

const SETTLEMENT_PATTERNS = SAM_SETTLEMENTS.slice()
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
  const fiscalYear = yearIdx >= 0 ? Number(args[yearIdx + 1]) : 2025;

  const ocrPath = resolve(
    __dirname,
    "../../../raw_data/budget/capital_programs",
    `samokov-${fiscalYear}-ocr.json`,
  );
  if (!existsSync(ocrPath)) {
    throw new Error(
      `Missing OCR JSON at ${ocrPath} — run samokov_ocr.ts --year ${fiscalYear} first`,
    );
  }
  const ocr: OcrFile = JSON.parse(readFileSync(ocrPath, "utf-8"));
  console.log(
    `[samokov-capital] reading ${ocrPath} (year ${fiscalYear}, ${ocr.projects.length} OCR rows)`,
  );

  const projects: SamokovCapitalProject[] = ocr.projects.map((p, i) => ({
    id: i + 1,
    name: p.description.trim(),
    settlement: extractSettlement(p.description),
    total: bgnToMoney(p.amount),
  }));

  const bySettlementAgg = new Map<
    string,
    { total: number; projects: SamokovCapitalProject[] }
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
  const bySettlement: SamokovCapitalSettlementRollup[] = [...bySettlementAgg]
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

  const out: SamokovCapitalProgramFile = {
    fiscalYear,
    generatedAt: new Date().toISOString(),
    source: {
      publisher: "Община Самоков",
      documentTitle: `Поименен списък на обектите за строителство, основен ремонт и придобиване на НМДА за ${fiscalYear} г.`,
      url: SOURCE_URLS[fiscalYear] ?? "",
      fetchedAt: new Date().toISOString(),
      ocrModel: ocr.model,
      ocrGeneratedAt: ocr.generatedAt,
    },
    municipalityCode: "SFO39",
    municipalityNameBg: "Самоков",
    municipalityNameEn: "Samokov",
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
    "samokov.json",
  );
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log(
    `[samokov-capital] wrote ${outPath} — ${projects.length} projects, itemised EUR ${(
      itemisedTotal.amountEur / 1_000_000
    ).toFixed(1)}M${
      out.publishedRecap
        ? ` (published recap EUR ${(out.publishedRecap.amountEur / 1_000_000).toFixed(1)}M)`
        : ""
    }`,
  );
  const tagged = projects.filter((p) => p.settlement !== null).length;
  console.log(
    `[samokov-capital] settlement tagging: ${tagged}/${projects.length} (${(
      (100 * tagged) /
      Math.max(projects.length, 1)
    ).toFixed(0)}%)`,
  );
  console.log("[samokov-capital] top settlements:");
  for (const s of bySettlement.slice(0, 10)) {
    console.log(
      `  ${s.name.padEnd(22)} ${s.projectCount.toString().padStart(2)} proj  EUR ${(s.total.amountEur / 1000).toFixed(0)}k`,
    );
  }
};

main();
