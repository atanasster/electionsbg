import { REGISTRY_URL_MIRROR_MS } from "@/screens/components/registrySearchTiming";

// The /companies screen's exported constants and pure rules.
//
// They live outside the screen because a component file that also exports non-components
// breaks Fast Refresh — but the real reason is that each is a CLAIM a test needs to make
// without mounting a screen: what the corpus spells, and how long a term waits before it
// reaches the URL. Same shape, and the same reasoning, as `personsBrowseConstants.ts` and
// `@/ux/data_table/searchTerm`.

/** How long the hero field's value waits before it is written to `?q`.
 *
 *  ⚠️ THE ARGUMENT LIVES ONCE, in `registrySearchTiming.ts`, beside the component that owns the
 *  behaviour. It was written for /persons and copied here byte-identically — value and eight-line
 *  rationale — which meant a correction to either would land on one page and not the other. The
 *  screens go on importing `URL_MIRROR_MS` from their own module, so no call site moved; if
 *  /companies ever wants a different interval against its 1.02M-row corpus, replace this line
 *  with a literal AND a sentence saying why. */
export const URL_MIRROR_MS = REGISTRY_URL_MIRROR_MS;

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
