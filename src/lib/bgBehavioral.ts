// Behavioral / dynamic-scoring layer for the budget policy simulator.
// Where bgTaxPolicy.ts scores a policy STATICALLY (fixed base, no response),
// this module adds the response: Tier 1 = per-lever base reactions
// (reporting, shifting, compliance, and labour-supply participation —
// applied as EUR offsets to the static deltas), Tier 2 = a reduced-form
// macro feedback in the 5-year projection
// (fiscal impulse → multiplier → ΔGDP → revenue), and a seeded Monte Carlo
// over every behavioral parameter that turns the headline into a central
// estimate with a 90% band.
//
// The static score* functions stay pure and untouched; everything here is
// strictly downstream of them. Constants follow the June-2026 debate-lever
// idiom of bgTaxPolicy.ts: sourced values in code (each carries its citation),
// deliberately NOT piped through policy_baseline.json — they are literature
// anchors, not pipeline aggregates. Convention throughout: every parameter is
// defined so that VALUE 0 == "no behavioral response" (the zero-draw identity
// gate in scripts/budget/__smoke_behavioral.ts), and offsets are EUR added to
// the static delta with positive = revenue gain. A tax-base offset always
// OPPOSES the static delta's sign (behavioral leakage shrinks a static gain);
// the maternity recapture is the one exception that REINFORCES it (a benefit
// cut also brings returning mothers' PIT+SSC — a supply response, not leakage).
//
// Tier-1 vs Tier-2 separation (anti-double-counting rule): Tier 1 carries
// supply-side margins only (reporting/shifting/compliance + labour-supply
// participation); aggregate-demand effects live ONLY in Tier 2 (which is why
// VAT gets the low multiplier band — its compliance margin is already taken
// upstream).

import {
  CORP_TAX_RATE,
  DIVIDEND_TAX_RATE,
  PIT_RATE,
  SSC_EMPLOYEE_RATE,
} from "./bgTax";
import {
  SSC_COMBINED_BUDGET_RATE,
  labourTaxFeedbackOnSalary,
  MATERNITY_Y2_SPEND_EUR,
  MATERNITY_Y2_MONTHS,
  MATERNITY_Y2_BENEFIT_EUR_MO,
  GAMBLING_GGR_EUR,
  GAMBLING_GGR_FEE_RATE,
  type EarningsBand,
  type ModIdentity,
  type PitBracket,
} from "./bgTaxPolicy";
import { PROJECTION_GDP_EUR, PROJECTION_YEARS } from "./bgFiscalProjection";

// ---------------------------------------------------------------------------
// Sourced behavioral parameters
// ---------------------------------------------------------------------------

/** A behavioral parameter with its plausible band and citation. The source
 *  string is rendered verbatim in the UI's "behavioral assumptions" list. */
export interface ElasticityBand {
  low: number;
  central: number;
  high: number;
  source: string;
}

/** Elasticity of taxable income, wage employment. BG wage income is withheld
 *  at source (thin evasion margin) → below the US central. */
export const ETI_EMPLOYMENT: ElasticityBand = {
  low: 0.1,
  central: 0.2,
  high: 0.4,
  source:
    "Gruber & Saez (2002) ≈0.4 overall / ≈0.12 broad income; Saez, Slemrod & Giertz (2012, JEL). No BG-specific estimate — band set below the US central (withholding at source).",
};

/** ETI, non-employment income (self-employment, rents, окончателен данък
 *  bases) — markedly more elastic in every survey. */
export const ETI_NON_EMPLOYMENT: ElasticityBand = {
  low: 0.3,
  central: 0.5,
  high: 0.8,
  source:
    "Saez, Slemrod & Giertz (2012): self-employment/capital income; Gorodnichenko, Martinez-Vazquez & Sabirianova Peter (2009, JPE) — flat-tax compliance channel.",
};

/** Semi-elasticity of the CIT base, % per +1пп of rate (positive magnitude).
 *  The high band reflects BG's 10% rate as an inbound profit-shifting
 *  attractor — outbound response to a raise is correspondingly larger. */
export const CIT_BASE_SEMI_ELAST_PCT_PP: ElasticityBand = {
  low: 0.4,
  central: 0.8,
  high: 1.5,
  source:
    "de Mooij & Ederveen meta-analyses; Heckemeyer & Overesch (2017) consensus ≈0.8; Beer, de Mooij & Liu (2020, IMF) ≈1.0 profit shifting.",
};

/** Semi-elasticity of the dividend-withholding base, % per +1пп. CALIBRATED,
 *  not estimated: the central is reverse-engineered so the 5→10% scenario
 *  lands ≈ €45M against the Фискален съвет ceiling (≤ €50M) vs €75M static —
 *  the one published BG behavioral costing the engine can anchor to. */
export const DIV_BASE_SEMI_ELAST_PCT_PP: ElasticityBand = {
  low: 3.0,
  central: 4.5,
  high: 6.5,
  source:
    "Calibrated to Фискален съвет, становище 12.12.2025 (5→10% ≤ +€50M); mechanism per Chetty & Saez (2005) and Alstadsæter et al. — payout timing + closely-held income shifting.",
};

/** Share of a static VAT delta lost to the compliance/cross-border margin
 *  (demand response is Tier 2). Symmetric: cuts also recover some gap. */
export const VAT_GAP_RESPONSE: ElasticityBand = {
  low: 0.03,
  central: 0.1,
  high: 0.2,
  source:
    "EC VAT gap report, 2025 edition (BG gap €781M = 8.6% of VTTL) as the level anchor; rate-sensitivity per the CASE/EC compliance studies.",
};

/** Avoidance haircut on the incremental insurable base of a МОД-cap raise
 *  (salary → dividend/management-fee restructuring above the cap). */
export const SSC_CAP_AVOIDANCE: ElasticityBand = {
  low: 0.05,
  central: 0.1,
  high: 0.2,
  source:
    "Judgment band; anchors: КНСБ-vs-МФ spread on the 2025 МОД raise; World Bank / Eurofound undeclared-work studies for BG.",
};

/** Avoidance haircut on a broad contribution-rate change (no notch to bunch
 *  at, so smaller than the cap response). */
export const SSC_RATE_AVOIDANCE: ElasticityBand = {
  low: 0.02,
  central: 0.05,
  high: 0.1,
  source:
    "Judgment band, same anchors as the cap response — scaled down (no notch).",
};

