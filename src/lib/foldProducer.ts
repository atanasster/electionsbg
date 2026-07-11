// Shared producer-name normaliser for the НФЦ film register. The grouping key
// must be computed identically wherever producers are matched — the ingest
// (scripts/culture/ingest.ts) writes it into `producerFold`, and the AI tool
// (ai/tools/culture.ts) re-folds a user query against those stored keys — so it
// lives in ONE place rather than being duplicated (and drifting) per call site.

/** Legal-form tokens dropped before grouping so "Х ЕООД" and "Х" fold alike. */
export const PRODUCER_LEGAL_FORMS =
  /\b(ЕООД|ООД|ЕТ|ЕАД|АД|ДЗЗД|СНЦ|ЮЛНЦ|ФОНДАЦИЯ|Ltd|LLC|GmbH)\b\.?/gi;

/** Normalised producer key for grouping: drop quotes/legal-form/punct, fold. */
export const foldProducer = (raw: string): string =>
  raw
    .replace(/["“”„»«]/g, "")
    .replace(PRODUCER_LEGAL_FORMS, "")
    .replace(/[.,/–—-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("bg-BG");
