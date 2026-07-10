// Build the per-obshtina socioeconomic context index ("Индекс на средата") that
// lets /education and /school/:id judge a school against its CIRCUMSTANCES, not
// the national mean — the MySchool-ICSEA / Chile-GSE / SEDA idea. Without it, a
// matura ranking just re-ranks community affluence.
//
// GRAIN: obshtina, not per-school. We have no per-pupil family data, so the
// index measures "the средата на общината" and is labelled honestly as such —
// all schools in an obshtina share it. The regression that turns it into a
// "над/под очакваното" verdict runs client-side over the schools (each school
// keeps its own score), so schools in the same obshtina still separate by their
// residual.
//
// RECIPE (disclosed to the reader): equal-weighted average of three
// standardized (z-scored across обштини) census-2021 signals —
//   + share of adults with tertiary education   (advantage)
//   − share with primary-or-lower education      (disadvantage)
//   − registered unemployment rate               (disadvantage)
// then re-standardized to mean 0, sd 1. Deliberately socioeconomic, NOT ethnic:
// baking ethnicity into the bar invites the "institutionalising low expectations"
// critique that sank the UK's contextual value-added measure. Source: НСИ
// Преброяване 2021 (data/census/municipalities).
//
// Run: `npx tsx scripts/education/gen_school_context.ts`

import fs from "node:fs";
import path from "node:path";

const PROJECT_ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
  "..",
);
const CENSUS_DIR = path.join(PROJECT_ROOT, "data/census/municipalities");
const OUT_DIR = path.join(PROJECT_ROOT, "data/education");
const OUT_FILE = path.join(OUT_DIR, "school_context.json");

// Столична община is a single SOF00 aggregate in the МОН schools data; the
// census files it under SOF46. Alias so SOF00-keyed schools resolve.
const SOFIA_SCHOOL_CODE = "SOF00";
const SOFIA_CENSUS_CODE = "SOF46";

type CensusMuni = {
  code: string;
  education?: {
    tertiary?: number;
    upperSecondary?: number;
    lowerSecondary?: number;
    primaryOrLower?: number;
    preSchool?: number;
  };
  employment?: { unemploymentRate?: number };
};

type Raw = {
  code: string;
  shareTertiary: number;
  shareLowEd: number;
  unemployment: number | null;
};

const zScorer = (xs: number[]): ((x: number) => number) => {
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd =
    Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length) || 1;
  return (x: number) => (x - mean) / sd;
};

const round = (n: number, dp = 3) => Math.round(n * 10 ** dp) / 10 ** dp;

const main = () => {
  const raws: Raw[] = [];
  for (const f of fs
    .readdirSync(CENSUS_DIR)
    .filter((f) => f.endsWith(".json"))) {
    const d: CensusMuni = JSON.parse(
      fs.readFileSync(path.join(CENSUS_DIR, f), "utf8"),
    );
    const e = d.education ?? {};
    const eduTotal =
      (e.tertiary ?? 0) +
      (e.upperSecondary ?? 0) +
      (e.lowerSecondary ?? 0) +
      (e.primaryOrLower ?? 0) +
      (e.preSchool ?? 0);
    if (eduTotal <= 0) continue;
    raws.push({
      code: d.code,
      shareTertiary: (e.tertiary ?? 0) / eduTotal,
      shareLowEd: (e.primaryOrLower ?? 0) / eduTotal,
      unemployment: d.employment?.unemploymentRate ?? null,
    });
  }

  // Impute missing unemployment with the cross-município mean so a gap
  // contributes a neutral (z≈0) term instead of 0% (treated as maximally
  // advantaged), which would bias the mean/sd and every other z-score.
  const presentUnemp = raws
    .map((r) => r.unemployment)
    .filter((u): u is number => u != null);
  const meanUnemp = presentUnemp.length
    ? presentUnemp.reduce((a, b) => a + b, 0) / presentUnemp.length
    : 0;
  const unempOf = (r: Raw): number => r.unemployment ?? meanUnemp;

  const zTert = zScorer(raws.map((r) => r.shareTertiary));
  const zLow = zScorer(raws.map((r) => r.shareLowEd));
  const zUnemp = zScorer(raws.map(unempOf));

  // Composite (advantage +, disadvantage −), then re-standardize to mean 0 sd 1
  // so the published index reads on a clean z-scale.
  const composite = raws.map(
    (r) =>
      (zTert(r.shareTertiary) - zLow(r.shareLowEd) - zUnemp(unempOf(r))) / 3,
  );
  const zComposite = zScorer(composite);

  const byObshtina: Record<
    string,
    {
      ses: number;
      shareTertiary: number;
      shareLowEd: number;
      unemployment: number | null;
    }
  > = {};
  raws.forEach((r, i) => {
    byObshtina[r.code] = {
      ses: round(zComposite(composite[i]), 2),
      shareTertiary: round(100 * r.shareTertiary, 1),
      shareLowEd: round(100 * r.shareLowEd, 1),
      // Honest null when the source lacked the rate (the composite used the
      // imputed mean; we don't publish a fabricated value here).
      unemployment: r.unemployment == null ? null : round(r.unemployment, 1),
    };
  });
  // Alias Sofia so SOF00-keyed schools find their context.
  if (byObshtina[SOFIA_CENSUS_CODE])
    byObshtina[SOFIA_SCHOOL_CODE] = byObshtina[SOFIA_CENSUS_CODE];

  const payload = {
    // No generatedAt timestamp — deterministic from the census, so a timestamp
    // would only churn git on re-runs.
    source: {
      publisher: "НСИ — Преброяване 2021",
      path: "data/census/municipalities",
      note: "Индекс на средата на общината: равно претеглена стандартизирана комбинация от дял висше образование (+), дял основно и по-ниско (−) и безработица (−). Средна община = 0. Мярка за средата, не оценка на училището; умишлено социално-икономическа, не етническа.",
    },
    weights: { tertiary: 1 / 3, lowEducation: -1 / 3, unemployment: -1 / 3 },
    // Distinct municipalities — NOT Object.keys(byObshtina), which counts the
    // SOF00→SOF46 Sofia alias twice.
    count: raws.length,
    byObshtina,
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(payload, null, 2) + "\n");
  console.log(
    `Wrote ${OUT_FILE} — ${raws.length} обштини (+SOF00 alias). SES range ${round(
      Math.min(...composite.map((c) => zComposite(c))),
      2,
    )}…${round(Math.max(...composite.map((c) => zComposite(c))), 2)}`,
  );
};

main();
