// Generator: write data/budget/nzok/budget.json — the НЗОК (National Health
// Insurance Fund, EIK 121858220) annual budget-law breakdown that powers the
// health pack's "Къде отиват парите на НЗОК" bridge tile.
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
//  - ЗБНЗОК 2026 (обн. ДВ бр. 68 от 28.07.2026, idMat 244981) — чл. 1, ал. 2;
//    figures already in EUR (thousand EUR).
//  - ЗБНЗОК 2025 (обн. ДВ) — figures in thousand BGN; converted at the fixed
//    rate 1 EUR = 1.95583 BGN. czpz.org / nra.bg.
//
// Each year lists the health-insurance-payment (care) lines + the administrative
// lines explicitly; the RESERVE line is computed as the residual to the headline
// total (reserve + central-budget transfers + capital), so the composition bar
// always reconciles to totalExpenditure and we never assert a reserve figure we
// can't source line-for-line.
//
// KEY EVERY LINE FROM ITS чл. 1 ал. 2 CODE, NOT ITS LABEL. The 2026 figures were
// first transcribed by label and two errors followed, together worth €146.1M:
// line 1.1.3.6 was missed entirely, and `hospital` was taken from the SUB-line
// 1.1.3.7.1 „Дейности“ (2,307,171.5) instead of its parent 1.1.3.7 (2,341,939.3,
// which also carries the two 17,383.9 medical-personnel sub-lines). Both numbers
// are real numbers in the law — just at the wrong depth — so nothing but the
// residual assertion below catches the mistake. `lawCode` on each line and the
// required `expectedResidualK` check exist to keep that from recurring.
//
// `hospital` is matched PARENT-TO-PARENT with the 2026 Надзор draft's 2,359,887.3
// (the figure this file carried before the law landed — see git history for the
// pre-2026-07-29 YEARS[0]). The draft's own basis cannot be verified from the
// promulgated text, so re-check that assumption before trusting any
// draft-vs-law delta.

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
  /** The чл. 1 ал. 2 code this figure is taken from. Emitted into the artifact
   *  so a wrong-DEPTH transcription is reviewable in the diff, not just in the
   *  source. */
  lawCode?: string;
};

/** The residual the named lines must leave. `"unsourced"` is a deliberate,
 *  greppable opt-out for a year whose law we have not broken down — NOT a
 *  default. Making this required is the point: the guard it drives is the only
 *  thing that catches an UNDER-keyed table, and an optional guard protects
 *  exactly the years someone remembered to protect. */
type ResidualExpectation = number | "unsourced";

type YearDef = {
  fiscalYear: number;
  basis: "law" | "draft";
  currency: "BGN" | "EUR";
  totalK: number; // thousands, currency-of-record
  lines: LineDef[]; // care + admin only; reserve is the residual
  expectedResidualK: ResidualExpectation;
};

