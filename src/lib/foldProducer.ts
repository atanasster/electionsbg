// Shared producer-name normaliser for the НФЦ film register. The grouping key
// must be computed identically wherever producers are matched — the ingest
// (scripts/culture/ingest.ts) writes it into `producerFold`, and the AI tool
// (ai/tools/culture.ts) re-folds a user query against those stored keys — so it
// lives in ONE place rather than being duplicated (and drifting) per call site.
//
// The TR match key (`coreName` in scripts/culture/producer_eik.ts) composes the
// same `stripProducerNoise` below, so the two cannot disagree about what a legal
// form or a quote is. They differ only in what they do afterwards: the fold also
// flattens punctuation and lower-cases; the match key keeps punctuation (TR names
// carry it — "КОРУНД-Х") and upper-cases.

/** Legal-form tokens dropped before grouping so "Х ЕООД" and "Х" fold alike. */
// Whitespace-delimited, NOT `\b`: JS `\b` is defined against [A-Za-z0-9_], so
// between a space and a Cyrillic letter there is NO boundary and `/\bЕООД\b/`
// never matches "АДА ФИЛМ ЕООД" at all. That silently left the legal form in
// every fold — 58 producers were split across two or three keys by nothing but
// an ЕООД/ООД spelling, and Клас's €3.07M published as €2.39M with the remainder
// in two buckets nobody could see. The ASCII arms (Ltd/LLC/GmbH) worked, which is
// why it read as correct.
export const PRODUCER_LEGAL_FORMS =
  /(^|\s)(ЕООД|ООД|ЕТ|ЕАД|АД|ДЗЗД|СНЦ|ЮЛНЦ|ФОНДАЦИЯ|Ltd|LLC|GmbH)\.?(?=\s|$)/gi;

/**
 * Quotes → SPACE, legal form dropped, whitespace collapsed.
 *
 * The quote rule replaces with a SPACE and never with "": the register routinely
 * writes the legal form with no space after the closing quote („Клас”ЕООД), so
 * stripping the quote to nothing welds the two tokens into КЛАСЕООД — which no
 * whitespace-delimited rule can then split, and which no TR name will ever equal.
 * The collapse afterwards makes the space a no-op for the well-spaced cases.
 */
export const stripProducerNoise = (raw: string): string =>
  raw
    .replace(/["“”„»«]/g, " ")
    .replace(PRODUCER_LEGAL_FORMS, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Normalised producer key for grouping: drop quotes/legal-form/punct, fold. */
export const foldProducer = (raw: string): string =>
  stripProducerNoise(raw)
    .replace(/[.,/–—-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("bg-BG");
