// Lenient Latin/Cyrillic search folding for "shljokavica" input — lets a user
// type Latin ("arh", "arch", "stroitel") and match Bulgarian text
// ("Архитектурни", "Строителни"). Both the query and the target are folded to
// the same Latin skeleton: Streamlined-System transliteration, then the ч/х
// ambiguity (both often written "h" or "ch" in Latin chat) collapsed to `h`, so
// search is script- and spelling-forgiving.
//
// On top of that skeleton the matchers run a SECOND, alternate needle covering
// the Latin-side spellings the skeleton alone cannot reach ("6umen", "4erven",
// "plowdiw", "sofiq") — see SHLYO_RULES below. Two properties of that pass are
// contracts, not implementation details:
//   - It is QUERY-SIDE ONLY and strictly ADDITIVE. The alternate needle is
//     tried only after the plain one misses, so it can add matches and never
//     remove one. Applying these rules to the DATA side would be wrong.
//   - The RULE TABLE is no longer private to this module. It is declared in
//     `./shlyoRules` so a SQL `shlyo_query_fold()` can be generated from the
//     same source and the server can stop answering the same query differently.
//     This module consumes the CLIENT half of it (`applyShlyoRulesCollapsed`).
//     The ч/х COLLAPSE stays client-side either way: it is deliberately lossy —
//     it makes "arch" and "arh" one key — which is right for a substring filter
//     over text a reader is scanning and wrong for a stored name index.

import { SHLYO_TRIGGER, applyShlyoRulesCollapsed } from "./shlyoRules";

const CYR_TO_LATIN: Record<string, string> = {
  а: "a",
  б: "b",
  в: "v",
  г: "g",
  д: "d",
  е: "e",
  ж: "zh",
  з: "z",
  и: "i",
  й: "y",
  к: "k",
  л: "l",
  м: "m",
  н: "n",
  о: "o",
  п: "p",
  р: "r",
  с: "s",
  т: "t",
  у: "u",
  ф: "f",
  х: "h",
  ц: "ts",
  ч: "ch",
  ш: "sh",
  щ: "sht",
  ъ: "a",
  ь: "y",
  ю: "yu",
  я: "ya",
  // CYRILLIC HOMOGLYPHS — not Bulgarian letters, so they are not part of the
  // transliteration proper, but they DO appear in Bulgarian text and without an entry
  // here they fall through `CYR_TO_LATIN[ch] ?? ch` unchanged and are then stripped by
  // the `[^a-z0-9]` filter — so the word silently loses a letter and matches nothing.
  //
  // Measured in the corpus (2026-08-20), which is why these and not others: `і` U+0456
  // appears 2,155,780 times because ЦАИС writes „Раздел І:" with the Cyrillic І; `ѝ`
  // 8,227 (Bulgarian's own grave-accented и); `э`/`ы` in Russian-language
  // specifications; `ј ѕ ӧ ӓ ѵ є` in a long tail that includes „Hӧrmann GmbH", a German
  // name carrying a Cyrillic ӧ. The server-side twin `translit_bg_latin()` maps exactly
  // this set — see 000_search_fns.sql and docs/plans/search-fold-homoglyphs-v1.md.
  //
  // Uppercase needs no entry: `latinSkeleton` lowercases before the lookup, and
  // 'І'.toLowerCase() === 'і'.
  і: "i",
  ї: "i",
  ѝ: "i",
  ѵ: "i",
  ѐ: "e",
  ё: "e",
  э: "e",
  є: "e",
  ы: "y",
  ј: "j",
  ѕ: "s",
  ӧ: "o",
  ӓ: "a",
};

/** Latin letters that NFD cannot decompose, and what the server folds them to.
 *
 *  ⚠️ Stripping combining marks only reaches letters that HAVE a combining form. `ł ø ß æ
 *  œ ð đ þ ħ ŋ ı ŧ ŀ ſ` are single indivisible code points, so NFD leaves them untouched
 *  and the `[^a-z0-9]` filter then DELETES them — the same lost-letter defect the
 *  diacritic strip was added to fix, one class of character over. Measured: 111 corpus
 *  rows carry one, mostly Polish contractors, and `searchMatches("Wojskowe Zakłady
 *  Lotnicze", "zaklady")` was false while the server folded it to `wojskowe zaklady`.
 *
 *  DERIVED, not typed: every code point in U+00C0–U+017F (plus the Extended-B letters that
 *  occur in European names) was folded by the server's `translit_bg_latin()` and compared
 *  against what this module produces; these 23 are exactly the disagreements. Re-derive
 *  the same way if the server's unaccent rules ever change — a hand-list here would drift
 *  from the server silently, and the failure is a search that returns nothing. */
