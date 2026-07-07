// Generator: write data/budget/nzok/budget.json — the НЗОК (National Health
// Insurance Fund, EIK 121858220) annual budget-law breakdown that powers the
// health pack's "Къде отиват €5,5 млрд." bridge tile.
//
// This is HAND-KEYED source data (the annual Закон за бюджета на НЗОК / ЗБНЗОК),
// not a scrape — the law is a PDF table published once a year, so a small
// generator that encodes the published lines + does the BGN→EUR conversion in
// one place is the honest, re-runnable form (mirrors the capital-programs
// __write_*.ts convention). To add a year: append a YEAR entry below and re-run
//   tsx scripts/budget/nzok/__write_budget.ts
//
// Vite's serve-data-dir middleware mounts data/ at the dev root, so the output
// is served at /budget/nzok/budget.json (see src/data/budget/useBudget.tsx).
//
// Sources:
//  - ЗБНЗОК 2026 (проект, приет от Надзорния съвет 29.10.2025) — figures already
//    in EUR (thousand EUR). nhif.bg/upload/29401.
//  - ЗБНЗОК 2025 (обн. ДВ) — figures in thousand BGN; converted at the fixed
//    rate 1 EUR = 1.95583 BGN. czpz.org / nra.bg.
//
// Each year lists the health-insurance-payment (care) lines + the administrative
// lines explicitly; the RESERVE line is computed as the residual to the headline
// total (reserve + central-budget transfers + capital), so the composition bar
// always reconciles to totalExpenditure and we never assert a reserve figure we
// can't source line-for-line.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { toEur } from "../../../src/lib/currency";
import type {
  Money,
  NzokBudgetFile,
  NzokBudgetLine,
  NzokBudgetYear,
  NzokBudgetGroup,
} from "../types";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OUT_FILE = path.resolve(
  __dirname,
  "../../../data/budget/nzok/budget.json",
);

// A source line: value in THOUSANDS of the year's currency-of-record.
type LineDef = {
  id: string;
  group: Extract<NzokBudgetGroup, "care" | "admin">;
  bg: string;
  en: string;
  k: number; // thousands
};

type YearDef = {
  fiscalYear: number;
  basis: "law" | "draft";
  currency: "BGN" | "EUR";
  totalK: number; // thousands, currency-of-record
  lines: LineDef[]; // care + admin only; reserve is the residual
};

const YEARS: YearDef[] = [
  {
    fiscalYear: 2026,
    basis: "draft",
    currency: "EUR",
    totalK: 5_537_996.9,
    lines: [
      {
        id: "hospital",
        group: "care",
        bg: "Болнична медицинска помощ",
        en: "Hospital care",
        k: 2_359_887.3,
      },
      {
        id: "drugs",
        group: "care",
        bg: "Лекарства, медицински изделия и храни",
        en: "Drugs, devices & foods",
        k: 1_332_089.4,
      },
      {
        id: "specialist",
        group: "care",
        bg: "Специализирана извънболнична помощ (СИМП)",
        en: "Specialist outpatient care",
        k: 352_495.7,
      },
      {
        id: "gp",
        group: "care",
        bg: "Първична извънболнична помощ (ПИМП)",
        en: "Primary care (GPs)",
        k: 349_292.1,
      },
      {
        id: "dental",
        group: "care",
        bg: "Дентална помощ",
        en: "Dental care",
        k: 233_511.1,
      },
      {
        id: "diagnostics",
        group: "care",
        bg: "Медико-диагностична дейност",
        en: "Medical diagnostics",
        k: 167_490.4,
      },
      {
        id: "devices_hospital",
        group: "care",
        bg: "Медицински изделия в болничната помощ",
        en: "Medical devices in hospital care",
        k: 114_587.8,
      },
      {
        id: "other_care",
        group: "care",
        bg: "Други здравноосигурителни плащания",
        en: "Other health payments",
        k: 42_863.5,
      },
      {
        id: "personnel",
        group: "admin",
        bg: "Персонал",
        en: "Personnel",
        k: 51_630.3,
      },
      {
        id: "operations",
        group: "admin",
        bg: "Издръжка на администрацията",
        en: "Administrative operations",
        k: 18_002.6,
      },
    ],
  },
  {
    fiscalYear: 2025,
    basis: "law",
    currency: "BGN",
    totalK: 9_474_716.2,
    lines: [
      {
        id: "hospital",
        group: "care",
        bg: "Болнична медицинска помощ",
        en: "Hospital care",
        k: 4_155_279.6,
      },
      {
        id: "drugs",
        group: "care",
        bg: "Лекарства, медицински изделия и храни",
        en: "Drugs, devices & foods",
        k: 2_368_531.1,
      },
      {
        id: "specialist",
        group: "care",
        bg: "Специализирана извънболнична помощ (СИМП)",
        en: "Specialist outpatient care",
        k: 658_218.6,
      },
      {
        id: "gp",
        group: "care",
        bg: "Първична извънболнична помощ (ПИМП)",
        en: "Primary care (GPs)",
        k: 647_577.6,
      },
      {
        id: "dental",
        group: "care",
        bg: "Дентална помощ",
        en: "Dental care",
        k: 416_466.2,
      },
      {
        id: "diagnostics",
        group: "care",
        bg: "Медико-диагностична дейност",
        en: "Medical diagnostics",
        k: 303_859.4,
      },
      {
        id: "devices_hospital",
        group: "care",
        bg: "Медицински изделия в болничната помощ",
        en: "Medical devices in hospital care",
        k: 207_342.1,
      },
      {
        id: "other_care",
        group: "care",
        bg: "Други здравноосигурителни плащания",
        en: "Other health payments",
        k: 116_604.3,
      },
      {
        id: "personnel",
        group: "admin",
        bg: "Персонал",
        en: "Personnel",
        k: 91_802.7,
      },
      {
        id: "operations",
        group: "admin",
        bg: "Издръжка на администрацията",
        en: "Administrative operations",
        k: 35_210.0,
      },
    ],
  },
];

