// Pure Bulgarian personal-tax math for the budget tax-bill calculator.
// All amounts in EUR — pre-2026 BGN figures were converted at the locked
// 1.95583 parity at ingest, 2026-onward is euro-native. These are
// illustrative defaults; see the caveats rendered by BudgetTaxCalculator.
//
// Provenance & watcher: these statutory constants (rates, МОД cap, min/max
// pension, contributions, child relief) track the State Budget + Social-Security
// Budget laws (ЗДБРБ / ЗБДОО).
//
// The 2026 social-security half IS adopted: ЗБДОО-2026 (idMat 244982) and
// ЗБНЗОК-2026 (idMat 244981), обн. ДВ бр. 68 от 28.07.2026, in force
// retroactively from 1 Jan 2026. The ЗДБРБ half (the STATE budget) was NOT in
// that issue and is still unpromulgated — FY2026 runs its state side on a
// bridging law. "The 2026 budget" therefore does not exist as one thing; do not
// describe it as such, and treat anything the ЗДБРБ sets (child relief, the
// party subsidy, the ЗХ gambling fee) as carry-over pending the next flip.
//
// MID-YEAR STEPS ARE THE NORMAL CASE, not an exception. A late budget takes
// effect the first of the month after promulgation, and the first period of
// year N is year N−1's value, carried by the extension law until it passes:
//   2025 — обн. ДВ бр. 25 от 25.03.2025 → step 1 Apr (МОД €1,917.34 → €2,111.64)
//   2026 — обн. ДВ бр. 68 от 28.07.2026 → step 1 Aug (МОД €2,111.64 → €2,300.00)
// Three of the last five years stepped, so a scalar-per-year is the wrong shape.
// The dated *_SCHEDULE tables below are the truth; the scalar constants beside
// them are a labelled convenience, pinned by test to a value that was actually
// law in that year.
//
// Re-verified when the `dv_laws` watcher flips. `dv_laws` is the AUTHORITATIVE
// promulgation signal — `budget_law` is a Wayback-lagged minfin proxy that only
// ever sees the ЗДБРБ half and never reports a ЗБДОО/ЗБНЗОК. Check against the
// ДВ text + the НАП "осигурителни вноски" table; see the dv_laws row in the
// process-watch-report skill.

/** A statutory value and the date it takes effect, in force until the next
 *  entry. `from` is an ISO date (`"2026-08-01"`); entries ascend. */
export interface StatutoryStep {
  from: string;
  value: number;
}

/** The step in force on `asOf`. With no `asOf` this returns the LAST step —
 *  the latest official value — which is the convention the scalar constants
 *  below follow. Never defaults to wall-clock time: a value that changes on an
 *  uncontrolled date makes tests time-dependent and makes shared simulator
 *  permalinks mean different things on different days. */
export const stepAt = (
  steps: readonly StatutoryStep[],
  asOf?: string,
): StatutoryStep => {
  if (steps.length === 0) throw new Error("stepAt: empty schedule");
  if (asOf == null) return steps[steps.length - 1];
  let found = steps[0];
  for (const s of steps) if (s.from <= asOf) found = s;
  return found;
};

export type TaxpayerProfile = "employee" | "self" | "company";

// Flat 10% personal income tax on the post-contribution base.
export const PIT_RATE = 0.1;

// Employee social-security + health share for the default case (born after
// 1959, no second-pillar opt-out): state pension fund 6.58% + universal
// pension fund 2.20% + health 3.20% + sickness/maternity 1.40% +
// unemployment 0.40% = 13.78%.
export const SSC_EMPLOYEE_RATE = 0.1378;

// Employer share on the same insurable base. The 18.9–19.6% spread is the
// work-injury fund (ТЗПБ, 0.4–1.1%, set by the firm's economic-activity
// risk class); 0.5% is used as a representative mid value.
export const SSC_EMPLOYER_RATE = 0.1902;

// Self-insured persons remit the whole contribution themselves on a
// self-declared base: pension 14.8% + universal pension fund 5% + health
// 8% = 27.8%. The sickness/maternity fund (3.5%) is optional and excluded.
export const SSC_SELF_INSURED_RATE = 0.278;

