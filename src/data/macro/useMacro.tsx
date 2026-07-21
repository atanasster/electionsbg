import { useQuery } from "@tanstack/react-query";
import { dataUrl } from "@/data/dataUrl";

export type MacroIndicatorKey =
  // Eurostat — economy (quarterly)
  | "gdpGrowth"
  | "inflation"
  | "unemployment"
  // Eurostat — unemployment at monthly cadence (une_rt_m, SA) — the freshest
  // headline reading, plotted as the main labour-panel line
  | "unemploymentMonthly"
  // Eurostat — labour market (quarterly SA employment/activity rate; slack
  // annual, % of extended labour force)
  | "employmentRate"
  | "activityRate"
  | "labourSlack"
  // Eurostat — fiscal / external (quarterly)
  | "govDebt"
  | "budgetBalance"
  | "currentAccount"
  // Eurostat — authoritative annual ESA deficit/surplus ratio from the EDP
  // notification (gov_10dd_edpt1). Read THIS for the per-year headline deficit,
  // never a sum of the quarterly budgetBalance SCA series (which drifts
  // 0.1-0.5pp from the official annual).
  | "esaBalanceAnnual"
  // Eurostat — fiscal / external in nominal EUR (quarterly)
  | "govDebtNominal"
  | "budgetBalanceNominal"
  | "currentAccountNominal"
  | "govRevenue"
  | "govExpenditure"
  // Derived client-side from govDebtNominal — net new debt issued per quarter
  | "debtIssuance"
  // Minfin КФП — fiscal reserve (stock of cash, quarter-end, EUR million)
  | "fiscalReserve"
  // Minfin КФП — cash budget balance (annual, EUR million; the headline cash
  // deficit/surplus, distinct from the ESA budgetBalanceNominal above)
  | "cashBalance"
  // Minfin — overdue obligations / просрочени задължения (annual year-end stock)
  | "arrears"
  // Eurostat — FDI (annual, BPM6)
  | "fdiInward"
  // Eurostat — HICP breakdown (quarterly)
  | "inflationFood"
  | "inflationEnergy"
  | "inflationServices"
  | "inflationCore"
  // Eurostat — activity (quarterly, index 2021=100)
  | "industrialProd"
  | "retailVolume"
  // Eurostat — sentiment (quarterly)
  | "consumerConfidence"
  | "economicSentiment"
  // Eurostat — labour income (quarterly, YoY derived)
  | "labourIncome"
  // Eurostat — social (quarterly / annual)
  | "youthUnemployment"
  | "housePricesYoY"
  | "gini"
  | "povertyRate"
  // Eurostat — criminal justice (annual)
  | "intentionalHomicideRate"
  | "prisonPopulationRate"
  // Eurostat — annual
  | "gdpPerCapita"
  | "nominalGdp"
  // World Bank — governance (WGI, -2.5 to +2.5, annual)
  | "wgiRuleOfLaw"
  | "wgiControlOfCorruption"
  | "wgiGovEffectiveness"
  // Curated (annual)
  | "cpi"
  | "trustParliament"
  | "trustGovernment"
  | "trustEu"
  | "euFunds"
  | "euContribution";

export type MacroCadence = "annual" | "quarterly" | "monthly";

// Quarterly points carry `quarter` (1-4) and a denormalised `period`
// ("YYYY-Q[1-4]"); monthly points carry `month` (1-12) and period "YYYY-MM".
// Annual points have none — consumers that only read {year,value} keep
// working transparently.
export type MacroPoint = {
  year: number;
  value: number;
  quarter?: 1 | 2 | 3 | 4;
  month?: number;
  period?: string;
};

export type MacroIndicatorMeta = {
  titleEn: string;
  titleBg: string;
  unitLabelEn: string;
  unitLabelBg: string;
  cadence?: MacroCadence;
  source?: "eurostat" | "worldbank" | "curated";
  sourceUrl?: string;
  datasetCode?: string;
  attributionEn?: string;
  attributionBg?: string;
};

// A fresher single reading pulled from a monthly Eurostat dataset, attached to
// a quarterly series (currently only `unemployment`). The chart stays quarterly
// but the UI can surface this newest month as a callout.
export type MacroMonthlyLatest = {
  period: string; // "YYYY-MM"
  year: number;
  month: number;
  value: number;
  seasonallyAdjusted: boolean;
  datasetCode: string;
  sourceUrl: string;
};

export type MacroPayload = {
  sources: Record<string, string>;
  fetchedAt: string;
  country: string;
  indicators: Record<MacroIndicatorKey, MacroIndicatorMeta>;
  series: Record<MacroIndicatorKey, MacroPoint[]>;
  // Optional — absent on older data/macro.json before the monthly-latest
  // garnish shipped. Keyed by MacroIndicatorKey.
  latestMonthly?: Partial<Record<MacroIndicatorKey, MacroMonthlyLatest>>;
};

// Position a macro point on a fractional-year x-axis. Annual points sit at
// mid-year (year+0.5); quarterly points at mid-quarter (.125, .375, .625,
// .875); monthly points at mid-month (month m → year+(m-1)/12+1/24). This
// aligns dots with the calendar interval the value describes and makes cabinet
// bands (already fractional) and election lines line up at any resolution.
export const pointToFractionalX = (p: MacroPoint): number => {
  if (p.month) return p.year + (p.month - 1) / 12 + 1 / 24;
  if (p.quarter) return p.year + (p.quarter - 1) * 0.25 + 0.125;
  return p.year + 0.5;
};

const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

// Reverse: best-effort label for a fractional x. Used in chart tooltips so the
// user sees "2024 May", "2024 Q2", or "2024" rather than the raw number.
//
// Quarter is tried FIRST (with a tight tolerance) so that on the many
// quarterly-only charts a Q-center x still reads "Q2", never a month —
// crucial because quarter centers (.125/.375/.625/.875) coincide exactly with
// the Feb/May/Aug/Nov month centers. Only genuinely off-quarter month centers
// fall through to a month label; anything else degrades to the bare year.
export const labelForFractionalX = (x: number): string => {
  const year = Math.floor(x);
  const frac = x - year;
  if (Math.abs(frac - 0.5) < 0.01) return `${year}`;
  // Quarter centers: (q-1)*0.25 + 0.125.
  const qFloat = (frac - 0.125) / 0.25;
  const q = Math.round(qFloat);
  if (q >= 0 && q <= 3 && Math.abs(qFloat - q) < 0.02) {
    return `${year} Q${q + 1}`;
  }
  // Month centers: (m-1)/12 + 1/24.
  const mFloat = (frac - 1 / 24) * 12;
  const m = Math.round(mFloat);
  if (m >= 0 && m <= 11 && Math.abs(mFloat - m) < 0.02) {
    return `${year} ${MONTH_NAMES[m]}`;
  }
  return `${year}`;
};

const fetchJson = async <T,>(path: string): Promise<T | undefined> => {
  const res = await fetch(dataUrl(path));
  if (!res.ok) return undefined;
  return (await res.json()) as T;
};

export const useMacro = () =>
  useQuery({
    queryKey: ["macro"],
    queryFn: () => fetchJson<MacroPayload>("/macro.json"),
  });
