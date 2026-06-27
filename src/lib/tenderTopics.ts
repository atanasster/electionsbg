// Curated topic aliases for stable, shareable tender-search deep-links.
//
// Free-text subject search is fragile: in 2025, "мантинели" → 0 matches and
// "ограничителни" → 2, because the official procedure subjects and the words a
// citizen types diverge (the мантинели procedure's subject says "ограничителни
// системи", its CPV description says "предпазни съоръжения"). So a topic slug
// expands to a subject/CPV-description regex PLUS a set of CPV codes — a posted
// link (?topic=guardrails) then catches the procedure however it was worded.
//
// Shared by the FE search (src) and the openTenders AI tool (ai/, which imports
// this via the @/ alias), so a slug resolves identically on both surfaces.

export interface TenderTopic {
  slug: string;
  label: { bg: string; en: string };
  /** Words a user might type — used to auto-detect the topic from free text. */
  keywords: string[];
  /** Subject / CPV-description regex (case-insensitive). */
  pattern: RegExp;
  /** CPV codes (exact or prefix) that also qualify a row. */
  cpv: string[];
}

// A row shape both the FE index shards and the AI tool match against. Kept here
// (next to the matcher) so both surfaces agree on the searchable fields.
export interface TenderSearchRow {
  unp: string;
  ocid?: string;
  date: string;
  buyerEik: string;
  buyerName: string;
  subject: string;
  cpv?: string;
  cpvDesc?: string;
  estimatedValueEur?: number;
  currency?: string;
  lotsCount?: number;
  isCancelled: boolean;
  nuts?: string;
}

export const TENDER_TOPICS: TenderTopic[] = [
  {
    slug: "guardrails",
    label: {
      bg: "Пътни предпазни (ограничителни) съоръжения / мантинели",
      en: "Road safety barriers / guardrails",
    },
    // detectTopic does a SUBSTRING match on these, so they must be
    // discriminating: a bare "ограничителн" fires on "ограничителни мерки"
    // (pandemic restrictions) and routes it to guardrail tenders. Use the
    // road-specific phrases instead.
    keywords: [
      "мантинел",
      "ограничителни систем",
      "ограничителни съоръж",
      "предпазни съоръж",
      "предпазни огради",
      "пътни предпазни",
      "road barrier",
      "guardrail",
      "guard rail",
      "crash barrier",
    ],
    // Subject terms are road-specific on purpose. The generic "предпазни
    // съоръжения" is NOT in the regex: it's the shared CPV-45340000 description
    // (fences / railings / parks), so matching it would drag in unrelated works.
    // The road CPVs below are the precise discriminator; the мантинели procedure
    // (subject "ограничителни системи", CPV 45233292) is caught by both.
    pattern:
      /ограничителн[аи]?\s*систем|мантинел|road[\s-]?(restraint|barrier)|guard[\s-]?rail|crash[\s-]?barrier/i,
    cpv: ["45233292", "34928110", "34928100", "34928000", "34928300"],
  },
];

const norm = (s: string): string => s.toLocaleLowerCase("bg");

export const topicBySlug = (slug?: string | null): TenderTopic | undefined =>
  slug ? TENDER_TOPICS.find((t) => t.slug === slug) : undefined;

// Auto-detect a topic from free text, so the AI tool / search box can upgrade
// "мантинели" to the full guardrails topic even without an explicit slug.
export const detectTopic = (text: string): TenderTopic | undefined => {
  const q = norm(text);
  return TENDER_TOPICS.find((t) => t.keywords.some((k) => q.includes(norm(k))));
};

// subject/cpvDesc regex OR cpv prefix membership.
export const tenderMatchesTopic = (
  topic: TenderTopic,
  row: { subject?: string; cpvDesc?: string; cpv?: string },
): boolean =>
  topic.pattern.test(row.subject ?? "") ||
  topic.pattern.test(row.cpvDesc ?? "") ||
  topic.cpv.some((c) => (row.cpv ?? "").startsWith(c));
