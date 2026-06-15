// National tax-policy simulator (/budget/simulator). Move a rate, see what
// happens to consolidated budget revenue AND to one worked payslip — the two
// numbers every "да вдигнем/намалим данъка" debate needs side by side.
//
// Two scoring modes. STATIC (fixed tax base at the latest closed fiscal
// year, no behavioral response) through src/lib/bgTaxPolicy.ts over the
// baseline file assembled offline by run_policy_baseline.ts. DYNAMIC (the
// default) adds src/lib/bgBehavioral.ts on top: per-lever base responses
// (Tier 1), a reduced-form macro feedback in the projection (Tier 2) and a
// seeded Monte-Carlo 90% band on the headline. The VAT side runs the COICOP
// consumption model bridged by the calibration factor validated year-by-year
// against actual ДДС revenue; МОД-cap raises carry an explicit uncertainty
// band (Pareto tail α). Same two-pane shell and query-string mirroring as
// BudgetTaxCalculator, so scenarios are shareable links — `mode=static`
// pins the static view, the goal gauge target travels via `goal=`.

import { FC, ReactNode, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  SlidersHorizontal,
  Link2,
  Check,
  RotateCcw,
  Landmark,
  User,
  Users,
  Info,
  Sparkles,
  Copy,
  ChevronDown,
  Globe,
  Target,
  ImageDown,
  Vote,
  BookOpen,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/ux/Card";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { formatEur } from "@/lib/currency";
import { GROUP_URL } from "@/lib/community";
import {
  PIT_RATE,
  CORP_TAX_RATE,
  DIVIDEND_TAX_RATE,
  VAT_STANDARD_RATE,
  SSC_EMPLOYEE_RATE,
  resolveMod,
} from "@/lib/bgTax";
import {
  VAT_ADJUSTABLE_GROUPS,
  VAT_GROUP_DEFAULT_REGIME,
  VAT_REDUCED_RATE,
  computeVatRevenue,
  giniOnBands,
  pitMonthlyUnderBrackets,
  scoreCorporate,
  scoreDividend,
  scoreExciseRate,
  scoreWineExcise,
  scoreGamblingGgr,
  GAMBLING_GGR_FEE_RATE,
  EXCISE_DIESEL_RATE,
  EXCISE_PETROL_RATE,
  EXCISE_CIGARETTE_RATE,
  EXCISE_SPIRITS_RATE,
  SPIRITS_SHARE_OF_ALCOHOL,
  scoreAdminCut,
  scoreCapitalChange,
  scoreDefenseTarget,
  scoreHealthContribution,
  scoreMinWageFreeze,
  scoreSscSelfPaid,
  scoreWageIndexation,
  scoreModCap,
  scoreModCapBands,
  scorePensionFloorRaise,
  scorePensionIndexation,
  scorePitSchedule,
  scoreTeachersPeg,
  scoreMaternityMonths,
  scoreMpPayFreeze,
  scorePartySubsidy,
  MATERNITY_Y2_MONTHS,
  MATERNITY_Y2_BENEFIT_EUR_MO,
  MATERNITY_Y2_SPEND_EUR,
  PARTY_SUBSIDY_RATE_EUR,
  type PitBracket,
  type VatAdjustableGroup,
  type VatBaseSlice,
  type VatPolicy,
  type VatRegime,
} from "@/lib/bgTaxPolicy";
import { usePolicyBaseline } from "@/data/budget/useBudget";
import {
  devSubmitBlocked,
  markScenarioSubmitted,
  usePublicScenarioStats,
  useSubmitScenario,
  wasScenarioSubmitted,
} from "@/data/budget/usePublicScenarios";
import { useCofog } from "@/data/macro/useCofog";
import {
  NOMINAL_GDP_2026_EUR,
  PROJECTION_YEARS,
  projectFiscalPath,
} from "@/lib/bgFiscalProjection";
import {
  MC_DRAWS,
  MC_SEED,
  buildDynamicInput,
  computeDynamicScenario,
  sampleDraws,
} from "@/lib/bgBehavioral";
import {
  PolicyIncidenceCurve,
  type IncidencePoint,
} from "./PolicyIncidenceCurve";
import { PolicyDecileStrip } from "./PolicyDecileStrip";
import { PolicyFiscalProjection } from "./PolicyFiscalProjection";
import { downloadShareCard } from "./policyShareCard";
import { fmtCompactEur, fmtDelta, fmtPct1 } from "./budgetFormat";
import { EuFlag } from "./EuFlag";
import {
  COUNTRY_PROFILES,
  EU_LEVER_PRESETS,
  type CountryProfile,
  type EuLeverId,
  type EuPresetApply,
  type EuPresetOption,
} from "@/lib/euPolicyPresets";

// Slider bounds, all in integer percent (МОД in EUR/month). Defaults are
// current law; defaults are omitted from the query string.
const VAT_STD_DEF = Math.round(VAT_STANDARD_RATE * 100);
const VAT_RED_DEF = Math.round(VAT_REDUCED_RATE * 100);
const PIT_DEF = Math.round(PIT_RATE * 100);
const CORP_DEF = Math.round(CORP_TAX_RATE * 100);
const DIV_DEF = Math.round(DIVIDEND_TAX_RATE * 100);
// МОД slider grid: anchored on the CURRENT cap so the default is always a
// reachable slider value (a fixed min like 1200 with step 50 would make
// €2,112 unreachable — once touched, the slider could never drag back to
// "no change"). Lowering is scoreable too (the fitted earnings distribution
// provides the below-cap density), down to ~€1,200 where the model's body
// anchors stop being meaningful.
const MOD_STEP = 50;
const MOD_STEPS_DOWN = 18; // ≈ €900 below the cap
const MOD_STEPS_UP = 78; // ≈ €3,900 above the cap
const GROSS_DEF = 1100;

// Bracket-control bounds (monthly, on the post-SSC taxable base). NM_MAX
// reaches €1,700 so Ireland's credit-equivalent allowance (~€1,667) fits; the
// second-bracket grid reaches €8,000 / 55% so the steeply progressive country
// profiles (FR €7,048 threshold, SE 52% top rate) land on the slider.
const NM_MAX = 1700;
const T2_DEF = 3000;
const R2_DEF = 15;
// Defence lever default (tenths of % GDP) = current-law BG share. NATO 2025
// estimate is 2.06% → 21 on the tenths grid; keep in step with the baseline's
// defense.natoPctGdp (run_policy_baseline.ts) and NATO_COMPENDIUM_EDITION.
const DEF_DEF = 21;

// Party-subsidy slider unit is euro-cents; the default derives from the
// engine's current-law rate so a future law change flows to the baseline
// and the slider's "no change" position in one edit.
const PSUB_DEF = Math.round(PARTY_SUBSIDY_RATE_EUR * 100);

// Excise levers — ABSOLUTE rates in the product's real unit (like VAT/PIT), each
// with an EU-country comparator. Defaults are the current BG rate, so the lever
// Δ is 0 at the default. Floors are the EU minimum (you can't legally go below);
// maxima reach the highest EU rate so the "like in <country>" picks are in range.
// Diesel/petrol: €/1000 L; cigarettes: €/1000; spirits: €/hl; wine: €/hl.
const DIESEL_DEF = EXCISE_DIESEL_RATE; // 330 (= EU floor; BG sits on it)
const DIESEL_MAX = 700;
const PETROL_DEF = EXCISE_PETROL_RATE; // 363
const PETROL_MIN = 359; // EU floor
const PETROL_MAX = 900;
const CIG_DEF = EXCISE_CIGARETTE_RATE; // 114
const CIG_MIN = 90; // EU floor
const CIG_MAX = 550;
const SPIRITS_DEF = EXCISE_SPIRITS_RATE; // 562
const SPIRITS_MIN = 550; // EU floor
const SPIRITS_MAX = 5100;
// Step 1 (€) so the current-law default AND every EU "like in…" country value
// land exactly on the grid — a coarser step would snap 363→364, 562→550 etc.,
// leaving the thumb off the shown value (and off the picked country's rate).
const EXCISE_STEP = 1; // €/1000 L, €/1000, €/hl
const SPIRITS_STEP = 1;
const WINE_MAX = 450; // €/hl (IE ≈ €425 highest; FR ≈ €4, NL ≈ €88)
const WINE_STEP = 1;

// Gambling: the ЗХ variable fee on GGR. Default = current 2026 law (25%, raised
// from 20%); the grid lets you revert down or push up into the offshore-flight
// (Laffer) zone.
const GAMBLING_DEF = Math.round(GAMBLING_GGR_FEE_RATE * 100); // 25
const GAMBLING_MAX = 40;

// Exemplar payslips in the citizen pane: minimum wage, ~average, upper
// professional, above-cap.
const EXEMPLAR_GROSS = [620, 1250, 2500, 5000];

// Citizen-pane assumption: share of net income spent on VAT-carrying
// consumption (mirrors the tax calculator's default).
const CITIZEN_CONSUMPTION_SHARE = 0.75;

// One-tap preset scenarios — the recurring proposals of the Bulgarian tax
// debate (the taxjusticenow pattern: evaluate real proposals, not abstract
// sliders). Applying one resets everything else to current law first.
interface PresetApply {
  nm?: number;
  b2?: { t2: number; r2: number };
  regimes?: Partial<Record<VatAdjustableGroup, VatRegime>>;
  noCap?: boolean;
  /** Swiss-rule CPI weight, % (default 50). */
  pw?: number;
  adm?: number;
  mrzFreeze?: boolean;
  /** Months of paid second-year maternity kept (current law: 12). */
  mat?: number;
  /** Civil servants pay their own contribution share (КСО art. 6(5)). */
  ssp?: boolean;
}
const PRESETS: { id: string; apply: PresetApply }[] = [
  { id: "nm_mrz", apply: { nm: 620 } },
  { id: "progressive", apply: { b2: { t2: 2000, r2: 20 } } },
  { id: "food9", apply: { regimes: { food: "reduced" } } },
  { id: "restaurants9", apply: { regimes: { restaurants: "reduced" } } },
  { id: "nocap", apply: { noCap: true } },
  { id: "cpionly", apply: { pw: 100 } },
  { id: "admin10", apply: { adm: 10 } },
  { id: "ssp", apply: { ssp: true } },
  { id: "maternity1", apply: { mat: 0 } },
];

type Baseline = NonNullable<ReturnType<typeof usePolicyBaseline>["data"]>;

// Every lever position the static scorer reads. The live scenario builds this
// from component state; the preset myth-buster weights build it from
// NEUTRAL_LEVERS + the preset's overrides. Both then go through the SAME
// computeStaticScenario, so a chip can never promise a number the breakdown
// below it then contradicts.
interface LeverState {
  vatStd: number;
  vatRedEff: number;
  regimes: Partial<Record<VatAdjustableGroup, VatRegime>>;
  pit: number;
  nm: number;
  bracket2: boolean;
  t2Eff: number;
  r2: number;
  corp: number;
  div: number;
  mod: number;
  noCap: boolean;
  currentCap: number;
  pw: number;
  noSupp: boolean;
  ph: number;
  adm: number;
  mrzFreeze: boolean;
  def: number;
  wi: number;
  wex: boolean;
  kap: number;
  ssp: boolean;
  sspg: boolean;
  hp: number;
  mpEff: number;
  mpDef: number;
  tpEff: number;
  tpDef: number;
  mat: number;
  mpf: boolean;
  psub: number;
  /** Excise rates, absolute (diesel/petrol €/1000 L, cigarettes €/1000,
   *  spirits €/hl); defaults = current BG rate. */
  diesel: number;
  petrol: number;
  cigarettes: number;
  spirits: number;
  /** Introduced still-wine excise, €/hl (0 = current €0). */
  wine: number;
  /** Gambling GGR fee, integer % (25 = current law). */
  gambling: number;
}

// THE single static-scoring path. Returns each lever's static EUR delta
// (balance convention: positive = the budget improves) plus the `central`
// total and the MC band edges. Pure — depends only on the baseline and the
// lever state. Returns null until the baseline's VAT slices + earnings bands
// are loaded.
const computeStaticScenario = (baseline: Baseline, s: LeverState) => {
  const vat = baseline.vat;
  const earnings = baseline.earnings;
  if (!vat?.slices || !earnings?.bands) return null;
  const slices = vat.slices as VatBaseSlice[];
  const currentPolicy: VatPolicy = {
    standardRate: VAT_STANDARD_RATE,
    reducedRate: VAT_REDUCED_RATE,
    regimes: {},
  };
  const policy: VatPolicy = {
    standardRate: s.vatStd / 100,
    reducedRate: s.vatRedEff / 100,
    regimes: s.regimes,
  };
  const vatBaseRun = computeVatRevenue(slices, currentPolicy);
  const vatRun = computeVatRevenue(slices, policy);
  const vatDelta = (vatRun.modeledEur - vatBaseRun.modeledEur) * vat.factor;

  // ДДФЛ: the employment portion is scored over the fitted earnings bands
  // (so untaxed-minimum / second-bracket schedules work), non-employment
  // income scales with the schedule's base rate.
  const brackets: PitBracket[] = [];
  if (s.nm > 0) brackets.push({ fromEur: 0, rate: 0 });
  brackets.push({ fromEur: s.nm, rate: s.pit / 100 });
  if (s.bracket2) brackets.push({ fromEur: s.t2Eff, rate: s.r2 / 100 });
  const pitEmploymentDelta = scorePitSchedule(
    earnings.bands,
    earnings.capEur,
    brackets,
    earnings.kappa,
  );
  const pitNonEmploymentDelta =
    baseline.revenue.pitEur *
    baseline.revenue.pitNonEmploymentShare *
    (s.pit / 100 / PIT_RATE - 1);
  const pitDelta = pitEmploymentDelta + pitNonEmploymentDelta;

  const corpDelta = scoreCorporate(baseline.revenue.corporateEur, s.corp / 100);
  const divDelta = scoreDividend(baseline.revenue.dividendEur, s.div / 100);

  // Excise (fixed-base static deltas; demand/cross-border response is Tier-1
  // behavioral). Per-product absolute rates scale their revenue line; the
  // cigarette rate scales the whole tobacco line, the spirits rate scales the
  // spirits share of the alcohol line; wine is introduced from €0.
  const dieselDelta = scoreExciseRate(
    baseline.revenue.exciseDieselEur ?? 0,
    DIESEL_DEF,
    s.diesel,
  );
  const petrolDelta = scoreExciseRate(
    baseline.revenue.excisePetrolEur ?? 0,
    PETROL_DEF,
    s.petrol,
  );
  const cigarettesDelta = scoreExciseRate(
    baseline.revenue.exciseTobaccoEur ?? 0,
    CIG_DEF,
    s.cigarettes,
  );
  const spiritsDelta = scoreExciseRate(
    (baseline.revenue.exciseAlcoholEur ?? 0) * SPIRITS_SHARE_OF_ALCOHOL,
    SPIRITS_DEF,
    s.spirits,
  );
  const wineDelta = s.wine > 0 ? scoreWineExcise(s.wine) : 0;
  const exciseDelta =
    dieselDelta + petrolDelta + cigarettesDelta + spiritsDelta + wineDelta;

  // Gambling ЗХ GGR fee (level lever; offshore/illicit migration is Tier-1
  // behavioral). Industry-reported base — not a КФП line.
  const gamblingDelta =
    s.gambling !== GAMBLING_DEF ? scoreGamblingGgr(s.gambling / 100) : 0;

  // МОД: central from the band model (works in both directions and knows
  // the schedule's base rate for the deduction interaction); the range
  // comes from the closed-form Pareto α band when raising, and a flat
  // ±15% model margin when lowering (the body is far better anchored
  // than the tail, but it is still a fitted shape).
  const targetCap = s.noCap ? Infinity : s.mod;
  const modBands = scoreModCapBands(
    earnings.bands,
    s.currentCap,
    targetCap,
    s.pit / 100,
  );
  let modRes: { centralEur: number; lowEur: number; highEur: number };
  if (targetCap >= s.currentCap) {
    const cf = scoreModCap(baseline.modIdentity, targetCap, s.currentCap);
    modRes = {
      centralEur: modBands.totalEur,
      lowEur: Math.min(cf.lowEur, cf.highEur, modBands.totalEur),
      highEur: Math.max(cf.lowEur, cf.highEur, modBands.totalEur),
    };
  } else {
    modRes = {
      centralEur: modBands.totalEur,
      lowEur: modBands.totalEur * 1.15,
      highEur: modBands.totalEur * 0.85,
    };
  }

  // Expenditure levers (balance convention: positive = budget improves).
  const exp = baseline.expenditure;
  const pensionDeltaSpend = exp
    ? scorePensionIndexation(exp.pensions, {
        cpiWeight: s.pw / 100,
        indexSupplement: !s.noSupp,
        horizonYears: s.ph,
      })
    : 0;
  const adminRes =
    exp && s.adm > 0 ? scoreAdminCut(exp.administration, s.adm / 100) : null;
  const adminDeltaSpend = adminRes ? adminRes.netEur : 0;
  const mwDelta =
    exp && s.mrzFreeze ? scoreMinWageFreeze(earnings.bands, exp.minWage) : 0;
  // Priced against the projection module's 2026 GDP so the defense lever
  // and the projection card never quote two different GDPs.
  const defDelta =
    exp && s.def !== DEF_DEF
      ? scoreDefenseTarget(
          NOMINAL_GDP_2026_EUR,
          exp.defense.natoPctGdp,
          s.def / 10,
        )
      : 0;
  const wiDelta =
    exp && s.wi !== 0
      ? scoreWageIndexation(
          exp.personnel.massEur,
          exp.personnel.exemptShare,
          s.wi,
          s.wex,
        )
      : 0;
  const kapDelta =
    exp && s.kap !== 0
      ? scoreCapitalChange(
          exp.capital.planEur,
          exp.capital.executionRate,
          s.kap,
        )
      : 0;
  const sspDelta =
    exp && s.ssp
      ? scoreSscSelfPaid(
          exp.sscSelfPaid.count,
          exp.sscSelfPaid.avgWageEur,
          s.sspg,
        )
      : 0;
  const hpDelta =
    exp && s.hp !== 0 ? scoreHealthContribution(exp.health.baseEur, s.hp) : 0;
  // Pension floor: top-up to the new minimum for every pensioner below it.
  const mpDeltaSpend =
    exp?.pensionFloor && s.mpEff !== s.mpDef
      ? scorePensionFloorRaise(
          exp.pensionFloor.bands,
          exp.pensionFloor.minimumEur,
          s.mpEff,
        )
      : 0;
  // Teachers' peg: move the (proxy) ratio to the target % of the economy
  // average — negative below the current ratio (a saving).
  const tpDeltaSpend =
    exp?.teachers && s.tpEff !== s.tpDef
      ? scoreTeachersPeg(
          exp.teachers.count,
          exp.teachers.economyWageEur,
          exp.teachers.currentRatio,
          s.tpEff,
        )
      : 0;
  // June-2026 debate levers (Δ spending; negative = the budget saves).
  const matDeltaSpend =
    s.mat !== MATERNITY_Y2_MONTHS ? scoreMaternityMonths(s.mat) : 0;
  const mpfDeltaSpend =
    exp && s.mpf ? scoreMpPayFreeze(exp.pensions.wageGrowthPct) : 0;
  const psubDeltaSpend =
    s.psub !== PSUB_DEF ? scorePartySubsidy(s.psub / 100) : 0;
  // The non-pension expenditure slice (the Tier-2 spending impulse):
  // pensions ride the projection's fixed path, МРЗ/health are revenue-side.
  const expenditureNonPensionBalance = -(
    adminDeltaSpend +
    defDelta +
    wiDelta +
    kapDelta +
    sspDelta +
    mpDeltaSpend +
    tpDeltaSpend +
    matDeltaSpend +
    mpfDeltaSpend +
    psubDeltaSpend
  );
  const expenditureBalance =
    expenditureNonPensionBalance - pensionDeltaSpend + mwDelta + hpDelta;

  const central =
    vatDelta +
    pitDelta +
    corpDelta +
    divDelta +
    exciseDelta +
    gamblingDelta +
    modRes.centralEur +
    expenditureBalance;
  const low =
    vatDelta +
    pitDelta +
    corpDelta +
    divDelta +
    exciseDelta +
    gamblingDelta +
    expenditureBalance +
    Math.min(modRes.lowEur, modRes.highEur);
  const high =
    vatDelta +
    pitDelta +
    corpDelta +
    divDelta +
    exciseDelta +
    gamblingDelta +
    expenditureBalance +
    Math.max(modRes.lowEur, modRes.highEur);

  // Household effective VAT take per euro of taxable consumption — drives
  // the citizen pane's VAT line.
  const taxableBase = slices.reduce(
    (acc, sl) => (sl.regime !== null ? acc + sl.valueEur : acc),
    0,
  );
  const vatFractionBase = vatBaseRun.modeledEur / taxableBase;
  const vatFractionNew = vatRun.modeledEur / taxableBase;

  return {
    vatDelta,
    pitDelta,
    pitEmploymentDelta,
    pitNonEmploymentDelta,
    corpDelta,
    divDelta,
    dieselDelta,
    petrolDelta,
    cigarettesDelta,
    spiritsDelta,
    wineDelta,
    gamblingDelta,
    modRes,
    brackets,
    expenditureNonPensionBalance,
    pensionBalance: -pensionDeltaSpend,
    adminBalance: -adminDeltaSpend,
    adminRes,
    mwDelta,
    defBalance: -defDelta,
    wiBalance: -wiDelta,
    kapBalance: -kapDelta,
    sspBalance: -sspDelta,
    hpDelta,
    mpBalance: -mpDeltaSpend,
    tpBalance: -tpDeltaSpend,
    matBalance: -matDeltaSpend,
    mpfBalance: -mpfDeltaSpend,
    psubBalance: -psubDeltaSpend,
    central,
    low,
    high,
    vatFractionBase,
    vatFractionNew,
  };
};

// Lever positions at which every score* call returns 0 — the baseline the
// preset weights perturb. A preset overrides only the fields it touches, so
// the result is exactly the sum of just those levers.
const NEUTRAL_LEVERS = (currentCap: number): LeverState => ({
  vatStd: VAT_STANDARD_RATE * 100,
  vatRedEff: VAT_REDUCED_RATE * 100,
  regimes: {},
  pit: PIT_DEF,
  nm: 0,
  bracket2: false,
  t2Eff: T2_DEF,
  r2: R2_DEF,
  corp: CORP_DEF,
  div: DIV_DEF,
  mod: currentCap,
  noCap: false,
  currentCap,
  pw: 50,
  noSupp: false,
  ph: 1,
  adm: 0,
  mrzFreeze: false,
  def: DEF_DEF,
  wi: 0,
  wex: false,
  kap: 0,
  ssp: false,
  sspg: false,
  hp: 0,
  mpEff: 0,
  mpDef: 0,
  tpEff: 0,
  tpDef: 0,
  mat: MATERNITY_Y2_MONTHS,
  mpf: false,
  psub: PSUB_DEF,
  diesel: DIESEL_DEF,
  petrol: PETROL_DEF,
  cigarettes: CIG_DEF,
  spirits: SPIRITS_DEF,
  wine: 0,
  gambling: GAMBLING_DEF,
});

// Static central effect of one preset in isolation — the myth-buster weight
// in its chip tooltip ("covers X% of the 2026 deficit"). Routes through the
// same computeStaticScenario the live breakdown uses, so the chip's number
// is the number the breakdown then shows.
const presetStaticEur = (baseline: Baseline, p: PresetApply): number => {
  const s = NEUTRAL_LEVERS(resolveMod(null).mod);
  if (p.nm != null) s.nm = p.nm;
  if (p.b2) {
    s.bracket2 = true;
    s.t2Eff = p.b2.t2;
    s.r2 = p.b2.r2;
  }
  if (p.regimes) s.regimes = p.regimes;
  if (p.noCap) s.noCap = true;
  if (p.pw != null) s.pw = p.pw;
  if (p.adm != null) s.adm = p.adm;
  if (p.mrzFreeze) s.mrzFreeze = true;
  if (p.mat != null) s.mat = p.mat;
  if (p.ssp) s.ssp = true;
  return computeStaticScenario(baseline, s)?.central ?? 0;
};

// Goal missions for the scoreboard hero (the CRFB/Fiscal-Ship pattern: a
// number moving toward a target, not floating in space). `edp` tracks the
// first projection year's balance against the −3% Maastricht reference the
// EC's EDP recommendation is anchored to; `debt` tracks end-of-horizon debt;
// `def` is a constrained mission — reach 3% NATO defense without widening
// the deficit beyond the baseline.
type GoalId = "edp" | "debt" | "def";
const GOAL_IDS: GoalId[] = ["edp", "debt", "def"];
const GOAL_DEF = "edp" as const;
const parseGoalParam = (raw: string | null): GoalId =>
  raw === "debt" || raw === "def" ? raw : GOAL_DEF;
const EDP_TARGET_PCT = -3;
const DEBT_TARGET_PCT = 40;
const DEF_TARGET_TENTHS = 30; // 3.0% of GDP on the def slider's tenths grid

// Public-tally chips: scenario query-string param → the breakdown-row i18n
// key its lever displays under (budget_policy_row_<key>).
const PARAM_ROW_KEY: Record<string, string> = {
  dds: "vat",
  ddsr: "vat",
  food: "vat",
  medicines: "vat",
  energy: "vat",
  restaurants: "vat",
  hotels: "vat",
  books: "vat",
  pit: "pit",
  nm: "pit",
  b2: "pit",
  t2: "pit",
  r2: "pit",
  corp: "corp",
  div: "div",
  dies: "excise",
  petr: "excise",
  cig: "excise",
  spir: "excise",
  winex: "excise",
  haz: "gambling",
  mod: "mod",
  nocap: "mod",
  pw: "pensions",
  ks: "pensions",
  ph: "pensions",
  adm: "admin",
  mrz: "mrz",
  def: "def",
  wi: "wi",
  wex: "wi",
  kap: "kap",
  ssp: "ssp",
  sspg: "ssp",
  hp: "hp",
  mp: "mp",
  tp: "tp",
  mat: "mat",
  mpf: "mpf",
  psub: "psub",
};

// Horizontal goal gauge: a track from "today" to the target line, with the
// scenario marker moving along it. Values are pre-oriented by the caller so
// RIGHT is always "better" (`flip` for lower-is-better measures).
const GoalGauge: FC<{
  before: number;
  after: number;
  target: number;
  flip?: boolean;
  met: boolean;
  fmt: (v: number) => string;
  labelBefore: string;
  labelAfter: string;
  labelTarget: string;
}> = ({
  before,
  after,
  target,
  flip,
  met,
  fmt,
  labelBefore,
  labelAfter,
  labelTarget,
}) => {
  const lo = Math.min(before, after, target);
  const hi = Math.max(before, after, target);
  const pad = Math.max((hi - lo) * 0.25, 0.4);
  const min = lo - pad;
  const max = hi + pad;
  const pos = (v: number): number => {
    const p = ((v - min) / (max - min)) * 100;
    return flip ? 100 - p : p;
  };
  // Keep the marker labels inside the card on extreme scenarios.
  const clampLabel = (p: number): number => Math.max(6, Math.min(94, p));
  return (
    <div className="relative h-[54px]" aria-hidden="true">
      <div className="absolute left-0 right-0 top-[22px] h-2 rounded-full bg-muted" />
      {/* progress fill from today's marker toward the scenario marker */}
      <div
        className={
          "absolute top-[22px] h-2 rounded-full " +
          (met ? "bg-emerald-500/80" : "bg-indigo-500/70")
        }
        style={{
          left: `${Math.min(pos(before), pos(after))}%`,
          width: `${Math.abs(pos(after) - pos(before))}%`,
        }}
      />
      {/* target finish line */}
      <div
        className="absolute top-[12px] h-7 w-0.5 bg-foreground/60"
        style={{ left: `${pos(target)}%` }}
      />
      <div
        className="absolute top-0 -translate-x-1/2 whitespace-nowrap text-[10px] text-muted-foreground"
        style={{ left: `${clampLabel(pos(target))}%` }}
      >
        {labelTarget}
      </div>
      {/* today */}
      <div
        className="absolute top-[18px] h-4 w-4 -translate-x-1/2 rounded-full border-2 border-muted-foreground bg-background"
        style={{ left: `${pos(before)}%` }}
        title={labelBefore}
      />
      <div
        className="absolute top-[40px] -translate-x-1/2 whitespace-nowrap text-[10px] text-muted-foreground tabular-nums"
        style={{ left: `${clampLabel(pos(before))}%` }}
      >
        {labelBefore} {fmt(before)}
      </div>
      {/* scenario */}
      <div
        className={
          "absolute top-[18px] h-4 w-4 -translate-x-1/2 rounded-full border-2 border-background " +
          (met ? "bg-emerald-500" : "bg-indigo-500")
        }
        style={{ left: `${pos(after)}%` }}
        title={labelAfter}
      />
      {Math.abs(pos(after) - pos(before)) > 8 ? (
        <div
          className={
            "absolute top-[40px] -translate-x-1/2 whitespace-nowrap text-[10px] font-medium tabular-nums " +
            (met
              ? "text-emerald-700 dark:text-emerald-400"
              : "text-indigo-700 dark:text-indigo-300")
          }
          style={{ left: `${clampLabel(pos(after))}%` }}
        >
          {labelAfter} {fmt(after)}
        </div>
      ) : null}
    </div>
  );
};

const clampIntParam = (
  raw: string | null,
  min: number,
  max: number,
  fallback: number,
): number => {
  if (raw == null) return fallback;
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
};

// Like clampIntParam but keeps one decimal place — for levers whose real-world
// values are fractional (corporate-tax rates: IE 12.5, SE 20.6) and would lose
// precision under integer rounding.
const clampDecimalParam = (
  raw: string | null,
  min: number,
  max: number,
  fallback: number,
): number => {
  if (raw == null) return fallback;
  const n = Math.round(Number(raw) * 10) / 10;
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
};

const REGIMES: VatRegime[] = ["standard", "reduced", "zero"];
const parseRegimeParam = (raw: string | null): VatRegime | null =>
  raw === "standard" || raw === "reduced" || raw === "zero" ? raw : null;

// Info tip that opens on BOTH hover (desktop) and click/tap (works on touch,
// where the old hover-only Tooltip was dead). A controlled Popover: hover-enter
// opens, hover-leave closes, and the trigger's click toggles it for touch.
const InfoTip: FC<{ text: string }> = ({ text }) => {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={text}
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => setOpen(false)}
          className="inline-flex shrink-0 align-middle text-muted-foreground/60 hover:text-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded"
        >
          <Info className="h-3 w-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        onOpenAutoFocus={(e) => e.preventDefault()}
        className="max-w-[280px] text-xs font-normal leading-snug"
      >
        {text}
      </PopoverContent>
    </Popover>
  );
};

