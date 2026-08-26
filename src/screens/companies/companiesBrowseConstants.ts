import type {
  RegistrySearchLabels,
  SearchFieldLabel,
} from "@/screens/components/RegistrySearchField";
import type { RegistryChipLabels } from "@/screens/components/RegistryActiveFilters";
import type { RegistryLandingLabels } from "@/screens/components/RegistryLanding";

// The /companies screen's exported constants and pure rules.
//
// They live outside the screen because a component file that also exports non-components
// breaks Fast Refresh — but the real reason is that each is a CLAIM a test needs to make
// without mounting a screen: what the corpus spells, and which population a scope names.
// Same shape, and the same reasoning, as `personsBrowseConstants.ts` and
// `@/ux/data_table/searchTerm`. (The URL-mirror interval that used to live here is gone with
// the debounce it timed — the hero field commits on submit.)

/** Offered as chips on the empty search box. Each must be a value THIS CORPUS ANSWERS — a chip
 *  that returns nothing is a worse introduction than no chip, and it is the first thing a new
 *  reader clicks. Measured 2026-08-26 against `company_browse_table` (1,022,592 rows):
 *
 *    „Софарма"    →    75 rows, incl. СОФАРМА ТРЕЙДИНГ, the corpus's largest public-money row
 *    „831646048"  →     1 row,  АВТОМАГИСТРАЛИ ЕАД (€983m) — routed by SHAPE to the uic arm
 *    „читалище"   → 2,174 rows
 *
 *  One name, one EIK and one organisation word, deliberately: the EIK chip is the only thing
 *  on the page that demonstrates the `searchWhen: "[0-9]{8,14}"` routing, which is the query a
 *  reader arriving from a document actually has.
 *
 *  ⚠️ THE NAMES CONTAIN HTML ENTITIES, SO A CHIP MUST NOT CONTAIN A QUOTE. 14,751 of the
 *  1,022,592 names carry a literal `&quot;` — „НАЦИОНАЛНА КОМПАНИЯ &quot;ЖЕЛЕЗОПЪТНА
 *  ИНФРАСТРУКТУРА&quot;" is the stored value — so a chip spelled with real quotation marks
 *  matches nothing. Pick single-token names. (The screen decodes entities for DISPLAY; the
 *  SEARCH runs against the stored fold, which does not.)
 *
 *  ⚠️ `companies.name` HAS `searchFold` BUT NOT `searchFoldTokens`, unlike `persons.name`. The
 *  whole query must therefore be one CONTIGUOUS substring of the transliterated fold:
 *  „софарма трейдинг" works and „софарма търговия" matches nothing even though the first word
 *  does. A multi-word chip is only safe if it is a contiguous prefix of a real name.
 *
 *  Verify a new value with a `SELECT count(*)` rather than typing it from memory —
 *  `companiesExamples.test.ts` re-derives the shape rules so a quote or a made-up EIK cannot
 *  come back.
 *
 *  NOT TRANSLATED, deliberately. These are values in a Bulgarian corpus; an English chip would
 *  return nothing. A Latin-typed query still finds them (`translit_bg_latin` folds both sides),
 *  so an EN reader loses nothing by being shown the spelling that exists in the data. */
export const EXAMPLE_TERMS = ["Софарма", "831646048", "читалище"];

/** How many companies the ACTIVE SCOPE holds — the denominator the head's basis names and the
 *  number the landing's browse buttons promise.
 *
 *  ⚠️ NAMED `companiesScopeCount`, NOT `scopeCount`, BECAUSE THE SIBLING'S ARITHMETIC IS THE
 *  OPPOSITE. `personsScopeCount(sector, {p, v})` SUMS its two tiers, which are disjoint;
 *  this one must never sum, because `signal` NESTS inside `all` (has_signal is a filter over
 *  the same rows), so adding them would report 1,121,329 companies — more than exist. Two
 *  same-named exports with incompatible semantics in adjacent directories is a bare auto-import
 *  away from being wrong; a distinct name makes the confusion unrepresentable rather than
 *  merely tested against.
 *
 *  ⚠️ NOT `total` UNCONDITIONALLY. Under `?scope=signal` the reader is looking at 98,737 rows,
 *  not 1,022,592, and a button that promises the second while delivering the first is the
 *  /persons „разгледай всички" defect (it promised 137 461 and delivered 63 816). Pure and
 *  exported so the rule is testable without a mounted screen — it is read from the scope
 *  control and from the browse buttons, and the two must never name different numbers. */
export const companiesScopeCount = (
  scope: "all" | "signal",
  counts: { all: number; signal: number },
): number => (scope === "signal" ? counts.signal : counts.all);

// ── The page's own strings for the four shared registry components ────────────────────────
//
// ⚠️ THEY LIVE HERE, NOT BESIDE THE COMPONENTS THEY CONFIGURE, for two reasons. The mechanical
// one: exporting a constant from a component file breaks Fast Refresh
// (`react-refresh/only-export-components`), which is why this module exists at all. The one
// that matters: they have to be EXPORTED so a test can pin the KEYS, and a rendered assertion
// cannot — with no i18n instance mounted, react-i18next's `t` returns `defaultValue` without
// ever reading the key, and most fallbacks here are byte-identical to their /persons twins. So
// wiring a /companies component to /persons' label set renders identically and passes every
// rendered assertion. Mutation-proved during review. The keys are the only thing that differs.