export const CORP_TAX_RATE = 0.1;
export const DIVIDEND_TAX_RATE = 0.05;

export const VAT_STANDARD_RATE = 0.2;
// Illustrative share of net income a household spends on standard-rated
// (20% VAT) goods. Lower-income households spend a larger share; this is a
// single representative value.
export const VAT_CONSUMPTION_SHARE = 0.75;

// Shares of the contribution earmarked for the two pension funds (state
// pension fund + universal pension fund), by who remits them.
export const PENSION_EMPLOYEE_RATE = 0.0878;
export const PENSION_EMPLOYER_RATE = 0.1102;
export const PENSION_SELF_RATE = 0.198;

// Pension accrual: 1.35% of insurable income per year of third-category
// service (the post-December-2021 rate). Simplified — the lower 1.2%
// credited-service weighting is folded in.
export const PENSION_ACCRUAL_RATE = 0.0135;

// Минимален размер на пенсията за осигурителен стаж и възраст (чл. 10 ЗБДОО).
// Stepped 1 Jul 2026 — €346.87 is the DRAFT figure still in circulation; the
// adopted value is €347.51.
export const MIN_PENSION_SCHEDULE: Record<number, StatutoryStep[]> = {
  2024: [{ from: "2024-01-01", value: 296.85 }], // 580.57 лв, чл. 10 ЗБДОО-2024
  2025: [{ from: "2025-01-01", value: 322.37 }], // 630.40 лв, чл. 10 ЗБДОО-2025
  2026: [
    { from: "2026-01-01", value: 322.37 },
    { from: "2026-07-01", value: 347.51 }, // чл. 10 ЗБДОО-2026
  ],
};
/** The latest year present in a schedule. Used so the scalars below advance
 *  with the table instead of freezing at a hard-coded index — the staleness
 *  class this whole schedule model exists to prevent. */
export const latestScheduleYear = (
  schedule: Record<number, StatutoryStep[]>,
): number => Math.max(...Object.keys(schedule).map(Number));

/** The latest official value in a schedule — its last step in its last year. */
export const latestScheduledValue = (
  schedule: Record<number, StatutoryStep[]>,
): number => stepAt(schedule[latestScheduleYear(schedule)]).value;

/** The value a schedule held in `year`, snapping to the nearest known year the
 *  way `resolveMod` does. Use this whenever a figure is combined with
 *  year-stamped OBSERVED data: mixing 2026 statutory bounds into a 2024 wage
 *  anchor silently rewrites the result — the /pensions replacement curve moved
 *  up to +8.7pp with no policy change that way, and flattened the very gap
 *  ("high earners are capped") the chart exists to show. Same vintage on both
 *  sides, always. */
export const scheduledValueAt = (
  schedule: Record<number, StatutoryStep[]>,
  year: number,
  asOf?: string,
): number => {
  const years = Object.keys(schedule)
    .map(Number)
    .sort((a, b) => a - b);
  if (years.length === 0) throw new Error("scheduledValueAt: empty schedule");
  const snapped =
    schedule[year] != null
      ? year
      : year < years[0]
        ? years[0]
        : years[years.length - 1];
  return stepAt(schedule[snapped], asOf).value;
};

export const MIN_PENSION = latestScheduledValue(MIN_PENSION_SCHEDULE);

// Максимален размер на получаваните една или повече пенсии без добавките
// (§ 4 ал. 2 ЗБДОО-2026) — €1,738.40 for the WHOLE of 2026, so no schedule.
// The one constant this law confirms rather than moves; it is sourced, not
// inherited. § 4 ал. 3 computes the чл. 84 КСО supplement off the capped amount.
export const MAX_PENSION = 1738.4;

// Минимален месечен осигурителен доход за самоосигуряващите се лица (чл. 9
// ЗБДОО). €550.66 has been in force since 1 Apr 2025 (1,077 лв, чл. 9
// ЗБДОО-2025) — it is a 2025 value the 2026 law carried, not a 2026 one.
export const MIN_SELF_INSURED_SCHEDULE: Record<number, StatutoryStep[]> = {
  2025: [
    { from: "2025-01-01", value: 477.03 }, // 933 лв
    { from: "2025-04-01", value: 550.66 }, // 1,077 лв
  ],
  2026: [
    { from: "2026-01-01", value: 550.66 },
    { from: "2026-08-01", value: 620.2 }, // чл. 9 ЗБДОО-2026
  ],
};
export const MIN_SELF_INSURED_INCOME = latestScheduledValue(
  MIN_SELF_INSURED_SCHEDULE,
);

