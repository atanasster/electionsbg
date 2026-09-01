// The scenario matrix, declared ONCE for the fixture and the spec.
//
// ⚠️ Side-effect free on purpose: no CSS import, no DOM access, no React. The
// Playwright spec runs in Node and imports this file directly, which it cannot
// do with `home-grid.tsx`.
//
// Why it exists: the names were written out three times (fixture, spec, README)
// with nothing keeping them in step, and the fixture resolved an unknown name
// to `today` silently. A rename on one side alone would have made the whole
// matrix measure one point six times and report success — with `test.fail()`
// hiding it, since a documented failure and an accidental one look identical.

/** Image coverage 0 → today's 4/13 → all, plus the section-size and kind edges. */
export const SCENARIO_NAMES = [
  "today",
  "no-images",
  "all-images",
  "short-sections",
  "mixed-kinds",
  "compact",
] as const;

export type ScenarioName = (typeof SCENARIO_NAMES)[number];

/**
 * Story cards each scenario renders, LEAD INCLUDED — the shape assertion that
 * proves the fixture rendered the page the spec asked for. Measured 2026-09-01,
 * `compact` revised 2026-09-02 when §4.7 gave it back its lead.
 *
 * `no-images` is 15 rather than 16 because it renders no lead — there is no
 * cleared image for one. `compact` DOES render a lead: it is the composition
 * the page is built around, and compact shows it at a shallower media ratio
 * rather than dropping it, which used to leave compact as the standard grid
 * with less in each card.
 */
export const EXPECTED_CARDS: Record<ScenarioName, number> = {
  today: 16,
  "no-images": 15,
  "all-images": 16,
  "short-sections": 6,
  "mixed-kinds": 6,
  compact: 16,
};

/**
 * Scenarios that render BOTH an image-led and a text-only card, so a height
 * ratio between the two kinds is defined. The others have one kind only —
 * `compact` most surprisingly, since `StoryCard` gates the image block on
 * `!compact` and so renders none whatever the scenario asks for.
 */
export const MIXED_KIND_SCENARIOS: readonly ScenarioName[] = [
  "today",
  "short-sections",
  "mixed-kinds",
];
