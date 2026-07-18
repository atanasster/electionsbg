// Per-contract risk-flag scorer. Pure + React-free so it can be shared by the
// SPA badge UI (useContractRiskFlags) and the offline harness — one
// implementation, never re-derived.
//
// Two outputs, deliberately:
//   - `cri` (0..100): the share of the risk-flag checks we could actually
//     evaluate that fired (Fazekas / Government Transparency Institute
//     tradition). Data-poor rows (legacy contracts with no bid count /
//     procedure / tender window) aren't penalised: an unavailable check is
//     excluded from the denominator, not scored 0. The UI renders this as a
//     "firedCount of availableCount" ratio + a meter, NOT as a bare number.
//   - `score` (0..100): the legacy additive-weight severity score. It is NOT
//     rendered anywhere (the UI shows the flags-fired ratio) — it survives only
//     as a stable internal ordering key and is asserted on by
//     risk_scorer.harness.ts. Do not surface it without renaming (see
//     docs/plans/procurement-risk-v2.md §1c C2 — a bare 0..100 severity number
//     collides with the awarder exposure grade's 0..100).

import type {
  AwarderConcentrationEntry,
  DebarredEntry,
  ProcurementContract,
} from "@/data/dataTypes";
import { procedureBucket } from "@/lib/cpvSectors";

/** One evaluable red-flag check. `available` = we had the data to evaluate it;
 *  `fired` = the check tripped. */
export type RiskComponentKey =
  | "debarred"
  | "mpConnected"
  | "pepConnected"
  | "awarderConcentration"
  | "weakCompetition"
  | "directAward"
  | "shortTenderPeriod"
  | "amendment"
  | "annexGrowth"
  | "newFirmWinner"
  | "appealUpheld";

export type RiskComponent = {
  key: RiskComponentKey;
  available: boolean;
  fired: boolean;
};

export type ContractRiskFlags = {
  /** Contractor's declared officers / owners include a sitting or former MP. */
  mpConnected: boolean;
  /** Contractor is tied to a non-MP public official (mayor, deputy-mayor,
   *  councillor, minister, governor, agency head) via a declared stake or a
   *  unique-name Commerce-Registry match. */
  pepConnected: boolean;
  /** Contractor appears on the АОП "Стопански субекти с нарушения" register. */
  debarred: DebarredEntry | null;
  /** ≥ thresholdPct of the awarder's lifetime spending goes to this
   *  contractor — a single supplier dominates the buyer's procurement. */
  awarderConcentration: AwarderConcentrationEntry | null;
  /** Row is a post-award contract amendment. */
  isAmendment: boolean;
  /** Contract value grew to/past the ЗОП чл.116 ал.2 cumulative cap (≥50% of the
   *  signing value) via annexes. Only meaningful when an annex moved the value. */
  annexGrowth: boolean;
  /** Signed→current growth fraction when an annex moved the value (tooltip). */
  annexGrowthPct: number | null;
  /** Contractor incorporated shortly (< NEW_FIRM_MONTHS) before this award. */
  newFirmWinner: boolean;
  /** Months between the contractor's incorporation and the award (tooltip). */
  newFirmMonths: number | null;
  /** Weak competition: a single bidder in a normally-competitive market, OR
   *  materially fewer bidders than the sector norm (below the division median in
   *  a division whose median is ≥3). Validated against the single-bidding price
   *  premium: both cases land closer to the buyer's own estimate. */
  weakCompetition: boolean;
  /** Direct / negotiated-without-notice award (procedure bucket "direct", or an
   *  explicit no-notice rationale). Narrowed from the old "non-open" flag, which
   *  wrongly swept in competitive публично състезание (which actually saves). */
  directAward: boolean;
  /** КЗК upheld an appeal against this procedure (уважена) — an official finding
   *  that the award was improper. The one regulator-ruled (not heuristic) flag. */
  appealUpheld: boolean;
  /** Tender open window shorter than the EU 14-day reference. */
  shortTenderPeriod: boolean;
  /** Realised bid count when known (surfaced in the single-bidder tooltip). */
  bidCount: number | null;
  /** Tender open window in days when known (short-deadline tooltip). */
  tenderPeriodDays: number | null;
};