// One labelled rate slider with a numeric badge and a reset-to-default hint.
// `info` replaces the plain hover tooltip with a richer node (the EU
// comparator popover) when provided.
const RateSlider: FC<{
  id: string;
  label: string;
  tip?: string;
  info?: ReactNode;
  min: number;
  max: number;
  value: number;
  defaultValue: number;
  onChange: (v: number) => void;
  suffix?: string;
  step?: number;
  /** Non-integer badge display (defense tenths, subsidy euro-cents);
   *  overrides `value`+`suffix`. */
  formatValue?: (v: number) => string;
}> = ({
  id,
  label,
  tip,
  info,
  min,
  max,
  value,
  defaultValue,
  onChange,
  suffix = "%",
  step = 1,
  formatValue,
}) => (
  <div>
    <label htmlFor={id} className="flex items-baseline justify-between gap-2">
      <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
        {label}
        {info ?? (tip ? <InfoTip text={tip} /> : null)}
      </span>
      <span
        className={
          "text-sm font-semibold tabular-nums " +
          (value !== defaultValue ? "text-indigo-700 dark:text-indigo-300" : "")
        }
      >
        {formatValue ? formatValue(value) : `${value}${suffix}`}
      </span>
    </label>
    <input
      id={id}
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="mt-1.5 w-full accent-indigo-500"
      aria-label={label}
    />
  </div>
);

// Per-tax result row: label, signed Δ, and a centered diverging bar.
const DeltaRow: FC<{
  label: string;
  deltaEur: number;
  maxAbs: number;
  lang: string;
  sub?: string;
  tip?: string;
}> = ({ label, deltaEur, maxAbs, lang, sub, tip }) => {
  const widthPct = maxAbs > 0 ? (Math.abs(deltaEur) / maxAbs) * 50 : 0;
  const positive = deltaEur >= 0;
  return (
    <li className="text-xs">
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate min-w-0">
          {label}
          {tip ? (
            <span className="ml-1 inline-flex align-middle">
              <InfoTip text={tip} />
            </span>
          ) : null}
        </span>
        <span
          className={
            "tabular-nums shrink-0 font-semibold " +
            (deltaEur > 0
              ? "text-emerald-700 dark:text-emerald-400"
              : deltaEur < 0
                ? "text-red-700 dark:text-red-400"
                : "text-muted-foreground")
          }
        >
          {fmtDelta(deltaEur, lang)}
        </span>
      </div>
      {/* The range annotation gets its own line — inline it crowds the row
          label off-screen on narrow viewports. */}
      {sub ? (
        <div className="text-right text-[10px] text-muted-foreground tabular-nums">
          {sub}
        </div>
      ) : null}
      <div className="mt-1 relative h-2 rounded bg-muted overflow-hidden">
        <div className="absolute left-1/2 top-0 h-full w-px bg-border" />
        <div
          className={
            "absolute top-0 h-full " +
            (positive ? "bg-emerald-500/70" : "bg-red-500/70")
          }
          style={
            positive
              ? { left: "50%", width: `${widthPct}%` }
              : { right: "50%", width: `${widthPct}%` }
          }
        />
      </div>
    </li>
  );
};

