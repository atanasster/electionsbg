// Rollup parser for Кърджали's annual капиталова програма. Consumes
// the Gemini Vision OCR JSON and emits a tile-ready
// KardzhaliCapitalProgramFile.
//
// Kardzhali obshtina = KRZ16, EKATTE 40909 (the city). 118 settlements:
// city + 117 villages.
//
// Run: tsx scripts/budget/capital_programs/kardzhali.ts [--year 2025]

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BGN_PER_EUR } from "../../../src/lib/currency";
import { restoreAcronyms } from "../../lib/normalize_name";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SOURCE_URLS: Record<number, string> = {
  2024: "https://kardjali.bg/docs/obs_docs/Pril_1_Kapiit_razhodi.pdf",
  2025: "https://kardjali.bg/news_docs/news_docs_20250417-022937.pdf",
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

interface KardzhaliCapitalProject {
  id: number;
  name: string;
  settlement: string | null;
  total: Money;
}

interface KardzhaliCapitalSettlementRollup {
  name: string;
  projectCount: number;
  total: Money;
  topProjects: Array<{ id: number; name: string; total: Money }>;
}

interface KardzhaliCapitalProgramFile {
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
  projects: KardzhaliCapitalProject[];
  bySettlement: KardzhaliCapitalSettlementRollup[];
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

// 118 settlements of Община Кърджали (KRZ16). City first, then 117
// villages. Generated from data/settlements.json.
const KRJ_SETTLEMENTS: Array<{ name: string; prefix: "гр." | "с." }> = [
  { name: "Кърджали", prefix: "гр." },
  { name: "Айрово", prefix: "с." },
  { name: "Багра", prefix: "с." },
  { name: "Бащино", prefix: "с." },
  { name: "Бели пласт", prefix: "с." },
  { name: "Бленика", prefix: "с." },
  { name: "Божак", prefix: "с." },
  { name: "Бойно", prefix: "с." },
  { name: "Болярци", prefix: "с." },
  { name: "Брош", prefix: "с." },
  { name: "Бяла поляна", prefix: "с." },
  { name: "Бялка", prefix: "с." },
  { name: "Велешани", prefix: "с." },
  { name: "Висока", prefix: "с." },
  { name: "Висока поляна", prefix: "с." },
  { name: "Вишеград", prefix: "с." },
  { name: "Воловарци", prefix: "с." },
  { name: "Върбенци", prefix: "с." },
  { name: "Главатарци", prefix: "с." },
  { name: "Глухар", prefix: "с." },
  { name: "Гняздово", prefix: "с." },
  { name: "Голяма бара", prefix: "с." },
  { name: "Горна крепост", prefix: "с." },
  { name: "Гъсково", prefix: "с." },
  { name: "Добриново", prefix: "с." },
  { name: "Долище", prefix: "с." },
  { name: "Долна крепост", prefix: "с." },
  { name: "Дъждино", prefix: "с." },
  { name: "Дъждовница", prefix: "с." },
  { name: "Дънгово", prefix: "с." },
  { name: "Енчец", prefix: "с." },
  { name: "Жинзифово", prefix: "с." },
  { name: "Житарник", prefix: "с." },
  { name: "Зайчино", prefix: "с." },
  { name: "Звезделина", prefix: "с." },
  { name: "Звезден", prefix: "с." },
  { name: "Звиница", prefix: "с." },
  { name: "Звъника", prefix: "с." },
  { name: "Звънче", prefix: "с." },
  { name: "Зелениково", prefix: "с." },
  { name: "Зимзелен", prefix: "с." },
  { name: "Зорница", prefix: "с." },
  { name: "Иванци", prefix: "с." },
  { name: "Илиница", prefix: "с." },
  { name: "Невестино", prefix: "с." },
  { name: "Калинка", prefix: "с." },
  { name: "Калоянци", prefix: "с." },
  { name: "Каменарци", prefix: "с." },
  { name: "Кобиляне", prefix: "с." },
  { name: "Кокиче", prefix: "с." },
  { name: "Кокошане", prefix: "с." },
  { name: "Конево", prefix: "с." },
  { name: "Костино", prefix: "с." },
  { name: "Крайно село", prefix: "с." },
  { name: "Крин", prefix: "с." },
  { name: "Крушевска", prefix: "с." },
  { name: "Крушка", prefix: "с." },
  { name: "Кьосево", prefix: "с." },
  { name: "Лисиците", prefix: "с." },
  { name: "Лъвово", prefix: "с." },
  { name: "Люляково", prefix: "с." },
  { name: "Майсторово", prefix: "с." },
  { name: "Македонци", prefix: "с." },
  { name: "Мартино", prefix: "с." },
  { name: "Миладиново", prefix: "с." },
  { name: "Мост", prefix: "с." },
  { name: "Мургово", prefix: "с." },
  { name: "Мъдрец", prefix: "с." },
  { name: "Ненково", prefix: "с." },
  { name: "Опълченско", prefix: "с." },
  { name: "Орешница", prefix: "с." },
  { name: "Островица", prefix: "с." },
  { name: "Охлювец", prefix: "с." },
  { name: "Панчево", prefix: "с." },
  { name: "Пеньово", prefix: "с." },
  { name: "Пепелище", prefix: "с." },
  { name: "Перперек", prefix: "с." },
  { name: "Петлино", prefix: "с." },
  { name: "Повет", prefix: "с." },
  { name: "Прилепци", prefix: "с." },
  { name: "Пропаст", prefix: "с." },
  { name: "Пъдарци", prefix: "с." },
  { name: "Рани лист", prefix: "с." },
  { name: "Резбарци", prefix: "с." },
  { name: "Ридово", prefix: "с." },
  { name: "Рудина", prefix: "с." },
  { name: "Сватбаре", prefix: "с." },
  { name: "Севдалина", prefix: "с." },
  { name: "Седловина", prefix: "с." },
  { name: "Сестринско", prefix: "с." },
  { name: "Сипей", prefix: "с." },
  { name: "Скалище", prefix: "с." },
  { name: "Скална глава", prefix: "с." },
  { name: "Скърбино", prefix: "с." },
  { name: "Снежинка", prefix: "с." },
  { name: "Соколско", prefix: "с." },
  { name: "Соколяне", prefix: "с." },
  { name: "Солище", prefix: "с." },
  { name: "Срединка", prefix: "с." },
  { name: "Старо място", prefix: "с." },
  { name: "Стражевци", prefix: "с." },
  { name: "Страхил войвода", prefix: "с." },
  { name: "Стремово", prefix: "с." },
  { name: "Стремци", prefix: "с." },
  { name: "Татково", prefix: "с." },
  { name: "Тополчане", prefix: "с." },
  { name: "Три могили", prefix: "с." },
  { name: "Ходжовци", prefix: "с." },
  { name: "Царевец", prefix: "с." },
  { name: "Чеганци", prefix: "с." },
  { name: "Черешица", prefix: "с." },
  { name: "Черна скала", prefix: "с." },
  { name: "Черньовци", prefix: "с." },
  { name: "Чилик", prefix: "с." },
  { name: "Чифлик", prefix: "с." },
  { name: "Широко поле", prefix: "с." },
  { name: "Яребица", prefix: "с." },
  { name: "Ястреб", prefix: "с." },
];

const SETTLEMENT_PATTERNS = KRJ_SETTLEMENTS.slice()
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
    `kardzhali-${fiscalYear}-ocr.json`,
  );
  if (!existsSync(ocrPath)) {
    throw new Error(
      `Missing OCR JSON at ${ocrPath} — run kardzhali_ocr.ts --year ${fiscalYear} first`,
    );
  }
  const ocr: OcrFile = JSON.parse(readFileSync(ocrPath, "utf-8"));
  console.log(
    `[kardzhali-capital] reading ${ocrPath} (year ${fiscalYear}, ${ocr.projects.length} OCR rows)`,
  );

  const projects: KardzhaliCapitalProject[] = ocr.projects.map((p, i) => ({
    id: i + 1,
    // Gemini OCR title-cases acronyms it doesn't recognise (УПИ→Упи,
    // СМР→Смр, ППР→Ппр, ПУП→Пуп) — restore them.
    name: restoreAcronyms(p.description.trim()),
    settlement: extractSettlement(p.description),
    total: bgnToMoney(p.amount),
  }));

  const bySettlementAgg = new Map<
    string,
    { total: number; projects: KardzhaliCapitalProject[] }
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
  const bySettlement: KardzhaliCapitalSettlementRollup[] = [...bySettlementAgg]
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

  const out: KardzhaliCapitalProgramFile = {
    fiscalYear,
    generatedAt: new Date().toISOString(),
    source: {
      publisher: "Община Кърджали",
      documentTitle: `Разчет за финансиране на капиталовите разходи на Община Кърджали за ${fiscalYear} г.`,
      url: SOURCE_URLS[fiscalYear] ?? "https://kardjali.bg/",
      fetchedAt: new Date().toISOString(),
      ocrModel: ocr.model,
      ocrGeneratedAt: ocr.generatedAt,
    },
    municipalityCode: "KRZ16",
    municipalityNameBg: "Кърджали",
    municipalityNameEn: "Kardzhali",
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
    "kardzhali.json",
  );
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log(
    `[kardzhali-capital] wrote ${outPath} — ${projects.length} projects, itemised EUR ${(
      itemisedTotal.amountEur / 1_000_000
    ).toFixed(1)}M${
      out.publishedRecap
        ? ` (published recap EUR ${(out.publishedRecap.amountEur / 1_000_000).toFixed(1)}M)`
        : ""
    }`,
  );
  const tagged = projects.filter((p) => p.settlement !== null).length;
  console.log(
    `[kardzhali-capital] settlement tagging: ${tagged}/${projects.length} (${(
      (100 * tagged) /
      Math.max(projects.length, 1)
    ).toFixed(0)}%)`,
  );
  console.log("[kardzhali-capital] top settlements:");
  for (const s of bySettlement.slice(0, 10)) {
    console.log(
      `  ${s.name.padEnd(22)} ${s.projectCount.toString().padStart(2)} proj  EUR ${(s.total.amountEur / 1000).toFixed(0)}k`,
    );
  }
};

main();