/** Share of mothers on the paid second year of leave who return to work when
 *  the benefit is cut — and so begin paying PIT + SSC, a recapture in the
 *  budget's favour ON TOP of the benefit saving (so the true saving of a cut
 *  is larger than the static headline). BG's paid second year is among the
 *  EU's longest; the КСО чл.54 "50% benefit if working" rule means a slice
 *  already works, and scarce under-3 childcare caps the return. */
export const MATERNITY_RETURN_TO_WORK: ElasticityBand = {
  low: 0.25,
  central: 0.45,
  high: 0.65,
  source:
    "Judgment band: НСИ maternal-employment gap for children <3 (low among EU) + the КСО чл.54 50%-benefit-if-working rule; OECD Family Database leave-length context. No BG point estimate.",
};

/** Representative GROSS monthly wage of a mother returning from the paid
 *  second year, EUR. Set below the ~€1,230 НСИ-2025 average gross wage — the
 *  second-year-leave cohort skews younger and lower-paid; conservative for
 *  the recapture. */
export const MATERNITY_RETURN_WAGE_EUR_MO = 1000;

/** Net budget recapture per €1 of dividend base that a rate change relabels
 *  between the dividend and salary bases. Deliberately small and bounded:
 *  most of the calibrated dividend base response is profit-retention /
 *  payout-timing (not salary relabeling), and dividend income concentrates
 *  ABOVE the SSC cap where shifting to salary is ≈ PIT-minus-CIT-neutral, so
 *  the recapture bites only on the below-cap sliver. Kept OFF the dividend
 *  line itself (it rides its own offset), so the Фискален-съвет dividend
 *  calibration is untouched. */
export const DIV_SHIFT_TO_SALARY: ElasticityBand = {
  low: 0.0,
  central: 0.008,
  high: 0.03,
  source:
    "Derived: (relabel share ≈0.2 of the dividend base response) × (net below-cap labour-tax take ≈0.04 = SSC+PIT net of CIT deductibility). Mechanism per Chetty & Saez (2005); Alstadsæter et al. income shifting.",
};

/** Year-1 multiplier on a non-VAT tax impulse. */
export const MULT_TAX_Y1: ElasticityBand = {
  low: 0.2,
  central: 0.35,
  high: 0.5,
  source:
    "IMF WP/13/49 (Muir & Weber, Bulgaria): year-1 tax multiplier 0.3–0.4.",
};

/** Year-1 multiplier on a VAT impulse — the low end of the tax range, and
 *  deliberately lower here because the compliance margin is in Tier 1. */
export const MULT_VAT_Y1: ElasticityBand = {
  low: 0.1,
  central: 0.25,
  high: 0.4,
  source: 'IMF WP/13/49: "VAT at the low end" of the tax-multiplier range.',
};

/** Year-1 multiplier on a spending impulse. */
export const MULT_SPEND_Y1: ElasticityBand = {
  low: 0,
  central: 0.05,
  high: 0.2,
  source: "IMF WP/13/49: spending multipliers ≈ 0 for Bulgaria.",
};

/** Geometric decay of the multiplier effect per year (φ). */
export const MULT_PERSISTENCE: ElasticityBand = {
  low: 0.4,
  central: 0.6,
  high: 0.8,
  source:
    "Reduced form of the GIMF decay profile under the currency board (IMF WP/13/49); supply-side persistence already sits in Tier 1.",
};

/** Marginal revenue share of a GDP deviation. */
export const REVENUE_GDP_FEEDBACK: ElasticityBand = {
  low: 0.33,
  central: 0.38,
  high: 0.4,
  source:
    "Consolidated revenue ≈ 38% of GDP; long-run buoyancy ≈ 1.0 (EC Economic Papers 536, BG rows).",
};

// --- Excise response semi-elasticities -------------------------------------
// Each is the % erosion of the consumption base per +1pp of the rate INDEX
// (a +10% rate move = +10pp), so at the margin a fraction ≈ s of the static
// gain is lost to behaviour. They fold (excise-share-of-retail-price ×
// pass-through × demand elasticity) together with the cross-border / illicit
// substitution channel, which dominates for tobacco.

/** Fuel/energy excise. Demand is inelastic (−0.1…−0.3 SR) and BG petrol/diesel
 *  already sit at the EU floor; the residual response is pump-price pass-
 *  through plus RO/RS cross-border arbitrage on a hike. */
export const EXCISE_FUEL_RESPONSE: ElasticityBand = {
  low: 0.04,
  central: 0.1,
  high: 0.25,
  source:
    "Fuel demand elasticity −0.1…−0.3 SR (Parry & Small 2005; Istiee 2023 review −0.09…−0.76 SR); excise ≈⅓ of pump price, ~90% pass-through; cross-border arbitrage RO/RS as the high band.",
};

/** Tobacco excise — the Laffer-prone lever. Legal-cigarette demand elasticity
 *  ≈−0.4 (EU panel) but the dominant BG channel is illicit/cross-border
 *  substitution: the 2009→2010 hike coincided with illicit share rising
 *  ~17.5%→39.7%. The high band drives a revenue turn on large hikes. */
export const EXCISE_TOBACCO_RESPONSE: ElasticityBand = {
  low: 0.12,
  central: 0.25,
  high: 0.6,
  source:
    "Cigarette price elasticity ≈−0.4 (EU panel, PMC10277038); BG illicit-trade response (Univ. of Bath / CSD: illicit share 17.5%→39.7% after the 2009–2010 excise rise) sets the high band — a Laffer turn on large hikes. BG-specific −1.49 treated as an outlier.",
};

/** Alcohol excise. Spirits are price-elastic (−0.5…−0.8); BG adds a home-still
 *  (ракия казан) and unrecorded-consumption substitution margin. */
export const EXCISE_ALCOHOL_RESPONSE: ElasticityBand = {
  low: 0.12,
  central: 0.25,
  high: 0.5,
  source:
    "Spirits elasticity −0.5…−0.8 (NCBI NBK566208); beer/heavy-user demand inelastic; BG home-production (ракия) + Eastern-EU unrecorded consumption as the high band.",
};

/** Share of an INTRODUCED wine excise lost to demand response + the untaxed
 *  home-produced / off-survey channel (the ~18 vs ~4.7 L/capita gap between
 *  the ИАЛВ total and the NSI household survey) + collection ramp. Wine demand
 *  is fairly inelastic, so the leakage is modest. */