// Info popover for levers that carry EU comparators: the lever's
// description on top, then the country list — one (i) icon serves both,
// keeping the controls column compact. The applied pick is re-derived by
// the caller (it self-clears when the lever drifts off the country value).
const EuInfoPopover: FC<{
  text: string;
  lever: EuLeverId;
  lang: "bg" | "en";
  appliedId: string | null;
  onApply: (o: EuPresetOption) => void;
}> = ({ text, lever, lang, appliedId, onApply }) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const options = EU_LEVER_PRESETS[lever];
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={text}
          className="inline-flex shrink-0 align-middle text-muted-foreground/60 hover:text-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded"
        >
          <Info className="h-3 w-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[320px] p-3" align="start">
        <p className="text-xs font-normal leading-snug text-muted-foreground">
          {text}
        </p>
        <div className="mt-2 border-t pt-2">
          <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
            <Globe className="h-3 w-3" />
            {t("budget_policy_eu_label")}
          </div>
          <ul className="mt-1 space-y-0.5">
            {options.map((o) => (
              <li key={o.id}>
                <button
                  type="button"
                  onClick={() => {
                    onApply(o);
                    setOpen(false);
                  }}
                  className={
                    "flex w-full items-start gap-1.5 rounded px-1.5 py-1 text-left transition-colors hover:bg-muted " +
                    (o.id === appliedId ? "bg-indigo-500/10" : "")
                  }
                >
                  <EuFlag cc={o.cc} className="mt-[3px]" />
                  <span className="min-w-0">
                    <span
                      className={
                        "block text-xs leading-snug " +
                        (o.id === appliedId
                          ? "font-medium text-indigo-700 dark:text-indigo-300"
                          : "text-foreground")
                      }
                    >
                      {o.label[lang]}
                    </span>
                    <span className="block text-[10px] leading-snug text-muted-foreground">
                      {o.note[lang]}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </PopoverContent>
    </Popover>
  );
};

// Override shape for applyLevers — one field per policy-lever STATE setter
// (raw values, unlike the scoring-shaped LeverState's vatRedEff/t2Eff/mpEff).
// Every field optional: an omitted field falls back to current law.
interface LeverWrite {
  vatStd: number;
  vatRed: number;
  regimes: Partial<Record<VatAdjustableGroup, VatRegime>>;
  pit: number;
  nm: number;
  bracket2: boolean;
  t2: number;
  r2: number;
  corp: number;
  div: number;
  mod: number;
  noCap: boolean;
  pw: number;
  noSupp: boolean;
  ph: number;
  adm: number;
  mrzFreeze: boolean;
  def: number;
  wi: number;
  wex: boolean;
  kap: number;
  ssp: boolean;
  sspg: boolean;
  hp: number;
  mp: number;
  tp: number;
  mat: number;
  mpf: boolean;
  psub: number;
  diesel: number;
  petrol: number;
  cigarettes: number;
  spirits: number;
  wine: number;
  gambling: number;
}

export const BudgetPolicySimulator: FC = () => {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "en" ? "en" : "bg";
  const locale = lang === "en" ? "en-US" : "bg-BG";
  const {
    data: baseline,
    isError: baselineError,
    isSuccess: baselineSettled,
  } = usePolicyBaseline();

  const currentCap = resolveMod(null).mod;
  const modMin = currentCap - MOD_STEPS_DOWN * MOD_STEP;
  const modMax = currentCap + MOD_STEPS_UP * MOD_STEP;
  const [searchParams, setSearchParams] = useSearchParams();

  const [vatStd, setVatStd] = useState(() =>
    clampIntParam(searchParams.get("dds"), 10, 27, VAT_STD_DEF),
  );
  const [vatRed, setVatRed] = useState(() =>
    clampIntParam(searchParams.get("ddsr"), 0, 27, VAT_RED_DEF),
  );
  const [regimes, setRegimes] = useState<
    Partial<Record<VatAdjustableGroup, VatRegime>>
  >(() => {
    const out: Partial<Record<VatAdjustableGroup, VatRegime>> = {};
    for (const g of VAT_ADJUSTABLE_GROUPS) {
      const v = parseRegimeParam(searchParams.get(g));
      if (v && v !== VAT_GROUP_DEFAULT_REGIME[g]) out[g] = v;
    }
    return out;
  });
  const [pit, setPit] = useState(() =>
    clampIntParam(searchParams.get("pit"), 0, 35, PIT_DEF),
  );
  const [corp, setCorp] = useState(() =>
    clampDecimalParam(searchParams.get("corp"), 0, 30, CORP_DEF),
  );
  const [div, setDiv] = useState(() =>
    clampIntParam(searchParams.get("div"), 0, 20, DIV_DEF),
  );
  const [diesel, setDiesel] = useState(() =>
    clampIntParam(searchParams.get("dies"), DIESEL_DEF, DIESEL_MAX, DIESEL_DEF),
  );
  const [petrol, setPetrol] = useState(() =>
    clampIntParam(searchParams.get("petr"), PETROL_MIN, PETROL_MAX, PETROL_DEF),
  );
  const [cigarettes, setCigarettes] = useState(() =>
    clampIntParam(searchParams.get("cig"), CIG_MIN, CIG_MAX, CIG_DEF),
  );
  const [spirits, setSpirits] = useState(() =>
    clampIntParam(
      searchParams.get("spir"),
      SPIRITS_MIN,
      SPIRITS_MAX,
      SPIRITS_DEF,
    ),
  );
  const [wine, setWine] = useState(() =>
    clampIntParam(searchParams.get("winex"), 0, WINE_MAX, 0),
  );
  const [gambling, setGambling] = useState(() =>
    clampIntParam(searchParams.get("haz"), 0, GAMBLING_MAX, GAMBLING_DEF),
  );
  const [exciseOpen, setExciseOpen] = useState(
    () =>
      searchParams.get("dies") != null ||
      searchParams.get("petr") != null ||
      searchParams.get("cig") != null ||
      searchParams.get("spir") != null ||
      searchParams.get("winex") != null,
  );
  const [mod, setMod] = useState(() =>
    clampIntParam(searchParams.get("mod"), modMin, modMax, currentCap),
  );
  const [noCap, setNoCap] = useState(() => searchParams.get("nocap") === "1");
  const [nm, setNm] = useState(() =>
    clampIntParam(searchParams.get("nm"), 0, NM_MAX, 0),
  );
  const [bracket2, setBracket2] = useState(
    () => searchParams.get("b2") === "1",
  );
  const [t2, setT2] = useState(() =>
    clampIntParam(searchParams.get("t2"), 1000, 8000, T2_DEF),
  );
  const [r2, setR2] = useState(() =>
    clampIntParam(searchParams.get("r2"), 0, 55, R2_DEF),
  );
  const [gross, setGross] = useState(() =>
    clampIntParam(searchParams.get("gross"), 500, 8000, GROSS_DEF),
  );
  // Expenditure levers: Swiss-rule CPI weight (%), COVID-supplement
  // indexation, horizon (years), administration cut (%), МРЗ freeze.
  const [pw, setPw] = useState(() =>
    clampIntParam(searchParams.get("pw"), 0, 100, 50),
  );
  const [noSupp, setNoSupp] = useState(() => searchParams.get("ks") === "0");
  const [ph, setPh] = useState(() =>
    clampIntParam(searchParams.get("ph"), 1, 5, 1),
  );
  const [adm, setAdm] = useState(() =>
    clampIntParam(searchParams.get("adm"), 0, 20, 0),
  );
  const [mrzFreeze, setMrzFreeze] = useState(
    () => searchParams.get("mrz") === "1",
  );
  // Phase-5 levers: defense target (tenths of % GDP), wage indexation %,
  // exempt-sectors toggle, capital ±%, SSC-self-paid (+gross-up), health pp.
  const [def, setDef] = useState(() =>
    clampIntParam(searchParams.get("def"), 15, 50, DEF_DEF),
  );
  const [wi, setWi] = useState(() =>
    clampIntParam(searchParams.get("wi"), -5, 15, 0),
  );
  const [wex, setWex] = useState(() => searchParams.get("wex") !== "0");
  const [kap, setKap] = useState(() =>
    clampIntParam(searchParams.get("kap"), -30, 30, 0),
  );
  const [ssp, setSsp] = useState(() => searchParams.get("ssp") === "1");
  const [sspg, setSspg] = useState(() => searchParams.get("sspg") === "1");
  const [hp, setHp] = useState(() =>
    clampIntParam(searchParams.get("hp"), 0, 3, 0),
  );
  // Pension floor (€/mo) and teachers' peg (% of the average wage): their
  // defaults derive from the baseline at runtime (the МОД-grid idiom — the
  // default must be a reachable slider value), so state holds 0 = "current
  // law" and the effective value is resolved against the baseline below.
  const [mp, setMp] = useState(() =>
    clampIntParam(searchParams.get("mp"), 0, 600, 0),
  );
  const [tp, setTp] = useState(() =>
    clampIntParam(searchParams.get("tp"), 0, 140, 0),
  );
  // June-2026 consolidation-debate levers: paid second-year maternity months
  // (12 = current law), MP pay freeze, party subsidy in euro-cents per vote
  // (300 = current law since 30.04.2026).
  const [mat, setMat] = useState(() =>
    clampIntParam(searchParams.get("mat"), 0, MATERNITY_Y2_MONTHS, 12),
  );
  const [mpf, setMpf] = useState(() => searchParams.get("mpf") === "1");
  const [psub, setPsub] = useState(() =>
    clampIntParam(searchParams.get("psub"), 0, 450, PSUB_DEF),
  );
  // Last "like in <country>" pick per lever — display-only memory; the
  // levers themselves carry the state (and the URL).
  const [euPicks, setEuPicks] = useState<Partial<Record<EuLeverId, string>>>(
    {},
  );
  const [expOpen, setExpOpen] = useState(
    () =>
      searchParams.get("pw") != null ||
      searchParams.get("ks") === "0" ||
      searchParams.get("adm") != null ||
      searchParams.get("mrz") === "1" ||
      searchParams.get("def") != null ||
      searchParams.get("wi") != null ||
      searchParams.get("kap") != null ||
      searchParams.get("ssp") === "1" ||
      searchParams.get("hp") != null ||
      searchParams.get("mp") != null ||
      searchParams.get("tp") != null ||
      searchParams.get("mat") != null ||
      searchParams.get("mpf") === "1" ||
      searchParams.get("psub") != null,
  );
  const [shareCopied, setShareCopied] = useState(false);
  const [sentenceCopied, setSentenceCopied] = useState(false);
  const [incidenceOpen, setIncidenceOpen] = useState(false);
  // Scoring mode: dynamic (behavioral + macro feedback + MC band) is the
  // default; `mode=static` in the URL pins the static view.
  const [dyn, setDyn] = useState(() => searchParams.get("mode") !== "static");
  // Goal-gauge mission; only non-default values hit the URL.
  const [goal, setGoal] = useState<GoalId>(() =>
    parseGoalParam(searchParams.get("goal")),
  );

  // Progressive disclosure: the per-category VAT chips and the progressive-
  // tax controls fold away by default; a shared link that uses them opens
  // its section expanded.
  const [vatCatsOpen, setVatCatsOpen] = useState(() =>
    VAT_ADJUSTABLE_GROUPS.some((g) => parseRegimeParam(searchParams.get(g))),
  );
  const [taxDetailOpen, setTaxDetailOpen] = useState(
    () => searchParams.get("nm") != null || searchParams.get("b2") === "1",
  );

  // The second bracket's threshold rides above the untaxed minimum: when nm
  // crosses t2 the threshold is pushed up (non-destructively — t2 returns to
  // its own value when nm drops back) so the schedule can never silently
  // drop the bracket. Declared before the URL-mirror effect that writes it.
  const t2Eff = Math.max(t2, nm + 100);

  // The reduced VAT rate rides at or below the standard rate — raising it to
  // the standard rate abolishes the reduced regime. Non-destructive: vatRed
  // keeps its own value when the standard rate climbs back up.
  const vatRedEff = Math.min(vatRed, vatStd);

  // Runtime defaults for the baseline-anchored expenditure levers. Both are
  // 0 until the baseline arrives (the component renders a loading card then).
  const pensionFloor = baseline?.expenditure?.pensionFloor;
  const teachers = baseline?.expenditure?.teachers;
  const mpDef = pensionFloor ? Math.round(pensionFloor.minimumEur) : 0;
  const mpEff = mp > 0 ? Math.min(600, Math.max(mpDef, mp)) : mpDef;
  const tpDef = teachers ? Math.round(teachers.currentRatio * 100) : 0;
  const tpEff = tp > 0 ? Math.min(140, Math.max(100, tp)) : tpDef;

  // ----- lever writers -------------------------------------------------------
  // Single source of truth for "set every policy lever". resetAll, applyPreset
  // and applyCountryProfile all route through this, so a newly added lever
  // can't silently desync one of them — add its setter+default here once. Each
  // flow layers its own NON-lever extras on top: `gross` (a wage assumption,
  // not a policy lever — preserved here, reset only by resetAll), the
  // progressive-disclosure sections, and the per-lever EU picks.
  const applyLevers = (o: Partial<LeverWrite> = {}): void => {
    setVatStd(o.vatStd ?? VAT_STD_DEF);
    setVatRed(o.vatRed ?? VAT_RED_DEF);
    setRegimes(o.regimes ?? {});
    setPit(o.pit ?? PIT_DEF);
    setNm(o.nm ?? 0);
    setBracket2(o.bracket2 ?? false);
    setT2(o.t2 ?? T2_DEF);
    setR2(o.r2 ?? R2_DEF);
    setCorp(o.corp ?? CORP_DEF);
    setDiv(o.div ?? DIV_DEF);
    setMod(o.mod ?? currentCap);
    setNoCap(o.noCap ?? false);
    setPw(o.pw ?? 50);
    setNoSupp(o.noSupp ?? false);
    setPh(o.ph ?? 1);
    setAdm(o.adm ?? 0);
    setMrzFreeze(o.mrzFreeze ?? false);
    setDef(o.def ?? DEF_DEF);
    setWi(o.wi ?? 0);
    setWex(o.wex ?? true);
    setKap(o.kap ?? 0);
    setSsp(o.ssp ?? false);
    setSspg(o.sspg ?? false);
    setHp(o.hp ?? 0);
    setMp(o.mp ?? 0);
    setTp(o.tp ?? 0);
    setMat(o.mat ?? MATERNITY_Y2_MONTHS);
    setMpf(o.mpf ?? false);
    setPsub(o.psub ?? PSUB_DEF);
    setDiesel(o.diesel ?? DIESEL_DEF);
    setPetrol(o.petrol ?? PETROL_DEF);
    setCigarettes(o.cigarettes ?? CIG_DEF);
    setSpirits(o.spirits ?? SPIRITS_DEF);
    setWine(o.wine ?? 0);
    setGambling(o.gambling ?? GAMBLING_DEF);
  };

  // ----- presets -------------------------------------------------------------
  const applyPreset = (p: PresetApply): void => {
    applyLevers({
      regimes: p.regimes ?? {},
      nm: p.nm ?? 0,
      bracket2: !!p.b2,
      t2: p.b2?.t2 ?? T2_DEF,
      r2: p.b2?.r2 ?? R2_DEF,
      noCap: !!p.noCap,
      pw: p.pw ?? 50,
      adm: p.adm ?? 0,
      mrzFreeze: !!p.mrzFreeze,
      ssp: !!p.ssp,
      mat: p.mat ?? MATERNITY_Y2_MONTHS,
    });
    setExciseOpen(false);
    setVatCatsOpen(!!p.regimes);
    setTaxDetailOpen(p.nm != null || !!p.b2);
    setExpOpen(
      p.pw != null ||
        p.adm != null ||
        !!p.mrzFreeze ||
        p.mat != null ||
        !!p.ssp,
    );
  };
  const presetIsActive = (p: PresetApply): boolean => {
    const wantRegimes = p.regimes ?? {};
    const regimesMatch =
      VAT_ADJUSTABLE_GROUPS.every(
        (g) => (regimes[g] ?? null) === (wantRegimes[g] ?? null),
      ) &&
      vatStd === VAT_STD_DEF &&
      vatRedEff === VAT_RED_DEF;
    return (
      regimesMatch &&
      pit === PIT_DEF &&
      nm === (p.nm ?? 0) &&
      bracket2 === !!p.b2 &&
      (!p.b2 || (t2Eff === p.b2.t2 && r2 === p.b2.r2)) &&
      corp === CORP_DEF &&
      div === DIV_DEF &&
      noCap === !!p.noCap &&
      (noCap || mod === currentCap) &&
      pw === (p.pw ?? 50) &&
      !noSupp &&
      ph === 1 &&
      adm === (p.adm ?? 0) &&
      mrzFreeze === !!p.mrzFreeze &&
      def === DEF_DEF &&
      wi === 0 &&
      kap === 0 &&
      ssp === !!p.ssp &&
      !sspg &&
      hp === 0 &&
      mpEff === mpDef &&
      tpEff === tpDef &&
      mat === (p.mat ?? MATERNITY_Y2_MONTHS) &&
      !mpf &&
      psub === PSUB_DEF &&
      diesel === DIESEL_DEF &&
      petrol === PETROL_DEF &&
      cigarettes === CIG_DEF &&
      spirits === SPIRITS_DEF &&
      wine === 0 &&
      gambling === GAMBLING_DEF
    );
  };

  useEffect(() => {
    const next: Record<string, string> = {};
    if (vatStd !== VAT_STD_DEF) next.dds = String(vatStd);
    if (vatRedEff !== VAT_RED_DEF) next.ddsr = String(vatRedEff);
    for (const g of VAT_ADJUSTABLE_GROUPS) {
      if (regimes[g] && regimes[g] !== VAT_GROUP_DEFAULT_REGIME[g])
        next[g] = regimes[g]!;
    }
    if (pit !== PIT_DEF) next.pit = String(pit);
    if (nm !== 0) next.nm = String(nm);
    if (bracket2) {
      next.b2 = "1";
      if (t2Eff !== T2_DEF) next.t2 = String(t2Eff);
      if (r2 !== R2_DEF) next.r2 = String(r2);
    }
    if (corp !== CORP_DEF) next.corp = String(corp);
    if (div !== DIV_DEF) next.div = String(div);
    if (diesel !== DIESEL_DEF) next.dies = String(diesel);
    if (petrol !== PETROL_DEF) next.petr = String(petrol);
    if (cigarettes !== CIG_DEF) next.cig = String(cigarettes);
    if (spirits !== SPIRITS_DEF) next.spir = String(spirits);
    if (wine !== 0) next.winex = String(wine);
    if (gambling !== GAMBLING_DEF) next.haz = String(gambling);
    if (!noCap && mod !== currentCap) next.mod = String(mod);
    if (noCap) next.nocap = "1";
    if (gross !== GROSS_DEF) next.gross = String(gross);
    if (pw !== 50) next.pw = String(pw);
    if (noSupp) next.ks = "0";
    if (ph !== 1) next.ph = String(ph);
    if (adm !== 0) next.adm = String(adm);
    if (mrzFreeze) next.mrz = "1";
    if (def !== DEF_DEF) next.def = String(def);
    if (wi !== 0) next.wi = String(wi);
    if (wi !== 0 && !wex) next.wex = "0";
    if (kap !== 0) next.kap = String(kap);
    if (ssp) next.ssp = "1";
    if (ssp && sspg) next.sspg = "1";
    if (hp !== 0) next.hp = String(hp);
    if (mpEff !== mpDef) next.mp = String(mpEff);
    if (tpEff !== tpDef) next.tp = String(tpEff);
    if (mat !== MATERNITY_Y2_MONTHS) next.mat = String(mat);
    if (mpf) next.mpf = "1";
    if (psub !== PSUB_DEF) next.psub = String(psub);
    if (!dyn) next.mode = "static";
    if (goal !== GOAL_DEF) next.goal = goal;
    setSearchParams(next, { replace: true });
  }, [
    vatStd,
    vatRedEff,
    regimes,
    pit,
    nm,
    bracket2,
    t2Eff,
    r2,
    corp,
    div,
    diesel,
    petrol,
    cigarettes,
    spirits,
    wine,
    gambling,
    mod,
    noCap,
    gross,
    pw,
    noSupp,
    ph,
    adm,
    mrzFreeze,
    def,
    wi,
    wex,
    kap,
    ssp,
    sspg,
    hp,
    mpEff,
    mpDef,
    tpEff,
    tpDef,
    mat,
    mpf,
    psub,
    dyn,
    goal,
    currentCap,
    setSearchParams,
  ]);

  const resetAll = (): void => {
    applyLevers();
    setGross(GROSS_DEF);
  };

  // Apply a whole-country profile: route the profile's overrides through
  // applyLevers (which resets every policy lever to current law first), so the
  // breakdown shows exactly the country's bundle and nothing stale. Then clear
  // the per-lever EU picks and open the sections the profile touches so the
  // applied values aren't hidden behind a collapsed disclosure. `gross` (a
  // representative-wage assumption, not a policy lever) is preserved — same as
  // applyPreset.
  const applyCountryProfile = (p: CountryProfile): void => {
    const a = p.apply;
    applyLevers({
      vatStd: a.vatStd ?? VAT_STD_DEF,
      vatRed: a.vatRed ?? VAT_RED_DEF,
      pit: a.pit ?? PIT_DEF,
      nm: a.nm ?? 0,
      bracket2: !!a.b2,
      t2: a.b2?.t2 ?? T2_DEF,
      r2: a.b2?.r2 ?? R2_DEF,
      corp: a.corp ?? CORP_DEF,
      pw: a.pw ?? 50,
      def: a.def ?? DEF_DEF,
      mat: a.mat ?? MATERNITY_Y2_MONTHS,
      diesel: a.exDiesel ?? DIESEL_DEF,
      petrol: a.exPetrol ?? PETROL_DEF,
      cigarettes: a.exCigarettes ?? CIG_DEF,
      spirits: a.exSpirits ?? SPIRITS_DEF,
      wine: a.exWine ?? 0,
    });
    setEuPicks({});
    setVatCatsOpen(false);
    setExciseOpen(
      a.exDiesel != null ||
        a.exPetrol != null ||
        a.exCigarettes != null ||
        a.exSpirits != null ||
        a.exWine != null,
    );
    setTaxDetailOpen((a.nm ?? 0) > 0 || a.b2 != null);
    setExpOpen(
      (a.pw ?? 50) !== 50 ||
        (a.def ?? DEF_DEF) !== DEF_DEF ||
        (a.mat ?? MATERNITY_Y2_MONTHS) !== MATERNITY_Y2_MONTHS,
    );
  };

  // ----- EU country comparators ----------------------------------------------
  // euPicks remembers the last pick per lever; the applied id is re-derived
  // by matching against current state, so it self-clears when values drift.
  const applyEuOption = (lever: EuLeverId, o: EuPresetOption): void => {
    const a = o.apply;
    if (a.vatStd != null) setVatStd(a.vatStd);
    if (a.vatRed != null) setVatRed(a.vatRed);
    if (a.pit != null) setPit(a.pit);
    if (a.nm != null) setNm(a.nm);
    if (a.b2 !== undefined) {
      if (a.b2 === null) setBracket2(false);
      else {
        setBracket2(true);
        setT2(a.b2.t2);
        setR2(a.b2.r2);
      }
    }
    if (a.nm != null || a.b2 !== undefined) setTaxDetailOpen(true);
    if (a.corp != null) setCorp(a.corp);
    if (a.def != null) setDef(a.def);
    if (a.mat != null) setMat(a.mat);
    if (a.pw != null) setPw(a.pw);
    if (a.exDiesel != null) setDiesel(a.exDiesel);
    if (a.exPetrol != null) setPetrol(a.exPetrol);
    if (a.exCigarettes != null) setCigarettes(a.exCigarettes);
    if (a.exSpirits != null) setSpirits(a.exSpirits);
    if (a.exWine != null) setWine(a.exWine);
    if (
      a.exDiesel != null ||
      a.exPetrol != null ||
      a.exCigarettes != null ||
      a.exSpirits != null ||
      a.exWine != null
    )
      setExciseOpen(true);
    setEuPicks((prev) => ({ ...prev, [lever]: o.id }));
  };
  const euMatches = (a: EuPresetApply): boolean =>
    (a.vatStd == null || vatStd === a.vatStd) &&
    (a.vatRed == null || vatRedEff === a.vatRed) &&
    (a.pit == null || pit === a.pit) &&
    (a.nm == null || nm === a.nm) &&
    (a.b2 === undefined ||
      (a.b2 === null
        ? !bracket2
        : bracket2 && t2Eff === a.b2.t2 && r2 === a.b2.r2)) &&
    (a.corp == null || corp === a.corp) &&
    (a.def == null || def === a.def) &&
    (a.mat == null || mat === a.mat) &&
    (a.pw == null || pw === a.pw) &&
    (a.exDiesel == null || diesel === a.exDiesel) &&
    (a.exPetrol == null || petrol === a.exPetrol) &&
    (a.exCigarettes == null || cigarettes === a.exCigarettes) &&
    (a.exSpirits == null || spirits === a.exSpirits) &&
    (a.exWine == null || wine === a.exWine);
  const euAppliedId = (lever: EuLeverId): string | null => {
    const id = euPicks[lever];
    if (!id) return null;
    const o = EU_LEVER_PRESETS[lever].find((x) => x.id === id);
    return o && euMatches(o.apply) ? id : null;
  };
  const euInfo = (lever: EuLeverId, text: string): ReactNode => (
    <EuInfoPopover
      lever={lever}
      text={text}
      lang={lang}
      appliedId={euAppliedId(lever)}
      onApply={(o) => applyEuOption(lever, o)}
    />
  );
  // The applied country's note, shown under the lever while it still
  // matches that country's values.
  const euNoteLine = (lever: EuLeverId): ReactNode => {
    const id = euAppliedId(lever);
    const o = id ? EU_LEVER_PRESETS[lever].find((x) => x.id === id) : undefined;
    return o ? (
      <p className="mt-1 flex items-start gap-1 text-[10px] leading-snug text-muted-foreground/80">
        <EuFlag cc={o.cc} className="mt-[2px]" />
        <span>{o.note[lang]}</span>
      </p>
    ) : null;
  };
  // The country whose full profile the current scenario exactly reproduces
  // (same loose match as the per-lever picks — every lever the profile sets
  // must coincide). Drives the chip highlight and the applied-profile note.
  const activeCountry =
    COUNTRY_PROFILES.find((c) => euMatches(c.apply)) ?? null;

  const onShare = (): void => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard
        .writeText(window.location.href)
        .then(() => {
          setShareCopied(true);
          setTimeout(() => setShareCopied(false), 2000);
        })
        .catch(() => undefined);
    }
  };

  // ----- scoring -----------------------------------------------------------
  const scenario = useMemo(() => {
    if (!baseline) return null;
    return computeStaticScenario(baseline, {
      vatStd,
      vatRedEff,
      regimes,
      pit,
      nm,
      bracket2,
      t2Eff,
      r2,
      corp,
      div,
      mod,
      noCap,
      currentCap,
      pw,
      noSupp,
      ph,
      adm,
      mrzFreeze,
      def,
      wi,
      wex,
      kap,
      ssp,
      sspg,
      hp,
      mpEff,
      mpDef,
      tpEff,
      tpDef,
      mat,
      mpf,
      psub,
      diesel,
      petrol,
      cigarettes,
      spirits,
      wine,
      gambling,
    });
  }, [
    baseline,
    vatStd,
    vatRedEff,
    regimes,
    pit,
    nm,
    bracket2,
    t2Eff,
    r2,
    corp,
    div,
    mod,
    noCap,
    pw,
    noSupp,
    ph,
    adm,
    mrzFreeze,
    def,
    wi,
    wex,
    kap,
    ssp,
    sspg,
    hp,
    mpEff,
    mpDef,
    tpEff,
    tpDef,
    mat,
    mpf,
    psub,
    diesel,
    petrol,
    cigarettes,
    spirits,
    wine,
    gambling,
    currentCap,
  ]);

  // ----- citizen pane ------------------------------------------------------
  // Minimal payslip math under (schedule, cap) — child relief and the
  // self-insured profile stay in the full calculator.
  const citizen = useMemo(() => {
    if (!scenario) return null;
    const deltaFor = (g: number) => {
      const payslip = (brackets: PitBracket[], cap: number) => {
        const insurable = Math.min(g, cap);
        const ssc = insurable * SSC_EMPLOYEE_RATE;
        const pitAmt = pitMonthlyUnderBrackets(Math.max(0, g - ssc), brackets);
        return { net: g - ssc - pitAmt, ssc, pitAmt };
      };
      const before = payslip([{ fromEur: 0, rate: PIT_RATE }], currentCap);
      const after = payslip(scenario.brackets, noCap ? Infinity : mod);
      // VAT on spending: consumption share of net, at the household-
      // effective VAT fraction before/after.
      const vatBefore =
        before.net * CITIZEN_CONSUMPTION_SHARE * scenario.vatFractionBase;
      const vatAfter =
        after.net * CITIZEN_CONSUMPTION_SHARE * scenario.vatFractionNew;
      return {
        netDelta: after.net - before.net,
        vatDelta: vatAfter - vatBefore,
        totalDelta: after.net - before.net - (vatAfter - vatBefore),
      };
    };
    return {
      ...deltaFor(gross),
      exemplars: EXEMPLAR_GROSS.map((g) => ({
        gross: g,
        totalDelta: deltaFor(g).totalDelta,
      })),
    };
  }, [scenario, gross, mod, noCap, currentCap]);

  // ----- distributional view (incidence curve + Gini) -----------------------
  const distribution = useMemo(() => {
    if (!baseline?.earnings || !scenario) return null;
    const bands = baseline.earnings.bands;
    const netUnder =
      (brackets: PitBracket[], cap: number) =>
      (g: number): number => {
        const ssc = Math.min(g, cap) * SSC_EMPLOYEE_RATE;
        return (
          g - ssc - pitMonthlyUnderBrackets(Math.max(0, g - ssc), brackets)
        );
      };
    const beforeNet = netUnder([{ fromEur: 0, rate: PIT_RATE }], currentCap);
    const afterNet = netUnder(scenario.brackets, noCap ? Infinity : mod);
    const points: IncidencePoint[] = [];
    const N = 48;
    for (let i = 0; i < N; i++) {
      const g = 500 + (i / (N - 1)) * 5500;
      const nb = beforeNet(g);
      const na = afterNet(g);
      const vatB = nb * CITIZEN_CONSUMPTION_SHARE * scenario.vatFractionBase;
      const vatA = na * CITIZEN_CONSUMPTION_SHARE * scenario.vatFractionNew;
      points.push({ grossEur: g, deltaEur: na - nb - (vatA - vatB) });
    }
    const anyVisible = points.some((p) => Math.abs(p.deltaEur) >= 0.5);
    return {
      points,
      anyVisible,
      giniBefore: giniOnBands(bands, beforeNet),
      giniAfter: giniOnBands(bands, afterNet),
    };
  }, [baseline, scenario, mod, noCap, currentCap]);

  // ----- winners/losers by wage decile ----------------------------------------
  // The citizen-legible cut of the same incidence math: mean Δ per tenth of
  // wage earners, weighted over the fitted band grid (wage earners only —
  // pensioners and the self-employed are outside the grid by construction).
  const deciles = useMemo(() => {
    if (!baseline?.earnings || !scenario) return null;
    const bands = [...baseline.earnings.bands].sort(
      (a, b) => a.grossEur - b.grossEur,
    );
    const total = bands.reduce((s, b) => s + b.workers, 0);
    if (total <= 0) return null;
    const netUnder =
      (brackets: PitBracket[], cap: number) =>
      (g: number): number => {
        const ssc = Math.min(g, cap) * SSC_EMPLOYEE_RATE;
        return (
          g - ssc - pitMonthlyUnderBrackets(Math.max(0, g - ssc), brackets)
        );
      };
    const beforeNet = netUnder([{ fromEur: 0, rate: PIT_RATE }], currentCap);
    const afterNet = netUnder(scenario.brackets, noCap ? Infinity : mod);
    const sums = Array(10).fill(0) as number[];
    const weights = Array(10).fill(0) as number[];
    let cum = 0;
    for (const b of bands) {
      const idx = Math.min(9, Math.floor(((cum + b.workers / 2) / total) * 10));
      const nb = beforeNet(b.grossEur);
      const na = afterNet(b.grossEur);
      const vatB = nb * CITIZEN_CONSUMPTION_SHARE * scenario.vatFractionBase;
      const vatA = na * CITIZEN_CONSUMPTION_SHARE * scenario.vatFractionNew;
      sums[idx] += (na - nb - (vatA - vatB)) * b.workers;
      weights[idx] += b.workers;
      cum += b.workers;
    }
    const means = sums.map((s, i) => (weights[i] > 0 ? s / weights[i] : 0));
    return {
      means,
      anyVisible: means.some((m) => Math.abs(m) >= 0.5),
    };
  }, [baseline, scenario, mod, noCap, currentCap]);

  // ----- preset myth-buster weights ------------------------------------------
  // Each recurring proposal's standalone static effect, sized against the
  // baseline 2026 deficit in the chip tooltip — so symbolic micro-cuts read
  // as exactly that. Baseline-keyed: presets are constants.
  const presetWeights = useMemo(() => {
    if (!baseline?.earnings?.bands || !baseline.vat?.slices) return null;
    return Object.fromEntries(
      PRESETS.map((p) => [p.id, presetStaticEur(baseline, p.apply)]),
    );
  }, [baseline]);

  // ----- who-is-affected shares ------------------------------------------------
  // Consequence lines under the levers (the Delib pattern: a moved lever says
  // in one sentence whom it touches). Shares come from the same fitted band
  // grid the scoring runs on.
  const affected = useMemo(() => {
    const bands = baseline?.earnings?.bands;
    if (!bands?.length) return null;
    const total = bands.reduce((s, b) => s + b.workers, 0);
    if (total <= 0) return null;
    // PIT taxable base under the SCENARIO's SSC deduction cap (Infinity when
    // the cap is removed, else the moved cap) — mirrors the scoring memo's
    // `min(gross, cap)·SSC` exactly so the shares match the engine.
    const insurableCap = noCap ? Infinity : mod;
    const taxBase = (g: number): number =>
      g - Math.min(g, insurableCap) * SSC_EMPLOYEE_RATE;
    const share = (pred: (g: number) => boolean): number =>
      (100 *
        bands.reduce((s, b) => (pred(b.grossEur) ? s + b.workers : s), 0)) /
      total;
    // Who the cap CHANGE newly touches: above currentCap if removing it,
    // else above the lowered cap.
    const capThreshold = noCap ? currentCap : Math.min(currentCap, mod);
    return {
      pctBelowNm: nm > 0 ? share((g) => taxBase(g) < nm) : null,
      pctAboveT2: bracket2 ? share((g) => taxBase(g) > t2Eff) : null,
      pctAboveCap:
        noCap || mod !== currentCap ? share((g) => g > capThreshold) : null,
    };
  }, [baseline, nm, bracket2, t2Eff, mod, noCap, currentCap]);

  // ----- behavioral (dynamic) layer -------------------------------------------
  // The pension-indexation slice COMPOUNDS (current-law rate ~7%/yr), so it
  // is recomputed for each projection year and shared by the projection's
  // fixed path AND the Tier-2 feedback impulse split.
  const pensionPath = useMemo(() => {
    const pensions = baseline?.expenditure?.pensions;
    if (!pensions || (pw === 50 && !noSupp)) return undefined;
    return PROJECTION_YEARS.map(
      (_, i) =>
        -scorePensionIndexation(pensions, {
          cpiWeight: pw / 100,
          indexSupplement: !noSupp,
          horizonYears: i + 1,
        }),
    );
  }, [baseline, pw, noSupp]);

  // Monte-Carlo parameter draws: seeded and baseline-keyed, so slider moves
  // NEVER resample — the band moves smoothly instead of flickering.
  const mcDraws = useMemo(
    () =>
      baseline?.modIdentity
        ? sampleDraws(MC_DRAWS, MC_SEED, baseline.modIdentity)
        : null,
    [baseline],
  );

  const dynamicScenario = useMemo(() => {
    if (!scenario || !baseline?.earnings || !mcDraws) return null;
    const input = buildDynamicInput(
      baseline,
      {
        totalEur: scenario.central,
        vatDeltaEur: scenario.vatDelta,
        pitEmploymentDeltaEur: scenario.pitEmploymentDelta,
        pitNonEmploymentDeltaEur: scenario.pitNonEmploymentDelta,
        corpDeltaEur: scenario.corpDelta,
        divDeltaEur: scenario.divDelta,
        modCentralEur: scenario.modRes.centralEur,
        healthDeltaEur: scenario.hpDelta,
        minWageDeltaEur: scenario.mwDelta,
        exciseDieselDeltaEur: scenario.dieselDelta,
        excisePetrolDeltaEur: scenario.petrolDelta,
        exciseTobaccoDeltaEur: scenario.cigarettesDelta,
        exciseAlcoholDeltaEur: scenario.spiritsDelta,
        wineDeltaEur: scenario.wineDelta,
        gamblingDeltaEur: scenario.gamblingDelta,
        maternityMonthsCut: MATERNITY_Y2_MONTHS - mat,
        expenditureBalanceNonPensionEur: scenario.expenditureNonPensionBalance,
        brackets: scenario.brackets,
        pensionPathEur: pensionPath,
      },
      {
        pitNewRate: pit / 100,
        corpNewRate: corp / 100,
        divNewRate: div / 100,
        modTargetCapEur: noCap ? Infinity : mod,
        modCurrentCapEur: currentCap,
        exciseDieselRateChange: diesel / DIESEL_DEF - 1,
        excisePetrolRateChange: petrol / PETROL_DEF - 1,
        exciseTobaccoRateChange: cigarettes / CIG_DEF - 1,
        exciseAlcoholRateChange: spirits / SPIRITS_DEF - 1,
        gamblingNewRate: gambling / 100,
      },
    );
    return computeDynamicScenario(input, mcDraws);
  }, [
    scenario,
    baseline,
    mcDraws,
    pensionPath,
    pit,
    corp,
    div,
    mod,
    noCap,
    currentCap,
    mat,
    diesel,
    petrol,
    cigarettes,
    spirits,
    gambling,
  ]);

  // ----- multi-year balance & debt projection --------------------------------
  // ESA general-government grain (EC Spring 2026 baseline) — distinct from
  // the КФП cash grain of the rest of the screen; the projection card says so.
  // In dynamic mode the year-1 scalar is the Tier-1 adjusted total and the
  // Tier-2 feedback rides the fixed path next to the pension slice; the
  // headline keeps the user's horizon slider, the projection ignores it.
  const projection = useMemo(() => {
    if (!scenario) return projectFiscalPath(0);
    const feedback =
      dyn && dynamicScenario
        ? dynamicScenario.feedback.feedbackByYearEur
        : null;
    const year1 =
      (dyn && dynamicScenario
        ? dynamicScenario.dynamicTier1Eur
        : scenario.central) - (pensionPath ? scenario.pensionBalance : 0);
    const fixed =
      pensionPath || feedback
        ? PROJECTION_YEARS.map(
            (_, i) => (pensionPath?.[i] ?? 0) + (feedback?.[i] ?? 0),
          )
        : undefined;
    return projectFiscalPath(year1, fixed);
  }, [scenario, dynamicScenario, dyn, pensionPath]);

  // ----- public scenario tally ------------------------------------------------
  // The stats query failing (function not deployed, offline) hides the card;
  // nothing else depends on it.
  const publicStats = usePublicScenarioStats();
  const submitScenario = useSubmitScenario();

  // ----- "what it buys" comparator (COFOG health + education) ---------------
  const { data: cofog } = useCofog();
  const comparator = useMemo(() => {
    if (!cofog || !scenario || Math.abs(scenario.central) < 1e6) return null;
    const yr = cofog.latestYear;
    const health = cofog.series.GF07?.find((p) => p.year === yr)?.valueEur;
    const education = cofog.series.GF09?.find((p) => p.year === yr)?.valueEur;
    if (!health || !education) return null;
    return {
      year: yr,
      healthPct: (Math.abs(scenario.central) / health) * 100,
      educationPct: (Math.abs(scenario.central) / education) * 100,
    };
  }, [cofog, scenario]);

  // ----- auto-generated scenario sentence ------------------------------------
  const sentence = useMemo(() => {
    if (!scenario || !baseline) return null;
    const rateOf = (regime: VatRegime): string =>
      regime === "standard"
        ? `${vatStd}%`
        : regime === "reduced"
          ? `${vatRedEff}%`
          : "0%";
    const parts: string[] = [];
    if (vatStd !== VAT_STD_DEF)
      parts.push(t("budget_policy_frag_vat", { v: vatStd }));
    if (vatRedEff !== VAT_RED_DEF)
      parts.push(t("budget_policy_frag_vat_red", { v: vatRedEff }));
    for (const g of VAT_ADJUSTABLE_GROUPS) {
      if (regimes[g] && regimes[g] !== VAT_GROUP_DEFAULT_REGIME[g])
        parts.push(
          `${t(`budget_policy_group_${g}`)} → ${rateOf(regimes[g]!)} ${t("budget_policy_frag_vat_word")}`,
        );
    }
    if (pit !== PIT_DEF) parts.push(t("budget_policy_frag_pit", { v: pit }));
    if (nm > 0) parts.push(t("budget_policy_frag_nm", { v: nm }));
    if (bracket2) parts.push(t("budget_policy_frag_b2", { r: r2, t: t2Eff }));
    if (corp !== CORP_DEF)
      parts.push(t("budget_policy_frag_corp", { v: corp }));
    if (div !== DIV_DEF) parts.push(t("budget_policy_frag_div", { v: div }));
    if (noCap) parts.push(t("budget_policy_frag_nocap"));
    else if (mod !== currentCap)
      parts.push(t("budget_policy_frag_mod", { v: mod }));
    if (pw !== 50) parts.push(t("budget_policy_frag_swiss", { v: pw }));
    if (noSupp) parts.push(t("budget_policy_frag_nosupp"));
    if (ph !== 1) parts.push(t("budget_policy_frag_horizon", { v: ph }));
    if (adm > 0) parts.push(t("budget_policy_frag_admin", { v: adm }));
    if (mrzFreeze) parts.push(t("budget_policy_frag_mrz"));
    if (def !== DEF_DEF)
      parts.push(t("budget_policy_frag_def", { v: (def / 10).toFixed(1) }));
    if (wi !== 0) parts.push(t("budget_policy_frag_wi", { v: wi }));
    if (kap !== 0) parts.push(t("budget_policy_frag_kap", { v: kap }));
    if (ssp)
      parts.push(
        t(sspg ? "budget_policy_frag_ssp_gross" : "budget_policy_frag_ssp"),
      );
    if (hp !== 0) parts.push(t("budget_policy_frag_hp", { v: hp }));
    if (mpEff !== mpDef) parts.push(t("budget_policy_frag_mp", { v: mpEff }));
    if (tpEff !== tpDef) parts.push(t("budget_policy_frag_tp", { v: tpEff }));
    if (mat !== MATERNITY_Y2_MONTHS)
      parts.push(t("budget_policy_frag_mat", { v: mat }));
    if (mpf) parts.push(t("budget_policy_frag_mpf"));
    if (psub !== PSUB_DEF) {
      const rate = (psub / 100).toFixed(2);
      parts.push(
        t("budget_policy_frag_psub", {
          v: lang === "bg" ? rate.replace(".", ",") : rate,
        }),
      );
    }
    if (!parts.length) return null;
    // The quoted total matches the displayed headline: dynamic central in
    // dynamic mode, static otherwise.
    const total =
      dyn && dynamicScenario
        ? dynamicScenario.dynamicHeadlineEur
        : scenario.central;
    return t("budget_policy_sentence", {
      changes: parts.join("; "),
      total: fmtDelta(total, lang),
      pct: new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(
        (total / baseline.gdpEur) * 100,
      ),
    });
  }, [
    scenario,
    dynamicScenario,
    dyn,
    baseline,
    vatStd,
    vatRedEff,
    regimes,
    pit,
    nm,
    bracket2,
    t2Eff,
    r2,
    corp,
    div,
    mod,
    noCap,
    pw,
    noSupp,
    ph,
    adm,
    mrzFreeze,
    def,
    wi,
    kap,
    ssp,
    sspg,
    hp,
    mpEff,
    mpDef,
    tpEff,
    tpDef,
    mat,
    mpf,
    psub,
    currentCap,
    t,
    lang,
    locale,
  ]);

  const onCopySentence = (): void => {
    if (!sentence) return;
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard
        .writeText(`${sentence}\n${window.location.href}`)
        .then(() => {
          setSentenceCopied(true);
          setTimeout(() => setSentenceCopied(false), 2000);
        })
        .catch(() => undefined);
    }
  };

  // Distinguish "still fetching" from "fetched but unusable": a 404 (stale
  // bucket without the new file) or a baseline missing the earnings section
  // must surface an error card, not load forever or crash the render.
  if (baselineError || (baselineSettled && (!baseline || !baseline.earnings))) {
    return (
      <div className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
        {t("budget_policy_error")}
      </div>
    );
  }
  if (!baseline || !scenario || !citizen) {
    return (
      <div className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
        {t("budget_policy_loading")}
      </div>
    );
  }

  // BG convention puts the euro sign after the amount ("1 234 €"); formatEur
  // is €-prefixed site-wide, so flip it here for the simulator's BG strings.
  const eur = (v: number): string =>
    lang === "bg" ? `${formatEur(v, locale).slice(1)} €` : formatEur(v, locale);
  const modUncertain =
    Math.abs(scenario.modRes.highEur - scenario.modRes.lowEur) > 1e6;

  // Mode-aware per-lever values: in dynamic mode each revenue lever shows
  // static + its central-draw behavioral offset; most expenditure levers carry
  // no offset and read the same in both modes — the exception is maternity,
  // whose dynamic return-to-work PIT+SSC recapture surfaces on its own row.
  // (The tiny dividend↔salary recapture stays in the aggregate behavior line —
  // it is a cross-lever spillover, not cleanly one displayed row's effect.)
  const dynOffsets = dyn && dynamicScenario ? dynamicScenario.offsets : null;
  const effVat = scenario.vatDelta + (dynOffsets?.vat ?? 0);
  const effPit = scenario.pitDelta + (dynOffsets?.pit ?? 0);
  const effCorp = scenario.corpDelta + (dynOffsets?.corp ?? 0);
  const effDiv = scenario.divDelta + (dynOffsets?.dividend ?? 0);
  const effDiesel = scenario.dieselDelta + (dynOffsets?.exciseDiesel ?? 0);
  const effPetrol = scenario.petrolDelta + (dynOffsets?.excisePetrol ?? 0);
  const effCigarettes =
    scenario.cigarettesDelta + (dynOffsets?.exciseTobacco ?? 0);
  const effSpirits = scenario.spiritsDelta + (dynOffsets?.exciseAlcohol ?? 0);
  const effWine = scenario.wineDelta + (dynOffsets?.wine ?? 0);
  const effGambling = scenario.gamblingDelta + (dynOffsets?.gambling ?? 0);
  const effMod = scenario.modRes.centralEur + (dynOffsets?.mod ?? 0);
  const effHp = scenario.hpDelta + (dynOffsets?.health ?? 0);
  const effMat = scenario.matBalance + (dynOffsets?.maternity ?? 0);
  const headline =
    dyn && dynamicScenario
      ? dynamicScenario.dynamicHeadlineEur
      : scenario.central;
  const behavioralTotal = headline - scenario.central;
  // The "static X · behavior −Y" decomposition reads only when the modes
  // actually diverge for this scenario.
  const decompVisible = dyn && Math.abs(behavioralTotal) >= 5e5;
  const bandVisible =
    dyn &&
    dynamicScenario != null &&
    Math.abs(dynamicScenario.p95Eur - dynamicScenario.p5Eur) > 1e6;
  // Static sub-line under a lever row in dynamic mode, when it diverges.
  const staticSub = (staticV: number, effV: number): string | undefined =>
    dyn && Math.abs(effV - staticV) >= 5e5
      ? t("budget_policy_row_static_sub", { v: fmtDelta(staticV, lang) })
      : undefined;

  const maxAbs = Math.max(
    Math.abs(effVat),
    Math.abs(effPit),
    Math.abs(effCorp),
    Math.abs(effDiv),
    Math.abs(effDiesel),
    Math.abs(effPetrol),
    Math.abs(effCigarettes),
    Math.abs(effSpirits),
    Math.abs(effWine),
    Math.abs(effGambling),
    Math.abs(effMod),
    Math.abs(scenario.pensionBalance),
    Math.abs(scenario.adminBalance),
    Math.abs(scenario.mwDelta),
    Math.abs(scenario.defBalance),
    Math.abs(scenario.wiBalance),
    Math.abs(scenario.kapBalance),
    Math.abs(scenario.sspBalance),
    Math.abs(effHp),
    Math.abs(scenario.mpBalance),
    Math.abs(scenario.tpBalance),
    Math.abs(effMat),
    Math.abs(scenario.mpfBalance),
    Math.abs(scenario.psubBalance),
    1,
  );
  const pctGdp = (headline / baseline.gdpEur) * 100;
  const anyChange =
    scenario.central !== 0 || scenario.vatDelta !== 0 || citizen.netDelta !== 0;
  const fyProj = projection.years[0];
  const lastProj = projection.years[projection.years.length - 1];
  const heroDeficitLine = anyChange
    ? t("budget_policy_hero_deficit", {
        year: fyProj.year,
        before: fmtPct1(fyProj.baselineBalancePctGdp, locale),
        after: fmtPct1(fyProj.balancePctGdp, locale),
      })
    : t("budget_policy_hero_deficit_nochange", {
        year: fyProj.year,
        before: fmtPct1(fyProj.baselineBalancePctGdp, locale),
      });

  // Myth-buster line for a preset chip's tooltip, and the consequence-line
  // renderer + share/count formatters for the levers panel.
  const fmtShare = (pct: number): string =>
    pct < 1 ? t("budget_policy_weight_under1") : `${Math.round(pct)}%`;
  const fmtCount = (n: number): string => {
    if (n >= 950_000) {
      const v = (n / 1_000_000).toFixed(1);
      return lang === "bg" ? `${v.replace(".", ",")} млн` : `${v}M`;
    }
    return lang === "bg"
      ? `${Math.round(n / 1000)} хил.`
      : `${Math.round(n / 1000)} thousand`;
  };
  const affectLine = (text: string): ReactNode => (
    <p className="mt-1 text-[10px] leading-snug text-muted-foreground/80">
      {text}
    </p>
  );
  const presetWeightLine = (id: string): string => {
    const eff = presetWeights?.[id];
    const deficitEur =
      (Math.abs(fyProj.baselineBalancePctGdp) / 100) * NOMINAL_GDP_2026_EUR;
    if (eff == null || deficitEur <= 0 || Math.abs(eff) < 5e5) return "";
    const share = (Math.abs(eff) / deficitEur) * 100;
    return t(
      eff > 0
        ? "budget_policy_preset_weight_cover"
        : "budget_policy_preset_weight_widen",
      { eff: fmtDelta(eff, lang), share: fmtShare(share), year: fyProj.year },
    );
  };

  // ----- goal scoreboard -------------------------------------------------------
  // Each mission resolves to gauge values + a met predicate over the
  // (mode-aware) projection. The def mission is constrained: hit 3% NATO
  // defense while keeping the first-year balance no worse than the baseline.
  const goalState = (() => {
    if (goal === "debt") {
      return {
        before: lastProj.baselineDebtPctGdp,
        after: lastProj.debtPctGdp,
        target: DEBT_TARGET_PCT,
        flip: true,
        met: lastProj.debtPctGdp <= DEBT_TARGET_PCT,
        year: lastProj.year,
        fmt: (v: number) => fmtPct1(v, locale) + "%",
        targetLabel: `≤ ${fmtPct1(DEBT_TARGET_PCT, locale)}%`,
      };
    }
    if (goal === "def") {
      const defMet = def >= DEF_TARGET_TENTHS;
      const balanceMet =
        fyProj.balancePctGdp >= fyProj.baselineBalancePctGdp - 1e-9;
      return {
        before: fyProj.baselineBalancePctGdp,
        after: fyProj.balancePctGdp,
        target: fyProj.baselineBalancePctGdp,
        flip: false,
        met: defMet && balanceMet,
        year: fyProj.year,
        fmt: (v: number) => fmtPct1(v, locale) + "%",
        targetLabel: t("budget_policy_goal_def_target", {
          v: fmtPct1(fyProj.baselineBalancePctGdp, locale),
        }),
      };
    }
    return {
      before: fyProj.baselineBalancePctGdp,
      after: fyProj.balancePctGdp,
      target: EDP_TARGET_PCT,
      flip: false,
      met: fyProj.balancePctGdp >= EDP_TARGET_PCT,
      year: fyProj.year,
      fmt: (v: number) => fmtPct1(v, locale) + "%",
      targetLabel: `−3%`,
    };
  })();
  // Chip margin per mission. The def mission's binding gap is the defense
  // slider while it sits under 3.0% (in pp of GDP, same unit as the rest);
  // once defense is on target the balance margin takes over.
  const goalMarginPp =
    goal === "debt"
      ? DEBT_TARGET_PCT - lastProj.debtPctGdp
      : goal === "def" && def < DEF_TARGET_TENTHS
        ? (def - DEF_TARGET_TENTHS) / 10
        : fyProj.balancePctGdp - goalState.target;

  // Gauge values are pre-oriented so RIGHT is always "better" (flip for the
  // lower-is-better debt mission).
  const orient = (v: number): number => (goalState.flip ? -v : v);
  const onShareImage = (): void => {
    void downloadShareCard({
      lang,
      title: t("budget_policy_shareimg_title"),
      sentence,
      headlineLabel: t("budget_policy_hero_total"),
      headline: fmtDelta(headline, lang) + " / " + t("budget_policy_per_year"),
      band:
        bandVisible && dynamicScenario
          ? t("budget_policy_hero_range", {
              low: fmtDelta(dynamicScenario.p5Eur, lang),
              high: fmtDelta(dynamicScenario.p95Eur, lang),
            })
          : null,
      citizenLabel: t("budget_policy_hero_citizen"),
      citizen:
        (citizen.totalDelta >= 0 ? "+" : "−") +
        eur(Math.abs(citizen.totalDelta)) +
        " / " +
        t("budget_policy_per_month"),
      gauge: {
        beforePct: orient(goalState.before),
        afterPct: orient(goalState.after),
        targetPct: orient(goalState.target),
        met: goalState.met,
        min:
          Math.min(
            orient(goalState.before),
            orient(goalState.after),
            orient(goalState.target),
          ) - 0.5,
        max:
          Math.max(
            orient(goalState.before),
            orient(goalState.after),
            orient(goalState.target),
          ) + 0.5,
        labelBefore:
          t("budget_policy_goal_now") + " " + goalState.fmt(goalState.before),
        labelAfter:
          t("budget_policy_goal_scenario") +
          " " +
          goalState.fmt(goalState.after),
        labelTarget: goalState.targetLabel,
      },
      deciles: deciles?.means ?? [],
      decileLabel: t("budget_policy_decile_title"),
      url: "electionsbg.com/budget/simulator",
    });
  };

  // ----- public tally: submit + display state ---------------------------------
  // The submitted scenario carries POLICY levers only — the view params
  // (mode/goal) travel as separate fields, the citizen-pane gross not at all.
  const submitQs = (() => {
    const p = new URLSearchParams(searchParams);
    p.delete("mode");
    p.delete("goal");
    p.delete("gross");
    return p.toString();
  })();
  const scenarioSubmitted = wasScenarioSubmitted(submitQs);
  // In dev the submit proxy points at production, so submits are blocked
  // (reads still work) — the button disables and the hook no-ops.
  const submitBlockedInDev = devSubmitBlocked();
  const onSubmitScenario = (): void => {
    if (!anyChange || !submitQs || scenarioSubmitted || submitBlockedInDev)
      return;
    submitScenario.mutate(
      {
        qs: submitQs,
        metrics: {
          headlineEur: Math.round(headline),
          balancePctGdp: fyProj.balancePctGdp,
          debtPct2030: lastProj.debtPctGdp,
          edpMet: fyProj.balancePctGdp >= EDP_TARGET_PCT,
          debtMet: lastProj.debtPctGdp <= DEBT_TARGET_PCT,
          defMet:
            def >= DEF_TARGET_TENTHS &&
            fyProj.balancePctGdp >= fyProj.baselineBalancePctGdp - 1e-9,
        },
        lang,
        mode: dyn ? "dynamic" : "static",
      },
      { onSuccess: () => markScenarioSubmitted(submitQs) },
    );
  };
  // Distinct chips for the public card's top levers (several params can map
  // to the same breakdown row).
  const publicTopChips = (() => {
    const stats = publicStats.data;
    if (!stats?.topLevers) return [];
    const seen = new Set<string>();
    const chips: { rowKey: string; count: number }[] = [];
    for (const lv of stats.topLevers) {
      const rowKey = PARAM_ROW_KEY[lv.key];
      if (!rowKey || seen.has(rowKey)) continue;
      seen.add(rowKey);
      chips.push({ rowKey, count: lv.count });
    }
    return chips;
  })();

  const regimeChip = (g: VatAdjustableGroup): ReactNode => {
    const active = regimes[g] ?? VAT_GROUP_DEFAULT_REGIME[g];
    return (
      <div key={g} className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">
          {t(`budget_policy_group_${g}`)}
        </span>
        <div className="inline-flex rounded-md border border-input p-0.5">
          {REGIMES.map((r) => {
            const label =
              r === "standard"
                ? `${vatStd}%`
                : r === "reduced"
                  ? `${vatRedEff}%`
                  : "0%";
            const isActive = active === r;
            const isDefault = VAT_GROUP_DEFAULT_REGIME[g] === r;
            return (
              <button
                key={r}
                type="button"
                aria-pressed={isActive}
                aria-label={`${t(`budget_policy_group_${g}`)}: ${t(`budget_policy_regime_${r}`)}`}
                onClick={() =>
                  setRegimes((prev) => {
                    const next = { ...prev };
                    if (r === VAT_GROUP_DEFAULT_REGIME[g]) delete next[g];
                    else next[g] = r;
                    return next;
                  })
                }
                className={
                  "px-2 py-0.5 rounded text-[11px] tabular-nums transition-colors " +
                  (isActive
                    ? isDefault
                      ? "bg-muted text-foreground font-medium"
                      : "bg-indigo-500 text-white font-medium"
                    : "text-muted-foreground hover:text-foreground")
                }
                title={t(`budget_policy_regime_${r}`)}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div
      id="budget-policy-simulator"
      // pb compensates for the fixed mobile result bar so it never occludes
      // the caveats card / footer once a scenario is active.
      className={"scroll-mt-20 space-y-4" + (anyChange ? " pb-16 lg:pb-0" : "")}
    >
      {/* ============================ PRESETS =========================== */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground mr-1">
          <Sparkles className="h-3.5 w-3.5" />
          {t("budget_policy_presets_title")}
        </span>
        {PRESETS.map((p) => {
          const active = presetIsActive(p.apply);
          const weight = presetWeightLine(p.id);
          return (
            <button
              key={p.id}
              type="button"
              aria-pressed={active}
              onClick={() => applyPreset(p.apply)}
              title={
                t(`budget_policy_preset_${p.id}_tip`) +
                (weight ? `\n${weight}` : "")
              }
              className={
                "rounded-full border px-2.5 py-1 text-xs transition-colors " +
                (active
                  ? "border-indigo-500 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 font-medium"
                  : "border-input text-muted-foreground hover:text-foreground hover:border-ring")
              }
            >
              {t(`budget_policy_preset_${p.id}`)}
            </button>
          );
        })}
      </div>

      {/* ===================== COUNTRY QUICK-SELECTS ==================== */}
      {/* The inverse of the per-lever "like in <country>" picker: one chip
          snaps every comparable lever to that country's full policy. */}
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground mr-1">
            <Globe className="h-3.5 w-3.5" />
            {t("budget_policy_countries_title")}
          </span>
          {COUNTRY_PROFILES.map((c) => {
            const active = activeCountry?.id === c.id;
            return (
              <button
                key={c.id}
                type="button"
                aria-pressed={active}
                onClick={() => applyCountryProfile(c)}
                title={c.note[lang]}
                className={
                  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors " +
                  (active
                    ? "border-indigo-500 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 font-medium"
                    : "border-input text-muted-foreground hover:text-foreground hover:border-ring")
                }
              >
                <EuFlag cc={c.cc} />
                {c.name[lang]}
              </button>
            );
          })}
        </div>
        {activeCountry ? (
          <p className="flex items-start gap-1.5 text-[11px] leading-snug text-muted-foreground">
            <EuFlag cc={activeCountry.cc} className="mt-[2px]" />
            <span>{activeCountry.note[lang]}</span>
          </p>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,360px)_1fr]">
        {/* ============================ INPUTS ============================ */}
        <Card className="lg:sticky lg:top-20 lg:self-start">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <SlidersHorizontal className="h-4 w-4" />
              {t("budget_policy_inputs_title")}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 space-y-4">
            <div>
              <RateSlider
                id="policy-vat-std"
                label={t("budget_policy_vat_std")}
                info={euInfo("vatStd", t("budget_policy_tip_vat_std"))}
                min={10}
                max={27}
                value={vatStd}
                defaultValue={VAT_STD_DEF}
                onChange={setVatStd}
              />
              {euNoteLine("vatStd")}
            </div>
            <div>
              <RateSlider
                id="policy-vat-red"
                label={t("budget_policy_vat_red")}
                info={euInfo("vatRed", t("budget_policy_tip_vat_red"))}
                min={0}
                max={vatStd}
                value={vatRedEff}
                defaultValue={VAT_RED_DEF}
                onChange={setVatRed}
              />
              {euNoteLine("vatRed")}
            </div>

            {/* Per-category VAT regime chips — folded by default */}
            <div>
              {/* InfoTip renders its own <button>, so it must stay a sibling
                  of the toggle — nested buttons are invalid HTML. */}
              <div className="flex w-full items-center justify-between gap-2 text-xs font-medium text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <button
                    type="button"
                    aria-expanded={vatCatsOpen}
                    onClick={() => setVatCatsOpen((v) => !v)}
                    className="hover:text-foreground"
                  >
                    {t("budget_policy_groups_title")}
                  </button>
                  <InfoTip text={t("budget_policy_tip_groups")} />
                  {!vatCatsOpen && Object.keys(regimes).length > 0 ? (
                    <span className="rounded-full bg-indigo-500/10 px-1.5 text-[10px] text-indigo-700 dark:text-indigo-300">
                      {Object.keys(regimes).length}
                    </span>
                  ) : null}
                </span>
                <button
                  type="button"
                  tabIndex={-1}
                  aria-hidden="true"
                  onClick={() => setVatCatsOpen((v) => !v)}
                  className="hover:text-foreground"
                >
                  <ChevronDown
                    className={
                      "h-3.5 w-3.5 transition-transform " +
                      (vatCatsOpen ? "rotate-180" : "")
                    }
                  />
                </button>
              </div>
              {vatCatsOpen ? (
                <div className="mt-2 space-y-1.5">
                  {VAT_ADJUSTABLE_GROUPS.map((g) => regimeChip(g))}
                </div>
              ) : null}
            </div>

            <div className="border-t pt-3 space-y-4">
              <div>
                <RateSlider
                  id="policy-pit"
                  label={t("budget_policy_pit")}
                  info={euInfo("pit", t("budget_policy_tip_pit"))}
                  min={0}
                  max={35}
                  value={pit}
                  defaultValue={PIT_DEF}
                  onChange={setPit}
                />
                {euNoteLine("pit")}
              </div>
              {/* Progressive-tax controls — folded by default */}
              <div>
                <button
                  type="button"
                  aria-expanded={taxDetailOpen}
                  onClick={() => setTaxDetailOpen((v) => !v)}
                  className="flex w-full items-center justify-between gap-2 text-xs font-medium text-muted-foreground hover:text-foreground"
                >
                  <span className="inline-flex items-center gap-1">
                    {t("budget_policy_progressive_title")}
                    {!taxDetailOpen && (nm > 0 || bracket2) ? (
                      <span className="rounded-full bg-indigo-500/10 px-1.5 text-[10px] text-indigo-700 dark:text-indigo-300">
                        {(nm > 0 ? 1 : 0) + (bracket2 ? 1 : 0)}
                      </span>
                    ) : null}
                  </span>
                  <ChevronDown
                    className={
                      "h-3.5 w-3.5 transition-transform " +
                      (taxDetailOpen ? "rotate-180" : "")
                    }
                  />
                </button>
                {taxDetailOpen ? (
                  <div className="mt-2 space-y-4">
                    <div>
                      <RateSlider
                        id="policy-nm"
                        label={t("budget_policy_nm")}
                        tip={t("budget_policy_tip_nm")}
                        min={0}
                        max={NM_MAX}
                        step={20}
                        value={nm}
                        defaultValue={0}
                        onChange={setNm}
                        suffix=" €"
                      />
                      {affected?.pctBelowNm != null
                        ? affectLine(
                            t("budget_policy_affect_nm", {
                              pct: fmtShare(affected.pctBelowNm),
                            }),
                          )
                        : null}
                    </div>
                    <div>
                      <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <input
                          type="checkbox"
                          checked={bracket2}
                          onChange={(e) => setBracket2(e.target.checked)}
                          className="accent-indigo-500"
                        />
                        <span>{t("budget_policy_b2")}</span>
                      </label>
                      {bracket2 ? (
                        <div className="mt-2 space-y-3 pl-4 border-l-2 border-indigo-500/30">
                          <RateSlider
                            id="policy-t2"
                            label={t("budget_policy_b2_threshold")}
                            min={Math.max(1000, nm + 100)}
                            max={8000}
                            step={100}
                            value={t2Eff}
                            defaultValue={T2_DEF}
                            onChange={setT2}
                            suffix=" €"
                          />
                          <RateSlider
                            id="policy-r2"
                            label={t("budget_policy_b2_rate")}
                            min={0}
                            max={55}
                            value={r2}
                            defaultValue={R2_DEF}
                            onChange={setR2}
                          />
                          {affected?.pctAboveT2 != null
                            ? affectLine(
                                t("budget_policy_affect_b2", {
                                  pct: fmtShare(affected.pctAboveT2),
                                }),
                              )
                            : null}
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>
              <div>
                <RateSlider
                  id="policy-corp"
                  label={t("budget_policy_corp")}
                  info={euInfo("corp", t("budget_policy_tip_corp"))}
                  min={0}
                  max={30}
                  step={0.1}
                  value={corp}
                  defaultValue={CORP_DEF}
                  onChange={setCorp}
                  formatValue={(v) => `${Number(v.toFixed(1))}%`}
                />
                {euNoteLine("corp")}
              </div>
              <RateSlider
                id="policy-div"
                label={t("budget_policy_div")}
                tip={t("budget_policy_tip_div")}
                min={0}
                max={20}
                value={div}
                defaultValue={DIV_DEF}
                onChange={setDiv}
              />
            </div>

            {/* МОД cap */}
            <div className="border-t pt-3">
              <RateSlider
                id="policy-mod"
                label={t("budget_policy_mod", { cap: eur(currentCap) })}
                tip={t("budget_policy_tip_mod")}
                min={modMin}
                max={modMax}
                step={MOD_STEP}
                value={noCap ? modMax : mod}
                defaultValue={currentCap}
                onChange={(v) => {
                  setMod(v);
                  setNoCap(false);
                }}
                suffix=" €"
              />
              <label className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={noCap}
                  onChange={(e) => setNoCap(e.target.checked)}
                  className="accent-indigo-500"
                />
                <span>{t("budget_policy_mod_nocap")}</span>
              </label>
              {affected?.pctAboveCap != null
                ? affectLine(
                    t("budget_policy_affect_mod", {
                      pct: fmtShare(affected.pctAboveCap),
                    }),
                  )
                : null}
            </div>

            {/* Excise — diesel, petrol, cigarettes, spirits, wine */}
            <div className="border-t pt-3">
              <div className="flex w-full items-center justify-between gap-2 text-xs font-medium text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <button
                    type="button"
                    aria-expanded={exciseOpen}
                    onClick={() => setExciseOpen((v) => !v)}
                    className="hover:text-foreground"
                  >
                    {t("budget_policy_excise_title")}
                  </button>
                  <InfoTip text={t("budget_policy_tip_excise")} />
                  {(() => {
                    const n = [
                      diesel !== DIESEL_DEF,
                      petrol !== PETROL_DEF,
                      cigarettes !== CIG_DEF,
                      spirits !== SPIRITS_DEF,
                      wine !== 0,
                    ].filter(Boolean).length;
                    return !exciseOpen && n > 0 ? (
                      <span className="rounded-full bg-indigo-500/10 px-1.5 text-[10px] text-indigo-700 dark:text-indigo-300">
                        {n}
                      </span>
                    ) : null;
                  })()}
                </span>
                <button
                  type="button"
                  tabIndex={-1}
                  aria-hidden="true"
                  onClick={() => setExciseOpen((v) => !v)}
                  className="hover:text-foreground"
                >
                  <ChevronDown
                    className={
                      "h-3.5 w-3.5 transition-transform " +
                      (exciseOpen ? "rotate-180" : "")
                    }
                  />
                </button>
              </div>
              {exciseOpen ? (
                <div className="mt-2 space-y-4">
                  <div>
                    <RateSlider
                      id="policy-excise-diesel"
                      label={t("budget_policy_excise_diesel")}
                      info={euInfo(
                        "exDiesel",
                        t("budget_policy_tip_excise_diesel"),
                      )}
                      min={DIESEL_DEF}
                      max={DIESEL_MAX}
                      step={EXCISE_STEP}
                      value={diesel}
                      defaultValue={DIESEL_DEF}
                      onChange={setDiesel}
                      formatValue={(v) =>
                        lang === "bg" ? `${v} €/1000 л` : `€${v}/1000 L`
                      }
                    />
                    {euNoteLine("exDiesel")}
                  </div>
                  <div>
                    <RateSlider
                      id="policy-excise-petrol"
                      label={t("budget_policy_excise_petrol")}
                      info={euInfo(
                        "exPetrol",
                        t("budget_policy_tip_excise_petrol"),
                      )}
                      min={PETROL_MIN}
                      max={PETROL_MAX}
                      step={EXCISE_STEP}
                      value={petrol}
                      defaultValue={PETROL_DEF}
                      onChange={setPetrol}
                      formatValue={(v) =>
                        lang === "bg" ? `${v} €/1000 л` : `€${v}/1000 L`
                      }
                    />
                    {euNoteLine("exPetrol")}
                  </div>
                  <div>
                    <RateSlider
                      id="policy-excise-cigarettes"
                      label={t("budget_policy_excise_cigarettes")}
                      info={euInfo(
                        "exCigarettes",
                        t("budget_policy_tip_excise_cigarettes"),
                      )}
                      min={CIG_MIN}
                      max={CIG_MAX}
                      step={EXCISE_STEP}
                      value={cigarettes}
                      defaultValue={CIG_DEF}
                      onChange={setCigarettes}
                      formatValue={(v) =>
                        lang === "bg" ? `${v} €/1000` : `€${v}/1000`
                      }
                    />
                    {euNoteLine("exCigarettes")}
                  </div>
                  <div>
                    <RateSlider
                      id="policy-excise-spirits"
                      label={t("budget_policy_excise_spirits")}
                      info={euInfo(
                        "exSpirits",
                        t("budget_policy_tip_excise_spirits"),
                      )}
                      min={SPIRITS_MIN}
                      max={SPIRITS_MAX}
                      step={SPIRITS_STEP}
                      value={spirits}
                      defaultValue={SPIRITS_DEF}
                      onChange={setSpirits}
                      formatValue={(v) =>
                        lang === "bg" ? `${v} €/хл` : `€${v}/hl`
                      }
                    />
                    {euNoteLine("exSpirits")}
                  </div>
                  <div>
                    <RateSlider
                      id="policy-excise-wine"
                      label={t("budget_policy_excise_wine")}
                      info={euInfo(
                        "exWine",
                        t("budget_policy_tip_excise_wine"),
                      )}
                      min={0}
                      max={WINE_MAX}
                      step={WINE_STEP}
                      value={wine}
                      defaultValue={0}
                      onChange={setWine}
                      formatValue={(v) =>
                        lang === "bg" ? `${v} €/хл` : `€${v}/hl`
                      }
                    />
                    {euNoteLine("exWine")}
                  </div>
                </div>
              ) : null}
            </div>

            {/* Gambling — ЗХ variable fee on GGR (single lever) */}
            <div className="border-t pt-3">
              <RateSlider
                id="policy-gambling"
                label={t("budget_policy_gambling")}
                tip={t("budget_policy_tip_gambling")}
                min={0}
                max={GAMBLING_MAX}
                value={gambling}
                defaultValue={GAMBLING_DEF}
                onChange={setGambling}
              />
            </div>

            {/* Expenditure side — pensions, administration, МРЗ */}
            <div className="border-t pt-3">
              {/* InfoTip renders its own <button>, so it must stay a sibling
                  of the toggle — nested buttons are invalid HTML. */}
              <div className="flex w-full items-center justify-between gap-2 text-xs font-medium text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <button
                    type="button"
                    aria-expanded={expOpen}
                    onClick={() => setExpOpen((v) => !v)}
                    className="hover:text-foreground"
                  >
                    {t("budget_policy_exp_title")}
                  </button>
                  <InfoTip text={t("budget_policy_tip_exp")} />
                </span>
                <button
                  type="button"
                  tabIndex={-1}
                  aria-hidden="true"
                  onClick={() => setExpOpen((v) => !v)}
                  className="hover:text-foreground"
                >
                  <ChevronDown
                    className={
                      "h-3.5 w-3.5 transition-transform " +
                      (expOpen ? "rotate-180" : "")
                    }
                  />
                </button>
              </div>
              {expOpen ? (
                <div className="mt-2 space-y-4">
                  <div>
                    <RateSlider
                      id="policy-pw"
                      label={t("budget_policy_swiss")}
                      info={euInfo("pw", t("budget_policy_tip_swiss"))}
                      min={0}
                      max={100}
                      step={10}
                      value={pw}
                      defaultValue={50}
                      onChange={setPw}
                    />
                    {euNoteLine("pw")}
                  </div>
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={noSupp}
                      onChange={(e) => setNoSupp(e.target.checked)}
                      className="accent-indigo-500"
                    />
                    <span>{t("budget_policy_nosupp")}</span>
                    <InfoTip text={t("budget_policy_tip_nosupp")} />
                  </label>
                  <RateSlider
                    id="policy-ph"
                    label={t("budget_policy_horizon")}
                    min={1}
                    max={5}
                    value={ph}
                    defaultValue={1}
                    onChange={setPh}
                    suffix={" " + t("budget_policy_horizon_unit")}
                  />
                  <RateSlider
                    id="policy-adm"
                    label={t("budget_policy_admin")}
                    tip={t("budget_policy_tip_admin")}
                    min={0}
                    max={20}
                    value={adm}
                    defaultValue={0}
                    onChange={setAdm}
                  />
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={mrzFreeze}
                      onChange={(e) => setMrzFreeze(e.target.checked)}
                      className="accent-indigo-500"
                    />
                    <span>
                      {t("budget_policy_mrz", {
                        cur: baseline.expenditure?.minWage.currentEur ?? 620,
                        next: baseline.expenditure?.minWage.formulaEur ?? "",
                      })}
                    </span>
                    <InfoTip text={t("budget_policy_tip_mrz")} />
                  </label>
                  {/* Defense target, % of GDP (NATO definition), in tenths */}
                  <div>
                    <RateSlider
                      id="policy-def"
                      label={t("budget_policy_def")}
                      info={euInfo("def", t("budget_policy_tip_def"))}
                      min={15}
                      max={50}
                      value={def}
                      defaultValue={DEF_DEF}
                      onChange={setDef}
                      formatValue={(v) => `${(v / 10).toFixed(1)}%`}
                    />
                    {euNoteLine("def")}
                  </div>
                  <RateSlider
                    id="policy-wi"
                    label={t("budget_policy_wi")}
                    tip={t("budget_policy_tip_wi")}
                    min={-5}
                    max={15}
                    value={wi}
                    defaultValue={0}
                    onChange={setWi}
                  />
                  {wi !== 0 ? (
                    <label className="flex items-center gap-1.5 pl-4 text-xs text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={wex}
                        onChange={(e) => setWex(e.target.checked)}
                        className="accent-indigo-500"
                      />
                      <span>{t("budget_policy_wex")}</span>
                    </label>
                  ) : null}
                  <RateSlider
                    id="policy-kap"
                    label={t("budget_policy_kap")}
                    tip={t("budget_policy_tip_kap", {
                      rate: Math.round(
                        (baseline.expenditure?.capital.executionRate ?? 1) *
                          100,
                      ),
                    })}
                    min={-30}
                    max={30}
                    value={kap}
                    defaultValue={0}
                    onChange={setKap}
                  />
                  <div>
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={ssp}
                        onChange={(e) => setSsp(e.target.checked)}
                        className="accent-indigo-500"
                      />
                      <span>{t("budget_policy_ssp")}</span>
                      <InfoTip text={t("budget_policy_tip_ssp")} />
                    </label>
                    {ssp ? (
                      <label className="mt-1.5 flex items-center gap-1.5 pl-4 text-xs text-muted-foreground">
                        <input
                          type="checkbox"
                          checked={sspg}
                          onChange={(e) => setSspg(e.target.checked)}
                          className="accent-indigo-500"
                        />
                        <span>{t("budget_policy_sspg")}</span>
                      </label>
                    ) : null}
                    {ssp && baseline.expenditure
                      ? affectLine(
                          t("budget_policy_affect_ssp", {
                            n: fmtCount(baseline.expenditure.sscSelfPaid.count),
                          }),
                        )
                      : null}
                  </div>
                  <RateSlider
                    id="policy-hp"
                    label={t("budget_policy_hp")}
                    tip={t("budget_policy_tip_hp")}
                    min={0}
                    max={3}
                    value={hp}
                    defaultValue={0}
                    onChange={setHp}
                    suffix={lang === "bg" ? " п.п." : " pp"}
                  />
                  {pensionFloor ? (
                    <div>
                      <RateSlider
                        id="policy-mp"
                        label={t("budget_policy_mp", {
                          cur: pensionFloor.minimumEur,
                        })}
                        tip={t("budget_policy_tip_mp")}
                        min={mpDef}
                        max={600}
                        step={10}
                        value={mpEff}
                        defaultValue={mpDef}
                        onChange={(v) => setMp(v === mpDef ? 0 : v)}
                        suffix=" €"
                      />
                      {mpEff !== mpDef
                        ? affectLine(
                            t("budget_policy_affect_mp", {
                              n: fmtCount(
                                pensionFloor.bands.reduce(
                                  (s, b) =>
                                    b.midEur < mpEff ? s + b.count : s,
                                  0,
                                ),
                              ),
                            }),
                          )
                        : null}
                    </div>
                  ) : null}
                  {teachers ? (
                    <RateSlider
                      id="policy-tp"
                      label={t("budget_policy_tp")}
                      tip={t("budget_policy_tip_tp")}
                      min={100}
                      max={140}
                      value={tpEff}
                      defaultValue={tpDef}
                      onChange={(v) => setTp(v === tpDef ? 0 : v)}
                    />
                  ) : null}
                  <div>
                    <RateSlider
                      id="policy-mat"
                      label={t("budget_policy_mat")}
                      info={euInfo("mat", t("budget_policy_tip_mat"))}
                      min={0}
                      max={MATERNITY_Y2_MONTHS}
                      value={mat}
                      defaultValue={MATERNITY_Y2_MONTHS}
                      onChange={setMat}
                      suffix={" " + t("budget_policy_mat_unit")}
                    />
                    {euNoteLine("mat")}
                    {mat !== MATERNITY_Y2_MONTHS
                      ? affectLine(
                          t("budget_policy_affect_mat", {
                            n: fmtCount(
                              MATERNITY_Y2_SPEND_EUR /
                                MATERNITY_Y2_BENEFIT_EUR_MO /
                                12,
                            ),
                          }),
                        )
                      : null}
                  </div>
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={mpf}
                      disabled={!baseline.expenditure}
                      onChange={(e) => setMpf(e.target.checked)}
                      className="accent-indigo-500"
                    />
                    <span>{t("budget_policy_mpf")}</span>
                    <InfoTip text={t("budget_policy_tip_mpf")} />
                  </label>
                  {/* Party subsidy in euro-cents per vote (the def/10 idiom:
                      integer state, fractional display). */}
                  <RateSlider
                    id="policy-psub"
                    label={t("budget_policy_psub")}
                    tip={t("budget_policy_tip_psub")}
                    min={0}
                    max={450}
                    step={25}
                    value={psub}
                    defaultValue={PSUB_DEF}
                    onChange={setPsub}
                    formatValue={(v) =>
                      (lang === "bg"
                        ? (v / 100).toFixed(2).replace(".", ",")
                        : (v / 100).toFixed(2)) + " €"
                    }
                  />
                </div>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 pt-1">
              <button
                type="button"
                onClick={resetAll}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                {t("budget_policy_reset")}
              </button>
              <button
                type="button"
                onClick={onShare}
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                {shareCopied ? (
                  <Check className="h-3.5 w-3.5" />
                ) : (
                  <Link2 className="h-3.5 w-3.5" />
                )}
                {shareCopied
                  ? t("budget_policy_share_done")
                  : t("budget_policy_share")}
              </button>
              <button
                type="button"
                onClick={onShareImage}
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                <ImageDown className="h-3.5 w-3.5" />
                {t("budget_policy_shareimg")}
              </button>
              <button
                type="button"
                onClick={onSubmitScenario}
                disabled={
                  !anyChange ||
                  scenarioSubmitted ||
                  submitScenario.isPending ||
                  submitBlockedInDev
                }
                title={
                  submitBlockedInDev
                    ? t("budget_policy_public_dev_blocked")
                    : t("budget_policy_public_submit_tip")
                }
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline disabled:text-muted-foreground disabled:no-underline disabled:cursor-default"
              >
                {scenarioSubmitted ? (
                  <Check className="h-3.5 w-3.5" />
                ) : (
                  <Vote className="h-3.5 w-3.5" />
                )}
                {scenarioSubmitted
                  ? t("budget_policy_public_done")
                  : submitScenario.isPending
                    ? t("budget_policy_public_busy")
                    : t("budget_policy_public_submit")}
              </button>
              {/* Hidden on desktop — the CommunityCtaStrip under the header
                  carries the group CTA there; kept on mobile where the strip
                  is hidden. */}
              <a
                href={GROUP_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline lg:hidden"
              >
                <Users className="h-3.5 w-3.5" />
                {t("budget_policy_discuss")}
              </a>
            </div>
          </CardContent>
        </Card>

        {/* ============================ RESULTS =========================== */}
        <div className="space-y-4">
          {/* Goal scoreboard: mission chips + the deficit/debt gauge, with
              the scoring-mode toggle riding the card header. */}
          <Card data-shot="scoreboard">
            <CardContent className="pt-3 pb-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <Target className="h-3.5 w-3.5" />
                    {t("budget_policy_goal_title")}
                  </span>
                  {GOAL_IDS.map((g) => (
                    <button
                      key={g}
                      type="button"
                      aria-pressed={goal === g}
                      title={t(`budget_policy_goal_${g}_tip`)}
                      onClick={() => setGoal(g)}
                      className={
                        "rounded-full border px-2 py-0.5 text-[11px] transition-colors " +
                        (goal === g
                          ? "border-indigo-500 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 font-medium"
                          : "border-input text-muted-foreground hover:text-foreground hover:border-ring")
                      }
                    >
                      {t(`budget_policy_goal_${g}`)}
                    </button>
                  ))}
                </div>
                {/* Static | Dynamic scoring-mode toggle */}
                <div
                  className="inline-flex items-center rounded-full border border-input p-0.5"
                  role="group"
                  aria-label={t("budget_policy_mode_label")}
                >
                  {([false, true] as const).map((isDyn) => (
                    <button
                      key={String(isDyn)}
                      type="button"
                      aria-pressed={dyn === isDyn}
                      title={t(
                        isDyn
                          ? "budget_policy_tip_mode_dynamic"
                          : "budget_policy_tip_mode_static",
                      )}
                      onClick={() => setDyn(isDyn)}
                      className={
                        "rounded-full px-2.5 py-0.5 text-[11px] transition-colors " +
                        (dyn === isDyn
                          ? "bg-indigo-500 text-white font-medium"
                          : "text-muted-foreground hover:text-foreground")
                      }
                    >
                      {t(
                        isDyn
                          ? "budget_policy_mode_dynamic"
                          : "budget_policy_mode_static",
                      )}
                    </button>
                  ))}
                </div>
              </div>
              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="text-[11px] text-muted-foreground">
                  {t(`budget_policy_goal_${goal}_desc`, {
                    year: goalState.year,
                  })}
                </span>
                <span
                  className={
                    "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums " +
                    (goalState.met
                      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                      : "bg-amber-500/15 text-amber-700 dark:text-amber-400")
                  }
                >
                  {goalState.met
                    ? t("budget_policy_goal_met", {
                        margin: fmtPct1(Math.abs(goalMarginPp), locale),
                      })
                    : t("budget_policy_goal_missed", {
                        margin: fmtPct1(Math.abs(goalMarginPp), locale),
                      })}
                </span>
              </div>
              <div className="mt-1 px-1">
                <GoalGauge
                  before={goalState.before}
                  after={goalState.after}
                  target={goalState.target}
                  flip={goalState.flip}
                  met={goalState.met}
                  fmt={goalState.fmt}
                  labelBefore={t("budget_policy_goal_now")}
                  labelAfter={t("budget_policy_goal_scenario")}
                  labelTarget={goalState.targetLabel}
                />
              </div>
              {goal === "def" ? (
                <p className="mt-1 text-[10px] text-muted-foreground">
                  {t("budget_policy_goal_def_note", {
                    v: (def / 10).toFixed(1),
                  })}
                </p>
              ) : null}
            </CardContent>
          </Card>

          {/* Hero figures */}
          {/* default grid stretch keeps same-row tiles equal height */}
          <div data-shot="headline" className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border px-3 py-2.5 bg-indigo-500/10 border-indigo-500/30">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground flex items-center gap-1">
                {t("budget_policy_hero_total")}
                <InfoTip
                  text={t(
                    dyn
                      ? "budget_policy_tip_total_dyn"
                      : "budget_policy_tip_total",
                    { year: baseline.baselineYear },
                  )}
                />
              </div>
              <div className="text-xl md:text-2xl font-bold tabular-nums leading-tight text-indigo-700 dark:text-indigo-300">
                {fmtDelta(headline, lang)}
                <span className="text-sm font-medium">
                  {" "}
                  / {t("budget_policy_per_year")}
                </span>
              </div>
              {bandVisible && dynamicScenario ? (
                <div className="text-[11px] text-muted-foreground tabular-nums">
                  {t("budget_policy_hero_range", {
                    low: fmtDelta(dynamicScenario.p5Eur, lang),
                    high: fmtDelta(dynamicScenario.p95Eur, lang),
                  })}
                </div>
              ) : !dyn && modUncertain ? (
                <div className="text-[11px] text-muted-foreground tabular-nums">
                  {t("budget_policy_hero_range", {
                    low: fmtDelta(scenario.low, lang),
                    high: fmtDelta(scenario.high, lang),
                  })}
                </div>
              ) : null}
              {decompVisible ? (
                <div className="text-[11px] text-muted-foreground tabular-nums">
                  {t("budget_policy_hero_decomp", {
                    static: fmtDelta(scenario.central, lang),
                    beh: fmtDelta(behavioralTotal, lang),
                  })}
                </div>
              ) : null}
            </div>
            <div className="rounded-lg border px-3 py-2.5 bg-card border-border">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                {t("budget_policy_hero_gdp")}
              </div>
              <div className="text-xl md:text-2xl font-bold tabular-nums leading-tight">
                {(pctGdp >= 0 ? "+" : "−") +
                  new Intl.NumberFormat(locale, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  }).format(Math.abs(pctGdp))}
                %
              </div>
              <div className="text-[11px] text-muted-foreground">
                {t("budget_policy_hero_gdp_sub", {
                  pct: new Intl.NumberFormat(locale, {
                    maximumFractionDigits: 1,
                  }).format(
                    (headline / baseline.revenue.totalRevenueEur) * 100,
                  ),
                })}
              </div>
              <div className="text-[11px] text-muted-foreground tabular-nums">
                {heroDeficitLine}
              </div>
            </div>
            <div className="rounded-lg border px-3 py-2.5 bg-card border-border">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground flex items-center gap-1">
                <User className="h-3 w-3" />
                {t("budget_policy_hero_citizen")}
              </div>
              <div
                className={
                  "text-xl md:text-2xl font-bold tabular-nums leading-tight " +
                  (citizen.totalDelta > 0
                    ? "text-emerald-700 dark:text-emerald-400"
                    : citizen.totalDelta < 0
                      ? "text-red-700 dark:text-red-400"
                      : "")
                }
              >
                {(citizen.totalDelta >= 0 ? "+" : "−") +
                  eur(Math.abs(citizen.totalDelta))}
                <span className="text-sm font-medium">
                  {" "}
                  / {t("budget_policy_per_month")}
                </span>
              </div>
              <div className="text-[11px] text-muted-foreground">
                {t("budget_policy_hero_citizen_sub", { gross: eur(gross) })}
              </div>
            </div>
          </div>

          {/* Per-tax breakdown */}
          <Card data-shot="breakdown">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Landmark className="h-4 w-4" />
                {t("budget_policy_breakdown_title")}
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {anyChange ? (
                <ul className="space-y-2.5">
                  <DeltaRow
                    label={t("budget_policy_row_vat")}
                    deltaEur={effVat}
                    maxAbs={maxAbs}
                    lang={lang}
                    sub={staticSub(scenario.vatDelta, effVat)}
                  />
                  <DeltaRow
                    label={t("budget_policy_row_pit")}
                    deltaEur={effPit}
                    maxAbs={maxAbs}
                    lang={lang}
                    sub={staticSub(scenario.pitDelta, effPit)}
                  />
                  <DeltaRow
                    label={t("budget_policy_row_corp")}
                    deltaEur={effCorp}
                    maxAbs={maxAbs}
                    lang={lang}
                    sub={staticSub(scenario.corpDelta, effCorp)}
                  />
                  <DeltaRow
                    label={t("budget_policy_row_div")}
                    deltaEur={effDiv}
                    maxAbs={maxAbs}
                    lang={lang}
                    sub={staticSub(scenario.divDelta, effDiv)}
                  />
                  {diesel !== DIESEL_DEF ? (
                    <DeltaRow
                      label={t("budget_policy_row_excise_diesel")}
                      deltaEur={effDiesel}
                      maxAbs={maxAbs}
                      lang={lang}
                      sub={staticSub(scenario.dieselDelta, effDiesel)}
                    />
                  ) : null}
                  {petrol !== PETROL_DEF ? (
                    <DeltaRow
                      label={t("budget_policy_row_excise_petrol")}
                      deltaEur={effPetrol}
                      maxAbs={maxAbs}
                      lang={lang}
                      sub={staticSub(scenario.petrolDelta, effPetrol)}
                    />
                  ) : null}
                  {cigarettes !== CIG_DEF ? (
                    <DeltaRow
                      label={t("budget_policy_row_excise_cigarettes")}
                      tip={t("budget_policy_tip_excise_tobacco_row")}
                      deltaEur={effCigarettes}
                      maxAbs={maxAbs}
                      lang={lang}
                      sub={staticSub(scenario.cigarettesDelta, effCigarettes)}
                    />
                  ) : null}
                  {spirits !== SPIRITS_DEF ? (
                    <DeltaRow
                      label={t("budget_policy_row_excise_spirits")}
                      deltaEur={effSpirits}
                      maxAbs={maxAbs}
                      lang={lang}
                      sub={staticSub(scenario.spiritsDelta, effSpirits)}
                    />
                  ) : null}
                  {wine !== 0 ? (
                    <DeltaRow
                      label={t("budget_policy_row_excise_wine")}
                      deltaEur={effWine}
                      maxAbs={maxAbs}
                      lang={lang}
                      sub={staticSub(scenario.wineDelta, effWine)}
                    />
                  ) : null}
                  {gambling !== GAMBLING_DEF ? (
                    <DeltaRow
                      label={t("budget_policy_row_gambling")}
                      tip={t("budget_policy_tip_gambling_row")}
                      deltaEur={effGambling}
                      maxAbs={maxAbs}
                      lang={lang}
                      sub={staticSub(scenario.gamblingDelta, effGambling)}
                    />
                  ) : null}
                  <DeltaRow
                    label={t("budget_policy_row_mod")}
                    tip={t("budget_policy_tip_mod_row")}
                    deltaEur={effMod}
                    maxAbs={maxAbs}
                    lang={lang}
                    sub={
                      dyn
                        ? staticSub(scenario.modRes.centralEur, effMod)
                        : modUncertain
                          ? `(${fmtDelta(scenario.modRes.lowEur, lang)} … ${fmtDelta(scenario.modRes.highEur, lang)})`
                          : undefined
                    }
                  />
                  {scenario.pensionBalance !== 0 ? (
                    <DeltaRow
                      label={t("budget_policy_row_pensions")}
                      deltaEur={scenario.pensionBalance}
                      maxAbs={maxAbs}
                      lang={lang}
                    />
                  ) : null}
                  {scenario.adminRes ? (
                    <DeltaRow
                      label={t("budget_policy_row_admin")}
                      deltaEur={scenario.adminBalance}
                      maxAbs={maxAbs}
                      lang={lang}
                      sub={t("budget_policy_admin_note", {
                        vac: Math.round(
                          scenario.adminRes.vacantAbsorbedShare * 100,
                        ),
                      })}
                    />
                  ) : null}
                  {scenario.mwDelta !== 0 ? (
                    <DeltaRow
                      label={t("budget_policy_row_mrz")}
                      deltaEur={scenario.mwDelta}
                      maxAbs={maxAbs}
                      lang={lang}
                    />
                  ) : null}
                  {scenario.defBalance !== 0 ? (
                    <DeltaRow
                      label={t("budget_policy_row_def")}
                      deltaEur={scenario.defBalance}
                      maxAbs={maxAbs}
                      lang={lang}
                    />
                  ) : null}
                  {scenario.wiBalance !== 0 ? (
                    <DeltaRow
                      label={t("budget_policy_row_wi")}
                      deltaEur={scenario.wiBalance}
                      maxAbs={maxAbs}
                      lang={lang}
                      sub={wex ? t("budget_policy_wi_note") : undefined}
                    />
                  ) : null}
                  {scenario.kapBalance !== 0 ? (
                    <DeltaRow
                      label={t("budget_policy_row_kap")}
                      deltaEur={scenario.kapBalance}
                      maxAbs={maxAbs}
                      lang={lang}
                      sub={t("budget_policy_kap_note", {
                        rate: Math.round(
                          (baseline.expenditure?.capital.executionRate ?? 1) *
                            100,
                        ),
                      })}
                    />
                  ) : null}
                  {scenario.sspBalance !== 0 || (ssp && sspg) ? (
                    <DeltaRow
                      label={t("budget_policy_row_ssp")}
                      deltaEur={scenario.sspBalance}
                      maxAbs={maxAbs}
                      lang={lang}
                      sub={sspg ? t("budget_policy_ssp_note") : undefined}
                    />
                  ) : null}
                  {scenario.hpDelta !== 0 ? (
                    <DeltaRow
                      label={t("budget_policy_row_hp")}
                      deltaEur={effHp}
                      maxAbs={maxAbs}
                      lang={lang}
                      sub={staticSub(scenario.hpDelta, effHp)}
                    />
                  ) : null}
                  {scenario.mpBalance !== 0 ? (
                    <DeltaRow
                      label={t("budget_policy_row_mp")}
                      tip={t("budget_policy_tip_mp")}
                      deltaEur={scenario.mpBalance}
                      maxAbs={maxAbs}
                      lang={lang}
                    />
                  ) : null}
                  {scenario.tpBalance !== 0 ? (
                    <DeltaRow
                      label={t("budget_policy_row_tp")}
                      tip={t("budget_policy_tip_tp")}
                      deltaEur={scenario.tpBalance}
                      maxAbs={maxAbs}
                      lang={lang}
                    />
                  ) : null}
                  {scenario.matBalance !== 0 ? (
                    <DeltaRow
                      label={t("budget_policy_row_mat")}
                      tip={t("budget_policy_tip_mat")}
                      deltaEur={effMat}
                      sub={staticSub(scenario.matBalance, effMat)}
                      maxAbs={maxAbs}
                      lang={lang}
                    />
                  ) : null}
                  {scenario.mpfBalance !== 0 ? (
                    <DeltaRow
                      label={t("budget_policy_row_mpf")}
                      tip={t("budget_policy_tip_mpf")}
                      deltaEur={scenario.mpfBalance}
                      maxAbs={maxAbs}
                      lang={lang}
                    />
                  ) : null}
                  {scenario.psubBalance !== 0 ? (
                    <DeltaRow
                      label={t("budget_policy_row_psub")}
                      tip={t("budget_policy_tip_psub")}
                      deltaEur={scenario.psubBalance}
                      maxAbs={maxAbs}
                      lang={lang}
                    />
                  ) : null}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {t("budget_policy_no_change")}
                </p>
              )}
              {comparator ? (
                <p className="mt-2 text-[11px] text-muted-foreground tabular-nums">
                  {t("budget_policy_comparator", {
                    health: new Intl.NumberFormat(locale, {
                      maximumFractionDigits: 1,
                    }).format(comparator.healthPct),
                    education: new Intl.NumberFormat(locale, {
                      maximumFractionDigits: 1,
                    }).format(comparator.educationPct),
                    year: comparator.year,
                  })}
                </p>
              ) : null}
              <p className="mt-3 text-[11px] text-muted-foreground/80">
                {t("budget_policy_baseline_note", {
                  year: baseline.baselineYear,
                  vat: fmtCompactEur(baseline.revenue.vatEur, lang),
                  pit: fmtCompactEur(baseline.revenue.pitEur, lang),
                })}
              </p>
            </CardContent>
          </Card>

          {/* Multi-year balance & debt projection */}
          <div data-shot="projection">
            <PolicyFiscalProjection
              projection={projection}
              anyChange={anyChange}
              lang={lang}
              locale={locale}
            />
          </div>

          {/* What the public chose — renders only when the tally backend
              answers and at least one scenario exists. */}
          {publicStats.data && publicStats.data.total > 0 ? (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Vote className="h-4 w-4" />
                  {t("budget_policy_public_title")}
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <p className="text-sm tabular-nums">
                  {t("budget_policy_public_count", {
                    n: new Intl.NumberFormat(locale).format(
                      publicStats.data.total,
                    ),
                  })}
                </p>
                {publicStats.data.total >= 20 ? (
                  <div className="mt-2 space-y-1.5 text-xs text-muted-foreground">
                    <p className="tabular-nums">
                      {t("budget_policy_public_edp", {
                        pct: publicStats.data.pctEdpMet ?? 0,
                      })}
                    </p>
                    {publicStats.data.medianHeadlineEur != null ? (
                      <p className="tabular-nums">
                        {t("budget_policy_public_median", {
                          v: fmtDelta(publicStats.data.medianHeadlineEur, lang),
                        })}
                      </p>
                    ) : null}
                    {publicTopChips.length ? (
                      <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                        <span>{t("budget_policy_public_top")}</span>
                        {publicTopChips.map((c) => (
                          <span
                            key={c.rowKey}
                            className="rounded-full border border-input px-2 py-0.5 text-[11px] text-foreground tabular-nums"
                          >
                            {t(`budget_policy_row_${c.rowKey}`)} · {c.count}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t("budget_policy_public_few")}
                  </p>
                )}
                <p className="mt-2 text-[11px] text-muted-foreground/80">
                  {t("budget_policy_public_caption")}
                </p>
              </CardContent>
            </Card>
          ) : null}

          {/* Scenario summary sentence */}
          {sentence ? (
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm">{sentence}</p>
                  <button
                    type="button"
                    onClick={onCopySentence}
                    className="inline-flex shrink-0 items-center gap-1 text-xs text-primary hover:underline"
                  >
                    {sentenceCopied ? (
                      <Check className="h-3.5 w-3.5" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                    {sentenceCopied
                      ? t("budget_policy_share_done")
                      : t("budget_policy_sentence_copy")}
                  </button>
                </div>
              </CardContent>
            </Card>
          ) : null}

          {/* Winners and losers: the decile strip is the citizen-legible
              primary; the full incidence curve folds away beneath it. */}
          {(deciles && deciles.anyVisible) ||
          (distribution && distribution.anyVisible) ? (
            <Card data-shot="deciles">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Users className="h-4 w-4" />
                  {t("budget_policy_decile_title")}
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                {deciles ? (
                  <PolicyDecileStrip
                    deciles={deciles.means}
                    locale={locale}
                    labelLow={t("budget_policy_decile_low")}
                    labelHigh={t("budget_policy_decile_high")}
                    ariaLabel={t("budget_policy_decile_title")}
                  />
                ) : null}
                <p className="mt-1 text-[11px] text-muted-foreground/80">
                  {t("budget_policy_decile_caption")}
                  {distribution &&
                  Math.abs(distribution.giniAfter - distribution.giniBefore) >=
                    0.0005
                    ? " " +
                      t("budget_policy_gini", {
                        before: new Intl.NumberFormat(locale, {
                          minimumFractionDigits: 3,
                          maximumFractionDigits: 3,
                        }).format(distribution.giniBefore),
                        after: new Intl.NumberFormat(locale, {
                          minimumFractionDigits: 3,
                          maximumFractionDigits: 3,
                        }).format(distribution.giniAfter),
                      })
                    : ""}
                </p>
                {distribution && distribution.anyVisible ? (
                  <div className="mt-2 border-t pt-2">
                    <button
                      type="button"
                      aria-expanded={incidenceOpen}
                      onClick={() => setIncidenceOpen((v) => !v)}
                      className="flex w-full items-center justify-between gap-2 text-xs font-medium text-muted-foreground hover:text-foreground"
                    >
                      <span>{t("budget_policy_incidence_title")}</span>
                      <ChevronDown
                        className={
                          "h-3.5 w-3.5 transition-transform " +
                          (incidenceOpen ? "rotate-180" : "")
                        }
                      />
                    </button>
                    {incidenceOpen ? (
                      <div className="mt-2">
                        <PolicyIncidenceCurve
                          points={distribution.points}
                          locale={locale}
                          capEur={noCap ? undefined : mod}
                        />
                        <p className="mt-1 text-[11px] text-muted-foreground/80">
                          {t("budget_policy_incidence_caption")}
                        </p>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          {/* Citizen pane */}
          <Card data-shot="citizen">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <User className="h-4 w-4" />
                {t("budget_policy_citizen_title")}
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <div>
                <label
                  htmlFor="policy-gross"
                  className="flex items-baseline justify-between gap-2"
                >
                  <span className="text-xs text-muted-foreground">
                    {t("budget_policy_citizen_gross")}
                  </span>
                  <span className="text-sm font-semibold tabular-nums">
                    {eur(gross)}
                  </span>
                </label>
                <input
                  id="policy-gross"
                  type="range"
                  min={500}
                  max={8000}
                  step={100}
                  value={gross}
                  onChange={(e) => setGross(Number(e.target.value))}
                  className="mt-1.5 w-full accent-indigo-500"
                  aria-label={t("budget_policy_citizen_gross")}
                />
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                <div className="rounded-md bg-muted/40 px-2 py-1.5">
                  <div className="text-muted-foreground">
                    {t("budget_policy_citizen_net")}
                  </div>
                  <div className="font-semibold tabular-nums">
                    {(citizen.netDelta >= 0 ? "+" : "−") +
                      eur(Math.abs(citizen.netDelta))}
                  </div>
                </div>
                <div className="rounded-md bg-muted/40 px-2 py-1.5">
                  <div className="text-muted-foreground">
                    {t("budget_policy_citizen_vat")}
                  </div>
                  <div className="font-semibold tabular-nums">
                    {(citizen.vatDelta > 0 ? "−" : "+") +
                      eur(Math.abs(citizen.vatDelta))}
                  </div>
                </div>
                <div className="rounded-md bg-indigo-500/10 px-2 py-1.5 ring-1 ring-indigo-500/20">
                  <div className="text-muted-foreground">
                    {t("budget_policy_citizen_total")}
                  </div>
                  <div className="font-semibold tabular-nums text-indigo-700 dark:text-indigo-300">
                    {(citizen.totalDelta >= 0 ? "+" : "−") +
                      eur(Math.abs(citizen.totalDelta))}
                  </div>
                </div>
              </div>
              <div className="mt-3 border-t pt-2">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  {t("budget_policy_exemplars_title")}
                </div>
                <div className="mt-1.5 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                  {citizen.exemplars.map((ex) => (
                    <div
                      key={ex.gross}
                      className="rounded-md bg-muted/40 px-2 py-1.5"
                    >
                      <div className="text-muted-foreground tabular-nums">
                        {eur(ex.gross)}
                      </div>
                      <div
                        className={
                          "font-semibold tabular-nums " +
                          (ex.totalDelta > 0.5
                            ? "text-emerald-700 dark:text-emerald-400"
                            : ex.totalDelta < -0.5
                              ? "text-red-700 dark:text-red-400"
                              : "")
                        }
                      >
                        {(ex.totalDelta >= 0 ? "+" : "−") +
                          eur(Math.abs(ex.totalDelta))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground/80">
                {t("budget_policy_citizen_caption")}
              </p>
            </CardContent>
          </Card>

          {/* Methodology — the full write-up (caveats, sourced behavioral
              assumptions, and the model-vs-published benchmark table) now lives
              in the analysis article, linked here and from the page intro. */}
          <Card>
            <CardContent className="py-3">
              <Link
                to="/articles/2026-06-12-tax-policy-simulator"
                className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
              >
                <BookOpen className="h-4 w-4 shrink-0" />
                {t("budget_policy_methodology_link")}
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Sticky mobile result bar — on small screens the controls are a long
          scroll above the results, so the headline numbers follow along once
          a scenario deviates from current law. */}
      {anyChange ? (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 backdrop-blur px-4 py-2 lg:hidden">
          <div className="flex items-center justify-between gap-3 text-xs">
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                {t("budget_policy_hero_total")}
              </div>
              <div className="font-bold tabular-nums text-sm text-indigo-700 dark:text-indigo-300">
                {fmtDelta(headline, lang)} / {t("budget_policy_per_year")}
              </div>
            </div>
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                {t("budget_policy_hero_citizen")}
              </div>
              <div
                className={
                  "font-bold tabular-nums text-sm " +
                  (citizen.totalDelta > 0
                    ? "text-emerald-700 dark:text-emerald-400"
                    : citizen.totalDelta < 0
                      ? "text-red-700 dark:text-red-400"
                      : "")
                }
              >
                {(citizen.totalDelta >= 0 ? "+" : "−") +
                  eur(Math.abs(citizen.totalDelta))}{" "}
                / {t("budget_policy_per_month")}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};
