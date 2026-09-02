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
import { kfpPlanFromLaw, type LawFrameworkYearLike } from "./lawPlan";
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
/** The promulgation the plan is quoted from. УКАЗ № 271; adopted by the 52nd
 *  НС on 24 July 2026, promulgated 31 July — months into the year, which is
 *  why the КФП feed we hold carries no „Закон" column for 2026. */
const ZDBRB_2026_DV = "ЗДБРБ-2026, ДВ бр. 69 от 31.07.2026";
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
    basis: "law",
    vintage: "2026",
    note: "ЗДБРБ-2026, обн. ДВ бр. 69 от 31.07.2026 — до 31 юли държавната страна вървеше по ЗСПИР-2026 (idMat 240166) + неговия ЗИД (242170)",
  },
  {
    component: "план по КФП (приходи / разходи и трансфери / вноска в ЕС)",
    basis: "law",
    vintage: "2026",
    note: "ЗДБРБ-2026 чл. 1 — I, II+III, IV; салдото по ал. 3 е −7 319 804,0 хил. евро. Месечният отчет още няма колона „Закон“ за 2026 г., затова планът идва от закона, не от подадените данни",
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
type PlanExec = NonNullable<Frame["plan"]>["revenue"];

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
  // `pct` stays unrounded — dimensionless, and rounding it to whole euros
  // would floor every share to 0.
  const exec = (e: PlanExec) => ({
    ...e,
    ytdEur: Math.round(e.ytdEur),
    plannedEur: Math.round(e.plannedEur),
  });
  return {
    revenue: side(frame.revenue),
    expenditure: side(frame.expenditure),
    euContribution: side(frame.euContribution),
    balanceEur: Math.round(frame.balanceEur),
    balanceLowEur: Math.round(frame.balanceLowEur),
    balanceHighEur: Math.round(frame.balanceHighEur),
    // `plan.revenue.ytdEur` and `revenue.ytdEur` are the same quantity emitted
    // by two paths; both must honour the whole-euro convention or the artifact
    // carries two forms of one figure.
    plan: frame.plan && {
      ...frame.plan,
      revenue: exec(frame.plan.revenue),
      expenditure: exec(frame.plan.expenditure),
      euContribution: exec(frame.plan.euContribution),
      balance: exec(frame.plan.balance),
    },
  };
};

const main = (): void => {
  const kfp = JSON.parse(
    fs.readFileSync(path.join(ROOT, "data/budget/kfp.json"), "utf8"),
  ) as { observations: KfpObservationLike[] };

  // The promulgated ЗДБРБ, read from the artifact the budget ingest writes.
  // Absent on a checkout that has never run the ingest — degrade to no plan
  // rather than failing, exactly as before this was wired up.
  const frameworkPath = path.join(
    ROOT,
    "data/budget/derived/law_framework.json",
  );
  const framework: Record<string, LawFrameworkYearLike> = fs.existsSync(
    frameworkPath,
  )
    ? JSON.parse(fs.readFileSync(frameworkPath, "utf8"))
    : {};
  const lawPlan = kfpPlanFromLaw(framework[String(YEAR)], ZDBRB_2026_DV);

  const frame = buildFy2026Frame(kfp.observations, {
    year: YEAR,
    referenceYears: REFERENCE_YEARS,
    lawPlan,
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

  // `plan.source` is a RUN-TIME choice, so every string that describes the plan
  // must be derived from it. Hard-coding „идва от закона" ships a false claim
  // the moment the feed publishes a 2026 „Закон" column.
  const planFromLaw = frame.plan?.source === "law";
  const planNote = planFromLaw
    ? "ЗДБРБ-2026 чл. 1 — I, II+III, IV; салдото по ал. 3 е −7 319 804,0 хил. евро. Месечният отчет още няма колона „Закон“ за 2026 г., затова планът идва от закона, не от подадените данни"
    : `Планът идва от колоната „Закон“ на месечния отчет (${frame.plan?.note ?? "—"})`;
  // The pro-rata anchor is DERIVED from throughMonth. A named month goes stale
  // silently and in the wrong direction — the sentence exists to stop a
  // pro-rata misreading, so handing the reader an anchor a month too wide is
  // the one error it must not make.
  const proRata = `${frame.throughMonth}/12`;
  const planSentence = frame.plan
    ? `Планът стои до оценките, не на тяхно място; ${planFromLaw ? "идва от чл. 1 на закона" : "идва от колоната „Закон“ на месечния отчет"}, а \`plan.source\` записва кой източник е използван. ⚠️ Изпълнението спрямо плана НЕ е пропорционално на месеците: изпълнението в България е силно изтеглено към края на годината, така че дял под ${proRata} към месец ${frame.throughMonth} е нормалната форма, а не доказателство, че планът е раздут.`
    : "План няма нито в месечния отчет, нито от закона, затова сравнението план-изпълнение отпада.";

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
    vintages: VINTAGES.map((v) =>
      v.component.startsWith("план по КФП")
        ? {
            ...v,
            basis: (planFromLaw ? "law" : "execution") as FrameBasis,
            note: planNote,
          }
        : v,
    ),
    caveat:
      "Бюджетният пакет за 2026 г. е пълен, но закъснял: ЗБДОО и ЗБНЗОК са обнародвани на 28.07.2026 (ДВ бр. 68), ЗДБРБ — на 31.07.2026 (ДВ бр. 69), тоест държавната страна е вървяла по удължителен закон седем месеца от годината, която законът урежда. Приходите и разходите тук остават ГОДИШНА ОЦЕНКА от месечното изпълнение. Балансът е ИЗВЕДЕН от трите страни (приходи − разходи − вноска в общия бюджет на ЕС), не е екстраполиран сам, и носи собствен диапазон — точката е безсмислена без него. " +
      planSentence,
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
  if (frame.plan) {
    const pct = (p: { pct: number | null }) =>
      p.pct == null ? "  n/a" : `${(p.pct * 100).toFixed(1)}%`;
    console.log(
      `\n  plan           ${frame.plan.source.toUpperCase()} · ${frame.plan.note}`,
    );
    for (const name of FRAME_SIDES)
      console.log(
        `    ${name.padEnd(14)} ${bn(frame.plan[name].plannedEur)} plan · ` +
          `${pct(frame.plan[name])} executed through month ${frame.plan.throughMonth}`,
      );
    console.log(
      `    ${"balance".padEnd(14)} ${bn(frame.plan.balance.plannedEur)} plan · ` +
        `${pct(frame.plan.balance)} run — NOT pro-rata, execution is back-loaded`,
    );
  } else {
    console.log(`  plan           ABSENT (no ЗДБРБ, no „Закон“ column)`);
  }
  console.log(`\nWrote ${OUT}`);
};

main();