export const EXCISE_WINE_LEAKAGE: ElasticityBand = {
  low: 0.05,
  central: 0.15,
  high: 0.35,
  source:
    "Judgment band: wine demand inelastic, but a large home-produced/off-survey slice (ИАЛВ ~18 L/capita vs NSI ~4.7 L/capita) escapes any introduced excise; collection ramp on a brand-new base.",
};

/** Semi-elasticity of the licensed gambling GGR base, % per +1pp of the ЗХ
 *  fee rate. The dominant channel is migration of players/operators to
 *  unlicensed/offshore sites — so the base erodes faster than ordinary demand
 *  would imply, and a large hike runs into a Laffer turn. No clean BG estimate;
 *  the high band reflects the documented 2013 turnover-tax episode (foreign
 *  operators uncapturable, the stated motive for the GGR rebase). */
export const GAMBLING_GGR_RESPONSE: ElasticityBand = {
  low: 0.5,
  central: 1.0,
  high: 2.5,
  source:
    "Judgment band: licensed GGR migrates to unlicensed/offshore operators as the rate rises (51 licensed online operators compete with offshore). High band anchored to the 2013 turnover-base episode and the >½B BGN 2015–19 under-collection; central tuned so the legislated +5pp (20→25%, 2026) lands near the МФ ≈€32M projection.",
};

/** Ordered list for the UI's "behavioral assumptions" fold-out — the i18n
 *  label key is budget_policy_elast_<key>. */
export const BEHAVIORAL_PARAMS: { key: string; band: ElasticityBand }[] = [
  { key: "eti_emp", band: ETI_EMPLOYMENT },
  { key: "eti_nonemp", band: ETI_NON_EMPLOYMENT },
  { key: "cit", band: CIT_BASE_SEMI_ELAST_PCT_PP },
  { key: "div", band: DIV_BASE_SEMI_ELAST_PCT_PP },
  { key: "vat_gap", band: VAT_GAP_RESPONSE },
  { key: "excise_fuel", band: EXCISE_FUEL_RESPONSE },
  { key: "excise_tobacco", band: EXCISE_TOBACCO_RESPONSE },
  { key: "excise_alcohol", band: EXCISE_ALCOHOL_RESPONSE },
  { key: "excise_wine", band: EXCISE_WINE_LEAKAGE },
  { key: "gambling", band: GAMBLING_GGR_RESPONSE },
  { key: "ssc_cap", band: SSC_CAP_AVOIDANCE },
  { key: "ssc_rate", band: SSC_RATE_AVOIDANCE },
  { key: "maternity_return", band: MATERNITY_RETURN_TO_WORK },
  { key: "div_shift", band: DIV_SHIFT_TO_SALARY },
  { key: "mult_tax", band: MULT_TAX_Y1 },
  { key: "mult_vat", band: MULT_VAT_Y1 },
  { key: "mult_spend", band: MULT_SPEND_Y1 },
  { key: "persistence", band: MULT_PERSISTENCE },
  { key: "rev_share", band: REVENUE_GDP_FEEDBACK },
];

// ---------------------------------------------------------------------------
// Parameter draws
// ---------------------------------------------------------------------------

/** One resolved sample of every behavioral parameter. */
export interface BehavioralDraw {
  etiEmployment: number;
  etiNonEmployment: number;
  citSemiElast: number;
  divSemiElast: number;
  vatGapResponse: number;
  sscCapAvoidance: number;
  sscRateAvoidance: number;
  multTax: number;
  multVat: number;
  multSpend: number;
  persistence: number;
  revenueFeedbackShare: number;
  /** Share of cut-maternity mothers returning to work (PIT+SSC recapture). */
  maternityReturnShare: number;
  /** Net recapture coefficient on dividend↔salary relabeling. */
  divShiftRecapture: number;
  /** Pareto tail index for the МОД closed form. */
  modAlpha: number;
  /** Model-margin factor for МОД cap LOWERING (the ±15% band). */
  modLowerFactor: number;
  /** Excise base-erosion semi-elasticities (% base per +1pp of rate index). */
  exciseFuelResponse: number;
  exciseTobaccoResponse: number;
  exciseAlcoholResponse: number;
  /** Share of an introduced wine excise lost to demand + home-production. */
  exciseWineLeakage: number;
  /** Gambling GGR base erosion (offshore/illicit migration), % per +1pp. */
  gamblingResponse: number;
}

export const centralDraw = (modAlphaCentral: number): BehavioralDraw => ({
  etiEmployment: ETI_EMPLOYMENT.central,
  etiNonEmployment: ETI_NON_EMPLOYMENT.central,
  citSemiElast: CIT_BASE_SEMI_ELAST_PCT_PP.central,
  divSemiElast: DIV_BASE_SEMI_ELAST_PCT_PP.central,
  vatGapResponse: VAT_GAP_RESPONSE.central,
  sscCapAvoidance: SSC_CAP_AVOIDANCE.central,
  sscRateAvoidance: SSC_RATE_AVOIDANCE.central,
  multTax: MULT_TAX_Y1.central,
  multVat: MULT_VAT_Y1.central,
  multSpend: MULT_SPEND_Y1.central,
  persistence: MULT_PERSISTENCE.central,
  revenueFeedbackShare: REVENUE_GDP_FEEDBACK.central,
  maternityReturnShare: MATERNITY_RETURN_TO_WORK.central,
  divShiftRecapture: DIV_SHIFT_TO_SALARY.central,
  modAlpha: modAlphaCentral,
  modLowerFactor: 1,
  exciseFuelResponse: EXCISE_FUEL_RESPONSE.central,
  exciseTobaccoResponse: EXCISE_TOBACCO_RESPONSE.central,
  exciseAlcoholResponse: EXCISE_ALCOHOL_RESPONSE.central,
  exciseWineLeakage: EXCISE_WINE_LEAKAGE.central,
  gamblingResponse: GAMBLING_GGR_RESPONSE.central,
});

