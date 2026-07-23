// What to say under the ДЗИ Maths line on /school/:id.
//
// The second matura is by chosen subject (vocational pupils sit a professional
// qualification exam instead), so maths behaves nothing like БЕЛ: only ~10% of
// schools have a maths result in any year, the median maths group is 7 pupils —
// some are a single pupil — and on 54 of the 152 schools that show the line at
// all it is 1-4 years older than everything else on the page. A bare
// "Матура по математика (2022): 3,98" therefore reads either as a stale page or
// as a school statistic of the same standing as the БЕЛ average. It is neither.

export interface MathsCaveat {
  /** The maths year is behind the school's latest ДЗИ БЕЛ year. */
  stale: boolean;
  /** Fewer examinees than the ranking floor — the average is noise. */
  smallCohort: boolean;
}

export const mathsCaveat = (
  math: { year: number; n?: number } | null,
  latestBelYear: number | null,
  minCohort: number,
): MathsCaveat | null => {
  if (!math) return null;
  return {
    stale: latestBelYear != null && math.year < latestBelYear,
    smallCohort: math.n != null && math.n < minCohort,
  };
};

/** The sentence for a caveat, or null when the figure needs no qualifying. */
export const mathsCaveatText = (
  c: MathsCaveat | null,
  bg: boolean,
): string | null => {
  if (!c || (!c.stale && !c.smallCohort)) return null;
  const parts: string[] = [];
  if (c.stale)
    parts.push(
      bg
        ? "Последната година с матура по математика в това училище — вторият зрелостен изпит е по избор."
        : "The last year this school had a maths matura — the second exam is by chosen subject.",
    );
  if (c.smallCohort)
    parts.push(
      bg
        ? "Малка група явили се, затова стойността е несигурна."
        : "A small group sat it, so the figure is noisy.",
    );
  return parts.join(" ");
};
