// Rollup parser for Габрово's annual "Инвестиционна програма". Consumes
// the Gemini Vision OCR JSON and emits a tile-ready
// GabrovoCapitalProgramFile.
//
// Gabrovo obshtina = GAB05, EKATTE 14218 (the city). 134 settlements:
// the city + 133 villages — the largest village count in the fleet.
//
// Run: tsx scripts/budget/capital_programs/gabrovo.ts [--year 2025]

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BGN_PER_EUR } from "../../../src/lib/currency";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SOURCE_URLS: Record<number, string> = {
  2025: "https://gabrovo.bg/files/budjet2025/izmenenia/20.5.pdf",
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

interface GabrovoCapitalProject {
  id: number;
  name: string;
  settlement: string | null;
  total: Money;
}

interface GabrovoCapitalSettlementRollup {
  name: string;
  projectCount: number;
  total: Money;
  topProjects: Array<{ id: number; name: string; total: Money }>;
}

interface GabrovoCapitalProgramFile {
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
  projects: GabrovoCapitalProject[];
  bySettlement: GabrovoCapitalSettlementRollup[];
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

// 134 settlements of Община Габрово (GAB05). Generated from
// data/settlements.json.
const GAB_SETTLEMENTS: Array<{ name: string; prefix: "гр." | "с." }> = [
  { name: "Габрово", prefix: "гр." },
  { name: "Ангелов", prefix: "с." },
  { name: "Армените", prefix: "с." },
  { name: "Баевци", prefix: "с." },
  { name: "Баланите", prefix: "с." },
  { name: "Балиновци", prefix: "с." },
  { name: "Банковци", prefix: "с." },
  { name: "Бекриите", prefix: "с." },
  { name: "Беломъжите", prefix: "с." },
  { name: "Бобевци", prefix: "с." },
  { name: "Богданчовци", prefix: "с." },
  { name: "Боженците", prefix: "с." },
  { name: "Бойновци", prefix: "с." },
  { name: "Болтата", prefix: "с." },
  { name: "Борики", prefix: "с." },
  { name: "Борското", prefix: "с." },
  { name: "Брънеците", prefix: "с." },
  { name: "Бялково", prefix: "с." },
  { name: "Бойчета", prefix: "с." },
  { name: "Велковци", prefix: "с." },
  { name: "Ветрово", prefix: "с." },
  { name: "Влайчовци", prefix: "с." },
  { name: "Влаховци", prefix: "с." },
  { name: "Врабците", prefix: "с." },
  { name: "Враниловци", prefix: "с." },
  { name: "Вълков дол", prefix: "с." },
  { name: "Гайкини", prefix: "с." },
  { name: "Гайтаните", prefix: "с." },
  { name: "Гарван", prefix: "с." },
  { name: "Геновци", prefix: "с." },
  { name: "Генчовци", prefix: "с." },
  { name: "Гергини", prefix: "с." },
  { name: "Гледаци", prefix: "с." },
  { name: "Горнова могила", prefix: "с." },
  { name: "Гръблевци", prefix: "с." },
  { name: "Гъбене", prefix: "с." },
  { name: "Дебел дял", prefix: "с." },
  { name: "Джумриите", prefix: "с." },
  { name: "Дивеци", prefix: "с." },
  { name: "Донино", prefix: "с." },
  { name: "Драгановци", prefix: "с." },
  { name: "Драганчетата", prefix: "с." },
  { name: "Драгиевци", prefix: "с." },
  { name: "Драгомани", prefix: "с." },
  { name: "Думници", prefix: "с." },
  { name: "Езерото", prefix: "с." },
  { name: "Живко", prefix: "с." },
  { name: "Жълтеш", prefix: "с." },
  { name: "Здравковец", prefix: "с." },
  { name: "Зелено дърво", prefix: "с." },
  { name: "Златевци", prefix: "с." },
  { name: "Иванили", prefix: "с." },
  { name: "Иванковци", prefix: "с." },
  { name: "Иглика", prefix: "с." },
  { name: "Източник", prefix: "с." },
  { name: "Калчовци", prefix: "с." },
  { name: "Камещица", prefix: "с." },
  { name: "Карали", prefix: "с." },
  { name: "Киевци", prefix: "с." },
  { name: "Кметовци", prefix: "с." },
  { name: "Кметчета", prefix: "с." },
  { name: "Кози рог", prefix: "с." },
  { name: "Колишовци", prefix: "с." },
  { name: "Копчелиите", prefix: "с." },
  { name: "Костадините", prefix: "с." },
  { name: "Костенковци", prefix: "с." },
  { name: "Лесичарка", prefix: "с." },
  { name: "Лоза", prefix: "с." },
  { name: "Малини", prefix: "с." },
  { name: "Междени", prefix: "с." },
  { name: "Мечковица", prefix: "с." },
  { name: "Милковци", prefix: "с." },
  { name: "Михайловци", prefix: "с." },
  { name: "Мичковци", prefix: "с." },
  { name: "Моровеците", prefix: "с." },
  { name: "Мрахори", prefix: "с." },
  { name: "Музга", prefix: "с." },
  { name: "Малуша", prefix: "с." },
  { name: "Николчовци", prefix: "с." },
  { name: "Новаковци", prefix: "с." },
  { name: "Овощарци", prefix: "с." },
  { name: "Орловци", prefix: "с." },
  { name: "Парчовци", prefix: "с." },
  { name: "Пейовци", prefix: "с." },
  { name: "Пенковци", prefix: "с." },
  { name: "Петровци", prefix: "с." },
  { name: "Пецовци", prefix: "с." },
  { name: "Попари", prefix: "с." },
  { name: "Поповци", prefix: "с." },
  { name: "Прахали", prefix: "с." },
  { name: "Пъртевци", prefix: "с." },
  { name: "Продановци", prefix: "с." },
  { name: "Поток", prefix: "с." },
  { name: "Райновци", prefix: "с." },
  { name: "Раховци", prefix: "с." },
  { name: "Рачевци", prefix: "с." },
  { name: "Редешковци", prefix: "с." },
  { name: "Руйчовци", prefix: "с." },
  { name: "Рязковци", prefix: "с." },
  { name: "Свинарски дол", prefix: "с." },
  { name: "Седянковци", prefix: "с." },
  { name: "Сейковци", prefix: "с." },
  { name: "Семерджиите", prefix: "с." },
  { name: "Смиловци", prefix: "с." },
  { name: "Солари", prefix: "с." },
  { name: "Спанци", prefix: "с." },
  { name: "Спасовци", prefix: "с." },
  { name: "Старилковци", prefix: "с." },
  { name: "Стефаново", prefix: "с." },
  { name: "Стоевци", prefix: "с." },
  { name: "Стойчовци", prefix: "с." },
  { name: "Стоманеците", prefix: "с." },
  { name: "Съботковци", prefix: "с." },
  { name: "Стойковци", prefix: "с." },
  { name: "Тодоровци", prefix: "с." },
  { name: "Торбалъжите", prefix: "с." },
  { name: "Трапесковци", prefix: "с." },
  { name: "Трънито", prefix: "с." },
  { name: "Узуните", prefix: "с." },
  { name: "Фърговци", prefix: "с." },
  { name: "Харачерите", prefix: "с." },
  { name: "Цвятковци", prefix: "с." },
  { name: "Чавеи", prefix: "с." },
  { name: "Черневци", prefix: "с." },
  { name: "Читаковци", prefix: "с." },
  { name: "Тодорчета", prefix: "с." },
  { name: "Чукилите", prefix: "с." },
  { name: "Чарково", prefix: "с." },
  { name: "Червена локва", prefix: "с." },
  { name: "Шарани", prefix: "с." },
  { name: "Шипчените", prefix: "с." },
  { name: "Яворец", prefix: "с." },
  { name: "Янковци", prefix: "с." },
  { name: "Ясените", prefix: "с." },
];

const SETTLEMENT_PATTERNS = GAB_SETTLEMENTS.slice()
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
    `gabrovo-${fiscalYear}-ocr.json`,
  );
  if (!existsSync(ocrPath)) {
    throw new Error(
      `Missing OCR JSON at ${ocrPath} — run gabrovo_ocr.ts --year ${fiscalYear} first`,
    );
  }
  const ocr: OcrFile = JSON.parse(readFileSync(ocrPath, "utf-8"));
  console.log(
    `[gabrovo-capital] reading ${ocrPath} (year ${fiscalYear}, ${ocr.projects.length} OCR rows)`,
  );

  const projects: GabrovoCapitalProject[] = ocr.projects.map((p, i) => ({
    id: i + 1,
    name: p.description.trim(),
    settlement: extractSettlement(p.description),
    total: bgnToMoney(p.amount),
  }));

  const bySettlementAgg = new Map<
    string,
    { total: number; projects: GabrovoCapitalProject[] }
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
  const bySettlement: GabrovoCapitalSettlementRollup[] = [...bySettlementAgg]
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

  const out: GabrovoCapitalProgramFile = {
    fiscalYear,
    generatedAt: new Date().toISOString(),
    source: {
      publisher: "Община Габрово",
      documentTitle: `Приложение №5 — Инвестиционна програма на Община Габрово за ${fiscalYear} г. (актуализация)`,
      url: SOURCE_URLS[fiscalYear] ?? "",
      fetchedAt: new Date().toISOString(),
      ocrModel: ocr.model,
      ocrGeneratedAt: ocr.generatedAt,
    },
    municipalityCode: "GAB05",
    municipalityNameBg: "Габрово",
    municipalityNameEn: "Gabrovo",
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
    "gabrovo.json",
  );
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log(
    `[gabrovo-capital] wrote ${outPath} — ${projects.length} projects, itemised EUR ${(
      itemisedTotal.amountEur / 1_000_000
    ).toFixed(1)}M${
      out.publishedRecap
        ? ` (published recap EUR ${(out.publishedRecap.amountEur / 1_000_000).toFixed(1)}M)`
        : ""
    }`,
  );
  const tagged = projects.filter((p) => p.settlement !== null).length;
  console.log(
    `[gabrovo-capital] settlement tagging: ${tagged}/${projects.length} (${(
      (100 * tagged) /
      Math.max(projects.length, 1)
    ).toFixed(0)}%)`,
  );
  console.log("[gabrovo-capital] top settlements:");
  for (const s of bySettlement.slice(0, 10)) {
    console.log(
      `  ${s.name.padEnd(22)} ${s.projectCount.toString().padStart(2)} proj  EUR ${(s.total.amountEur / 1000).toFixed(0)}k`,
    );
  }
};

main();
