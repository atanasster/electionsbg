// Shared shape of a normalized tender (procedure) — the single source of truth
// for both the offline pipeline (scripts/procurement/normalize_eop_tender.ts,
// which re-exports these) and the FE hook (src/data/procurement/useTender.tsx).
// Keeping one definition means a schema change (new field, renamed optional)
// can't drift between the writer and the reader.
//
// Estimated values are a FORECAST (прогнозна стойност), QUARANTINED — never
// summed into any contracted-spend aggregate.

export interface TenderLot {
  /** lotIdentifier when present, else the lot's index within the procedure. */
  lotId: string;
  /** Per-lot notice id. */
  tenderId?: number;
  name?: string;
  cpv?: string;
  /** QUARANTINED forecast — the lot's estimated value, native currency. */
  estimatedValueNative?: number;
  currency?: string;
  /** QUARANTINED forecast — euro-converted (BGN at the locked peg). */
  estimatedValueEur?: number;
  nuts?: string;
}

export interface Tender {
  /** uniqueProcurementNumber — the procedure key (groups parent + lots). */
  unp: string;
  /** Lineage to the signed contract: `ocds-e82gsb-<parentTenderId>`. Undefined
   *  when the procedure-level tenderId is missing. */
  ocid?: string;
  /** Procedure-level (parent) notice id; = the ocid suffix. */
  tenderId?: number;
  noticeId?: number;
  /** Latest publication date of the procedure (YYYY-MM-DD). */
  publicationDate: string;
  buyerEik: string;
  buyerName: string;
  buyerType?: string;
  /** The buyer's main activity sector, e.g. "Услуги по общофункционално
   *  управление на държавата". */
  buyerMainActivity?: string;
  subject: string;
  /** Notice kind, e.g. "Обявление за поръчка – Общата директива, стандартен
   *  режим" (distinguishes the original notice from a change / prior-info). */
  noticeType?: string;
  procedureType?: string;
  awardMethod?: string;
  legalBasis?: string;
  /** works / goods / services (mapped from typeOfContract). */
  contractType?: string;
  cpv?: string;
  cpvDesc?: string;
  /** QUARANTINED forecast — procedure total, native currency. NEVER summed into
   *  any contracted-spend aggregate. */
  estimatedValueNative?: number;
  currency?: string;
  /** QUARANTINED forecast — euro-converted procedure total. */
  estimatedValueEur?: number;
  lotsCount?: number;
  lots: TenderLot[];
  /** ISO datetime; the FE derives open / closed-for-bids relative to "now". */
  submissionDeadline?: string;
  /** Status flag straight from the feed. NOTE: this is the procurement
   *  cancellation flag, NOT the КЗК appeal state — appeal status is a separate,
   *  lower-confidence enrichment (see PRD §12.4). */
  isCancelled: boolean;
  isFrameworkAgreement?: boolean;
  isEuFunded?: boolean;
  euProgram?: string;
  /** Funding not secured at announcement ("несигурно финансиране") — a real
   *  red-flag signal: the buyer opened the procedure without the money in hand. */
  hasUnsecuredFunding?: boolean;
  /** Place of performance NUTS (oblast when BGxxx). */
  nuts?: string;
  linkToOjEu?: string;
  changeNoticeCount?: number;
  /** The storage.eop.bg bucket day the procedure-level row came from. */
  sourceDay: string;
  sourceUrl: string;
}
