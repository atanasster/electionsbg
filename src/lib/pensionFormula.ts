// The Bulgarian pension formula (КСО чл. 70, post-2019) applied to synthetic
// biographies — the OECD "Pensions at a Glance" three-earner method rebuilt for
// Bulgaria, which has no official PaG country profile. Pure rules, no microdata:
// it needs only the legislated parameters and a stylised career.
//
//   monthly pension = insurable_base × accrual_rate × years_of_service
//   insurable_base  = the worker's income, clamped to [МОД min, МОД cap]
//   then clamped to [minimum pension, таван]
//
// The signature this produces — replacement rate FALLING as earnings rise, held
// up at the bottom by the minimum pension and pulled down at the top by the
// contribution cap and the pension таван — is the whole point: it shows how
// redistributive the system is, computed from the law alone.
//
// Stylised and gross: constant relative earnings, no real-wage-growth drag on
// the career-average coefficient, before tax. The absolute level is illustrative
// (~mid-50s% gross for a full career); the SHAPE across earners is the message.

export interface PensionFormulaParams {
  /** Country average GROSS wage, EUR/mo — the replacement-rate denominator. */
  avgWageEur: number;
  /** Accrual per year of service (чл.70 ал.1: 1.35%). */
  accrualPerYear: number;
  /** Minimum insurable income (МОД floor), EUR/mo. */
  minInsurableEur: number;
  /** Maximum insurable income (МОД cap / максимален осигурителен доход), EUR/mo. */
  maxInsurableEur: number;
  /** Statutory minimum pension (чл.68), EUR/mo. */
  minPensionEur: number;
  /** Pension cap (таван, чл.100), EUR/mo. */
  pensionCapEur: number;
}

export const DEFAULT_ACCRUAL = 0.0135;

/** Gross monthly pension for a worker earning `earnMultiple × avgWage`,
 *  `years` of service. Internal — earnerSignature is the public entry point. */
const stylisedPensionEur = (
  p: PensionFormulaParams,
  earnMultiple: number,
  years: number,
): number => {
  const wage = earnMultiple * p.avgWageEur;
  const insurable = Math.min(
    Math.max(wage, p.minInsurableEur),
    p.maxInsurableEur,
  );
  const raw = insurable * p.accrualPerYear * years;
  return Math.min(Math.max(raw, p.minPensionEur), p.pensionCapEur);
};

/** Gross replacement rate (pension ÷ own final wage) for the same worker.
 *  Internal — consumed by earnerSignature. */
const replacementRate = (
  p: PensionFormulaParams,
  earnMultiple: number,
  years: number,
): number => {
  const wage = earnMultiple * p.avgWageEur;
  if (wage <= 0) return 0;
  return stylisedPensionEur(p, earnMultiple, years) / wage;
};

export interface EarnerPoint {
  /** Earnings as a multiple of the average wage. */
  multiple: number;
  labelBg: string;
  labelEn: string;
  wageEur: number;
  pensionEur: number;
  replacement: number;
}

/** The OECD three-earner signature: low (0.5×), median (1×), high (2×), for a
 *  full career of `years`. */
export const earnerSignature = (
  p: PensionFormulaParams,
  years: number,
): EarnerPoint[] =>
  [
    { multiple: 0.5, labelBg: "Нисък доход", labelEn: "Low earner" },
    { multiple: 1, labelBg: "Среден доход", labelEn: "Median earner" },
    { multiple: 2, labelBg: "Висок доход", labelEn: "High earner" },
  ].map((e) => ({
    multiple: e.multiple,
    labelBg: e.labelBg,
    labelEn: e.labelEn,
    wageEur: e.multiple * p.avgWageEur,
    pensionEur: stylisedPensionEur(p, e.multiple, years),
    replacement: replacementRate(p, e.multiple, years),
  }));

export interface CareerVariant {
  id: string;
  labelBg: string;
  labelEn: string;
  years: number;
}

/** Career-length variants for the median earner — the "it depends on your
 *  career" grid, the EU Pension Adequacy Report's device. */
export const CAREER_VARIANTS: CareerVariant[] = [
  { id: "short", labelBg: "30 г. стаж", labelEn: "30-year career", years: 30 },
  { id: "full", labelBg: "40 г. стаж", labelEn: "40-year career", years: 40 },
  {
    id: "longer",
    labelBg: "+2 години",
    labelEn: "work 2 years more",
    years: 42,
  },
];