/** Every parameter at 0 → the layer reproduces static scoring exactly. */
export const zeroDraw = (modAlphaCentral: number): BehavioralDraw => ({
  etiEmployment: 0,
  etiNonEmployment: 0,
  citSemiElast: 0,
  divSemiElast: 0,
  vatGapResponse: 0,
  sscCapAvoidance: 0,
  sscRateAvoidance: 0,
  multTax: 0,
  multVat: 0,
  multSpend: 0,
  persistence: 0,
  revenueFeedbackShare: 0,
  maternityReturnShare: 0,
  divShiftRecapture: 0,
  modAlpha: modAlphaCentral,
  modLowerFactor: 1,
  exciseFuelResponse: 0,
  exciseTobaccoResponse: 0,
  exciseAlcoholResponse: 0,
  exciseWineLeakage: 0,
  gamblingResponse: 0,
});

export const MC_DRAWS = 500;
export const MC_SEED = 0x5eedb67;

/** mulberry32 — deterministic 32-bit PRNG, ~4 integer ops per call. */
export const mulberry32 = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/** Triangular(low, central, high) inverse-CDF sample. */
export const sampleTriangular = (u: number, b: ElasticityBand): number => {
  const a = b.low;
  const c = b.high;
  const m = b.central;
  if (c <= a) return m;
  const fm = (m - a) / (c - a);
  return u < fm
    ? a + Math.sqrt(u * (c - a) * (m - a))
    : c - Math.sqrt((1 - u) * (c - a) * (c - m));
};

const tri = (u: number, low: number, central: number, high: number): number =>
  sampleTriangular(u, { low, central, high, source: "" });

/** N full parameter draws — pure in (n, seed, mod), so callers memoize on the
 *  baseline only and slider moves never resample (no band flicker). */
export const sampleDraws = (
  n: number,
  seed: number,
  mod: ModIdentity,
): BehavioralDraw[] => {
  const rnd = mulberry32(seed);
  const draws: BehavioralDraw[] = [];
  for (let i = 0; i < n; i++) {
    draws.push({
      etiEmployment: sampleTriangular(rnd(), ETI_EMPLOYMENT),
      etiNonEmployment: sampleTriangular(rnd(), ETI_NON_EMPLOYMENT),
      citSemiElast: sampleTriangular(rnd(), CIT_BASE_SEMI_ELAST_PCT_PP),
      divSemiElast: sampleTriangular(rnd(), DIV_BASE_SEMI_ELAST_PCT_PP),
      vatGapResponse: sampleTriangular(rnd(), VAT_GAP_RESPONSE),
      sscCapAvoidance: sampleTriangular(rnd(), SSC_CAP_AVOIDANCE),
      sscRateAvoidance: sampleTriangular(rnd(), SSC_RATE_AVOIDANCE),
      multTax: sampleTriangular(rnd(), MULT_TAX_Y1),
      multVat: sampleTriangular(rnd(), MULT_VAT_Y1),
      multSpend: sampleTriangular(rnd(), MULT_SPEND_Y1),
      persistence: sampleTriangular(rnd(), MULT_PERSISTENCE),
      revenueFeedbackShare: sampleTriangular(rnd(), REVENUE_GDP_FEEDBACK),
      modAlpha: tri(rnd(), mod.alphaLow, mod.alphaCentral, mod.alphaHigh),
      modLowerFactor: tri(rnd(), 0.85, 1, 1.15),
      // Appended last so the draws above stay byte-identical (determinism).
      maternityReturnShare: sampleTriangular(rnd(), MATERNITY_RETURN_TO_WORK),
      divShiftRecapture: sampleTriangular(rnd(), DIV_SHIFT_TO_SALARY),
      exciseFuelResponse: sampleTriangular(rnd(), EXCISE_FUEL_RESPONSE),
      exciseTobaccoResponse: sampleTriangular(rnd(), EXCISE_TOBACCO_RESPONSE),
      exciseAlcoholResponse: sampleTriangular(rnd(), EXCISE_ALCOHOL_RESPONSE),
      exciseWineLeakage: sampleTriangular(rnd(), EXCISE_WINE_LEAKAGE),
      gamblingResponse: sampleTriangular(rnd(), GAMBLING_GGR_RESPONSE),
    });
  }
  return draws;
};

// ---------------------------------------------------------------------------
// Tier-1 adapters. All return an EUR OFFSET added to the static delta;
// positive = revenue gain, so offsets oppose the static delta's sign.
// ---------------------------------------------------------------------------

/** Marginal rate of the bracket containing baseEur (brackets sorted by
 *  fromEur; at an exact boundary the next euro is taxed at the right-hand
 *  bracket's rate). */
export const marginalRateAt = (
  baseEur: number,
  brackets: PitBracket[],
): number => {
  let rate = brackets.length ? brackets[0].rate : 0;
  for (const b of brackets) {
    if (baseEur >= b.fromEur) rate = b.rate;
    else break;
  }
  return rate;
};

const dlogNet = (tauOld: number, tauNew: number): number => {
  const d =
    Math.log(1 - Math.min(tauNew, 0.99)) - Math.log(1 - Math.min(tauOld, 0.99));
  return Math.max(-1, Math.min(1, d));
};

const FLAT_CURRENT: PitBracket[] = [{ fromEur: 0, rate: PIT_RATE }];

/** EUR of behavioral employment-PIT revenue PER UNIT OF ETI under a bracket
 *  schedule (Feldstein decomposition: Σ workers × τ_new × base ×
 *  Δlog(1−τ_marginal), annualized, κ-calibrated). Linear in ETI by
 *  construction — the Δlog clamp is ETI-independent — so the MC loop pays
 *  the O(bands) cost once per slider state. A band whose new marginal rate
 *  is 0 (under an untaxed minimum) contributes exactly 0. */
export const pitBehavioralSensitivityEur = (
  bands: EarningsBand[],
  capEur: number,
  kappa: number,
  newBrackets: PitBracket[],
  oldBrackets: PitBracket[] = FLAT_CURRENT,
): number => {
  let sum = 0;
  for (const b of bands) {
    const base = Math.max(
      0,
      b.grossEur - SSC_EMPLOYEE_RATE * Math.min(b.grossEur, capEur),
    );
    const tauOld = marginalRateAt(base, oldBrackets);
    const tauNew = marginalRateAt(base, newBrackets);
    if (tauOld === tauNew) continue;
    sum += b.workers * tauNew * base * dlogNet(tauOld, tauNew);
  }
  return sum * 12 * kappa;
};

/** Flat-rate (non-employment) PIT slice: base response at the average ==
 *  marginal rate. */
