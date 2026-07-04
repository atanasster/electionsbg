// Per-contract corruption-risk scorer. Pure + React-free so it can be shared
// by the SPA badge UI (useContractRiskFlags), the flow link-colouring, the
// My-Area alerts builder (Node), and the AI tools — one implementation, never
// re-derived.
//
// Two outputs, deliberately:
//   - `cri` (0..100): a Corruption Risk Index in the Fazekas / Government
//     Transparency Institute tradition — the share of the red-flag checks we
//     could actually evaluate that fired. Data-poor rows (legacy contracts with
//     no bid count / procedure / tender window) aren't penalised: an
//     unavailable check is excluded from the denominator, not scored 0.
//   - `score` (0..100): the legacy additive-weight score, kept for sorting and
//     severity (debarred / MP-tied dominate). The chips + the "N of M checks"
//     readout are the honest signal; the number is a sort key.
//
// The score is blunt by design — meant to drive sorting and a visual badge, not
// to be legal evidence.

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
  | "singleBidder"
  | "nonOpenProcedure"
  | "shortTenderPeriod"
  | "amendment"
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
  /** Exactly one bidder, in a CPV market that is normally competitive. */
  singleBidder: boolean;
  /** Negotiated / non-open procedure (or an explicit method rationale). */
  nonOpenProcedure: boolean;
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
const WEIGHT_SINGLE_BIDDER = 40;
const WEIGHT_HIGH_CONCENTRATION = 30;
const WEIGHT_NON_OPEN = 20;
const WEIGHT_SHORT_PERIOD = 15;
const WEIGHT_AMENDMENT = 10;
// КЗК-upheld appeal — authoritative (a regulator annulled the award), so heavy,
// just below debarment (80). Only fires where the appeal outcome is known.
const WEIGHT_APPEAL_UPHELD = 70;

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

  // КЗК-upheld appeal — checkable only where the appeal join was loaded
  // (contracts browser + tender page); undefined elsewhere → unavailable. Where
  // it IS loaded, `false` means "no KNOWN upheld appeal" (merits outcomes are a
  // partial tier-2 backfill) — treated as clean for CRI purposes.
  const appealUpheld = contract.appealUpheld === true;
  add("appealUpheld", contract.appealUpheld !== undefined, appealUpheld);

  // Single bidder — checkable only when the realised bid count is known.
  const bidCount =
    typeof contract.numberOfTenderers === "number"
      ? contract.numberOfTenderers
      : null;
  let singleBidder = false;
  if (bidCount !== null) {
    const division = contract.cpv?.slice(0, 2);
    const structuralShare =
      division !== undefined
        ? args.cpvSingleBidShare?.get(division)
        : undefined;
    const structural =
      structuralShare !== undefined &&
      structuralShare >= (args.structuralSingleBidShare ?? 0.8);
    singleBidder = bidCount === 1 && !structural;
    add("singleBidder", true, singleBidder);
  } else {
    add("singleBidder", false, false);
  }

  // Non-open procedure — checkable when the method or a rationale is published.
  const methodKnown =
    !!contract.procurementMethod || !!contract.procurementMethodRationale;
  let nonOpenProcedure = false;
  if (methodKnown) {
    // Classify via the shared bucketer so both the OCDS enum ("open") and the
    // Bulgarian АОП phrase ("Открита процедура") count as open — a bare
    // `!== "open"` string compare wrongly flagged every Bulgarian open
    // procedure (the largest slice of the corpus) as non-open.
    const openProcedure =
      !!contract.procurementMethod &&
      procedureBucket(contract.procurementMethod) === "open";
    nonOpenProcedure =
      (!!contract.procurementMethod && !openProcedure) ||
      !!contract.procurementMethodRationale;
    add("nonOpenProcedure", true, nonOpenProcedure);
  } else {
    add("nonOpenProcedure", false, false);
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
  if (singleBidder) score += WEIGHT_SINGLE_BIDDER;
  if (concentration) score += WEIGHT_HIGH_CONCENTRATION;
  if (nonOpenProcedure) score += WEIGHT_NON_OPEN;
  if (shortTenderPeriod) score += WEIGHT_SHORT_PERIOD;
  if (isAmendment) score += WEIGHT_AMENDMENT;
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
      singleBidder,
      nonOpenProcedure,
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