const LATIN_EXTRA: Record<string, string> = {
  æ: "ae",
  ð: "d",
  ø: "o",
  þ: "th",
  ß: "ss",
  đ: "d",
  ħ: "h",
  ı: "i",
  ĳ: "ij",
  ĸ: "q",
  ŀ: "l",
  ł: "l",
  ŉ: "n",
  ŋ: "n",
  œ: "oe",
  ŧ: "t",
  ſ: "s",
  ƀ: "b",
  ɓ: "b",
  ɖ: "d",
  ƒ: "f",
  ƶ: "z",
  ȷ: "j",
};

/** Drop combining marks from ONE character, for the Latin side only.
 *
 *  ⚠️ It is applied per character AFTER the Cyrillic lookup misses, never to the whole
 *  string up front, and the difference is a real regression that the punctuation test
 *  caught: NFD decomposes `й` into `и` + U+0306 COMBINING BREVE, so a blanket strip turns
 *  „АЕЦ Козлодуй" into `kozlodui` — it silently re-spells a Bulgarian letter as a
 *  different one. `й` and `ё` are in CYR_TO_LATIN and so never reach this. */
const stripDiacritics = (ch: string): string =>
  ch.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

/** Fold a string (Cyrillic and/or Latin) to a comparable Latin skeleton.
 *
 *  ⚠️ LATIN DIACRITICS ARE STRIPPED FIRST, and that step is not cosmetic. Without it an
 *  accented Latin letter is in neither `CYR_TO_LATIN` nor `[a-z0-9]`, so it survives the
 *  lookup unchanged and is then DELETED by the filter below — „Hörmann" folded to
 *  `hrmann` and „Cañón" to `can`, losing a letter rather than mis-spelling one, which is
 *  why it never looked like a bug to anyone reading the output.
 *
 *  It also brings this function CLOSER to the server's `translit_bg_latin()`, which gets
 *  the same effect from `unaccent()`. They are deliberately NOT identical — this side
 *  additionally collapses ч/х and strips every non-alphanumeric, which is right for a
 *  substring filter over text a reader is scanning and wrong for a stored name index —
 *  so the property that must hold is narrower and more important than equality: NEITHER
 *  SIDE MAY DROP A LETTER THE OTHER KEEPS. A dropped letter is a search that quietly
 *  returns nothing. NFD splits a letter into base + combining mark and the range below is
 *  the combining-diacritics block. */
export const latinSkeleton = (s: string): string => {
  let out = "";
  for (const ch of s.toLowerCase())
    out += CYR_TO_LATIN[ch] ?? LATIN_EXTRA[ch] ?? stripDiacritics(ch);
  // Collapse ч(→"ch")/х(→"h") and any typed "ch" to a single "h" so "arch",
  // "arh" and "арх" all fold alike. sh/zh/sht keep their "h" (no bare "ch").
  return out.replace(/ch/g, "h").replace(/[^a-z0-9]/g, "");
};

// SHLIOKAVITSA, the other half. `latinSkeleton` handles Cyrillic→Latin, so
// "арх" and "arh" already meet. What it does NOT handle is the Latin-side
// spelling a Bulgarian actually types: "6umen" (Шумен), "4erven" (Червен),
// "jelezopyten" (железопътен), "plowdiw" (Пловдив), "sofiq" (София). Those fold
// to themselves and miss.
//
// The rule table now lives in `./shlyoRules`, because Postgres needs it too: a
// SQL `shlyo_query_fold()` is generated from that same declaration so a
// server-filtered browser and a client-filtered one cannot answer differently.
// Read that file's header before touching a rule: the table is written against the
// STREAMLINED alphabet (`4 → "ch"`), which is what the server folds to, and this
// module uses `applyShlyoRulesCollapsed` — the same table with each rule's
// REPLACEMENT collapsed to this alphabet. Collapsing the finished string instead
// is the trap, and it is not equivalent; see the comment in `shlyoOf`.
//
// The rules rewrite the QUERY into a SECOND needle, tried only after the plain
// one misses, so this can only ever ADD matches, never remove one. That additive
// property is the whole design: it is why no existing caller of `searchMatches`
// / `skeletonMatches` can regress.