export const pitFlatBehavioralOffset = (
  revenueEur: number,
  oldRate: number,
  newRate: number,
  eti: number,
): number => {
  if (oldRate <= 0 || newRate === oldRate) return 0;
  const base0 = revenueEur / oldRate;
  return newRate * base0 * eti * dlogNet(oldRate, newRate);
};

/** Exponential semi-elasticity keeps the base above −100% at any slider
 *  extreme: ΔBase = Base₀ × (exp(−s·Δpp/100) − 1), offset = τ_new × ΔBase. */
const semiElastOffset = (
  revenueEur: number,
  statutoryRate: number,
  newRate: number,
  semiElastPctPp: number,
): number => {
  if (newRate === statutoryRate) return 0;
  const base0 = revenueEur / statutoryRate;
  const deltaPp = (newRate - statutoryRate) * 100;
  return newRate * base0 * (Math.exp((-semiElastPctPp / 100) * deltaPp) - 1);
};

export const corpBehavioralOffset = (
  corpRevenueEur: number,
  oldRate: number,
  newRate: number,
  semiElastPctPp: number,
): number => semiElastOffset(corpRevenueEur, oldRate, newRate, semiElastPctPp);

export const dividendBehavioralOffset = (
  dividendRevenueEur: number,
  oldRate: number,
  newRate: number,
  semiElastPctPp: number,
): number =>
  semiElastOffset(dividendRevenueEur, oldRate, newRate, semiElastPctPp);

export const vatBehavioralOffset = (
  staticVatDeltaEur: number,
  gapResponse: number,
): number => -staticVatDeltaEur * gapResponse;

/** Behavioural offset on an excise rate change of `rateChangeFraction`
 *  (+0.10 = +10%): the consumption base erodes per the semi-elasticity, so on
 *  a large enough hike the offset can exceed the static gain (the Laffer turn).
 *  Reuses the exponential semi-elasticity with a unit rate index. */
export const exciseBehavioralOffset = (
  exciseRevenueEur: number,
  rateChangeFraction: number,
  semiElastPctPp: number,
): number =>
  semiElastOffset(exciseRevenueEur, 1, 1 + rateChangeFraction, semiElastPctPp);

/** Behavioural offset on an INTRODUCED wine excise: a flat leakage share of the
 *  static revenue (demand response + untaxed home production + collection
 *  ramp). The static delta is from a €0 base, so there is no rate index to run
 *  the exponential form against. */
export const wineExciseBehavioralOffset = (
  staticWineDeltaEur: number,
  leakageShare: number,
): number => -staticWineDeltaEur * leakageShare;

/** Behavioural offset on a gambling GGR-fee rate change: the licensed GGR base
 *  migrates offshore as the rate rises (same exponential semi-elasticity as
 *  CIT, here driven by operator/player flight to unlicensed sites). */
export const gamblingBehavioralOffset = (
  ggrFeeRevenueEur: number,
  oldRate: number,
  newRate: number,
  semiElastPctPp: number,
): number =>
  semiElastOffset(ggrFeeRevenueEur, oldRate, newRate, semiElastPctPp);

/** Haircut on the incremental base of a cap RAISE (doubled, capped at 0.40,
 *  for no-cap — the increment is then the whole Pareto tail). Lowering has no
 *  incremental base to avoid → 0. */
export const modBehavioralOffset = (
  staticModCentralEur: number,
  isRaise: boolean,
  noCap: boolean,
  avoidance: number,
): number => {
  if (!isRaise) return 0;
  const h = noCap ? Math.min(0.4, avoidance * 2) : avoidance;
  return -staticModCentralEur * h;
};

export const healthBehavioralOffset = (
  staticHealthDeltaEur: number,
  avoidance: number,
): number => -staticHealthDeltaEur * avoidance;

/** Recapture from mothers returning to work when the paid second year is cut:
 *  the freed recipient-months (spend ÷ benefit, scaled by months cut), a
 *  `returnShare` of which re-enter employment and pay the labour-tax wedge on
 *  a representative wage. Positive = budget gain (adds to the benefit saving);
 *  0 at no cut or returnShare 0 (preserves the zero-draw identity). The wage
 *  income these mothers gain roughly offsets the tax withdrawal at the demand
 *  level, so this stays OUT of the Tier-2 impulse. */
export const maternityReturnOffset = (
  monthsCut: number,
  returnShare: number,
): number => {
  if (monthsCut <= 0 || returnShare <= 0) return 0;
  const recipientMonthsPerYr =
    MATERNITY_Y2_SPEND_EUR / MATERNITY_Y2_BENEFIT_EUR_MO;
  const freedMonths = recipientMonthsPerYr * (monthsCut / MATERNITY_Y2_MONTHS);
  return (
    returnShare *
    freedMonths *
    labourTaxFeedbackOnSalary(MATERNITY_RETURN_WAGE_EUR_MO)
  );
};

/** Salary↔dividend relabeling recapture (see DIV_SHIFT_TO_SALARY). Reuses the
 *  dividend base response (SAME divSemiElast draw), crediting `recaptureCoef`
 *  of the income that leaves the dividend base to the labour-tax lines. Sign
 *  tracks the rate move: a raise (base shrinks) gains, a cut (base grows)
 *  loses. Pure relabeling → no net demand effect → OUT of the Tier-2 impulse. */
export const dividendShiftRecaptureEur = (
  dividendRevenueEur: number,
  oldRate: number,
  newRate: number,
  divSemiElastPctPp: number,
  recaptureCoef: number,
): number => {
  if (newRate === oldRate || recaptureCoef <= 0 || oldRate <= 0) return 0;
  const base0 = dividendRevenueEur / oldRate;
  const deltaPp = (newRate - oldRate) * 100;
  const deltaBase =
    base0 * (Math.exp((-divSemiElastPctPp / 100) * deltaPp) - 1);
  return -deltaBase * recaptureCoef;
};

// ---------------------------------------------------------------------------
// Tier 2 — reduced-form macro feedback over the projection horizon
// ---------------------------------------------------------------------------

export interface MacroFeedbackResult {
  /** GDP level deviation vs the baseline path, EUR per projection year. */
  gdpDeltaByYearEur: number[];
  /** Revenue feedback, EUR per projection year (negative for a
   *  consolidation: less demand → less revenue). */
  feedbackByYearEur: number[];
}