// Минимална работна заплата (МРЗ). NOT a ЗБДОО figure — it is set by a
// Council of Ministers decree, effective 1 January, which is why it does not
// step mid-year the way the ЗБДОО parameters do. It therefore has no `dv_laws`
// signal either: the decree lands in ДВ but not as a budget law, so a new year
// must be added by hand — check each autumn (the 2026 rate was set 13.11.2025)
// against the МТСП announcement, NOT by waiting for a watcher to flip. Held here because the
// /pensions replacement-rate curve needs the earnings floor and was carrying
// its own 2024 лв copy.
//
// Only the years we can cite are encoded; there is deliberately no pre-2024
// history. €620.20 is also the ЗБДОО-2026 self-insured floor from 1 Aug — the
// two instruments converge on one number in 2026, which is a coincidence of
// this year, not an identity. Do not collapse them.
export const MIN_WAGE_SCHEDULE: Record<number, StatutoryStep[]> = {
  2024: [{ from: "2024-01-01", value: 477.04 }], // 933 лв ÷ 1.95583
  2025: [{ from: "2025-01-01", value: 550.66 }], // 1,077 лв
  2026: [{ from: "2026-01-01", value: 620.2 }], // 1,213 лв, РМС 243/13.11.2025
};
export const MIN_WAGE = latestScheduledValue(MIN_WAGE_SCHEDULE);

// Обезщетения по ЗБДОО-2026, all whole-year (no mid-year step):
/** Дневно обезщетение за безработица, чл. 11 — min/max. */
export const UNEMPLOYMENT_BENEFIT_DAILY_MIN = 9.21;
export const UNEMPLOYMENT_BENEFIT_DAILY_MAX = 54.78;
/** Месечно обезщетение за отглеждане на дете до 2 г., чл. 12. Unchanged from
 *  2025 — the ЗБДОО-2026 confirms it rather than raising it. */
export const CHILD_REARING_BENEFIT = 398.81;
/** Еднократна помощ при смърт на осигурено лице, чл. 13. */
export const DEATH_GRANT = 276.1;
/** Максимален размер на гарантираните вземания, чл. 15 ал. 2. */
export const GUARANTEED_CLAIMS_CAP = 1550.5;

// чл. 15 ал. 1 ЗБДОО-2026: NO contributions are due to the Гаранционен фонд
// (ГВРС) in 2026. This is a real employer-cost fact but NOT a rate change:
// SSC_EMPLOYER_RATE (19.02%) never included ГВРС, so nothing below moves.
// Encoded as a note deliberately — resist "correcting" the employer rate.
export const GVRS_CONTRIBUTION_DUE_2026 = false;

// Child tax relief — annual taxable-base reduction by number of children
// (key 3 = "three or more"). 6 000 / 12 000 / 18 000 BGN at the locked
// parity; relief actually received is the PIT rate (10%) of these.
export const CHILD_RELIEF_BASE: Record<number, number> = {
  0: 0,
  1: 3067.75,
  2: 6135.5,
  3: 9203.25,
};

// Максимален осигурителен доход — monthly cap on insurable income.
//
// MOD_SCHEDULE is the truth: dated steps, in force until the next entry.
// Years with no recorded step are single-step at the rounded whole-euro value
// they were carried at. The three known movers (2022, 2025, 2026) all follow
// the same rule: the step lands the first of the month after promulgation, and
// the year's FIRST period is the previous year's cap carried by the extension
// law. That rule is asserted in bgTax.test.ts, so a new mover cannot be added
// with an inconsistent first step.
export const MOD_SCHEDULE: Record<number, StatutoryStep[]> = {
  2018: [{ from: "2018-01-01", value: 1329 }],
  2019: [{ from: "2019-01-01", value: 1534 }],
  2020: [{ from: "2020-01-01", value: 1534 }],
  2021: [{ from: "2021-01-01", value: 1534 }],
  2022: [
    { from: "2022-01-01", value: 1533.98 }, // 3,000 лв — the 2021 carry-over
    { from: "2022-04-01", value: 1738.4 }, // 3,400 лв, ЗБДОО-2022
  ],
  2023: [{ from: "2023-01-01", value: 1738 }],
  2024: [{ from: "2024-01-01", value: 1917 }],
  2025: [
    { from: "2025-01-01", value: 1917.34 }, // 3,750 лв — the 2024 carry-over
    { from: "2025-04-01", value: 2111.64 }, // 4,130 лв, чл. 9 ЗБДОО-2025
  ],
  2026: [
    { from: "2026-01-01", value: 2111.64 }, // the 2025 carry-over
    { from: "2026-08-01", value: 2300 }, // чл. 9 ЗБДОО-2026
  ],
};