// The alternate needle is a pure function of the folded needle, which is
// CONSTANT across a filter pass — but `searchMatches` runs per CELL (~178k
// times on a 12.7k-row report table; see DataTable.tsx), so recomputing it
// there ran nine global replaces per cell to rebuild the same string. ONE entry
// is enough: unlike the fold memo below there is no working set, because a pass
// only ever asks about one needle.
let lastShlyoIn: string | null = null;
let lastShlyoOut = "";
let shlyoComputes = 0;

/** Apply the shlyo rules to an ALREADY-FOLDED string. Returns "" when the
 *  rewrite is a no-op, which the callers read as "no second needle needed". */
const shlyoOf = (base: string): string => {
  if (base === lastShlyoIn) return lastShlyoOut;
  shlyoComputes++;
  let res = "";
  if (SHLYO_TRIGGER.test(base)) {
    // The COLLAPSED table — the rules re-expressed in this module's alphabet.
    // Do NOT collapse the finished string instead: `base` can already contain a
    // `ch` that `latinSkeleton` never collapsed (it collapses before stripping
    // punctuation, so "Basic Holding" folds to "basicholding"), and collapsing
    // it here would DELETE a character the old needle kept — turning an additive
    // rewrite into one that loses matches. See shlyoRules.ts.
    const out = applyShlyoRulesCollapsed(base);
    if (out !== base) res = out;
  }
  lastShlyoIn = base;
  lastShlyoOut = res;
  return res;
};

/** How many times the rules were actually run. Exported as a test seam only —
 *  the memo above is otherwise invisible from the outside, exactly like
 *  `skeletonCacheSize()` for the fold memo. */
export const shlyoComputeCount = (): number => shlyoComputes;

/** Fold `s`, then normalise the Latin-side shliokavitsa spellings.
 *
 *  QUERY SIDE ONLY — this is a precondition, not a preference. Applied to the
 *  data side it is simply wrong: a Latin company name "Wow Ltd" folds to
 *  `wowltd` and would be stored as `vovltd`, and the ""-means-no-op return
 *  would index an empty string for the majority of names.
 *
 *  @returns the alternate needle, or "" when the rules change nothing — which
 *  callers must read as "no second needle to try", never as "matches nothing".
 *  Prefer `searchMatches` / `skeletonMatches`, which own that distinction. */
export const shlyoSkeleton = (s: string): string => shlyoOf(latinSkeleton(s));

/** True when `needle` (folded) is a substring of `haystack` (folded). Folds
 *  unconditionally. See also `searchMatches`, which differs ONLY in the
 *  empty-needle case (match-none there, match-all here) and tries a literal
 *  check first. */
export const skeletonMatches = (haystack: string, needle: string): boolean => {
  const n = latinSkeleton(needle);
  if (n === "") return true;
  const hay = latinSkeleton(haystack);
  if (hay.includes(n)) return true;
  const alt = shlyoOf(n);
  return alt !== "" && hay.includes(alt);
};

// Folding is ~9x the cost of a plain lowercase `includes` on a table filter, and
// a filter re-folds the SAME cell values on every keystroke, so memoize.
//
// EVICT, don't wipe. The working set is one table's DISTINCT CELL VALUES, which
// is far bigger than its row count: a section-grain /reports table is ~12.7k rows
// x 14 filterable columns, and its high-cardinality numeric columns alone carry
// ~100k distinct values. A wholesale clear() at the cap therefore fired 2-3x
// WITHIN a single pass and retained nothing for the next one — measured 50ms on
// EVERY pass against a 5.6ms literal-only baseline. Dropping the oldest half
// costs one partial re-fold instead.
const SKELETON_CACHE_LIMIT = 50_000;
const skeletonCache = new Map<string, string>();

/** `latinSkeleton` memoized on its input. Use for repeated folding of the same
 *  strings (table cells across keystrokes); prefer `latinSkeleton` for one-offs. */
export const latinSkeletonCached = (s: string): string => {
  const hit = skeletonCache.get(s);
  if (hit !== undefined) return hit;
  const folded = latinSkeleton(s);
  if (skeletonCache.size >= SKELETON_CACHE_LIMIT) {
    const half = SKELETON_CACHE_LIMIT >> 1;
    let i = 0;
    for (const k of skeletonCache.keys()) {
      if (i++ >= half) break;
      skeletonCache.delete(k);
    }
  }
  skeletonCache.set(s, folded);
  return folded;
};

/** Entry count of the fold memo. Exported as a test seam only — it is what lets
 *  `searchMatches`'s "don't fold when you don't have to" contract be asserted at
 *  all, since folding is otherwise invisible from the outside. */
export const skeletonCacheSize = (): number => skeletonCache.size;

