// COFOG — the UN/Eurostat Classification of the Functions of Government.
//
// ⚠️ THE NAMES ARE NOT HERE. They live in the i18n bundles as `cofog_GF01` …
// `cofog_GF10`, which predate this file and which the sibling
// `BudgetFunctionalTile` already renders one click away. A second copy in
// TypeScript is how the same division ends up with two names on two pages: the
// first draft of this module wrote „Обществен ред и сигурност" and „Култура,
// спорт и религия" against the bundles' „…и безопасност" and „…отдих и
// религия", and COFOG 08 is recreation, not sport.
//
// What lives here is only what the bundles cannot express: the CODE SET, its
// order, and the total row's sentinel.
//
// ⚠️ These are FUNCTIONS, not institutions. GF07 „Здравеопазване" is all health
// spending by every level of government — it is not the Ministry of Health's
// budget, and the two differ by a wide margin.

/** The ten divisions, in COFOG's own order. `budget_cofog.cofog_code` uses
 *  exactly these, plus TOTAL. */
export const COFOG_CODES = [
  "GF01",
  "GF02",
  "GF03",
  "GF04",
  "GF05",
  "GF06",
  "GF07",
  "GF08",
  "GF09",
  "GF10",
] as const;

export type CofogCode = (typeof COFOG_CODES)[number];

/** The row Eurostat uses for the whole of S13. `budget_cofog_list` keeps it out
 *  of `rows` and returns it as `totalEur`; anything reading the table directly
 *  must exclude it or every share doubles. */
export const COFOG_TOTAL_CODE = "TOTAL";

/** The i18n key for a division. Returns null for a code we do not know —
 *  including TOTAL — so a caller renders the raw code rather than a missing
 *  translation, which i18next would print as the key itself. */
export const cofogLabelKey = (code: string): string | null =>
  (COFOG_CODES as readonly string[]).includes(code) ? `cofog_${code}` : null;