export type ContractRiskResult = {
  flags: ContractRiskFlags;
  /** Legacy additive-weight score, capped at 100. Sort key only. */
  score: number;
  /** Corruption Risk Index 0..100 = 100 × firedCount / availableCount. */
  cri: number;
  components: RiskComponent[];
  firedCount: number;
  availableCount: number;
  /** True when any check fired. Drives "show the badge column" decisions. */
  hasFlag: boolean;
};

// Additive weights for the legacy score — MP-connection heaviest (most
// editorially loaded), debarred next, then single-bidder, concentration,
// non-open, short-period, amendment. Multiple signals stack up to 100.
const WEIGHT_MP_CONNECTED = 50;
const WEIGHT_PEP_CONNECTED = 40;
const WEIGHT_DEBARRED = 80;
const WEIGHT_WEAK_COMPETITION = 40;
const WEIGHT_HIGH_CONCENTRATION = 30;
const WEIGHT_DIRECT_AWARD = 20;
const WEIGHT_SHORT_PERIOD = 15;
const WEIGHT_AMENDMENT = 10;
// Annex value growth to/past the legal cap — a structural signal (money added
// after the competition), on par with concentration.
const WEIGHT_ANNEX_GROWTH = 30;
// New-firm winner — a company barely older than the contract it won. Structural,
// editorially legible (K-Index P4).
const WEIGHT_NEW_FIRM = 30;
/** A contractor incorporated fewer than this many months before the award is a
 *  "new firm" for the newFirmWinner flag. */
const NEW_FIRM_MONTHS = 12;
const MS_PER_MONTH = 2_629_800_000; // 30.44 days
// КЗК-upheld appeal — authoritative (a regulator annulled the award), so heavy,
// just below debarment (80). Only fires where the appeal outcome is known.
const WEIGHT_APPEAL_UPHELD = 70;

/** ЗОП чл.116 ал.2 caps the CUMULATIVE value of annex modifications at 50% of
 *  the signing value (stricter than the EU per-modification rule). A contract
 *  whose signed→current growth reaches this is at/over the statutory ceiling for
 *  the ал.1 т.2/т.3 grounds. ⚠️ A permitted inflation indexation (ал.3 / чл.117а)
 *  carries its OWN separate 50% ceiling, so ≥50% is a signal for review, not a
 *  proven breach. See docs/plans/procurement-risk-v2.md §0b. */
const ANNEX_GROWTH_CAP = 0.5;

/** EU Directive 2014/24/EU Art. 27 reference open-procedure minimum. A tender
 *  window below this is the conventional "rushed deadline" red flag. */
const SHORT_TENDER_DAYS = 14;
const MS_PER_DAY = 86_400_000;

export type RiskScoreArgs = {
  debarredByName: Map<string, DebarredEntry>;
  concentrationByPair: Map<string, AwarderConcentrationEntry>;
  mpConnectedEiks: Map<string, unknown>;
  /** Contractor EIKs tied to a non-MP official (from pep_connected). Optional —
   *  when absent the pepConnected check is unavailable (excluded from the CRI
   *  denominator, not scored 0). */
  pepConnectedEiks?: Set<string>;
  /** Per 2-digit CPV division → single-bid share (0..1). When a division is at
   *  or above `structuralSingleBidShare`, the single-bidder flag is suppressed
   *  (structurally single-bid market, not an anomaly). Optional — without it,
   *  single-bidder fires on any 1-bid row. */
  cpvSingleBidShare?: Map<string, number>;
  /** Share at/above which a division is "structurally single-bid". */
  structuralSingleBidShare?: number;
  /** Per 5-digit CPV prefix → median bidder count, competitive markets only
   *  (median ≥ 3). Enables the graded arm of weakCompetition ("materially fewer
   *  bidders than this market's norm"). Optional — without it, weakCompetition
   *  degrades to the single-bidder case only. */
  cpvBidderMedian?: Map<string, number>;
  /** Contractor EIK → incorporation date (ISO). From the served risk-indexes
   *  `foundedByEik` map (Registry Agency backfill). Optional — when absent, or a
   *  contractor is missing from it, newFirmWinner is unavailable (excluded from
   *  the CRI denominator, not scored 0). */
  foundedByEik?: Map<string, string>;
  /** Folded-name normaliser, shared with the debarred index (passed in to keep
   *  this module React-free). */
  normalizeName: (raw: string) => string;
};