/** Impulse → multiplier → ΔGDP → revenue. Impulses are year-1 balance deltas
 *  (positive = the balance improves = a demand WITHDRAWAL), scaled to each
 *  projection year by the same constant-share-of-GDP convention as
 *  projectFiscalPath; the pension path carries its own per-year dynamics. */
export const computeMacroFeedback = (
  vatDeltaYear1Eur: number,
  otherRevenueDeltaYear1Eur: number,
  expenditureDeltaYear1Eur: number,
  pensionPathEur: number[] | undefined,
  draw: BehavioralDraw,
): MacroFeedbackResult => {
  const gdp = PROJECTION_GDP_EUR;
  const gdpDeltaByYearEur: number[] = [];
  const feedbackByYearEur: number[] = [];
  for (let i = 0; i < PROJECTION_YEARS.length; i++) {
    const scale = gdp[i] / gdp[0];
    const dVat = vatDeltaYear1Eur * scale;
    const dRev = otherRevenueDeltaYear1Eur * scale;
    const dExp = expenditureDeltaYear1Eur * scale + (pensionPathEur?.[i] ?? 0);
    const gdpDelta =
      -(draw.multVat * dVat + draw.multTax * dRev + draw.multSpend * dExp) *
      Math.pow(draw.persistence, i);
    gdpDeltaByYearEur.push(gdpDelta);
    feedbackByYearEur.push(draw.revenueFeedbackShare * gdpDelta);
  }
  return { gdpDeltaByYearEur, feedbackByYearEur };
};

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export interface DynamicScenarioInput {
  /** The static scenario total (the screen's static headline). */
  staticTotalEur: number;
  // static per-lever pieces (the offsets attach to these)
  staticVatDeltaEur: number;
  staticPitEmploymentDeltaEur: number;
  staticPitNonEmploymentDeltaEur: number;
  staticCorpDeltaEur: number;
  staticDivDeltaEur: number;
  staticModCentralEur: number;
  staticHealthDeltaEur: number;
  /** Excise static deltas (fuel/tobacco/alcohol % changes; wine introduced). */
  staticExciseFuelDeltaEur: number;
  staticExciseTobaccoDeltaEur: number;
  staticExciseAlcoholDeltaEur: number;
  staticWineDeltaEur: number;
  /** Anchors + rate moves the excise offsets need. */
  exciseFuelRevenueEur: number;
  exciseFuelRateChange: number;
  exciseTobaccoRevenueEur: number;
  exciseTobaccoRateChange: number;
  exciseAlcoholRevenueEur: number;
  exciseAlcoholRateChange: number;
  /** Gambling GGR-fee: current revenue (GGR × current rate) + old/new rate. */
  staticGamblingDeltaEur: number;
  gamblingFeeRevenueEur: number;
  gamblingOldRate: number;
  gamblingNewRate: number;
  /** МРЗ-freeze delta. Deliberately EXCLUDED from the Tier-2 impulse: the
   *  budget's foregone SSC/PIT reads as fiscal loosening, but the frozen
   *  private wages are an opposing household-income hit — net demand effect
   *  ≈ 0 in the reduced form. Kept in the input for documentation and so
   *  the field can join the impulse split if the treatment ever changes. */
  staticMinWageDeltaEur: number;
  /** Months of the paid second maternity year that the scenario cut (0..12,
   *  0 = no cut). Drives the behavioral return-to-work recapture; the static
   *  benefit Δ already sits in the expenditure balance. */
  maternityMonthsCut: number;
  /** Non-pension expenditure balance (positive = balance improves). */
  expenditureBalanceNonPensionEur: number;
  /** Per-projection-year pension balance path (the compounding lever). */
  pensionPathEur?: number[];
  // primitives the adapters need
  bands: EarningsBand[];
  capEur: number;
  kappa: number;
  newBrackets: PitBracket[];
  pitNonEmploymentRevenueEur: number;
  pitOldRate: number;
  pitNewRate: number;
  corpRevenueEur: number;
  corpOldRate: number;
  corpNewRate: number;
  divRevenueEur: number;
  divOldRate: number;
  divNewRate: number;
  modIdentity: ModIdentity;
  modTargetCapEur: number;
  modCurrentCapEur: number;
}

// ---------------------------------------------------------------------------
// buildDynamicInput — the single assembly point for DynamicScenarioInput.
// The screen, the AI chat tool and the smoke test all compute the same static
// scenario then wire the SAME ~25-field input around it; this helper owns the
// baseline-extraction + old-rate constants once so a new lever (or a renamed
// baseline field) is edited in one place, and the smoke test exercises the
// exact wiring the screen uses rather than a parallel copy.
// ---------------------------------------------------------------------------

/** Minimal baseline shape the input needs — the component's query data, the
 *  tool's PolicyBaselineFile and the smoke's local type all satisfy it. */
export interface DynamicBaselineLike {
  earnings: { bands: EarningsBand[]; capEur: number; kappa: number };
  revenue: {
    pitEur: number;
    pitNonEmploymentShare: number;
    corporateEur: number;
    dividendEur: number;
    /** Excise category anchors (Митници chronicle). Optional so existing
     *  baselines without them resolve excise offsets to 0. */
    exciseFuelEur?: number;
    exciseTobaccoEur?: number;
    exciseAlcoholEur?: number;
  };
  modIdentity: ModIdentity;
}

/** The caller-computed static scenario pieces (named without the `static`
 *  prefix the input fields carry). */
export interface DynamicStaticScore {
  totalEur: number;
  vatDeltaEur: number;
  pitEmploymentDeltaEur: number;
  pitNonEmploymentDeltaEur: number;
  corpDeltaEur: number;
  divDeltaEur: number;
  modCentralEur: number;
  healthDeltaEur: number;
  minWageDeltaEur: number;
  /** Excise static deltas (optional; default 0 for callers without them). */
  exciseFuelDeltaEur?: number;
  exciseTobaccoDeltaEur?: number;
  exciseAlcoholDeltaEur?: number;
  wineDeltaEur?: number;
  /** Gambling GGR-fee static delta (optional; default 0). */
  gamblingDeltaEur?: number;
  /** Months of the paid second maternity year cut (0..12; default 0). */
  maternityMonthsCut?: number;
  expenditureBalanceNonPensionEur: number;
  brackets: PitBracket[];
  pensionPathEur?: number[];
}

