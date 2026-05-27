// Rollup parser for Асеновград's annual капиталова програма — consumes the
// Gemini Vision OCR JSON (raw_data/.../asenovgrad-YYYY-ocr.json) and emits
// an AsenovgradCapitalProgramFile shape (single município, no районi,
// per-village breakdown via "с." / "гр." prefix match).
//
// Asenovgrad obshtina = PDV01, EKATTE 00702. 29 settlements: 1 city +
// 28 villages around Asenovgrad in the Plovdiv oblast.
//
// Run: tsx scripts/budget/capital_programs/asenovgrad.ts [--year 2025]

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BGN_PER_EUR } from "../../../src/lib/currency";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SOURCE_URLS: Record<number, string> = {
  2022: "https://www.asenovgrad.bg/uploads/MyDocuments//raz_kapitalovi-razhodi26042022-1.pdf",
  2023: "https://www.asenovgrad.bg/uploads/MyDocuments//rkr_mv_20092023_oc-21092023.pdf",
  2024: "https://www.asenovgrad.bg/uploads/MyDocuments//rkr_2024_oc-01032024.pdf",
  2025: "https://www.asenovgrad.bg/uploads/MyDocuments//rkr_mv_2025_oc-02052025.pdf",
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

interface AsenovgradCapitalProject {
  id: number;
  name: string;
  settlement: string | null;
  total: Money;
}

interface AsenovgradCapitalSettlementRollup {
  name: string;
  projectCount: number;
  total: Money;
  topProjects: Array<{ id: number; name: string; total: Money }>;
}

interface AsenovgradCapitalProgramFile {
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
  projects: AsenovgradCapitalProject[];
  bySettlement: AsenovgradCapitalSettlementRollup[];
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

// 29 settlements of Община Асеновград (PDV01) — 1 city + 28 villages.
const PDV_SETTLEMENTS: Array<{ name: string; prefix: string }> = [
  { name: "Асеновград", prefix: "гр." },
  { name: "Бачково", prefix: "с." },
  { name: "Боянци", prefix: "с." },
  { name: "Бор", prefix: "с." },
  { name: "Врата", prefix: "с." },
  { name: "Горнослав", prefix: "с." },
  { name: "Добростан", prefix: "с." },
  { name: "Долнослав", prefix: "с." },
  { name: "Жълт камък", prefix: "с." },
  { name: "Златовръх", prefix: "с." },
  { name: "Избеглии", prefix: "с." },
  { name: "Нови извор", prefix: "с." },
  { name: "Козаново", prefix: "с." },
  { name: "Конуш", prefix: "с." },
  { name: "Косово", prefix: "с." },
  { name: "Леново", prefix: "с." },
  { name: "Лясково", prefix: "с." },
  { name: "Мостово", prefix: "с." },
  { name: "Мулдава", prefix: "с." },
  { name: "Нареченски бани", prefix: "с." },
  { name: "Новаково", prefix: "с." },
  { name: "Орешец", prefix: "с." },
  { name: "Патриарх Евтимово", prefix: "с." },
  { name: "Стоево", prefix: "с." },
  { name: "Сини връх", prefix: "с." },
  { name: "Тополово", prefix: "с." },
  { name: "Три могили", prefix: "с." },
  { name: "Узуново", prefix: "с." },
  { name: "Червен", prefix: "с." },
];

const SETTLEMENT_PATTERNS = PDV_SETTLEMENTS.slice()
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
    `asenovgrad-${fiscalYear}-ocr.json`,
  );
  if (!existsSync(ocrPath)) {
    throw new Error(
      `Missing OCR JSON at ${ocrPath} — run asenovgrad_ocr.ts --year ${fiscalYear} first`,
    );
  }
  const ocr: OcrFile = JSON.parse(readFileSync(ocrPath, "utf-8"));
  console.log(
    `[asenovgrad-capital] reading ${ocrPath} (year ${fiscalYear}, ${ocr.projects.length} OCR rows)`,
  );

  const projects: AsenovgradCapitalProject[] = ocr.projects.map((p, i) => ({
    id: i + 1,
    name: p.description.trim(),
    settlement: extractSettlement(p.description),
    total: bgnToMoney(p.amount),
  }));

  const bySettlementAgg = new Map<
    string,
    { total: number; projects: AsenovgradCapitalProject[] }
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
  const bySettlement: AsenovgradCapitalSettlementRollup[] = [...bySettlementAgg]
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

  const out: AsenovgradCapitalProgramFile = {
    fiscalYear,
    generatedAt: new Date().toISOString(),
    source: {
      publisher: "Община Асеновград",
      documentTitle: `Разчет за финансиране на капиталовите разходи ${fiscalYear} г.`,
      url: SOURCE_URLS[fiscalYear] ?? "",
      fetchedAt: new Date().toISOString(),
      ocrModel: ocr.model,
      ocrGeneratedAt: ocr.generatedAt,
    },
    municipalityCode: "PDV01",
    municipalityNameBg: "Асеновград",
    municipalityNameEn: "Asenovgrad",
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
    "asenovgrad.json",
  );
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log(
    `[asenovgrad-capital] wrote ${outPath} — ${projects.length} projects, itemised EUR ${(
      itemisedTotal.amountEur / 1_000_000
    ).toFixed(1)}M${
      out.publishedRecap
        ? ` (published recap EUR ${(out.publishedRecap.amountEur / 1_000_000).toFixed(1)}M)`
        : ""
    }`,
  );
  const tagged = projects.filter((p) => p.settlement !== null).length;
  console.log(
    `[asenovgrad-capital] settlement tagging: ${tagged}/${projects.length} (${(
      (100 * tagged) /
      Math.max(projects.length, 1)
    ).toFixed(0)}%)`,
  );
  console.log("[asenovgrad-capital] top settlements:");
  for (const s of bySettlement.slice(0, 10)) {
    console.log(
      `  ${s.name.padEnd(22)} ${s.projectCount.toString().padStart(2)} proj  EUR ${(s.total.amountEur / 1000).toFixed(0)}k`,
    );
  }
};

main();