// The headline scalar per year — what a caller means by "the 2026 cap" when it
// is labelling one number. Deliberately EXPLICIT rather than derived: the
// convention is a judgment call per year (historically "the value in force for
// the longer part of the year"; for 2026 the latest official value, €2,300),
// and no single derivation rule reproduces every year. bgTax.test.ts pins each
// entry to a value that actually appears in that year's schedule, so this can
// never drift to a number that was never law.
export const MOD_BY_YEAR: Record<number, number> = {
  2018: 1329,
  2019: 1534,
  2020: 1534,
  2021: 1534,
  2022: 1738,
  2023: 1738,
  2024: 1917,
  2025: 2112,
  2026: 2300,
};
const MOD_YEARS = Object.keys(MOD_BY_YEAR)
  .map(Number)
  .sort((a, b) => a - b);
const LATEST_MOD_YEAR = MOD_YEARS[MOD_YEARS.length - 1];

export interface ModResolution {
  /** The cap value in EUR. */
  mod: number;
  /** The year the value is actually drawn from — equals the requested year
   *  when known, otherwise the nearest year in the table. */
  year: number;
  /** True when the requested year had its own entry. */
  exact: boolean;
  /** The resolved year's dated steps, when it has more than one — so a caller
   *  can label "€2,112 → €2,300 from 1 Aug" instead of a bare scalar that
   *  matches only part of the year. Absent for single-step years. */
  steps?: StatutoryStep[];
  /** The date the value was resolved at, when `asOf` was supplied. */
  asOf?: string;
}

// Resolve the МОД for a fiscal year. Years outside the table snap to the
// nearest known year, and the resolution reports THAT year — so a caller
// labelling the value never claims a year whose cap it isn't showing.
//
// `asOf` (ISO date) resolves the step actually in force on that date instead of
// the year's headline scalar. OMITTING IT KEEPS THE YEAR-SCALAR SEMANTICS and
// is time-INDEPENDENT — there is deliberately no wall-clock default, so this
// function returns the same value whenever it runs. Callers that want
// in-force-now pass an explicit date.
export function resolveMod(
  year: number | null | undefined,
  asOf?: string,
): ModResolution {
  // `asOf` only means something INSIDE the resolved year. A cross-year date
  // (asking for 2026 as of 2025-05-01) would otherwise clamp to the year's
  // first step and return a real-looking number for a period it never covered,
  // so it is ignored and the year's scalar is used instead.
  const appliesTo = (y: number): boolean =>
    asOf != null && Number(asOf.slice(0, 4)) === y;
  const decorate = (r: ModResolution): ModResolution => {
    const steps = MOD_SCHEDULE[r.year];
    return {
      ...r,
      // Copy: callers must not be able to mutate the schedule through this.
      ...(steps && steps.length > 1
        ? { steps: steps.map((st) => ({ ...st })) }
        : {}),
      ...(appliesTo(r.year) ? { asOf } : {}),
    };
  };
  const valueFor = (y: number): number => {
    const steps = MOD_SCHEDULE[y];
    if (appliesTo(y) && steps) return stepAt(steps, asOf).value;
    return MOD_BY_YEAR[y];
  };
  if (year == null)
    return decorate({
      mod: valueFor(LATEST_MOD_YEAR),
      year: LATEST_MOD_YEAR,
      exact: false,
    });
  if (MOD_BY_YEAR[year] != null)
    return decorate({ mod: valueFor(year), year, exact: true });
  const snapped = year < MOD_YEARS[0] ? MOD_YEARS[0] : LATEST_MOD_YEAR;
  return decorate({ mod: valueFor(snapped), year: snapped, exact: false });
}

