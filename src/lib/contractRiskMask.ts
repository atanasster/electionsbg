// Decode the SERVER's per-contract risk masks into the same ContractRiskResult
// the browser scorer produces.
//
// WHY: contract_risk_cache (migration 112) already evaluates all 12 checks for
// every contract, and /api/db/table ships the result on every row
// (riskCri / riskGrade / riskFired / riskAvailable / riskFiredMask /
// riskAvailableMask — functions/db_table.js). The browser was nevertheless
// downloading a 1.29 MB corpus-wide index payload to re-derive the same twelve
// booleans, while the very same page filtered on `risk_grade` server-side. This
// turns the row's two ints into chips at zero additional bytes, and makes the
// chips agree with the grade filter beside them BY CONSTRUCTION rather than by
// two scorers happening to stay in step.
//
// SQL is the source of truth (112's header says so, and
// scripts/procurement/risk_parity.harness.ts holds the TS scorer to it over the
// full corpus). This decoder is on the same side of that contract as the SQL: it
// reports what the server computed, it does not recompute anything.
//
// What the masks CANNOT carry is the per-flag DETAIL the tooltips show — which
// MP, what concentration share, the debarment dates. Three of those are
// recoverable from fields already on the row and are filled in here; the rest
// stay null until they are fetched per-contract.

import {
  emptyContractRiskFlags,
  type ContractRiskFlags,
  type ContractRiskResult,
  type NgoForeignFundedEntry,
  type RiskComponent,
  type RiskComponentKey,
} from "@/data/procurement/computeProcurementRisk";

/**
 * Bit positions, verbatim from 112_contract_risk_cache.sql:90-96.
 *
 * ⚠️ "This ORDER IS A CONTRACT with every reader — append new checks at the end,
 * never renumber, or historic masks silently re-map." The SQL side decodes the
 * same order in `contract_risk_checks()`.
 *
 * risk_parity.harness.ts IMPORTS this array rather than keeping its own copy, and
 * asserts it against a literal before running — so a renumber here fails in the
 * one place that also checks the order against real rows. Keep it that way: a
 * private copy in the harness would let this file renumber with every test green.
 */
export const RISK_MASK_BITS: readonly RiskComponentKey[] = [
  "debarred", // 0
  "mpConnected", // 1
  "pepConnected", // 2
  "awarderConcentration", // 3
  "amendment", // 4
  "annexGrowth", // 5
  "newFirmWinner", // 6
  "splitPurchase", // 7
  "appealUpheld", // 8
  "weakCompetition", // 9
  "directAward", // 10
  "shortTenderPeriod", // 11
] as const;

/** The row fields the decoder needs. A structural subset of the `contracts`
 *  table-engine projection, so any row from /api/db/table satisfies it. */
export type RiskMaskRow = {
  riskFiredMask?: number | null;
  riskAvailableMask?: number | null;
  /** For the magnitudes below — all already on the row. */
  amountEur?: number | null;
  signingAmountEur?: number | null;
  numberOfTenderers?: number | null;
  tenderPeriodStartDate?: string | null;
  tenderPeriodEndDate?: string | null;
};

const MS_PER_DAY = 86_400_000;

const bit = (mask: number, index: number): boolean =>
  ((mask >> index) & 1) === 1;

/**
 * Build a `ContractRiskResult` from a row's server-computed masks.
 *
 * Returns **null** when the masks are absent. That is not the same as "no flags":
 * `contracts_list` LEFT JOINs contract_risk_cache and emits NULL when a contract
 * has no cache row (the window between a contracts load and the risk rebuild), so
 * a NULL mask means UNSCORED — unknown, not clean. 000_search_fns.sql:147 makes
 * the same distinction for the sort order, in its words: "an unscored contract is
 * unknown, not clean, and 0 would rank it as the safest row in the corpus."
 * Decoding null to 0 would render a flagged contract as `—`, which is precisely
 * the bug this whole change exists to remove.
 */
