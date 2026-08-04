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
//   - It is CLIENT-SIDE ONLY. The server fold (`translit_bg_latin()` in
//     pg/000_search_fns.sql, used by the DbDataTable resources) implements the
//     Cyrillic→Latin half alone — it has neither these rules nor the ч/х
//     collapse — so a server-filtered browser answers the same query
//     differently. Closing that gap is a separate, deliberate decision.

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
};

/** Fold a string (Cyrillic and/or Latin) to a comparable Latin skeleton. */
export const latinSkeleton = (s: string): string => {
  let out = "";
  for (const ch of s.toLowerCase()) out += CYR_TO_LATIN[ch] ?? ch;
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
// The rules below rewrite the QUERY into a SECOND needle, tried only after the
// plain one misses — so this can only ever ADD matches, never remove one. That
// additive property is the whole design: it is why no existing caller of
// `searchMatches` / `skeletonMatches` can regress.
//
// Order matters: "6t"→"sht" must precede "6"→"sh", and the two "ya" producers
// must precede the `y` rule (their `y` is followed by `a`, so the negative
// lookahead then protects it).
//
// `c → ts` (ц) is DELIBERATELY ABSENT. It would refold every Latin trade name
// carrying a "c" — Keytruda, Abemaciclib, "concentrate for solution" — away from
// what the reader typed, and the НЗОК molecule/pack universes are majority
// Latin. Bulgarians type "ts" for ц anyway. Do not "complete" this table.
const SHLYO_RULES: [RegExp, string][] = [
  [/6t/g, "sht"], // ще
  [/6/g, "sh"], // ш
  [/4/g, "h"], // ч — via the ч/х collapse latinSkeleton already applies
  [/9/g, "ya"], // я
  [/q/g, "ya"], // я
  [/j/g, "zh"], // ж
  [/w/g, "v"], // в
  [/x/g, "h"], // х
  [/y(?![aeiou])/g, "a"], // ъ typed as "y"; a real й/ю/я keeps its vowel
];

/** What `shlyoOf` can actually rewrite — the union of SHLYO_RULES' left-hand
 *  SIDES, not merely of the characters they mention. The distinction carries
 *  the fast exit in `searchMatches`: `y` rewrites only when NOT followed by a
 *  vowel, so "sofiya" / "yordanov" / "mariya" — a real й/ю/я, and the way every
 *  Latin-typed Bulgarian name is spelled — must test FALSE here. A plain
 *  `[…y]` character class costs a measured 3.2x on a filter pass, folding the
 *  whole table for a rewrite that provably cannot exist.
 *
 *  Sound as a pre-test because no rule can CREATE a trigger a rule-free string
 *  lacked: the only rules that emit `y` are 9→"ya" and q→"ya", whose `y` is
 *  always immediately followed by `a`. Non-global, so `.test()` is stateless. */
const SHLYO_TRIGGER = /[469qjwx]|y(?![aeiou])/;

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
    let out = base;
    for (const [re, to] of SHLYO_RULES) out = out.replace(re, to);
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
