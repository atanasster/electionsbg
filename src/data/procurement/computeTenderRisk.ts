// Ex-ante per-PROCEDURE risk scorer — distinct from the per-contract scorer in
// computeProcurementRisk.ts (which scores a realised award). This one scores the
// TENDER itself (the procedure), so a signal can fire while bids are still open,
// and it makes a statement about the BUYER's conduct, not about any winner.
//
// Pure + React-free (shared by the SPA panel and any offline check). Same
// available/fired/cri contract as computeProcurementRisk: an unavailable check
// is excluded from the denominator, never scored 0; the UI renders a
// "firedCount of availableCount" ratio, never a bare 0..100 number.
//
// Thresholds are calibrated on the Bulgarian corpus, NOT imported — see
// scripts/procurement/tender_base_rates.sql and docs/plans/procurement-risk-v2.md
// §6b-results (126,413 tenders, 2020–2026). The three ex-ante procedure-grain
// signals our data actually supports:
//   - nonOpenProcedure   — the hero flag; 14.3% base rate, stable by year. This
//                          IS the EC-Scoreboard "no calls for bids" story where
//                          BG is the real outlier, and it subsumes a separate
//                          "call for tenders not published" check.
//   - rushedDeadline     — TIER-CONDITIONAL. A short submission window is the
//                          statutory norm on low-value procedures (44% at 7–11d
//                          on "Събиране на оферти"), so it is only scored on the
//                          competitive tiers (Открита процедура / Публично
//                          състезание), where <12d is ~0.3–1% — rare and real.
//   - shortDecisionPeriod — award decided 1–4 days after the deadline (3.2% base
//                          rate). Available only once the procedure is awarded.
//
// NOT scored (§6b-results): changeNoticeCount (0.1% populated) and
// hasUnsecuredFunding (33.8% populated — a missing-data trap); the latter is
// shown as header context on the detail page instead.

import type { TenderAward } from "@/data/procurement/useTender";

// The structural minimum the scorer reads — satisfied by the full `Tender`
// (detail page) AND by the slimmer browser row (`TenderRow`), so the same
// scorer drives the /tenders/:unp panel and the /procurement/tenders column.
export type TenderRiskInput = {
  procedureType?: string | null;
  publicationDate?: string | null;
  submissionDeadline?: string | null;
  estimatedValueEur?: number | null;
};

export type TenderRiskKey =
  | "nonOpenProcedure"
  | "rushedDeadline"
  | "shortDecisionPeriod"
  | "awardOverEstimate";

export type TenderRiskComponent = {
  key: TenderRiskKey;
  available: boolean;
  fired: boolean;
};

export type TenderRiskResult = {
  components: TenderRiskComponent[];
  firedCount: number;
  availableCount: number;
  /** 100 × firedCount / availableCount (0 when nothing is evaluable). Drives the
   *  meter bar width/colour only — the UI shows the ratio, not this number. */
  cri: number;
  hasFlag: boolean;
  /** Supporting detail for tooltips (null when the check was unavailable). */
  submissionDays: number | null;
  decisionDays: number | null;
  /** Awarded-over-estimate overrun fraction (0.15 = awards 15% over the
   *  procedure estimate); null when unavailable. */
  overrunPct: number | null;
};

// The competitive tiers — the only procedures where a short submission window is
// anomalous (median 30d on Открита, 21d on Публично; <12d ≈ 0.3–1%). On
// low-value / already-non-open procedures a ~10-day window is statutory, so the
// deadline check is not scored there at all.
const COMPETITIVE_TIERS = /Открита процедура|Публично състезание/;

// Non-open procedures (no open advert / no prior call) — mirrors the SQL bucket
// in tender_base_rates.sql and is_direct_award() in 041.
const NON_OPEN =
  /без предварително обявление|без публикуване|без предварителна покана|Пряко договаряне|Покана до определени/;