export const contractRiskFromMasks = (
  row: RiskMaskRow,
): ContractRiskResult | null => {
  const firedMask = row.riskFiredMask;
  const availableMask = row.riskAvailableMask;
  if (
    firedMask === null ||
    firedMask === undefined ||
    availableMask === null ||
    availableMask === undefined
  )
    return null;

  const flags: ContractRiskFlags = emptyContractRiskFlags();
  const components: RiskComponent[] = [];
  let firedCount = 0;
  let availableCount = 0;

  RISK_MASK_BITS.forEach((key, i) => {
    const available = bit(availableMask, i);
    const fired = bit(firedMask, i);
    components.push({ key, available, fired });
    if (available) availableCount++;
    if (fired) firedCount++;
  });

  const isFired = (key: RiskComponentKey): boolean =>
    components.some((c) => c.key === key && c.fired);

  // Boolean flags map straight across.
  flags.mpConnected = isFired("mpConnected");
  flags.pepConnected = isFired("pepConnected");
  flags.isAmendment = isFired("amendment");
  flags.annexGrowth = isFired("annexGrowth");
  flags.newFirmWinner = isFired("newFirmWinner");
  flags.weakCompetition = isFired("weakCompetition");
  flags.directAward = isFired("directAward");
  flags.appealUpheld = isFired("appealUpheld");
  flags.shortTenderPeriod = isFired("shortTenderPeriod");

  // debarred / awarderConcentration / splitPurchase are deliberately NOT set.
  // They are object-valued because the tooltip renders their contents (debarment
  // dates, the concentration share, the split group), and the mask carries only a
  // bit — a truthy placeholder would be a lie the tooltip then displays. Their
  // fired state lives in `components`, and RiskBadges reads it from there so the
  // chip appears with a detail-less tooltip rather than vanishing. That mattered:
  // 5,628 contracts (3.8% of flagged rows) fire ONLY these three, and keying the
  // chips off `flags.*` rendered them as an empty cell while hasFlag was true.
  // The detail arrives with the per-contract fetch.

  // Magnitudes recoverable from the row itself — no payload needed.
  const signed = row.signingAmountEur;
  if (
    typeof signed === "number" &&
    signed > 0 &&
    typeof row.amountEur === "number"
  )
    flags.annexGrowthPct = (row.amountEur - signed) / signed;

  if (typeof row.numberOfTenderers === "number")
    flags.bidCount = row.numberOfTenderers;

  const from = row.tenderPeriodStartDate;
  const to = row.tenderPeriodEndDate;
  if (from && to) {
    const a = Date.parse(from);
    const b = Date.parse(to);
    if (Number.isFinite(a) && Number.isFinite(b))
      flags.tenderPeriodDays = Math.floor((b - a) / MS_PER_DAY);
  }

  // Everything is derived from the MASKS, including the counts, even though the
  // row also carries risk_fired / risk_available / risk_cri as scalars.
  //
  // Mixing the two sources looks harmless — they are computed in the same INSERT
  // and agree on all 407,693 rows (measured) — but it breaks the invariant
  // `firedCount === components.filter(c => c.fired).length`, and mergeContractRisk
  // rebuilds its counts from `components` while callers read `firedCount`. One
  // source keeps them consistent by construction; a "prefer the scalars" branch
  // buys nothing measurable and opens that window.
  const cri =
    availableCount === 0 ? 0 : Math.round((100 * firedCount) / availableCount);

  return {
    flags,
    // The legacy additive score is NOT reconstructible from the masks (it weights
    // each check differently and caps at 100) and nothing renders it — it is an
    // internal sort key, and the server sorts by `risk_fired` anyway. Reporting 0
    // is honest here in a way it would not be for `cri`, which IS rendered.
    score: 0,
    cri,
    components,
    firedCount,
    availableCount,
    hasFlag: firedCount > 0,
  };
};

/**
 * Attach the foreign-funded-NGO disclosure to a decoded result.
 *
 * Separate from the decoder because it is not one of the 12 scored checks and has
 * no mask bit — it is a NEUTRAL disclosure that deliberately does not move
 * `firedCount` or the CRI, and it arrives from its own small route
 * (useNgoForeignFundedByEik). Without this the chip would silently disappear from
 * every screen that decodes masks.
 *
 * Returns a new object; never mutates the decoded result.
 */
export const withNgoDisclosure = (
  result: ContractRiskResult | null,
  entry: NgoForeignFundedEntry | undefined,
): ContractRiskResult | null =>
  result && entry
    ? { ...result, flags: { ...result.flags, ngoForeignFunded: entry } }
    : result;
