// The /persons screen's exported constants and pure rules.
//
// They live outside `PersonsBrowserScreen.tsx` because a component file that also exports
// non-components breaks Fast Refresh — but the real reason is that each of these is a CLAIM a
// test needs to make without mounting a screen: what the corpus spells, how long a term waits
// before it reaches the URL, and which population a scope names. Same shape, and the same
// reasoning, as `@/ux/data_table/searchTerm`.

/** How long the hero field's value waits before it is written to `?q`.
 *
 *  Named rather than inlined so a test can advance timers by the value the screen actually
 *  uses. One of THREE intervals in this page's search path, all with different jobs: none in
 *  the field itself (the box must never lag the keyboard), this one to the URL (bounding
 *  router churn), and 250 ms inside `DbDataTable` to the engine (where the SEARCH_MIN_CHARS
 *  contract lives). Merging any two couples an SEO/navigation concern to a query-cost one. */
export const URL_MIRROR_MS = 350;

/** Offered as chips on the empty search box. Each must be a value THIS CORPUS ANSWERS — a chip
 *  that returns nothing is a worse introduction than no chip, and it is the first thing a new
 *  reader clicks.
 *
 *  ⚠️ THE INSTITUTION NAME CARRIES AN EM DASH (U+2014), NOT A HYPHEN. `person_browse_table`
 *  writes „Окръжен съд — Варна"; the hyphen-minus spelling a keyboard produces matches **0
 *  rows** against 47 for the real one (measured 2026-08-26). The search folds case and
 *  transliteration, not punctuation. Check a new value with
 *  `SELECT count(*) … WHERE institution = '…'` rather than typing it from memory —
 *  `personsExamples.test.ts` re-derives the dash rule so a hyphen cannot come back.
 *
 *  ⚠️ NO ROLE WORDS. The `persons` resource searches `name` and `institution` and nothing else,
 *  so „Кмет" is not a role filter here — it matches whatever happens to contain the string, and
 *  advertising it teaches a search this page cannot do. Roles have a picker.
 *
 *  NOT TRANSLATED, deliberately. These are values in a Bulgarian corpus; an English chip would
 *  return nothing. A Latin-typed query still finds them (`translit_bg_latin` +
 *  `shlyo_query_fold` fold both sides), so an EN reader loses nothing by being shown the
 *  spelling that exists in the data. */
export const EXAMPLE_TERMS = ["Явор", "Окръжен съд — Варна", "Столична община"];

/** How many people the ACTIVE SCOPE holds — the denominator the head's basis names and the
 *  number the „разгледай всички" button promises.
 *
 *  ⚠️ NOT `p + v` UNCONDITIONALLY. The corpus total is what a reader gets only under „Всички";
 *  under „Във властта" the button promised 137 461 and delivered 63 816. Pure and exported so
 *  the rule is testable without a mounted screen — it is read from two places, and the two must
 *  never name different numbers. */
export const scopeCount = (
  sector: "all" | "public" | "private",
  tiers: { p: number; v: number },
): number =>
  sector === "private"
    ? tiers.v
    : sector === "public"
      ? tiers.p
      : tiers.p + tiers.v;