/** The new (scenario) rates / cap — old rates come from the engine constants. */
export interface DynamicRateParams {
  pitNewRate: number;
  corpNewRate: number;
  divNewRate: number;
  modTargetCapEur: number;
  modCurrentCapEur: number;
  /** Excise rate changes as fractions (+0.10 = +10%); optional, default 0. */
  exciseFuelRateChange?: number;
  exciseTobaccoRateChange?: number;
  exciseAlcoholRateChange?: number;
  /** Gambling GGR-fee new rate as a fraction (e.g. 0.30); default = current. */
  gamblingNewRate?: number;
}

export const buildDynamicInput = (
  baseline: DynamicBaselineLike,
  s: DynamicStaticScore,
  r: DynamicRateParams,
): DynamicScenarioInput => ({
  staticTotalEur: s.totalEur,
  staticVatDeltaEur: s.vatDeltaEur,
  staticPitEmploymentDeltaEur: s.pitEmploymentDeltaEur,
  staticPitNonEmploymentDeltaEur: s.pitNonEmploymentDeltaEur,
  staticCorpDeltaEur: s.corpDeltaEur,
  staticDivDeltaEur: s.divDeltaEur,
  staticModCentralEur: s.modCentralEur,
  staticHealthDeltaEur: s.healthDeltaEur,
  staticMinWageDeltaEur: s.minWageDeltaEur,
  staticExciseFuelDeltaEur: s.exciseFuelDeltaEur ?? 0,
  staticExciseTobaccoDeltaEur: s.exciseTobaccoDeltaEur ?? 0,
  staticExciseAlcoholDeltaEur: s.exciseAlcoholDeltaEur ?? 0,
  staticWineDeltaEur: s.wineDeltaEur ?? 0,
  exciseFuelRevenueEur: baseline.revenue.exciseFuelEur ?? 0,
  exciseFuelRateChange: r.exciseFuelRateChange ?? 0,
  exciseTobaccoRevenueEur: baseline.revenue.exciseTobaccoEur ?? 0,
  exciseTobaccoRateChange: r.exciseTobaccoRateChange ?? 0,
  exciseAlcoholRevenueEur: baseline.revenue.exciseAlcoholEur ?? 0,
  exciseAlcoholRateChange: r.exciseAlcoholRateChange ?? 0,
  staticGamblingDeltaEur: s.gamblingDeltaEur ?? 0,
  gamblingFeeRevenueEur: GAMBLING_GGR_EUR * GAMBLING_GGR_FEE_RATE,
  gamblingOldRate: GAMBLING_GGR_FEE_RATE,
  gamblingNewRate: r.gamblingNewRate ?? GAMBLING_GGR_FEE_RATE,
  maternityMonthsCut: s.maternityMonthsCut ?? 0,
  expenditureBalanceNonPensionEur: s.expenditureBalanceNonPensionEur,
  pensionPathEur: s.pensionPathEur,
  bands: baseline.earnings.bands,
  capEur: baseline.earnings.capEur,
  kappa: baseline.earnings.kappa,
  newBrackets: s.brackets,
  pitNonEmploymentRevenueEur:
    baseline.revenue.pitEur * baseline.revenue.pitNonEmploymentShare,
  pitOldRate: PIT_RATE,
  pitNewRate: r.pitNewRate,
  corpRevenueEur: baseline.revenue.corporateEur,
  corpOldRate: CORP_TAX_RATE,
  corpNewRate: r.corpNewRate,
  divRevenueEur: baseline.revenue.dividendEur,
  divOldRate: DIVIDEND_TAX_RATE,
  divNewRate: r.divNewRate,
  modIdentity: baseline.modIdentity,
  modTargetCapEur: r.modTargetCapEur,
  modCurrentCapEur: r.modCurrentCapEur,
});

export interface DynamicScenarioResult {
  /** Central-draw Tier-1 offsets per lever (UI breakdown rows). */
  offsets: {
    pit: number;
    corp: number;
    dividend: number;
    vat: number;
    mod: number;
    health: number;
    /** Maternity return-to-work PIT+SSC recapture (rides the headline, not a
     *  per-lever effective row). */
    maternity: number;
    /** Dividend↔salary relabeling recapture. */
    divShift: number;
    /** Excise demand/cross-border/illicit response per category. */
    exciseFuel: number;
    exciseTobacco: number;
    exciseAlcohol: number;
    /** Introduced-wine-excise leakage. */
    wine: number;
    /** Gambling GGR-fee offshore/illicit migration. */
    gambling: number;
  };
  /** static total + Σ central Tier-1 offsets — the year-1 scalar handed to
   *  projectFiscalPath (Tier-2 feedback rides the fixed path instead). */
  dynamicTier1Eur: number;
  /** Central-draw Tier-2 path. */
  feedback: MacroFeedbackResult;
  /** Headline = Tier 1 + year-1 feedback. */
  dynamicHeadlineEur: number;
  /** 90% Monte-Carlo interval on the headline. */
  p5Eur: number;
  p95Eur: number;
}

/** Coverage increment of the Pareto closed form at a single α — the
 *  single-α core of scoreModCap, for resampling the tail. */
const modClosedFormAt = (
  identity: ModIdentity,
  newCapEur: number,
  fromCapEur: number,
  alpha: number,
): number => {
  const covered = (cap: number): number =>
    cap === Infinity
      ? 1
      : 1 -
        Math.pow(identity.capEur / Math.max(cap, identity.capEur), alpha - 1);
  return (
    identity.aboveCapMassEur *
    Math.max(0, covered(newCapEur) - covered(fromCapEur)) *
    SSC_COMBINED_BUDGET_RATE
  );
};

