import type {
  RegistrySearchLabels,
  SearchFieldLabel,
} from "@/screens/components/RegistrySearchField";
import type { RegistryChipLabels } from "@/screens/components/RegistryActiveFilters";
import type { RegistryLandingLabels } from "@/screens/components/RegistryLanding";

// The /persons screen's exported constants and pure rules.
//
// They live outside `PersonsBrowserScreen.tsx` because a component file that also exports
// non-components breaks Fast Refresh — but the real reason is that each of these is a CLAIM a
// test needs to make without mounting a screen: what the corpus spells and which population a
// scope names. Same shape, and the same reasoning, as `@/ux/data_table/searchTerm`.
//
// (The URL-mirror interval that used to live here is gone with the debounce it timed — the hero
// field commits on submit, so `?q` is written once, by the reader.)

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
 *  ⚠️ NAMED `personsScopeCount`, NOT `scopeCount`: /companies has a same-shaped rule whose
 *  arithmetic is the OPPOSITE (its two scopes NEST rather than partition, so it must never
 *  sum), and two same-named exports with incompatible semantics in adjacent directories is a
 *  bare auto-import away from being wrong.
 *
 *  ⚠️ NOT `p + v` UNCONDITIONALLY. The corpus total is what a reader gets only under „Всички";
 *  under „Във властта" the button promised 137 461 and delivered 63 816. Pure and exported so
 *  the rule is testable without a mounted screen — it is read from two places, and the two must
 *  never name different numbers. */
export const personsScopeCount = (
  sector: "all" | "public" | "private",
  tiers: { p: number; v: number },
): number =>
  sector === "private"
    ? tiers.v
    : sector === "public"
      ? tiers.p
      : tiers.p + tiers.v;

// ── The page's own strings for the shared registry components ─────────────────────────────
//
// ⚠️ EXPORTED SO A TEST CAN PIN THE KEYS — see the same block in `companiesBrowseConstants.ts`
// for why a rendered assertion cannot. They live here rather than beside the components because
// exporting a constant from a component file breaks Fast Refresh.

/** ⚠️ THE HINT NAMES ONLY WHAT THE RESOURCE SEARCHES. The `persons` resource searches `name` and
 *  `institution`; „община" is in the sentence because an institution name frequently IS one
 *  („Столична община"), not because there is a place arm. */
export const PERSONS_SEARCH_LABELS: RegistrySearchLabels = {
  label: {
    key: "persons_search_label",
    fallback: "Търсене на човек или институция",
  },
  placeholder: {
    key: "persons_search_placeholder",
    fallback: "Търси име или институция…",
  },
  hint: {
    key: "persons_search_hint",
    fallback: "Търсете по име, институция или община.",
  },
  clear: { key: "persons_search_clear", fallback: "Изчисти търсенето" },
  examples: { key: "persons_search_examples", fallback: "например" },
  submit: { key: "persons_search_submit", fallback: "Търси" },
  pending: {
    key: "persons_search_pending",
    fallback: "Натиснете „Търси“, за да видите резултатите.",
  },
};

export const PERSONS_CHIP_LABELS: RegistryChipLabels = {
  intro: { key: "persons_active_filters", fallback: "Показани са само:" },
  remove: { key: "persons_remove_filter", fallback: "Премахни филтъра" },
  clearAll: { key: "contracts_clear_filters", fallback: "Изчисти филтрите" },
};

export const PERSONS_FILTER_BAR_LABEL: SearchFieldLabel = {
  key: "persons_filters_label",
  fallback: "Филтри",
};

export const PERSONS_REGISTRY_ID_PREFIX = "persons";

export const PERSONS_LANDING_LABELS: RegistryLandingLabels = {
  startHere: { key: "persons_start_here", fallback: "Започнете оттук" },
  loading: { key: "persons_card_loading", fallback: "зарежда се" },
};
