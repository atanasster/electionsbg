// Generator: write data/budget/derived/fy2026_frame.json — the mixed-provenance
// FY2026 fiscal frame (plan T8).
//
//   npx tsx scripts/budget/__write_fy2026_frame.ts
//
// Re-run whenever a new КФП month lands: the annualisation band narrows
// monotonically through the year, and in December the estimate stops being an
// estimate (`basis` flips execution → carried on the next cycle).

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  buildFy2026Frame,
  type KfpObservationLike,
  type FrameBasis,
} from "./fy2026Frame";
import {
  MOD_BY_YEAR,
  MIN_PENSION,
  MIN_SELF_INSURED_INCOME,
  MIN_WAGE,
} from "../../src/lib/bgTax";

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), "../..");
const OUT = path.join(ROOT, "data/budget/derived/fy2026_frame.json");

const YEAR = 2026;
/** Complete years the seasonality is measured over. 2021 is excluded: the КФП
 *  feed starts mid-2021, so its share-by-month is not comparable. */
const REFERENCE_YEARS = [2022, 2023, 2024, 2025];

/** What each part of the frame IS, so the UI can never present a carried-over
 *  2022 figure as a 2026 one. */
const VINTAGES: {
  component: string;
  basis: FrameBasis;
  vintage: string;
  note: string;
}[] = [
  {
    component: "statutory parameters (МОД, min/max pension, benefits)",
    basis: "law",
    vintage: "2026",
    note: "ЗБДОО-2026, обн. ДВ бр. 68 от 28.07.2026",
  },
  {
    component: "НЗОК expenditure envelope",
    basis: "law",
    vintage: "2026",
    note: "ЗБНЗОК-2026, чл. 1 ал. 2",
  },
  {
    component: "ДОО per-fund plan",
    basis: "law",
    vintage: "2026",
    note: "ЗБДОО-2026 чл. 1–8 — a GROSS sum, not consolidated",
  },
  {
    component: "state-side legal frame",
    basis: "interim",
    vintage: "2026",
    note: "ЗСПИР-2026 (idMat 240166) + its ЗИД (242170) — no ЗДБРБ",
  },
  {
    component: "state revenue / expenditure",
    basis: "execution",
    vintage: "2026 YTD",
    note: "КФП monthly execution, seasonally annualised — see the band",
  },
  {
    component: "earnings distribution (SES wave)",
    basis: "carried",
    vintage: "2022",
    note: "Eurostat earn_ses_hourly — the newest wave published",
  },
  {
    component: "VAT consumption structure",
    basis: "carried",
    vintage: "2022",
    note: "Eurostat COICOP household consumption",
  },
  {
    component: "income-tier distribution",
    basis: "carried",
    vintage: "2023",
    note: "НАП parliamentary answer, tax year 2023",
  },
  {
    component: "pension mass, administration payroll, COFOG social benefits",
    basis: "carried",
    vintage: "2024",
    note: "the newest complete year for each",
  },
  {
    component: "МОД identity (Pareto anchor)",
    basis: "carried",
    vintage: "2024",
    note: "a single-cap year, deliberately — 2025 and 2026 both stepped",
  },
];

const main = (): void => {
  const kfp = JSON.parse(
    fs.readFileSync(path.join(ROOT, "data/budget/kfp.json"), "utf8"),
  ) as { observations: KfpObservationLike[] };

  const frame = buildFy2026Frame(kfp.observations, {
    year: YEAR,
    referenceYears: REFERENCE_YEARS,
  });

  const payload = {
    generatedAt: new Date().toISOString(),
    ...frame,
    /** The statutory side, which is exact rather than estimated. */
    statutory: {
      basis: "law" as FrameBasis,
      modCapEur: MOD_BY_YEAR[YEAR],
      minPensionEur: MIN_PENSION,
      minSelfInsuredEur: MIN_SELF_INSURED_INCOME,
      minWageEur: MIN_WAGE,
      dvIssue: "ДВ бр. 68 от 28.07.2026",
    },
    vintages: VINTAGES,
    caveat:
      "FY2026 has no single legal frame: ЗБДОО и ЗБНЗОК са обнародвани, ЗДБРБ — не. Приходите и разходите са годишна оценка от месечното изпълнение, а не план — план за 2026 г. няма и няма да има до приемането на ЗДБРБ. Балансът е ИЗВЕДЕН от двете страни, не е екстраполиран сам.",
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(payload, null, 2) + "\n");

  const bn = (v: number) => `€${(v / 1e9).toFixed(2)}bn`;
  console.log(
    `FY${YEAR} frame — through month ${frame.throughMonth}, reference years ${REFERENCE_YEARS.join(", ")}\n`,
  );
  for (const s of [frame.revenue, frame.expenditure]) {
    console.log(
      `  ${s.series.padEnd(12)} YTD ${bn(s.ytdEur)} · share ${s.shareMean.toFixed(4)} ` +
        `(sd ${s.shareStdDev.toFixed(4)}) → ${bn(s.annualisedEur)} ` +
        `[${bn(s.lowEur)} .. ${bn(s.highEur)}]`,
    );
  }
  console.log(
    `  balance      DERIVED ${bn(frame.balanceEur)} (never annualised)`,
  );
  console.log(
    `  plan line    ${frame.hasPlan ? "present" : "ABSENT (no ЗДБРБ)"}`,
  );
  console.log(`\nWrote ${OUT}`);
};

main();
