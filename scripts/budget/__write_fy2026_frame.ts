// Generator: write data/budget/derived/fy2026_frame.json — the mixed-provenance
// FY2026 fiscal frame (plan T8).
//
//   npx tsx scripts/budget/__write_fy2026_frame.ts
//
// Re-run whenever a new КФП month lands: the annualisation band narrows
// monotonically through the year, and in December the estimate stops being an
// estimate (`basis` flips execution → carried on the next cycle).
//
// Two artifact conventions, both deliberate:
//   · Money fields are rounded to whole euros. The balance's own honest band is
//     ±€2.75bn, so publishing `-5777280022.209712` is the presentational form of
//     the mistake Rule 2 names. `shareMean` / `shareStdDev` stay unrounded —
//     they are dimensionless and small.
//   · `generatedAt` is wall-clock and therefore CHURNS the git diff on every
//     run, even when the corpus has not moved. Kept anyway: `throughMonth` in
//     the same payload already answers "which vintage is this?", and a
//     regeneration date is worth having on a mixed-provenance artifact. So a
//     one-line diff means nothing; read the numbers.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  BALANCE_FORMULA,
  buildFy2026Frame,
  FRAME_SIDES,
  type KfpObservationLike,
  type FrameBasis,
} from "./fy2026Frame";
import {
  MOD_BY_YEAR,
  MIN_PENSION_SCHEDULE,
  MIN_SELF_INSURED_SCHEDULE,
  MIN_WAGE_SCHEDULE,
  scheduledValueAt,
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
    component: "state revenue / expenditure / вноска в бюджета на ЕС",
    basis: "execution",
    vintage: "2026 YTD",
    note: "КФП monthly execution, seasonally annualised — all three sides of IV = I − II − III, each with its own band",
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

type Frame = ReturnType<typeof buildFy2026Frame>;

/** Whole euros for every money field. The balance's own band is ±€2.75bn, so
 *  sixteen significant figures are precision theatre. `shareMean` and
 *  `shareStdDev` are left alone — dimensionless and genuinely small. */
const roundMoney = (frame: Frame) => {
  const side = (s: Frame["revenue"]) => ({
    ...s,
    ytdEur: Math.round(s.ytdEur),
    annualisedEur: Math.round(s.annualisedEur),
    lowEur: Math.round(s.lowEur),
    highEur: Math.round(s.highEur),
  });
  return {
    revenue: side(frame.revenue),
    expenditure: side(frame.expenditure),
    euContribution: side(frame.euContribution),
    balanceEur: Math.round(frame.balanceEur),
    balanceLowEur: Math.round(frame.balanceLowEur),
    balanceHighEur: Math.round(frame.balanceHighEur),
  };
};

const main = (): void => {
  const kfp = JSON.parse(
    fs.readFileSync(path.join(ROOT, "data/budget/kfp.json"), "utf8"),
  ) as { observations: KfpObservationLike[] };

  const frame = buildFy2026Frame(kfp.observations, {
    year: YEAR,
    referenceYears: REFERENCE_YEARS,
  });

  // `MOD_BY_YEAR` is a `Record<number, number>` without noUncheckedIndexedAccess,
  // so an unmapped year types as `number` and is `undefined` at run time — and
  // `JSON.stringify` OMITS an undefined property rather than writing null, so
  // the field would vanish from the artifact instead of appearing as a hole.
  const modCapEur = MOD_BY_YEAR[YEAR];
  if (modCapEur == null)
    throw new Error(
      `__write_fy2026_frame: MOD_BY_YEAR has no ${YEAR} entry — add it to ` +
        `src/lib/bgTax.ts before regenerating.`,
    );

  const payload = {
    generatedAt: new Date().toISOString(),
    ...frame,
    ...roundMoney(frame),
    /** The statutory side, which is exact rather than estimated. */
    statutory: {
      basis: "law" as FrameBasis,
      // Every figure resolved AT `YEAR`, never "latest": the frame is stamped
      // fiscalYear 2026 and cites the 2026 ДВ issue, so a 2027 schedule step —
      // an annual, expected event — must not leak in under that label.
      // `scheduledValueAt`'s own header is about exactly this failure.
      modCapEur,
      minPensionEur: scheduledValueAt(MIN_PENSION_SCHEDULE, YEAR),
      minSelfInsuredEur: scheduledValueAt(MIN_SELF_INSURED_SCHEDULE, YEAR),
      minWageEur: scheduledValueAt(MIN_WAGE_SCHEDULE, YEAR),
      dvIssue: "ДВ бр. 68 от 28.07.2026",
    },
    vintages: VINTAGES,
    caveat:
      "FY2026 has no single legal frame: ЗБДОО и ЗБНЗОК са обнародвани, ЗДБРБ — не. Приходите и разходите са годишна оценка от месечното изпълнение, а не план — план за 2026 г. няма и няма да има до приемането на ЗДБРБ. Балансът е ИЗВЕДЕН от трите страни (приходи − разходи − вноска в бюджета на ЕС), не е екстраполиран сам, и носи собствен диапазон — точката е безсмислена без него.",
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(payload, null, 2) + "\n");

  const bn = (v: number) => `€${(v / 1e9).toFixed(2)}bn`;
  console.log(
    `FY${YEAR} frame — through month ${frame.throughMonth}, reference years ${REFERENCE_YEARS.join(", ")}\n`,
  );
  for (const name of FRAME_SIDES) {
    const s = frame[name];
    console.log(
      `  ${s.series.padEnd(14)} YTD ${bn(s.ytdEur)} · share ${s.shareMean.toFixed(4)} ` +
        `(sd ${s.shareStdDev.toFixed(4)}) → ${bn(s.annualisedEur)} ` +
        `[${bn(s.lowEur)} .. ${bn(s.highEur)}]`,
    );
  }
  console.log(
    `  balance        DERIVED ${bn(frame.balanceEur)} = ${BALANCE_FORMULA} ` +
      `[${bn(frame.balanceLowEur)} .. ${bn(frame.balanceHighEur)}] (never annualised)`,
  );
  console.log(
    `  plan line      ${frame.hasPlan ? "present" : "ABSENT (no ЗДБРБ)"}`,
  );
  console.log(`\nWrote ${OUT}`);
};

main();
