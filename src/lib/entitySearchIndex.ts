// The search index behind <SectorEntitySearch> — the shared "find a hospital /
// a molecule / a court / a school" box on a sector dashboard.
//
// WHY A PURPOSE-BUILT INDEX rather than filtering with `searchMatches` per row:
// a sector dashboard's box is asked about the SAME rows on every keystroke, and
// `searchMatches` folds its haystack each time (memoised, but still a map probe
// plus a `startsWith`/`includes` on a string it has to look up). Folding once at
// build time turns a keystroke into one `indexOf` over a pre-folded string.
//
// Two contracts make that cheap AND meaningful:
//
//   1. FOLD AT BUILD, NEVER AT KEYSTROKE — and fold with `latinSkeleton`, NOT
//      `latinSkeletonCached`. The shared memo has a 50k cap with half-eviction
//      sized for the DataTable's distinct-cell working set; pushing an index's
//      thousands of strings through it would evict that working set and
//      re-introduce the 50ms-per-pass regression its comment documents. We keep
//      our own copy, so the memo must not be touched.
//
//   2. THE INDEX IS RANK-ORDERED — pass `rank` and rows are sorted by it,
//      descending, before folding. That is what makes `searchIndex`'s
//      scan-and-stop honest: it stops at the cap, and because the scan runs in
//      rank order the rows it stopped after are the LARGEST matches, not an
//      arbitrary prefix of the list. Truncation that means something.

import { latinSkeleton, shlyoSkeleton } from "./translitSearch";

/** One selectable result. `href` is required: every result navigates to a real
 *  page — there is no in-page "scroll and highlight" mode. A group whose rows
 *  have nowhere to land does not ship. */
export interface EntityRow {
  id: string;
  /** Primary display text — already decoded and language-resolved by the caller. */
  label: string;
  /** Secondary line: place, EIK, ATC code, year, money. */
  sub?: string;
  href: string;
}

/** `rows[i]` and `folds[i]` describe the SAME entity — `searchIndex` finds a
 *  position in `folds` and returns the row at it, so a desync yields a
 *  plausible WRONG row rather than a crash. Both are readonly for that reason. */
export interface EntityIndex {
  rows: readonly EntityRow[];
  /** Parallel to `rows` — each row's search keys, folded and joined by SEP. */
  folds: readonly string[];
  /** Rows dropped as unreachable (every key folded to ""). `rows.length +
   *  dropped` is the input length — read this before using `rows.length` as a
   *  population count, since the drop is otherwise silent. */
  dropped: number;
}

// `latinSkeleton` strips everything outside [a-z0-9], so a folded key can never
// contain a space. That makes a single space an unambiguous key boundary, which
// is what lets `searchIndex` treat "matches the start of ANY key" as a prefix
// hit rather than only "matches the start of the first key".
//
// COROLLARY worth knowing when choosing `keysOf`: the same stripping means a
// multi-word key is ONE token — "Стара Загора" folds to "starazagora", so
// "zagora" matches inside it and lands in the contains tier, not the prefix
// tier. Both still match; they differ only in rank. Pass the parts as separate
// keys (name AND place, rather than one pre-joined string) when each should be
// prefix-matchable in its own right.
//
// The MIRROR of that corollary is why `searchIndex` splits the QUERY on
// whitespace: a folded query is one token too, so "Света Марина Варна" could
// never match a fold that has SEP between the name and the place. See there.
const SEP = " ";

/**
 * Fold `items` into a searchable index, once.
 *
 * @param items  source rows in any order (sorted here when `rank` is given).
 * @param toRow  the displayable/navigable projection of an item.
 * @param keysOf every string worth matching on — name, code, EIK, place,
 *               aliases. Nullish entries are dropped, so a caller can list an
 *               optional field without guarding it.
 * @param rank   bigger sorts first; called ONCE per item, and ties keep input
 *               order (the sort is stable). Omit ONLY when the input is already
 *               in the order results should appear in; see contract 2 above.
 */
