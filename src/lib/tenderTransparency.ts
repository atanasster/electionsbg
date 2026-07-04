// Per-procedure Transparency Score — a 0..100 data-completeness measure in the
// DIGIWHIST / OpenTender tradition (opentender.eu "transparency indicators"),
// adapted to the fields our ЦАИС ЕОП tender corpus actually carries. It scores
// how much of the procedure the buyer published, NOT whether the procedure was
// clean — a high score means "well documented", a low score means "opaque".
//
// Deliberately needs ZERO new data: every indicator is just "is this field
// populated?" over the Tender we already serve. Pure + React-free so the badge
// UI, the AI tools and any Node aggregator share one definition.

import type { Tender } from "@/lib/tenderTypes";

export type TenderTransparencyIndicatorKey =
  | "estimatedValue"
  | "cpv"
  | "category"
  | "procedureType"
  | "awardCriteria"
  | "legalBasis"
  | "submissionDeadline"
  | "placeOfPerformance"
  | "fundingInfo"
  | "lotBreakdown";

export type TenderTransparencyIndicator = {
  key: TenderTransparencyIndicatorKey;
  /** True when the underlying field is published on the procedure. */
  present: boolean;
};

export type TenderTransparencyResult = {
  /** 0..100 — 100 × present / total. */
  score: number;
  presentCount: number;
  total: number;
  indicators: TenderTransparencyIndicator[];
};

/** Place of performance is published either at the procedure level or on any
 *  lot — count it present if either carries a NUTS code. */
const hasPlace = (t: Tender): boolean =>
  !!t.nuts || t.lots.some((l) => !!l.nuts);

/** A lot breakdown is "detailed" when at least one lot carries real content — a
 *  name OR an estimated value — rather than a bare count with empty lots. */
const hasLotBreakdown = (t: Tender): boolean =>
  t.lots.length > 0 &&
  t.lots.some((l) => !!l.name || l.estimatedValueEur != null);

/**
 * Compute a tender's transparency score. REQUIRES a fully-loaded Tender — in
 * particular `lots` must be populated (a slim list-shape Tender with an empty
 * `lots` array but `lotsCount > 1` would score the lotBreakdown indicator absent
 * and silently dock the buyer). Also note single-lot tenders score out of 9, not
 * 10, so an 8/9 (89%) is NOT directly comparable to a 9/10 (90%).
 */
export const computeTenderTransparency = (
  t: Tender,
): TenderTransparencyResult => {
  const indicators: TenderTransparencyIndicator[] = [
    { key: "estimatedValue", present: t.estimatedValueEur != null },
    { key: "cpv", present: !!t.cpv },
    { key: "category", present: !!t.contractType },
    { key: "procedureType", present: !!t.procedureType },
    { key: "awardCriteria", present: !!t.awardMethod },
    { key: "legalBasis", present: !!t.legalBasis },
    { key: "submissionDeadline", present: !!t.submissionDeadline },
    { key: "placeOfPerformance", present: hasPlace(t) },
    // Funding info is "published" once the buyer states ANY funding stance — an
    // EU-funding flag OR an unsecured-funding disclosure. NOTE null-safe
    // (`!= null`): the API emits the key with a JSON `null` when undisclosed, and
    // `null !== undefined` would wrongly count every tender as published.
    {
      key: "fundingInfo",
      present: t.isEuFunded != null || t.hasUnsecuredFunding != null,
    },
  ];
  // Lot breakdown is only a meaningful transparency signal for MULTI-lot
  // procedures: a legitimate single-object procedure has no division to publish,
  // so it's dropped from the denominator (variable total) rather than capping an
  // otherwise-complete procedure at 90.
  if (t.lots.length > 1 || (t.lotsCount ?? 0) > 1) {
    indicators.push({ key: "lotBreakdown", present: hasLotBreakdown(t) });
  }
  const presentCount = indicators.filter((i) => i.present).length;
  const total = indicators.length;
  return {
    score: Math.round((100 * presentCount) / total),
    presentCount,
    total,
    indicators,
  };
};
