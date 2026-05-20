// Pure Bulgarian personal-tax math for the budget tax-bill calculator.
// All amounts in EUR — pre-2026 BGN figures were converted at the locked
// 1.95583 parity at ingest, 2026-onward is euro-native. These are
// illustrative defaults; see the caveats rendered by BudgetTaxCalculator.

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
export const MIN_PENSION = 322.37;
export const MAX_PENSION = 1738.4;

// Minimum monthly insurable income for self-insured persons (2026).
export const MIN_SELF_INSURED_INCOME = 550.66;

// Child tax relief — annual taxable-base reduction by number of children
// (key 3 = "three or more"). 6 000 / 12 000 / 18 000 BGN at the locked
// parity; relief actually received is the PIT rate (10%) of these.
export const CHILD_RELIEF_BASE: Record<number, number> = {
  0: 0,
  1: 3067.75,
  2: 6135.5,
  3: 9203.25,
};

// Максимален осигурителен доход — monthly cap on insurable income, by
// fiscal year. Where the cap moved mid-year (2022, 2025) the value in force
// for the longer part of the year is used.
export const MOD_BY_YEAR: Record<number, number> = {
  2018: 1329,
  2019: 1534,
  2020: 1534,
  2021: 1534,
  2022: 1738,
  2023: 1738,
  2024: 1917,
  2025: 2112,
  2026: 2112,
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
}

// Resolve the МОД for a fiscal year. Years outside the table snap to the
// nearest known year, and the resolution reports THAT year — so a caller
// labelling the value never claims a year whose cap it isn't showing.
export function resolveMod(year: number | null | undefined): ModResolution {
  if (year == null)
    return {
      mod: MOD_BY_YEAR[LATEST_MOD_YEAR],
      year: LATEST_MOD_YEAR,
      exact: false,
    };
  if (MOD_BY_YEAR[year] != null)
    return { mod: MOD_BY_YEAR[year], year, exact: true };
  const snapped = year < MOD_YEARS[0] ? MOD_YEARS[0] : LATEST_MOD_YEAR;
  return { mod: MOD_BY_YEAR[snapped], year: snapped, exact: false };
}

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