/** ⚠️ THE HINT NAMES ONLY WHAT THE RESOURCE SEARCHES, and for `companies` that is exactly TWO
 *  columns: `name` (through its transliterated fold) and `uic` (exact, routed by shape). It does
 *  NOT search the seat, the oblast, the legal form or the entity class — those are pickers — so
 *  „търсете по град" would teach a query the engine answers with nothing.
 *
 *  ⚠️ „фирма или организация", never „фирма". 33,948 rows are сдружения, читалища, фондации,
 *  кооперации, клонове and държавни предприятия, and the screen's own column already refuses to
 *  call them all фирми.
 *
 *  ⚠️ THE PLACEHOLDER GETS ITS OWN KEY rather than reusing `companies_browse_search`, which
 *  already exists and reads „Търси фирма или ЕИК…" — reusing it would make the most-read string
 *  in the component contradict the paragraph above, and because it is an inherited key a copy
 *  pass looking for new keys would not find it. That key stays on the TABLE toolbar, which is a
 *  different control in a different place. */
export const COMPANIES_SEARCH_LABELS: RegistrySearchLabels = {
  label: {
    key: "companies_search_label",
    fallback: "Търсене на фирма или организация",
  },
  placeholder: {
    key: "companies_search_placeholder",
    fallback: "Търси фирма, организация или ЕИК…",
  },
  hint: {
    key: "companies_search_hint",
    fallback: "Търсете по име на фирма или организация, или по ЕИК.",
  },
  clear: { key: "companies_search_clear", fallback: "Изчисти търсенето" },
  examples: { key: "companies_search_examples", fallback: "например" },
  submit: { key: "companies_search_submit", fallback: "Търси" },
  pending: {
    key: "companies_search_pending",
    fallback: "Натиснете „Търси“, за да видите резултатите.",
  },
};

export const COMPANIES_CHIP_LABELS: RegistryChipLabels = {
  intro: { key: "companies_active_filters", fallback: "Показани са само:" },
  remove: { key: "companies_remove_filter", fallback: "Премахни филтъра" },
  // ⚠️ A CONTRACTS KEY, deliberately reused rather than duplicated: „Изчисти филтрите" is the
  // same sentence on every browser and was already translated for /procurement/contracts.
  clearAll: { key: "contracts_clear_filters", fallback: "Изчисти филтрите" },
};

export const COMPANIES_FILTER_BAR_LABEL: SearchFieldLabel = {
  key: "companies_filters_label",
  fallback: "Филтри",
};

/** Every element-id prefix and label key this page hands the shared components, as ONE object a
 *  test can compare against /persons' wholesale. A per-key assertion catches a wrong key; only
 *  a set comparison catches a whole label object copied from the sibling. */
export const COMPANIES_REGISTRY_ID_PREFIX = "companies";

export const COMPANIES_LANDING_LABELS: RegistryLandingLabels = {
  startHere: { key: "companies_start_here", fallback: "Започнете оттук" },
  loading: { key: "companies_card_loading", fallback: "зарежда се" },
};

/** The landing's „Започнете оттук" cards — the cross-cutting queries no single picker expresses.
 *
 * ⚠️ EACH CARD CARRIES A PARAM PAIR, NOT AN ABSOLUTE HREF. A static `to: "/companies?money=1"`
 * REPLACES the whole query string, so it silently drops `?scope` and every `usePreserveParams`
 * global the reader is carrying — `?elections` in particular, which is live on this page (the OG
 * capture shoots `companies?political=1&elections=2026_04_19`). The landing merges the pair into
 * the current search instead, which is the `/persons` `entryHref` precedent and the same rule
 * `RegistryLanding`'s own header states for the browse buttons.
 *
 * ⚠️ EVERY CARD MUST BE REACHABLE BY ONE PARAM. The engine ANDs filters and every picker param
 * is single-valued, so a card needing two is not a card. That is why „НПО, читалища и фондации"
 * is NOT here, tempting though 30,339 is: it spans three `entity_class` values and `?class`
 * holds one. The Вид picker covers it.
 *
 * ⚠️ AND EVERY COUNT COMES FROM A FACET, never from a constant. The measured figures on
 * 2026-08-26 were political 17,675 · money 59,884 · contracts 18,689 · chitalishte 3,439 — they
 * are recorded here as provenance, NOT rendered. `db:load:declarations:pg --resolve`,
 * `db:load:graph:pg`, `db:load:tr-company-place:pg` and `db:load:pg` all rewrite columns this
 * table reads, so a hard-coded figure is right on the day it is typed and wrong for as long as
 * nobody checks. The screen supplies the counts; this list supplies everything else. */
export const COMPANIES_LANDING_CARDS = [
  {
    key: "political",
    labelKey: "companies_card_political",
    labelFallback: "Свързани с публично лице",
    hintKey: "companies_card_political_hint",
    hintFallback:
      "Собственик или в управлението според ТР, или деклариран дял пред Сметната палата.",
    param: "political",
    value: "1",
  },
  {
    key: "money",
    labelKey: "companies_card_money",
    labelFallback: "Получавали публични средства",
    hintKey: "companies_card_money_hint",
    hintFallback:
      "Обществени поръчки, субсидии от ДФЗ, европейски проекти или Interreg.",
    param: "money",
    value: "1",
  },
  {
    key: "contracts",
    labelKey: "companies_card_contracts",
    labelFallback: "Спечелили обществена поръчка",
    hintKey: "companies_card_contracts_hint",
    hintFallback: "Поне един договор в корпуса на обществените поръчки.",
    param: "contracts",
    value: "1",
  },
  {
    key: "chitalishta",
    labelKey: "companies_card_chitalishta",
    labelFallback: "Читалища",
    hintKey: "companies_card_chitalishta_hint",
    hintFallback: "Народните читалища, вписани в регистъра.",
    param: "class",
    value: "chitalishte",
  },
] as const;
