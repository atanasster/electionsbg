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

/** The CAP — mirrors MAX_SEARCH_TERM in functions/db_table.js, and it is the other half of
 *  the same rule family as the floor above.
 *
 *  ⚠️ CODE UNITS HERE, CHARACTERS AT THE FLOOR, and the asymmetry is deliberate rather than
 *  an oversight to tidy up. The floor decides whether a term is a QUERY AT ALL, where a
 *  surrogate pair is one character to pg_trgm and two to `.length`; the cap only has to cut
 *  a pasted paragraph at the same point the engine does, and the engine cuts with `.slice()`.
 *  Making them agree would put the client's cut in a different place from the server's.
 *
 *  It lives here rather than in each URL hook for the reason the floor does: it had already
 *  been hand-copied into two of them, so `MAX_SEARCH_TERM` had two client mirrors and no gate
 *  tying either to the server. `searchTerm.test.ts` now reads the number back out of
 *  `functions/db_table.js`, so a change on one side fails rather than drifting. */
export const QUERY_MAX = 200;

/** Read a `?q` URL param. Capped, and DELIBERATELY neither trimmed nor character-validated.
 *
 *  ⚠️ NOT TRIMMED. On a search-first page this value IS the controlled field's value, so
 *  trimming here deletes the space as the reader types it and „Иван Иванов" arrives as
 *  „ИванИванов". Against a `searchFoldTokens` column that merely loses the token match; against
 *  a plain `searchFold` one (`companies.name`) the concatenated term matches NOTHING, so the
 *  page reports „no such company" at a 200 about a company that is in the corpus. DbDataTable
 *  trims ONCE at the request boundary, which is where the de-duplication this might otherwise
 *  be for already happens.
 *
 *  NOT character-validated because the engine escapes LIKE metacharacters itself (`likeEscape`
 *  in db_table.js), and a class narrow enough to feel safe rejects real queries —
 *  „БДЖ-ПЪТНИЧЕСКИ ПРЕВОЗИ", „Окръжен съд - Варна". */
export const readQueryParam = (v: string | null): string =>
  (v ?? "").slice(0, QUERY_MAX);