const money = (k: number, currency: "BGN" | "EUR"): Money => {
  const amount = Math.round(k * 1000);
  const amountEur =
    currency === "EUR" ? amount : Math.round(toEur(amount, "BGN") ?? 0);
  return { amount, amountEur, currency };
};

const buildYear = (def: YearDef): NzokBudgetYear => {
  const lines: NzokBudgetLine[] = def.lines.map((l) => ({
    id: l.id,
    group: l.group,
    bg: l.bg,
    en: l.en,
    amount: money(l.k, def.currency),
  }));
  // Reserve = residual to the headline (reserve + central-budget transfers +
  // capital). Computed in the currency-of-record so it reconciles exactly. A
  // negative residual beyond rounding means the named lines were hand-keyed to
  // exceed the total — surface it rather than silently clamp reserve to 0.
  const namedK = def.lines.reduce((s, l) => s + l.k, 0);
  if (def.totalK - namedK < -1)
    throw new Error(
      `${def.fiscalYear}: named lines (${namedK}) exceed total (${def.totalK}) — check the ЗБНЗОК figures`,
    );
  const reserveK = Math.max(0, def.totalK - namedK);
  lines.push({
    id: "reserve",
    group: "reserve",
    bg: "Резерв, трансфери и капиталови разходи",
    en: "Reserve, transfers & capital",
    amount: money(reserveK, def.currency),
  });
  return {
    fiscalYear: def.fiscalYear,
    basis: def.basis,
    currencyOfRecord: def.currency,
    totalExpenditure: money(def.totalK, def.currency),
    lines,
  };
};

const main = (): void => {
  const years = YEARS.map(buildYear).sort(
    (a, b) => b.fiscalYear - a.fiscalYear,
  );
  const file: NzokBudgetFile = {
    generatedAt: new Date().toISOString(),
    source: {
      publisher: "Национална здравноосигурителна каса (НЗОК)",
      law: "Закон за бюджета на НЗОК (ЗБНЗОК)",
      url: "https://www.nhif.bg/bg/completion-reports",
      description:
        "Годишни разходни линии от Закона за бюджета на НЗОК. 2026 — проект (приет от Надзора 29.10.2025), суми в евро; 2025 — обн. закон, суми в лева, конвертирани при 1 EUR = 1.95583 BGN. Редът „Резерв, трансфери и капиталови разходи“ е остатък до общия разход.",
    },
    latestYear: years[0].fiscalYear,
    years,
  };
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(file, null, 2));
  // Reconciliation echo — the composition must sum to the headline.
  for (const y of years) {
    const sum = y.lines.reduce((s, l) => s + l.amount.amountEur, 0);
    const head = y.totalExpenditure.amountEur;
    const drift = sum - head;

    console.log(
      `${y.fiscalYear} (${y.basis}): total €${head.toLocaleString("en")} · lines Σ €${sum.toLocaleString("en")} · drift €${drift}`,
    );
  }

  console.log(`\nWrote ${OUT_FILE}`);
};

main();
