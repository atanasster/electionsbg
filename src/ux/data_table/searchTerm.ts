// The free-text search FLOOR — one rule, in a module of its own.
//
// It lives outside DbDataTable.tsx for two reasons, and the second is the one that matters.
// The trivial one: exporting a function from a component file trips
// `react-refresh/only-export-components`. The real one: this rule now has consumers that are
// not the table. /persons decides whether to render a table AT ALL from it, so a page must be
// able to ask "would the engine accept this term?" without importing a React component — and
// the alternative to that is a hand-rolled `.length >= 3`, which is a third copy of the rule
// the engine itself documents as the one people get wrong.

/** Mirrors SEARCH_MIN_CHARS in functions/db_table.js — the client stops asking and the
 *  server stops answering, so neither depends on the other getting it right. Same shape
 *  as FIT_MIN_QUERY / useFundsFit.
 *
 *  WHY A FLOOR AT ALL (the server-side header carries the measurement): pg_trgm extracts
 *  no trigram from a 1-2 character pattern, so `col ILIKE '%q%'` stops being an index
 *  probe and becomes a full scan of the gin index — 3,447 buffers and 359-490 ms on
 *  contractor_rank, paid twice per keystroke because the count aggregate repeats it.
 *
 *  WHY THE CLIENT HALF IS NOT OPTIONAL: the engine REFUSES a sub-floor term with a 400
 *  rather than serving an empty result (an empty result would read as "no such
 *  contractor"). Without this guard every one- and two-character keystroke — and every
 *  `?q=` deep link shorter than three characters, which bypasses the debounce entirely
 *  because `initialSearch` seeds the debounced state directly — renders the destructive
 *  "Could not load data." panel on 23 of the 24 registry resources.
 *
 *  ⚠️ In DbDataTable the floor suppresses the TERM, never the request: the unfiltered page is
 *  the right thing to show while someone is still typing, and it keeps the aggregates footer
 *  coherent with the rows under it. A SEARCH-FIRST page reads it differently — below the floor
 *  there is no query yet, so it shows no table rather than an unfiltered one. */
export const SEARCH_MIN_CHARS = 3;

/** Count characters as Postgres does. `String.length` is UTF-16 code units, so "👍👍" is
 *  4 by that measure and 2 to pg_trgm — which extracts ZERO trigrams from it, i.e. a
 *  strictly worse case than the two-letter term the floor was written for. NFC first so a
 *  decomposed „é" counts as the one character the reader typed. Deliberately identical to
 *  `termLength` in functions/db_table.js: if the two disagree, one side sends a term the
 *  other refuses. */
export const termLength = (s: string): number => [...s.normalize("NFC")].length;