export const computeDynamicScenario = (
  input: DynamicScenarioInput,
  draws: BehavioralDraw[],
): DynamicScenarioResult => {
  const noCap = input.modTargetCapEur === Infinity;
  const isRaise = input.modTargetCapEur > input.modCurrentCapEur || noCap;
  const isLower = !noCap && input.modTargetCapEur < input.modCurrentCapEur;
  const alphaCentral = input.modIdentity.alphaCentral;

  // O(bands) once per slider state; per-draw cost is one multiply.
  const pitSensitivity = pitBehavioralSensitivityEur(
    input.bands,
    input.capEur,
    input.kappa,
    input.newBrackets,
  );

  const modAt = (draw: BehavioralDraw): number => {
    let central = input.staticModCentralEur;
    if (isRaise && draw.modAlpha !== alphaCentral) {
      central +=
        modClosedFormAt(
          input.modIdentity,
          input.modTargetCapEur,
          input.modCurrentCapEur,
          draw.modAlpha,
        ) -
        modClosedFormAt(
          input.modIdentity,
          input.modTargetCapEur,
          input.modCurrentCapEur,
          alphaCentral,
        );
    } else if (isLower) {
      central *= draw.modLowerFactor;
    }
    return central;
  };

  const offsetsAt = (draw: BehavioralDraw) => {
    const modCentral = modAt(draw);
    return {
      pit:
        draw.etiEmployment * pitSensitivity +
        pitFlatBehavioralOffset(
          input.pitNonEmploymentRevenueEur,
          input.pitOldRate,
          input.pitNewRate,
          draw.etiNonEmployment,
        ),
      corp: corpBehavioralOffset(
        input.corpRevenueEur,
        input.corpOldRate,
        input.corpNewRate,
        draw.citSemiElast,
      ),
      dividend: dividendBehavioralOffset(
        input.divRevenueEur,
        input.divOldRate,
        input.divNewRate,
        draw.divSemiElast,
      ),
      vat: vatBehavioralOffset(input.staticVatDeltaEur, draw.vatGapResponse),
      mod:
        modCentral -
        input.staticModCentralEur +
        modBehavioralOffset(modCentral, isRaise, noCap, draw.sscCapAvoidance),
      health: healthBehavioralOffset(
        input.staticHealthDeltaEur,
        draw.sscRateAvoidance,
      ),
      maternity: maternityReturnOffset(
        input.maternityMonthsCut,
        draw.maternityReturnShare,
      ),
      divShift: dividendShiftRecaptureEur(
        input.divRevenueEur,
        input.divOldRate,
        input.divNewRate,
        draw.divSemiElast,
        draw.divShiftRecapture,
      ),
      exciseFuel: exciseBehavioralOffset(
        input.exciseFuelRevenueEur,
        input.exciseFuelRateChange,
        draw.exciseFuelResponse,
      ),
      exciseTobacco: exciseBehavioralOffset(
        input.exciseTobaccoRevenueEur,
        input.exciseTobaccoRateChange,
        draw.exciseTobaccoResponse,
      ),
      exciseAlcohol: exciseBehavioralOffset(
        input.exciseAlcoholRevenueEur,
        input.exciseAlcoholRateChange,
        draw.exciseAlcoholResponse,
      ),
      wine: wineExciseBehavioralOffset(
        input.staticWineDeltaEur,
        draw.exciseWineLeakage,
      ),
      gambling: gamblingBehavioralOffset(
        input.gamblingFeeRevenueEur,
        input.gamblingOldRate,
        input.gamblingNewRate,
        draw.gamblingResponse,
      ),
    };
  };

  const headlineAt = (draw: BehavioralDraw): number => {
    const o = offsetsAt(draw);
    const tier1 =
      input.staticTotalEur +
      o.pit +
      o.corp +
      o.dividend +
      o.vat +
      o.mod +
      o.health +
      o.maternity +
      o.divShift +
      o.exciseFuel +
      o.exciseTobacco +
      o.exciseAlcohol +
      o.wine +
      o.gambling;
    const fb = computeMacroFeedback(
      input.staticVatDeltaEur + o.vat,
      input.staticPitEmploymentDeltaEur +
        input.staticPitNonEmploymentDeltaEur +
        input.staticCorpDeltaEur +
        input.staticDivDeltaEur +
        input.staticModCentralEur +
        input.staticHealthDeltaEur +
        input.staticExciseFuelDeltaEur +
        input.staticExciseTobaccoDeltaEur +
        input.staticExciseAlcoholDeltaEur +
        input.staticWineDeltaEur +
        input.staticGamblingDeltaEur +
        o.pit +
        o.corp +
        o.dividend +
        o.mod +
        o.health +
        o.exciseFuel +
        o.exciseTobacco +
        o.exciseAlcohol +
        o.wine +
        o.gambling,
      input.expenditureBalanceNonPensionEur,
      input.pensionPathEur,
      draw,
    );
    return tier1 + fb.feedbackByYearEur[0];
  };

  // Central-draw results (the displayed point estimate).
  const central = centralDraw(alphaCentral);
  const offsets = offsetsAt(central);
  const dynamicTier1Eur =
    input.staticTotalEur +
    offsets.pit +
    offsets.corp +
    offsets.dividend +
    offsets.vat +
    offsets.mod +
    offsets.health +
    offsets.maternity +
    offsets.divShift +
    offsets.exciseFuel +
    offsets.exciseTobacco +
    offsets.exciseAlcohol +
    offsets.wine +
    offsets.gambling;
  const feedback = computeMacroFeedback(
    input.staticVatDeltaEur + offsets.vat,
    input.staticPitEmploymentDeltaEur +
      input.staticPitNonEmploymentDeltaEur +
      input.staticCorpDeltaEur +
      input.staticDivDeltaEur +
      input.staticModCentralEur +
      input.staticHealthDeltaEur +
      input.staticExciseFuelDeltaEur +
      input.staticExciseTobaccoDeltaEur +
      input.staticExciseAlcoholDeltaEur +
      input.staticWineDeltaEur +
      input.staticGamblingDeltaEur +
      offsets.pit +
      offsets.corp +
      offsets.dividend +
      offsets.mod +
      offsets.health +
      offsets.exciseFuel +
      offsets.exciseTobacco +
      offsets.exciseAlcohol +
      offsets.wine +
      offsets.gambling,
    input.expenditureBalanceNonPensionEur,
    input.pensionPathEur,
    central,
  );
  const dynamicHeadlineEur = dynamicTier1Eur + feedback.feedbackByYearEur[0];

  // Monte Carlo band on the headline.
  const samples = draws.map(headlineAt).sort((a, b) => a - b);
  const quantile = (q: number): number => {
    if (!samples.length) return dynamicHeadlineEur;
    const idx = q * (samples.length - 1);
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    return samples[lo] + (samples[hi] - samples[lo]) * (idx - lo);
  };

  return {
    offsets,
    dynamicTier1Eur,
    feedback,
    dynamicHeadlineEur,
    p5Eur: quantile(0.05),
    p95Eur: quantile(0.95),
  };
};
