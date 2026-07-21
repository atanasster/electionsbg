// Raw shape of one record in the ЦАИС ЕОП flat "поръчки" (tenders) open-data
// feed — the daily JSON object at
//   storage.eop.bg/open-data-<YYYY-MM-DD>/Автоматично генерирани данни за
//   поръчки, публикувани в ЦАИС ЕОП на <DD.MM.YYYY>.json
//
// Loose on purpose: the feed carries ~50 camelCase fields; this types the subset
// the tender normalizer reads. Every value arrives as a string (Bulgarian
// formatting for numbers/dates, "Да"/"Не" for booleans) except the numeric ids.
export interface EopTenderRecord {
  noticeId?: number | string;
  publicationDate?: string; // ISO datetime, e.g. "2026-06-15T05:12:35.13"
  uniqueProcurementNumber?: string; // УНП, e.g. "00044-2025-0125"
  tenderId?: number | string; // per-notice id; parent's = OCDS ocid suffix
  procedureType?: string;
  subject?: string;
  mainCpvCode?: string;
  mainCpvDescription?: string;
  typeOfContract?: string; // "Строителство" | "Доставки" | "Услуги"
  estimatedValue?: string | number; // прогнозна стойност — a FORECAST
  currency?: string;
  legalBasis?: string;
  awardMethod?: string;
  buyerName?: string;
  buyerRegistryNumber?: string; // authority EIK
  buyerType?: string;
  buyerMainActivity?: string;
  submissionDeadline?: string;
  noticeType?: string;
  lotIdentifier?: string | null;
  isEuFunded?: string; // "Да" | "Не"
  europeanProgram?: string;
  hasUnsecuredFunding?: string; // "Да" | "Не" — funding not secured at announcement
  isFrameworkAgreement?: string;
  lotsCount?: number | string;
  executionPlaceNuts?: string; // "BGxxx" oblast or bare "BG"
  lotTenderName?: string | null;
  changeNoticeCount?: number | string;
  isCancelled?: string; // "Да" | "Не"
  changeNoticeDocuments?: unknown;
  linkToOjEu?: string;
  isLot?: string; // "Да" (lot row) | "Не" (procedure row)
  // Non-feed passthrough: set only by the pre-2020 РОП backfill
  // (ingest_rop_tenders.ts), whose records come from the aop.bg cases search, not
  // storage.eop.bg. Lets the normalizer cite the real source URL instead of the
  // storage.eop.bg day bucket (which 404s for pre-2020). The live ЦАИС feed never
  // sets this, so its citations are unchanged.
  sourceUrl?: string;
}

// The feed's daily-bucket filename pattern + object URL. Lives here (one place)
// so the ingest and the normalizer's sourceUrl can't drift apart.
export const tendersKey = (day: string): string => {
  const [y, m, d] = day.split("-");
  return `Автоматично генерирани данни за поръчки, публикувани в ЦАИС ЕОП на ${d}.${m}.${y}.json`;
};
export const tendersDayUrl = (day: string): string =>
  `https://storage.eop.bg/open-data-${day}/${encodeURIComponent(tendersKey(day))}`;
