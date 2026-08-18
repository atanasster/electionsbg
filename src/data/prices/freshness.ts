// The freshness sentence on /prices.
//
// It carries three dates without conflating them — the euro baseline, the day
// the figure stands on, and how far the data runs — and it is what explains why
// the middle one is not the last one. Extracted from the screen so the plural
// and the wording can be tested directly: a test that rebuilt the string beside
// the component would only be testing its own copy.

/**
 * Consecutive days between the headline day and the end of the corpus.
 *
 * Counted back FROM the headline day rather than from the end independently:
 * derived separately the two can disagree (a headlineDate the series does not
 * carry, or no usable day at all), and the footer would then contradict the
 * hero instead of degrading with it.
 */
export const withheldTailCount = (
  dates: string[],
  headlineDate: string | null | undefined,
): number => {
  const i = headlineDate ? dates.indexOf(headlineDate) : -1;
  return i >= 0 ? dates.length - 1 - i : 0;
};

/**
 * "Данните стигат до 14.08.2026 г. Последните 6 дни са с непълен обхват,
 *  затова кошницата е изчислена към 8.08.2026 г."
 *
 * `latestLabel` / `headlineLabel` are already formatted (fmtPriceDate).
 */
export const freshnessSentence = (
  {
    latestLabel,
    headlineLabel,
    tail,
  }: { latestLabel: string; headlineLabel: string; tail: number },
  lang: "bg" | "en",
): string => {
  const head =
    lang === "bg"
      ? `Данните стигат до ${latestLabel}`
      : `Data runs to ${latestLabel}`;
  if (tail <= 0 || !headlineLabel) return head;
  // The Bulgarian date format already ends in "г." — appending a full stop
  // renders "14.08.2026 г..". Rendered, not reasoned: caught on the page.
  // NOT named `stop`: that is a global (window.stop), so a missing declaration
  // resolves to it silently instead of throwing.
  const fullStop = head.endsWith(".") ? "" : ".";
  // Bulgarian needs the singular form, and one withheld day is the MODAL
  // non-zero state for this feed — any single-day reporter dip produces it.
  // "Последните 1 дни" is what a naive template renders.
  if (lang === "bg")
    return (
      `${head}${fullStop} Последни${tail === 1 ? "ят" : "те"} ` +
      `${tail === 1 ? "ден е" : `${tail} дни са`} с непълен обхват, ` +
      `затова кошницата е изчислена към ${headlineLabel}`
    );
  return (
    `${head}${fullStop} The last ${tail === 1 ? "day is" : `${tail} days are`} ` +
    `under-reported, so the basket is calculated to ${headlineLabel}`
  );
};