// A string is "skeletal" when folding it is the identity: nothing for the
// `[^a-z0-9]` strip to remove, and no `ch` for the digraph collapse to rewrite.
// Numeric and ASCII-identifier cells — the bulk of a wide table's cells — are.
const NON_SKELETAL = /[^a-z0-9]/;
const isSkeletal = (lower: string): boolean =>
  !NON_SKELETAL.test(lower) && !lower.includes("ch");

/** Script-forgiving substring test for a table's global text filter.
 *
 *  An all-punctuation needle folds to "" — here that means "nothing to match
 *  on", NOT "match everything" (see `skeletonMatches`, which is the opposite;
 *  the caller's empty-query case never reaches either).
 *
 *  ORDERING IS THE PERF CONTRACT, and it is not the literal check that carries
 *  it: a filter's common outcome is a MISS, so the literal check exits early
 *  only for the matching minority. The skeletal guard is what keeps the cost
 *  down — when neither side can be changed by folding, the literal check above
 *  was already decisive, so the fold is provably redundant rather than merely
 *  unlikely to help. That is exact: no match is lost, including the ones folding
 *  wins WITHIN Latin text ("Ivanov-Petrov" ~ "ivanovpetrov", "Church" ~ "hur"),
 *  since either side being non-skeletal takes the folded path. */
export const searchMatches = (haystack: string, needle: string): boolean => {
  const lowerHaystack = haystack.toLowerCase();
  const lowerNeedle = needle.toLowerCase();
  if (lowerHaystack.includes(lowerNeedle)) return true;
  // The skeletal guard claims "folding cannot change the answer". With the
  // shlyo rules that is no longer true of a needle the rules can rewrite —
  // "6umen" is all-[a-z0-9] and still rewrites — so such a needle must take the
  // folded path even between two otherwise-skeletal strings. Needles the rules
  // leave alone ("iv", "plovdiv", and every y-before-a-vowel name) keep the
  // original fast exit.
  //
  // Testing the RAW needle against a trigger that `shlyoOf` later applies to
  // the FOLDED one is safe ONLY under `isSkeletal(lowerNeedle)` above: that
  // makes folding the identity, so raw and folded are the same string. Folding
  // can otherwise introduce a `y` (й/ь→"y", ю→"yu", я→"ya"). Do not reorder
  // these conjuncts.
  if (
    isSkeletal(lowerHaystack) &&
    isSkeletal(lowerNeedle) &&
    !SHLYO_TRIGGER.test(lowerNeedle)
  )
    return false;
  const n = latinSkeletonCached(needle);
  if (n === "") return false;
  const hay = latinSkeletonCached(haystack);
  if (hay.includes(n)) return true;
  const alt = shlyoOf(n);
  return alt !== "" && hay.includes(alt);
};

/**
 * Filter `items` to at most `limit`, ranking LITERAL substring hits above
 * fold-only ones.
 *
 * WHY THE RANK IS NOT OPTIONAL. `searchMatches` is additive as a PREDICATE — it
 * can only add matches. A positional cap breaks that at the display level: once
 * the predicate loosens, fold-matches early in source order consume the whole
 * budget before the loop reaches the literal ones. Measured on the 4,755-name
 * candidate roster, a plain one-pass filter capped at 200 made the query "въл"
 * show 200 rows of Иванов/Василев and pushed 17 real Вълчев/Вълчева entries out
 * of view entirely — with no "show more" to reach them. (`latinSkeleton` maps
 * ъ→"a", so "въ" folds to "va" and matches half the roster.)
 *
 * Ranking restores additivity where the user can see it: every literal match
 * that fitted before still fits, and fold matches fill only the remainder.
 *
 * @param keyOf the text to match on. Called per item per keystroke, so hand it
 *              a cheap accessor — decode/normalise upstream, not in here.
 */
export const rankedFilter = <T>(
  items: readonly T[],
  query: string,
  keyOf: (item: T) => string,
  limit: number,
): T[] => {
  if (limit <= 0) return [];
  if (!query) return items.slice(0, limit);
  const lower = query.toLowerCase();
  const literal: T[] = [];
  const folded: T[] = [];
  for (const item of items) {
    const key = keyOf(item);
    if (key.toLowerCase().includes(lower)) literal.push(item);
    else if (folded.length < limit && searchMatches(key, query))
      folded.push(item);
    // Break ONLY on the literal count. Breaking on the combined count would
    // reintroduce the eviction this function exists to prevent.
    if (literal.length >= limit) break;
  }
  return literal.concat(folded).slice(0, limit);
};
