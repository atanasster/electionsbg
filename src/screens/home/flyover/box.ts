// The band's reserved box, in ONE place.
//
// ⚠️ DELIBERATELY IMPORT-FREE, so the EAGER `HomeFlyoverSlot` and the LAZY `HomeFlyover` can
// share these without either pulling the engine into the entry chunk (`src/entryGraph.test.ts`
// seeds `lib/flyover/render.ts` and `programmes/index.ts` into its forbidden set). Same reason
// `src/locales/bundles.ts` is import-free, and its header records the last time a nav surface
// took one constant from a module that named a family.
//
// ⚠️ AND ONE VALUE PER DIMENSION, BECAUSE DRIFT HERE IS A LAYOUT SHIFT. Suspense fallback,
// poster, canvas and reduced-motion are one box, sitting ABOVE the eight destination tiles, on
// the page budgeted at CLS < 0.1 — the single worst place in the repo to spend it. These were
// five hand-copied literals across a boundary the code cannot cross, held in step by a comment
// asking a future reader to remember.

/** The frame the artifact is projected into, and therefore the band's aspect ratio. */
export const FLYOVER_ASPECT = "1000 / 625";
export const FLYOVER_W = 1000;
export const FLYOVER_H = 625;

/** Two lines' worth, reserved whether or not there is a caption — it changes every few seconds. */
export const CAPTION_ROW_CLASS =
  "min-h-[3.25rem] sm:min-h-[2.5rem] mt-2 text-sm";

/**
 * The scene switch's row.
 *
 * 24 px, not the 10 px dot inside it: WCAG 2.2 SC 2.5.8 wants a 24×24 target and no exception
 * applies here — these are not inline text, not user-agent-controlled, and there is no
 * equivalent control elsewhere on the page. The dot stays 10 px as the visual.
 */
export const SWITCH_ROW_CLASS = "mt-1 flex items-center gap-1 h-6";
export const SWITCH_DOT_CLASS = "h-2.5 w-2.5 rounded-full";

// ⚠️ THE 19 `flyover_*` KEYS STAY IN THE CORE CORPUS, and that is a decision rather than an
// oversight. Measured 2026-09-06 (brotli q11): removing them takes the core from 114,067 →
// 113,425 bytes (bg) and 98,862 → 98,293 (en) — about 600 B per language that every page
// downloads and only `/` can render, so `src/locales/bundles.ts`'s recipe would apply. It is
// not taken because `/` IS the entry page: bundling helps every other route and helps this one
// not at all, at the cost of a second request exactly where the request budget is tightest.
// Re-open it if the corpus budget in `tests/perf.spec.ts` needs the 600 B.