/** A cap and the number of months of a fiscal year it applied for. */
export interface CapMonths {
  capEur: number;
  months: number;
}

/** Split a fiscal year into its (cap, months) segments.
 *
 *  МОД is a MONTHLY cap applied per month under КСО, so the true annual
 *  insurable base is Σ_months Σ_workers min(wage, cap_month). `scalar × 12` is
 *  the approximation, not this — and it has been wrong in three of the last
 *  five years. Measured on the baked band grid, pricing a whole year at one
 *  scalar costs €40.7M for 2025 and €72.7M for 2026.
 *
 *  A single-step year returns exactly `[{ capEur, months: 12 }]`, so a caller
 *  that used the scalar gets a byte-identical answer.
 *
 *  NOTE the arithmetic that does NOT work: averaging the caps. `min(w, cap)` is
 *  CONCAVE in cap, so by Jensen a blended cap overstates the INSURABLE BASE,
 *  which at the 2026 step is worth a few million euro of phantom SSC revenue —
 *  small at this step size, but it grows with the square of the step. Weight
 *  the OUTPUTS, never the cap.
 *
 *  A year with no schedule entry falls back to a whole-year scalar. That mirrors
 *  `resolveMod`'s snapping but DROPS its `exact: false` signal, so do not use
 *  this to decide whether a year is actually known — ask `MOD_SCHEDULE` or
 *  `resolveMod` for that. */
export const capMonths = (year: number): CapMonths[] => {
  const steps = MOD_SCHEDULE[year];
  if (!steps || steps.length === 0)
    return [{ capEur: MOD_BY_YEAR[year] ?? resolveMod(year).mod, months: 12 }];
  // Clamp into the year in BOTH directions. A step dated before the year
  // applies from January; one dated after it contributes no months. Clamping
  // only the near side let a mis-keyed schedule produce [{a, 0}, {b, 12}] —
  // which still sums to 12, so a "months add up" check cannot see it, while
  // the whole year prices at a cap that was in force for none of it.
  const monthOf = (iso: string): number => {
    const y = Number(iso.slice(0, 4));
    if (y < year) return 0;
    if (y > year) return 12;
    return Number(iso.slice(5, 7)) - 1;
  };
  return steps.map((st, i) => {
    const start = monthOf(st.from);
    const end = i + 1 < steps.length ? monthOf(steps[i + 1].from) : 12;
    return { capEur: st.value, months: Math.max(0, end - start) };
  });
};

/** The МОД cap in force under current law — what a UI means by "the current
 *  cap" when it centres a slider or labels a default. Named here because it was
 *  re-derived as `resolveMod(null).mod` at every call site, which made it
 *  invisible that some of those callers wanted the cap the BASELINE ARTIFACT
 *  was built at instead (see `baselineCap` in ai/tools/taxPolicy.ts — the two
 *  are not the same thing and conflating them silently zeroed the 2026 МОД
 *  lever). If you are scoring against a baseline, you almost certainly want
 *  that baseline's own cap, not this. */
export const currentStatutoryMod = (): number => resolveMod(null).mod;

export interface LabourTaxInput {
  monthlyGross: number;
  mod: number;
  profile: "employee" | "self";
  children: number;
}

export interface LabourTaxResult {
  insurableBase: number;
  ssc: number;
  employerSsc: number;
  childRelief: number;
  pit: number;
  directTax: number; // ssc + pit — the citizen's payslip deductions
  net: number;
  labourCost: number; // gross + employerSsc
  effectiveRate: number;
  marginalRate: number;
  taxWedge: number;
  isAboveCap: boolean;
  pensionContribEmployee: number;
  pensionContribEmployer: number;
}