// Below the competitive-procedure norm (the 12+ "normal" band starts here).
const RUSHED_SUBMISSION_DAYS = 12;
// Award decided within this many days of the deadline (PRWP 10444 short band).
const SHORT_DECISION_DAYS = 4;
// Awards summing to more than this × the procedure estimate — the forecast was
// overshot. Base rate 4.1% at 1.10 (median awarded/estimated = 99%, p95 = 105%);
// the 10% buffer absorbs rounding/minor scope tweaks. PwC/Ecorys flag 18
// (+34.1%). One-sided by design: awards UNDER the estimate are usually
// competition savings, not a signal — and OCP R016's under-valuation is a
// different comparison (estimate vs the peer-CPV norm, already on the normalcy
// panel). See scripts/procurement/tender_base_rates.sql / plan §7.3.
const AWARD_OVER_ESTIMATE_RATIO = 1.1;

const MS_PER_DAY = 86_400_000;

/** Whole-day difference toISO − fromISO, or null when either is missing/unparseable. */
const dayDiff = (
  fromISO: string | null | undefined,
  toISO: string | null | undefined,
): number | null => {
  if (!fromISO || !toISO) return null;
  const a = Date.parse(fromISO);
  const b = Date.parse(toISO);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.floor((b - a) / MS_PER_DAY);
};

export const computeTenderRisk = (
  tender: TenderRiskInput,
  awards: TenderAward[] = [],
): TenderRiskResult => {
  const components: TenderRiskComponent[] = [];
  const add = (key: TenderRiskKey, available: boolean, fired: boolean) =>
    components.push({ key, available, fired });

  const proc = tender.procedureType ?? "";

  // 1. Non-open procedure — the hero flag. Available whenever the procedure type
  //    is published (≈100% of the corpus); fires on the non-open bucket.
  add("nonOpenProcedure", proc.length > 0, NON_OPEN.test(proc));

  // 2. Rushed submission window — tier-conditional. Only evaluable on a
  //    competitive tier with both endpoints published and a non-negative window.
  const submissionDays = dayDiff(
    tender.publicationDate,
    tender.submissionDeadline,
  );
  const scoredWindow =
    COMPETITIVE_TIERS.test(proc) &&
    submissionDays !== null &&
    submissionDays >= 0
      ? submissionDays
      : null;
  add(
    "rushedDeadline",
    scoredWindow !== null,
    scoredWindow !== null && scoredWindow < RUSHED_SUBMISSION_DAYS,
  );

  // 3. Short decision period — award decided just days after the deadline.
  //    Available only once the procedure is awarded (earliest signed contract).
  //    `awards` is populated via tender_detail()'s unp join (032, fixed in
  //    30aaf2558), so it now resolves corpus-wide, not just for ocid-linked rows.
  const signedAwards = awards.filter((a) => a.tag === "contract");
  const earliestSigned = signedAwards
    .filter((a) => a.dateSigned)
    .map((a) => a.dateSigned as string)
    .sort()[0];
  const rawDecisionDays = dayDiff(tender.submissionDeadline, earliestSigned);
  const scoredDecision =
    rawDecisionDays !== null && rawDecisionDays >= 0 ? rawDecisionDays : null;
  add(
    "shortDecisionPeriod",
    scoredDecision !== null,
    scoredDecision !== null &&
      scoredDecision >= 1 &&
      scoredDecision <= SHORT_DECISION_DAYS,
  );

  // 4. Award over estimate — the awards sum to more than 110% of the procedure
  //    forecast. Available only once awarded (needs an awarded sum) and the
  //    estimate is published. estimatedValueEur is a FORECAST — this is a
  //    forecast-vs-actual overshoot, not a spend total.
  const awardedSum = signedAwards.reduce(
    (s, a) => s + (typeof a.amountEur === "number" ? a.amountEur : 0),
    0,
  );
  const est = tender.estimatedValueEur;
  const overEstimateScorable =
    typeof est === "number" && est > 0 && awardedSum > 0;
  const overrunPct = overEstimateScorable ? awardedSum / est - 1 : null;
  add(
    "awardOverEstimate",
    overEstimateScorable,
    overEstimateScorable && awardedSum / est > AWARD_OVER_ESTIMATE_RATIO,
  );

  const availableCount = components.filter((c) => c.available).length;
  const firedCount = components.filter((c) => c.fired).length;
  const cri =
    availableCount === 0 ? 0 : Math.round((100 * firedCount) / availableCount);

  return {
    components,
    firedCount,
    availableCount,
    cri,
    hasFlag: firedCount > 0,
    submissionDays: scoredWindow,
    decisionDays: scoredDecision,
    overrunPct,
  };
};
