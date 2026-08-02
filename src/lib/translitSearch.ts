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

/** True when `needle` (folded) is a substring of `haystack` (folded). */
export const skeletonMatches = (haystack: string, needle: string): boolean => {
  const n = latinSkeleton(needle);
  return n === "" || latinSkeleton(haystack).includes(n);
};

// Folding is ~13x the cost of a plain lowercase `includes` (measured: 390ms vs
// 30ms over 300k strings), and a table filter re-folds the SAME cell values on
// every keystroke. Memoize so only the first pass over a given value pays —
// bounded, and cleared wholesale rather than LRU-evicted (the working set is one
// table's cells, so a clear costs one more full pass, not a leak).
const SKELETON_CACHE_LIMIT = 50_000;
const skeletonCache = new Map<string, string>();

/** `latinSkeleton` memoized on its input. Use for repeated folding of the same
 *  strings (table cells across keystrokes); prefer `latinSkeleton` for one-offs. */
export const latinSkeletonCached = (s: string): string => {
  const hit = skeletonCache.get(s);
  if (hit !== undefined) return hit;
  const folded = latinSkeleton(s);
  if (skeletonCache.size >= SKELETON_CACHE_LIMIT) skeletonCache.clear();
  skeletonCache.set(s, folded);
  return folded;
};

/** Script-forgiving substring test for a table's global text filter: the cheap
 *  literal check first, the folded one only on a miss. An all-punctuation needle
 *  folds to "" — there it means "nothing to match on", NOT "match everything"
 *  (the caller's empty-query case never reaches here). */
export const searchMatches = (haystack: string, needle: string): boolean => {
  if (haystack.toLowerCase().includes(needle.toLowerCase())) return true;
  const n = latinSkeletonCached(needle);
  return n !== "" && latinSkeletonCached(haystack).includes(n);
};
