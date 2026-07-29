// Generator: write data/budget/noi/fund_plan.json — the per-fund PLAN side of
// the ДОО budget, from the annual Закон за бюджета на държавното обществено
// осигуряване (ЗБДОО). Sits beside funds.json, which is the cash-execution
// (ACTUAL) side parsed from НОИ's monthly B1 reports.
//
// HAND-KEYED source data, like nzok/__write_budget.ts: the law publishes чл. 1–8
// as a table in Държавен вестник, once a year. To add a year: append a YEAR
// entry below and re-run
//   tsx scripts/budget/noi/__write_fund_plan.ts
//
// Vite's serve-data-dir middleware mounts data/ at the dev root, so the output
// is served at /budget/noi/fund_plan.json (see src/data/budget/useBudget.tsx).
//
// ─────────────────────────────────────────────────────────────────────────────
// THE BASIS CAVEAT, which governs how this may be rendered:
//
// The чл. 1 headline is a GROSS ARITHMETIC SUM of the per-fund lines, NOT a
// consolidated total. The seven fund figures add to 15,265,782.4 EXACTLY — and
// that exactness is the tell: a genuine consolidation eliminates inter-fund
// transfers, so the parts would EXCEED the whole. They do not, so nothing was
// eliminated.
//
// Two consequences, both enforced below and asserted in __smoke_fund_plan.ts:
//   1. Never label the headline „консолидиран“ / "consolidated". It is
//      `sumOfFunds`, and the type says so.
//   2. Never put it in variance against funds.json's B1 actual, which IS
//      consolidated. That comparison is structurally wrong, not merely
//      imprecise — it would read an accounting-basis difference as execution.
//
// A third, presentational: the „НОИ“ line is 43% of the sum and is not a fund
// in the same sense as „Пенсии“ — it carries the administration and the
// non-fund payments. `isPeerFund: false` marks it so a bar chart can exclude
// it rather than render it as the biggest "fund".
// ─────────────────────────────────────────────────────────────────────────────

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type {
  Money,
  NoiFundPlanFile,
  NoiFundPlanLine,
  NoiFundPlanYear,
} from "../types";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OUT_FILE = path.resolve(
  __dirname,
  "../../../data/budget/noi/fund_plan.json",
);

type LineDef = {
  id: string;
  bg: string;
  en: string;
  k: number; // thousand EUR
  /** False for the „НОИ“ line — see the header. */
  isPeerFund: boolean;
};

type YearDef = {
  fiscalYear: number;
  law: string;
  idMat: string;
  dvIssue: string;
  /** чл. 1 — the gross sum of the lines below, NOT a consolidated total. */
  sumOfFundsK: number;
  lines: LineDef[];
};

const YEARS: YearDef[] = [
  {
    fiscalYear: 2026,
    law: "Закон за бюджета на държавното обществено осигуряване за 2026 г.",
    idMat: "244982",
    dvIssue: "ДВ бр. 68 от 28.07.2026",
    sumOfFundsK: 15_265_782.4,
    lines: [
      {
        id: "pensions",
        bg: "Фонд „Пенсии“",
        en: "Pensions fund",
        k: 5_572_766.5,
        isPeerFund: true,
      },
      {
        id: "pensions_art69",
        bg: "Фонд „Пенсии за лицата по чл. 69“",
        en: "Pensions fund (art. 69 — uniformed services)",
        k: 931_980.9,
        isPeerFund: true,
      },
      {
        id: "pensions_non_labour",
        bg: "Фонд „Пенсии, несвързани с трудова дейност“",
        en: "Non-contributory pensions fund",
        k: 264_736.3,
        isPeerFund: true,
      },
      {
        id: "work_injury",
        bg: "Фонд „Трудова злополука и професионална болест“ (ТЗПБ)",
        en: "Work-injury & occupational-disease fund",
        k: 239_126.2,
        isPeerFund: true,
      },
      {
        id: "sickness_maternity",
        bg: "Фонд „Общо заболяване и майчинство“ (ОЗМ)",
        en: "Sickness & maternity fund",
        k: 1_291_204.5,
        isPeerFund: true,
      },
      {
        id: "unemployment",
        bg: "Фонд „Безработица“",
        en: "Unemployment fund",
        k: 355_504.7,
        isPeerFund: true,
      },
      {
        id: "noi",
        bg: "Бюджет на НОИ",
        en: "НОИ budget",
        // 43% of the sum — administration + the non-fund payments. NOT a peer
        // of „Пенсии“; excluded from per-fund comparisons.
        k: 6_610_463.3,
        isPeerFund: false,
      },
    ],
  },
];

const money = (k: number): Money => {
  const amount = Math.round(k * 1000);
  return { amount, amountEur: amount, currency: "EUR" };
};

const buildYear = (def: YearDef): NoiFundPlanYear => {
  const lines: NoiFundPlanLine[] = def.lines.map((l) => ({
    id: l.id,
    bg: l.bg,
    en: l.en,
    isPeerFund: l.isPeerFund,
    amount: money(l.k),
  }));
  // The exact-sum property is the evidence for the gross-not-consolidated
  // reading, so assert it rather than trusting the transcription: a drift here
  // means either a mis-keyed line or that the law actually DID consolidate,
  // and the second would invalidate the labelling rules in the header.
  const sumK = def.lines.reduce((s, l) => s + l.k, 0);
  const drift = sumK - def.sumOfFundsK;
  if (Math.abs(drift) > 0.05)
    throw new Error(
      `${def.fiscalYear}: fund lines sum to ${sumK.toFixed(1)}k but чл. 1 says ` +
        `${def.sumOfFundsK.toFixed(1)}k (drift ${drift.toFixed(1)}k). If the law ` +
        `really does not add up, the "gross sum, not consolidated" basis this ` +
        `file asserts is wrong — re-read чл. 1–8 before changing the total.`,
    );
  return {
    fiscalYear: def.fiscalYear,
    basis: "law",
    law: def.law,
    idMat: def.idMat,
    dvIssue: def.dvIssue,
    sumOfFunds: money(def.sumOfFundsK),
    lines,
  };
};

const main = (): void => {
  const years = YEARS.map(buildYear).sort(
    (a, b) => b.fiscalYear - a.fiscalYear,
  );
  const file: NoiFundPlanFile = {
    generatedAt: new Date().toISOString(),
    source: {
      publisher: "Народно събрание / Държавен вестник",
      law: "Закон за бюджета на държавното обществено осигуряване (ЗБДОО)",
      url: "https://dv.parliament.bg/DVWeb/showMaterialDV.jsp?idMat=244982",
      description:
        "Планови приходи и трансфери по фондове от чл. 1–8 на ЗБДОО. Заглавната сума е СБОР на фондовете, а не консолидиран бюджет — вътрешните трансфери не са елиминирани, затова сборът съвпада точно с общата сума. Не се сравнява с касовото изпълнение по отчет B1 на НОИ, което е консолидирано.",
    },
    latestYear: years[0].fiscalYear,
    years,
  };
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(file, null, 2) + "\n");

  for (const y of years) {
    const peers = y.lines.filter((l) => l.isPeerFund);
    const peerSum = peers.reduce((s, l) => s + l.amount.amountEur, 0);
    console.log(
      `${y.fiscalYear} (${y.basis}): сбор €${y.sumOfFunds.amountEur.toLocaleString("en")} · ` +
        `${peers.length} peer funds €${peerSum.toLocaleString("en")} · ` +
        `НОИ €${(y.sumOfFunds.amountEur - peerSum).toLocaleString("en")}`,
    );
  }
  console.log(`\nWrote ${OUT_FILE}`);
};

main();