export function computeLabourTax({
  monthlyGross,
  mod,
  profile,
  children,
}: LabourTaxInput): LabourTaxResult {
  const isSelf = profile === "self";
  const sscRate = isSelf ? SSC_SELF_INSURED_RATE : SSC_EMPLOYEE_RATE;
  const insurableBase = isSelf
    ? Math.min(Math.max(monthlyGross, MIN_SELF_INSURED_INCOME), mod)
    : Math.min(monthlyGross, mod);
  const ssc = insurableBase * sscRate;
  const employerSsc = isSelf ? 0 : insurableBase * SSC_EMPLOYER_RATE;
  const pitBeforeRelief = Math.max(0, monthlyGross - ssc) * PIT_RATE;
  const reliefEntitlement =
    ((CHILD_RELIEF_BASE[children] ?? 0) * PIT_RATE) / 12;
  const childRelief = Math.min(reliefEntitlement, pitBeforeRelief);
  const pit = pitBeforeRelief - childRelief;
  const directTax = ssc + pit;
  const labourCost = monthlyGross + employerSsc;
  const isAboveCap = monthlyGross > mod;
  return {
    insurableBase,
    ssc,
    employerSsc,
    childRelief,
    pit,
    directTax,
    net: monthlyGross - directTax,
    labourCost,
    effectiveRate: monthlyGross > 0 ? directTax / monthlyGross : 0,
    // Below the cap each extra euro is hit by SSC and then PIT on the
    // remainder; above the cap only PIT keeps scaling.
    marginalRate: isAboveCap ? PIT_RATE : sscRate + PIT_RATE * (1 - sscRate),
    taxWedge: labourCost > 0 ? (directTax + employerSsc) / labourCost : 0,
    isAboveCap,
    pensionContribEmployee:
      insurableBase * (isSelf ? PENSION_SELF_RATE : PENSION_EMPLOYEE_RATE),
    pensionContribEmployer: isSelf ? 0 : insurableBase * PENSION_EMPLOYER_RATE,
  };
}

// Estimated 20% VAT embedded in a household's everyday spending, derived
// from net income. VAT is a fraction VAT/(1+VAT) of a gross consumer price.
// `consumptionShare` is the fraction of net income spent on standard-rated
// goods — defaults to VAT_CONSUMPTION_SHARE.
export function computeVat(
  net: number,
  consumptionShare: number = VAT_CONSUMPTION_SHARE,
): number {
  if (net <= 0) return 0;
  return net * consumptionShare * (VAT_STANDARD_RATE / (1 + VAT_STANDARD_RATE));
}

export interface CompanyTaxResult {
  corpTax: number;
  dividendTax: number;
  totalTax: number;
  net: number;
  effectiveRate: number;
  marginalRate: number;
}

// Corporate + dividend tax is linear in profit, so the marginal rate is a
// constant: 10% corporate tax, then 5% on the 90% that remains.
export const COMPANY_MARGINAL_RATE =
  CORP_TAX_RATE + DIVIDEND_TAX_RATE * (1 - CORP_TAX_RATE);

// Owner of a single-member company: 10% corporate tax on profit, then 5%
// withholding when the remainder is distributed as a dividend.
export function computeCompanyTax(monthlyProfit: number): CompanyTaxResult {
  const profit = Math.max(0, monthlyProfit);
  const corpTax = profit * CORP_TAX_RATE;
  const dividendTax = (profit - corpTax) * DIVIDEND_TAX_RATE;
  const totalTax = corpTax + dividendTax;
  return {
    corpTax,
    dividendTax,
    totalTax,
    net: monthlyProfit - totalTax,
    effectiveRate: profit > 0 ? totalTax / profit : 0,
    marginalRate: COMPANY_MARGINAL_RATE,
  };
}

export interface PensionResult {
  monthly: number;
  uncapped: number;
  cappedAtMin: boolean;
  cappedAtMax: boolean;
}

// Simplified state pension: insurable income × 1.35% × years of service,
// bounded by the 2026 minimum and maximum pension.
export function computePension(
  insurableBase: number,
  serviceYears: number,
): PensionResult {
  const uncapped = insurableBase * PENSION_ACCRUAL_RATE * serviceYears;
  return {
    monthly: Math.min(MAX_PENSION, Math.max(MIN_PENSION, uncapped)),
    uncapped,
    cappedAtMin: uncapped < MIN_PENSION,
    cappedAtMax: uncapped > MAX_PENSION,
  };
}