export const YEARS: YearDef[] = [
  {
    // ЗБНЗОК 2026, обн. ДВ бр. 68 от 28.07.2026 (idMat 244981), чл. 1 ал. 2.
    // Balanced budget: I. ПРИХОДИ = II. РАЗХОДИ = 5,256,677.2k.
    // Residual = 1.2 нефинансови активи 2,068.7 + 1.3 резерв 154,148.1
    //          + 1.1.4 трансфери от МЗ 101,490.7 = 257,707.5k.
    fiscalYear: 2026,
    basis: "law",
    currency: "EUR",
    totalK: 5_256_677.2,
    expectedResidualK: 257_707.5,
    lines: [
      {
        id: "hospital",
        group: "care",
        bg: "Болнична медицинска помощ",
        en: "Hospital care",
        // PARENT 1.1.3.7 — includes .7.1 дейности 2,307,171.5 and the two
        // 17,383.9 медицински персонал sub-lines. NOT 1.1.3.7.1.
        k: 2_341_939.3,
        lawCode: "1.1.3.7",
      },
      {
        id: "drugs",
        group: "care",
        bg: "Лекарства, медицински изделия и храни",
        en: "Drugs, devices & foods",
        // Of which ПЛС (1.1.3.5.4) 1,264,322.9 = референтни и специални
        // 1,136,682.8 + генерични 127,640.1 — a 90/10 split we hold but do not
        // surface yet (docs/plans/budget-package-2026-ingest-v1.md, T1.1a).
        k: 1_334_348.5,
        lawCode: "1.1.3.5",
      },
      {
        id: "specialist",
        group: "care",
        bg: "Специализирана извънболнична помощ (СИМП)",
        en: "Specialist outpatient care",
        k: 351_246.0,
        lawCode: "1.1.3.2",
      },
      {
        id: "gp",
        group: "care",
        bg: "Първична извънболнична помощ (ПИМП)",
        en: "Primary care (GPs)",
        k: 345_609.8,
        lawCode: "1.1.3.1",
      },
      {
        id: "dental",
        group: "care",
        bg: "Дентална помощ",
        en: "Dental care",
        k: 231_049.4,
        lawCode: "1.1.3.3",
      },
      {
        id: "diagnostics",
        group: "care",
        bg: "Медико-диагностична дейност",
        en: "Medical diagnostics",
        k: 168_254.3,
        lawCode: "1.1.3.4",
      },
      {
        id: "devices_hospital",
        group: "care",
        bg: "Медицински изделия в болничната помощ",
        en: "Medical devices in hospital care",
        // The line the first transcription dropped entirely.
        k: 111_338.2,
        lawCode: "1.1.3.6",
      },
      {
        id: "other_care",
        group: "care",
        bg: "Други здравноосигурителни плащания",
        en: "Other health payments",
        k: 49_317.3,
        lawCode: "1.1.3.8",
      },
      {
        id: "personnel",
        group: "admin",
        bg: "Персонал",
        en: "Personnel",
        k: 48_157.8,
        lawCode: "1.1.1",
      },
      {
        id: "operations",
        group: "admin",
        bg: "Издръжка на администрацията",
        en: "Administrative operations",
        k: 17_709.1,
        lawCode: "1.1.2",
      },
    ],
  },
  {
    fiscalYear: 2025,
    basis: "law",
    currency: "BGN",
    totalK: 9_474_716.2,
    // The 2025 law's residual has never been broken into its резерв / капитал /
    // МЗ-трансфери components here, so there is nothing to assert against. This
    // year is therefore UNPROTECTED against the missing-line class — break it
    // down from the ЗБНЗОК-2025 text and replace this with the number.
    expectedResidualK: "unsourced",
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

export const buildYear = (def: YearDef): NzokBudgetYear => {
  const lines: NzokBudgetLine[] = def.lines.map((l) => ({
    id: l.id,
    group: l.group,
    bg: l.bg,
    en: l.en,
    amount: money(l.k, def.currency),
    ...(l.lawCode ? { lawCode: l.lawCode } : {}),
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
  // The overshoot throw above only fires on OVER-keying. An UNDER-keyed table —
  // a missing line, or a figure taken from a sub-line instead of its parent —
  // reconciles perfectly and silently inflates the reserve bar by the shortfall.
  // When the law states the residual's components, assert it.
  if (def.expectedResidualK === "unsourced") {
    console.warn(
      `  ⚠ ${def.fiscalYear}: residual ${reserveK.toFixed(1)}k is UNVERIFIED ` +
        `(expectedResidualK: "unsourced"). A missing or wrong-depth line would ` +
        `land here silently — break the law's residual down and pin it.`,
    );
  } else {
    const drift = reserveK - def.expectedResidualK;
    if (Math.abs(drift) > 0.05)
      throw new Error(
        `${def.fiscalYear}: residual ${reserveK.toFixed(1)}k != expected ` +
          `${def.expectedResidualK.toFixed(1)}k (drift ${drift.toFixed(1)}k) — ` +
          `a named line is missing or keyed from the wrong чл. 1 ал. 2 level`,
      );
  }
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
        "Годишни разходни линии от Закона за бюджета на НЗОК. 2026 — обн. закон (ДВ бр. 68 от 28.07.2026), суми в евро; 2025 — обн. закон, суми в лева, конвертирани при 1 EUR = 1.95583 BGN. Редът „Резерв, трансфери и капиталови разходи“ е остатък до общия разход.",
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

// Guarded so the smoke test can import YEARS/buildYear without writing the
// artifact as a side effect.
if (
  process.argv[1] &&
  import.meta.url.endsWith(path.basename(process.argv[1]))
) {
  main();
}
