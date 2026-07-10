// Shared school matura-eligibility helpers. The prerender (buildSchoolRoutes)
// and the sitemap both gate on the SAME rule — a school with at least one year
// carrying a numeric ДЗИ БЕЛ score, and a numeric НЕИСПУО id. They MUST emit the
// identical /school/:id set; keeping the gate here stops the two lists from
// drifting. (The AI tool reads the precomputed PG payload, which bakes the same
// eligibility in, so it doesn't need this.)

export interface SchoolLike {
  id: string;
  scoresByYear: Record<string, Record<string, number>>;
  countsByYear?: Record<string, Record<string, number>>;
}

/** URL/filesystem-safe id (numeric НЕИСПУО code only). */
export const hasCrawlableId = (rec: { id: string }): boolean =>
  /^[0-9]+$/.test(rec.id);

/** Latest year that carries a numeric ДЗИ БЕЛ score, with its score + cohort
 *  (n is undefined when the count is absent). null when the school has none. */
export const latestBel = (
  rec: SchoolLike,
): { year: number; score: number; n?: number } | null => {
  const years = Object.keys(rec.scoresByYear)
    .map(Number)
    .sort((a, b) => b - a);
  for (const y of years) {
    const s = rec.scoresByYear[String(y)]?.dzi_bel;
    if (typeof s === "number")
      return { year: y, score: s, n: rec.countsByYear?.[String(y)]?.dzi_bel };
  }
  return null;
};

/** A school is crawlable iff it has a numeric id AND a latest ДЗИ БЕЛ score. */
export const isCrawlableSchool = (rec: SchoolLike): boolean =>
  hasCrawlableId(rec) && latestBel(rec) != null;