export const computeProcurementRisk = (
  contract: ProcurementContract,
  args: RiskScoreArgs,
): ContractRiskResult => {
  const components: RiskComponent[] = [];
  const add = (key: RiskComponentKey, available: boolean, fired: boolean) =>
    components.push({ key, available, fired });

  // Always-checkable signals (absence is a meaningful "not flagged").
  const debarred =
    args.debarredByName.get(args.normalizeName(contract.contractorName)) ??
    null;
  add("debarred", true, !!debarred);

  const mpConnected = args.mpConnectedEiks.has(contract.contractorEik);
  add("mpConnected", true, mpConnected);

  // Officials (non-MP political class). Checkable only when the index loaded.
  const pepConnected =
    args.pepConnectedEiks?.has(contract.contractorEik) ?? false;
  add("pepConnected", !!args.pepConnectedEiks, pepConnected);

  const concentration =
    args.concentrationByPair.get(
      `${contract.awarderEik}|${contract.contractorEik}`,
    ) ?? null;
  add("awarderConcentration", true, !!concentration);

  const isAmendment = contract.tag === "contractAmendment";
  add("amendment", true, isAmendment);

  // Annex value growth — signed→current, scored against the ЗОП чл.116 ал.2
  // cumulative cap. Available only when an annex actually moved the value
  // (signingAmountEur present; NULL ⇒ amount_eur IS the signing value, no
  // growth), so the check doesn't dilute the CRI for un-amended contracts.
  // The €-Δ is already computed for the contract page's signed-vs-current bar;
  // here it becomes a flag. See docs/plans §0b (the АПИ +50% finding).
  const signedEur = contract.signingAmountEur;
  let annexGrowth = false;
  let annexGrowthPct: number | null = null;
  if (
    typeof signedEur === "number" &&
    signedEur > 0 &&
    typeof contract.amountEur === "number"
  ) {
    annexGrowthPct = (contract.amountEur - signedEur) / signedEur;
    annexGrowth = annexGrowthPct >= ANNEX_GROWTH_CAP;
    add("annexGrowth", true, annexGrowth);
  } else {
    add("annexGrowth", false, false);
  }

  // New-firm winner — the contractor was incorporated < NEW_FIRM_MONTHS before
  // this award. Available only when the served founding date exists for this
  // contractor AND the award date is known (mirrors appealUpheld's "checkable
  // only where the datum is present"); missing ⇒ excluded from the CRI, not 0.
  const foundedIso = args.foundedByEik?.get(contract.contractorEik);
  const awardDate = contract.dateSigned || contract.date;
  let newFirmWinner = false;
  let newFirmMonths: number | null = null;
  if (foundedIso && awardDate) {
    const f = Date.parse(foundedIso);
    const a = Date.parse(awardDate);
    if (Number.isFinite(f) && Number.isFinite(a) && a >= f) {
      newFirmMonths = Math.floor((a - f) / MS_PER_MONTH);
      newFirmWinner = newFirmMonths < NEW_FIRM_MONTHS;
      add("newFirmWinner", true, newFirmWinner);
    } else {
      add("newFirmWinner", false, false);
    }
  } else {
    add("newFirmWinner", false, false);
  }

  // КЗК-upheld appeal — checkable only where the appeal join was loaded
  // (contracts browser + tender page); undefined elsewhere → unavailable. Where
  // it IS loaded, `false` means "no KNOWN upheld appeal" (merits outcomes are a
  // partial tier-2 backfill) — treated as clean for CRI purposes.
  const appealUpheld = contract.appealUpheld === true;
  add("appealUpheld", contract.appealUpheld !== undefined, appealUpheld);

  // Weak competition — checkable only when the realised bid count is known.
  const bidCount =
    typeof contract.numberOfTenderers === "number"
      ? contract.numberOfTenderers
      : null;
  let weakCompetition = false;
  if (bidCount !== null) {
    const division = contract.cpv?.slice(0, 2);
    const structuralShare =
      division !== undefined
        ? args.cpvSingleBidShare?.get(division)
        : undefined;
    const structural =
      structuralShare !== undefined &&
      structuralShare >= (args.structuralSingleBidShare ?? 0.8);
    // Textbooks (CPV 22112xxx) are awarded by law to the sole copyright holder
    // (чл. 79, ал. 1, т. 3 ЗОП), so every one is single-bid by statute, not
    // choice — suppress the flag regardless of the division's aggregate share.
    const legallySingleSource = contract.cpv?.startsWith("22112") ?? false;
    const single = bidCount === 1 && !structural && !legallySingleSource;
    // Graded arm: materially fewer bidders than this MARKET's norm (keyed by the
    // 5-digit CPV prefix; the map holds only competitive markets, median ≥ 3).
    // A 2-bidder award where the market norm is 6 is the case the binary
    // single-bidder flag misses. Validated (single-bidding price premium): these
    // land ~13pp closer to the buyer's estimate, like single-bid awards.
    const cpv5 = contract.cpv?.slice(0, 5);
    const marketMedian =
      cpv5 !== undefined ? args.cpvBidderMedian?.get(cpv5) : undefined;
    const belowNorm =
      marketMedian != null &&
      bidCount > 1 &&
      bidCount < marketMedian &&
      !structural;
    weakCompetition = single || belowNorm;
    add("weakCompetition", true, weakCompetition);
  } else {
    add("weakCompetition", false, false);
  }

  // Direct award — checkable when the method or a rationale is published.
  // NARROWED from the old "non-open" flag: only DIRECT / negotiated-without-
  // notice (bucket "direct") or an explicit no-notice rationale. The old flag
  // also caught публично състезание (bucket "competition"), which is genuinely
  // competitive and actually saves against the estimate — so it misfired.
  const methodKnown =
    !!contract.procurementMethod || !!contract.procurementMethodRationale;
  let directAward = false;
  if (methodKnown) {
    const bucket = contract.procurementMethod
      ? procedureBucket(contract.procurementMethod)
      : undefined;
    directAward = bucket === "direct" || !!contract.procurementMethodRationale;
    add("directAward", true, directAward);
  } else {
    add("directAward", false, false);
  }

  // Short tender window — checkable when both endpoints are published.
  let tenderPeriodDays: number | null = null;
  let shortTenderPeriod = false;
  if (contract.tenderPeriodStartDate && contract.tenderPeriodEndDate) {
    const start = Date.parse(contract.tenderPeriodStartDate);
    const end = Date.parse(contract.tenderPeriodEndDate);
    if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
      tenderPeriodDays = Math.round((end - start) / MS_PER_DAY);
      shortTenderPeriod = tenderPeriodDays < SHORT_TENDER_DAYS;
      add("shortTenderPeriod", true, shortTenderPeriod);
    } else {
      add("shortTenderPeriod", false, false);
    }
  } else {
    add("shortTenderPeriod", false, false);
  }

  let score = 0;
  if (mpConnected) score += WEIGHT_MP_CONNECTED;
  if (pepConnected) score += WEIGHT_PEP_CONNECTED;
  if (debarred) score += WEIGHT_DEBARRED;
  if (weakCompetition) score += WEIGHT_WEAK_COMPETITION;
  if (concentration) score += WEIGHT_HIGH_CONCENTRATION;
  if (directAward) score += WEIGHT_DIRECT_AWARD;
  if (shortTenderPeriod) score += WEIGHT_SHORT_PERIOD;
  if (isAmendment) score += WEIGHT_AMENDMENT;
  if (annexGrowth) score += WEIGHT_ANNEX_GROWTH;
  if (newFirmWinner) score += WEIGHT_NEW_FIRM;
  if (appealUpheld) score += WEIGHT_APPEAL_UPHELD;
  score = Math.min(100, score);

  const availableCount = components.filter((c) => c.available).length;
  const firedCount = components.filter((c) => c.fired).length;
  const cri =
    availableCount === 0 ? 0 : Math.round((100 * firedCount) / availableCount);

  return {
    flags: {
      mpConnected,
      pepConnected,
      debarred,
      awarderConcentration: concentration,
      isAmendment,
      annexGrowth,
      annexGrowthPct,
      newFirmWinner,
      newFirmMonths,
      weakCompetition,
      directAward,
      appealUpheld,
      shortTenderPeriod,
      bidCount,
      tenderPeriodDays,
    },
    score,
    cri,
    components,
    firedCount,
    availableCount,
    hasFlag: firedCount > 0,
  };
};
