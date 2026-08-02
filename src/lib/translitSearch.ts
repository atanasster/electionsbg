// Lenient Latin/Cyrillic search folding for "shljokavica" input — lets a user
// type Latin ("arh", "arch", "stroitel") and match Bulgarian text
// ("Архитектурни", "Строителни"). Both the query and the target are folded to
// the same Latin skeleton: Streamlined-System transliteration, then the ч/х
// ambiguity (both often written "h" or "ch" in Latin chat) collapsed to `h`, so
// search is script- and spelling-forgiving.

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

/** True when `needle` (folded) is a substring of `haystack` (folded). Folds
 *  unconditionally. See also `searchMatches`, which differs ONLY in the
 *  empty-needle case (match-none there, match-all here) and tries a literal
 *  check first. */
export const skeletonMatches = (haystack: string, needle: string): boolean => {
  const n = latinSkeleton(needle);
  return n === "" || latinSkeleton(haystack).includes(n);
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
  if (isSkeletal(lowerHaystack) && isSkeletal(lowerNeedle)) return false;
  const n = latinSkeletonCached(needle);
  return n !== "" && latinSkeletonCached(haystack).includes(n);
};