export const buildEntityIndex = <T>(
  items: readonly T[],
  toRow: (item: T) => EntityRow,
  keysOf: (item: T) => readonly (string | null | undefined)[],
  rank?: (item: T) => number,
): EntityIndex => {
  // Decorate-sort-undecorate: a comparator calling `rank` directly evaluates it
  // ~22x per row (110k calls at n=5000), which is free for a stored field and
  // 5.6ms -> 3.4ms for a rank the caller derives (a reduce over contracts).
  const ordered = rank
    ? items
        .map((item) => ({ item, k: rank(item) }))
        .sort((a, b) => b.k - a.k)
        .map((x) => x.item)
    : [...items];
  const rows: EntityRow[] = [];
  const folds: string[] = [];
  let dropped = 0;
  for (const item of ordered) {
    const folded = keysOf(item)
      .map((k) => (k ? latinSkeleton(k) : ""))
      .filter((k) => k !== "")
      .join(SEP);
    // A row no query could ever reach is dead weight in every later scan.
    if (folded === "") {
      dropped++;
      continue;
    }
    rows.push(toRow(item));
    folds.push(folded);
  }
  return { rows, folds, dropped };
};

/** True when `needle` starts one of the folded keys in `fold`. */
const prefixHit = (fold: string, needle: string): boolean =>
  fold.startsWith(needle) || fold.includes(SEP + needle);

/** One whitespace-separated word of the query: its fold and, when the shlyo
 *  rules rewrite it, the alternate needle to try alongside. */
type Term = { n: string; alt: string };

const hits = (fold: string, t: Term): boolean =>
  fold.includes(t.n) || (t.alt !== "" && fold.includes(t.alt));

const startsKey = (fold: string, t: Term): boolean =>
  prefixHit(fold, t.n) || (t.alt !== "" && prefixHit(fold, t.alt));

/**
 * Search a built index, best-first, capped.
 *
 * THE QUERY IS SPLIT ON WHITESPACE and every term must match — because the
 * folds contain SEP between keys while `latinSkeleton` strips whitespace, so a
 * single folded needle can never span two keys. "Света Марина Варна" (name +
 * place) is the natural query for a row that renders `label` over `sub`, and
 * folding it whole returns NOTHING: "svetamarinavarna" is not a substring of
 * "umbalsvetamarina varna 813154075". Per-term AND is a strict superset of the
 * single-needle form, since a one-word query is unchanged by the split.
 *
 * Ranking is two-tier: rows where EVERY term starts a key outrank rows where
 * some term merely appears inside one ("plovdiv" should reach Пловдив before
 * "Пловдивско шосе"). Within a tier the index's own rank order is preserved.
 *
 * The scan stops as soon as the prefix tier alone fills `limit` — the reason
 * the index is rank-ordered. It cannot stop earlier: a later prefix hit
 * outranks an already-collected contains hit, so the contains tier can only be
 * trusted once the whole list has been seen. Its own push is capped at `limit`
 * regardless, which bounds the work without changing the answer (the scan runs
 * in rank order, so the first `limit` contains hits ARE the top `limit`).
 *
 * An empty or all-punctuation query returns [] — "nothing to match on", never
 * "match everything". The caller owns the min-length guard.
 */
export const searchIndex = (
  index: EntityIndex | null | undefined,
  query: string,
  limit = 8,
): EntityRow[] => {
  if (!index || limit <= 0) return [];
  // `alt` is the Latin-side shliokavitsa spelling ("6umen", "plowdiw"), or ""
  // when the rules change nothing. Strictly additive: only tried alongside `n`.
  const terms: Term[] = query
    .split(/\s+/)
    .map((t) => ({ n: latinSkeleton(t), alt: shlyoSkeleton(t) }))
    .filter((t) => t.n !== "");
  if (terms.length === 0) return [];
  const { rows, folds } = index;

  const prefix: EntityRow[] = [];
  const contains: EntityRow[] = [];
  for (let i = 0; i < folds.length; i++) {
    const fold = folds[i];
    if (!terms.every((t) => hits(fold, t))) continue;
    if (terms.every((t) => startsKey(fold, t))) {
      prefix.push(rows[i]);
      if (prefix.length >= limit) return prefix;
    } else if (contains.length < limit) {
      contains.push(rows[i]);
    }
  }
  // `prefix.length < limit` always holds here — every push returns at the cap.
  return [...prefix, ...contains].slice(0, limit);
};
